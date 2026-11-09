-- 全社連絡（purpose=company_general）の初期データを補うデータ移行。#200 AC-1（ADR-0022 の例外。手作成の3本目）。
-- 文だけで完結し、何度流しても同じ結果になる：全社連絡がすでにあれば作らず、未参加の有効な社員だけを参加させる。
-- 「全社連絡」の名前（name_normalized。アーカイブ済みを含む）が既存のチャンネルと衝突する場合は、作らず、
-- 監査ログに result='failure'・target_type='channel' で1件だけ記録する（migration 自体は失敗させない。記録済みなら追加しない）。
-- 衝突の復旧手順：衝突したチャンネルを改名して衝突を解消し、この migration と同じ補完をもう一度行う。
-- ルームIDは、ULID の形式を保つ固定値（backend/src/lib/channel-rules.ts の COMPANY_GENERAL_ROOM_ID と一致させる。テストで突き合わせる）。
-- 万一ルームIDが既存と衝突したら、主キー違反で migration が失敗して止まる（途中の変更は取り消され、データは壊れない）。
-- 参加者は有効な社員（is_active=1）の全員。全社連絡は ID ではなく purpose で取る。
-- 新規の DB ではセットアップより前に流れるため、参加者0名の全社連絡ができる（最初の管理者はセットアップのときに参加する）。
-- チャンネル→参加者の順に流すため、外部キーの確認を遅らせる設定（PRAGMA defer_foreign_keys）は使わない。
INSERT INTO `audit_logs` (`id`, `occurred_at`, `actor_id`, `action`, `target_type`, `target_id`, `result`, `trace_id`, `detail`)
SELECT '0' || substr(upper(hex(randomblob(13))), 1, 25), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL,
  'channel.company_general_backfill', 'channel', '0CMPNYGNRA0000000000000000', 'failure',
  'migration-0011-seed-company-general-channel', '{"reason":"channel_name_conflict"}'
WHERE NOT EXISTS (SELECT 1 FROM `channels` WHERE `purpose` = 'company_general')
  AND EXISTS (SELECT 1 FROM `channels` WHERE `name_normalized` = '全社連絡')
  AND NOT EXISTS (
    SELECT 1 FROM `audit_logs`
    WHERE `action` = 'channel.company_general_backfill' AND `target_type` = 'channel' AND `result` = 'failure'
  );--> statement-breakpoint
INSERT INTO `rooms` (`id`, `kind`)
SELECT '0CMPNYGNRA0000000000000000', 'channel'
WHERE NOT EXISTS (SELECT 1 FROM `channels` WHERE `purpose` = 'company_general')
  AND NOT EXISTS (SELECT 1 FROM `channels` WHERE `name_normalized` = '全社連絡');--> statement-breakpoint
INSERT INTO `channels` (`room_id`, `department_id`, `name`, `name_normalized`, `description`, `visibility`, `purpose`)
SELECT '0CMPNYGNRA0000000000000000', NULL, '全社連絡', '全社連絡', '', 'public', 'company_general'
WHERE NOT EXISTS (SELECT 1 FROM `channels` WHERE `purpose` = 'company_general')
  AND NOT EXISTS (SELECT 1 FROM `channels` WHERE `name_normalized` = '全社連絡');--> statement-breakpoint
INSERT INTO `channel_members` (`channel_id`, `user_id`)
SELECT `c`.`room_id`, `u`.`id`
FROM `channels` `c` JOIN `users` `u` ON `u`.`is_active` = 1
WHERE `c`.`purpose` = 'company_general'
  AND NOT EXISTS (
    SELECT 1 FROM `channel_members` `m` WHERE `m`.`channel_id` = `c`.`room_id` AND `m`.`user_id` = `u`.`id`
  );
