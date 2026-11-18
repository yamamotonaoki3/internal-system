// #150（150-A）のテストで使う、案件の終了・再開（EP-5-11・EP-5-12）の確認の部品（期待する文言・reason、状態の読み取り、取り消しの確認）。
// 世界は case-request-fixtures.ts の setupCaseWorld、案件は case-fixtures.ts の seedCase を使い、後始末は cleanupCaseTestData に任せる
// （案件・チャンネル・参加の行は取引先 [UNIT_TEST] で、通知はテストの利用者で、監査は trace_id の接頭辞で消える）。
// 期待値は計画 150-A（6.1 API・6.3 書き込み）から決める。データは架空（testuser_casereq_・testuser_case150_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { CASES_BASE } from "./case-fixtures";
import { insertUser } from "./role-fixtures";

/** 計画 150-A 6.1 の文言（画面はこの文言をそのまま出す） */
export const CASE_CLOSE_MESSAGES = {
  notFound: "案件が見つかりません",
  participantsOnly: "参加者だけが操作できます",
  alreadyClosed: "この案件はすでに終了しています",
  alreadyActive: "この案件はすでに進行中です",
  stale:
    "ほかの人が先にこの案件を変更しました。画面を確かめてから、もう一度操作してください",
} as const;

/** 計画 150-A 6.1・6.3 の 409 の reason */
export const CASE_CLOSE_REASONS = {
  alreadyClosed: "already_closed",
  alreadyActive: "already_active",
  stale: "stale",
  retry: "retry",
} as const;

/** 監査の操作（計画 150-A 6.3）と通知の種類（3-3 AC-1） */
export const CASE_CLOSE_AUDIT_ACTIONS = ["case.close", "case.reopen"] as const;
export const CASE_CLOSE_NOTIFICATION_KINDS = [
  "case.closed",
  "case.reopened",
] as const;

export const closePath = (caseId: string) => `${CASES_BASE}/${caseId}/close`;
export const reopenPath = (caseId: string) => `${CASES_BASE}/${caseId}/reopen`;

export type CaseCloseAuditRow = {
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  result: string;
  detail: string | null;
};

/** 終了・再開の監査（書かれた順） */
export async function caseCloseAudits(): Promise<CaseCloseAuditRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT actor_id, action, target_type, target_id, result, detail FROM audit_logs
     WHERE action IN ('case.close', 'case.reopen') ORDER BY occurred_at, id`,
  ).all<CaseCloseAuditRow>();
  return results;
}

export type CaseCloseNotificationRow = {
  user_id: string;
  kind: string;
  room_id: string | null;
  message_id: string | null;
  target_id: string | null;
};

/** 終了・再開の通知（宛先の順） */
export async function caseCloseNotifications(): Promise<
  CaseCloseNotificationRow[]
> {
  const { results } = await env.DB.prepare(
    `SELECT user_id, kind, room_id, message_id, target_id FROM notifications
     WHERE kind IN ('case.closed', 'case.reopened') ORDER BY kind, user_id, id`,
  ).all<CaseCloseNotificationRow>();
  return results;
}

/** 種類ごとの宛先（昇順） */
export async function recipientsOf(kind: string): Promise<string[]> {
  return (await caseCloseNotifications())
    .filter((row) => row.kind === kind)
    .map((row) => row.user_id)
    .sort();
}

/**
 * 取り消しの確認用：案件の行・案件専用チャンネルの行・参加の行・アーカイブの記録・案件の監査・終了と再開の通知。
 * 失敗した操作の後で、操作の前（または割り込みの直後）と完全に同じであることを確かめる
 */
export async function caseCloseSnapshot() {
  const all = async (sql: string) =>
    (await env.DB.prepare(sql).all<Record<string, unknown>>()).results;
  return {
    cases: await all(
      "SELECT id, status, due_date, version, updated_at FROM cases ORDER BY id",
    ),
    channels: await all(
      "SELECT room_id, name, deleted_at, deleted_by, version, updated_at FROM channels WHERE room_id IN (SELECT channel_id FROM cases) ORDER BY room_id",
    ),
    members: await all(
      "SELECT channel_id, user_id, joined_at FROM channel_members WHERE channel_id IN (SELECT channel_id FROM cases) ORDER BY channel_id, user_id",
    ),
    archiveEvents: await all(
      "SELECT id, channel_id FROM channel_archive_events WHERE channel_id IN (SELECT channel_id FROM cases) ORDER BY id",
    ),
    audits: await all(
      `SELECT actor_id, action, target_id, detail FROM audit_logs
       WHERE action IN ('case.close', 'case.reopen', 'case.participant.add', 'case.participant.remove', 'case.due_date.change')
       ORDER BY occurred_at, id`,
    ),
    notifications: await caseCloseNotifications(),
  };
}

/** 案件の行（状態・版・更新日時） */
export async function caseRowOf(caseId: string) {
  const row = await env.DB.prepare(
    "SELECT status, version, updated_at FROM cases WHERE id = ?",
  )
    .bind(caseId)
    .first<{ status: string; version: number; updated_at: string }>();
  if (row === null) throw new Error(`案件 ${caseId} がありません`);
  return row;
}

/** 版を直接進める（版を進めるほかの操作〔納期の変更・150-C の再編集〕の代わり） */
export async function bumpCaseVersion(caseId: string) {
  await env.DB.prepare("UPDATE cases SET version = version + 1 WHERE id = ?")
    .bind(caseId)
    .run();
}

/**
 * 有効な一般社員を count 人作る（D1 の上限の確認用）。ログイン ID は testuser_case150_bulk_ で始める（後始末は cleanupDepartmentTestData）。
 * ID は昇順に並ぶよう、決定的に作る（I・L・O・U を使わない）
 */
export async function insertBulkUsers(
  count: number,
  departmentId: string,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = `01JTESTCASE150BK${String(i).padStart(10, "0")}`;
    await insertUser(
      `testuser_case150_bulk_${String(i).padStart(3, "0")}`,
      departmentId,
      { id },
    );
    ids.push(id);
  }
  return ids;
}

/** 参加の行をまとめて入れる */
export async function addCaseMembers(
  roomId: string,
  userIds: readonly string[],
  joinedAt: string,
) {
  const statements = userIds.map((userId) =>
    env.DB.prepare(
      "INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES (?, ?, ?)",
    ).bind(roomId, userId, joinedAt),
  );
  for (let i = 0; i < statements.length; i += 50)
    await env.DB.batch(statements.slice(i, i + 50));
}
