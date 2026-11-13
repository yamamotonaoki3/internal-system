-- #238 E2E の後始末。社員ID e2euser_ret238_ で始まる利用者と、部署名 [E2E_TEST]部署238 の部署・そのチャンネル・そのメッセージだけを消す。
-- 外部キーの順：既読位置 → メッセージ → 監査 → セッション → 参加者 → チャンネル → ルーム → ロール → 社員 → 部署。
-- 部屋を開くと既読位置（read_positions）の行ができ、利用者・部屋を外部キーで指すため、利用者・部屋より先に消す。
DELETE FROM read_positions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_ret238!_%' ESCAPE '!')
   OR room_id = '01JTE2E2380000000000000C01'
   OR room_id IN (SELECT room_id FROM channels WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署238'));
DELETE FROM messages
WHERE sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_ret238!_%' ESCAPE '!')
   OR room_id IN (
     SELECT room_id FROM channels
     WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署238')
   );
DELETE FROM audit_logs
WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_ret238!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_ret238!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署238');
DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_ret238!_%' ESCAPE '!');
DELETE FROM channel_members
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_ret238!_%' ESCAPE '!')
   OR channel_id IN (
     SELECT room_id FROM channels
     WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署238')
   );
DELETE FROM channels
WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署238');
-- ルームは、messages-retired.sql が入れた固定のIDだけを消す（チャンネルの行を先に消したため、外部キーに当たらない）
DELETE FROM rooms WHERE id = '01JTE2E2380000000000000C01';
DELETE FROM user_role_assignments
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_ret238!_%' ESCAPE '!');
UPDATE users SET status_updated_by = NULL
WHERE status_updated_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_ret238!_%' ESCAPE '!');
DELETE FROM users WHERE login_id LIKE 'e2euser!_ret238!_%' ESCAPE '!';
DELETE FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署238';

-- 残りの件数（すべて 0 になることを確かめる。e2e/messages-retired.spec.ts の afterAll が出力を照合する）
SELECT
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_ret238!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署238') AS remaining_departments,
  (SELECT COUNT(*) FROM channels WHERE substr(name, 1, 15) = '[E2E_TEST]部署238') AS remaining_channels,
  (SELECT COUNT(*) FROM rooms WHERE id = '01JTE2E2380000000000000C01') AS remaining_rooms,
  (SELECT COUNT(*) FROM messages WHERE sender_id LIKE '01JTE2E238%' OR room_id = '01JTE2E2380000000000000C01') AS remaining_messages,
  (SELECT COUNT(*) FROM channel_members WHERE user_id LIKE '01JTE2E238%' OR channel_id = '01JTE2E2380000000000000C01') AS remaining_members,
  (SELECT COUNT(*) FROM sessions WHERE user_id LIKE '01JTE2E238%') AS remaining_sessions,
  (SELECT COUNT(*) FROM read_positions WHERE user_id LIKE '01JTE2E238%' OR room_id = '01JTE2E2380000000000000C01') AS remaining_read_positions;
