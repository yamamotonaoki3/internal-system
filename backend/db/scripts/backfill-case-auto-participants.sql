-- 目的：既存の案件に、自動参加の人（有効な全体管理者と、担当部署の有効なオーナー）を参加者として補う（#147・決定 Q5。C-133・C-134）。
-- 対象：案件（cases。進行中・終了とも）の専用チャンネル（cases.channel_id）だけ。案件専用でないチャンネルには触れない。
--       有効な利用者（users.is_active = 1）だけを入れる。担当部署は case_departments で判定する。
-- べき等：INSERT ... SELECT ... WHERE NOT EXISTS のため、何度流しても参加済みの行は増えず、joined_at も変わらない。
-- 実行方法：wrangler d1 execute で本ファイルを指定して流す。本番への適用は、別に利用者の承認を得る。
-- 全体管理者を、すべての案件に入れる
INSERT INTO channel_members (channel_id, user_id, joined_at)
SELECT k.channel_id, u.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM cases k
JOIN user_role_assignments g
  ON g.role_id = 'role_global_admin' AND g.scope_type = 'company'
JOIN users u
  ON u.id = g.user_id AND u.is_active = 1
WHERE NOT EXISTS (
  SELECT 1 FROM channel_members m
  WHERE m.channel_id = k.channel_id AND m.user_id = u.id);
-- 担当部署のオーナーを、その案件に入れる（オーナーが複数の担当部署を兼ねても、1行だけ入れる）
INSERT INTO channel_members (channel_id, user_id, joined_at)
SELECT DISTINCT k.channel_id, u.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM cases k
JOIN case_departments cd
  ON cd.case_id = k.id
JOIN user_role_assignments o
  ON o.role_id = 'role_owner' AND o.department_id = cd.department_id
JOIN users u
  ON u.id = o.user_id AND u.is_active = 1
WHERE NOT EXISTS (
  SELECT 1 FROM channel_members m
  WHERE m.channel_id = k.channel_id AND m.user_id = u.id);
