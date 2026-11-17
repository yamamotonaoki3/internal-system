// DAO：添付を見てよいかの条件（#140。配信のたびに使う）。メッセージ一覧と同じ規則を SQL にしたもの。
// 一覧の側の規則は services/message.service.ts の requireVisible（lib/channel-rules.ts の canViewChannel と、DM の当事者の確認）。
// どちらかを変えるときは、両方を直す（一覧で見えないメッセージの添付を、配信で返さないため）。
//   部屋：チャンネルは未アーカイブで、公開か、見る人が参加中の非公開／DM は見る人が当事者
//   かつ、次のどちらか
//     投稿に結び付いた添付：メッセージが削除されていない
//     未投稿の添付：アップロードした本人
// 見えない添付は、存在しない添付と区別しない（呼び出し側が同じ 404 にする）。
import { sql, type SQL } from "drizzle-orm";
import { messageAttachments } from "../../db/schema";

export function attachmentVisible(viewerId: string): SQL {
  const a = messageAttachments;
  return sql`(
    (
      EXISTS (
        SELECT 1 FROM channels c
        LEFT JOIN channel_members cm ON cm.channel_id = c.room_id AND cm.user_id = ${viewerId}
        WHERE c.room_id = ${a.roomId} AND c.deleted_at IS NULL
          AND (c.visibility = 'public' OR cm.user_id IS NOT NULL))
      OR EXISTS (
        SELECT 1 FROM conversation_members cv
        WHERE cv.conversation_id = ${a.roomId} AND cv.user_id = ${viewerId}))
    AND (
      (${a.messageId} IS NOT NULL AND EXISTS (
        SELECT 1 FROM messages m
        WHERE m.id = ${a.messageId} AND m.room_id = ${a.roomId} AND m.deleted_at IS NULL))
      OR (${a.messageId} IS NULL AND ${a.uploaderId} = ${viewerId})))`;
}
