-- 目的：部署のオーナーを兼ねる全体管理者を、その部署の専用チャンネル（department・announcement）へ参加させる補完（#206）。
-- 対象：有効な利用者（users.is_active = 1）で、部署のオーナーのロールと全体管理者のロールを持ち、
--       その部署の purpose が department / announcement で、アーカイブされていない（deleted_at が NULL の）チャンネルに未参加の人。
-- べき等：INSERT ... SELECT ... WHERE NOT EXISTS のため、何度流しても参加済みの行は増えず、joined_at も変わらない。
-- 実行方法：wrangler d1 execute で本ファイルを指定して流す。適用前後の件数確認は docs/design/department-management.md を参照。
INSERT INTO channel_members (channel_id, user_id, joined_at)
SELECT c.room_id, u.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM users u
JOIN user_role_assignments o
  ON o.user_id = u.id AND o.role_id = 'role_owner'
JOIN channels c
  ON c.department_id = o.department_id
WHERE u.is_active = 1
  AND c.purpose IN ('department', 'announcement')
  AND c.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM user_role_assignments g
    WHERE g.user_id = u.id AND g.role_id = 'role_global_admin')
  AND NOT EXISTS (
    SELECT 1 FROM channel_members m
    WHERE m.channel_id = c.room_id AND m.user_id = u.id);
