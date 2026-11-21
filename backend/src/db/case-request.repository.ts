// Repository：案件の作成申請（#146 の 146-A）の申請・自分の申請・取り下げ・類似件名の確認。DB へのアクセスはこの層に閉じ込める。
// 1 操作＝1 つの db.batch で、申請・担当部署・候補・監査・通知を一体で確定する（途中の文が失敗したら全体が取り消される）。
// 最初の判定（Service）で確かめた DB の状態は、batch の中でも CASE WHEN … ELSE NULL で確かめ直し、崩れていれば NOT NULL 違反で
// batch 全体を失敗させる。失敗は制約の表と列で専用エラーに変換し、未知の DB エラーは握りつぶさずそのまま再送出する。
import { and, asc, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import { jstDateOf } from "../../../shared/case-rules";
import {
  caseCreationRequestCandidates,
  caseCreationRequestDepartments,
  caseCreationRequests,
  caseDepartments,
  caseNumberSequences,
  cases,
  channelMembers,
  channels,
  clients,
  departments,
  rooms,
  userRoleAssignments,
  users,
} from "../../db/schema";
import { afterCursor, toPage, type CursorPayload } from "../lib/cursor";
import { ROLE_IDS } from "../lib/permissions";
import { isUlid, newUlid } from "../lib/ulid";
import {
  auditLogInsert,
  auditLogInsertWithDetailSql,
} from "./audit-log.repository";
import { withDatabase, type BatchItem, type Database } from "./database";
import { notificationInserts } from "./notification.repository";
import { syncCaseTitleIndexStatements } from "./search-index.sql";
import {
  createRoleAssignmentRepository,
  type RoleAssignmentRepository,
} from "./role-assignment.repository";

/** 申請の状態（自動取消 auto_cancelled を含む5つ） */
export const CASE_REQUEST_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "withdrawn",
  "auto_cancelled",
] as const;

export type CaseRequestStatus = (typeof CASE_REQUEST_STATUSES)[number];

/** 再申請の元にできる状態（自動取消の本人は有効なままなので、出し直せる） */
const RESUBMITTABLE_STATUSES = [
  "rejected",
  "withdrawn",
  "auto_cancelled",
] as const satisfies readonly CaseRequestStatus[];

export type CaseRequestWriteReason =
  /** 取引先が存在しない・無効 */
  | "client_unavailable"
  /** 担当部署のどれかが存在しない・無効 */
  | "department_unavailable"
  /** 候補のどれかが存在しない・無効 */
  | "candidate_unavailable"
  /** 再申請の元が、本人の却下済み・取り下げ済み・自動取消の申請でない */
  | "resubmit_unavailable"
  /** 申請者が無効、または所属がなく全体管理者でもない */
  | "requester_ineligible"
  /** 通知の宛先が、読んだときと変わった */
  | "recipients_changed"
  /** 取り下げ：すでに審査中でない（または、読んだ後に他の操作が先に確定した） */
  | "decided"
  /** 取り下げ：本人の申請の行がない */
  | "not_found"
  /** 承認・却下：決裁者が審査者でない（担当部署のどれのオーナーでもなく全体管理者でもない・無効・全体管理者でない申請者本人） */
  | "reviewer_ineligible"
  /** 承認：担当部署のどれかが無効 */
  | "department_inactive"
  /** 承認：取引先が無効（利用者の決定 Q2） */
  | "client_inactive"
  /** 承認：申請の候補のどれかが無効 */
  | "candidate_inactive"
  /** 承認：承認者がいま足した候補が存在しない・無効 */
  | "added_candidate_unavailable"
  /** 承認：この取引先・年の連番が上限（9999）に達した */
  | "number_exhausted"
  /** 承認：同じ案件番号の案件（案件専用チャンネル）がある */
  | "number_conflict";

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
  /** 承認済みなら案件番号、それ以外は null */
  caseNumber: string | null;
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

export type CaseRequestForDecision = {
  id: string;
  requestedBy: string;
  status: CaseRequestStatus;
  version: number;
  departmentIds: string[];
};

/** 決裁（承認・却下）の入力。version は読んだときの申請の版、now は ISO 文字列 */
export type DecideInput = {
  requestId: string;
  version: number;
  deciderId: string;
  now: string;
  traceId: string;
};

/** 審査の範囲：全体管理者は全部、オーナーは担当部署のどれかが自分の部署の申請 */
export type ReviewScope = {
  isAdmin: boolean;
  ownedDepartmentIds: readonly string[];
};

type Operation = "create" | "withdraw" | "approve" | "reject";

/** 制約の違反の種類と対象（NOT NULL・UNIQUE は「表.列」、CHECK は制約の名前）。制約の違反でなければ null */
function constraintOf(
  error: unknown,
): { kind: "NOT NULL" | "UNIQUE" | "CHECK"; target: string } | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const match = /(NOT NULL|UNIQUE|CHECK) constraint failed: ([\w.]+)/i.exec(
      current.message,
    );
    if (match !== null)
      return {
        kind: (match[1] ?? "").toUpperCase() as "NOT NULL" | "UNIQUE" | "CHECK",
        target: match[2] ?? "",
      };
    current = current.cause;
  }
  return null;
}

const CREATE_REASONS: Record<string, CaseRequestWriteReason> = {
  "NOT NULL case_creation_requests.client_id": "client_unavailable",
  "NOT NULL case_creation_requests.requested_by": "requester_ineligible",
  // 再申請の元の確認文は、件名を NULL にして失敗させる
  "NOT NULL case_creation_requests.title": "resubmit_unavailable",
  "NOT NULL case_creation_requests.version": "recipients_changed",
  "NOT NULL case_creation_request_departments.department_id":
    "department_unavailable",
  "NOT NULL case_creation_request_candidates.user_id": "candidate_unavailable",
};

const WITHDRAW_REASONS: Record<string, CaseRequestWriteReason> = {
  "NOT NULL case_creation_requests.version": "decided",
};

// 承認・却下では、決裁者の資格の確認文が申請の requested_by を NULL にする（計画の突き合わせの表 146-B）
const REJECT_REASONS: Record<string, CaseRequestWriteReason> = {
  "NOT NULL case_creation_requests.version": "decided",
  "NOT NULL case_creation_requests.requested_by": "reviewer_ineligible",
};

const APPROVE_REASONS: Record<string, CaseRequestWriteReason> = {
  ...REJECT_REASONS,
  "NOT NULL departments.version": "department_inactive",
  "NOT NULL clients.version": "client_inactive",
  // 承認者が足す候補は added_by を、申請の時からの候補は user_id を NULL にして見分ける
  "NOT NULL case_creation_request_candidates.added_by":
    "added_candidate_unavailable",
  "NOT NULL case_creation_request_candidates.user_id": "candidate_inactive",
  "CHECK case_number_sequences_last_number_check": "number_exhausted",
  // 案件専用チャンネルの名前の正規化（case: と案件番号）は、案件番号と一対一のため、どちらの UNIQUE も採番の競合
  "UNIQUE channels.name_normalized": "number_conflict",
  "UNIQUE cases.case_number": "number_conflict",
};

const REASONS_OF: Record<Operation, Record<string, CaseRequestWriteReason>> = {
  create: CREATE_REASONS,
  withdraw: WITHDRAW_REASONS,
  approve: APPROVE_REASONS,
  reject: REJECT_REASONS,
};

/** 想定する制約の違反だけを専用エラーにし、それ以外（未知の DB エラー）は変えずに返す */
function translateError(error: unknown, operation: Operation): unknown {
  const constraint = constraintOf(error);
  if (constraint === null) return error;
  const reason =
    REASONS_OF[operation][`${constraint.kind} ${constraint.target}`];
  return reason === undefined
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

/**
 * 審査中で、読んだ版のままなら版を進める文。崩れていたら NOT NULL 違反で batch 全体が失敗する。
 * requesterId を渡したときは、本人の申請の行だけを対象にする（取り下げ）
 */
function guardPending(
  db: Database,
  input: { requestId: string; version: number; requesterId?: string },
) {
  return db
    .update(caseCreationRequests)
    .set({
      version: sql`CASE WHEN ${caseCreationRequests.status} = 'pending' AND ${caseCreationRequests.version} = ${input.version} THEN ${caseCreationRequests.version} + 1 ELSE NULL END`,
    })
    .where(
      and(
        eq(caseCreationRequests.id, input.requestId),
        input.requesterId === undefined
          ? undefined
          : eq(caseCreationRequests.requestedBy, input.requesterId),
      ),
    )
    .returning({ id: caseCreationRequests.id });
}

const jsonIds = (ids: readonly string[]) => JSON.stringify(ids);

function reviewScopeSql(scope: ReviewScope): SQL {
  if (scope.isAdmin) return sql`1 = 1`;
  return sql`EXISTS (SELECT 1 FROM case_creation_request_departments d
    WHERE d.request_id = ${caseCreationRequests.id}
      AND d.department_id IN (SELECT value FROM json_each(${jsonIds(scope.ownedDepartmentIds)})))`;
}

/** 審査一覧の類似件名：自分自身を除き、同じ取引先の審査中の申請か案件（進行中・終了）に同じ件名があるか */
const similarToOthersSql = sql<number>`(EXISTS (SELECT 1 FROM case_creation_requests o
    WHERE o.client_id = ${caseCreationRequests.clientId} AND o.title = ${caseCreationRequests.title}
      AND o.status = 'pending' AND o.id <> ${caseCreationRequests.id})
  OR EXISTS (SELECT 1 FROM cases k
    WHERE k.client_id = ${caseCreationRequests.clientId} AND k.title = ${caseCreationRequests.title}
      AND k.request_id <> ${caseCreationRequests.id}))`;

/**
 * 決裁者の資格を、いまの割り当てから確かめる文（突き合わせの表 146-B）。決裁者が有効で、全体管理者か、
 * 申請者本人でなく担当部署のどれかのオーナーでなければ、申請の requested_by を NULL にして batch 全体を失敗させる
 */
function reviewerGuard(
  db: Database,
  input: { requestId: string; deciderId: string },
) {
  const active = sql`EXISTS (SELECT 1 FROM users u WHERE u.id = ${input.deciderId} AND u.is_active = 1)`;
  const isAdmin = sql`EXISTS (SELECT 1 FROM user_role_assignments a
    WHERE a.user_id = ${input.deciderId} AND a.role_id = ${ROLE_IDS.globalAdmin})`;
  const ownsDepartment = sql`EXISTS (SELECT 1 FROM user_role_assignments a
    WHERE a.user_id = ${input.deciderId} AND a.role_id = ${ROLE_IDS.owner}
      AND a.department_id IN (SELECT d.department_id FROM case_creation_request_departments d WHERE d.request_id = ${input.requestId}))`;
  const requester = caseCreationRequests.requestedBy;
  return db
    .update(caseCreationRequests)
    .set({
      requestedBy: sql`CASE WHEN ${active} AND (${isAdmin} OR (${requester} <> ${input.deciderId} AND ${ownsDepartment}))
        THEN ${requester} ELSE NULL END`,
    })
    .where(eq(caseCreationRequests.id, input.requestId));
}

/** 決裁の通知の宛先：申請者。決裁者が申請者本人なら送らない（3-4 AC-3） */
function requesterToNotify(
  facts: { requestedBy: string },
  input: { deciderId: string },
): string[] {
  return facts.requestedBy === input.deciderId ? [] : [facts.requestedBy];
}

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

type CandidateWithActive = {
  userId: string;
  displayName: string;
  isActive: boolean;
};

/** 自分の申請の項目では、候補の有効・無効を返さない（146-A の契約） */
function toMineItem<T extends { candidates: CandidateWithActive[] }>(
  item: T,
): Omit<T, "candidates"> & {
  candidates: { userId: string; displayName: string }[];
} {
  return {
    ...item,
    candidates: item.candidates.map(({ userId, displayName }) => ({
      userId,
      displayName,
    })),
  };
}

function cursorFor(row: { id: string }) {
  if (!isUlid(row.id)) throw new Error("申請IDが不正です");
  return { v: row.id, id: row.id };
}

export function createCaseRequestRepository(db: Database) {
  /**
   * 申請の行に、担当部署と候補を付ける。そのページの申請 ID を IN にした2回の読み込みで取る（N+1 にしない）。
   * ID の一覧は json_each の1つの値で渡す（D1 の束縛する値の数の上限に、件数が掛からないようにする）
   */
  async function withRelations<R extends ItemRow>(
    rows: R[],
  ): Promise<
    (Omit<R, "clientId" | "clientCode" | "clientName" | "clientIsActive"> &
      Pick<CaseRequestItem, "client" | "departments"> & {
        candidates: CandidateWithActive[];
      })[]
  > {
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
          isActive: users.isActive,
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
          .map(({ userId, displayName, isActive }) => ({
            userId,
            displayName,
            isActive,
          })),
      }),
    );
  }

  /** 決裁の batch の前に、申請者と担当部署の数を読む（どちらも申請の後に変わらない） */
  async function readDecisionFacts(
    requestId: string,
  ): Promise<{ requestedBy: string; departmentCount: number }> {
    const [row] = await db
      .select({
        requestedBy: caseCreationRequests.requestedBy,
        // 外側の列は入れ子の SQL で渡す（直接書くと表名なしになり、内側の表の同名の列と解釈されうる）
        departmentCount: sql<number>`(SELECT COUNT(*) FROM case_creation_request_departments d WHERE d.request_id = ${sql`${caseCreationRequests.id}`})`,
      })
      .from(caseCreationRequests)
      .where(eq(caseCreationRequests.id, requestId))
      .limit(1);
    if (row === undefined) throw new CaseRequestWriteError("not_found");
    return row;
  }

  // 自分の申請の項目だけが案件番号を持つ（審査一覧の項目は持たない）
  const selectItems = () =>
    db
      .select({ ...itemColumns, caseNumber: cases.caseNumber })
      .from(caseCreationRequests)
      .innerJoin(clients, eq(clients.id, caseCreationRequests.clientId))
      .leftJoin(cases, eq(cases.id, caseCreationRequests.caseId));

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

    /** 再申請の元が、本人の却下済み・取り下げ済み・自動取消の申請か（他人・存在しない・審査中・承認済みは区別しない） */
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
            inArray(caseCreationRequests.status, [...RESUBMITTABLE_STATUSES]),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },

    /** 同じ取引先の審査中の申請か案件（進行中・終了）に、整形後の件名が完全一致するものがあるか（5-3 AC-14・C-141(3)） */
    /** excludeCaseId を渡すと、その案件自身は比べる相手から除く（審査中の申請の側は変えない） */
    async hasSimilarTitle(input: {
      clientId: string;
      title: string;
      excludeCaseId?: string;
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
      if (rows.length > 0) return true;
      const caseRows = await db
        .select({ id: cases.id })
        .from(cases)
        .where(
          and(
            eq(cases.clientId, input.clientId),
            eq(cases.title, input.title),
            input.excludeCaseId === undefined
              ? undefined
              : ne(cases.id, input.excludeCaseId),
          ),
        )
        .limit(1);
      return caseRows.length > 0;
    },

    /** 決裁の前に、申請の状態・版・申請者・担当部署を読む（存在しない申請は null） */
    async findForDecision(
      requestId: string,
    ): Promise<CaseRequestForDecision | null> {
      const rows = await db
        .select({
          id: caseCreationRequests.id,
          requestedBy: caseCreationRequests.requestedBy,
          status: caseCreationRequests.status,
          version: caseCreationRequests.version,
        })
        .from(caseCreationRequests)
        .where(eq(caseCreationRequests.id, requestId))
        .limit(1);
      const row = rows[0];
      if (row === undefined) return null;
      const departmentRows = await db
        .select({ departmentId: caseCreationRequestDepartments.departmentId })
        .from(caseCreationRequestDepartments)
        .where(eq(caseCreationRequestDepartments.requestId, requestId));
      return {
        ...row,
        departmentIds: departmentRows.map((d) => d.departmentId),
      };
    },

    /** 渡した ID のうち、存在して有効な社員の数（承認者が足す候補の確認用） */
    async countActiveUsers(userIds: readonly string[]): Promise<number> {
      if (userIds.length === 0) return 0;
      const [counted] = await db
        .select({ n: sql<number>`COUNT(DISTINCT ${users.id})` })
        .from(users)
        .where(
          and(
            sql`${users.id} IN (SELECT value FROM json_each(${jsonIds(userIds)}))`,
            eq(users.isActive, true),
          ),
        );
      if (counted === undefined) throw new Error("社員の数を読めませんでした");
      return counted.n;
    },

    /** 審査一覧：審査の範囲の申請を新しい順に読む。範囲は SQL の WHERE に入れる（security） */
    async listReviewable(
      scope: ReviewScope,
      options: {
        limit: number;
        cursor?: CursorPayload;
        status?: CaseRequestStatus;
      },
    ) {
      const conditions: SQL[] = [reviewScopeSql(scope)];
      if (options.status !== undefined)
        conditions.push(eq(caseCreationRequests.status, options.status));
      if (options.cursor !== undefined)
        conditions.push(
          afterCursor(
            { sort: caseCreationRequests.id, id: caseCreationRequests.id },
            options.cursor,
            "desc",
          ),
        );
      const rows = await db
        .select({
          ...itemColumns,
          requesterId: caseCreationRequests.requestedBy,
          requesterDisplayName: users.displayName,
          hasSimilarTitle: similarToOthersSql,
        })
        .from(caseCreationRequests)
        .innerJoin(clients, eq(clients.id, caseCreationRequests.clientId))
        .innerJoin(users, eq(users.id, caseCreationRequests.requestedBy))
        .where(and(...conditions))
        .orderBy(desc(caseCreationRequests.id))
        .limit(options.limit + 1);
      const page = toPage(rows, options.limit, cursorFor);
      const items = await withRelations(page.items);
      return {
        items: items.map((item) => ({
          ...item,
          hasSimilarTitle: Boolean(item.hasSimilarTitle),
        })),
        nextCursor: page.nextCursor,
      };
    },

    /**
     * 承認：案件・案件専用チャンネル・参加者・採番・申請の更新・監査・通知を1回の batch で確定する。
     * 文の順（計画 B-5）が、失敗の理由の優先になる。前提が崩れていたら CaseRequestWriteError で、何も残らない
     */
    async approve(
      input: DecideInput & { additionalCandidateIds: readonly string[] },
    ): Promise<{ caseId: string; caseNumber: string; roomId: string }> {
      const facts = await readDecisionFacts(input.requestId);
      const caseId = newUlid();
      const roomId = newUlid();
      const { year, yymmdd } = jstDateOf(new Date(input.now));
      const requestId = input.requestId;
      const requestDepartments = sql`SELECT d.department_id FROM case_creation_request_departments d WHERE d.request_id = ${requestId}`;
      const caseNumber = sql`(SELECT c.code || '-' || ${yymmdd} || '-' || printf('%04d', s.last_number)
        FROM case_creation_requests r
        JOIN clients c ON c.id = r.client_id
        JOIN case_number_sequences s ON s.client_id = r.client_id AND s.year = ${year}
        WHERE r.id = ${requestId})`;
      const activeOwners = sql`SELECT a.user_id FROM user_role_assignments a JOIN users u ON u.id = a.user_id
        WHERE a.role_id = ${ROLE_IDS.owner} AND u.is_active = 1 AND a.department_id IN (${requestDepartments})`;
      const activeAdmins = sql`SELECT a.user_id FROM user_role_assignments a JOIN users u ON u.id = a.user_id
        WHERE a.role_id = ${ROLE_IDS.globalAdmin} AND u.is_active = 1`;
      // 参加者：申請者・候補・全担当部署の有効なオーナー・有効な全体管理者（UNION で重複を除く）。承認者であることを理由には入れない
      const participants = sql`SELECT p.user_id FROM (
          SELECT r.requested_by AS user_id FROM case_creation_requests r WHERE r.id = ${requestId}
          UNION SELECT c.user_id FROM case_creation_request_candidates c WHERE c.request_id = ${requestId}
          UNION ${activeOwners}
          UNION ${activeAdmins}
        ) p JOIN users u ON u.id = p.user_id WHERE u.is_active = 1`;
      const membersAmong = (subset: SQL) =>
        sql`(SELECT COUNT(*) FROM channel_members m WHERE m.channel_id = ${roomId} AND m.user_id IN (${subset}))`;
      const statements: [BatchItem, ...BatchItem[]] = [
        // 1. 決裁済み・版の違いを最優先の理由にする
        guardPending(db, input),
        // 2. 決裁者の資格（突き合わせの表 146-B）
        reviewerGuard(db, input),
        // 3. 担当部署の有効性（部署の値と版は変えない）
        db
          .update(departments)
          .set({
            version: sql`CASE WHEN ${departments.isActive} = 1 THEN ${departments.version} ELSE NULL END`,
          })
          .where(sql`${departments.id} IN (${requestDepartments})`),
        // 4. 取引先の有効性（利用者の決定 Q2）
        db
          .update(clients)
          .set({
            version: sql`CASE WHEN ${clients.isActive} = 1 THEN ${clients.version} ELSE NULL END`,
          })
          .where(
            sql`${clients.id} = (SELECT r.client_id FROM case_creation_requests r WHERE r.id = ${requestId})`,
          ),
        // 5. 承認者が足す候補。存在しない・無効なら added_by を NULL にして失敗させる（すでに候補の人は足さない）
        db.insert(caseCreationRequestCandidates).select(sql`
          SELECT ${requestId}, j.value,
            CASE WHEN EXISTS (SELECT 1 FROM users u WHERE u.id = j.value AND u.is_active = 1) THEN ${input.deciderId} ELSE NULL END,
            ${input.now}
          FROM json_each(${jsonIds(input.additionalCandidateIds)}) j
          WHERE NOT EXISTS (SELECT 1 FROM case_creation_request_candidates c
            WHERE c.request_id = ${requestId} AND c.user_id = j.value)`),
        // 6. 申請の時からの候補の有効性
        db
          .update(caseCreationRequestCandidates)
          .set({
            userId: sql`CASE WHEN EXISTS (SELECT 1 FROM users u WHERE u.id = ${caseCreationRequestCandidates.userId} AND u.is_active = 1) THEN ${caseCreationRequestCandidates.userId} ELSE NULL END`,
          })
          .where(eq(caseCreationRequestCandidates.requestId, requestId)),
        // 7. 採番（取引先・日本時間の年ごと）。9999 を超えると CHECK で失敗する
        db
          .insert(caseNumberSequences)
          .select(
            sql`SELECT r.client_id, ${year}, 1 FROM case_creation_requests r WHERE r.id = ${requestId}`,
          )
          .onConflictDoUpdate({
            target: [caseNumberSequences.clientId, caseNumberSequences.year],
            set: { lastNumber: sql`${caseNumberSequences.lastNumber} + 1` },
          }),
        // 8. 案件専用チャンネル（非公開・部署なし・名前は案件番号）。作成者は申請者（チャンネルの作成申請の承認と同じ）
        db
          .insert(rooms)
          .values({ id: roomId, kind: "channel", createdAt: input.now }),
        db.insert(channels).select(sql`
          SELECT ${roomId}, NULL, ${caseNumber}, 'case:' || lower(${caseNumber}), '', 'private', 'case',
            r.requested_by, 1, ${input.now}, ${input.now}, NULL, NULL
          FROM case_creation_requests r WHERE r.id = ${requestId}`),
        // 9. 案件（created_by は申請者、approved_by は承認者）と担当部署
        db.insert(cases).select(sql`
          SELECT ${caseId}, ${caseNumber}, r.client_id, r.client_id, ${roomId}, r.id, r.title, r.description, r.due_date,
            'active', r.requested_by, ${input.deciderId}, 1, ${input.now}, ${input.now}
          FROM case_creation_requests r WHERE r.id = ${requestId}`),
        db
          .insert(caseDepartments)
          .select(
            sql`SELECT ${caseId}, q.department_id FROM (${requestDepartments}) q`,
          ),
        // 10. 参加者（現在の割り当てから確定する。読んだ値を埋め込まない）
        db
          .insert(channelMembers)
          .select(
            sql`SELECT ${roomId}, q.user_id, ${input.now} FROM (${participants}) q`,
          ),
        // 11. 申請を承認済みにする
        db
          .update(caseCreationRequests)
          .set({
            status: "approved",
            caseId,
            decidedBy: input.deciderId,
            decidedAt: input.now,
          })
          .where(eq(caseCreationRequests.id, requestId)),
        // 12. 監査（件名・説明は入れない）。案件番号と参加者の数は batch の中で決まるため、案件・参加者を入れた後に、
        // 同じ batch の中の値から detail を組み立てて1回で入れる（監査ログは書き換えない：0-6 AC-4）
        auditLogInsertWithDetailSql(db, {
          actorId: input.deciderId,
          action: "case_request.approve",
          targetType: "case_request",
          targetId: requestId,
          result: "success",
          traceId: input.traceId,
          detail: sql`json_object(
            'requestId', ${requestId},
            'caseId', ${caseId},
            'caseNumber', (SELECT k.case_number FROM cases k WHERE k.id = ${caseId}),
            'channelId', ${roomId},
            'departmentCount', CAST(${facts.departmentCount} AS INTEGER),
            'participantCount', (SELECT COUNT(*) FROM channel_members m WHERE m.channel_id = ${roomId}),
            'ownerCount', ${membersAmong(activeOwners)},
            'adminCount', ${membersAmong(activeAdmins)})`,
        }),
        // 13. 申請者への通知（決裁者が申請者なら送らない）
        ...notificationInserts(db, requesterToNotify(facts, input), {
          kind: "case_request.approved",
          targetId: requestId,
        }),
        // 14. 件名の索引（末尾に置き、前提の確認の文の間に挟まない。いまの案件の行を写す）
        ...syncCaseTitleIndexStatements(db, caseId),
      ];
      await runBatch("approve", () => db.batch(statements));
      const created = await db
        .select({
          caseId: cases.id,
          caseNumber: cases.caseNumber,
          roomId: cases.channelId,
        })
        .from(cases)
        .where(eq(cases.requestId, requestId))
        .limit(1);
      const result = created[0];
      if (result === undefined)
        throw new Error("作成した案件を読めませんでした");
      return result;
    },

    /** 却下：申請を却下済みにし、監査・申請者への通知を残す（1 batch）。部署・取引先・候補が無効でも却下できる */
    async reject(input: DecideInput & { reason: string }): Promise<void> {
      const facts = await readDecisionFacts(input.requestId);
      await runBatch("reject", () =>
        db.batch([
          guardPending(db, input),
          reviewerGuard(db, input),
          db
            .update(caseCreationRequests)
            .set({
              status: "rejected",
              decisionReason: input.reason,
              decidedBy: input.deciderId,
              decidedAt: input.now,
            })
            .where(eq(caseCreationRequests.id, input.requestId)),
          // 理由の本文は監査に入れない
          auditLogInsert(db, {
            actorId: input.deciderId,
            action: "case_request.reject",
            targetType: "case_request",
            targetId: input.requestId,
            result: "success",
            traceId: input.traceId,
            detail: {
              requestId: input.requestId,
              departmentCount: facts.departmentCount,
            },
          }),
          ...notificationInserts(db, requesterToNotify(facts, input), {
            kind: "case_request.rejected",
            targetId: input.requestId,
          }),
        ]),
      );
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
          AND r.status IN (${sql.join(
            RESUBMITTABLE_STATUSES.map((status) => sql`${status}`),
            sql`, `,
          )}))`;
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
      const page = toPage(rows, input.limit, cursorFor);
      return {
        items: (await withRelations(page.items)).map(toMineItem),
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
      return item === undefined ? null : toMineItem(item);
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
