// Repository：退職処理の申請（#128）の作成・一覧・却下・取り下げ。DB へのアクセスはこの層に閉じ込める。
// 1 操作＝1 つの db.batch で、申請の更新・監査・通知を一体で確定する。
// 前提の確認は batch の先頭の文（条件が崩れたら users.login_id を NULL にして NOT NULL 違反で batch 全体を失敗させる。#196 の方式）で行う。
// 同じ対象の申請中の申請（部分一意索引の違反）は RetirementRequestConflictError、前提の崩れは RetirementRequestStateChangedError にし、
// それ以外の DB エラーは変えずに再送出する（docs/project-rules.md「複数の文の db.batch で前提を確認する書き方」）。
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  departments,
  retirementRequests,
  userRoleAssignments,
  users,
} from "../../db/schema";
import { afterCursor, toPage, type CursorPayload } from "../lib/cursor";
import { ROLE_IDS } from "../lib/permissions";
import { isUlid, newUlid } from "../lib/ulid";
import { auditLogInsert } from "./audit-log.repository";
import { withDatabase, type Database } from "./database";
import { notificationInserts } from "./notification.repository";
import {
  createRoleAssignmentRepository,
  type RoleAssignmentRepository,
} from "./role-assignment.repository";

export type RetirementRequestStatus =
  "pending" | "approved" | "rejected" | "withdrawn";

/** 作成・却下・取り下げの前提（申請者・対象・操作者・申請の状態・通知の宛先）が、判定の後に崩れていたときに投げる。何も残らない */
export class RetirementRequestStateChangedError extends Error {
  constructor(options?: { cause?: unknown }) {
    super(
      "退職処理の申請の前提が変わったため、操作を実行できませんでした",
      options,
    );
    this.name = "RetirementRequestStateChangedError";
  }
}

export type RetirementRequestConflictReason = "duplicate_pending";

/** 同じ対象への申請中の申請がある（部分一意索引の違反）。何も残らない */
export class RetirementRequestConflictError extends Error {
  constructor(
    readonly reason: RetirementRequestConflictReason,
    options?: { cause?: unknown },
  ) {
    super("同じ社員への申請中の退職処理の申請があります", options);
    this.name = "RetirementRequestConflictError";
  }
}

/** 作成の判定に使う、対象の事実。ない社員は null */
export type RetirementTarget = {
  id: string;
  isActive: boolean;
  departmentId: string | null;
  isGlobalAdmin: boolean;
  isDepartmentOwner: boolean;
};

/** 却下・取り下げの判定に使う、申請の事実 */
export type RetirementRequestForDecision = {
  id: string;
  requestedBy: string;
  targetUserId: string;
  departmentId: string;
  status: RetirementRequestStatus;
};

export type RetirementRequestCreateInput = {
  targetUserId: string;
  /** 判定で読んだ対象の今の部署。batch の時点でも同じことを前提にする */
  departmentId: string;
  actorId: string;
  /** 申請が届いたことを知らせる全体管理者（申請者を除く）。batch の時点でも同じ顔ぶれであることを前提にする */
  reviewerIds: string[];
  now: string;
  traceId: string;
};

export type RetirementRequestRejectInput = {
  id: string;
  actorId: string;
  reason: string;
  now: string;
  traceId: string;
};

export type RetirementRequestWithdrawInput = {
  id: string;
  actorId: string;
  now: string;
  traceId: string;
};

type UserRef = { id: string; displayName: string };

export type MyRetirementRequestItem = {
  id: string;
  status: RetirementRequestStatus;
  target: UserRef;
  department: { id: string; name: string };
  decisionReason: string | null;
  createdAt: string;
  decidedAt: string | null;
};

export type RetirementRequestReviewItem = MyRetirementRequestItem & {
  requester: UserRef;
};

export type RetirementRequestListOptions = {
  limit: number;
  cursor?: CursorPayload;
};

// 前提の確認の文（assertRequestState）が崩れたときに NOT NULL 違反になる列
const STATE_ASSERT_COLUMN = "users.login_id";
// 同じ対象の申請中の申請の部分一意索引の列
const PENDING_UNIQUE_COLUMN = "retirement_requests.target_user_id";

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

/** 想定する違反（前提の崩れ・申請中の重複）だけを専用エラーにし、それ以外（未知のDBエラー）は変えずに返す */
function translateError(error: unknown): unknown {
  const constraint = constraintOf(error);
  if (constraint === null) return error;
  if (
    constraint.kind === "unique" &&
    constraint.target === PENDING_UNIQUE_COLUMN
  )
    return new RetirementRequestConflictError("duplicate_pending", {
      cause: error,
    });
  if (
    constraint.kind === "not_null" &&
    constraint.target === STATE_ASSERT_COLUMN
  )
    return new RetirementRequestStateChangedError({ cause: error });
  return error;
}

async function runBatch<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw translateError(error);
  }
}

/** 利用者が有効であること */
function isActiveUser(userId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM users u WHERE u.id = ${userId} AND u.is_active = 1)`;
}

/** 有効な、会社範囲の全体管理者（通知の宛先の読み取りと、batch の時点の確認で同じ条件を使う） */
const activeGlobalAdmins = sql`SELECT DISTINCT r.user_id FROM user_role_assignments r
  JOIN users u ON u.id = r.user_id
  WHERE r.role_id = ${ROLE_IDS.globalAdmin} AND r.scope_type = 'company' AND u.is_active = 1`;

/** 通知の宛先（申請者を除く全体管理者）が、読んだときと同じ顔ぶれであること */
function reviewersUnchanged(
  actorId: string,
  reviewerIds: readonly string[],
): SQL {
  const ids = [...new Set(reviewerIds)];
  const total = sql`(SELECT COUNT(*) FROM (${activeGlobalAdmins}) a WHERE a.user_id <> ${actorId}) = ${ids.length}`;
  if (ids.length === 0) return total;
  return sql`${total} AND (SELECT COUNT(*) FROM (${activeGlobalAdmins}) a
    WHERE a.user_id IN (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})) = ${ids.length}`;
}

/**
 * 条件が崩れていたら NOT NULL 違反で batch 全体を失敗させる文（login_id を、そのままか NULL にする）。
 * 指定した利用者の行（操作者と、対象または申請者）に当てる：どちらかの行がなくても、残った行で崩れを検出する。
 * account.repository.ts の同名の考え方の文とは、エラーの変換先が違うため共通化しない。
 */
function assertRequestState(
  db: Database,
  userIds: readonly string[],
  condition: SQL,
) {
  return db
    .update(users)
    .set({
      loginId: sql`CASE WHEN ${condition} THEN ${users.loginId} ELSE NULL END`,
    })
    .where(inArray(users.id, [...new Set(userIds)]));
}

function cursorFor(row: { id: string }) {
  if (!isUlid(row.id)) throw new Error("申請IDが不正です");
  return { v: row.id, id: row.id };
}

const targetUser = alias(users, "target_user");
const requesterUser = alias(users, "requester_user");

export function createRetirementRequestRepository(db: Database) {
  const audit = (
    input: { actorId: string; traceId: string },
    action: "create" | "reject" | "withdraw",
    requestId: string,
    detail: Record<string, string | null>,
  ) =>
    auditLogInsert(db, {
      actorId: input.actorId,
      action: `retirement_request.${action}`,
      targetType: "retirement_request",
      targetId: requestId,
      result: "success",
      traceId: input.traceId,
      detail,
    });

  /** 却下・取り下げの前に、申請者を読む（通知の宛先と前提の確認に使う）。申請がなければ前提の崩れとして扱う */
  async function readRequester(id: string): Promise<string> {
    const rows = await db
      .select({ requestedBy: retirementRequests.requestedBy })
      .from(retirementRequests)
      .where(eq(retirementRequests.id, id))
      .limit(1);
    const row = rows[0];
    if (row === undefined) throw new RetirementRequestStateChangedError();
    return row.requestedBy;
  }

  async function list(
    conditions: SQL[],
    options: RetirementRequestListOptions,
  ) {
    if (options.cursor !== undefined)
      conditions.push(
        afterCursor(
          { sort: retirementRequests.id, id: retirementRequests.id },
          options.cursor,
          "desc",
        ),
      );
    const rows = await db
      .select({
        id: retirementRequests.id,
        status: retirementRequests.status,
        targetId: targetUser.id,
        targetDisplayName: targetUser.displayName,
        departmentId: departments.id,
        departmentName: departments.name,
        requesterId: requesterUser.id,
        requesterDisplayName: requesterUser.displayName,
        decisionReason: retirementRequests.decisionReason,
        createdAt: retirementRequests.createdAt,
        decidedAt: retirementRequests.decidedAt,
      })
      .from(retirementRequests)
      .innerJoin(targetUser, eq(targetUser.id, retirementRequests.targetUserId))
      .innerJoin(
        requesterUser,
        eq(requesterUser.id, retirementRequests.requestedBy),
      )
      .innerJoin(
        departments,
        eq(departments.id, retirementRequests.departmentId),
      )
      .where(and(...conditions))
      .orderBy(desc(retirementRequests.id))
      .limit(options.limit + 1);
    const page = toPage(rows, options.limit, cursorFor);
    const items: RetirementRequestReviewItem[] = page.items.map((row) => ({
      id: row.id,
      status: row.status,
      target: { id: row.targetId, displayName: row.targetDisplayName },
      department: { id: row.departmentId, name: row.departmentName },
      requester: { id: row.requesterId, displayName: row.requesterDisplayName },
      decisionReason: row.decisionReason,
      createdAt: row.createdAt,
      decidedAt: row.decidedAt,
    }));
    return { items, nextCursor: page.nextCursor };
  }

  return {
    /** 作成の判定に使う、対象の事実。ない社員は null */
    async findTarget(id: string): Promise<RetirementTarget | null> {
      const rows = await db
        .select({
          id: users.id,
          isActive: users.isActive,
          departmentId: users.departmentId,
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
        departmentId: row.departmentId,
        isGlobalAdmin: row.isGlobalAdmin === 1,
        isDepartmentOwner: row.isDepartmentOwner === 1,
      };
    },

    /** 申請が届いたことを知らせる宛先：有効な、会社範囲の全体管理者 */
    async findGlobalAdminIds(): Promise<string[]> {
      const rows = await db
        .selectDistinct({ userId: userRoleAssignments.userId })
        .from(userRoleAssignments)
        .innerJoin(users, eq(users.id, userRoleAssignments.userId))
        .where(
          and(
            eq(userRoleAssignments.roleId, ROLE_IDS.globalAdmin),
            eq(userRoleAssignments.scopeType, "company"),
            eq(users.isActive, true),
          ),
        )
        .orderBy(userRoleAssignments.userId);
      return rows.map((row) => row.userId);
    },

    /** 却下・取り下げの前に、申請の事実を読む。存在しなければ null */
    async findForDecision(
      id: string,
    ): Promise<RetirementRequestForDecision | null> {
      const rows = await db
        .select({
          id: retirementRequests.id,
          requestedBy: retirementRequests.requestedBy,
          targetUserId: retirementRequests.targetUserId,
          departmentId: retirementRequests.departmentId,
          status: retirementRequests.status,
        })
        .from(retirementRequests)
        .where(eq(retirementRequests.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    /**
     * 作成：申請・監査1件・全体管理者への通知を1つの batch で確定する。対象の所属・状態・ロールには触れない。
     * 前提が崩れていたら RetirementRequestStateChangedError、同じ対象の申請中の申請があれば RetirementRequestConflictError で、何も残さない。
     */
    async create(input: RetirementRequestCreateInput): Promise<{ id: string }> {
      const id = newUlid();
      const condition = sql`${input.actorId} <> ${input.targetUserId}
        AND EXISTS (SELECT 1 FROM users t
          WHERE t.id = ${input.targetUserId} AND t.is_active = 1 AND t.department_id = ${input.departmentId})
        AND NOT EXISTS (SELECT 1 FROM user_role_assignments r
          WHERE r.user_id = ${input.targetUserId} AND r.role_id IN (${ROLE_IDS.globalAdmin}, ${ROLE_IDS.owner}))
        AND ${isActiveUser(input.actorId)}
        AND EXISTS (SELECT 1 FROM user_role_assignments r
          WHERE r.user_id = ${input.actorId} AND r.role_id = ${ROLE_IDS.owner}
            AND r.scope_type = 'department' AND r.department_id = ${input.departmentId})
        AND ${reviewersUnchanged(input.actorId, input.reviewerIds)}`;
      await runBatch(() =>
        db.batch([
          assertRequestState(
            db,
            [input.targetUserId, input.actorId],
            condition,
          ),
          db.insert(retirementRequests).values({
            id,
            targetUserId: input.targetUserId,
            requestedBy: input.actorId,
            departmentId: input.departmentId,
            status: "pending",
            createdAt: input.now,
            updatedAt: input.now,
          }),
          audit(input, "create", id, {
            targetUserId: input.targetUserId,
            departmentId: input.departmentId,
          }),
          ...notificationInserts(db, input.reviewerIds, {
            kind: "retirement_request.submitted",
            targetId: id,
          }),
        ]),
      );
      return { id };
    },

    /** 申請者本人の申請を新しい順に読む */
    async listMine(requesterId: string, options: RetirementRequestListOptions) {
      const page = await list(
        [eq(retirementRequests.requestedBy, requesterId)],
        options,
      );
      return {
        // 申請者は本人のため、応答に含めない
        items: page.items.map((item): MyRetirementRequestItem => ({
          id: item.id,
          status: item.status,
          target: item.target,
          department: item.department,
          decisionReason: item.decisionReason,
          createdAt: item.createdAt,
          decidedAt: item.decidedAt,
        })),
        nextCursor: page.nextCursor,
      };
    },

    /** 全体管理者の一覧：すべての申請を新しい順に読む（状態で絞り込める） */
    async listForReview(
      options: RetirementRequestListOptions & {
        status?: RetirementRequestStatus;
      },
    ) {
      return list(
        options.status === undefined
          ? []
          : [eq(retirementRequests.status, options.status)],
        options,
      );
    },

    /**
     * 却下：申請を更新し、申請者への通知（決裁者が申請者本人なら送らない）と監査1件を1つの batch で確定する。理由の文は監査に入れない。
     * 前提（申請中・操作者が有効な会社範囲の全体管理者）が崩れていたら RetirementRequestStateChangedError で、何も残さない。
     */
    async reject(input: RetirementRequestRejectInput): Promise<void> {
      const requestedBy = await readRequester(input.id);
      const condition = sql`EXISTS (SELECT 1 FROM retirement_requests q
          WHERE q.id = ${input.id} AND q.status = 'pending' AND q.requested_by = ${requestedBy})
        AND ${isActiveUser(input.actorId)}
        AND EXISTS (SELECT 1 FROM user_role_assignments r
          WHERE r.user_id = ${input.actorId} AND r.role_id = ${ROLE_IDS.globalAdmin} AND r.scope_type = 'company')`;
      await runBatch(() =>
        db.batch([
          assertRequestState(db, [input.actorId, requestedBy], condition),
          db
            .update(retirementRequests)
            .set({
              status: "rejected",
              decisionReason: input.reason,
              decidedBy: input.actorId,
              decidedAt: input.now,
              updatedAt: input.now,
            })
            .where(eq(retirementRequests.id, input.id)),
          audit(input, "reject", input.id, { requestedBy }),
          ...notificationInserts(
            db,
            requestedBy === input.actorId ? [] : [requestedBy],
            { kind: "retirement_request.rejected", targetId: input.id },
          ),
        ]),
      );
    },

    /**
     * 取り下げ：申請者本人が申請を終える。決裁者＝申請者。通知しない。監査1件を同じ batch に。
     * 申請者が今もその部署のオーナーであることは前提にしない（異動・交代の後に残った申請を整理できるようにする）。
     */
    async withdraw(input: RetirementRequestWithdrawInput): Promise<void> {
      const requestedBy = await readRequester(input.id);
      const condition = sql`${requestedBy} = ${input.actorId}
        AND EXISTS (SELECT 1 FROM retirement_requests q
          WHERE q.id = ${input.id} AND q.status = 'pending' AND q.requested_by = ${input.actorId})
        AND ${isActiveUser(input.actorId)}`;
      await runBatch(() =>
        db.batch([
          assertRequestState(db, [input.actorId, requestedBy], condition),
          db
            .update(retirementRequests)
            .set({
              status: "withdrawn",
              decidedBy: input.actorId,
              decidedAt: input.now,
              updatedAt: input.now,
            })
            .where(eq(retirementRequests.id, input.id)),
          audit(input, "withdraw", input.id, { requestedBy }),
        ]),
      );
    },
  };
}

export type RetirementRequestRepository = ReturnType<
  typeof createRetirementRequestRepository
>;

/** Repository を使う間だけ DB につなぐ。権限の Repository（認可用）も一緒に渡す */
export function withRetirementRequests<T>(
  env: Env,
  run: (
    repository: RetirementRequestRepository,
    roles: RoleAssignmentRepository,
  ) => Promise<T>,
): Promise<T> {
  return withDatabase(env, (db) =>
    run(
      createRetirementRequestRepository(db),
      createRoleAssignmentRepository(db),
    ),
  );
}
