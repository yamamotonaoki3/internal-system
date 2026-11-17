-- #147（147-A）E2E専用。社員ID e2euser_cases_、部署名 [E2E_TEST]部署147A、取引先名 テスト商事案件 [E2E_TEST]（コード QKG）の識別子だけを後始末する。
-- 外部キーの順：既読位置 → 通知 → 案件専用チャンネルのメッセージ（とそれを参照する行）→ 案件専用チャンネルの参加 → 案件の部署 → 案件 →
--   案件専用チャンネル → 部屋 → 監査 → セッション → 参加 → 社員 → 部署 → 取引先。
-- 案件専用チャンネル・部屋は、名前（案件番号。取引先コード QKG で始まる）と purpose = 'case' で絞る（QKG はこの E2E の取引先だけのコード）。
-- 部屋の ID は案件専用チャンネルの名前でしか辿れないため、外部キーの確認を最後に回して（ADR-0025 と同じ defer_foreign_keys）、部屋 → チャンネルの順で消す。
DELETE FROM read_positions
WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKG-*')
   OR user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_cases!_%' ESCAPE '!');
DELETE FROM notifications
WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKG-*')
   OR user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_cases!_%' ESCAPE '!');
DELETE FROM message_reactions
WHERE message_id IN (SELECT id FROM messages WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKG-*'));
DELETE FROM message_mentions
WHERE message_id IN (SELECT id FROM messages WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKG-*'));
DELETE FROM thread_read_positions
WHERE parent_message_id IN (SELECT id FROM messages WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKG-*'));
DELETE FROM message_attachments
WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKG-*')
   OR message_id IN (SELECT id FROM messages WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKG-*'));
DELETE FROM messages
WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKG-*');
DELETE FROM channel_members
WHERE channel_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKG-*');
DELETE FROM case_departments
WHERE case_id IN (
    SELECT id FROM cases
    WHERE client_id IN (SELECT id FROM clients WHERE name = 'テスト商事案件 [E2E_TEST]')
       OR number_client_id IN (SELECT id FROM clients WHERE name = 'テスト商事案件 [E2E_TEST]'))
   OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 16) = '[E2E_TEST]部署147A');
DELETE FROM cases
WHERE client_id IN (SELECT id FROM clients WHERE name = 'テスト商事案件 [E2E_TEST]')
   OR number_client_id IN (SELECT id FROM clients WHERE name = 'テスト商事案件 [E2E_TEST]');
PRAGMA defer_foreign_keys = on;
DELETE FROM rooms
WHERE id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKG-*');
DELETE FROM channels WHERE purpose = 'case' AND name GLOB 'QKG-*';
PRAGMA defer_foreign_keys = off;

DELETE FROM audit_logs
WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_cases!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_cases!_%' ESCAPE '!');
DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_cases!_%' ESCAPE '!');
DELETE FROM user_role_assignments
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_cases!_%' ESCAPE '!');
DELETE FROM channel_members
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_cases!_%' ESCAPE '!');
DELETE FROM users WHERE login_id LIKE 'e2euser!_cases!_%' ESCAPE '!';
DELETE FROM departments WHERE substr(name, 1, 16) = '[E2E_TEST]部署147A';
DELETE FROM clients WHERE name = 'テスト商事案件 [E2E_TEST]';

-- 残りの件数（すべて 0 になることを確かめる。e2e/cases.spec.ts の afterAll が出力を照合する）
SELECT
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_cases!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM departments WHERE substr(name, 1, 16) = '[E2E_TEST]部署147A') AS remaining_departments,
  (SELECT COUNT(*) FROM clients WHERE name = 'テスト商事案件 [E2E_TEST]') AS remaining_clients,
  (SELECT COUNT(*) FROM cases WHERE case_number GLOB 'QKG-*') AS remaining_cases,
  (SELECT COUNT(*) FROM channels WHERE purpose = 'case' AND name GLOB 'QKG-*') AS remaining_case_channels,
  (SELECT COUNT(*) FROM rooms WHERE id = '01JTE2E00000000000C0010147') AS remaining_rooms,
  (SELECT COUNT(*) FROM case_departments WHERE case_id NOT IN (SELECT id FROM cases)) AS remaining_orphan_case_departments;
