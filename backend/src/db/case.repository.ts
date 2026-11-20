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
  notifications,
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
import { isUlid, newUlid } from "../lib/ulid";
import {
  auditLogInsert,
  auditLogInsertRows,
  type AuditDetail,
} from "./audit-log.repository";
import { canManageSql } from "./case-access.sql";
import {
  caseAssigneeScope,
  caseAssigneesScope,
  readUnassignPlan,
  unassignPreSql,
  unassignStatements,
  type UnassignPlan,
} from "./case-todo-unassign.sql";
import {
  activeChannelMember,
  activeMembersEqual,
  recipientsUnchanged,
} from "./channel-member.sql";
import { withDatabase, type BatchItem, type Database } from "./database";
import {
  createRoleAssignmentRepository,
  type RoleAssignmentRepository,
} from "./role-assignment.repository";

export const CASE_LIST_SCOPES = ["joined", "all"] as const;
export const CASE_STATUSES = ["active", "closed"] as const;
export type CaseListScope = (typeof CASE_LIST_SCOPES)[number];
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** 一覧・概要の項目。説明・参加者は持たない。チャンネル ID・最終更新は有効な参加者にだけ返す */
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
  /** TODO の進捗（削除済みを除く。0件は null）。数だけなので全員に返す（R-78） */
  progress: { done: number; total: number } | null;
  /** 部屋の、削除されていない最新のメッセージ（返信を含む）の投稿の時刻。有効な参加者だけ（C-191(4)） */
  lastActivityAt: string | null;
  /** 未読の対応表を引くための部屋の ID。有効な参加者だけ（5-1 AC-2） */
  channelId: string | null;
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
  /** 案件の版（再編集の衝突の検知に使う。概要・一覧には返さない：説明だけの更新を非参加者に知らせないため） */
  version: number;
};

/** 詳細の応答：概要の項目と詳細だけの項目を、同じ読み取りの時点で読んだもの（#150 の 150-C 計画 4.2.1） */
export type CaseDetail = Omit<CaseSummary, "channelId"> & CaseDetailExtras;

const jsonIds = (ids: readonly string[]) => JSON.stringify(ids);

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

export async function runWriteBatch<T>(run: () => Promise<T>): Promise<T> {
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
export const K_ROOM = sql`k.channel_id`;

/** 案件があり、進行中で、extra を満たすこと */
export function activeCaseWith(caseId: string, extra: SQL): SQL {
  return sql`EXISTS (SELECT 1 FROM cases k WHERE k.id = ${caseId} AND k.status = 'active' AND ${extra})`;
}

/** 参加の行があること（有効性は問わない。退職者の行も含む） */
function hasMembershipRow(userId: string | SQL): SQL {
  return sql`EXISTS (SELECT 1 FROM channel_members tm WHERE tm.channel_id = ${K_ROOM} AND tm.user_id = ${userId})`;
}

/**
 * 自動参加の人＝有効で、全体管理者か、案件の担当部署のどれかのオーナー（autoRoleOf と同じ意味。いまの割り当て）。
 * 管理の資格（canManageSql）と同じ条件になるため、それを使う
 */
const autoParticipantSql = (userId: string | SQL) => canManageSql(userId, K_ID);

/** 前提の確認：条件が崩れていたら cases.version を NULL にして NOT NULL 違反で batch 全体を取り消す */
export function assertStatement(db: Database, caseId: string, condition: SQL) {
  return db
    .update(cases)
    .set({
      version: sql`CASE WHEN ${condition} THEN ${cases.version} ELSE NULL END`,
    })
    .where(eq(cases.id, caseId));
}

/** 必須の行を書いた直後に置く：直前の文の件数が expected でなければ、cases.version を NULL にして batch 全体を取り消す */
export function guardChanges(db: Database, caseId: string, expected: SQL) {
  return db
    .update(cases)
    .set({
      version: sql`CASE WHEN changes() = ${expected} THEN ${cases.version} ELSE NULL END`,
    })
    .where(eq(cases.id, caseId));
}

/** 末尾の不変条件：案件の有効な参加者が1人以上いること */
function atLeastOneActive(caseId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM cases k WHERE k.id = ${caseId}
    AND EXISTS (SELECT 1 FROM channel_members m JOIN users u ON u.id = m.user_id AND u.is_active = 1
      WHERE m.channel_id = k.channel_id))`;
}

/** 最初の判定の材料（Service が判定の関数に渡す）。案件がなければ null */
export type CaseWriteFacts = {
  status: CaseStatus;
  dueDate: string | null;
  /** 案件の版（終了・再開の前提。状態が一度変わって戻った場合も検出する） */
  version: number;
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

/** 終了の入力。version と recipientIds は最初の判定で読んだ値 */
export type CaseStatusWriteInput = {
  caseId: string;
  actorId: string;
  version: number;
  recipientIds: readonly string[];
  traceId: string;
};

/** 再開（選び直しつき）の判定の材料。案件がなければ null */
export type CaseReopenFacts = {
  status: CaseStatus;
  version: number;
  actorIsParticipant: boolean;
  actorCanManage: boolean;
  caseDepartmentIds: string[];
  /** いまの有効な参加者（無効な人の行は含まない） */
  activeParticipantIds: string[];
  /** 追加・除外に出た社員のうち、存在する人だけ */
  targets: {
    userId: string;
    isActive: boolean;
    hasMembershipRow: boolean;
    isGlobalAdmin: boolean;
    ownedDepartmentIds: string[];
  }[];
};

/**
 * 再開（選び直しつき）の入力。どれも省略できない（前提の条件を省けないようにする）。
 * participantIds は画面で見た有効な参加者、readRecipientIds は読んだ宛先、recipientIds は選び直しの後の宛先
 */
export type CaseReopenWriteInput = {
  caseId: string;
  actorId: string;
  version: number;
  participantIds: readonly string[];
  addUserIds: readonly string[];
  removeUserIds: readonly string[];
  readRecipientIds: readonly string[];
  recipientIds: readonly string[];
  traceId: string;
};

const STATUS_CHANGES = {
  close: {
    from: "active",
    to: "closed",
    action: "case.close",
    kind: "case.closed",
  },
  reopen: {
    from: "closed",
    to: "active",
    action: "case.reopen",
    kind: "case.reopened",
  },
} as const;

/** 再開の batch の文と、案件の更新（RETURNING）の位置 */
function composeReopen(
  db: Database,
  input: CaseReopenWriteInput,
  plan: UnassignPlan,
) {
  const { caseId, actorId } = input;
  const change = STATUS_CHANGES.reopen;
  const addJson = JSON.stringify(input.addUserIds);
  const removeJson = JSON.stringify(input.removeUserIds);
  const condition = sql`EXISTS (SELECT 1 FROM cases k WHERE k.id = ${caseId}
    AND k.status = ${change.from} AND k.version = ${input.version}
    AND ${activeChannelMember(K_ROOM, actorId)}
    AND ${recipientsUnchanged(K_ROOM, actorId, input.readRecipientIds)}
    AND ${activeMembersEqual(K_ROOM, input.participantIds)}
    AND NOT EXISTS (SELECT 1 FROM json_each(${addJson}) aj
      WHERE NOT EXISTS (SELECT 1 FROM users t WHERE t.id = aj.value AND t.is_active = 1)
        OR ${hasMembershipRow(sql`aj.value`)})
    AND NOT EXISTS (SELECT 1 FROM json_each(${removeJson}) rj
      WHERE rj.value = ${actorId} OR NOT ${hasMembershipRow(sql`rj.value`)}
        OR ${autoParticipantSql(sql`rj.value`)}))`;
  // 先頭の前提を通った後は、削除で「参加者の集合が一致」が崩れるため、後ろの文はこの batch がまだ状態を変えていないことだけを見る
  // （D1 の batch は1つのトランザクションなので、先頭を通れば後ろの文の時点でも前提は保たれる）
  const stillClosed = sql`EXISTS (SELECT 1 FROM cases k WHERE k.id = ${caseId}
    AND k.status = ${change.from} AND k.version = ${input.version})`;
  const guard = (expected: number) =>
    guardChanges(db, caseId, sql`${expected}`);
  const recipientIds = [...new Set(input.recipientIds)];
  const now = new Date().toISOString();
  const unassignScope = caseAssigneesScope(caseId, removeJson);
  const audit = {
    actorId,
    targetType: "case",
    targetId: caseId,
    result: "success",
    traceId: input.traceId,
  } as const;

  const statements: BatchItem[] = [
    assertStatement(
      db,
      caseId,
      sql`${condition} AND ${unassignPreSql(unassignScope, plan)}`,
    ),
    auditLogInsert(
      db,
      {
        ...audit,
        action: change.action,
        detail: {
          caseId,
          notifiedCount: recipientIds.length,
          addedCount: input.addUserIds.length,
          removedCount: input.removeUserIds.length,
        },
      },
      { onlyWhen: condition },
    ),
    guard(1),
  ];
  const changedCount = input.addUserIds.length + input.removeUserIds.length;
  if (changedCount > 0)
    statements.push(
      auditLogInsertRows(
        db,
        {
          ...audit,
          rows: [
            ...input.addUserIds.map((userId) => ({
              action: "case.participant.add" as const,
              detail: { caseId, userId, viaReopen: true },
            })),
            ...input.removeUserIds.map((userId) => ({
              action: "case.participant.remove" as const,
              detail: { caseId, userId, self: false, viaReopen: true },
            })),
          ],
        },
        { onlyWhen: condition },
      ),
      guard(changedCount),
    );
  // 外す人の TODO の担当の書き換え（149-D 計画 6.3.4）。外す人が0人でも置き、n=0 で通す。条件は規則だけで、stillClosed の材料を変えない
  statements.push(
    ...unassignStatements(db, {
      scope: unassignScope,
      plan,
      actorId,
      now,
      guard,
    }),
  );
  if (input.removeUserIds.length > 0)
    statements.push(
      db
        .delete(channelMembers)
        .where(
          and(
            sql`${channelMembers.channelId} = (SELECT c.channel_id FROM cases c WHERE c.id = ${caseId})`,
            sql`${channelMembers.userId} IN (SELECT value FROM json_each(${removeJson}))`,
            stillClosed,
          ),
        ),
      guard(input.removeUserIds.length),
    );
  if (input.addUserIds.length > 0)
    statements.push(
      db.insert(channelMembers).select(
        sql`SELECT c.channel_id, aj.value, ${now} FROM cases c, json_each(${addJson}) aj
            WHERE c.id = ${caseId} AND ${stillClosed}`,
      ),
      guard(input.addUserIds.length),
    );
  if (recipientIds.length > 0) {
    // ID と宛先の組を JSON の値1つで渡す。直後に、今回の組の行がすべてあることを確かめる（時刻では今回の通知を識別できないため）
    const rows = JSON.stringify(
      recipientIds.map((userId) => [newUlid(), userId]),
    );
    statements.push(
      db.insert(notifications).select(sql`
        SELECT json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]'), ${change.kind}, NULL, NULL, ${caseId}, ${now}, NULL
        FROM json_each(${rows}) j
        WHERE ${stillClosed}`),
      guard(recipientIds.length),
      assertStatement(
        db,
        caseId,
        sql`NOT EXISTS (SELECT 1 FROM json_each(${rows}) nj WHERE NOT EXISTS (
          SELECT 1 FROM notifications n WHERE n.id = json_extract(nj.value, '$[0]')
            AND n.user_id = json_extract(nj.value, '$[1]') AND n.kind = ${change.kind} AND n.target_id = ${caseId}))`,
      ),
    );
  }
  const updateAt = statements.length;
  statements.push(
    db
      .update(cases)
      .set({
        status: change.to,
        version: sql`${cases.version} + 1`,
        updatedAt: now,
      })
      .where(and(eq(cases.id, caseId), stillClosed))
      .returning({ id: cases.id }),
    guard(1),
    assertStatement(db, caseId, atLeastOneActive(caseId)),
  );
  return { statements, updateAt };
}

/** 再開で外す人が担当の TODO の、対象の件数と記録の ID（149-D 計画 6.3.4） */
function readReopenUnassignPlan(db: Database, input: CaseReopenWriteInput) {
  return readUnassignPlan(
    db,
    caseAssigneesScope(input.caseId, JSON.stringify(input.removeUserIds)),
  );
}

/**
 * 再開（選び直しつき）の batch の文（計画 150-B 6.3 の順）：前提 → 再開の監査 → 人ごとの監査 → 外す人の TODO の担当の書き換え（149-D）
 * → 参加の行の削除 → 追加 → 通知 → 案件の更新 → 不変条件。条件つきの文は0行でも失敗しないため、必須の文の直後に件数の確認を置く
 */
export async function buildReopenStatements(
  db: Database,
  input: CaseReopenWriteInput,
): Promise<BatchItem[]> {
  const plan = await readReopenUnassignPlan(db, input);
  return composeReopen(db, input, plan).statements;
}

/**
 * 参加者の削除・本人の退出の batch の文（計画 149-D 6.3.3 の順）：前提 → 監査 → 確認 → 外れた人の TODO の担当の書き換え（4文）
 * → 参加の行の削除 → 確認 → 不変条件（有効な参加者が1人以上。Q1）。
 * 前提：進行中・操作者が有効な参加者・対象に参加の行があり、自動参加の人でない（Q2）・TODO の対象の件数と記録の ID が読んだときのまま
 */
export function buildRemoveParticipantStatements(
  db: Database,
  input: CaseParticipantWriteInput,
  plan: UnassignPlan,
): BatchItem[] {
  const condition = activeCaseWith(
    input.caseId,
    sql`${activeChannelMember(K_ROOM, input.actorId)}
      AND ${hasMembershipRow(input.userId)}
      AND NOT ${autoParticipantSql(input.userId)}`,
  );
  const scope = caseAssigneeScope(input.caseId, input.userId);
  const guard = (expected: number) =>
    guardChanges(db, input.caseId, sql`${expected}`);
  return [
    assertStatement(
      db,
      input.caseId,
      sql`${condition} AND ${unassignPreSql(scope, plan)}`,
    ),
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
    guard(1),
    ...unassignStatements(db, {
      scope,
      plan,
      actorId: input.actorId,
      now: new Date().toISOString(),
      guard,
    }),
    // 担当の書き換えは condition の材料（案件・参加の行・ロール）を変えないので、ここでも condition は前提のときと同じ値になる
    db
      .delete(channelMembers)
      .where(
        and(
          eq(channelMembers.userId, input.userId),
          sql`${channelMembers.channelId} = (SELECT c.channel_id FROM cases c WHERE c.id = ${input.caseId})`,
          condition,
        ),
      ),
    guard(1),
    assertStatement(db, input.caseId, atLeastOneActive(input.caseId)),
  ];
}

// ---- 再編集（#150 の 150-C。EP-5-20） ----

type EditClient = { id: string; code: string; name: string };

/** 再編集の判定の材料（Service が decideEdit に渡す）。案件がなければ null。説明はサーバーの中の比較にだけ使う */
export type CaseEditFacts = {
  status: CaseStatus;
  version: number;
  title: string;
  description: string;
  actorIsParticipant: boolean;
  actorCanManage: boolean;
  /** いまの取引先 */
  client: EditClient;
  /** 本文の clientId の取引先（指定なし・存在しないなら null） */
  requestedClient: (EditClient & { isActive: boolean }) | null;
  /** いまの担当部署（昇順） */
  departmentIds: string[];
  /** 本文の departmentIds のうち、存在する部署 */
  requestedDepartments: { id: string; isActive: boolean }[];
  /** 足す部署の有効なオーナーで、参加の行がない人（重複なし・昇順） */
  joinUserIds: string[];
};

/**
 * 再編集の入力。basis は衝突の検知（参加者は版、非参加の管理者は概要で見た値）。before は読んだ材料（監査の前の値・「読んだまま」の前提）。
 * title・description・client・departmentIds は変える項目だけ（件名は整形後）
 */
export type CaseEditWriteInput = {
  caseId: string;
  actorId: string;
  traceId: string;
  basis:
    | { version: number }
    | {
        expected: {
          title: string;
          clientId: string;
          departmentIds: readonly string[];
        };
      };
  before: {
    title: string;
    client: EditClient;
    departmentIds: readonly string[];
  };
  title?: string;
  description?: string;
  client?: EditClient;
  departmentIds?: readonly string[];
  joinUserIds: readonly string[];
};

/** 案件（別名 k）の担当部署の集合が ids と同じであること。ID は JSON の値1つで渡す */
function caseDepartmentsEqual(ids: readonly string[]): SQL {
  const json = jsonIds(ids);
  return sql`(SELECT COUNT(*) FROM case_departments ed WHERE ed.case_id = ${K_ID}) = ${ids.length}
    AND (SELECT COUNT(*) FROM case_departments ed WHERE ed.case_id = ${K_ID}
      AND ed.department_id IN (SELECT value FROM json_each(${json}))) = ${ids.length}`;
}

/**
 * 自動参加させる人：departmentSet（部署の ID を返す副問い合わせ）の有効なオーナーで、部屋 room に参加の行がない人（利用者で重複を除く）。
 * 承認のときの自動参加と同じ規則（有効なオーナー・scope_type = 'department'）
 */
function pendingOwnersSql(room: SQL, departmentSet: SQL): SQL {
  return sql`SELECT DISTINCT oa.user_id AS user_id FROM user_role_assignments oa
    JOIN users ou ON ou.id = oa.user_id AND ou.is_active = 1
    WHERE oa.role_id = ${ROLE_IDS.owner} AND oa.scope_type = 'department'
      AND oa.department_id IN (${departmentSet})
      AND NOT EXISTS (SELECT 1 FROM channel_members jm WHERE jm.channel_id = ${room} AND jm.user_id = oa.user_id)`;
}

const idsSql = (json: string) => sql`SELECT value FROM json_each(${json})`;

/** 担当部署の付け替え（読んだ集合 → 求めた集合）の、外す部署と足す部署 */
function departmentDiff(input: CaseEditWriteInput) {
  const after = input.departmentIds;
  if (after === undefined) return { removed: [], added: [] };
  const before = new Set(input.before.departmentIds);
  const next = new Set(after);
  return {
    removed: input.before.departmentIds.filter((id) => !next.has(id)),
    added: after.filter((id) => !before.has(id)),
  };
}

const sortedIds = (ids: readonly string[]) => [...ids].sort();

/** 監査 case.edit の detail（平ら。変えた項目のキーだけ。説明の本文は入れない） */
function editAuditDetail(input: CaseEditWriteInput): AuditDetail {
  const changed: string[] = [];
  const detail: AuditDetail = { caseId: input.caseId };
  if (input.title !== undefined) {
    changed.push("title");
    detail.titleBefore = input.before.title;
    detail.titleAfter = input.title;
  }
  if (input.description !== undefined) {
    changed.push("description");
    detail.descriptionChanged = true;
  }
  if (input.client !== undefined) {
    changed.push("client");
    Object.assign(detail, {
      clientIdBefore: input.before.client.id,
      clientCodeBefore: input.before.client.code,
      clientNameBefore: input.before.client.name,
      clientIdAfter: input.client.id,
      clientCodeAfter: input.client.code,
      clientNameAfter: input.client.name,
    });
  }
  if (input.departmentIds !== undefined) {
    changed.push("departments");
    const { removed, added } = departmentDiff(input);
    Object.assign(detail, {
      departmentIdsBefore: sortedIds(input.before.departmentIds).join(","),
      departmentIdsAfter: sortedIds(input.departmentIds).join(","),
      departmentAddedCount: added.length,
      departmentRemovedCount: removed.length,
      caseJoinCount: input.joinUserIds.length,
    });
  }
  return { caseId: input.caseId, changedFields: changed.join(","), ...detail };
}

/**
 * 再編集の前提（1つの SQL。案件があることも含む）：進行中・衝突の検知（版、または概要で見た件名・取引先・担当部署の集合）・
 * 操作者の資格・各変更の条件（説明は有効な参加者だけ・新しい取引先が有効・担当部署が読んだまま・足す部署が有効・自動参加させる人が読んだまま）
 */
function editCondition(input: CaseEditWriteInput): SQL {
  const { caseId, actorId, basis } = input;
  const isParticipant = activeChannelMember(K_ROOM, actorId);
  const parts: SQL[] = [
    sql`(${isParticipant} OR ${canManageSql(actorId, K_ID)})`,
  ];
  // 版の方式でも担当部署の集合を確かめる：担当部署の付け替えは版を進めないため（変える項目によらない）
  if ("version" in basis)
    parts.push(
      sql`k.version = ${basis.version}`,
      isParticipant,
      caseDepartmentsEqual(input.before.departmentIds),
    );
  else
    parts.push(
      sql`k.title = ${basis.expected.title}`,
      sql`k.client_id = ${basis.expected.clientId}`,
      caseDepartmentsEqual(basis.expected.departmentIds),
    );
  if (input.description !== undefined) parts.push(isParticipant);
  if (input.client !== undefined && input.client.id !== input.before.client.id)
    parts.push(
      sql`EXISTS (SELECT 1 FROM clients nc WHERE nc.id = ${input.client.id} AND nc.is_active = 1)`,
    );
  if (input.departmentIds !== undefined) {
    const { added } = departmentDiff(input);
    const addJson = jsonIds(added);
    const pending = pendingOwnersSql(K_ROOM, idsSql(addJson));
    const joinJson = jsonIds(input.joinUserIds);
    const n = input.joinUserIds.length;
    if (!("version" in basis))
      parts.push(caseDepartmentsEqual(input.before.departmentIds));
    parts.push(
      sql`NOT EXISTS (SELECT 1 FROM json_each(${addJson}) na WHERE NOT EXISTS (
        SELECT 1 FROM departments nd WHERE nd.id = na.value AND nd.is_active = 1))`,
      sql`(SELECT COUNT(*) FROM (${pending})) = ${n}
        AND (SELECT COUNT(*) FROM (${pending}) po WHERE po.user_id IN (${idsSql(joinJson)})) = ${n}`,
    );
  }
  return activeCaseWith(caseId, sql.join(parts, sql` AND `));
}

/**
 * 再編集の batch の文（計画 150-C 4.4 の順）：1 前提 → 2 監査 → 確認 → 3 担当部署の削除 → 確認 → 4 追加 → 確認
 * → 5 自動参加 → 確認 → 6 案件の更新（RETURNING）→ 確認 → 7 不変条件（担当部署が1件以上）。最大12文で、部署・人の数に比例しない。
 * 後ろの文は案件の ID と進行中だけを見る（先頭を通れば、D1 の batch は1つのトランザクションで前提は保たれる。
 * 版を後ろで求めないのは、expected の方式で読んだ後に説明・納期だけが変わっても崩さないため）
 */
export function buildEditStatements(
  db: Database,
  input: CaseEditWriteInput,
): BatchItem[] {
  const { caseId } = input;
  const condition = editCondition(input);
  const stillEditable = activeCaseWith(caseId, sql`1 = 1`);
  const guard = (expected: number) =>
    guardChanges(db, caseId, sql`${expected}`);
  const now = new Date().toISOString();
  const statements: BatchItem[] = [
    assertStatement(db, caseId, condition),
    auditLogInsert(
      db,
      {
        actorId: input.actorId,
        action: "case.edit",
        targetType: "case",
        targetId: caseId,
        result: "success",
        traceId: input.traceId,
        detail: editAuditDetail(input),
      },
      { onlyWhen: condition },
    ),
    guard(1),
  ];
  const after = input.departmentIds;
  if (after !== undefined) {
    const { removed, added } = departmentDiff(input);
    if (removed.length > 0)
      statements.push(
        db
          .delete(caseDepartments)
          .where(
            and(
              eq(caseDepartments.caseId, caseId),
              sql`${caseDepartments.departmentId} NOT IN (${idsSql(jsonIds(after))})`,
              stillEditable,
            ),
          ),
        guard(removed.length),
      );
    if (added.length > 0)
      statements.push(
        db
          .insert(caseDepartments)
          .select(
            sql`SELECT ${caseId}, na.value FROM json_each(${jsonIds(added)}) na WHERE ${stillEditable}`,
          ),
        guard(added.length),
      );
  }
  if (input.joinUserIds.length > 0)
    statements.push(
      db.insert(channelMembers).select(
        sql`SELECT k.channel_id, j.value, ${now} FROM cases k, json_each(${jsonIds(input.joinUserIds)}) j
            WHERE k.id = ${caseId} AND k.status = 'active'`,
      ),
      guard(input.joinUserIds.length),
    );
  statements.push(
    db
      .update(cases)
      .set({
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.description === undefined
          ? {}
          : { description: input.description }),
        ...(input.client === undefined ? {} : { clientId: input.client.id }),
        version: sql`${cases.version} + 1`,
        updatedAt: now,
      })
      .where(and(eq(cases.id, caseId), stillEditable))
      .returning({ id: cases.id }),
    guard(1),
    assertStatement(
      db,
      caseId,
      sql`EXISTS (SELECT 1 FROM case_departments ld WHERE ld.case_id = ${caseId})`,
    ),
  );
  return statements;
}

function cursorFor(row: { id: string }) {
  if (!isUlid(row.id)) throw new Error("案件IDが不正です");
  return { v: row.id, id: row.id };
}

export function createCaseRepository(db: Database) {
  /** 案件の行と、同じ文の中で決めた資格・参加者数 */
  const selectRows = (actorId: string) => {
    const isParticipant = activeChannelMember(sql`${cases.channelId}`, actorId);
    const canManage = canManageSql(actorId, sql`${cases.id}`);
    // 外側の案件の ID は表の名前つきで渡し、内側の表には別名を付ける（#294）
    const todosOfCase = sql`FROM case_todos pt WHERE pt.case_id = ${sql`${cases.id}`} AND pt.deleted_at IS NULL`;
    return db
      .select({
        id: cases.id,
        caseNumber: cases.caseNumber,
        title: cases.title,
        status: cases.status,
        dueDate: cases.dueDate,
        // 案件の列と名前が重なる取引先の列には別名を付ける（db.batch の中では、同じ名前の列の値が取り違えられるため）
        clientId: sql<string>`${clients.id}`.as("client_ref_id"),
        clientName: sql<string>`${clients.name}`.as("client_ref_name"),
        clientIsActive: sql<boolean>`${clients.isActive}`
          .mapWith(clients.isActive)
          .as("client_ref_is_active"),
        isParticipant: sql<number>`CASE WHEN ${isParticipant} THEN 1 ELSE 0 END`,
        canManage: sql<number>`CASE WHEN ${canManage} THEN 1 ELSE 0 END`,
        canEditDueDate: sql<number>`CASE WHEN ${cases.status} = 'active' AND (${isParticipant} OR ${canManage}) THEN 1 ELSE 0 END`,
        participantCount: sql<
          number | null
        >`CASE WHEN ${isParticipant} OR ${canManage} THEN (SELECT COUNT(*) FROM channel_members pc WHERE pc.channel_id = ${cases.channelId}) ELSE NULL END`,
        // 管理の資格だけの人には、部屋の ID・やり取りの時刻を見せないため、参加者の条件だけで決める
        lastActivityAt: sql<
          string | null
        >`CASE WHEN ${isParticipant} THEN (SELECT lm.created_at FROM messages lm WHERE lm.room_id = ${sql`${cases.channelId}`} AND lm.deleted_at IS NULL ORDER BY lm.id DESC LIMIT 1) ELSE NULL END`,
        channelId: sql<
          string | null
        >`CASE WHEN ${isParticipant} THEN ${cases.channelId} ELSE NULL END`,
        todoTotal: sql<number>`(SELECT COUNT(*) ${todosOfCase})`,
        todoDone: sql<number>`(SELECT COALESCE(SUM(pt.is_done), 0) ${todosOfCase})`,
      })
      .from(cases)
      .innerJoin(clients, eq(clients.id, cases.clientId));
  };

  type Row = Awaited<
    ReturnType<ReturnType<typeof selectRows>["where"]>
  >[number];

  /** 案件の担当部署（案件 ID は JSON の値1つで渡す） */
  const departmentsOfQuery = (caseIds: readonly string[]) =>
    db
      .select({
        caseId: caseDepartments.caseId,
        id: departments.id,
        name: departments.name,
        isActive: departments.isActive,
      })
      .from(caseDepartments)
      .innerJoin(departments, eq(departments.id, caseDepartments.departmentId))
      .where(
        sql`${caseDepartments.caseId} IN (SELECT value FROM json_each(${jsonIds(caseIds)}))`,
      )
      .orderBy(asc(departments.name), asc(departments.id));

  type DepartmentRow = Awaited<ReturnType<typeof departmentsOfQuery>>[number];

  /** 行に担当部署を付ける（ページ全体で1回の読み込み） */
  async function toSummaries(rows: Row[]): Promise<CaseSummary[]> {
    if (rows.length === 0) return [];
    const departmentRows = await departmentsOfQuery(rows.map((row) => row.id));
    return summariesOf(rows, departmentRows);
  }

  function summariesOf(
    rows: Row[],
    departmentRows: DepartmentRow[],
  ): CaseSummary[] {
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
      progress:
        row.todoTotal === 0
          ? null
          : { done: row.todoDone, total: row.todoTotal },
      lastActivityAt: row.lastActivityAt,
      channelId: row.channelId,
    }));
  }

  /**
   * 終了：前提 → 監査 → 通知 → 案件の行の更新（版に1を足す）。チャンネル・参加の行には触れない（AC-8）。
   * 前提：案件があり、状態が from で、版が読んだ値のまま、操作者が有効な参加者、宛先が読んだまま。崩れたら CaseStateChangedError
   */
  async function changeStatus(
    input: CaseStatusWriteInput,
    change: (typeof STATUS_CHANGES)[keyof typeof STATUS_CHANGES],
  ): Promise<void> {
    const condition = sql`EXISTS (SELECT 1 FROM cases k WHERE k.id = ${input.caseId}
      AND k.status = ${change.from} AND k.version = ${input.version}
      AND ${activeChannelMember(K_ROOM, input.actorId)}
      AND ${recipientsUnchanged(K_ROOM, input.actorId, input.recipientIds)})`;
    const recipientIds = [...new Set(input.recipientIds)];
    const assert = assertStatement(db, input.caseId, condition);
    const audit = auditLogInsert(
      db,
      {
        actorId: input.actorId,
        action: change.action,
        targetType: "case",
        targetId: input.caseId,
        result: "success",
        traceId: input.traceId,
        detail: { caseId: input.caseId, notifiedCount: recipientIds.length },
      },
      { onlyWhen: condition },
    );
    const now = new Date().toISOString();
    // ID と宛先の組を JSON の値1つで渡す（宛先の人数に比例して値の数を増やさない。D1 の1文あたりの上限のため）
    const rows = recipientIds.map((userId) => [newUlid(), userId]);
    const notify = db.insert(notifications).select(sql`
      SELECT json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]'), ${change.kind}, NULL, NULL, ${input.caseId}, ${now}, NULL
      FROM json_each(${JSON.stringify(rows)}) j
      WHERE ${condition}`);
    const update = db
      .update(cases)
      .set({
        status: change.to,
        version: sql`${cases.version} + 1`,
        updatedAt: now,
      })
      .where(and(eq(cases.id, input.caseId), condition))
      .returning({ id: cases.id });
    const updated = await runWriteBatch(async () =>
      rows.length === 0
        ? (await db.batch([assert, audit, update]))[2]
        : (await db.batch([assert, audit, notify, update]))[3],
    );
    if (updated.length === 0) throw new CaseStateChangedError();
  }

  /** 書き込みの判定の材料の、案件の行と操作者の資格（同じ文の中で決める） */
  const caseFactsQuery = (caseId: string, actorId: string) =>
    db
      .select({
        status: cases.status,
        dueDate: cases.dueDate,
        version: cases.version,
        actorIsParticipant: sql<number>`CASE WHEN ${activeChannelMember(sql`"cases"."channel_id"`, actorId)} THEN 1 ELSE 0 END`,
        actorCanManage: sql<number>`CASE WHEN ${canManageSql(actorId, sql`"cases"."id"`)} THEN 1 ELSE 0 END`,
        activeParticipantCount: sql<number>`(SELECT COUNT(*) FROM channel_members am
            JOIN users au ON au.id = am.user_id AND au.is_active = 1
            WHERE am.channel_id = "cases"."channel_id")`,
      })
      .from(cases)
      .where(eq(cases.id, caseId))
      .limit(1);

  const departmentIdsQuery = (caseId: string) =>
    db
      .select({ departmentId: caseDepartments.departmentId })
      .from(caseDepartments)
      .where(eq(caseDepartments.caseId, caseId));

  return {
    /**
     * 再開（選び直しつき）の判定の材料を、同じ時点（1つの batch）で読む。案件がなければ null。
     * 追加・除外の対象は、ID を JSON の値1つで渡して読む（人数に比例して値の数を増やさない）
     */
    async findReopenFacts(input: {
      caseId: string;
      actorId: string;
      addUserIds: readonly string[];
      removeUserIds: readonly string[];
    }): Promise<CaseReopenFacts | null> {
      const targetIds = JSON.stringify([
        ...new Set([...input.addUserIds, ...input.removeUserIds]),
      ]);
      const [caseRows, departmentRows, memberRows, targetRows, roleRows] =
        await db.batch([
          caseFactsQuery(input.caseId, input.actorId),
          departmentIdsQuery(input.caseId),
          db
            .select({ userId: users.id })
            .from(channelMembers)
            .innerJoin(cases, eq(cases.channelId, channelMembers.channelId))
            .innerJoin(users, eq(users.id, channelMembers.userId))
            .where(and(eq(cases.id, input.caseId), eq(users.isActive, true)))
            .orderBy(asc(users.id)),
          db
            .select({
              userId: users.id,
              isActive: users.isActive,
              // 外側の利用者の ID は表の名前つきで渡し、内側の表には別名を付ける（#294）
              hasMembershipRow: sql<number>`CASE WHEN EXISTS (SELECT 1 FROM channel_members tm
                JOIN cases tc ON tc.channel_id = tm.channel_id
                WHERE tc.id = ${input.caseId} AND tm.user_id = ${sql`${users.id}`}) THEN 1 ELSE 0 END`,
            })
            .from(users)
            .where(
              sql`${users.id} IN (SELECT value FROM json_each(${targetIds}))`,
            ),
          roleRowsQuery(
            db,
            sql`${userRoleAssignments.userId} IN (SELECT value FROM json_each(${targetIds}))`,
          ),
        ]);
      const [row] = caseRows;
      if (row === undefined) return null;
      return {
        status: row.status,
        version: row.version,
        actorIsParticipant: row.actorIsParticipant === 1,
        actorCanManage: row.actorCanManage === 1,
        caseDepartmentIds: departmentRows.map((d) => d.departmentId),
        activeParticipantIds: memberRows.map((m) => m.userId),
        targets: targetRows.map((t) => ({
          userId: t.userId,
          isActive: t.isActive,
          hasMembershipRow: t.hasMembershipRow === 1,
          ...rolesOf(roleRows, t.userId),
        })),
      };
    },

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
    }): Promise<CaseDetail | "not_visible" | "not_found"> {
      const visible = activeChannelMember(
        sql`${cases.channelId}`,
        input.actorId,
      );
      // 概要の項目・担当部署も同じ batch で読む（先に読んだ概要と混ぜると、間の更新で古い件名と新しい版が1つの応答に入るため）
      const [
        caseRows,
        participantRows,
        roleRows,
        departmentRows,
        summaryRows,
        summaryDepartmentRows,
      ] = await db.batch([
        db
          .select({
            description: cases.description,
            channelId: cases.channelId,
            createdBy: cases.createdBy,
            version: cases.version,
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
        selectRows(input.actorId)
          .where(and(eq(cases.id, input.caseId), visible))
          .limit(1),
        departmentsOfQuery([input.caseId]),
      ]);
      const [found] = caseRows;
      if (found === undefined) return "not_found";
      const [summary] = summariesOf(summaryRows, summaryDepartmentRows);
      if (found.visible !== 1 || summary === undefined) return "not_visible";
      const caseDepartmentIds = departmentRows.map((d) => d.departmentId);
      const activeCount = participantRows.filter((p) => p.isActive).length;
      return {
        ...summary,
        version: found.version,
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
      const caseQuery = caseFactsQuery(input.caseId, input.actorId);
      const departmentQuery = departmentIdsQuery(input.caseId);
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
              version: row.version,
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
     * 再編集の判定の材料を、同じ時点（1つの batch）で読む。案件がなければ null。
     * 求めた部署・自動参加させる人は、部署の ID を JSON の値1つで渡して読む（部署の数に比例して値の数を増やさない）
     */
    async findEditFacts(input: {
      caseId: string;
      actorId: string;
      clientId?: string;
      departmentIds?: readonly string[];
    }): Promise<CaseEditFacts | null> {
      const requestedJson = jsonIds(input.departmentIds ?? []);
      const room = sql`(SELECT ec.channel_id FROM cases ec WHERE ec.id = ${input.caseId})`;
      // 求めた部署のうち、いまの担当部署にない部署（足す部署）
      const addedSet = sql`SELECT value FROM json_each(${requestedJson})
        WHERE value NOT IN (SELECT cd.department_id FROM case_departments cd WHERE cd.case_id = ${input.caseId})`;
      const [caseRows, departmentRows, clientRows, requestedRows, joinRows] =
        await db.batch([
          db
            .select({
              status: cases.status,
              version: cases.version,
              title: cases.title,
              description: cases.description,
              clientId: clients.id,
              clientCode: clients.code,
              clientName: clients.name,
              // 外側の案件の列は表の名前つきで渡し、内側の表には別名を付ける（#294）
              actorIsParticipant: sql<number>`CASE WHEN ${activeChannelMember(sql`${cases.channelId}`, input.actorId)} THEN 1 ELSE 0 END`,
              actorCanManage: sql<number>`CASE WHEN ${canManageSql(input.actorId, sql`${cases.id}`)} THEN 1 ELSE 0 END`,
            })
            .from(cases)
            .innerJoin(clients, eq(clients.id, cases.clientId))
            .where(eq(cases.id, input.caseId))
            .limit(1),
          departmentIdsQuery(input.caseId).orderBy(
            asc(caseDepartments.departmentId),
          ),
          db
            .select({
              id: clients.id,
              code: clients.code,
              name: clients.name,
              isActive: clients.isActive,
            })
            .from(clients)
            .where(
              input.clientId === undefined
                ? sql`0`
                : eq(clients.id, input.clientId),
            )
            .limit(1),
          db
            .select({ id: departments.id, isActive: departments.isActive })
            .from(departments)
            .where(sql`${departments.id} IN (${idsSql(requestedJson)})`),
          db
            .select({ userId: sql<string>`po.user_id` })
            .from(sql`(${pendingOwnersSql(room, addedSet)}) po`)
            .orderBy(sql`po.user_id`),
        ]);
      const [row] = caseRows;
      if (row === undefined) return null;
      const [requested] = clientRows;
      return {
        status: row.status,
        version: row.version,
        title: row.title,
        description: row.description,
        actorIsParticipant: row.actorIsParticipant === 1,
        actorCanManage: row.actorCanManage === 1,
        client: {
          id: row.clientId,
          code: row.clientCode,
          name: row.clientName,
        },
        requestedClient: requested ?? null,
        departmentIds: departmentRows.map((d) => d.departmentId),
        requestedDepartments: requestedRows,
        joinUserIds: joinRows.map((j) => j.userId),
      };
    },

    /** 再編集（EP-5-20。文の順は buildEditStatements）。前提が崩れていたら CaseStateChangedError で、何も残さない */
    async editCase(input: CaseEditWriteInput): Promise<void> {
      const statements = buildEditStatements(db, input);
      // 案件の更新（RETURNING）は、件数の確認・不変条件の2文の前
      const updateAt = statements.length - 3;
      const results = await runWriteBatch(() =>
        db.batch(statements as [BatchItem, ...BatchItem[]]),
      );
      // 案件がない場合、件数の確認の文も0行で失敗しないため、更新の RETURNING で確かめる
      const updated = results[updateAt] as unknown[] | undefined;
      if (updated === undefined || updated.length === 0)
        throw new CaseStateChangedError();
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
     * 参加者の削除・本人の退出（文の順は buildRemoveParticipantStatements）。外れた人が担当の TODO の対象の件数と記録の ID を先に読む。
     * 前提が崩れたら CaseStateChangedError で、何も残さない
     */
    async removeParticipant(input: CaseParticipantWriteInput): Promise<void> {
      const plan = await readUnassignPlan(
        db,
        caseAssigneeScope(input.caseId, input.userId),
      );
      const statements = buildRemoveParticipantStatements(db, input, plan);
      await runWriteBatch(() =>
        db.batch(statements as [BatchItem, ...BatchItem[]]),
      );
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

    /** 終了・再開の通知の宛先：案件の有効な参加者から操作者を除く（ID の昇順） */
    async listCaseNotifyRecipients(
      caseId: string,
      actorId: string,
    ): Promise<string[]> {
      const rows = await db
        .select({ id: users.id })
        .from(channelMembers)
        .innerJoin(cases, eq(cases.channelId, channelMembers.channelId))
        .innerJoin(users, eq(users.id, channelMembers.userId))
        .where(
          and(
            eq(cases.id, caseId),
            eq(users.isActive, true),
            sql`${users.id} <> ${actorId}`,
          ),
        )
        .orderBy(asc(users.id));
      return rows.map((row) => row.id);
    },

    /** 終了（EP-5-11） */
    closeCase(input: CaseStatusWriteInput): Promise<void> {
      return changeStatus(input, STATUS_CHANGES.close);
    },

    /** 再開（EP-5-12。参加者の選び直しつき）。前提が崩れていたら CaseStateChangedError で、何も残さない */
    async reopenCase(input: CaseReopenWriteInput): Promise<void> {
      const plan = await readReopenUnassignPlan(db, input);
      const { statements, updateAt } = composeReopen(db, input, plan);
      const results = await runWriteBatch(() =>
        db.batch(statements as [BatchItem, ...BatchItem[]]),
      );
      // 件数の確認の文が働いていれば0行にはならない（前提と書き込みの条件がずれたときの二重の守り）
      const updated = results[updateAt] as unknown[] | undefined;
      if (updated === undefined || updated.length === 0)
        throw new CaseStateChangedError();
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
