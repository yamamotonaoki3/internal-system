-- 既存の部署（初代部署など）に、自動専用チャンネル2つ（通常・お知らせ）と参加者を補うデータ移行。#196 AC-3（ADR-0018 の例外）。
-- 文だけで完結し、何度流しても同じ結果になる：自動チャンネルをすでに持つ部署は対象外。
-- 既存のチャンネル名（アーカイブ済みを含む）や、補う部署どうしの名前と衝突する部署は、通常・お知らせの両方とも作らず、
-- 監査ログに result='failure'・target_type='department'・target_id=部署ID で1件記録する（migration 自体は失敗させず、ほかの部署は補う）。
-- 参加者は、その部署に所属する有効な社員だけ（全体管理者でも所属していなければ参加しない）。
-- チャンネルのルームIDは、部署IDの2文字目だけを通常は Y、お知らせは Z に置き換えた26文字（ULID の形式を保つ）。
-- 注意：pending／eligible の CTE は4つの文で同じ内容にしてある。どれか1つだけを直さない（直すときは4つともそろえる）。
-- ルームIDを部署IDの2文字目の置き換えで作るのは、文だけで完結し、部署ごとに決まった値にしてべき等にするため。
-- 万一ルームIDが既存と衝突したら、主キー違反で migration が失敗して止まる（途中の変更は取り消され、データは壊れない）。
-- 参加者の文はチャンネルの文より先に流すため、外部キーの確認をこの migration の最後まで遅らせる。
INSERT INTO `audit_logs` (`id`, `occurred_at`, `actor_id`, `action`, `target_type`, `target_id`, `result`, `trace_id`, `detail`)
WITH `pending` AS (
  SELECT `d`.`id`, `d`.`name_normalized` FROM `departments` `d`
  WHERE NOT EXISTS (
    SELECT 1 FROM `channels` `c`
    WHERE `c`.`department_id` = `d`.`id` AND `c`.`purpose` IN ('department', 'announcement')
  )
), `eligible` AS (
  SELECT `p`.`id` FROM `pending` `p`
  WHERE NOT EXISTS (
      SELECT 1 FROM `channels` `c`
      WHERE `c`.`name_normalized` IN (`p`.`name_normalized`, `p`.`name_normalized` || 'のお知らせ')
    )
    AND NOT EXISTS (
      SELECT 1 FROM `pending` `q`
      WHERE `q`.`id` <> `p`.`id`
        AND (`q`.`name_normalized` = `p`.`name_normalized` || 'のお知らせ'
          OR `q`.`name_normalized` || 'のお知らせ' = `p`.`name_normalized`)
    )
)
SELECT '0' || substr(upper(hex(randomblob(13))), 1, 25), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL,
  'department.channel_backfill', 'department', `p`.`id`, 'failure',
  'migration-0009-backfill-department-channels', '{"reason":"channel_name_conflict"}'
FROM `pending` `p`
WHERE `p`.`id` NOT IN (SELECT `id` FROM `eligible`)
  AND NOT EXISTS (
    SELECT 1 FROM `audit_logs` `a`
    WHERE `a`.`action` = 'department.channel_backfill' AND `a`.`target_id` = `p`.`id` AND `a`.`result` = 'failure'
  );--> statement-breakpoint
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
INSERT INTO `rooms` (`id`, `kind`)
WITH `pending` AS (
  SELECT `d`.`id`, `d`.`name_normalized` FROM `departments` `d`
  WHERE NOT EXISTS (
    SELECT 1 FROM `channels` `c`
    WHERE `c`.`department_id` = `d`.`id` AND `c`.`purpose` IN ('department', 'announcement')
  )
), `eligible` AS (
  SELECT `p`.`id` FROM `pending` `p`
  WHERE NOT EXISTS (
      SELECT 1 FROM `channels` `c`
      WHERE `c`.`name_normalized` IN (`p`.`name_normalized`, `p`.`name_normalized` || 'のお知らせ')
    )
    AND NOT EXISTS (
      SELECT 1 FROM `pending` `q`
      WHERE `q`.`id` <> `p`.`id`
        AND (`q`.`name_normalized` = `p`.`name_normalized` || 'のお知らせ'
          OR `q`.`name_normalized` || 'のお知らせ' = `p`.`name_normalized`)
    )
)
SELECT substr(`id`, 1, 1) || 'Y' || substr(`id`, 3), 'channel' FROM `eligible`
UNION ALL
SELECT substr(`id`, 1, 1) || 'Z' || substr(`id`, 3), 'channel' FROM `eligible`;--> statement-breakpoint
INSERT INTO `channel_members` (`channel_id`, `user_id`)
WITH `pending` AS (
  SELECT `d`.`id`, `d`.`name_normalized` FROM `departments` `d`
  WHERE NOT EXISTS (
    SELECT 1 FROM `channels` `c`
    WHERE `c`.`department_id` = `d`.`id` AND `c`.`purpose` IN ('department', 'announcement')
  )
), `eligible` AS (
  SELECT `p`.`id` FROM `pending` `p`
  WHERE NOT EXISTS (
      SELECT 1 FROM `channels` `c`
      WHERE `c`.`name_normalized` IN (`p`.`name_normalized`, `p`.`name_normalized` || 'のお知らせ')
    )
    AND NOT EXISTS (
      SELECT 1 FROM `pending` `q`
      WHERE `q`.`id` <> `p`.`id`
        AND (`q`.`name_normalized` = `p`.`name_normalized` || 'のお知らせ'
          OR `q`.`name_normalized` || 'のお知らせ' = `p`.`name_normalized`)
    )
)
SELECT substr(`e`.`id`, 1, 1) || 'Y' || substr(`e`.`id`, 3), `u`.`id`
FROM `eligible` `e` JOIN `users` `u` ON `u`.`department_id` = `e`.`id` AND `u`.`is_active` = 1
UNION ALL
SELECT substr(`e`.`id`, 1, 1) || 'Z' || substr(`e`.`id`, 3), `u`.`id`
FROM `eligible` `e` JOIN `users` `u` ON `u`.`department_id` = `e`.`id` AND `u`.`is_active` = 1;--> statement-breakpoint
INSERT INTO `channels` (`room_id`, `department_id`, `name`, `name_normalized`, `description`, `visibility`, `purpose`)
WITH `pending` AS (
  SELECT `d`.`id`, `d`.`name`, `d`.`name_normalized` FROM `departments` `d`
  WHERE NOT EXISTS (
    SELECT 1 FROM `channels` `c`
    WHERE `c`.`department_id` = `d`.`id` AND `c`.`purpose` IN ('department', 'announcement')
  )
), `eligible` AS (
  SELECT `p`.`id`, `p`.`name`, `p`.`name_normalized` FROM `pending` `p`
  WHERE NOT EXISTS (
      SELECT 1 FROM `channels` `c`
      WHERE `c`.`name_normalized` IN (`p`.`name_normalized`, `p`.`name_normalized` || 'のお知らせ')
    )
    AND NOT EXISTS (
      SELECT 1 FROM `pending` `q`
      WHERE `q`.`id` <> `p`.`id`
        AND (`q`.`name_normalized` = `p`.`name_normalized` || 'のお知らせ'
          OR `q`.`name_normalized` || 'のお知らせ' = `p`.`name_normalized`)
    )
)
SELECT substr(`id`, 1, 1) || 'Y' || substr(`id`, 3), `id`, `name`, `name_normalized`, '', 'public', 'department' FROM `eligible`
UNION ALL
SELECT substr(`id`, 1, 1) || 'Z' || substr(`id`, 3), `id`, `name` || 'のお知らせ', `name_normalized` || 'のお知らせ', '', 'public', 'announcement' FROM `eligible`;
