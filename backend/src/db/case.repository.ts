// Repository：案件の一覧・概要・詳細（#147 の 147-A）。読み取りだけ。DB へのアクセスはこの層に閉じ込める。
// 見える範囲は SQL で絞る（joined は「有効な参加者」の案件だけ）。説明・チャンネル ID・参加者は詳細の読み込みでだけ返す。
// 資格（有効な参加者・管理の資格）は、先に読んだ材料に頼らず、中身（参加者数・説明・参加者）を読む SQL そのものの条件にする。
// 先に確かめてから別に読むと、その間に無効化・交代が確定した要求に中身が返るため（コードレビュー1回目）。
// 担当部署は、そのページの案件 ID を json_each の1つの値で渡して、まとめて読む（N+1 にしない。
// D1 の束縛する値の数の上限に、件数が掛からないようにする）。
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import {
  caseDepartments,
  cases,
  channelMembers,
  clients,
  departments,
  users,
} from "../../db/schema";
import { afterCursor, toPage, type CursorPayload } from "../lib/cursor";
import { ROLE_IDS } from "../lib/permissions";
import { isUlid } from "../lib/ulid";
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
  /** 参加の行の数（退職者を含む）。参加者か管理の資格のある人だけに入れる */
  participantCount: number | null;
};

export type CaseParticipant = {
  userId: string;
  displayName: string;
  departmentName: string | null;
  isActive: boolean;
  isCreator: boolean;
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
function canManageSql(actorId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM users mu WHERE mu.id = ${actorId} AND mu.is_active = 1 AND (
    EXISTS (SELECT 1 FROM user_role_assignments ga
      WHERE ga.user_id = mu.id AND ga.role_id = ${ROLE_IDS.globalAdmin} AND ga.scope_type = 'company')
    OR EXISTS (SELECT 1 FROM user_role_assignments oa
      JOIN case_departments ocd ON ocd.department_id = oa.department_id
      WHERE oa.user_id = mu.id AND oa.role_id = ${ROLE_IDS.owner} AND oa.scope_type = 'department'
        AND ocd.case_id = ${cases.id})))`;
}

function cursorFor(row: { id: string }) {
  if (!isUlid(row.id)) throw new Error("案件IDが不正です");
  return { v: row.id, id: row.id };
}

export function createCaseRepository(db: Database) {
  /** 案件の行と、同じ文の中で決めた資格・参加者数 */
  const selectRows = (actorId: string) => {
    const isParticipant = activeChannelMember(sql`${cases.channelId}`, actorId);
    const canManage = canManageSql(actorId);
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
      const [caseRows, participantRows] = await db.batch([
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
      ]);
      const [found] = caseRows;
      if (found === undefined) return "not_found";
      if (found.visible !== 1) return "not_visible";
      return {
        description: found.description,
        channelId: found.channelId,
        createdBy: found.createdBy,
        participants: participantRows.map((p) => ({
          ...p,
          isCreator: p.userId === found.createdBy,
        })),
      };
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
