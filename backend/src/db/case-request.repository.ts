// Repository：案件の作成申請（#146 の 146-A）の申請・自分の申請・取り下げ・類似件名の確認。DB へのアクセスはこの層に閉じ込める。
// 1 操作＝1 つの db.batch で、申請・担当部署・候補・監査・通知を一体で確定する（途中の文が失敗したら全体が取り消される）。
// 最初の判定（Service）で確かめた DB の状態は、batch の中でも CASE WHEN … ELSE NULL で確かめ直し、崩れていれば NOT NULL 違反で
// batch 全体を失敗させる。失敗は制約の表と列で専用エラーに変換し、未知の DB エラーは握りつぶさずそのまま再送出する。
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import {
  caseCreationRequestCandidates,
  caseCreationRequestDepartments,
  caseCreationRequests,
  clients,
  departments,
  userRoleAssignments,
  users,
} from "../../db/schema";
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

export type CaseRequestStatus =
  "pending" | "approved" | "rejected" | "withdrawn" | "auto_cancelled";

export type CaseRequestWriteReason =
  /** 取引先が存在しない・無効 */
  | "client_unavailable"
  /** 担当部署のどれかが存在しない・無効 */
  | "department_unavailable"
  /** 候補のどれかが存在しない・無効 */
  | "candidate_unavailable"
  /** 再申請の元が、本人の却下済み・取り下げ済みの申請でない */
  | "resubmit_unavailable"
  /** 申請者が無効、または所属がなく全体管理者でもない */
  | "requester_ineligible"
  /** 通知の宛先が、読んだときと変わった */
  | "recipients_changed"
  /** 取り下げ：すでに審査中でない（または、読んだ後に他の操作が先に確定した） */
  | "decided"
  /** 取り下げ：本人の申請の行がない */
  | "not_found";

/** 書き込みの前提が成り立たない。batch 全体が取り消されている */
export class CaseRequestWriteError extends Error {
  constructor(
    readonly reason: CaseRequestWriteReason,
    options?: { cause?: unknown },
  ) {
    super("案件の作成申請の前提が成り立ちません", options);
    this.name = "CaseRequestWriteError";
  }
}

export type CaseRequestItem = {
  id: string;
  title: string;
  description: string;
  dueDate: string | null;
  client: { id: string; code: string; name: string; isActive: boolean };
  departments: { id: string; name: string; isActive: boolean }[];
  candidates: { userId: string; displayName: string }[];
  status: CaseRequestStatus;
  rejectReason: string | null;
  caseId: string | null;
  resubmittedFrom: string | null;
  createdAt: string;
  decidedAt: string | null;
};

export type CreateCaseRequestInput = {
  requesterId: string;
  clientId: string;
  /** 整形済みの件名 */
  title: string;
  description: string;
  dueDate: string | null;
  departmentIds: string[];
  candidateIds: string[];
  resubmitOf: string | null;
  /** 読んだときの通知の宛先（Q3 で決めたもの）。batch の中で、いまの割り当てから求めた宛先と同じかを確かめる */
  recipientIds: string[];
  now: string;
  traceId: string;
};

export type WithdrawCaseRequestInput = {
  requestId: string;
  requesterId: string;
  version: number;
  now: string;
  traceId: string;
};

type Operation = "create" | "withdraw";

function notNullTargetOf(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const match = /NOT NULL constraint failed: ([\w.]+)/i.exec(current.message);
    if (match !== null) return match[1] ?? "";
    current = current.cause;
  }
  return null;
}

/** 想定する制約の違反だけを専用エラーにし、それ以外（未知の DB エラー）は変えずに返す */
function translateError(error: unknown, operation: Operation): unknown {
  const target = notNullTargetOf(error);
  if (target === null) return error;
  const reason = ((): CaseRequestWriteReason | null => {
    switch (target) {
      case "case_creation_requests.client_id":
        return "client_unavailable";
      case "case_creation_requests.requested_by":
        return "requester_ineligible";
      // 再申請の元の確認文は、件名を NULL にして失敗させる
      case "case_creation_requests.title":
        return "resubmit_unavailable";
      case "case_creation_requests.version":
        return operation === "create" ? "recipients_changed" : "decided";
      case "case_creation_request_departments.department_id":
        return "department_unavailable";
      case "case_creation_request_candidates.user_id":
        return "candidate_unavailable";
      default:
        return null;
    }
  })();
  return reason === null
    ? error
    : new CaseRequestWriteError(reason, { cause: error });
}

async function runBatch<T>(
  operation: Operation,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw translateError(error, operation);
  }
}

/** 審査中で、読んだ版のままなら版を進める文。崩れていたら NOT NULL 違反で batch 全体が失敗する */
function guardPending(db: Database, input: WithdrawCaseRequestInput) {
  return db
    .update(caseCreationRequests)
    .set({
      version: sql`CASE WHEN ${caseCreationRequests.status} = 'pending' AND ${caseCreationRequests.version} = ${input.version} THEN ${caseCreationRequests.version} + 1 ELSE NULL END`,
    })
    .where(
      and(
        eq(caseCreationRequests.id, input.requestId),
        eq(caseCreationRequests.requestedBy, input.requesterId),
      ),
    )
    .returning({ id: caseCreationRequests.id });
}

const jsonIds = (ids: readonly string[]) => JSON.stringify(ids);

/** 担当部署の有効なオーナー（申請者を除く） */
function currentOwnersSql(
  departmentIds: readonly string[],
  requesterId: string,
) {
  return sql`SELECT a.user_id FROM user_role_assignments a JOIN users u ON u.id = a.user_id
    WHERE a.role_id = ${ROLE_IDS.owner} AND u.is_active = 1 AND a.user_id <> ${requesterId}
      AND a.department_id IN (SELECT value FROM json_each(${jsonIds(departmentIds)}))`;
}

/** いまの割り当てから求めた宛先（Q3：オーナーがいなければ全体管理者。どちらも申請者を除く） */
function currentRecipientsSql(
  departmentIds: readonly string[],
  requesterId: string,
) {
  const owners = currentOwnersSql(departmentIds, requesterId);
  return sql`${owners}
    UNION
    SELECT a.user_id FROM user_role_assignments a JOIN users u ON u.id = a.user_id
    WHERE a.role_id = ${ROLE_IDS.globalAdmin} AND u.is_active = 1 AND a.user_id <> ${requesterId}
      AND NOT EXISTS (${owners})`;
}

const itemColumns = {
  id: caseCreationRequests.id,
  title: caseCreationRequests.title,
  description: caseCreationRequests.description,
  dueDate: caseCreationRequests.dueDate,
  clientId: clients.id,
  clientCode: clients.code,
  clientName: clients.name,
  clientIsActive: clients.isActive,
  status: caseCreationRequests.status,
  rejectReason: caseCreationRequests.decisionReason,
  caseId: caseCreationRequests.caseId,
  resubmittedFrom: caseCreationRequests.resubmittedFrom,
  createdAt: caseCreationRequests.requestedAt,
  decidedAt: caseCreationRequests.decidedAt,
};

type ItemRow = {
  id: string;
  title: string;
  description: string;
  dueDate: string | null;
  clientId: string;
  clientCode: string;
  clientName: string;
  clientIsActive: boolean;
  status: CaseRequestStatus;
  rejectReason: string | null;
  caseId: string | null;
  resubmittedFrom: string | null;
  createdAt: string;
  decidedAt: string | null;
};

function cursorFor(row: { id: string }) {
  if (!isUlid(row.id)) throw new Error("申請IDが不正です");
  return { v: row.id, id: row.id };
}

export function createCaseRequestRepository(db: Database) {
  /**
   * 申請の行に、担当部署と候補を付ける。そのページの申請 ID を IN にした2回の読み込みで取る（N+1 にしない）。
   * ID の一覧は json_each の1つの値で渡す（D1 の束縛する値の数の上限に、件数が掛からないようにする）
   */
  async function withRelations(rows: ItemRow[]): Promise<CaseRequestItem[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const [departmentRows, candidateRows] = await Promise.all([
      db
        .select({
          requestId: caseCreationRequestDepartments.requestId,
          id: departments.id,
          name: departments.name,
          isActive: departments.isActive,
        })
        .from(caseCreationRequestDepartments)
        .innerJoin(
          departments,
          eq(departments.id, caseCreationRequestDepartments.departmentId),
        )
        .where(
          sql`${caseCreationRequestDepartments.requestId} IN (SELECT value FROM json_each(${jsonIds(ids)}))`,
        )
        .orderBy(asc(departments.name), asc(departments.id)),
      db
        .select({
          requestId: caseCreationRequestCandidates.requestId,
          userId: users.id,
          displayName: users.displayName,
        })
        .from(caseCreationRequestCandidates)
        .innerJoin(users, eq(users.id, caseCreationRequestCandidates.userId))
        .where(
          sql`${caseCreationRequestCandidates.requestId} IN (SELECT value FROM json_each(${jsonIds(ids)}))`,
        )
        .orderBy(asc(users.displayName), asc(users.id)),
    ]);
    return rows.map(
      ({ clientId, clientCode, clientName, clientIsActive, ...row }) => ({
        ...row,
        client: {
          id: clientId,
          code: clientCode,
          name: clientName,
          isActive: clientIsActive,
        },
        departments: departmentRows
          .filter((d) => d.requestId === row.id)
          .map(({ id, name, isActive }) => ({ id, name, isActive })),
        candidates: candidateRows
          .filter((c) => c.requestId === row.id)
          .map(({ userId, displayName }) => ({ userId, displayName })),
      }),
    );
  }

  const selectItems = () =>
    db
      .select(itemColumns)
      .from(caseCreationRequests)
      .innerJoin(clients, eq(clients.id, caseCreationRequests.clientId));

  async function activeUserIdsWithRole(
    roleId: string,
    extra?: SQL,
  ): Promise<string[]> {
    const rows = await db
      .selectDistinct({ userId: userRoleAssignments.userId })
      .from(userRoleAssignments)
      .innerJoin(users, eq(users.id, userRoleAssignments.userId))
      .where(
        and(
          eq(userRoleAssignments.roleId, roleId),
          eq(users.isActive, true),
          extra,
        ),
      );
    return rows.map((row) => row.userId);
  }

  return {
    /** 申請者の所属部署（所属なし・存在しない利用者は null） */
    async findUserDepartmentId(userId: string): Promise<string | null> {
      const rows = await db
        .select({ departmentId: users.departmentId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return rows[0]?.departmentId ?? null;
    },

    /** 通知の宛先を決める材料：担当部署の有効なオーナーと、有効な全体管理者 */
    async readSubmittedRecipientCandidates(
      departmentIds: readonly string[],
    ): Promise<{ ownerIds: string[]; adminIds: string[] }> {
      const [ownerIds, adminIds] = await Promise.all([
        departmentIds.length === 0
          ? Promise.resolve([])
          : activeUserIdsWithRole(
              ROLE_IDS.owner,
              sql`${userRoleAssignments.departmentId} IN (SELECT value FROM json_each(${jsonIds(departmentIds)}))`,
            ),
        activeUserIdsWithRole(ROLE_IDS.globalAdmin),
      ]);
      return { ownerIds, adminIds };
    },

    /** 再申請の元が、本人の却下済み・取り下げ済みの申請か（他人・存在しない・審査中・承認済みは区別しない） */
    async findOwnResubmittable(input: {
      requestId: string;
      requesterId: string;
    }): Promise<boolean> {
      const rows = await db
        .select({ id: caseCreationRequests.id })
        .from(caseCreationRequests)
        .where(
          and(
            eq(caseCreationRequests.id, input.requestId),
            eq(caseCreationRequests.requestedBy, input.requesterId),
            inArray(caseCreationRequests.status, ["rejected", "withdrawn"]),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },

    /** 同じ取引先の審査中の申請に、整形後の件名が完全一致するものがあるか */
    async hasSimilarTitle(input: {
      clientId: string;
      title: string;
    }): Promise<boolean> {
      const rows = await db
        .select({ id: caseCreationRequests.id })
        .from(caseCreationRequests)
        .where(
          and(
            eq(caseCreationRequests.clientId, input.clientId),
            eq(caseCreationRequests.title, input.title),
            eq(caseCreationRequests.status, "pending"),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },

    /** 申請：申請・担当部署・候補・監査・通知を1回の batch で確定する */
    async create(input: CreateCaseRequestInput): Promise<{ id: string }> {
      const id = newUlid();
      const recipientIds = [...new Set(input.recipientIds)];
      const eligibleRequester = sql`EXISTS (SELECT 1 FROM users u
        WHERE u.id = ${input.requesterId} AND u.is_active = 1
          AND (u.department_id IS NOT NULL OR EXISTS (SELECT 1 FROM user_role_assignments a
            WHERE a.user_id = u.id AND a.role_id = ${ROLE_IDS.globalAdmin})))`;
      const resubmittable = sql`EXISTS (SELECT 1 FROM case_creation_requests r
        WHERE r.id = ${input.resubmitOf} AND r.requested_by = ${input.requesterId}
          AND r.status IN ('rejected', 'withdrawn'))`;
      const current = currentRecipientsSql(
        input.departmentIds,
        input.requesterId,
      );
      const sameRecipients = sql`(SELECT COUNT(*) FROM (${current})) = ${recipientIds.length}
        AND NOT EXISTS (SELECT * FROM (${current}) EXCEPT SELECT value FROM json_each(${jsonIds(recipientIds)}))`;
      const statements: BatchItem[] = [
        db.insert(caseCreationRequests).values({
          id,
          clientId: sql`CASE WHEN EXISTS (SELECT 1 FROM clients c WHERE c.id = ${input.clientId} AND c.is_active = 1) THEN ${input.clientId} ELSE NULL END`,
          title: input.title,
          description: input.description,
          dueDate: input.dueDate,
          requestedBy: sql`CASE WHEN ${eligibleRequester} THEN ${input.requesterId} ELSE NULL END`,
          status: "pending",
          version: 1,
          resubmittedFrom:
            input.resubmitOf === null
              ? null
              : sql`CASE WHEN ${resubmittable} THEN ${input.resubmitOf} ELSE NULL END`,
          requestedAt: input.now,
        }),
      ];
      if (input.resubmitOf !== null)
        // 元が使えず resubmitted_from が NULL になったら、件名を NULL にして batch 全体を失敗させる
        statements.push(
          db
            .update(caseCreationRequests)
            .set({
              title: sql`CASE WHEN ${caseCreationRequests.resubmittedFrom} IS NULL THEN NULL ELSE ${caseCreationRequests.title} END`,
            })
            .where(eq(caseCreationRequests.id, id)),
        );
      statements.push(
        db.insert(caseCreationRequestDepartments).select(sql`
          SELECT ${id}, CASE WHEN EXISTS (SELECT 1 FROM departments d WHERE d.id = j.value AND d.is_active = 1) THEN j.value ELSE NULL END
          FROM json_each(${jsonIds(input.departmentIds)}) j`),
        db.insert(caseCreationRequestCandidates).select(sql`
          SELECT ${id}, CASE WHEN EXISTS (SELECT 1 FROM users u WHERE u.id = j.value AND u.is_active = 1) THEN j.value ELSE NULL END,
            ${input.requesterId}, ${input.now}
          FROM json_each(${jsonIds(input.candidateIds)}) j`),
        // 宛先の確認：いまの割り当てから求めた宛先が、読んだ宛先と同じでなければ版を NULL にして失敗させる
        db
          .update(caseCreationRequests)
          .set({
            version: sql`CASE WHEN ${sameRecipients} THEN ${caseCreationRequests.version} ELSE NULL END`,
          })
          .where(eq(caseCreationRequests.id, id)),
        // 件名・説明の本文は監査に入れない
        auditLogInsert(db, {
          actorId: input.requesterId,
          action: "case_request.create",
          targetType: "case_request",
          targetId: id,
          result: "success",
          traceId: input.traceId,
          detail: {
            requestId: id,
            clientId: input.clientId,
            departmentCount: input.departmentIds.length,
            candidateCount: input.candidateIds.length,
            resubmittedFrom: input.resubmitOf,
          },
        }),
        ...notificationInserts(db, recipientIds, {
          kind: "case_request.submitted",
          targetId: id,
        }),
      );
      await runBatch("create", () =>
        db.batch(statements as [BatchItem, ...BatchItem[]]),
      );
      return { id };
    },

    /** 自分の申請を新しい順に読む */
    async listMine(input: {
      requesterId: string;
      limit: number;
      cursor?: CursorPayload;
    }): Promise<{ items: CaseRequestItem[]; nextCursor: string | null }> {
      const conditions: SQL[] = [
        eq(caseCreationRequests.requestedBy, input.requesterId),
      ];
      if (input.cursor !== undefined)
        conditions.push(
          afterCursor(
            { sort: caseCreationRequests.id, id: caseCreationRequests.id },
            input.cursor,
            "desc",
          ),
        );
      const rows = await selectItems()
        .where(and(...conditions))
        .orderBy(desc(caseCreationRequests.id))
        .limit(input.limit + 1);
      const page = toPage<ItemRow>(rows, input.limit, cursorFor);
      return {
        items: await withRelations(page.items),
        nextCursor: page.nextCursor,
      };
    },

    /** 本人の申請を1件読む（他人の申請・存在しない申請は null） */
    async findOwnItem(input: {
      requestId: string;
      requesterId: string;
    }): Promise<CaseRequestItem | null> {
      const rows = await selectItems()
        .where(
          and(
            eq(caseCreationRequests.id, input.requestId),
            eq(caseCreationRequests.requestedBy, input.requesterId),
          ),
        )
        .limit(1);
      const [item] = await withRelations(rows);
      return item ?? null;
    },

    /** 取り下げの前に、本人の申請の状態と版を読む（他人の申請・存在しない申請は null） */
    async findOwnForWithdraw(input: {
      requestId: string;
      requesterId: string;
    }): Promise<{
      id: string;
      status: CaseRequestStatus;
      version: number;
    } | null> {
      const rows = await db
        .select({
          id: caseCreationRequests.id,
          status: caseCreationRequests.status,
          version: caseCreationRequests.version,
        })
        .from(caseCreationRequests)
        .where(
          and(
            eq(caseCreationRequests.id, input.requestId),
            eq(caseCreationRequests.requestedBy, input.requesterId),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    /** 取り下げ：申請を更新し、監査を残す（1 batch）。通知は送らない */
    async withdraw(input: WithdrawCaseRequestInput): Promise<void> {
      // 監査の detail（部署数）を読む。申請の担当部署は申請の後に変わらないため、batch の時点でも同じ値になる
      const [counted] = await db
        .select({ n: sql<number>`COUNT(*)` })
        .from(caseCreationRequestDepartments)
        .where(eq(caseCreationRequestDepartments.requestId, input.requestId));
      if (counted === undefined) throw new Error("部署数を読めませんでした");
      const own = and(
        eq(caseCreationRequests.id, input.requestId),
        eq(caseCreationRequests.requestedBy, input.requesterId),
      );
      const [guarded] = await runBatch("withdraw", () =>
        db.batch([
          guardPending(db, input),
          db
            .update(caseCreationRequests)
            .set({
              status: "withdrawn",
              decidedBy: input.requesterId,
              decidedAt: input.now,
            })
            .where(own),
          // 本人の申請の行がないときは監査を残さない（下で not_found にする）
          auditLogInsert(
            db,
            {
              actorId: input.requesterId,
              action: "case_request.withdraw",
              targetType: "case_request",
              targetId: input.requestId,
              result: "success",
              traceId: input.traceId,
              detail: {
                requestId: input.requestId,
                departmentCount: counted.n,
              },
            },
            {
              onlyWhen: sql`EXISTS (SELECT 1 FROM case_creation_requests r
                WHERE r.id = ${input.requestId} AND r.requested_by = ${input.requesterId})`,
            },
          ),
        ]),
      );
      if (guarded.length === 0) throw new CaseRequestWriteError("not_found");
    },
  };
}

export type CaseRequestRepository = ReturnType<
  typeof createCaseRequestRepository
>;

export function withCaseRequests<T>(
  env: Env,
  run: (
    repository: CaseRequestRepository,
    roles: RoleAssignmentRepository,
  ) => Promise<T>,
): Promise<T> {
  return withDatabase(env, (db) =>
    run(createCaseRequestRepository(db), createRoleAssignmentRepository(db)),
  );
}
