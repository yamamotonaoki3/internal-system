// Repository：チャンネルの作成申請（#131）の申請・一覧・承認・却下・取り下げ。DB へのアクセスはこの層に閉じ込める。
// 1 操作＝1 つの db.batch で、申請の更新・チャンネルの作成・監査・通知を一体で確定する（途中の文が失敗したら全体が取り消される）。
// 前提の確認は、条件が崩れたら NOT NULL 違反で batch 全体を失敗させる文（CASE WHEN … ELSE NULL）で行い、失敗を制約の表と列で専用エラーに変換する。
// 未知の DB エラーは握りつぶさずそのまま再送出する（docs/project-rules.md「複数の文の db.batch で前提を確認する書き方」）。
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import {
  channelCreationRequests,
  channelMembers,
  channels,
  departments,
  rooms,
  userRoleAssignments,
  users,
} from "../../db/schema";
import { channelNameKey } from "../../../shared/department-rules";
import { afterCursor, toPage, type CursorPayload } from "../lib/cursor";
import { ROLE_IDS } from "../lib/permissions";
import { isUlid, newUlid } from "../lib/ulid";
import { auditLogInsert } from "./audit-log.repository";
import { withDatabase, type BatchItem, type Database } from "./database";
import { notificationInserts } from "./notification.repository";
import {
  createRoleAssignmentRepository,
  type RoleAssignmentRepository,
} from "./role-assignment.repository";

export type RequestStatus = "pending" | "approved" | "rejected" | "withdrawn";
export type RequestVisibility = "public" | "private";

export type ChannelRequestWrite = { actorId: string; traceId: string };

export type ConflictReason =
  /** 申請時：同じ名前のチャンネル（アーカイブ済みを含む）または承認待ちの申請がある */
  | "duplicate_name"
  /** 承認時：申請の後に同じ名前のチャンネルができた */
  | "name_taken"
  /** 承認時：部署が無効 */
  | "department_inactive"
  /** すでに承認・却下・取り下げされている（または、読んだ後に他の操作が先に確定した） */
  | "decided";

/** 前提（名前の重複・部署の有効・承認待ち）を満たさない。batch 全体が取り消されている */
export class ChannelRequestConflictError extends Error {
  constructor(
    readonly reason: ConflictReason,
    options?: { cause?: unknown },
  ) {
    super("チャンネルの作成申請の状態が前提と合いません", options);
    this.name = "ChannelRequestConflictError";
  }
}

export type ChannelRequestItem = {
  id: string;
  departmentId: string | null;
  name: string;
  visibility: RequestVisibility;
  status: RequestStatus;
  rejectReason: string | null;
  createdAt: string;
  decidedAt: string | null;
  channelId: string | null;
};

export type ReviewableRow = ChannelRequestItem & {
  requesterId: string;
  requesterDisplayName: string;
  /** 申請者が、申請の部署のオーナーか（会社直属は false） */
  requesterOwnsDepartment: boolean;
};

/** 決裁・取り下げの前に読む、申請の事実 */
export type RequestForDecision = {
  id: string;
  departmentId: string | null;
  name: string;
  nameNormalized: string;
  description: string;
  visibility: RequestVisibility;
  requestedBy: string;
  status: RequestStatus;
  version: number;
  requesterOwnsDepartment: boolean;
};

export type CreateRequestInput = {
  departmentId: string | null;
  name: string;
  description: string;
  visibility: RequestVisibility;
  requesterId: string;
  /** 申請が届いたことを知らせる宛先（申請者を除いたもの） */
  reviewerIds: string[];
};

export type ReviewScope = {
  actorId: string;
  isAdmin: boolean;
  ownedDepartmentIds: readonly string[];
};

// 副問い合わせの表にも department_id があるため、外側の列は表名つきの文字列で書く（Drizzle は単一の表の問い合わせで表名を省くため）
const requestedByRef = sql.raw("channel_creation_requests.requested_by");
const departmentIdRef = sql.raw("channel_creation_requests.department_id");
/** 申請者がその部署のオーナーか。一覧と決裁で同じ意味の SQL 部品を使う（有効な利用者のオーナーの割り当て） */
const requesterOwnsDepartmentSql = sql<boolean>`EXISTS (
  SELECT 1 FROM user_role_assignments a
  JOIN users u ON u.id = a.user_id
  WHERE a.user_id = ${requestedByRef}
    AND a.role_id = ${ROLE_IDS.owner}
    AND a.department_id = ${departmentIdRef}
    AND u.is_active = 1)`.mapWith(Boolean);

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

/** 想定する制約（名前の重複・部署が無効・決裁済み）だけを専用エラーにし、それ以外（未知のDBエラー）は変えずに返す */
function translateError(error: unknown): unknown {
  const constraint = constraintOf(error);
  if (constraint === null) return error;
  const { kind, target } = constraint;
  const reason = ((): ConflictReason | null => {
    if (target === "channel_creation_requests.name_normalized")
      return "duplicate_name";
    if (kind === "unique" && target === "channels.name_normalized")
      return "name_taken";
    if (kind === "not_null" && target === "departments.version")
      return "department_inactive";
    if (kind === "not_null" && target === "channel_creation_requests.version")
      return "decided";
    return null;
  })();
  return reason === null
    ? error
    : new ChannelRequestConflictError(reason, { cause: error });
}

async function runBatch<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw translateError(error);
  }
}

/** 承認待ちで、読んだ版のままかを確かめながら版を進める文。崩れていたら NOT NULL 違反で batch 全体が失敗する */
function guardPending(db: Database, id: string, version: number) {
  return db
    .update(channelCreationRequests)
    .set({
      version: sql`CASE WHEN ${channelCreationRequests.status} = 'pending' AND ${channelCreationRequests.version} = ${version} THEN ${channelCreationRequests.version} + 1 ELSE NULL END`,
    })
    .where(eq(channelCreationRequests.id, id));
}

const itemColumns = {
  id: channelCreationRequests.id,
  departmentId: channelCreationRequests.departmentId,
  name: channelCreationRequests.name,
  visibility: channelCreationRequests.visibility,
  status: channelCreationRequests.status,
  rejectReason: channelCreationRequests.decisionReason,
  createdAt: channelCreationRequests.requestedAt,
  decidedAt: channelCreationRequests.decidedAt,
  channelId: channelCreationRequests.channelId,
};

function cursorFor(row: { id: string }) {
  if (!isUlid(row.id)) throw new Error("申請IDが不正です");
  return { v: row.id, id: row.id };
}

/** 審査者が一覧で見てよい範囲の条件（取得後に取り除かず、SQL の WHERE に入れる）。判定の元は lib/channel-request-rules.ts の isReviewable */
function reviewScopeSql(scope: ReviewScope): SQL {
  const owned =
    scope.ownedDepartmentIds.length === 0
      ? sql`0`
      : inArray(channelCreationRequests.departmentId, [
          ...scope.ownedDepartmentIds,
        ]);
  const isAdmin = scope.isAdmin ? sql`1` : sql`0`;
  const dept = channelCreationRequests.departmentId;
  return sql`(
    (${dept} IS NULL AND ${isAdmin})
    OR (${dept} IS NOT NULL AND ${requesterOwnsDepartmentSql}
        AND (${isAdmin} OR (${channelCreationRequests.requestedBy} = ${scope.actorId} AND ${owned})))
    OR (${dept} IS NOT NULL AND NOT ${requesterOwnsDepartmentSql} AND ${owned})
  )`;
}

export function createChannelRequestRepository(db: Database) {
  const audit = (
    write: ChannelRequestWrite,
    action: "create" | "approve" | "reject" | "withdraw",
    requestId: string,
    detail: Record<string, string | number | boolean | null>,
  ) =>
    auditLogInsert(db, {
      actorId: write.actorId,
      action: `channel_request.${action}`,
      targetType: "channel_request",
      targetId: requestId,
      result: "success",
      traceId: write.traceId,
      detail,
    });

  async function readUserId(
    roleId: string,
    extra?: SQL,
  ): Promise<string | null> {
    const rows = await db
      .select({ userId: userRoleAssignments.userId })
      .from(userRoleAssignments)
      .innerJoin(users, eq(users.id, userRoleAssignments.userId))
      .where(
        and(
          eq(userRoleAssignments.roleId, roleId),
          eq(users.isActive, true),
          extra,
        ),
      )
      .limit(1);
    return rows[0]?.userId ?? null;
  }

  return {
    /** 申請者の所属部署（所属なしは null） */
    async findUserDepartmentId(userId: string): Promise<string | null> {
      const rows = await db
        .select({ departmentId: users.departmentId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return rows[0]?.departmentId ?? null;
    },

    /** 申請が届いたときの通知の宛先を決める材料：部署のオーナー（有効な利用者）と全体管理者 */
    async readReviewerCandidates(departmentId: string | null) {
      const [ownerId, adminId] = await Promise.all([
        departmentId === null
          ? Promise.resolve(null)
          : readUserId(
              ROLE_IDS.owner,
              eq(userRoleAssignments.departmentId, departmentId),
            ),
        readUserId(ROLE_IDS.globalAdmin),
      ]);
      return { ownerId, adminId };
    },

    async create(
      input: CreateRequestInput,
      write: ChannelRequestWrite,
    ): Promise<ChannelRequestItem> {
      const id = newUlid();
      const now = new Date().toISOString();
      const key = channelNameKey(input.name);
      const [created] = await runBatch(() =>
        db.batch([
          db
            .insert(channelCreationRequests)
            .values({
              id,
              departmentId: input.departmentId,
              name: input.name,
              // 同じ名前のチャンネル（アーカイブ済みを含む）があれば NULL にして NOT NULL 違反で失敗させる
              nameNormalized: sql`CASE WHEN EXISTS (SELECT 1 FROM channels WHERE name_normalized = ${key}) THEN NULL ELSE ${key} END`,
              description: input.description,
              visibility: input.visibility,
              requestedBy: input.requesterId,
              status: "pending",
              version: 1,
              requestedAt: now,
            })
            .returning(itemColumns),
          audit(write, "create", id, {
            departmentId: input.departmentId,
            requestId: id,
            visibility: input.visibility,
          }),
          ...notificationInserts(db, input.reviewerIds, {
            kind: "channel_request.submitted",
            targetId: id,
          }),
        ]),
      );
      const row = created[0];
      if (row === undefined) throw new Error("申請の作成結果がありません");
      return row;
    },

    /** 自分の申請を新しい順に読む */
    async listMine(
      requesterId: string,
      options: { limit: number; cursor?: CursorPayload },
    ) {
      const conditions: SQL[] = [
        eq(channelCreationRequests.requestedBy, requesterId),
      ];
      if (options.cursor !== undefined)
        conditions.push(
          afterCursor(
            {
              sort: channelCreationRequests.id,
              id: channelCreationRequests.id,
            },
            options.cursor,
            "desc",
          ),
        );
      const rows = await db
        .select(itemColumns)
        .from(channelCreationRequests)
        .where(and(...conditions))
        .orderBy(desc(channelCreationRequests.id))
        .limit(options.limit + 1);
      return toPage<ChannelRequestItem>(rows, options.limit, cursorFor);
    },

    /** 審査者が見てよい範囲の申請を新しい順に読む。範囲・絞り込みはすべて SQL の WHERE に入れる */
    async listReviewable(
      scope: ReviewScope,
      options: {
        limit: number;
        cursor?: CursorPayload;
        status?: RequestStatus;
        departmentId?: string;
      },
    ) {
      const conditions: SQL[] = [reviewScopeSql(scope)];
      if (options.status !== undefined)
        conditions.push(eq(channelCreationRequests.status, options.status));
      if (options.departmentId !== undefined)
        conditions.push(
          eq(channelCreationRequests.departmentId, options.departmentId),
        );
      if (options.cursor !== undefined)
        conditions.push(
          afterCursor(
            {
              sort: channelCreationRequests.id,
              id: channelCreationRequests.id,
            },
            options.cursor,
            "desc",
          ),
        );
      const rows = await db
        .select({
          ...itemColumns,
          requesterId: channelCreationRequests.requestedBy,
          requesterDisplayName: users.displayName,
          requesterOwnsDepartment: requesterOwnsDepartmentSql,
        })
        .from(channelCreationRequests)
        .innerJoin(users, eq(users.id, channelCreationRequests.requestedBy))
        .where(and(...conditions))
        .orderBy(desc(channelCreationRequests.id))
        .limit(options.limit + 1);
      return toPage<ReviewableRow>(rows, options.limit, cursorFor);
    },

    /** 決裁・取り下げの前に、申請の事実を読む。存在しなければ null */
    async findForDecision(id: string): Promise<RequestForDecision | null> {
      const rows = await db
        .select({
          id: channelCreationRequests.id,
          departmentId: channelCreationRequests.departmentId,
          name: channelCreationRequests.name,
          nameNormalized: channelCreationRequests.nameNormalized,
          description: channelCreationRequests.description,
          visibility: channelCreationRequests.visibility,
          requestedBy: channelCreationRequests.requestedBy,
          status: channelCreationRequests.status,
          version: channelCreationRequests.version,
          requesterOwnsDepartment: requesterOwnsDepartmentSql,
        })
        .from(channelCreationRequests)
        .where(eq(channelCreationRequests.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    /** 承認：チャンネルと rooms を作り、申請者を参加させ、申請を更新し、監査・通知を残す（1 batch） */
    async approve(request: RequestForDecision, write: ChannelRequestWrite) {
      const roomId = newUlid();
      const now = new Date().toISOString();
      const statements: BatchItem[] = [];
      // 先に申請の版を確かめる（決裁済みなら、部署が無効でも「すでに処理されています」にする）
      statements.push(guardPending(db, request.id, request.version));
      // 会社直属のときは部署の確認を入れない。部署の版は上げない（値を変えず、無効なら NOT NULL 違反で失敗させる）
      if (request.departmentId !== null)
        statements.push(
          db
            .update(departments)
            .set({
              version: sql`CASE WHEN ${departments.isActive} = 1 THEN ${departments.version} ELSE NULL END`,
            })
            .where(eq(departments.id, request.departmentId)),
        );
      statements.push(
        db
          .insert(rooms)
          .values({ id: roomId, kind: "channel", createdAt: now }),
        db.insert(channels).values({
          roomId,
          departmentId: request.departmentId,
          name: request.name,
          nameNormalized: request.nameNormalized,
          description: request.description,
          visibility: request.visibility,
          purpose: "normal",
          createdBy: request.requestedBy,
          createdAt: now,
          updatedAt: now,
        }),
        // 申請者だけが参加者になる。管理権限（ロールの割り当て）は付けない
        db.insert(channelMembers).values({
          channelId: roomId,
          userId: request.requestedBy,
          joinedAt: now,
        }),
        db
          .update(channelCreationRequests)
          .set({
            status: "approved",
            decidedBy: write.actorId,
            decidedAt: now,
            channelId: roomId,
          })
          .where(eq(channelCreationRequests.id, request.id)),
        // チャンネルの作成と申請者の自動参加は、この 1 件に含める（既定の方針 4）
        audit(write, "approve", request.id, {
          channelId: roomId,
          departmentId: request.departmentId,
          requestId: request.id,
          visibility: request.visibility,
        }),
        ...notificationInserts(
          db,
          request.requestedBy === write.actorId ? [] : [request.requestedBy],
          {
            kind: "channel_request.approved",
            roomId,
            targetId: request.id,
          },
        ),
      );
      await runBatch(() => db.batch(statements as [BatchItem, ...BatchItem[]]));
      return { channelId: roomId, roomId };
    },

    /** 却下：申請を更新し、監査・通知を残す（1 batch）。チャンネルは作らない */
    async reject(
      request: RequestForDecision,
      reason: string,
      write: ChannelRequestWrite,
    ) {
      const now = new Date().toISOString();
      await runBatch(() =>
        db.batch([
          guardPending(db, request.id, request.version),
          db
            .update(channelCreationRequests)
            .set({
              status: "rejected",
              decidedBy: write.actorId,
              decidedAt: now,
              decisionReason: reason,
            })
            .where(eq(channelCreationRequests.id, request.id)),
          // 理由の本文は監査に入れない
          audit(write, "reject", request.id, {
            departmentId: request.departmentId,
            requestId: request.id,
          }),
          ...notificationInserts(
            db,
            request.requestedBy === write.actorId ? [] : [request.requestedBy],
            { kind: "channel_request.rejected", targetId: request.id },
          ),
        ]),
      );
    },

    /** 取り下げ：申請を更新し、監査を残す（1 batch）。通知は送らない */
    async withdraw(request: RequestForDecision, write: ChannelRequestWrite) {
      const now = new Date().toISOString();
      await runBatch(() =>
        db.batch([
          guardPending(db, request.id, request.version),
          db
            .update(channelCreationRequests)
            .set({
              status: "withdrawn",
              decidedBy: write.actorId,
              decidedAt: now,
            })
            .where(eq(channelCreationRequests.id, request.id)),
          audit(write, "withdraw", request.id, {
            departmentId: request.departmentId,
            requestId: request.id,
          }),
        ]),
      );
    },
  };
}

export type ChannelRequestRepository = ReturnType<
  typeof createChannelRequestRepository
>;

export function withChannelRequests<T>(
  env: Env,
  run: (
    repository: ChannelRequestRepository,
    roles: RoleAssignmentRepository,
  ) => Promise<T>,
): Promise<T> {
  return withDatabase(env, (db) =>
    run(createChannelRequestRepository(db), createRoleAssignmentRepository(db)),
  );
}
