-- #342 E2E専用。社員ID e2euser_bfcache342_、部署名 [E2E_TEST]部署342、取引先名 テスト商事戻る [E2E_TEST]（コード QBF）、
-- 通常のチャンネル名 E2E_TEST_bfcache342_ の識別子だけを後始末する（e2e/seeds/case-access-loss-reload-cleanup.sql と同じ順・同じ絞り方）。
-- e2euser_ 全体や [E2E_TEST] 全体を条件にしない（ほかの spec のデータを消さない）。
-- 外部キーの順：既読位置 → 通知 → テストの部屋のメッセージを参照する行 → メッセージ → チャンネルの参加 → 案件の部署 → 監査 → TODO → 案件 →
--   案件専用チャンネル・通常のチャンネル → 部屋 → セッション → ロールの割り当て → 参加 → 社員 → 部署 → 取引先。
-- テストの部屋：案件専用チャンネル（purpose = 'case' かつ名前が QBF- で始まる）と、通常のチャンネル（名前が E2E_TEST_bfcache342_ で始まる）。
-- 部屋の ID はチャンネルの名前でしか辿れないため、外部キーの確認を最後に回して（ADR-0025 と同じ defer_foreign_keys）、部屋 → チャンネルの順で消す。
DELETE FROM read_positions
WHERE room_id IN (SELECT room_id FROM channels WHERE (purpose = 'case' AND name GLOB 'QBF-*') OR name GLOB 'E2E_TEST_bfcache342_*')
   OR user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_bfcache342!_%' ESCAPE '!');
DELETE FROM notifications
WHERE room_id IN (SELECT room_id FROM channels WHERE (purpose = 'case' AND name GLOB 'QBF-*') OR name GLOB 'E2E_TEST_bfcache342_*')
   OR user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_bfcache342!_%' ESCAPE '!');
DELETE FROM message_reactions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_bfcache342!_%' ESCAPE '!')
   OR message_id IN (SELECT id FROM messages WHERE room_id IN (SELECT room_id FROM channels WHERE (purpose = 'case' AND name GLOB 'QBF-*') OR name GLOB 'E2E_TEST_bfcache342_*'));
DELETE FROM message_mentions
WHERE message_id IN (SELECT id FROM messages WHERE room_id IN (SELECT room_id FROM channels WHERE (purpose = 'case' AND name GLOB 'QBF-*') OR name GLOB 'E2E_TEST_bfcache342_*'));
DELETE FROM thread_read_positions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_bfcache342!_%' ESCAPE '!')
   OR parent_message_id IN (SELECT id FROM messages WHERE room_id IN (SELECT room_id FROM channels WHERE (purpose = 'case' AND name GLOB 'QBF-*') OR name GLOB 'E2E_TEST_bfcache342_*'));
DELETE FROM message_attachments
WHERE room_id IN (SELECT room_id FROM channels WHERE (purpose = 'case' AND name GLOB 'QBF-*') OR name GLOB 'E2E_TEST_bfcache342_*')
   OR message_id IN (SELECT id FROM messages WHERE room_id IN (SELECT room_id FROM channels WHERE (purpose = 'case' AND name GLOB 'QBF-*') OR name GLOB 'E2E_TEST_bfcache342_*'));
-- 返信を先に、親を後に消す
DELETE FROM messages
WHERE parent_message_id IS NOT NULL
  AND room_id IN (SELECT room_id FROM channels WHERE (purpose = 'case' AND name GLOB 'QBF-*') OR name GLOB 'E2E_TEST_bfcache342_*');
DELETE FROM messages
WHERE room_id IN (SELECT room_id FROM channels WHERE (purpose = 'case' AND name GLOB 'QBF-*') OR name GLOB 'E2E_TEST_bfcache342_*');
DELETE FROM channel_members
WHERE channel_id IN (SELECT room_id FROM channels WHERE (purpose = 'case' AND name GLOB 'QBF-*') OR name GLOB 'E2E_TEST_bfcache342_*');
DELETE FROM case_departments
WHERE case_id IN (
    SELECT id FROM cases
    WHERE client_id IN (SELECT id FROM clients WHERE name = 'テスト商事戻る [E2E_TEST]')
       OR number_client_id IN (SELECT id FROM clients WHERE name = 'テスト商事戻る [E2E_TEST]'))
   OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署342');
DELETE FROM audit_logs
WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_bfcache342!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_bfcache342!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM cases WHERE case_number GLOB 'QBF-*');
DELETE FROM case_todo_events
WHERE case_id IN (
    SELECT id FROM cases
    WHERE client_id IN (SELECT id FROM clients WHERE name = 'テスト商事戻る [E2E_TEST]')
       OR number_client_id IN (SELECT id FROM clients WHERE name = 'テスト商事戻る [E2E_TEST]'));
DELETE FROM case_todos
WHERE case_id IN (
    SELECT id FROM cases
    WHERE client_id IN (SELECT id FROM clients WHERE name = 'テスト商事戻る [E2E_TEST]')
       OR number_client_id IN (SELECT id FROM clients WHERE name = 'テスト商事戻る [E2E_TEST]'));
DELETE FROM cases
WHERE client_id IN (SELECT id FROM clients WHERE name = 'テスト商事戻る [E2E_TEST]')
   OR number_client_id IN (SELECT id FROM clients WHERE name = 'テスト商事戻る [E2E_TEST]');
PRAGMA defer_foreign_keys = on;
DELETE FROM rooms
WHERE id IN (SELECT room_id FROM channels WHERE (purpose = 'case' AND name GLOB 'QBF-*') OR name GLOB 'E2E_TEST_bfcache342_*');
DELETE FROM channels WHERE (purpose = 'case' AND name GLOB 'QBF-*') OR name GLOB 'E2E_TEST_bfcache342_*';
PRAGMA defer_foreign_keys = off;

DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_bfcache342!_%' ESCAPE '!');
DELETE FROM user_role_assignments
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_bfcache342!_%' ESCAPE '!');
DELETE FROM channel_members
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_bfcache342!_%' ESCAPE '!');
DELETE FROM users WHERE login_id LIKE 'e2euser!_bfcache342!_%' ESCAPE '!';
DELETE FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署342';
DELETE FROM clients WHERE name = 'テスト商事戻る [E2E_TEST]';

-- 残りの件数（すべて 0 になることを確かめる。e2e/bfcache-access-loss.spec.ts の afterAll が出力を照合する）
SELECT
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_bfcache342!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM sessions WHERE user_id IN ('01JTE2E00000000000F0003342', '01JTE2E00000000000F0004342')) AS remaining_sessions,
  (SELECT COUNT(*) FROM user_role_assignments WHERE id IN ('01JTE2E00000000000F0005342', '01JTE2E00000000000F0006342')) AS remaining_role_assignments,
  (SELECT COUNT(*) FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署342') AS remaining_departments,
  (SELECT COUNT(*) FROM clients WHERE name = 'テスト商事戻る [E2E_TEST]') AS remaining_clients,
  (SELECT COUNT(*) FROM cases WHERE case_number GLOB 'QBF-*') AS remaining_cases,
  (SELECT COUNT(*) FROM channels WHERE (purpose = 'case' AND name GLOB 'QBF-*') OR name GLOB 'E2E_TEST_bfcache342_*') AS remaining_channels,
  (SELECT COUNT(*) FROM rooms WHERE id IN ('01JTE2E00000000000F0010342', '01JTE2E00000000000F0020342', '01JTE2E00000000000F0030342', '01JTE2E00000000000F0040342', '01JTE2E00000000000F0050342', '01JTE2E00000000000F0060342')) AS remaining_rooms,
  (SELECT COUNT(*) FROM messages WHERE room_id IN ('01JTE2E00000000000F0010342', '01JTE2E00000000000F0020342', '01JTE2E00000000000F0030342', '01JTE2E00000000000F0040342', '01JTE2E00000000000F0050342', '01JTE2E00000000000F0060342')) AS remaining_messages,
  (SELECT COUNT(*) FROM channel_members WHERE channel_id IN ('01JTE2E00000000000F0010342', '01JTE2E00000000000F0020342', '01JTE2E00000000000F0030342', '01JTE2E00000000000F0040342', '01JTE2E00000000000F0050342', '01JTE2E00000000000F0060342')) AS remaining_members,
  (SELECT COUNT(*) FROM audit_logs WHERE actor_id IN ('01JTE2E00000000000F0003342', '01JTE2E00000000000F0004342')) AS remaining_audit_logs,
  (SELECT COUNT(*) FROM case_departments WHERE case_id NOT IN (SELECT id FROM cases)) AS remaining_orphan_case_departments;
