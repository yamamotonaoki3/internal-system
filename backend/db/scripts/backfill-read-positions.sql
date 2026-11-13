-- 目的：未読の件数（#237）を出す前に、既存の利用者の既読位置を「いまの最新のメッセージ」に合わせる初期合わせ。合わせないと、デプロイの直後に既存の部屋が「99+」になる（C-169 (6)）。
-- 対象：チャンネルの参加者（channel_members の全行。アーカイブ済みのチャンネルも含む。アーカイブを戻したときに「99+」にならないため）と、DM の当事者（conversation_members）の、利用者×部屋。
--       値はその時点の部屋の最新のメッセージ ID（MAX(messages.id)）。メッセージのない部屋・未参加の公開チャンネル・他人の DM には行を作らない。
-- べき等：ON CONFLICT (user_id, room_id) DO NOTHING。すでにある既読位置は変えない（利用者が進めた位置を、流し直しで巻き戻さないため）。何度流しても、まだない行だけが増える。
-- 実行方法：migration 0018 の適用の直後、コードのデプロイの前に、wrangler d1 execute で本ファイルを指定して流す。前後の件数確認・本番の手順は docs/design/unread.md を参照。
-- WHERE を持つのは、SQLite の INSERT ... SELECT ... ON CONFLICT の構文のあいまいさを避けるため。
INSERT INTO read_positions (user_id, room_id, last_read_message_id, updated_at)
SELECT t.user_id, t.room_id,
  (SELECT MAX(m.id) FROM messages m WHERE m.room_id = t.room_id),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (
  SELECT cm.user_id AS user_id, cm.channel_id AS room_id
  FROM channel_members cm
  UNION ALL
  SELECT conv.user_id AS user_id, conv.conversation_id AS room_id
  FROM conversation_members conv) t
WHERE EXISTS (SELECT 1 FROM messages m WHERE m.room_id = t.room_id)
ON CONFLICT (user_id, room_id) DO NOTHING;
