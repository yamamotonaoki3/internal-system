-- #196 E2E専用。社員ID e2euser_dept_ と、部署名 [E2E_TEST]部署196 で始まる部署（画面から作った部署を含む）だけを後始末する。
-- 外部キーの順：監査 → セッション → 参加者 → チャンネル → ルーム → ロール → 社員 → 部署。
DELETE FROM audit_logs
WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_dept!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署196');
DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_dept!_%' ESCAPE '!');
DELETE FROM channel_members
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_dept!_%' ESCAPE '!')
   OR channel_id IN (
     SELECT room_id FROM channels
     WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署196')
   );
DELETE FROM channels
WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署196');
-- ルームは、上で消したチャンネルの行がもう無いため、チャンネルの行を持たない kind='channel' のルームだけを消す
-- （チャンネルのルームは必ず channels の行を持つため、ここで消えるのは今消したチャンネルのルームだけ。テスト用DBでだけ流す）
DELETE FROM rooms WHERE kind = 'channel' AND id NOT IN (SELECT room_id FROM channels);
DELETE FROM user_role_assignments
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_dept!_%' ESCAPE '!')
   OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署196');
DELETE FROM users WHERE login_id LIKE 'e2euser!_dept!_%' ESCAPE '!';
DELETE FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署196';

-- 残りの件数（すべて 0 になることを確かめる）
SELECT
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_dept!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署196') AS remaining_departments,
  (SELECT COUNT(*) FROM channels WHERE substr(name, 1, 15) = '[E2E_TEST]部署196') AS remaining_channels;
