// Repository：アカウントの個別発行と管理者用の一覧（DB へのアクセスはこの層に閉じ込める）。
// 利用者の追加と監査ログは、同じ db.batch で確定する（片方が失敗したら、どちらも残さない）。
// 無効化・再有効化・部署異動（#128）は、batch の先頭の assertStatement で前提を確かめ、崩れていれば NOT NULL 違反で batch 全体を取り消す（#196 の方式）。
import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import {
  caseCreationRequests,
  channelMembers,
  departments,
  retirementRequests,
  sessions,
  userRoleAssignments,
  users,
} from "../../db/schema";
import { afterCursor, toPage, type CursorPayload } from "../lib/cursor";
import { ROLE_IDS } from "../lib/permissions";
import { isUlid } from "../lib/ulid";
import { auditLogInsert } from "./audit-log.repository";
import { withDatabase, type Database } from "./database";
import { notificationInserts } from "./notification.repository";
import {
  createRoleAssignmentRepository,
  type RoleAssignmentRepository,
} from "./role-assignment.repository";

export type AccountCreateInput = {
  id: string;
  loginId: string;
  displayName: string;
  /** 暗号化した本名 */
  legalNameEncrypted: string;
  email: string;
  departmentId: string;
  extension: string | null;
  jobTitle: string | null;
  /** ハッシュにした初期パスワード */
  passwordHash: string;
  /** 発行した管理者（メールを確認した人として保存する） */
  actorId: string;
  /** 発行の日時（created_at と email_verified_at に同じ値を入れる） */
  now: string;
  traceId: string;
};

export type DepartmentOption = { id: string; name: string };

export type AccountListItem = {
  id: string;
  loginId: string;
  displayName: string;
  department: DepartmentOption | null;
  email: string;
  extension: string | null;
  jobTitle: string | null;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
};

export type AccountListOptions = { limit: number; cursor?: CursorPayload };

export type AccountConflictReason = "login_id" | "email";

/** ユーザーID・メールの一意の制約に違反したときに投げる（値は持たない） */
export class AccountConflictError extends Error {
  constructor(
    readonly reason: AccountConflictReason,
    options?: { cause?: unknown },
  ) {
    super("アカウントの内容が、すでにあるデータと競合しました", options);
    this.name = "AccountConflictError";
  }
}

// 一意の制約に違反した列（D1 のメッセージ "UNIQUE constraint failed: <表>.<列>"）→ 競合の理由
const CONFLICT_BY_COLUMN: Record<string, AccountConflictReason> = {
  "users.login_id_normalized": "login_id",
  "users.email_normalized": "email",
};

/** 全社連絡がない（またはアーカイブ済み）ため、発行できないときに投げる。何も残らない */
export class CompanyGeneralChannelMissingError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("全社連絡のチャンネルがありません", options);
    this.name = "CompanyGeneralChannelMissingError";
  }
}

// 全社連絡の確認の文（users の挿入の直後）が崩れたときに NOT NULL 違反になる列
const COMPANY_GENERAL_ASSERT_COLUMN = "users.display_name";

/** 無効化・再有効化・異動の前提（対象・操作者・部署の状態）が、判定の後に崩れていたときに投げる。何も残らない */
export class AccountStateChangedError extends Error {
  constructor(options?: { cause?: unknown }) {
    super(
      "アカウントの状態が変わったため、操作を実行できませんでした",
      options,
    );
    this.name = "AccountStateChangedError";
  }
}

// 無効化・再有効化・異動の前提の確認の文（assertStatement）が崩れたときに NOT NULL 違反になる列
const ACCOUNT_STATE_ASSERT_COLUMN = "users.login_id";

export type AccountState = {
  id: string;
  isActive: boolean;
  isGlobalAdmin: boolean;
  isDepartmentOwner: boolean;
};

export type AccountDeactivateInput = {
  targetId: string;
  actorId: string;
  now: string;
  traceId: string;
};

export type AccountReactivateInput = {
  targetId: string;
  departmentId: string;
  /** ハッシュにした一時パスワード */
  passwordHash: string;
  actorId: string;
  now: string;
  traceId: string;
};

/** 異動の判定に使う、対象の事実。ownedDepartmentIds はオーナーの割り当ての部署 */
export type AccountTransferState = {
  id: string;
  isActive: boolean;
  departmentId: string | null;
  ownedDepartmentIds: string[];
};

export type AccountTransferInput = {
  targetId: string;
  /** 判定で読んだ今の所属。batch の時点でも同じことを前提にする */
  fromDepartmentId: string;
  toDepartmentId: string;
  actorId: string;
  now: string;
  traceId: string;
};

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

/** 一意の制約・全社連絡の確認の失敗だけを専用エラーにし、それ以外（未知のDBエラー）は変えずに返す */
function translateError(error: unknown): unknown {
  const constraint = constraintOf(error);
  if (constraint === null) return error;
  if (constraint.kind === "unique") {
    const reason = CONFLICT_BY_COLUMN[constraint.target];
    return reason === undefined
      ? error
      : new AccountConflictError(reason, { cause: error });
  }
  if (constraint.target === COMPANY_GENERAL_ASSERT_COLUMN)
    return new CompanyGeneralChannelMissingError({ cause: error });
  return constraint.target === ACCOUNT_STATE_ASSERT_COLUMN
    ? new AccountStateChangedError({ cause: error })
    : error;
}

/** 操作者が有効で、会社範囲の全体管理者であること（引き継ぎの後の前任者・無効になった操作者を拒否する） */
function actorIsGlobalAdmin(actorId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM users a WHERE a.id = ${actorId} AND a.is_active = 1)
    AND EXISTS (SELECT 1 FROM user_role_assignments r
      WHERE r.user_id = ${actorId} AND r.role_id = ${ROLE_IDS.globalAdmin} AND r.scope_type = 'company')`;
}

/**
 * 申請者の無効化・異動による、案件の作成申請の自動取消（#146・5-3 AC-8）。無効化と異動で同じ知識をここにまとめる。
 * readPendingCaseRequests：batch の前に、対象が申請者の審査中の申請の件数と、対象が全体管理者かを読む（監査の detail を JS で作るため）。
 * 読んだ値が batch の時点でも同じことを、caseRequestsUnchangedSql として前提の条件（assertStatement）に入れる。
 */
async function readPendingCaseRequests(db: Database, targetId: string) {
  const rows = await db
    .select({
      n: sql<number>`(SELECT COUNT(*) FROM case_creation_requests c
        WHERE c.requested_by = ${targetId} AND c.status = 'pending')`,
      isGlobalAdmin: sql<number>`EXISTS (SELECT 1 FROM user_role_assignments r
        WHERE r.user_id = ${targetId} AND r.role_id = ${ROLE_IDS.globalAdmin} AND r.scope_type = 'company')`,
    })
    .from(users)
    .where(eq(users.id, targetId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) throw new AccountStateChangedError();
  return { pendingCount: row.n, isGlobalAdmin: row.isGlobalAdmin === 1 };
}

function caseRequestsUnchangedSql(
  targetId: string,
  read: { pendingCount: number; isGlobalAdmin: boolean },
): SQL {
  return sql`(SELECT COUNT(*) FROM case_creation_requests c
      WHERE c.requested_by = ${targetId} AND c.status = 'pending') = ${read.pendingCount}
    AND EXISTS (SELECT 1 FROM user_role_assignments r
      WHERE r.user_id = ${targetId} AND r.role_id = ${ROLE_IDS.globalAdmin} AND r.scope_type = 'company') = ${read.isGlobalAdmin ? 1 : 0}`;
}

/** 対象の審査中の申請を auto_cancelled にする文（全体管理者は対象外）。申請ごとの監査・通知は作らない */
function autoCancelCaseRequests(
  db: Database,
  input: { targetId: string; actorId: string; now: string },
) {
  return db
    .update(caseCreationRequests)
    .set({
      status: "auto_cancelled",
      version: sql`${caseCreationRequests.version} + 1`,
      decidedBy: input.actorId,
      decidedAt: input.now,
    })
    .where(
      and(
        eq(caseCreationRequests.requestedBy, input.targetId),
        eq(caseCreationRequests.status, "pending"),
        sql`NOT EXISTS (SELECT 1 FROM user_role_assignments r
          WHERE r.user_id = ${input.targetId} AND r.role_id = ${ROLE_IDS.globalAdmin} AND r.scope_type = 'company')`,
      ),
    );
}

/** 監査の detail に入れる、取り消した件数（全体管理者は取り消さないので 0） */
const cancelledCountOf = (read: {
  pendingCount: number;
  isGlobalAdmin: boolean;
}) => (read.isGlobalAdmin ? 0 : read.pendingCount);

/**
 * 条件が崩れていたら NOT NULL 違反で batch 全体を失敗させる文（login_id を、そのままか NULL にする）。
 * 対象と操作者の両方の行に当てる：どちらかの行がなくても、残った行で条件の崩れを検出する。
 * 部署の版を使う department.repository.ts の関数とは対象の表が違うため、共通化しない。
 */
function assertStatement(
  db: Database,
  input: { targetId: string; actorId: string },
  condition: SQL,
) {
  return db
    .update(users)
    .set({
      loginId: sql`CASE WHEN ${condition} THEN ${users.loginId} ELSE NULL END`,
    })
    .where(inArray(users.id, [input.targetId, input.actorId]));
}

/** 全社連絡と、所属部署の専用チャンネル2つ（department・announcement）に参加させる文。専用チャンネルがない部署でも成功する */
function joinInitialChannels(
  db: Database,
  input: { userId: string; departmentId: string; now: string },
) {
  return db.insert(channelMembers).select(sql`
    SELECT c.room_id, ${input.userId}, ${input.now} FROM channels c
    WHERE c.deleted_at IS NULL
      AND (c.purpose = 'company_general'
        OR (c.department_id = ${input.departmentId} AND c.purpose IN ('department', 'announcement')))`);
}

function cursorFor(row: { id: string; loginIdNormalized: string }) {
  if (!isUlid(row.id)) throw new Error("利用者IDが不正です");
  return { v: row.loginIdNormalized, id: row.id };
}

export function createAccountRepository(db: Database) {
  return {
    async findActiveDepartment(id: string): Promise<DepartmentOption | null> {
      const rows = await db
        .select({ id: departments.id, name: departments.name })
        .from(departments)
        .where(and(eq(departments.id, id), eq(departments.isActive, true)))
        .limit(1);
      return rows[0] ?? null;
    },
    // 部署の候補の読み取りだけを持つ。部署の管理（#196）の Repository ができたら、そちらへ統合する
    async listActiveDepartments(): Promise<DepartmentOption[]> {
      return db
        .select({ id: departments.id, name: departments.name })
        .from(departments)
        .where(eq(departments.isActive, true))
        .orderBy(asc(departments.name), asc(departments.id));
    },
    async createAccount(input: AccountCreateInput): Promise<void> {
      try {
        await db.batch([
          db.insert(users).values({
            id: input.id,
            loginId: input.loginId,
            loginIdNormalized: input.loginId.toLowerCase(),
            displayName: input.displayName,
            legalName: input.legalNameEncrypted,
            email: input.email,
            emailNormalized: input.email.toLowerCase(),
            emailVerifiedBy: input.actorId,
            emailVerifiedAt: input.now,
            departmentId: input.departmentId,
            extension: input.extension,
            jobTitle: input.jobTitle,
            passwordHash: input.passwordHash,
            mustChangePassword: true,
            createdAt: input.now,
          }),
          // 全社連絡がなければ NOT NULL 違反で batch 全体を失敗させる（下の参加の文と同じ条件）
          db
            .update(users)
            .set({
              displayName: sql`CASE WHEN EXISTS (SELECT 1 FROM channels WHERE purpose = 'company_general' AND deleted_at IS NULL) THEN ${users.displayName} ELSE NULL END`,
            })
            .where(eq(users.id, input.id)),
          joinInitialChannels(db, {
            userId: input.id,
            departmentId: input.departmentId,
            now: input.now,
          }),
          auditLogInsert(db, {
            actorId: input.actorId,
            action: "account.create",
            targetType: "user",
            targetId: input.id,
            result: "success",
            traceId: input.traceId,
            detail: {
              departmentId: input.departmentId,
              emailVerification: "admin",
            },
          }),
        ]);
      } catch (error) {
        throw translateError(error);
      }
    },
    /** 無効化・再有効化の判定に使う、対象の事実。ない社員は null */
    async findAccountState(id: string): Promise<AccountState | null> {
      const rows = await db
        .select({
          id: users.id,
          isActive: users.isActive,
          isGlobalAdmin: sql<number>`EXISTS (SELECT 1 FROM user_role_assignments r WHERE r.user_id = ${id} AND r.role_id = ${ROLE_IDS.globalAdmin})`,
          isDepartmentOwner: sql<number>`EXISTS (SELECT 1 FROM user_role_assignments r WHERE r.user_id = ${id} AND r.role_id = ${ROLE_IDS.owner})`,
        })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      const row = rows[0];
      if (row === undefined) return null;
      return {
        id: row.id,
        isActive: row.isActive,
        isGlobalAdmin: row.isGlobalAdmin === 1,
        isDepartmentOwner: row.isDepartmentOwner === 1,
      };
    },
    /**
     * 無効化：状態・所属・全チャンネルの参加・追加ロール・セッションの失効・監査1件を1つの batch で確定する。
     * DM の参加・既読・投稿には触れない。前提が崩れていたら AccountStateChangedError で、何も残さない。
     */
    async deactivate(input: AccountDeactivateInput): Promise<void> {
      // 監査の detail（元の部署）を読む。読んだ値が batch の時点でも同じことを、前提の条件に含める
      const rows = await db
        .select({ departmentId: users.departmentId })
        .from(users)
        .where(eq(users.id, input.targetId))
        .limit(1);
      const target = rows[0];
      if (target === undefined) throw new AccountStateChangedError();
      const fromDepartmentId = target.departmentId;
      // 対象への申請中の退職処理の申請（あれば完了にし、申請者へ知らせる。#128）。監査の detail と通知の宛先に使うため batch の外で読み、
      // 読んだ申請が batch の時点でも同じ（なかったなら、今もない）ことを前提の条件に含める
      const pendingRows = await db
        .select({
          id: retirementRequests.id,
          requestedBy: retirementRequests.requestedBy,
        })
        .from(retirementRequests)
        .where(
          and(
            eq(retirementRequests.targetUserId, input.targetId),
            eq(retirementRequests.status, "pending"),
          ),
        )
        .limit(1);
      const pending = pendingRows[0] ?? null;
      const caseRequests = await readPendingCaseRequests(db, input.targetId);
      const condition = sql`${input.actorId} <> ${input.targetId}
        AND (SELECT q.id FROM retirement_requests q
          WHERE q.target_user_id = ${input.targetId} AND q.status = 'pending') IS ${pending?.id ?? null}
        AND EXISTS (SELECT 1 FROM users t
          WHERE t.id = ${input.targetId} AND t.is_active = 1 AND t.department_id IS ${fromDepartmentId})
        AND NOT EXISTS (SELECT 1 FROM user_role_assignments r
          WHERE r.user_id = ${input.targetId} AND r.role_id IN (${ROLE_IDS.globalAdmin}, ${ROLE_IDS.owner}))
        AND ${caseRequestsUnchangedSql(input.targetId, caseRequests)}
        AND ${actorIsGlobalAdmin(input.actorId)}`;
      try {
        await db.batch([
          assertStatement(db, input, condition),
          autoCancelCaseRequests(db, input),
          db
            .update(users)
            .set({
              isActive: false,
              deactivatedAt: input.now,
              departmentId: null,
            })
            .where(eq(users.id, input.targetId)),
          db
            .delete(channelMembers)
            .where(eq(channelMembers.userId, input.targetId)),
          db
            .delete(userRoleAssignments)
            .where(eq(userRoleAssignments.userId, input.targetId)),
          db
            .update(sessions)
            .set({ revokedAt: input.now })
            .where(
              and(
                eq(sessions.userId, input.targetId),
                isNull(sessions.revokedAt),
              ),
            ),
          // 申請を通さない直接の無効化でも、申請中の申請は完了にする（異動・オーナーの交代では残す）
          db
            .update(retirementRequests)
            .set({
              status: "approved",
              decidedBy: input.actorId,
              decidedAt: input.now,
              updatedAt: input.now,
            })
            .where(
              and(
                eq(retirementRequests.targetUserId, input.targetId),
                eq(retirementRequests.status, "pending"),
              ),
            ),
          ...notificationInserts(
            db,
            pending === null ? [] : [pending.requestedBy],
            {
              kind: "retirement_request.approved",
              targetId: pending?.id ?? null,
            },
          ),
          auditLogInsert(db, {
            actorId: input.actorId,
            action: "account.deactivate",
            targetType: "user",
            targetId: input.targetId,
            result: "success",
            traceId: input.traceId,
            detail: {
              fromDepartmentId,
              retirementRequestId: pending?.id ?? null,
              cancelledCaseRequestCount: cancelledCountOf(caseRequests),
            },
          }),
        ]);
      } catch (error) {
        throw translateError(error);
      }
    },
    /**
     * 再有効化：同じ ID で有効に戻し、指定の部署に所属させ、全社連絡と部署の専用チャンネルに参加させる。
     * ロール・個別のチャンネルは戻さない。パスワードを置き換え、変更を求める。前提が崩れていたら AccountStateChangedError。
     */
    async reactivate(input: AccountReactivateInput): Promise<void> {
      const condition = sql`EXISTS (SELECT 1 FROM users t WHERE t.id = ${input.targetId} AND t.is_active = 0)
        AND EXISTS (SELECT 1 FROM departments d WHERE d.id = ${input.departmentId} AND d.is_active = 1)
        AND ${actorIsGlobalAdmin(input.actorId)}`;
      try {
        await db.batch([
          assertStatement(db, input, condition),
          db
            .update(users)
            .set({
              isActive: true,
              deactivatedAt: null,
              departmentId: input.departmentId,
              passwordHash: input.passwordHash,
              mustChangePassword: true,
            })
            .where(eq(users.id, input.targetId)),
          // 無効な間に紛れ込んだ参加の行を残さない（DM の参加は別の表のため触れない）
          db
            .delete(channelMembers)
            .where(eq(channelMembers.userId, input.targetId)),
          joinInitialChannels(db, {
            userId: input.targetId,
            departmentId: input.departmentId,
            now: input.now,
          }),
          auditLogInsert(db, {
            actorId: input.actorId,
            action: "account.reactivate",
            targetType: "user",
            targetId: input.targetId,
            result: "success",
            traceId: input.traceId,
            detail: { departmentId: input.departmentId },
          }),
        ]);
      } catch (error) {
        throw translateError(error);
      }
    },
    /** 異動の判定に使う、対象の事実。ない社員は null */
    async findTransferState(id: string): Promise<AccountTransferState | null> {
      const rows = await db
        .select({
          id: users.id,
          isActive: users.isActive,
          departmentId: users.departmentId,
        })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      const row = rows[0];
      if (row === undefined) return null;
      const owned = await db
        .select({ departmentId: userRoleAssignments.departmentId })
        .from(userRoleAssignments)
        .where(
          and(
            eq(userRoleAssignments.userId, id),
            eq(userRoleAssignments.roleId, ROLE_IDS.owner),
          ),
        )
        .orderBy(asc(userRoleAssignments.departmentId));
      return {
        id: row.id,
        isActive: row.isActive,
        departmentId: row.departmentId,
        ownedDepartmentIds: owned.flatMap((r) =>
          r.departmentId === null ? [] : [r.departmentId],
        ),
      };
    },
    /**
     * 部署異動：所属・旧部署の専用チャンネル2つの参加の削除・新部署の専用チャンネル2つへの参加・監査1件を1つの batch で確定する。
     * 全社連絡・個別のチャンネル・DM・ロール・セッションには触れない。前提が崩れていたら AccountStateChangedError で、何も残さない。
     */
    async transfer(input: AccountTransferInput): Promise<void> {
      // 監査の detail（AC-16 の権限）に使う、対象の割り当ての役割。auditLogInsert は detail を JS で文字列にするため、batch の外で読む。
      // 異動はロールを変えないので、ずれるのは別の操作が同時にロールを変えた場合だけ。監査の値は判定の時点のもの
      const roleRows = await db
        .selectDistinct({ roleId: userRoleAssignments.roleId })
        .from(userRoleAssignments)
        .where(eq(userRoleAssignments.userId, input.targetId))
        .orderBy(asc(userRoleAssignments.roleId));
      const caseRequests = await readPendingCaseRequests(db, input.targetId);
      const condition = sql`${input.fromDepartmentId} <> ${input.toDepartmentId}
        AND EXISTS (SELECT 1 FROM users t
          WHERE t.id = ${input.targetId} AND t.is_active = 1 AND t.department_id = ${input.fromDepartmentId})
        AND NOT EXISTS (SELECT 1 FROM user_role_assignments r
          WHERE r.user_id = ${input.targetId} AND r.role_id = ${ROLE_IDS.owner} AND r.department_id = ${input.fromDepartmentId})
        AND EXISTS (SELECT 1 FROM departments d WHERE d.id = ${input.toDepartmentId} AND d.is_active = 1)
        AND ${caseRequestsUnchangedSql(input.targetId, caseRequests)}
        AND ${actorIsGlobalAdmin(input.actorId)}`;
      try {
        await db.batch([
          assertStatement(db, input, condition),
          autoCancelCaseRequests(db, input),
          db
            .update(users)
            .set({ departmentId: input.toDepartmentId })
            .where(eq(users.id, input.targetId)),
          db.delete(channelMembers).where(
            and(
              eq(channelMembers.userId, input.targetId),
              sql`${channelMembers.channelId} IN (SELECT c.room_id FROM channels c
                WHERE c.department_id = ${input.fromDepartmentId} AND c.purpose IN ('department', 'announcement'))`,
            ),
          ),
          db.insert(channelMembers).select(sql`
            SELECT c.room_id, ${input.targetId}, ${input.now} FROM channels c
            WHERE c.deleted_at IS NULL
              AND c.department_id = ${input.toDepartmentId} AND c.purpose IN ('department', 'announcement')
              AND NOT EXISTS (SELECT 1 FROM channel_members m
                WHERE m.channel_id = c.room_id AND m.user_id = ${input.targetId})`),
          auditLogInsert(db, {
            actorId: input.actorId,
            action: "account.transfer",
            targetType: "user",
            targetId: input.targetId,
            result: "success",
            traceId: input.traceId,
            detail: {
              fromDepartmentId: input.fromDepartmentId,
              toDepartmentId: input.toDepartmentId,
              // 監査の detail は入れ子にしない決まり（C-177）のため、昇順の役割IDを「,」で区切った文字列にする
              roleIds: roleRows.map((r) => r.roleId).join(","),
              cancelledCaseRequestCount: cancelledCountOf(caseRequests),
            },
          }),
        ]);
      } catch (error) {
        throw translateError(error);
      }
    },
    // 本名は読まない（一覧に含めない）
    async listAdmin(options: AccountListOptions) {
      const rows = await db
        .select({
          id: users.id,
          loginId: users.loginId,
          loginIdNormalized: users.loginIdNormalized,
          displayName: users.displayName,
          departmentId: departments.id,
          departmentName: departments.name,
          email: users.email,
          extension: users.extension,
          jobTitle: users.jobTitle,
          active: users.isActive,
          mustChangePassword: users.mustChangePassword,
          createdAt: users.createdAt,
        })
        .from(users)
        .leftJoin(departments, eq(users.departmentId, departments.id))
        .where(
          options.cursor === undefined
            ? undefined
            : afterCursor(
                { sort: users.loginIdNormalized, id: users.id },
                options.cursor,
                "asc",
              ),
        )
        .orderBy(asc(users.loginIdNormalized), asc(users.id))
        .limit(options.limit + 1);
      const page = toPage(rows, options.limit, cursorFor);
      const items: AccountListItem[] = page.items.map((row) => ({
        id: row.id,
        loginId: row.loginId,
        displayName: row.displayName,
        department:
          row.departmentId === null || row.departmentName === null
            ? null
            : { id: row.departmentId, name: row.departmentName },
        email: row.email,
        extension: row.extension,
        jobTitle: row.jobTitle,
        active: row.active,
        mustChangePassword: row.mustChangePassword,
        createdAt: row.createdAt,
      }));
      return { items, nextCursor: page.nextCursor };
    },
  };
}

export type AccountRepository = ReturnType<typeof createAccountRepository>;

/** Repository を使う間だけ DB につなぐ。権限の Repository（認可用）も一緒に渡す */
export function withAccounts<T>(
  env: Env,
  run: (
    repository: AccountRepository,
    roles: RoleAssignmentRepository,
  ) => Promise<T>,
): Promise<T> {
  return withDatabase(env, (db) =>
    run(createAccountRepository(db), createRoleAssignmentRepository(db)),
  );
}
