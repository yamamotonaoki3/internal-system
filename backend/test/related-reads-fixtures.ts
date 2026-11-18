// #297 のテストで使う、メッセージの付随情報（メンション・リアクション・添付）と未読の読み取りの準備と後始末。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。行は直接入れる（API・Repository を通さずに状態を作る）。
// 案件専用チャンネルの部屋は cleanupCaseTestData が消す。ここで後始末するのは、公開チャンネルと DM の部屋（外部キーの順に消す）。
import { env } from "cloudflare:workers";
import { createUlidFactory } from "../src/lib/ulid";

export { insertAttachmentRow } from "./attachment-fixtures";
export { insertReactionRow, reactionIsoAt } from "./reaction-fixtures";

export const AT = "2026-11-17T03:00:00.000Z";
/** どのメッセージの ID よりも小さい下限（すべて未読として数える） */
export const ZERO = "00000000000000000000000000";

/** 同じ ms には必ず同じ ID を返す（乱数の部分を 0 に固定する） */
export function fixedIdAt(ms: number): string {
  return createUlidFactory({
    now: () => ms,
    random: (length) => new Uint8Array(length),
  })();
}

export async function insertMessageRow(seed: {
  id: string;
  roomId: string;
  senderId: string;
  parentId?: string | null;
  deleted?: boolean;
}) {
  await env.DB.prepare(
    `INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at, deleted_at, parent_message_id)
     VALUES (?, ?, ?, 'テスト太郎', ?, ?, ?, ?)`,
  )
    .bind(
      seed.id,
      seed.roomId,
      seed.senderId,
      `[UNIT_TEST]本文${seed.id}`,
      AT,
      seed.deleted === true ? AT : null,
      seed.parentId ?? null,
    )
    .run();
}

export async function insertMentionRow(
  messageId: string,
  userId: string,
  start: number,
  end: number,
) {
  await env.DB.prepare(
    "INSERT INTO message_mentions (message_id, user_id, start, end) VALUES (?, ?, ?, ?)",
  )
    .bind(messageId, userId, start, end)
    .run();
}

/** 公開チャンネル・DM の部屋（案件専用チャンネルでないもの）と、その中の付随の行・メッセージを消す */
export async function cleanupRelatedReadsRooms(roomIds: readonly string[]) {
  const rooms = JSON.stringify(roomIds);
  const inRooms = "SELECT value FROM json_each(?1)";
  const inMessages = `SELECT id FROM messages WHERE room_id IN (${inRooms})`;
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM message_reactions WHERE message_id IN (${inMessages})`,
    ).bind(rooms),
    env.DB.prepare(
      `DELETE FROM message_mentions WHERE message_id IN (${inMessages})`,
    ).bind(rooms),
    env.DB.prepare(
      `DELETE FROM thread_read_positions WHERE parent_message_id IN (${inMessages})`,
    ).bind(rooms),
    env.DB.prepare(
      `DELETE FROM message_attachments WHERE room_id IN (${inRooms}) OR message_id IN (${inMessages})`,
    ).bind(rooms),
    env.DB.prepare(
      `DELETE FROM read_positions WHERE room_id IN (${inRooms})`,
    ).bind(rooms),
    env.DB.prepare(`DELETE FROM messages WHERE room_id IN (${inRooms})`).bind(
      rooms,
    ),
    env.DB.prepare(
      `DELETE FROM conversation_members WHERE conversation_id IN (${inRooms})`,
    ).bind(rooms),
    env.DB.prepare(
      `DELETE FROM conversations WHERE room_id IN (${inRooms})`,
    ).bind(rooms),
    env.DB.prepare(
      `DELETE FROM channel_members WHERE channel_id IN (${inRooms})`,
    ).bind(rooms),
    env.DB.prepare(`DELETE FROM channels WHERE room_id IN (${inRooms})`).bind(
      rooms,
    ),
    env.DB.prepare(`DELETE FROM rooms WHERE id IN (${inRooms})`).bind(rooms),
  ]);
}
