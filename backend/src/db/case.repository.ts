// Repository：案件の一覧・概要・詳細（#147 の 147-A）。読み取りだけ。DB へのアクセスはこの層に閉じ込める。
// 見える範囲は SQL で絞る（joined は「有効な参加者」の案件だけ）。説明・チャンネル ID・参加者は詳細の読み込みでだけ返す。
// 担当部署・参加者数は、そのページの案件 ID（チャンネル ID）を json_each の1つの値で渡して、まとめて読む（N+1 にしない。
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
import { canManageCase } from "../lib/case-access-rules";
import { afterCursor, toPage, type CursorPayload } from "../lib/cursor";
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

/**
 * 操作者の管理の資格の元（Service が割り当てを1回読んで渡す）。
 * 無効な操作者は、Service の時点で全体管理者でもオーナーでもない扱いにしてある（reviewerFactsOf）
 */
export type CaseViewer = {
  actorId: string;
  isGlobalAdmin: boolean;
  ownedDepartmentIds: readonly string[];
};

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

function cursorFor(row: { id: string }) {
  if (!isUlid(row.id)) throw new Error("案件IDが不正です");
  return { v: row.id, id: row.id };
}

export function createCaseRepository(db: Database) {
  const selectRows = (actorId: string) =>
    db
      .select({
        id: cases.id,
        caseNumber: cases.caseNumber,
        title: cases.title,
        status: cases.status,
        dueDate: cases.dueDate,
        channelId: cases.channelId,
        clientId: clients.id,
        clientName: clients.name,
        clientIsActive: clients.isActive,
        isParticipant: sql<number>`CASE WHEN ${activeChannelMember(sql`${cases.channelId}`, actorId)} THEN 1 ELSE 0 END`,
      })
      .from(cases)
      .innerJoin(clients, eq(clients.id, cases.clientId));

  type Row = Awaited<
    ReturnType<ReturnType<typeof selectRows>["where"]>
  >[number];

  /** 行に担当部署・管理の資格・参加者数を付ける（読み込みはページ全体で2回まで） */
  async function toSummaries(
    rows: Row[],
    viewer: CaseViewer,
  ): Promise<CaseSummary[]> {
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
    const shaped = rows.map((row) => {
      const caseDepartmentRows = departmentRows
        .filter((d) => d.caseId === row.id)
        .map(({ id, name, isActive }) => ({ id, name, isActive }));
      const isParticipant = row.isParticipant === 1;
      const canManage = canManageCase({
        isActive: true,
        isGlobalAdmin: viewer.isGlobalAdmin,
        ownedDepartmentIds: viewer.ownedDepartmentIds,
        caseDepartmentIds: caseDepartmentRows.map((d) => d.id),
      });
      return { row, departments: caseDepartmentRows, isParticipant, canManage };
    });
    // 参加者数は、参加者か管理の資格のある人の行だけ数える
    const countedRoomIds = shaped
      .filter((s) => s.isParticipant || s.canManage)
      .map((s) => s.row.channelId);
    const counts =
      countedRoomIds.length === 0
        ? []
        : await db
            .select({
              channelId: channelMembers.channelId,
              n: sql<number>`COUNT(*)`,
            })
            .from(channelMembers)
            .where(
              sql`${channelMembers.channelId} IN (SELECT value FROM json_each(${jsonIds(countedRoomIds)}))`,
            )
            .groupBy(channelMembers.channelId);
    return shaped.map(({ row, departments: caseDepartmentRows, ...access }) => {
      const counted = countedRoomIds.includes(row.channelId);
      return {
        id: row.id,
        caseNumber: row.caseNumber,
        title: row.title,
        status: row.status,
        client: {
          id: row.clientId,
          name: row.clientName,
          isActive: row.clientIsActive,
        },
        departments: caseDepartmentRows,
        dueDate: row.dueDate,
        isParticipant: access.isParticipant,
        canManage: access.canManage,
        participantCount: counted
          ? (counts.find((c) => c.channelId === row.channelId)?.n ?? 0)
          : null,
      };
    });
  }

  return {
    /** 一覧：案件 ID の降順。joined は有効な参加者の案件だけ */
    async list(
      input: CaseViewer & {
        scope: CaseListScope;
        status: CaseStatus;
        limit: number;
        cursor?: CursorPayload;
      },
    ): Promise<{ items: CaseSummary[]; nextCursor: string | null }> {
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
        items: await toSummaries(page.items, input),
        nextCursor: page.nextCursor,
      };
    },

    /** 概要を1件読む（存在しなければ null） */
    async findSummary(
      input: CaseViewer & { caseId: string },
    ): Promise<CaseSummary | null> {
      const rows = await selectRows(input.actorId)
        .where(eq(cases.id, input.caseId))
        .limit(1);
      const [item] = await toSummaries(rows, input);
      return item ?? null;
    },

    /**
     * 詳細だけの項目を読む。呼び出し元が、操作者が有効な参加者であることを確かめてから呼ぶ。
     * 参加者は参加した日時の順（同じなら利用者 ID の順）。退職者（無効）の行も残す（C-142(1)）。本名・メールは読まない
     */
    async findDetailExtras(caseId: string): Promise<CaseDetailExtras | null> {
      const [found] = await db
        .select({
          description: cases.description,
          channelId: cases.channelId,
          createdBy: cases.createdBy,
        })
        .from(cases)
        .where(eq(cases.id, caseId))
        .limit(1);
      if (found === undefined) return null;
      const participantRows = await db
        .select({
          userId: users.id,
          displayName: users.displayName,
          departmentName: departments.name,
          isActive: users.isActive,
        })
        .from(channelMembers)
        .innerJoin(users, eq(users.id, channelMembers.userId))
        .leftJoin(departments, eq(departments.id, users.departmentId))
        .where(eq(channelMembers.channelId, found.channelId))
        .orderBy(asc(channelMembers.joinedAt), asc(channelMembers.userId));
      return {
        ...found,
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
