-- #149（149-A）E2E専用。社員ID e2euser_case149_、部署名 [E2E_TEST]部署149A、取引先名 テスト商事TODO [E2E_TEST]（コード QKT）の識別子だけを後始末する。
-- 外部キーの順：TODO の記録 → TODO → 既読位置 → 通知 → 案件専用チャンネルのメッセージ → 案件専用チャンネルの参加 → 案件の部署 → 監査 → 案件
--   → 案件専用チャンネル → 部屋 → セッション → ロールの割り当て → 参加 → 社員 → 部署 → 取引先。
-- 案件専用チャンネル・部屋は、名前（案件番号。取引先コード QKT で始まる）と purpose = 'case' で絞る（QKT はこの E2E の取引先だけのコード）。
-- 部屋の ID は案件専用チャンネルの名前でしか辿れないため、外部キーの確認を最後に回して（ADR-0025 と同じ defer_foreign_keys）、部屋 → チャンネルの順で消す。
-- 監査はこの E2E では業務の行を書かない（TODO は監査ログに残さない。決定 Q2）が、ログインなどの行を、この E2E の社員の行だけ消す。
DELETE FROM case_todo_events
WHERE case_id IN (SELECT id FROM cases WHERE case_number GLOB 'QKT-*');
DELETE FROM case_todos
WHERE case_id IN (SELECT id FROM cases WHERE case_number GLOB 'QKT-*');
DELETE FROM read_positions
WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKT-*')
   OR user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case149!_%' ESCAPE '!');
DELETE FROM notifications
WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKT-*')
   OR user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case149!_%' ESCAPE '!');
DELETE FROM messages
WHERE parent_message_id IS NOT NULL
  AND room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKT-*');
DELETE FROM messages
WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKT-*');
DELETE FROM channel_members
WHERE channel_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKT-*');
DELETE FROM case_departments
WHERE case_id IN (
    SELECT id FROM cases
    WHERE client_id IN (SELECT id FROM clients WHERE name = 'テスト商事TODO [E2E_TEST]')
       OR number_client_id IN (SELECT id FROM clients WHERE name = 'テスト商事TODO [E2E_TEST]'))
   OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 16) = '[E2E_TEST]部署149A');
DELETE FROM audit_logs
WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case149!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case149!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM cases WHERE case_number GLOB 'QKT-*');
DELETE FROM cases
WHERE client_id IN (SELECT id FROM clients WHERE name = 'テスト商事TODO [E2E_TEST]')
   OR number_client_id IN (SELECT id FROM clients WHERE name = 'テスト商事TODO [E2E_TEST]');
PRAGMA defer_foreign_keys = on;
DELETE FROM rooms
WHERE id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKT-*');
DELETE FROM channels WHERE purpose = 'case' AND name GLOB 'QKT-*';
PRAGMA defer_foreign_keys = off;

DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case149!_%' ESCAPE '!');
DELETE FROM user_role_assignments
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case149!_%' ESCAPE '!');
DELETE FROM channel_members
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case149!_%' ESCAPE '!');
DELETE FROM users WHERE login_id LIKE 'e2euser!_case149!_%' ESCAPE '!';
DELETE FROM departments WHERE substr(name, 1, 16) = '[E2E_TEST]部署149A';
DELETE FROM clients WHERE name = 'テスト商事TODO [E2E_TEST]';

-- 残りの件数（すべて 0 になることを確かめる。e2e/case-todos.spec.ts の afterAll が出力を照合する）
SELECT
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_case149!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM departments WHERE substr(name, 1, 16) = '[E2E_TEST]部署149A') AS remaining_departments,
  (SELECT COUNT(*) FROM clients WHERE name = 'テスト商事TODO [E2E_TEST]') AS remaining_clients,
  (SELECT COUNT(*) FROM cases WHERE case_number GLOB 'QKT-*') AS remaining_cases,
  (SELECT COUNT(*) FROM channels WHERE purpose = 'case' AND name GLOB 'QKT-*') AS remaining_case_channels,
  (SELECT COUNT(*) FROM rooms WHERE id = '01JTE2E00000000000V0010149') AS remaining_rooms,
  (SELECT COUNT(*) FROM case_todos WHERE case_id = '01JTE2E00000000000V0011149') AS remaining_todos,
  (SELECT COUNT(*) FROM case_todo_events WHERE case_id = '01JTE2E00000000000V0011149') AS remaining_todo_events,
  (SELECT COUNT(*) FROM channel_members WHERE channel_id = '01JTE2E00000000000V0010149') AS remaining_case_members;
