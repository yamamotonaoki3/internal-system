// DAO：既読位置を前に進める（#237。ADR-0006）。条件付きの upsert 1文で、後戻りさせない。
// D1 は書き込みを直列に実行するため、同時の既読化でも最大の ID が残る。
import { sql } from "drizzle-orm";
import type { Database } from "./database";

/**
 * 既読位置を messageId まで進め、変更した行数（1 か 0）を返す。
 * 挿入するのは、メッセージがその部屋にあり、参加中の未アーカイブのチャンネルか当事者の DM のときだけ。
 * ON CONFLICT DO UPDATE … WHERE は意図した条件：すでに同じか、より新しい位置まで既読なら更新しない（古い画面・別のタブの遅れた送信で既読が戻らないようにする）。
 * 0 行の理由（部屋の状態が崩れた・メッセージがない・すでに新しい）は、呼び出し側（Service）が読み分ける。
 * SQLite の upsert は INSERT … SELECT に WHERE 句が必要（構文のあいまいさの回避）。下の WHERE がそれを兼ねる。
 */
export async function advanceReadPosition(
  db: Database,
  input: { userId: string; roomId: string; messageId: string; now: string },
): Promise<number> {
  const { userId, roomId, messageId, now } = input;
  const result = await db.run(sql`
    INSERT INTO read_positions (user_id, room_id, last_read_message_id, updated_at)
    SELECT ${userId}, ${roomId}, ${messageId}, ${now}
    WHERE EXISTS (SELECT 1 FROM messages m WHERE m.id = ${messageId} AND m.room_id = ${roomId})
      AND (
        EXISTS (
          SELECT 1 FROM channel_members cm
          JOIN channels c ON c.room_id = cm.channel_id
          WHERE cm.channel_id = ${roomId} AND cm.user_id = ${userId} AND c.deleted_at IS NULL)
        OR EXISTS (
          SELECT 1 FROM conversation_members conv
          WHERE conv.conversation_id = ${roomId} AND conv.user_id = ${userId}))
    ON CONFLICT (user_id, room_id) DO UPDATE SET
      last_read_message_id = excluded.last_read_message_id,
      updated_at = excluded.updated_at
    WHERE excluded.last_read_message_id > read_positions.last_read_message_id`);
  return result.meta.changes;
}
