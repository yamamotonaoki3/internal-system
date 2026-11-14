-- #134 E2E の後始末（e2e/messages-edit-delete.spec.ts・e2e/messages-markdown.spec.ts）。
-- 社員ID e2euser_edit134_ で始まる利用者、部署名 [E2E_TEST]部署134 の部署・そのチャンネル、messages-edit.sql が入れた固定の部屋だけを消す。
-- 外部キーの順：既読位置 → メッセージ（削除の deleted_by が利用者を指すため、利用者より先）→ DM の当事者 → DM → 通知 → 監査 → セッション
--   → 参加者 → チャンネル → ルーム → ロール → 社員 → 部署。
-- LIKE のパターンは 50 バイト以内（D1）。部署名は先頭15文字の一致で絞る。
DELETE FROM read_positions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_edit134!_%' ESCAPE '!')
   OR room_id IN ('01JTE2E1340000000000000C01', '01JTE2E1340000000000000C02', '01JTE2E1340000000000000M01');
DELETE FROM messages
WHERE sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_edit134!_%' ESCAPE '!')
   OR room_id IN ('01JTE2E1340000000000000C01', '01JTE2E1340000000000000C02', '01JTE2E1340000000000000M01');
DELETE FROM conversation_members
WHERE conversation_id = '01JTE2E1340000000000000M01'
   OR user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_edit134!_%' ESCAPE '!');
DELETE FROM conversations WHERE room_id = '01JTE2E1340000000000000M01';
DELETE FROM notifications
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_edit134!_%' ESCAPE '!');
-- 削除の監査（message.delete）は、操作した本人（actor_id）で消える
DELETE FROM audit_logs
WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_edit134!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_edit134!_%' ESCAPE '!')
   OR target_id IN ('01JTE2E1340000000000000C01', '01JTE2E1340000000000000C02', '01JTE2E1340000000000000M01')
   OR target_id LIKE '01M78ZTJC000000000013400%';
DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_edit134!_%' ESCAPE '!');
DELETE FROM channel_members
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_edit134!_%' ESCAPE '!')
   OR channel_id IN ('01JTE2E1340000000000000C01', '01JTE2E1340000000000000C02');
DELETE FROM channels
WHERE room_id IN ('01JTE2E1340000000000000C01', '01JTE2E1340000000000000C02')
   OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署134');
DELETE FROM rooms
WHERE id IN ('01JTE2E1340000000000000C01', '01JTE2E1340000000000000C02', '01JTE2E1340000000000000M01');
DELETE FROM user_role_assignments
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_edit134!_%' ESCAPE '!')
   OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署134');
UPDATE users SET status_updated_by = NULL
WHERE status_updated_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_edit134!_%' ESCAPE '!');
DELETE FROM users WHERE login_id LIKE 'e2euser!_edit134!_%' ESCAPE '!';
DELETE FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署134';

-- 残りの件数（すべて 0 になることを確かめる。spec の beforeAll・afterAll が出力を照合する）
SELECT
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_edit134!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署134') AS remaining_departments,
  (SELECT COUNT(*) FROM channels WHERE substr(name, 1, 15) = '[E2E_TEST]部署134') AS remaining_channels,
  (SELECT COUNT(*) FROM rooms
     WHERE id IN ('01JTE2E1340000000000000C01', '01JTE2E1340000000000000C02', '01JTE2E1340000000000000M01')) AS remaining_rooms,
  (SELECT COUNT(*) FROM conversations WHERE room_id = '01JTE2E1340000000000000M01') AS remaining_conversations,
  (SELECT COUNT(*) FROM conversation_members
     WHERE conversation_id = '01JTE2E1340000000000000M01' OR user_id LIKE '01JTE2E134%') AS remaining_conversation_members,
  (SELECT COUNT(*) FROM messages
     WHERE sender_id LIKE '01JTE2E134%'
        OR room_id IN ('01JTE2E1340000000000000C01', '01JTE2E1340000000000000C02', '01JTE2E1340000000000000M01')) AS remaining_messages,
  (SELECT COUNT(*) FROM channel_members
     WHERE user_id LIKE '01JTE2E134%' OR channel_id LIKE '01JTE2E134%') AS remaining_channel_members,
  (SELECT COUNT(*) FROM read_positions
     WHERE user_id LIKE '01JTE2E134%' OR room_id LIKE '01JTE2E134%') AS remaining_read_positions,
  (SELECT COUNT(*) FROM sessions WHERE user_id LIKE '01JTE2E134%') AS remaining_sessions,
  (SELECT COUNT(*) FROM audit_logs WHERE actor_id LIKE '01JTE2E134%') AS remaining_audit_logs;
