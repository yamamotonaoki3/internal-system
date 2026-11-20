-- #149（149-C）E2E専用。社員ID e2euser_case149c_、部署名 [E2E_TEST]部署149C、取引先名 テスト商事TODO履歴 [E2E_TEST]（コード QKX）の識別子だけを後始末する。
-- 外部キーの順：TODO の記録 → TODO → 既読位置 → 通知 → 案件専用チャンネルのメッセージ → 案件専用チャンネルの参加 → 案件の部署 → 監査 → 案件
--   → 案件専用チャンネル → 部屋 → セッション → ロールの割り当て → 参加 → 社員 → 部署 → 取引先。
-- 案件専用チャンネル・部屋は、名前（案件番号。取引先コード QKX で始まる）と purpose = 'case' で絞る（QKX はこの E2E の取引先だけのコード）。
-- 部屋の ID は案件専用チャンネルの名前でしか辿れないため、外部キーの確認を最後に回して（ADR-0025 と同じ defer_foreign_keys）、部屋 → チャンネルの順で消す。
-- TODO の操作は監査ログに残さない（決定 Q2）が、ログインなどの行を、この E2E の社員の行だけ消す。
DELETE FROM case_todo_events
WHERE case_id IN (SELECT id FROM cases WHERE case_number GLOB 'QKX-*');
DELETE FROM case_todos
WHERE case_id IN (SELECT id FROM cases WHERE case_number GLOB 'QKX-*');
DELETE FROM read_positions
WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKX-*')
   OR user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case149c!_%' ESCAPE '!');
DELETE FROM notifications
WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKX-*')
   OR user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case149c!_%' ESCAPE '!');
DELETE FROM messages
WHERE parent_message_id IS NOT NULL
  AND room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKX-*');
DELETE FROM messages
WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKX-*');
DELETE FROM channel_members
WHERE channel_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKX-*');
DELETE FROM case_departments
WHERE case_id IN (
    SELECT id FROM cases
    WHERE client_id IN (SELECT id FROM clients WHERE name = 'テスト商事TODO履歴 [E2E_TEST]')
       OR number_client_id IN (SELECT id FROM clients WHERE name = 'テスト商事TODO履歴 [E2E_TEST]'))
   OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 16) = '[E2E_TEST]部署149C');
DELETE FROM audit_logs
WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case149c!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case149c!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM cases WHERE case_number GLOB 'QKX-*');
DELETE FROM cases
WHERE client_id IN (SELECT id FROM clients WHERE name = 'テスト商事TODO履歴 [E2E_TEST]')
   OR number_client_id IN (SELECT id FROM clients WHERE name = 'テスト商事TODO履歴 [E2E_TEST]');
PRAGMA defer_foreign_keys = on;
DELETE FROM rooms
WHERE id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKX-*');
DELETE FROM channels WHERE purpose = 'case' AND name GLOB 'QKX-*';
PRAGMA defer_foreign_keys = off;

DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case149c!_%' ESCAPE '!');
DELETE FROM user_role_assignments
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case149c!_%' ESCAPE '!');
DELETE FROM channel_members
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case149c!_%' ESCAPE '!');
DELETE FROM users WHERE login_id LIKE 'e2euser!_case149c!_%' ESCAPE '!';
DELETE FROM departments WHERE substr(name, 1, 16) = '[E2E_TEST]部署149C';
DELETE FROM clients WHERE name = 'テスト商事TODO履歴 [E2E_TEST]';

-- 残りの件数（すべて 0 になることを確かめる。e2e/case-todos-history.spec.ts の finally が出力を照合する）
SELECT
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_case149c!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM departments WHERE substr(name, 1, 16) = '[E2E_TEST]部署149C') AS remaining_departments,
  (SELECT COUNT(*) FROM clients WHERE name = 'テスト商事TODO履歴 [E2E_TEST]') AS remaining_clients,
  (SELECT COUNT(*) FROM cases WHERE case_number GLOB 'QKX-*') AS remaining_cases,
  (SELECT COUNT(*) FROM channels WHERE purpose = 'case' AND name GLOB 'QKX-*') AS remaining_case_channels,
  (SELECT COUNT(*) FROM rooms WHERE id = '01JTE2E00000000000Z0010149') AS remaining_rooms,
  (SELECT COUNT(*) FROM case_todos WHERE case_id = '01JTE2E00000000000Z0011149') AS remaining_todos,
  (SELECT COUNT(*) FROM case_todo_events WHERE case_id = '01JTE2E00000000000Z0011149') AS remaining_todo_events,
  (SELECT COUNT(*) FROM channel_members WHERE channel_id = '01JTE2E00000000000Z0010149') AS remaining_case_members;
