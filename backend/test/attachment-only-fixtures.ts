// #270（270-B。添付だけの投稿。C-137(3)）のテストで使う、架空のテストデータの作成・DB の直接の読み取り・後始末。
// 期待の根拠は、利用者の決定（2026-11-21）と計画（plan-270b 改訂2）：
//   決定1：本文のない投稿は、本文に「見えない目印（半角の空白1文字）」を保存する。migration は足さない。API は本文を空文字で受け渡す（計画 2.1・2.2）
//   決定2：本文のない投稿の最後の添付の削除は 409 で断り、「投稿ごと削除してください」と案内する（計画 AC-6）
//   決定3：添付のある投稿は、編集で本文を空にできる（計画 AC-5）
// 目印の値は、本番の定数（backend/src/db/message-body.ts の EMPTY_BODY_MARKER）から作らず、ここに決定の値として独立に書く
//   （誤った定義を検出できるようにするため。AGENTS.md「共通定義と定数」）。
// このファイルは、まだない本番のコード（message-body.ts 等）を読み込まない。読み込むと、これを使うテストの組み立てごと壊れるため。
// 識別子：利用者は testuser_ で始め、部署名・チャンネル名・ファイル名は [UNIT_TEST] を付ける。値はすべて架空のもの。
import { env } from "cloudflare:workers";
import { insertMessage, type MessageSeed } from "./message-fixtures";

/** 決定1：本文のない投稿の、DB に保存される本文（半角の空白1文字）。API は空文字を返す */
export const STORED_EMPTY_BODY = " ";

/** 決定2・計画 AC-6：本文のない投稿の最後の添付を消そうとしたときの 409 の文 */
export const LAST_ATTACHMENT_MESSAGE =
  "本文のない投稿の、最後の添付は削除できません。投稿ごと削除してください。";

/** 計画 AC-1・AC-5・AC-11：本文も添付もないときの 422 の文（いまの messageBodySchema の文） */
export const BLANK_BODY_MESSAGE = "メッセージを入力してください";

/** 編集の 0 行のとき、拒否の理由が見つからなかった場合の 409 の文（いまの failWrite の文） */
export const STATE_CHANGED_MESSAGE =
  "状態が変わったため、操作できませんでした。読み込み直してからお試しください";

/** 本文のない投稿（DB の本文が目印）を直接入れる（API・Repository を通さない） */
export async function insertBodylessMessage(
  seed: Omit<MessageSeed, "body">,
): Promise<string> {
  return insertMessage({ ...seed, body: STORED_EMPTY_BODY });
}

/** そのメッセージの、削除されていない（見える）添付の件数 */
export async function visibleAttachmentCount(
  messageId: string,
): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM message_attachments WHERE message_id = ? AND deleted_at IS NULL",
  )
    .bind(messageId)
    .first<{ n: number }>();
  if (row === null) throw new Error("見える添付の件数を読めませんでした");
  return row.n;
}

/**
 * 「本文も、見える添付もない投稿」（AC-3・AC-7 の不変条件）の ID を、DB を直接読んで返す。
 * 削除されていないメッセージのうち、本文が空白（半角・全角の空白・タブ・改行）だけで、削除されていない添付が1件もないもの。
 */
export async function emptyPostsWithoutAttachments(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT m.id FROM messages m
     WHERE m.deleted_at IS NULL
       AND trim(m.body, char(32, 9, 10, 13, 12288)) = ''
       AND NOT EXISTS (SELECT 1 FROM message_attachments a WHERE a.message_id = m.id AND a.deleted_at IS NULL)
     ORDER BY m.id`,
  ).all<{ id: string }>();
  return results.map((row) => row.id);
}

/** そのメッセージの本文（DB の生の値。行がなければ null） */
export async function storedBodyOf(messageId: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT body FROM messages WHERE id = ?")
    .bind(messageId)
    .first<{ body: string }>();
  return row?.body ?? null;
}

/** 部屋のメッセージの行数（返信を含む） */
export async function messagesInRoom(roomId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM messages WHERE room_id = ?",
  )
    .bind(roomId)
    .first<{ n: number }>();
  if (row === null) throw new Error("メッセージの件数を読めませんでした");
  return row.n;
}

/** 表全体の行数（失敗した書き込みで、指名・通知・索引が増えていないことの確かめに使う） */
export async function rowCount(
  table:
    | "messages"
    | "message_mentions"
    | "notifications"
    | "search_documents"
    | "search_fts",
): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{
    n: number;
  }>();
  if (row === null) throw new Error(`${table} の件数を読めませんでした`);
  return row.n;
}

/** そのメッセージの、本文の写し（kind = 'message'）の source_body の一覧 */
export async function messageDocumentBodies(
  messageId: string,
): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT source_body FROM search_documents WHERE kind = 'message' AND ref_id = ? ORDER BY id",
  )
    .bind(messageId)
    .all<{ source_body: string }>();
  return results.map((row) => row.source_body);
}

/**
 * このテストの残りを消す（メッセージを消す後始末より先に呼ぶ）：
 * (1) 本文のない投稿に結ぶ索引の写し（目印の本文は [UNIT_TEST] を含まないため、test/search-fixtures の cleanupSearchIndex の対象から外れる）
 * (2) テストの利用者の投稿に付いた指名と、その通知（実装の前に、断られるはずの書き込みが通ったときに残り、利用者を消す後始末が外部キーで止まるため）
 * 対象は、送信者・宛先が testuser_ の利用者のものだけ。表がまだないときは、索引は何もしない。
 */
export async function cleanupAttachmentOnlyLeftovers(): Promise<void> {
  const testUsers =
    "SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!'";
  const testMessages = `SELECT id FROM messages WHERE sender_id IN (${testUsers})`;
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM notifications WHERE user_id IN (${testUsers}) OR message_id IN (${testMessages})`,
    ),
    env.DB.prepare(
      `DELETE FROM message_mentions WHERE user_id IN (${testUsers}) OR message_id IN (${testMessages})`,
    ),
  ]);
  const exists = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('search_documents', 'search_fts')",
  ).first<{ n: number }>();
  if ((exists?.n ?? 0) < 2) return;
  const target = `SELECT id FROM search_documents WHERE message_id IN (${testMessages}) OR (kind = 'message' AND ref_id IN (${testMessages}))`;
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM search_fts WHERE rowid IN (${target})`),
    env.DB.prepare(`DELETE FROM search_documents WHERE id IN (${target})`),
  ]);
}
