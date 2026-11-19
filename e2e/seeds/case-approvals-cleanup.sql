-- #146（146-B）E2E専用。社員ID e2euser_caseapp_、部署名 [E2E_TEST]部署146B、取引先名 テスト商事承認 [E2E_TEST] の識別子だけを後始末する。
-- 外部キーの順（計画 B-9）：既読位置 → 通知 → 案件専用チャンネルの参加 → 案件の部署 → 案件 → 案件専用チャンネル → 部屋 →
--   申請の候補 → 申請の部署 → 申請 → 監査 → セッション → ロールの割り当て → 参加 → 社員 → 部署 → 連番 → 取引先。
-- 案件は「取引先が テスト商事承認 [E2E_TEST]」で絞る。案件専用チャンネル・部屋は、案件を消した後でも辿れるように、
-- 名前（案件番号。取引先コード QKF で始まる）と purpose = 'case' で絞る（QKF はこの E2E の取引先だけのコード）。
-- 計画 B-9 の「部屋 → チャンネル」は、下の defer_foreign_keys の範囲で行う。
DELETE FROM read_positions
WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKF-*')
   OR user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_caseapp!_%' ESCAPE '!');
DELETE FROM notifications
WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKF-*')
   OR user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_caseapp!_%' ESCAPE '!');
-- 案件専用チャンネルのメッセージと、それを参照する行（リアクション・メンション・スレッドの既読位置・添付）。投稿者・付けた人が E2E の利用者でなくても消す
DELETE FROM message_reactions
WHERE message_id IN (SELECT id FROM messages WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKF-*'));
DELETE FROM message_mentions
WHERE message_id IN (SELECT id FROM messages WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKF-*'));
DELETE FROM thread_read_positions
WHERE parent_message_id IN (SELECT id FROM messages WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKF-*'));
DELETE FROM message_attachments
WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKF-*')
   OR message_id IN (SELECT id FROM messages WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKF-*'));
DELETE FROM messages
WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKF-*');
DELETE FROM channel_members
WHERE channel_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKF-*');
DELETE FROM case_departments
WHERE case_id IN (
    SELECT id FROM cases
    WHERE client_id IN (SELECT id FROM clients WHERE name = 'テスト商事承認 [E2E_TEST]')
       OR number_client_id IN (SELECT id FROM clients WHERE name = 'テスト商事承認 [E2E_TEST]'))
   OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 16) = '[E2E_TEST]部署146B');
-- #149（149-A）：案件の TODO の記録 → TODO を、案件より先に消す（外部キーの順。ほかの spec・手での操作で TODO が作られた場合に備える）
DELETE FROM case_todo_events
WHERE case_id IN (
    SELECT id FROM cases
    WHERE client_id IN (SELECT id FROM clients WHERE name = 'テスト商事承認 [E2E_TEST]')
       OR number_client_id IN (SELECT id FROM clients WHERE name = 'テスト商事承認 [E2E_TEST]'));
DELETE FROM case_todos
WHERE case_id IN (
    SELECT id FROM cases
    WHERE client_id IN (SELECT id FROM clients WHERE name = 'テスト商事承認 [E2E_TEST]')
       OR number_client_id IN (SELECT id FROM clients WHERE name = 'テスト商事承認 [E2E_TEST]'));
DELETE FROM cases
WHERE client_id IN (SELECT id FROM clients WHERE name = 'テスト商事承認 [E2E_TEST]')
   OR number_client_id IN (SELECT id FROM clients WHERE name = 'テスト商事承認 [E2E_TEST]');
-- 部屋の ID は案件専用チャンネルの名前でしか辿れないため、外部キーの確認を最後に回して（ADR-0025 と同じ defer_foreign_keys）、
-- 部屋 → チャンネルの順で消す（1つのファイルの実行の終わりには、外部キーが満たされている）
PRAGMA defer_foreign_keys = on;
DELETE FROM rooms
WHERE id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKF-*');
DELETE FROM channels WHERE purpose = 'case' AND name GLOB 'QKF-*';
PRAGMA defer_foreign_keys = off;

DELETE FROM case_creation_request_candidates
WHERE request_id IN (
    SELECT id FROM case_creation_requests
    WHERE requested_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_caseapp!_%' ESCAPE '!')
       OR client_id IN (SELECT id FROM clients WHERE name = 'テスト商事承認 [E2E_TEST]'))
   OR user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_caseapp!_%' ESCAPE '!')
   OR added_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_caseapp!_%' ESCAPE '!');
DELETE FROM case_creation_request_departments
WHERE request_id IN (
    SELECT id FROM case_creation_requests
    WHERE requested_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_caseapp!_%' ESCAPE '!')
       OR client_id IN (SELECT id FROM clients WHERE name = 'テスト商事承認 [E2E_TEST]'))
   OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 16) = '[E2E_TEST]部署146B');
UPDATE case_creation_requests SET resubmitted_from = NULL
WHERE requested_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_caseapp!_%' ESCAPE '!')
   OR client_id IN (SELECT id FROM clients WHERE name = 'テスト商事承認 [E2E_TEST]');
DELETE FROM case_creation_requests
WHERE requested_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_caseapp!_%' ESCAPE '!')
   OR client_id IN (SELECT id FROM clients WHERE name = 'テスト商事承認 [E2E_TEST]');
DELETE FROM audit_logs
WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_caseapp!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_caseapp!_%' ESCAPE '!')
   OR target_id IN ('01JTE2E00000000000B0008146', '01JTE2E00000000000B0009146');
DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_caseapp!_%' ESCAPE '!');
DELETE FROM user_role_assignments
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_caseapp!_%' ESCAPE '!')
   OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 16) = '[E2E_TEST]部署146B');
DELETE FROM channel_members
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_caseapp!_%' ESCAPE '!');
DELETE FROM users WHERE login_id LIKE 'e2euser!_caseapp!_%' ESCAPE '!';
DELETE FROM departments WHERE substr(name, 1, 16) = '[E2E_TEST]部署146B';
DELETE FROM case_number_sequences
WHERE client_id IN (SELECT id FROM clients WHERE name = 'テスト商事承認 [E2E_TEST]');
DELETE FROM clients WHERE name = 'テスト商事承認 [E2E_TEST]';

-- 残りの件数（すべて 0 になることを確かめる。e2e/case-approvals.spec.ts の afterAll が出力を照合する）
SELECT
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_caseapp!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM departments WHERE substr(name, 1, 16) = '[E2E_TEST]部署146B') AS remaining_departments,
  (SELECT COUNT(*) FROM clients WHERE name = 'テスト商事承認 [E2E_TEST]') AS remaining_clients,
  (SELECT COUNT(*) FROM case_creation_requests
     WHERE id IN ('01JTE2E00000000000B0008146', '01JTE2E00000000000B0009146')) AS remaining_requests,
  (SELECT COUNT(*) FROM cases WHERE case_number GLOB 'QKF-*') AS remaining_cases,
  (SELECT COUNT(*) FROM channels WHERE purpose = 'case' AND name GLOB 'QKF-*') AS remaining_case_channels,
  (SELECT COUNT(*) FROM case_departments WHERE case_id NOT IN (SELECT id FROM cases)) AS remaining_orphan_case_departments,
  (SELECT COUNT(*) FROM case_number_sequences WHERE client_id NOT IN (SELECT id FROM clients)) AS remaining_orphan_sequences;
