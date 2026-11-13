// #237 のテストで使う、既読位置（read_positions）と大量のメッセージの架空のテストデータの作成・読み取り・後始末（識別子で消す）。
// 識別子：利用者が testuser_ / e2euser_ であること（既読位置は必ず利用者の行を持つ）。本文は [UNIT_TEST] を付ける。
// 表の形は計画「1. 表」：read_positions(user_id → users.id, room_id → rooms.id, last_read_message_id（外部キーなし）, updated_at)、主キー (user_id, room_id)。
// このファイルはほかのテストの土台（role-fixtures 等）を読み込まない。後始末を role-fixtures などから呼ぶため（循環を作らない）。
import { env } from "cloudflare:workers";
import { createUlidFactory } from "../src/lib/ulid";

export const READ_NOW = "2026-11-13T00:00:00.000Z";
/** メッセージの本文の識別用のタグ（role-fixtures の TEST_TAG と同じ値。循環を避けるためここにも書く） */
const BODY_TAG = "[UNIT_TEST]";

const TEST_USERS =
  "SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!' OR login_id LIKE 'e2euser!_%' ESCAPE '!'";

/** 指定したミリ秒の時刻を持つ ULID（時刻が違えば、必ず時刻の大小の順になる） */
export function ulidAtMs(ms: number): string {
  return createUlidFactory({ now: () => ms })();
}

/**
 * このテストの既読位置だけを消す。外部キー（user_id・room_id）のため、利用者・部屋を消す後始末より先に呼ぶ。
 * 対象：利用者が testuser_ / e2euser_ の行（部屋を開いたテストの利用者の既読位置）。
 * 表がない異常を見逃さないため、表の有無は確かめず常に削除する（表がなければ「no such table」で失敗させる）。
 */
export async function cleanupReadPositions() {
  await env.DB.prepare(
    `DELETE FROM read_positions WHERE user_id IN (${TEST_USERS})`,
  ).run();
}

/** 既読位置を直接入れる（API を通さずに状態を作る） */
export async function insertReadPosition(
  userId: string,
  roomId: string,
  lastReadMessageId: string,
  updatedAt = READ_NOW,
) {
  await env.DB.prepare(
    "INSERT INTO read_positions (user_id, room_id, last_read_message_id, updated_at) VALUES (?, ?, ?, ?)",
  )
    .bind(userId, roomId, lastReadMessageId, updatedAt)
    .run();
}

export type ReadPositionRow = {
  user_id: string;
  room_id: string;
  last_read_message_id: string;
  updated_at: string;
};

/** その利用者・部屋の既読位置（なければ null） */
export async function readPositionOf(
  userId: string,
  roomId: string,
): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT last_read_message_id AS id FROM read_positions WHERE user_id = ? AND room_id = ?",
  )
    .bind(userId, roomId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/** テストの利用者の既読位置の行（利用者・部屋の順） */
export async function readPositionRows(): Promise<ReadPositionRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT user_id, room_id, last_read_message_id, updated_at FROM read_positions
     WHERE user_id IN (${TEST_USERS}) ORDER BY user_id, room_id`,
  ).all<ReadPositionRow>();
  return results;
}

/** read_positions の全体の行数（テストの利用者以外も含む。変えないことの確認用） */
export async function totalReadPositions(): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM read_positions",
  ).first<{ n: number }>();
  if (row === null) throw new Error("read_positions の件数を読めませんでした");
  return row.n;
}

/**
 * 部屋に、指定した時刻から1ミリ秒ずつ進む時刻の ID で count 件のメッセージを入れ、ID の配列（昇順）を返す。
 * created_at も ID と同じ時刻にそろえる（「参加の前・後」を ID でも作成日時でも同じ意味にする）。
 */
export async function insertMessagesAt(
  roomId: string,
  senderId: string,
  startMs: number,
  count: number,
): Promise<string[]> {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: ulidAtMs(startMs + i),
    createdAt: new Date(startMs + i).toISOString(),
  }));
  const chunk = 50;
  for (let start = 0; start < count; start += chunk) {
    await env.DB.batch(
      rows
        .slice(start, start + chunk)
        .map((row, i) =>
          env.DB.prepare(
            "INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          ).bind(
            row.id,
            roomId,
            senderId,
            "テスト太郎",
            `${BODY_TAG}未読${start + i}`,
            row.createdAt,
          ),
        ),
    );
  }
  return rows.map((row) => row.id);
}

/** チャンネルの参加の時刻を書き換える（参加の前・後のメッセージを作り分けるため） */
export async function setJoinedAt(
  channelId: string,
  userId: string,
  joinedAt: string,
) {
  await env.DB.prepare(
    "UPDATE channel_members SET joined_at = ? WHERE channel_id = ? AND user_id = ?",
  )
    .bind(joinedAt, channelId, userId)
    .run();
}

/** チャンネルから外す（参加の行を消す） */
export async function removeMember(channelId: string, userId: string) {
  await env.DB.prepare(
    "DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?",
  )
    .bind(channelId, userId)
    .run();
}

/** チャンネルを参加させる（参加の時刻を指定する） */
export async function joinAt(
  channelId: string,
  userId: string,
  joinedAt: string,
) {
  await env.DB.prepare(
    "INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES (?, ?, ?)",
  )
    .bind(channelId, userId, joinedAt)
    .run();
}

/** チャンネルのアーカイブ（deleted_at）を付け外しする */
export async function setArchived(channelId: string, archived: boolean) {
  await env.DB.prepare("UPDATE channels SET deleted_at = ? WHERE room_id = ?")
    .bind(archived ? READ_NOW : null, channelId)
    .run();
}

/** チャンネルの公開範囲を変える */
export async function setVisibility(
  channelId: string,
  visibility: "public" | "private",
) {
  await env.DB.prepare("UPDATE channels SET visibility = ? WHERE room_id = ?")
    .bind(visibility, channelId)
    .run();
}
