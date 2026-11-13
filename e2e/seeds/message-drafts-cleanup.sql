-- #239 E2E の後始末。社員ID e2euser_draft_ で始まる利用者と、部署名 [E2E_TEST]部署239 の部署・そのチャンネルだけを消す。
-- 端末の下書き（ブラウザの localStorage）は、spec のブラウザのコンテキストを閉じると消える（DB には保存しない）。
-- 外部キーの順：既読位置（read_positions）→ メッセージ → 通知 → 監査 → セッション → 参加者 → チャンネル → ルーム → ロール → 社員 → 部署。
-- LIKE のパターンは 50 バイト以内（D1）。部署名は先頭15文字の一致で絞る。
DELETE FROM read_positions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_draft!_%' ESCAPE '!')
   OR room_id IN (
     SELECT room_id FROM channels
     WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署239')
   );
DELETE FROM messages
WHERE sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_draft!_%' ESCAPE '!')
   OR room_id IN (
     SELECT room_id FROM channels
     WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署239')
   );
DELETE FROM notifications
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_draft!_%' ESCAPE '!');
DELETE FROM audit_logs
WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_draft!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_draft!_%' ESCAPE '!');
DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_draft!_%' ESCAPE '!');
DELETE FROM channel_members
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_draft!_%' ESCAPE '!')
   OR channel_id IN (
     SELECT room_id FROM channels
     WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署239')
   );
DELETE FROM channels
WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署239');
DELETE FROM rooms
WHERE id IN ('01JTE2E2390000000000000C01', '01JTE2E2390000000000000C02');
DELETE FROM user_role_assignments
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_draft!_%' ESCAPE '!')
   OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署239');
UPDATE users SET status_updated_by = NULL
WHERE status_updated_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_draft!_%' ESCAPE '!');
DELETE FROM users WHERE login_id LIKE 'e2euser!_draft!_%' ESCAPE '!';
DELETE FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署239';

-- 残りの件数（すべて 0 になることを確かめる。e2e/message-drafts.spec.ts の beforeAll・afterAll が出力を照合する）
SELECT
  (SELECT COUNT(*) FROM read_positions
     WHERE user_id LIKE '01JTE2E239%'
        OR room_id IN ('01JTE2E2390000000000000C01', '01JTE2E2390000000000000C02')) AS remaining_read_positions,
  (SELECT COUNT(*) FROM messages
     WHERE sender_id LIKE '01JTE2E239%'
        OR room_id IN ('01JTE2E2390000000000000C01', '01JTE2E2390000000000000C02')) AS remaining_messages,
  (SELECT COUNT(*) FROM channel_members
     WHERE user_id LIKE '01JTE2E239%' OR channel_id LIKE '01JTE2E239%') AS remaining_channel_members,
  (SELECT COUNT(*) FROM channels WHERE substr(name, 1, 15) = '[E2E_TEST]部署239') AS remaining_channels,
  (SELECT COUNT(*) FROM rooms
     WHERE id IN ('01JTE2E2390000000000000C01', '01JTE2E2390000000000000C02')) AS remaining_rooms,
  (SELECT COUNT(*) FROM sessions WHERE user_id LIKE '01JTE2E239%') AS remaining_sessions,
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_draft!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署239') AS remaining_departments;
