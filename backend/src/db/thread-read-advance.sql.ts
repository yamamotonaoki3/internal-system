// DAO：スレッドの既読位置を前に進める（#137。C-147）。read-position-advance.sql.ts と同じ形の条件付き upsert 1文で、後戻りさせない。
// 挿入するのは、次のすべてを満たすときだけ。
//   ① lastReadMessageId が、その親の返信である（親そのもの・別のスレッドの返信・存在しない ID は入らない。削除済みの返信は入る）
//   ② 親が通常の投稿（返信でない）で、その部屋が、参加中の未アーカイブのチャンネルか当事者の DM
// 部署が無効のチャンネルでも既読にできる（読むだけの操作のため）。
// ON CONFLICT DO UPDATE … WHERE は意図した条件：すでに同じか、より新しい位置まで既読なら更新しない（遅れた送信で既読が戻らないようにする）。
// 0 行の理由（状態が崩れた・返信がそのスレッドにない・すでに新しい）は、呼び出し側（Service）が読み分ける。
import { sql } from "drizzle-orm";
import type { Database } from "./database";

/** 既読位置を lastReadMessageId まで進め、変更した行数（1 か 0）を返す */
export async function advanceThreadReadPosition(
  db: Database,
  input: {
    userId: string;
    parentMessageId: string;
    lastReadMessageId: string;
    now: string;
  },
): Promise<number> {
  const { userId, parentMessageId, lastReadMessageId, now } = input;
  const result = await db.run(sql`
    INSERT INTO thread_read_positions (user_id, parent_message_id, last_read_message_id, updated_at)
    SELECT ${userId}, ${parentMessageId}, ${lastReadMessageId}, ${now}
    WHERE EXISTS (SELECT 1 FROM messages r WHERE r.id = ${lastReadMessageId} AND r.parent_message_id = ${parentMessageId})
      AND EXISTS (
        SELECT 1 FROM messages p
        WHERE p.id = ${parentMessageId} AND p.parent_message_id IS NULL
          AND (
            EXISTS (
              SELECT 1 FROM channel_members cm
              JOIN channels c ON c.room_id = cm.channel_id
              WHERE cm.channel_id = p.room_id AND cm.user_id = ${userId} AND c.deleted_at IS NULL)
            OR EXISTS (
              SELECT 1 FROM conversation_members conv
              WHERE conv.conversation_id = p.room_id AND conv.user_id = ${userId})))
    ON CONFLICT (user_id, parent_message_id) DO UPDATE SET
      last_read_message_id = excluded.last_read_message_id,
      updated_at = excluded.updated_at
    WHERE excluded.last_read_message_id > thread_read_positions.last_read_message_id`);
  return result.meta.changes;
}
