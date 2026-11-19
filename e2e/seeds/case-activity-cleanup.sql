-- #148（148-C）E2E専用（e2e/case-activity.spec.ts）。社員ID e2euser_case148c_、部署名 [E2E_TEST]部署148C、取引先名 テスト商事148C活動 [E2E_TEST]（コード QKP）の識別子だけを後始末する。
-- 外部キーの順と考え方は e2e/seeds/cases-conversation-cleanup.sql と同じ（既読位置 → 通知 → メッセージを参照する行 → 添付 → メッセージ → 参加 → 案件の部署 → 監査
--   → TODO → 案件 → 案件専用チャンネル・部屋 → セッション → ロール → 参加 → 社員 → 部署 → 取引先）。
-- この E2E は添付を使わない（添付の行は、手での操作で作られた場合に備えて消す。R2 の実体は作らない）。
DELETE FROM read_positions
WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKP-*')
   OR user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case148c!_%' ESCAPE '!');
DELETE FROM notifications
WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKP-*')
   OR user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case148c!_%' ESCAPE '!');
DELETE FROM message_reactions
WHERE message_id IN (SELECT id FROM messages WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKP-*'))
   OR user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case148c!_%' ESCAPE '!');
DELETE FROM message_mentions
WHERE message_id IN (SELECT id FROM messages WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKP-*'));
DELETE FROM thread_read_positions
WHERE parent_message_id IN (SELECT id FROM messages WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKP-*'))
   OR user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case148c!_%' ESCAPE '!');
DELETE FROM message_attachments
WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKP-*')
   OR message_id IN (SELECT id FROM messages WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKP-*'))
   OR uploader_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case148c!_%' ESCAPE '!');
-- 返信（親を参照する行）を先に消し、その後に親を消す
DELETE FROM messages
WHERE parent_message_id IS NOT NULL
  AND room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKP-*');
DELETE FROM messages
WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKP-*');
DELETE FROM channel_members
WHERE channel_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKP-*');
DELETE FROM case_departments
WHERE case_id IN (
    SELECT id FROM cases
    WHERE client_id IN (SELECT id FROM clients WHERE name = 'テスト商事148C活動 [E2E_TEST]')
       OR number_client_id IN (SELECT id FROM clients WHERE name = 'テスト商事148C活動 [E2E_TEST]'))
   OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 16) = '[E2E_TEST]部署148C');
DELETE FROM audit_logs
WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case148c!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case148c!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM cases WHERE case_number GLOB 'QKP-*');
-- #149（149-A）：案件の TODO の記録 → TODO を、案件より先に消す（外部キーの順。ほかの spec・手での操作で TODO が作られた場合に備える）
DELETE FROM case_todo_events
WHERE case_id IN (
    SELECT id FROM cases
    WHERE client_id IN (SELECT id FROM clients WHERE name = 'テスト商事148C活動 [E2E_TEST]')
       OR number_client_id IN (SELECT id FROM clients WHERE name = 'テスト商事148C活動 [E2E_TEST]'));
DELETE FROM case_todos
WHERE case_id IN (
    SELECT id FROM cases
    WHERE client_id IN (SELECT id FROM clients WHERE name = 'テスト商事148C活動 [E2E_TEST]')
       OR number_client_id IN (SELECT id FROM clients WHERE name = 'テスト商事148C活動 [E2E_TEST]'));
DELETE FROM cases
WHERE client_id IN (SELECT id FROM clients WHERE name = 'テスト商事148C活動 [E2E_TEST]')
   OR number_client_id IN (SELECT id FROM clients WHERE name = 'テスト商事148C活動 [E2E_TEST]');
PRAGMA defer_foreign_keys = on;
DELETE FROM rooms
WHERE id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKP-*');
DELETE FROM channels WHERE purpose = 'case' AND name GLOB 'QKP-*';
PRAGMA defer_foreign_keys = off;

DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case148c!_%' ESCAPE '!');
DELETE FROM user_role_assignments
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case148c!_%' ESCAPE '!');
DELETE FROM channel_members
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case148c!_%' ESCAPE '!');
DELETE FROM users WHERE login_id LIKE 'e2euser!_case148c!_%' ESCAPE '!';
DELETE FROM departments WHERE substr(name, 1, 16) = '[E2E_TEST]部署148C';
DELETE FROM clients WHERE name = 'テスト商事148C活動 [E2E_TEST]';

-- 残りの件数（すべて 0 になることを確かめる。e2e/case-activity.spec.ts の afterAll が出力を照合する）
SELECT
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_case148c!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM departments WHERE substr(name, 1, 16) = '[E2E_TEST]部署148C') AS remaining_departments,
  (SELECT COUNT(*) FROM clients WHERE name = 'テスト商事148C活動 [E2E_TEST]') AS remaining_clients,
  (SELECT COUNT(*) FROM cases WHERE case_number GLOB 'QKP-*') AS remaining_cases,
  (SELECT COUNT(*) FROM channels WHERE purpose = 'case' AND name GLOB 'QKP-*') AS remaining_case_channels,
  (SELECT COUNT(*) FROM rooms WHERE id IN ('01JTE2E00000000000W0010148')) AS remaining_rooms,
  (SELECT COUNT(*) FROM messages WHERE room_id IN ('01JTE2E00000000000W0010148')) AS remaining_messages,
  (SELECT COUNT(*) FROM message_attachments WHERE room_id IN ('01JTE2E00000000000W0010148')) AS remaining_attachments,
  (SELECT COUNT(*) FROM channel_members WHERE channel_id IN ('01JTE2E00000000000W0010148')) AS remaining_case_members,
  (SELECT COUNT(*) FROM case_departments WHERE case_id NOT IN (SELECT id FROM cases)) AS remaining_orphan_case_departments;
