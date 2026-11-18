// Repository：案件の一覧・概要・詳細（#147 の 147-A）と、参加者の追加・削除・納期の変更（147-B）。DB へのアクセスはこの層に閉じ込める。
// 見える範囲は SQL で絞る（joined は「有効な参加者」の案件だけ）。説明・チャンネル ID・参加者は詳細の読み込みでだけ返す。
// 資格（有効な参加者・管理の資格）は、先に読んだ材料に頼らず、中身（参加者数・説明・参加者）を読む SQL そのものの条件にする。
// 先に確かめてから別に読むと、その間に無効化・交代が確定した要求に中身が返るため（コードレビュー1回目）。
// 担当部署は、そのページの案件 ID を json_each の1つの値で渡して、まとめて読む（N+1 にしない。
// D1 の束縛する値の数の上限に、件数が掛からないようにする）。
// 書き込み（147-B）は1操作＝1回の db.batch。先頭の前提の確認（#196 の方式）は cases.version を「そのままか NULL」にする UPDATE で、
// Service の最初の判定のうち DB の行で決まるもの（進行中・操作者が有効で資格がある・対象の状態・読んだ納期）をすべて含む。
// 崩れていれば NOT NULL 違反で batch 全体を取り消し、CaseStateChangedError にする。監査・業務の文にも同じ条件を付ける
// （案件の行がなければ先頭の UPDATE は0行で失敗しないため、業務の文の結果が0行なら CaseStateChangedError にする）。
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import {
  caseDepartments,
  cases,
  channelMembers,
  clients,
  departments,
  userRoleAssignments,
  users,
} from "../../db/schema";
import {
  autoRoleOf,
  canRemoveParticipant,
  type CaseAutoRole,
} from "../lib/case-participant-rules";
import { afterCursor, toPage, type CursorPayload } from "../lib/cursor";
import { ROLE_IDS } from "../lib/permissions";
import { isUlid } from "../lib/ulid";
import { auditLogInsert } from "./audit-log.repository";
import { activeChannelMember } from "./channel-member.sql";
import { withDatabase, type Database } from "./database";
import {
  createRoleAssignmentRepository,
  type RoleAssignmentRepository,
} from "./role-assignment.repository";

export const CASE_LIST_SCOPES = ["joined", "all"] as const;
export const CASE_STATUSES = ["active", "closed"] as const;
export type CaseListScope = (typeof CASE_LIST_SCOPES)[number];
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** 一覧・概要の項目。説明・参加者・チャンネル ID は持たない */
export type CaseSummary = {
  id: string;
  caseNumber: string;
  title: string;
  status: CaseStatus;
  client: { id: string; name: string; isActive: boolean };
  departments: { id: string; name: string; isActive: boolean }[];
  dueDate: string | null;
  isParticipant: boolean;
  canManage: boolean;
  /** 進行中の案件で、有効な参加者か管理の資格のある人なら真（納期の変更の表示の制御） */
  canEditDueDate: boolean;
  /** 参加の行の数（退職者を含む）。参加者か管理の資格のある人だけに入れる */
  participantCount: number | null;
};

export type CaseParticipant = {
  userId: string;
  displayName: string;
  departmentName: string | null;
  isActive: boolean;
  isCreator: boolean;
  /** 自動参加の人の役割（有効で、その時点の割り当て）。一般の人・退職者は null */
  autoRole: CaseAutoRole | null;
  /** 自動参加でなく、外しても有効な参加者が1人以上残ること */
  removable: boolean;
};

/** 詳細だけに足す項目（有効な参加者にだけ返す） */
export type CaseDetailExtras = {
  description: string;
  channelId: string;
  createdBy: string;
  participants: CaseParticipant[];
};

const jsonIds = (ids: readonly string[]) => JSON.stringify(ids);

/**
 * 管理の資格＝有効な全体管理者、または、その案件の担当部署のどれかの有効なオーナー。
 * 先に読んだ割り当てに頼ると、交代・無効化の後の要求に参加者数が返るため、読み取りの SQL の中で決める
 */
function canManageSql(actorId: string, caseId: SQL): SQL {
  return sql`EXISTS (SELECT 1 FROM users mu WHERE mu.id = ${actorId} AND mu.is_active = 1 AND (
    EXISTS (SELECT 1 FROM user_role_assignments ga
      WHERE ga.user_id = mu.id AND ga.role_id = ${ROLE_IDS.globalAdmin} AND ga.scope_type = 'company')
    OR EXISTS (SELECT 1 FROM user_role_assignments oa
      JOIN case_departments ocd ON ocd.department_id = oa.department_id
      WHERE oa.user_id = mu.id AND oa.role_id = ${ROLE_IDS.owner} AND oa.scope_type = 'department'
        AND ocd.case_id = ${caseId})))`;
}

/** 書き込みの前提（または不変条件）が、判定の後に崩れていたときに投げる。batch 全体が取り消され、何も残らない */
export class CaseStateChangedError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("案件の状態が変わったため、操作を実行できませんでした", options);
    this.name = "CaseStateChangedError";
  }
}

/** 前提の確認の失敗だけを CaseStateChangedError にし、それ以外（未知のDBエラー）は変えずに返す */
function translateWriteError(error: unknown): unknown {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (/NOT NULL constraint failed: cases\.version/i.test(current.message))
      return new CaseStateChangedError({ cause: error });
    current = current.cause;
  }
  return error;
}

async function runWriteBatch<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw translateWriteError(error);
  }
}

/** 全体管理者・担当部署のオーナーの割り当て（自動参加の人の判定の材料） */
function roleRowsQuery(db: Database, where: SQL) {
  return db
    .select({
      userId: userRoleAssignments.userId,
      roleId: userRoleAssignments.roleId,
      departmentId: userRoleAssignments.departmentId,
    })
    .from(userRoleAssignments)
    .where(
      and(
        sql`((${userRoleAssignments.roleId} = ${ROLE_IDS.globalAdmin} AND ${userRoleAssignments.scopeType} = 'company')
          OR (${userRoleAssignments.roleId} = ${ROLE_IDS.owner} AND ${userRoleAssignments.scopeType} = 'department'))`,
        where,
      ),
    );
}

// 1つの表だけを読む文では、drizzle が列を表の名前なしで書き出すため、副問い合わせの中の案件の列は別名で明示する。

/** 操作者が、案件（別名 vc）の有効な参加者であること（詳細の付随の読み取りの資格） */
function visibleTo(caseId: string, actorId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM cases vc WHERE vc.id = ${caseId}
    AND ${activeChannelMember(sql`vc.channel_id`, actorId)})`;
}

/** 案件の参加者の割り当て（操作者が有効な参加者のときだけ） */
function participantRolesQuery(db: Database, caseId: string, actorId: string) {
  return roleRowsQuery(
    db,
    sql`${userRoleAssignments.userId} IN (SELECT pm.user_id FROM channel_members pm
      JOIN cases pc ON pc.channel_id = pm.channel_id WHERE pc.id = ${caseId})
      AND ${visibleTo(caseId, actorId)}`,
  );
}

/** 案件の担当部署の ID（操作者が有効な参加者のときだけ） */
function caseDepartmentIdsQuery(db: Database, caseId: string, actorId: string) {
  return db
    .select({ departmentId: caseDepartments.departmentId })
    .from(caseDepartments)
    .where(and(eq(caseDepartments.caseId, caseId), visibleTo(caseId, actorId)));
}

type RoleRow = { userId: string; roleId: string; departmentId: string | null };

function rolesOf(rows: readonly RoleRow[], userId: string) {
  const own = rows.filter((r) => r.userId === userId);
  return {
    isGlobalAdmin: own.some((r) => r.roleId === ROLE_IDS.globalAdmin),
    ownedDepartmentIds: own.flatMap((r) =>
      r.roleId === ROLE_IDS.owner && r.departmentId !== null
        ? [r.departmentId]
        : [],
    ),
  };
}

// ---- 147-B の書き込みの条件（案件の行は別名 k） ----

const K_ID = sql`k.id`;
const K_ROOM = sql`k.channel_id`;

/** 案件があり、進行中で、extra を満たすこと */
function activeCaseWith(caseId: string, extra: SQL): SQL {
  return sql`EXISTS (SELECT 1 FROM cases k WHERE k.id = ${caseId} AND k.status = 'active' AND ${extra})`;
}

/** 参加の行があること（有効性は問わない。退職者の行も含む） */
function hasMembershipRow(userId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM channel_members tm WHERE tm.channel_id = ${K_ROOM} AND tm.user_id = ${userId})`;
}

/**
 * 自動参加の人＝有効で、全体管理者か、案件の担当部署のどれかのオーナー（autoRoleOf と同じ意味。いまの割り当て）。
 * 管理の資格（canManageSql）と同じ条件になるため、それを使う
 */
const autoParticipantSql = (userId: string) => canManageSql(userId, K_ID);

/** 前提の確認：条件が崩れていたら cases.version を NULL にして NOT NULL 違反で batch 全体を取り消す */
function assertStatement(db: Database, caseId: string, condition: SQL) {
  return db
    .update(cases)
    .set({
      version: sql`CASE WHEN ${condition} THEN ${cases.version} ELSE NULL END`,
    })
    .where(eq(cases.id, caseId));
}

/** 最初の判定の材料（Service が判定の関数に渡す）。案件がなければ null */
export type CaseWriteFacts = {
  status: CaseStatus;
  dueDate: string | null;
  actorIsParticipant: boolean;
  actorCanManage: boolean;
  /** 有効な参加者の数（自動参加の人も数える。Q1） */
  activeParticipantCount: number;
  caseDepartmentIds: string[];
  /** 対象の社員（指定したときだけ）。いなければ null */
  target: {
    isActive: boolean;
    isParticipant: boolean;
    isGlobalAdmin: boolean;
    ownedDepartmentIds: string[];
  } | null;
};

export type CaseParticipantWriteInput = {
  caseId: string;
  actorId: string;
  userId: string;
  traceId: string;
};

export type CaseDueDateWriteInput = {
  caseId: string;
  actorId: string;
  /** 判定で読んだ今の納期。batch の時点でも同じことを前提にする */
  before: string | null;
  after: string | null;
  traceId: string;
};

function cursorFor(row: { id: string }) {
  if (!isUlid(row.id)) throw new Error("案件IDが不正です");
  return { v: row.id, id: row.id };
}

export function createCaseRepository(db: Database) {
  /** 案件の行と、同じ文の中で決めた資格・参加者数 */
  const selectRows = (actorId: string) => {
    const isParticipant = activeChannelMember(sql`${cases.channelId}`, actorId);
    const canManage = canManageSql(actorId, sql`${cases.id}`);
    return db
      .select({
        id: cases.id,
        caseNumber: cases.caseNumber,
        title: cases.title,
        status: cases.status,
        dueDate: cases.dueDate,
        clientId: clients.id,
        clientName: clients.name,
        clientIsActive: clients.isActive,
        isParticipant: sql<number>`CASE WHEN ${isParticipant} THEN 1 ELSE 0 END`,
        canManage: sql<number>`CASE WHEN ${canManage} THEN 1 ELSE 0 END`,
        canEditDueDate: sql<number>`CASE WHEN ${cases.status} = 'active' AND (${isParticipant} OR ${canManage}) THEN 1 ELSE 0 END`,
        participantCount: sql<
          number | null
        >`CASE WHEN ${isParticipant} OR ${canManage} THEN (SELECT COUNT(*) FROM channel_members pc WHERE pc.channel_id = ${cases.channelId}) ELSE NULL END`,
      })
      .from(cases)
      .innerJoin(clients, eq(clients.id, cases.clientId));
  };

  type Row = Awaited<
    ReturnType<ReturnType<typeof selectRows>["where"]>
  >[number];

  /** 行に担当部署を付ける（ページ全体で1回の読み込み） */
  async function toSummaries(rows: Row[]): Promise<CaseSummary[]> {
    if (rows.length === 0) return [];
    const departmentRows = await db
      .select({
        caseId: caseDepartments.caseId,
        id: departments.id,
        name: departments.name,
        isActive: departments.isActive,
      })
      .from(caseDepartments)
      .innerJoin(departments, eq(departments.id, caseDepartments.departmentId))
      .where(
        sql`${caseDepartments.caseId} IN (SELECT value FROM json_each(${jsonIds(rows.map((row) => row.id))}))`,
      )
      .orderBy(asc(departments.name), asc(departments.id));
    return rows.map((row) => ({
      id: row.id,
      caseNumber: row.caseNumber,
      title: row.title,
      status: row.status,
      client: {
        id: row.clientId,
        name: row.clientName,
        isActive: row.clientIsActive,
      },
      departments: departmentRows
        .filter((d) => d.caseId === row.id)
        .map(({ id, name, isActive }) => ({ id, name, isActive })),
      dueDate: row.dueDate,
      isParticipant: row.isParticipant === 1,
      canManage: row.canManage === 1,
      canEditDueDate: row.canEditDueDate === 1,
      participantCount: row.participantCount,
    }));
  }

  return {
    /** 一覧：案件 ID の降順。joined は有効な参加者の案件だけ */
    async list(input: {
      actorId: string;
      scope: CaseListScope;
      status: CaseStatus;
      limit: number;
      cursor?: CursorPayload;
    }): Promise<{ items: CaseSummary[]; nextCursor: string | null }> {
      const conditions: SQL[] = [eq(cases.status, input.status)];
      if (input.scope === "joined")
        conditions.push(
          activeChannelMember(sql`${cases.channelId}`, input.actorId),
        );
      if (input.cursor !== undefined)
        conditions.push(
          afterCursor({ sort: cases.id, id: cases.id }, input.cursor, "desc"),
        );
      const rows = await selectRows(input.actorId)
        .where(and(...conditions))
        .orderBy(desc(cases.id))
        .limit(input.limit + 1);
      const page = toPage(rows, input.limit, cursorFor);
      return {
        items: await toSummaries(page.items),
        nextCursor: page.nextCursor,
      };
    },

    /** 概要を1件読む（存在しなければ null） */
    async findSummary(input: {
      actorId: string;
      caseId: string;
    }): Promise<CaseSummary | null> {
      const rows = await selectRows(input.actorId)
        .where(eq(cases.id, input.caseId))
        .limit(1);
      const [item] = await toSummaries(rows);
      return item ?? null;
    },

    /**
     * 詳細だけの項目を読む。資格の確認と中身の読み取りを1つの batch（同じ時点）で行う：
     * 案件の行は「有効な参加者か」の判定と一緒に読み、参加者の一覧の文にも同じ条件を入れる。資格がなければ中身を捨てる。
     * 参加者は参加した日時の順（同じなら利用者 ID の順）。退職者（無効）の行も残す（C-142(1)）。本名・メールは読まない
     */
    async findDetailExtras(input: {
      caseId: string;
      actorId: string;
    }): Promise<CaseDetailExtras | "not_visible" | "not_found"> {
      const visible = activeChannelMember(
        sql`${cases.channelId}`,
        input.actorId,
      );
      const [caseRows, participantRows, roleRows, departmentRows] =
        await db.batch([
          db
            .select({
              description: cases.description,
              channelId: cases.channelId,
              createdBy: cases.createdBy,
              visible: sql<number>`CASE WHEN ${visible} THEN 1 ELSE 0 END`,
            })
            .from(cases)
            .where(eq(cases.id, input.caseId))
            .limit(1),
          db
            .select({
              userId: users.id,
              displayName: users.displayName,
              departmentName: departments.name,
              isActive: users.isActive,
            })
            .from(channelMembers)
            .innerJoin(cases, eq(cases.channelId, channelMembers.channelId))
            .innerJoin(users, eq(users.id, channelMembers.userId))
            .leftJoin(departments, eq(departments.id, users.departmentId))
            .where(and(eq(cases.id, input.caseId), visible))
            .orderBy(asc(channelMembers.joinedAt), asc(channelMembers.userId)),
          participantRolesQuery(db, input.caseId, input.actorId),
          caseDepartmentIdsQuery(db, input.caseId, input.actorId),
        ]);
      const [found] = caseRows;
      if (found === undefined) return "not_found";
      if (found.visible !== 1) return "not_visible";
      const caseDepartmentIds = departmentRows.map((d) => d.departmentId);
      const activeCount = participantRows.filter((p) => p.isActive).length;
      return {
        description: found.description,
        channelId: found.channelId,
        createdBy: found.createdBy,
        participants: participantRows.map((p) => {
          const autoRole = autoRoleOf({
            isActive: p.isActive,
            ...rolesOf(roleRows, p.userId),
            caseDepartmentIds,
          });
          return {
            ...p,
            isCreator: p.userId === found.createdBy,
            autoRole,
            removable: canRemoveParticipant({
              targetAutoRole: autoRole,
              activeCountAfter: activeCount - (p.isActive ? 1 : 0),
            }),
          };
        }),
      };
    },

    /**
     * 参加者の追加・削除・納期の変更の判定の材料を、同じ時点（1つの batch）で読む。案件がなければ null。
     * 対象（targetId）を渡したときだけ、対象の社員の状態と割り当てを読む
     */
    async findWriteFacts(input: {
      caseId: string;
      actorId: string;
      targetId?: string;
    }): Promise<CaseWriteFacts | null> {
      const caseQuery = db
        .select({
          status: cases.status,
          dueDate: cases.dueDate,
          actorIsParticipant: sql<number>`CASE WHEN ${activeChannelMember(sql`"cases"."channel_id"`, input.actorId)} THEN 1 ELSE 0 END`,
          actorCanManage: sql<number>`CASE WHEN ${canManageSql(input.actorId, sql`"cases"."id"`)} THEN 1 ELSE 0 END`,
          activeParticipantCount: sql<number>`(SELECT COUNT(*) FROM channel_members am
            JOIN users au ON au.id = am.user_id AND au.is_active = 1
            WHERE am.channel_id = "cases"."channel_id")`,
        })
        .from(cases)
        .where(eq(cases.id, input.caseId))
        .limit(1);
      const departmentQuery = db
        .select({ departmentId: caseDepartments.departmentId })
        .from(caseDepartments)
        .where(eq(caseDepartments.caseId, input.caseId));
      type CaseRow = Awaited<typeof caseQuery>[number];
      const toFacts = (
        row: CaseRow | undefined,
        departmentRows: { departmentId: string }[],
      ): CaseWriteFacts | null =>
        row === undefined
          ? null
          : {
              status: row.status,
              dueDate: row.dueDate,
              actorIsParticipant: row.actorIsParticipant === 1,
              actorCanManage: row.actorCanManage === 1,
              activeParticipantCount: row.activeParticipantCount,
              caseDepartmentIds: departmentRows.map((d) => d.departmentId),
              target: null,
            };
      const targetId = input.targetId;
      if (targetId === undefined) {
        const [caseRows, departmentRows] = await db.batch([
          caseQuery,
          departmentQuery,
        ]);
        return toFacts(caseRows[0], departmentRows);
      }
      const [caseRows, departmentRows, targetRows, roleRows] = await db.batch([
        caseQuery,
        departmentQuery,
        db
          .select({
            isActive: users.isActive,
            isParticipant: sql<number>`CASE WHEN EXISTS (SELECT 1 FROM channel_members tm
              JOIN cases tc ON tc.channel_id = tm.channel_id
              WHERE tc.id = ${input.caseId} AND tm.user_id = ${targetId}) THEN 1 ELSE 0 END`,
          })
          .from(users)
          .where(eq(users.id, targetId))
          .limit(1),
        roleRowsQuery(db, eq(userRoleAssignments.userId, targetId)),
      ]);
      const facts = toFacts(caseRows[0], departmentRows);
      const [target] = targetRows;
      if (facts === null || target === undefined) return facts;
      return {
        ...facts,
        target: {
          isActive: target.isActive,
          isParticipant: target.isParticipant === 1,
          ...rolesOf(roleRows, targetId),
        },
      };
    },

    /**
     * 参加者の追加：前提 → 監査 → 参加の行の挿入。前提が崩れていたら CaseStateChangedError で、何も残さない。
     * 前提：進行中・操作者が有効な参加者・対象が有効で、参加の行がない
     */
    async addParticipant(input: CaseParticipantWriteInput): Promise<void> {
      const condition = activeCaseWith(
        input.caseId,
        sql`${activeChannelMember(K_ROOM, input.actorId)}
          AND EXISTS (SELECT 1 FROM users t WHERE t.id = ${input.userId} AND t.is_active = 1)
          AND NOT ${hasMembershipRow(input.userId)}`,
      );
      const now = new Date().toISOString();
      const [, , inserted] = await runWriteBatch(() =>
        db.batch([
          assertStatement(db, input.caseId, condition),
          auditLogInsert(
            db,
            {
              actorId: input.actorId,
              action: "case.participant.add",
              targetType: "case",
              targetId: input.caseId,
              result: "success",
              traceId: input.traceId,
              detail: { caseId: input.caseId, userId: input.userId },
            },
            { onlyWhen: condition },
          ),
          db
            .insert(channelMembers)
            .select(
              sql`SELECT c.channel_id, ${input.userId}, ${now} FROM cases c WHERE c.id = ${input.caseId} AND ${condition}`,
            )
            .returning({ userId: channelMembers.userId }),
        ]),
      );
      if (inserted.length === 0) throw new CaseStateChangedError();
    },

    /**
     * 参加者の削除・本人の退出：前提 → 監査 → 参加の行の削除 → 不変条件（有効な参加者が1人以上。Q1）。
     * 前提：進行中・操作者が有効な参加者・対象に参加の行があり、自動参加の人でない（Q2）。崩れたら CaseStateChangedError
     */
    async removeParticipant(input: CaseParticipantWriteInput): Promise<void> {
      const condition = activeCaseWith(
        input.caseId,
        sql`${activeChannelMember(K_ROOM, input.actorId)}
          AND ${hasMembershipRow(input.userId)}
          AND NOT ${autoParticipantSql(input.userId)}`,
      );
      const atLeastOneActive = sql`EXISTS (SELECT 1 FROM cases k WHERE k.id = ${input.caseId}
        AND EXISTS (SELECT 1 FROM channel_members m JOIN users u ON u.id = m.user_id AND u.is_active = 1
          WHERE m.channel_id = k.channel_id))`;
      const [, , removed] = await runWriteBatch(() =>
        db.batch([
          assertStatement(db, input.caseId, condition),
          auditLogInsert(
            db,
            {
              actorId: input.actorId,
              action: "case.participant.remove",
              targetType: "case",
              targetId: input.caseId,
              result: "success",
              traceId: input.traceId,
              detail: {
                caseId: input.caseId,
                userId: input.userId,
                self: input.userId === input.actorId,
              },
            },
            { onlyWhen: condition },
          ),
          db
            .delete(channelMembers)
            .where(
              and(
                eq(channelMembers.userId, input.userId),
                sql`${channelMembers.channelId} = (SELECT c.channel_id FROM cases c WHERE c.id = ${input.caseId})`,
                condition,
              ),
            )
            .returning({ userId: channelMembers.userId }),
          assertStatement(db, input.caseId, atLeastOneActive),
        ]),
      );
      if (removed.length === 0) throw new CaseStateChangedError();
    },

    /**
     * 納期の変更：前提 → 監査 → 案件の行の更新（版に1を足す）。
     * 前提：進行中・操作者が有効な参加者か管理の資格がある・納期が読んだ値のまま。崩れたら CaseStateChangedError
     */
    async changeDueDate(input: CaseDueDateWriteInput): Promise<void> {
      const condition = activeCaseWith(
        input.caseId,
        sql`(${activeChannelMember(K_ROOM, input.actorId)} OR ${canManageSql(input.actorId, K_ID)})
          AND k.due_date IS ${input.before}`,
      );
      const [, , updated] = await runWriteBatch(() =>
        db.batch([
          assertStatement(db, input.caseId, condition),
          auditLogInsert(
            db,
            {
              actorId: input.actorId,
              action: "case.due_date.change",
              targetType: "case",
              targetId: input.caseId,
              result: "success",
              traceId: input.traceId,
              detail: {
                caseId: input.caseId,
                before: input.before,
                after: input.after,
              },
            },
            { onlyWhen: condition },
          ),
          db
            .update(cases)
            .set({
              dueDate: input.after,
              version: sql`${cases.version} + 1`,
              updatedAt: new Date().toISOString(),
            })
            .where(and(eq(cases.id, input.caseId), condition))
            .returning({ id: cases.id }),
        ]),
      );
      if (updated.length === 0) throw new CaseStateChangedError();
    },
  };
}

export type CaseRepository = ReturnType<typeof createCaseRepository>;

export function withCases<T>(
  env: Env,
  run: (
    repository: CaseRepository,
    roles: RoleAssignmentRepository,
  ) => Promise<T>,
): Promise<T> {
  return withDatabase(env, (db) =>
    run(createCaseRepository(db), createRoleAssignmentRepository(db)),
  );
}
