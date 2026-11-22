-- 目的：#270（添付の削除）より前に削除されたメッセージの添付に、削除の印を付ける補完（#140 の後、#270 の前は、メッセージを削除しても添付に印が付かなかった）。
-- 対象：削除済みのメッセージ（messages.deleted_at IS NOT NULL）に結び付き、まだ印のない（deleted_at IS NULL）添付。印はメッセージの deleted_at・deleted_by を写す。
--       削除されていないメッセージの添付・未投稿の添付・既に印のある添付には触れない。R2 の実体は、後始末の定期の処理（attachmentPurgeJob）が消す。
-- べき等：印のない行だけを対象にするので、何度流しても結果は同じ。
-- 相関の副問い合わせで書く（UPDATE … FROM は D1 で確かめていないため使わない）。
-- 実行方法：migration 0036 の適用の後に、wrangler d1 execute で本ファイルを指定して流す。前後の件数確認の SQL と手順は docs/design/attachments.md を参照。
UPDATE message_attachments
SET
  deleted_at = (SELECT m.deleted_at FROM messages m WHERE m.id = message_attachments.message_id),
  deleted_by = (SELECT m.deleted_by FROM messages m WHERE m.id = message_attachments.message_id)
WHERE deleted_at IS NULL
  AND message_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM messages m WHERE m.id = message_attachments.message_id AND m.deleted_at IS NOT NULL);
