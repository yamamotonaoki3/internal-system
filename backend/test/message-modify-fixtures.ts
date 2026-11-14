// #134 のテストで使う、メッセージの編集・削除（EP-1-03・EP-1-04）の架空のテストデータの作成・読み取り・後始末（識別子で消す）。
// 利用者は testuser_ で始め、部署名・チャンネル名は [UNIT_TEST] で始める。本文は [UNIT_TEST] を付ける。値はすべて架空のもの。
// 表の形は計画（#134）：messages に edited_at・deleted_at・deleted_by（users.id を参照）を、すべて NULL 可で足す（migration 0019）。
// このファイルは、まだない本番のコード（編集・削除の Service・Repository）を読み込まない。読み込むと、これを使う既存のテストまで壊れるため。
import { env } from "cloudflare:workers";
import { apiRequest } from "./api-request";
import { AUTH_TRACE_PREFIX, insertSession, sha256Hex } from "./auth-fixtures";
import { cleanupDmScenario } from "./dm-fixtures";
import { insertUser } from "./role-fixtures";

/** 削除済みにした時刻（テストで直接作る削除済みの状態） */
export const DELETED_AT = "2026-11-14T00:00:00.000Z";
/** 再認証の有効期間（要件 0-5・shared/reauth-policy の 5分）。本番の定数から作らず、仕様の数字で持つ */
export const REAUTH_WINDOW_MS = 5 * 60 * 1000;

/** 監査ログの trace_id（cleanupAuthTestData がこの接頭辞で消す） */
export const modifyTraceId = () =>
  `${AUTH_TRACE_PREFIX}msgmod-${crypto.randomUUID()}`;

export type ModifyUser = { userId: string; token: string };

/**
 * パスワード変更の必要がない有効な利用者を作り、セッションを返す。
 * reauthAgoMs：再認証からの経過（ミリ秒）。null は再認証なし。
 */
export async function insertModifyUser(
  loginId: string,
  departmentId: string,
  reauthAgoMs: number | null = null,
): Promise<ModifyUser> {
  if (!loginId.startsWith("testuser_"))
    throw new Error("テストの利用者は testuser_ で始めてください");
  const userId = await insertUser(loginId, departmentId);
  await env.DB.prepare("UPDATE users SET must_change_password = 0 WHERE id = ?")
    .bind(userId)
    .run();
  const now = new Date();
  const session = await insertSession(userId, {
    createdAt: now.toISOString(),
  });
  if (reauthAgoMs !== null)
    await setReauthenticated(session.token, reauthAgoMs);
  return { userId, token: session.token };
}

/** 新しいセッションを作る（同じ利用者の別のタブ・再認証の有無の作り分けに使う） */
export async function newSessionFor(
  userId: string,
  reauthAgoMs: number | null,
): Promise<string> {
  const session = await insertSession(userId, {
    createdAt: new Date().toISOString(),
  });
  if (reauthAgoMs !== null)
    await setReauthenticated(session.token, reauthAgoMs);
  return session.token;
}

/** セッションの再認証の時刻を「今から ago ミリ秒前」にする */
export async function setReauthenticated(token: string, agoMs: number) {
  await env.DB.prepare(
    "UPDATE sessions SET reauthenticated_at = ? WHERE id = ?",
  )
    .bind(new Date(Date.now() - agoMs).toISOString(), await sha256Hex(token))
    .run();
}

// ---- API ----

export const messageItemPath = (messageId: string) =>
  `/api/messages/${messageId}`;

export function editMessage(
  messageId: string,
  payload: unknown,
  token: string | null,
  origin?: string,
) {
  return apiRequest("PATCH", messageItemPath(messageId), {
    token,
    body: payload,
    ...(origin === undefined ? {} : { origin }),
  });
}

export function deleteMessage(
  messageId: string,
  token: string | null,
  origin?: string,
) {
  return apiRequest("DELETE", messageItemPath(messageId), {
    token,
    ...(origin === undefined ? {} : { origin }),
  });
}

export type ListedItem = {
  id: string;
  roomId: string;
  author: { id: string; displayName: string; isActive: boolean };
  body: string | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
};

/** 一覧（EP-1-01）から1件を取る。after を渡すと「最後のID以降」の一覧から取る */
export async function listedItem(
  roomId: string,
  messageId: string,
  token: string,
  after?: string,
): Promise<ListedItem | undefined> {
  const query =
    after === undefined ? "?limit=100" : `?after=${after}&limit=100`;
  const response = await apiRequest(
    "GET",
    `/api/rooms/${roomId}/messages${query}`,
    { token },
  );
  if (response.status !== 200)
    throw new Error(`一覧の取得が ${response.status} でした`);
  const page = (await response.json()) as { items: ListedItem[] };
  return page.items.find((item) => item.id === messageId);
}

// ---- 状態の作成・読み取り ----

export type MessageModifyRow = {
  id: string;
  room_id: string;
  sender_id: string;
  body: string;
  edited_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
};

/** メッセージの行（編集・削除の列を含む）。なければ null */
export async function messageRow(id: string) {
  return env.DB.prepare(
    "SELECT id, room_id, sender_id, body, edited_at, deleted_at, deleted_by FROM messages WHERE id = ?",
  )
    .bind(id)
    .first<MessageModifyRow>();
}

/** 削除済みの状態を直接作る（API を通さない） */
export async function markDeleted(id: string, deletedBy: string) {
  await env.DB.prepare(
    "UPDATE messages SET deleted_at = ?, deleted_by = ? WHERE id = ?",
  )
    .bind(DELETED_AT, deletedBy, id)
    .run();
}

/** 編集済みの状態を直接作る（API を通さない） */
export async function markEdited(id: string, editedAt: string) {
  await env.DB.prepare("UPDATE messages SET edited_at = ? WHERE id = ?")
    .bind(editedAt, id)
    .run();
}

/** 部署を無効にする（#154 の無効化の結果だけを直接作る。C-143(1)：その部署のチャンネルは読み取り専用） */
export async function deactivateDepartment(departmentId: string) {
  await env.DB.prepare("UPDATE departments SET is_active = 0 WHERE id = ?")
    .bind(departmentId)
    .run();
}

/** チャンネルをアーカイブする（deleted_at を入れる） */
export async function archiveChannel(roomId: string) {
  await env.DB.prepare("UPDATE channels SET deleted_at = ? WHERE room_id = ?")
    .bind(DELETED_AT, roomId)
    .run();
}

/** チャンネルから外す（参加の行を消す） */
export async function leaveChannel(roomId: string, userId: string) {
  await env.DB.prepare(
    "DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?",
  )
    .bind(roomId, userId)
    .run();
}

export type DeleteAuditRow = {
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  result: string;
  detail: string | null;
};

/** 削除の監査（message.delete）の行。messageId を渡すと、その対象だけ */
export async function deleteAuditRows(messageId?: string) {
  const { results } = await (
    messageId === undefined
      ? env.DB.prepare(
          "SELECT actor_id, action, target_type, target_id, result, detail FROM audit_logs WHERE action = 'message.delete' ORDER BY occurred_at, id",
        )
      : env.DB.prepare(
          "SELECT actor_id, action, target_type, target_id, result, detail FROM audit_logs WHERE action = 'message.delete' AND target_id = ? ORDER BY occurred_at, id",
        ).bind(messageId)
  ).all<DeleteAuditRow>();
  return results;
}

// ---- ログ（console に出た行） ----

export type LogLine = {
  body?: string;
  attributes?: Record<string, unknown>;
};

/** console に出た行のうち、監査（log_type: audit）で結果が failure のもの */
export function failureAuditLines(lines: readonly string[]): LogLine[] {
  return lines
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as LogLine)
    .filter(
      (line) =>
        line.attributes?.log_type === "audit" &&
        line.attributes.result === "failure",
    );
}

// ---- 後始末 ----

/**
 * このテストの削除の監査を消してから、DM・メッセージ・セッション・チャンネル・部署・利用者を消す。
 * 監査は trace_id の接頭辞（API・テストが付けたもの）か、操作者がテストの利用者のものだけ。途中で失敗しても残りは必ず行う。
 */
export async function cleanupMessageModifyScenario() {
  const testUsers =
    "SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!' OR login_id LIKE 'e2euser!_%' ESCAPE '!'";
  try {
    await env.DB.prepare(
      `DELETE FROM audit_logs WHERE action = 'message.delete' AND (trace_id LIKE ? OR actor_id IN (${testUsers}))`,
    )
      .bind(`${AUTH_TRACE_PREFIX}%`)
      .run();
  } finally {
    await cleanupDmScenario();
  }
}
