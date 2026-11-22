-- #270（270-A）E2E の後始末。社員ID e2euser_attdel_ で始まる利用者と、部署名 [E2E_TEST] 削除添付 の部署・そのチャンネルと、
-- その部屋のメッセージ・添付（削除の印のついた行を含む）・監査だけを消す。
-- R2 の手元の実体は、この SQL の前に e2e/attachment-delete.spec.ts が storage_key を読んで消す（本物のバケットには接続しない）。
-- 外部キーの順：添付（message_attachments。deleted_by は社員を指す）→ 検索の索引 → リアクション・メンション → 既読位置 → 返信 → 親のメッセージ
--   → 通知 → 監査・セッション → 参加者 → チャンネル → ルーム → ロール → 社員 → 部署。
-- 1. 添付（テストの利用者がアップロード・削除したもの・テストの部屋のもの）
DELETE FROM message_attachments
WHERE uploader_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_attdel!_%' ESCAPE '!')
   OR deleted_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_attdel!_%' ESCAPE '!')
   OR room_id IN (SELECT room_id FROM channels WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST] 削除添付'));
-- 2. 検索の索引（テストの部屋の写しと、元の行がない写し）
DELETE FROM search_fts WHERE rowid IN (SELECT id FROM search_documents WHERE room_id IN ('01JTE2E2700000000000000C01') OR (kind = 'attachment' AND ref_id NOT IN (SELECT id FROM message_attachments)));
DELETE FROM search_documents WHERE room_id IN ('01JTE2E2700000000000000C01') OR (kind = 'attachment' AND ref_id NOT IN (SELECT id FROM message_attachments));
-- 3. リアクション・メンション・既読位置
DELETE FROM message_reactions WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_attdel!_%' ESCAPE '!') OR message_id IN (SELECT id FROM messages WHERE room_id IN ('01JTE2E2700000000000000C01'));
DELETE FROM message_mentions WHERE message_id IN (SELECT id FROM messages WHERE room_id IN ('01JTE2E2700000000000000C01'));
DELETE FROM thread_read_positions WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_attdel!_%' ESCAPE '!') OR parent_message_id IN (SELECT id FROM messages WHERE room_id IN ('01JTE2E2700000000000000C01'));
DELETE FROM read_positions WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_attdel!_%' ESCAPE '!') OR room_id IN ('01JTE2E2700000000000000C01');
-- 4. 返信 → 親のメッセージ・通知
DELETE FROM messages WHERE parent_message_id IS NOT NULL AND room_id IN ('01JTE2E2700000000000000C01');
DELETE FROM messages WHERE sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_attdel!_%' ESCAPE '!') OR room_id IN ('01JTE2E2700000000000000C01');
DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_attdel!_%' ESCAPE '!');
-- 5. 監査（attachment.delete を含む）・セッション
DELETE FROM audit_logs WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_attdel!_%' ESCAPE '!') OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_attdel!_%' ESCAPE '!');
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_attdel!_%' ESCAPE '!');
-- 6. 参加者 → チャンネル → ルーム
DELETE FROM channel_members WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_attdel!_%' ESCAPE '!') OR channel_id IN ('01JTE2E2700000000000000C01');
DELETE FROM channels WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST] 削除添付');
DELETE FROM rooms WHERE id IN ('01JTE2E2700000000000000C01');
-- 7. ロール → 社員 → 部署
DELETE FROM user_role_assignments WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_attdel!_%' ESCAPE '!') OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST] 削除添付');
UPDATE users SET status_updated_by = NULL WHERE status_updated_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_attdel!_%' ESCAPE '!');
DELETE FROM users WHERE login_id LIKE 'e2euser!_attdel!_%' ESCAPE '!';
DELETE FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST] 削除添付';

-- 残りの件数（すべて 0 になることを確かめる。e2e/attachment-delete.spec.ts の beforeAll・afterAll が出力を照合する）
SELECT
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_attdel!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST] 削除添付') AS remaining_departments,
  (SELECT COUNT(*) FROM rooms WHERE id IN ('01JTE2E2700000000000000C01')) AS remaining_rooms,
  (SELECT COUNT(*) FROM messages WHERE room_id IN ('01JTE2E2700000000000000C01')) AS remaining_messages,
  (SELECT COUNT(*) FROM message_attachments WHERE room_id IN ('01JTE2E2700000000000000C01')) AS remaining_message_attachments,
  (SELECT COUNT(*) FROM search_documents WHERE room_id IN ('01JTE2E2700000000000000C01')) AS remaining_search_documents;
