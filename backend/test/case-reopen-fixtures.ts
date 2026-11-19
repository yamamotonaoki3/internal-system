// #150（150-B）のテストで使う、再開のときの参加者の選び直し（EP-5-12 の本文）の確認の部品。
// 世界は case-request-fixtures.ts の setupCaseWorld、案件は case-fixtures.ts の seedCase を使い、後始末は cleanupCaseTestData に任せる
// （案件・チャンネル・参加の行は取引先 [UNIT_TEST] で、通知はテストの利用者で、監査は trace_id の接頭辞で消える）。
// 期待値は計画 150-B（6.1 API・6.3 書き込み・14章の決定 Q4・Q5・Q8）から決める。本番の定数から作らない（誤った定義を見つけられるように）。
// データは架空（testuser_casereq_・testuser_case150_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { insertUser } from "./role-fixtures";

/** 計画 150-B 6.1 の文言（画面はこの文言をそのまま出す） */
export const CASE_REOPEN_MESSAGES = {
  participantsChanged:
    "参加者がほかの操作で変わりました。画面を確かめてから、もう一度操作してください",
  cannotRemoveSelf: "再開する本人は外せません",
  targetInvalid: "追加できる社員を選んでください",
  autoParticipant: "担当部署のオーナー・全体管理者は外せません",
  alreadyParticipant: "この社員はすでに参加者です",
} as const;

/** 計画 150-B 6.1 の 409 の reason */
export const CASE_REOPEN_REASONS = {
  participantsChanged: "participants_changed",
  autoParticipant: "auto_participant",
  alreadyParticipant: "already_participant",
} as const;

/** 決定 Q4：追加・外すは各 100 人まで（participantIds には上限を置かない） */
export const REOPEN_LIMITS = { add: 100, remove: 100 } as const;

export type ReopenBody = {
  participantIds: string[];
  addUserIds: string[];
  removeUserIds: string[];
};

/** 案件の部屋の ID（案件がなければ null） */
export async function roomIdOf(caseId: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT channel_id FROM cases WHERE id = ?")
    .bind(caseId)
    .first<{ channel_id: string }>();
  return row?.channel_id ?? null;
}

/** 案件の部屋の、有効な参加者の ID（昇順。無効な人の行は含まない） */
export async function activeParticipantIdsOf(
  roomId: string,
): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT m.user_id FROM channel_members m JOIN users u ON u.id = m.user_id
     WHERE m.channel_id = ? AND u.is_active = 1 ORDER BY m.user_id`,
  )
    .bind(roomId)
    .all<{ user_id: string }>();
  return results.map((row) => row.user_id);
}

/** 選び直しなしの本文（いまの有効な参加者・空の追加・空の除外）。案件がなければ participantIds は空 */
export async function noReselectBody(caseId: string): Promise<ReopenBody> {
  const roomId = await roomIdOf(caseId);
  return {
    participantIds: roomId === null ? [] : await activeParticipantIdsOf(roomId),
    addUserIds: [],
    removeUserIds: [],
  };
}

export type ParticipantAuditRow = {
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  result: string;
  detail: string | null;
};

/** 参加者の追加・削除の監査（書かれた順） */
export async function participantAudits(): Promise<ParticipantAuditRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT actor_id, action, target_type, target_id, result, detail FROM audit_logs
     WHERE action IN ('case.participant.add', 'case.participant.remove') ORDER BY occurred_at, id`,
  ).all<ParticipantAuditRow>();
  return results;
}

/** すべての通知の種類（再開の通知のほかに、追加・除外の個別の通知の種類ができていないことを確かめる） */
export async function notificationKindsFor(userIds: readonly string[]) {
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT kind FROM notifications WHERE user_id IN (SELECT value FROM json_each(?)) ORDER BY kind`,
  )
    .bind(JSON.stringify(userIds))
    .all<{ kind: string }>();
  return results.map((row) => row.kind);
}

/** 過去の通知を1件入れる（同じ案件・種類・時刻の過去の通知があっても再開できることの確認用） */
export async function insertPastCaseNotification(input: {
  id: string;
  userId: string;
  kind: string;
  caseId: string;
  createdAt: string;
}) {
  await env.DB.prepare(
    "INSERT INTO notifications (id, user_id, kind, room_id, message_id, target_id, created_at, read_at) VALUES (?, ?, ?, NULL, NULL, ?, ?, NULL)",
  )
    .bind(input.id, input.userId, input.kind, input.caseId, input.createdAt)
    .run();
}

/**
 * 有効な一般社員を count 人作る（参加者の上限なし・D1 の上限の確認用）。ログイン ID は testuser_case150_bulkb_ で始める
 * （後始末は cleanupCaseTestData）。ID は昇順に並ぶよう、決定的に作る（I・L・O・U を使わない。26 文字）
 */
export async function insertBulkUsersFast(
  count: number,
  departmentId: string,
): Promise<string[]> {
  const ids = Array.from(
    { length: count },
    (_, i) => `01JTESTCASE150BR${String(i).padStart(10, "0")}`,
  );
  for (let i = 0; i < ids.length; i += 50)
    await Promise.all(
      ids
        .slice(i, i + 50)
        .map((id, j) =>
          insertUser(
            `testuser_case150_bulkb_${String(i + j).padStart(4, "0")}`,
            departmentId,
            { id },
          ),
        ),
    );
  return ids;
}
