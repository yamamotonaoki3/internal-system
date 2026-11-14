// DAO：スレッドの返信の書き込み（#137）。「返信してよい」条件を持つ SQL をここに閉じ込める。
// 条件を INSERT の WHERE に置くのは、Service の確認から書き込みまでの間に状態が変わっても、条件を破る行を書かないため（C-59 の親の削除を含む）。
// 次のすべてを満たすときだけ1行を挿入する。
//   ① ID が部屋の最大（返信も含む）より大きい（部屋の中では、コミットの順に ID が増える。#201。返信も同じ並びに入れる）
//   ② 親が同じ部屋にあり、通常の投稿（返信への返信は作らない）で、削除済みでない（C-59）
//   ③ チャンネル：未アーカイブで、投稿者が参加中・部署が有効（会社直属は有効として扱う）／DM：投稿者が当事者で、当事者に無効な社員がいない
// お知らせ専用でも、参加者なら返信できる（U-6）ので、投稿権限（perm.announcement.post）は条件に入れない。
// 0 行の理由（状態が崩れた・親が削除された・ID が最大以下）は、呼び出し側（Service）が読み分ける。
import { sql } from "drizzle-orm";
import type { Database } from "./database";

export type ReplyInsert = {
  id: string;
  roomId: string;
  parentMessageId: string;
  senderId: string;
  senderDisplayName: string;
  body: string;
  createdAt: string;
};

/** 挿入した行数（1 か 0） */
export async function insertReplyIfOrdered(
  db: Database,
  input: ReplyInsert,
): Promise<number> {
  const result = await db.run(sql`
    INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at, parent_message_id)
    SELECT ${input.id}, ${input.roomId}, ${input.senderId}, ${input.senderDisplayName}, ${input.body}, ${input.createdAt}, ${input.parentMessageId}
    WHERE NOT EXISTS (SELECT 1 FROM messages WHERE room_id = ${input.roomId} AND id >= ${input.id})
      AND EXISTS (
        SELECT 1 FROM messages p
        WHERE p.id = ${input.parentMessageId} AND p.room_id = ${input.roomId}
          AND p.parent_message_id IS NULL AND p.deleted_at IS NULL)
      AND (
        EXISTS (
          SELECT 1 FROM channels c
          JOIN channel_members cm ON cm.channel_id = c.room_id AND cm.user_id = ${input.senderId}
          LEFT JOIN departments d ON d.id = c.department_id
          WHERE c.room_id = ${input.roomId} AND c.deleted_at IS NULL
            AND (c.department_id IS NULL OR d.is_active = 1))
        OR (
          EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = ${input.roomId} AND user_id = ${input.senderId})
          AND NOT EXISTS (SELECT 1 FROM conversation_members cv JOIN users u ON u.id = cv.user_id WHERE cv.conversation_id = ${input.roomId} AND u.is_active = 0)))`);
  return result.meta.changes;
}
