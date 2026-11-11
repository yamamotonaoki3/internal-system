-- #130 E2E専用。社員ID e2euser_profile_ と、部署名 [E2E_TEST]部署130 で始まる部署だけを後始末する（spec の中で発行した e2euser_profile_card を含む）。
-- 外部キーの順：監査 → セッション → 参加者 → チャンネル → ルーム → ロール → 社員（status_updated_by を先に外す）→ 部署。
DELETE FROM audit_logs
WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_profile!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_profile!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署130');
DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_profile!_%' ESCAPE '!');
DELETE FROM channel_members
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_profile!_%' ESCAPE '!')
   OR channel_id IN (
     SELECT room_id FROM channels
     WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署130')
   );
DELETE FROM channels
WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署130');
-- ルームは、上で消したチャンネルの行がもう無いため、チャンネルの行を持たない kind='channel' のルームだけを消す（テスト用DBでだけ流す）
DELETE FROM rooms WHERE kind = 'channel' AND id NOT IN (SELECT room_id FROM channels);
DELETE FROM user_role_assignments
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_profile!_%' ESCAPE '!')
   OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署130');
-- 代理設定で他の利用者の status_updated_by がこの社員を指していることがあるため、消す前に外す
UPDATE users SET status_updated_by = NULL
WHERE status_updated_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_profile!_%' ESCAPE '!');
UPDATE users SET email_verified_by = NULL
WHERE email_verified_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_profile!_%' ESCAPE '!')
  AND login_id NOT LIKE 'e2euser!_profile!_%' ESCAPE '!';
DELETE FROM users WHERE login_id LIKE 'e2euser!_profile!_%' ESCAPE '!';
DELETE FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署130';

-- 残りの件数（すべて 0 になることを確かめる）
SELECT
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_profile!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署130') AS remaining_departments,
  (SELECT COUNT(*) FROM channels WHERE substr(name, 1, 15) = '[E2E_TEST]部署130') AS remaining_channels,
  (SELECT COUNT(*) FROM audit_logs WHERE actor_id IN ('01JTE2E0000000000000000130', '01JTE2E0000000000000005130')
     OR target_id IN ('01JTE2E0000000000000000130', '01JTE2E0000000000000005130')) AS remaining_audits;
