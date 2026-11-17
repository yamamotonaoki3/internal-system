-- #140 E2E の後始末。社員ID e2euser_att_ で始まる利用者と、部署名 [E2E_TEST] 添付 の部署・そのチャンネルと、その部屋のメッセージ・添付だけを消す。
-- R2 の手元の実体は、この SQL の前に e2e/attachments.spec.ts が storage_key を読んで消す（本物のバケットには接続しない）。
-- 外部キーの順：添付（message_attachments）→ リアクション・メンション → 既読位置 → 返信 → 親のメッセージ → 通知 → 監査・セッション
--   → 参加者 → チャンネル → ルーム → ロール → 社員 → 部署。
-- 1. 添付（テストの利用者がアップロードしたもの・テストの部屋のもの）
DELETE FROM message_attachments
WHERE uploader_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_att!_%' ESCAPE '!')
   OR room_id IN (SELECT room_id FROM channels WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 13) = '[E2E_TEST] 添付'));
-- 2. リアクション・メンション・既読位置
DELETE FROM message_reactions WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_att!_%' ESCAPE '!') OR message_id IN (SELECT id FROM messages WHERE sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_att!_%' ESCAPE '!') OR room_id IN (SELECT room_id FROM channels WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 13) = '[E2E_TEST] 添付')));
DELETE FROM message_mentions WHERE message_id IN (SELECT id FROM messages WHERE sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_att!_%' ESCAPE '!') OR room_id IN (SELECT room_id FROM channels WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 13) = '[E2E_TEST] 添付')));
DELETE FROM thread_read_positions WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_att!_%' ESCAPE '!') OR parent_message_id IN (SELECT id FROM messages WHERE sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_att!_%' ESCAPE '!') OR room_id IN (SELECT room_id FROM channels WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 13) = '[E2E_TEST] 添付')));
DELETE FROM read_positions WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_att!_%' ESCAPE '!') OR room_id IN (SELECT room_id FROM channels WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 13) = '[E2E_TEST] 添付'));
-- 3. 返信 → 親のメッセージ
DELETE FROM messages WHERE parent_message_id IS NOT NULL AND (sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_att!_%' ESCAPE '!') OR room_id IN (SELECT room_id FROM channels WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 13) = '[E2E_TEST] 添付')));
DELETE FROM messages WHERE sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_att!_%' ESCAPE '!') OR room_id IN (SELECT room_id FROM channels WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 13) = '[E2E_TEST] 添付'));
DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_att!_%' ESCAPE '!');
-- 4. 監査・セッション
DELETE FROM audit_logs WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_att!_%' ESCAPE '!') OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_att!_%' ESCAPE '!');
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_att!_%' ESCAPE '!');
-- 5. 参加者 → チャンネル → ルーム
DELETE FROM channel_members WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_att!_%' ESCAPE '!') OR channel_id IN (SELECT room_id FROM channels WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 13) = '[E2E_TEST] 添付'));
DELETE FROM channels WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 13) = '[E2E_TEST] 添付');
DELETE FROM rooms WHERE id IN ('01JTE2E1400000000000000C01');
-- 6. ロール → 社員 → 部署
DELETE FROM user_role_assignments WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_att!_%' ESCAPE '!') OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 13) = '[E2E_TEST] 添付');
UPDATE users SET status_updated_by = NULL WHERE status_updated_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_att!_%' ESCAPE '!');
DELETE FROM users WHERE login_id LIKE 'e2euser!_att!_%' ESCAPE '!';
DELETE FROM departments WHERE substr(name, 1, 13) = '[E2E_TEST] 添付';

-- 残りの件数（すべて 0 になることを確かめる。e2e/attachments.spec.ts の beforeAll・afterAll が出力を照合する）
SELECT
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_att!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM departments WHERE substr(name, 1, 13) = '[E2E_TEST] 添付') AS remaining_departments,
  (SELECT COUNT(*) FROM rooms WHERE id IN ('01JTE2E1400000000000000C01')) AS remaining_rooms,
  (SELECT COUNT(*) FROM messages WHERE room_id IN ('01JTE2E1400000000000000C01')) AS remaining_messages,
  (SELECT COUNT(*) FROM message_attachments WHERE room_id IN ('01JTE2E1400000000000000C01')) AS remaining_message_attachments;
