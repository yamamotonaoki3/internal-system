// Repository：部署の一覧・作成・改名・オーナー交代と、オーナー候補（#196）。DB へのアクセスはこの層に閉じ込める。
// 作成・改名・交代は、それぞれ1つの db.batch で、部署・チャンネル・ロール・所属・参加・監査を一体で確定する。
// 全体管理者がオーナーになるときは、所属を動かさず、その部署の専用チャンネル2つへの参加だけを同じ batch で足す（#206）。
// 前提の確認（S-3）：D1 の batch は途中の文が失敗すると全体が取り消されるため、「条件が崩れたら NOT NULL 違反で失敗する文」
// （assertStatement）を batch の先頭近く（読んだ事実が変わっていないか）と最後（不変条件）に置く。
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import {
  channelMembers,
  channels,
  departments,
  rooms,
  userRoleAssignments,
  users,
} from "../../db/schema";
import {
  announcementChannelName,
  channelNameKey,
  departmentNameKey,
} from "../../../shared/department-rules";
import { afterCursor, toPage, type CursorPayload } from "../lib/cursor";
import { ROLE_IDS } from "../lib/permissions";
import { isUlid, newUlid } from "../lib/ulid";
import { auditLogInsert } from "./audit-log.repository";
import { withDatabase, type BatchItem, type Database } from "./database";
import {
  createRoleAssignmentRepository,
  type RoleAssignmentRepository,
} from "./role-assignment.repository";

export type DepartmentWrite = { actorId: string; traceId: string };

export type DuplicateReason = "department_name" | "channel_name";

/** 部署名またはチャンネル名の一意制約に違反した（アーカイブ済みのチャンネル名を含む） */
export class DuplicateDepartmentError extends Error {
  constructor(
    readonly reason: DuplicateReason,
    options?: { cause?: unknown },
  ) {
    super("部署名またはチャンネル名が重複しています", options);
    this.name = "DuplicateDepartmentError";
  }
}

export type ConflictReason =
  | "version"
  | "inactive_department"
  | "owner_not_found"
  | "owner_inactive"
  | "already_owner"
  | "successor_required"
  | "successor_unneeded"
  | "successor_invalid"
  | "state_changed";

/** 読んだ時から状態が変わった、または前提（版・指名できる社員・後任）を満たさない。batch 全体が取り消されている */
export class DepartmentConflictError extends Error {
  constructor(
    readonly reason: ConflictReason,
    options?: { cause?: unknown },
  ) {
    super("部署の状態が前提と合いません", options);
    this.name = "DepartmentConflictError";
  }
}

export type DepartmentSummary = {
  id: string;
  name: string;
  isActive: boolean;
  version: number;
};
export type DepartmentListItem = DepartmentSummary & {
  ownerUserId: string | null;
  ownerDisplayName: string | null;
  memberCount: number;
};
export type OwnerCandidate = {
  id: string;
  displayName: string;
  departmentId: string | null;
  ownedDepartmentId: string | null;
  isGlobalAdmin: boolean;
};
export type OwnershipInput = {
  ownerUserId: string;
  previousDepartmentSuccessorUserId: string | null;
  /** 元部署の版。null なら、読んだ時点の版を使う（利用者は元部署の版を画面で見ないため） */
  previousDepartmentVersion: number | null;
};
export type CreateDepartmentInput = OwnershipInput & {
  name: string;
  description: string;
};
export type RenameDepartmentInput = {
  id: string;
  version: number;
  name: string;
};
export type ChangeOwnerInput = OwnershipInput & {
  departmentId: string;
  version: number;
};

const AUTO_PURPOSES = sql`('department', 'announcement')`;

type UserFacts = {
  isActive: boolean;
  departmentId: string | null;
  isAdmin: boolean;
  /** 全体管理者でない人がオーナーを務める部署 */
  ownedDepartmentId: string | null;
};

type OwnerPlan = {
  departmentId: string;
  newOwnerId: string;
  newOwner: UserFacts;
  currentOwnerId: string | null;
  previous: {
    departmentId: string;
    version: number;
    successorId: string;
  } | null;
};

function isAdminSql(userId: SQL | string): SQL {
  return sql`EXISTS (SELECT 1 FROM user_role_assignments WHERE user_id = ${userId} AND role_id = ${ROLE_IDS.globalAdmin})`;
}
function ownerCountOfDepartment(departmentId: string): SQL {
  return sql`(SELECT COUNT(*) FROM user_role_assignments WHERE role_id = ${ROLE_IDS.owner} AND department_id = ${departmentId})`;
}
function ownedCountOfUser(userId: string): SQL {
  return sql`(SELECT COUNT(*) FROM user_role_assignments WHERE role_id = ${ROLE_IDS.owner} AND user_id = ${userId})`;
}
function isOwnerOf(userId: string, departmentId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM user_role_assignments WHERE user_id = ${userId} AND role_id = ${ROLE_IDS.owner} AND department_id = ${departmentId})`;
}
function autoChannelCount(departmentId: string, purpose: string): SQL {
  return sql`(SELECT COUNT(*) FROM channels WHERE department_id = ${departmentId} AND purpose = ${purpose})`;
}

/** 条件が崩れていたら NOT NULL 違反で batch 全体を失敗させる文（部署の版の列を、そのままか NULL にする） */
function assertStatement(
  db: Database,
  departmentId: string,
  conditions: SQL[],
) {
  return db
    .update(departments)
    .set({
      version: sql`CASE WHEN ${and(...conditions)} THEN ${departments.version} ELSE NULL END`,
    })
    .where(eq(departments.id, departmentId));
}

/** 版と有効かを確かめながら版を進める文。版が違う・無効なら NOT NULL 違反で batch 全体が失敗する */
function bumpVersion(expected: number): SQL {
  return sql`CASE WHEN ${departments.version} = ${expected} AND ${departments.isActive} = 1 THEN ${departments.version} + 1 ELSE NULL END`;
}

type Constraint = { kind: "unique" | "not_null"; target: string };

function constraintOf(error: unknown): Constraint | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const match = /(UNIQUE|NOT NULL) constraint failed: ([\w.]+)/i.exec(
      current.message,
    );
    if (match !== null)
      return {
        kind: match[1]?.toUpperCase() === "UNIQUE" ? "unique" : "not_null",
        target: match[2] ?? "",
      };
    current = current.cause;
  }
  return null;
}

/** 一意制約・前提確認の失敗だけを専用エラーにし、それ以外（未知のDBエラー）は変えずに返す */
function translateError(error: unknown): unknown {
  const constraint = constraintOf(error);
  if (constraint === null) return error;
  if (constraint.target === "departments.name_normalized")
    return new DuplicateDepartmentError("department_name", { cause: error });
  if (constraint.target === "channels.name_normalized")
    return new DuplicateDepartmentError("channel_name", { cause: error });
  // 想定する制約だけを「状態が変わった」とみなす：前提確認の失敗（版の NOT NULL 違反）と、ロール・参加・自動チャンネルの一意（主キー）違反。
  // それ以外の NOT NULL 違反・CHECK 違反などは、想定外のため変換せずに返す（500 になる）
  const isPreconditionFailure =
    constraint.kind === "not_null" &&
    constraint.target === "departments.version";
  const isExpectedUnique =
    constraint.kind === "unique" &&
    (constraint.target.startsWith("user_role_assignments.") ||
      constraint.target.startsWith("channel_members.") ||
      constraint.target === "channels.department_id");
  if (isPreconditionFailure || isExpectedUnique)
    return new DepartmentConflictError("state_changed", { cause: error });
  return error;
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, "\\$&");
}

const userFactColumns = {
  isActive: users.isActive,
  departmentId: users.departmentId,
  isAdmin: sql<boolean>`${isAdminSql(sql`users.id`)}`.mapWith(Boolean),
  ownedDepartmentId: sql<
    string | null
  >`(SELECT a.department_id FROM user_role_assignments a WHERE a.user_id = users.id AND a.role_id = ${ROLE_IDS.owner} AND NOT ${isAdminSql(sql`users.id`)} ORDER BY a.department_id LIMIT 1)`,
};

function auditFor(db: Database, write: DepartmentWrite) {
  return (
    action:
      "department.create" | "department.rename" | "department.owner_change",
    departmentId: string,
    detail: Record<string, string | number | boolean | null>,
  ) =>
    auditLogInsert(db, {
      actorId: write.actorId,
      action,
      targetType: "department",
      targetId: departmentId,
      result: "success",
      traceId: write.traceId,
      detail,
    });
}

export function createDepartmentRepository(db: Database) {
  async function readUserFacts(userId: string): Promise<UserFacts | null> {
    const rows = await db
      .select(userFactColumns)
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  async function readOwnerId(departmentId: string): Promise<string | null> {
    const rows = await db
      .select({ userId: userRoleAssignments.userId })
      .from(userRoleAssignments)
      .where(
        and(
          eq(userRoleAssignments.roleId, ROLE_IDS.owner),
          eq(userRoleAssignments.departmentId, departmentId),
        ),
      )
      .limit(1);
    return rows[0]?.userId ?? null;
  }

  async function findSummary(id: string): Promise<DepartmentSummary | null> {
    const rows = await db
      .select({
        id: departments.id,
        name: departments.name,
        isActive: departments.isActive,
        version: departments.version,
      })
      .from(departments)
      .where(eq(departments.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /** 読んだ事実から、オーナー交代の計画を作る。満たさない前提は DepartmentConflictError（何も書かない） */
  async function planOwnerTransfer(
    departmentId: string,
    input: OwnershipInput,
  ): Promise<OwnerPlan> {
    const newOwner = await readUserFacts(input.ownerUserId);
    if (newOwner === null) throw new DepartmentConflictError("owner_not_found");
    if (!newOwner.isActive) throw new DepartmentConflictError("owner_inactive");
    const currentOwnerId = await readOwnerId(departmentId);
    if (currentOwnerId === input.ownerUserId)
      throw new DepartmentConflictError("already_owner");
    const owned = newOwner.ownedDepartmentId;
    const successorId = input.previousDepartmentSuccessorUserId;
    const base = {
      departmentId,
      newOwnerId: input.ownerUserId,
      newOwner,
      currentOwnerId,
    };
    // 全体管理者は所属もオーナーの兼任も動かさないため、元部署の後任は要らない
    if (owned === null || owned === departmentId) {
      if (successorId !== null)
        throw new DepartmentConflictError("successor_unneeded");
      return { ...base, previous: null };
    }
    if (successorId === null)
      throw new DepartmentConflictError("successor_required");
    return {
      ...base,
      previous: await planPreviousDepartment(input, owned, successorId),
    };
  }

  /** 元部署（オーナー交代で後任が要る部署）と後任を確かめ、元部署の版を決める */
  async function planPreviousDepartment(
    input: OwnershipInput,
    previousDepartmentId: string,
    successorId: string,
  ): Promise<NonNullable<OwnerPlan["previous"]>> {
    const [successor, previousDepartment] = await Promise.all([
      readUserFacts(successorId),
      findSummary(previousDepartmentId),
    ]);
    if (
      successor === null ||
      !successor.isActive ||
      successor.isAdmin ||
      successor.departmentId !== previousDepartmentId ||
      successor.ownedDepartmentId !== null ||
      successorId === input.ownerUserId
    )
      throw new DepartmentConflictError("successor_invalid");
    if (previousDepartment === null || !previousDepartment.isActive)
      throw new DepartmentConflictError("inactive_department");
    const expected =
      input.previousDepartmentVersion ?? previousDepartment.version;
    if (previousDepartment.version !== expected)
      throw new DepartmentConflictError("version");
    return {
      departmentId: previousDepartmentId,
      version: expected,
      successorId,
    };
  }

  /** 計画の事実が batch の時点でも同じかを確かめる文 */
  function factAssertions(plan: OwnerPlan): SQL[] {
    const { newOwner, previous } = plan;
    const conditions: SQL[] = [
      plan.currentOwnerId === null
        ? sql`${ownerCountOfDepartment(plan.departmentId)} = 0`
        : sql`${ownerCountOfDepartment(plan.departmentId)} = 1 AND ${isOwnerOf(plan.currentOwnerId, plan.departmentId)}`,
      sql`EXISTS (SELECT 1 FROM users WHERE id = ${plan.newOwnerId} AND is_active = 1 AND department_id IS ${newOwner.departmentId})`,
      newOwner.isAdmin
        ? isAdminSql(plan.newOwnerId)
        : sql`NOT ${isAdminSql(plan.newOwnerId)}`,
    ];
    if (previous !== null) {
      conditions.push(
        sql`${ownedCountOfUser(plan.newOwnerId)} = 1 AND ${isOwnerOf(plan.newOwnerId, previous.departmentId)}`,
        sql`EXISTS (SELECT 1 FROM users WHERE id = ${previous.successorId} AND is_active = 1 AND department_id = ${previous.departmentId})`,
        sql`NOT ${isAdminSql(previous.successorId)}`,
        sql`${ownedCountOfUser(previous.successorId)} = 0`,
      );
    } else if (!newOwner.isAdmin) {
      conditions.push(sql`${ownedCountOfUser(plan.newOwnerId)} = 0`);
    }
    return conditions;
  }

  /** 元部署にも変更が入るため、元部署の版も進める（読んだ版と違えば batch 全体が失敗する） */
  function bumpPreviousDepartment(plan: OwnerPlan, now: string): BatchItem[] {
    if (plan.previous === null) return [];
    return [
      db
        .update(departments)
        .set({ version: bumpVersion(plan.previous.version), updatedAt: now })
        .where(eq(departments.id, plan.previous.departmentId)),
    ];
  }

  /** 交代の最後の不変条件（対象部署ごとにオーナーがちょうど1人。全体管理者でないオーナーは所属する1部署だけ） */
  function invariantAssertions(plan: OwnerPlan): SQL[] {
    const { previous } = plan;
    const conditions: SQL[] = [
      sql`${ownerCountOfDepartment(plan.departmentId)} = 1 AND ${isOwnerOf(plan.newOwnerId, plan.departmentId)}`,
    ];
    if (!plan.newOwner.isAdmin)
      conditions.push(
        sql`${ownedCountOfUser(plan.newOwnerId)} = 1 AND EXISTS (SELECT 1 FROM users WHERE id = ${plan.newOwnerId} AND department_id = ${plan.departmentId})`,
      );
    if (previous !== null)
      conditions.push(
        sql`${ownerCountOfDepartment(previous.departmentId)} = 1 AND ${isOwnerOf(previous.successorId, previous.departmentId)}`,
        sql`${ownedCountOfUser(previous.successorId)} = 1 AND EXISTS (SELECT 1 FROM users WHERE id = ${previous.successorId} AND department_id = ${previous.departmentId})`,
      );
    return conditions;
  }

  /** ロール・所属・参加の付け替え（作成と交代で共通）。指名された社員（全体管理者を除く）の所属が移り、旧部署の自動チャンネルから外れる。新部署の自動チャンネルへの参加は全体管理者にも足す（所属は動かさない） */
  function transferStatements(plan: OwnerPlan, now: string): BatchItem[] {
    const { previous, newOwner } = plan;
    const statements: BatchItem[] = [];
    const assignOwner = (userId: string, departmentId: string) =>
      db.insert(userRoleAssignments).values({
        id: newUlid(),
        userId,
        roleId: ROLE_IDS.owner,
        scopeType: "department",
        departmentId,
        assignedAt: now,
      });
    const removeOwner = (userId: string, departmentId: string) =>
      db
        .delete(userRoleAssignments)
        .where(
          and(
            eq(userRoleAssignments.userId, userId),
            eq(userRoleAssignments.roleId, ROLE_IDS.owner),
            eq(userRoleAssignments.departmentId, departmentId),
          ),
        );
    if (plan.currentOwnerId !== null)
      statements.push(removeOwner(plan.currentOwnerId, plan.departmentId));
    if (previous !== null) {
      statements.push(
        removeOwner(plan.newOwnerId, previous.departmentId),
        assignOwner(previous.successorId, previous.departmentId),
      );
    }
    statements.push(assignOwner(plan.newOwnerId, plan.departmentId));
    if (!newOwner.isAdmin) {
      if (newOwner.departmentId !== plan.departmentId) {
        statements.push(
          db
            .update(users)
            .set({ departmentId: plan.departmentId })
            .where(eq(users.id, plan.newOwnerId)),
        );
        if (newOwner.departmentId !== null)
          statements.push(
            db
              .delete(channelMembers)
              .where(
                and(
                  eq(channelMembers.userId, plan.newOwnerId),
                  sql`${channelMembers.channelId} IN (SELECT room_id FROM channels WHERE department_id = ${newOwner.departmentId} AND purpose IN ${AUTO_PURPOSES})`,
                ),
              ),
          );
      }
    }
    // 全体管理者も、所属は動かさず専用チャンネルへ参加だけ足す（#206）
    statements.push(
      db.insert(channelMembers).select(sql`
        SELECT c.room_id, ${plan.newOwnerId}, ${now}
        FROM channels c
        WHERE c.department_id = ${plan.departmentId} AND c.purpose IN ${AUTO_PURPOSES}
          AND NOT EXISTS (
            SELECT 1 FROM channel_members m WHERE m.channel_id = c.room_id AND m.user_id = ${plan.newOwnerId})`),
    );
    return statements;
  }

  async function runBatch<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw translateError(error);
    }
  }

  return {
    async list(options: { limit: number; cursor?: CursorPayload }) {
      const rows = await db
        .select({
          id: departments.id,
          name: departments.name,
          nameNormalized: departments.nameNormalized,
          isActive: departments.isActive,
          version: departments.version,
          ownerUserId: userRoleAssignments.userId,
          ownerDisplayName: users.displayName,
          memberCount: sql<number>`(SELECT COUNT(*) FROM users m WHERE m.department_id = departments.id AND m.is_active = 1)`,
        })
        .from(departments)
        .leftJoin(
          userRoleAssignments,
          and(
            eq(userRoleAssignments.departmentId, departments.id),
            eq(userRoleAssignments.roleId, ROLE_IDS.owner),
          ),
        )
        .leftJoin(users, eq(users.id, userRoleAssignments.userId))
        .where(
          options.cursor === undefined
            ? undefined
            : afterCursor(
                { sort: departments.nameNormalized, id: departments.id },
                options.cursor,
                "asc",
              ),
        )
        .orderBy(asc(departments.nameNormalized), asc(departments.id))
        .limit(options.limit + 1);
      const page = toPage(rows, options.limit, (row) => {
        if (!isUlid(row.id)) throw new Error("部署IDが不正です");
        return { v: row.nameNormalized, id: row.id };
      });
      return {
        items: page.items.map((row): DepartmentListItem => ({
          id: row.id,
          name: row.name,
          isActive: row.isActive,
          version: row.version,
          ownerUserId: row.ownerUserId,
          ownerDisplayName: row.ownerDisplayName,
          memberCount: row.memberCount,
        })),
        nextCursor: page.nextCursor,
      };
    },

    findById: findSummary,

    async listOwnerCandidates(options: {
      q: string;
      limit: number;
      cursor?: CursorPayload;
    }) {
      const conditions: SQL[] = [eq(users.isActive, true)];
      if (options.q !== "")
        conditions.push(
          sql`${users.displayName} LIKE ${`%${escapeLike(options.q)}%`} ESCAPE '\\'`,
        );
      if (options.cursor !== undefined)
        conditions.push(
          afterCursor({ sort: users.id, id: users.id }, options.cursor, "asc"),
        );
      const rows = await db
        .select({
          id: users.id,
          displayName: users.displayName,
          departmentId: users.departmentId,
          ownedDepartmentId: userFactColumns.ownedDepartmentId,
          isGlobalAdmin: userFactColumns.isAdmin,
        })
        .from(users)
        .where(and(...conditions))
        .orderBy(asc(users.id))
        .limit(options.limit + 1);
      return toPage(rows, options.limit, (row) => {
        if (!isUlid(row.id)) throw new Error("社員IDが不正です");
        return { v: row.id, id: row.id };
      });
    },

    async create(input: CreateDepartmentInput, write: DepartmentWrite) {
      const departmentId = newUlid();
      const dedicatedChannelId = newUlid();
      const announcementChannelId = newUlid();
      const now = new Date().toISOString();
      const announcementName = announcementChannelName(input.name);
      const plan = await planOwnerTransfer(departmentId, input);
      const [created] = await runBatch(() =>
        db.batch([
          db
            .insert(departments)
            .values({
              id: departmentId,
              name: input.name,
              nameNormalized: departmentNameKey(input.name),
              description: input.description,
              version: 1,
              createdAt: now,
              updatedAt: now,
            })
            .returning({
              id: departments.id,
              name: departments.name,
              description: departments.description,
              version: departments.version,
              createdAt: departments.createdAt,
            }),
          db.insert(rooms).values([
            { id: dedicatedChannelId, kind: "channel", createdAt: now },
            { id: announcementChannelId, kind: "channel", createdAt: now },
          ]),
          db.insert(channels).values([
            {
              roomId: dedicatedChannelId,
              departmentId,
              name: input.name,
              nameNormalized: channelNameKey(input.name),
              visibility: "public",
              purpose: "department",
              createdAt: now,
              updatedAt: now,
            },
            {
              roomId: announcementChannelId,
              departmentId,
              name: announcementName,
              nameNormalized: channelNameKey(announcementName),
              visibility: "public",
              purpose: "announcement",
              createdAt: now,
              updatedAt: now,
            },
          ]),
          ...bumpPreviousDepartment(plan, now),
          assertStatement(db, departmentId, factAssertions(plan)),
          ...transferStatements(plan, now),
          assertStatement(db, departmentId, [
            ...invariantAssertions(plan),
            sql`${autoChannelCount(departmentId, "department")} = 1 AND ${autoChannelCount(departmentId, "announcement")} = 1`,
          ]),
          auditFor(db, write)("department.create", departmentId, {
            ownerUserId: plan.newOwnerId,
            previousDepartmentId: plan.previous?.departmentId ?? null,
            successorUserId: plan.previous?.successorId ?? null,
          }),
        ]),
      );
      const row = created[0];
      if (row === undefined) throw new Error("部署の作成結果がありません");
      return {
        ...row,
        ownerUserId: plan.newOwnerId,
        dedicatedChannelId,
        announcementChannelId,
      };
    },

    async rename(input: RenameDepartmentInput, write: DepartmentWrite) {
      const current = await findSummary(input.id);
      if (current === null || !current.isActive)
        throw new DepartmentConflictError("inactive_department");
      if (current.version !== input.version)
        throw new DepartmentConflictError("version");
      const dedicatedKey = channelNameKey(input.name);
      const announcementName = announcementChannelName(input.name);
      const currentChannels = await db
        .select({
          purpose: channels.purpose,
          nameNormalized: channels.nameNormalized,
        })
        .from(channels)
        .where(
          and(
            eq(channels.departmentId, input.id),
            sql`${channels.purpose} IN ${AUTO_PURPOSES}`,
          ),
        );
      const currentDedicatedKey = currentChannels.find(
        (channel) => channel.purpose === "department",
      )?.nameNormalized;
      const now = new Date().toISOString();
      const updateChannel = (
        purpose: "department" | "announcement",
        name: string,
      ) =>
        db
          .update(channels)
          .set({
            name,
            nameNormalized: channelNameKey(name),
            version: sql`${channels.version} + 1`,
            updatedAt: now,
          })
          .where(
            and(
              eq(channels.departmentId, input.id),
              eq(channels.purpose, purpose),
            ),
          );
      const dedicatedUpdate = updateChannel("department", input.name);
      const announcementUpdate = updateChannel(
        "announcement",
        announcementName,
      );
      // 新しいお知らせ名が自分の通常チャンネルの今の名前と同じ（「Xのお知らせ」→「X」）ときは、通常を先に変えて名前を空ける。
      // 逆（「a」→「aのお知らせ」）は、お知らせを先に変える。どちらも自分自身との衝突で失敗させない
      const channelUpdates =
        channelNameKey(announcementName) === currentDedicatedKey
          ? [dedicatedUpdate, announcementUpdate]
          : [announcementUpdate, dedicatedUpdate];
      const [renamed] = await runBatch(() =>
        db.batch([
          db
            .update(departments)
            .set({
              name: input.name,
              nameNormalized: departmentNameKey(input.name),
              version: bumpVersion(input.version),
              updatedAt: now,
            })
            .where(eq(departments.id, input.id))
            .returning({
              id: departments.id,
              name: departments.name,
              version: departments.version,
              updatedAt: departments.updatedAt,
            }),
          ...channelUpdates,
          assertStatement(db, input.id, [
            sql`NOT EXISTS (SELECT 1 FROM channels WHERE department_id = ${input.id} AND purpose = 'department' AND name_normalized <> ${dedicatedKey})`,
            sql`NOT EXISTS (SELECT 1 FROM channels WHERE department_id = ${input.id} AND purpose = 'announcement' AND name_normalized <> ${channelNameKey(announcementName)})`,
          ]),
          auditFor(db, write)("department.rename", input.id, {
            previousVersion: input.version,
            nextVersion: input.version + 1,
          }),
        ]),
      );
      const row = renamed[0];
      if (row === undefined) throw new DepartmentConflictError("state_changed");
      return { ...row, updatedAt: row.updatedAt ?? now };
    },

    async changeOwner(input: ChangeOwnerInput, write: DepartmentWrite) {
      const current = await findSummary(input.departmentId);
      if (current === null || !current.isActive)
        throw new DepartmentConflictError("inactive_department");
      if (current.version !== input.version)
        throw new DepartmentConflictError("version");
      const plan = await planOwnerTransfer(input.departmentId, input);
      const now = new Date().toISOString();
      const [bumped] = await runBatch(() =>
        db.batch([
          db
            .update(departments)
            .set({ version: bumpVersion(input.version), updatedAt: now })
            .where(eq(departments.id, input.departmentId))
            .returning({
              version: departments.version,
              updatedAt: departments.updatedAt,
            }),
          ...bumpPreviousDepartment(plan, now),
          assertStatement(db, input.departmentId, factAssertions(plan)),
          ...transferStatements(plan, now),
          assertStatement(db, input.departmentId, invariantAssertions(plan)),
          auditFor(db, write)("department.owner_change", input.departmentId, {
            previousOwnerUserId: plan.currentOwnerId,
            newOwnerUserId: plan.newOwnerId,
            previousDepartmentId: plan.previous?.departmentId ?? null,
            successorUserId: plan.previous?.successorId ?? null,
            previousVersion: input.version,
            nextVersion: input.version + 1,
          }),
        ]),
      );
      const row = bumped[0];
      if (row === undefined) throw new DepartmentConflictError("state_changed");
      return {
        departmentId: input.departmentId,
        ownerUserId: plan.newOwnerId,
        version: row.version,
        updatedAt: row.updatedAt ?? now,
      };
    },
  };
}

export type DepartmentRepository = ReturnType<
  typeof createDepartmentRepository
>;

export function withDepartments<T>(
  env: Env,
  run: (
    repository: DepartmentRepository,
    roles: RoleAssignmentRepository,
  ) => Promise<T>,
): Promise<T> {
  return withDatabase(env, (db) =>
    run(createDepartmentRepository(db), createRoleAssignmentRepository(db)),
  );
}
