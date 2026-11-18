-- #150（150-A）E2E専用。社員ID e2euser_case150_、部署名 [E2E_TEST]部署150A、取引先名 テスト商事終了 [E2E_TEST]（コード QKC）の識別子だけを後始末する。
-- 外部キーの順（cases-conversation-cleanup.sql に合わせる）：既読位置 → 通知 → 案件専用チャンネルのメッセージを参照する行 → メッセージ →
--   案件専用チャンネルの参加 → 案件の部署 → 監査（終了・再開の case.close・case.reopen を含む）→ 案件 → 案件専用チャンネル → 部屋 →
--   セッション → ロールの割り当て → 参加 → 社員 → 部署 → 取引先。
-- 通知（case.closed・case.reopened）は room_id を持たないため、宛先（この E2E の社員）と target_id（この E2E の案件）で消す。
-- 案件専用チャンネル・部屋は、名前（案件番号。取引先コード QKC で始まる）と purpose = 'case' で絞る（QKC はこの E2E の取引先だけのコード）。
DELETE FROM read_positions
WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKC-*')
   OR user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case150!_%' ESCAPE '!');
DELETE FROM notifications
WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKC-*')
   OR target_id IN (SELECT id FROM cases WHERE case_number GLOB 'QKC-*')
   OR user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case150!_%' ESCAPE '!');
DELETE FROM message_reactions
WHERE message_id IN (SELECT id FROM messages WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKC-*'))
   OR user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case150!_%' ESCAPE '!');
DELETE FROM message_mentions
WHERE message_id IN (SELECT id FROM messages WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKC-*'));
DELETE FROM thread_read_positions
WHERE parent_message_id IN (SELECT id FROM messages WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKC-*'))
   OR user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case150!_%' ESCAPE '!');
DELETE FROM message_attachments
WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKC-*')
   OR uploader_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case150!_%' ESCAPE '!');
-- 返信（親を参照する行）を先に消し、その後に親を消す
DELETE FROM messages
WHERE parent_message_id IS NOT NULL
  AND room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKC-*');
DELETE FROM messages
WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKC-*');
DELETE FROM channel_members
WHERE channel_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKC-*');
DELETE FROM case_departments
WHERE case_id IN (
    SELECT id FROM cases
    WHERE client_id IN (SELECT id FROM clients WHERE name = 'テスト商事終了 [E2E_TEST]')
       OR number_client_id IN (SELECT id FROM clients WHERE name = 'テスト商事終了 [E2E_TEST]'))
   OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 16) = '[E2E_TEST]部署150A');
DELETE FROM audit_logs
WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case150!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case150!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM cases WHERE case_number GLOB 'QKC-*');
DELETE FROM cases
WHERE client_id IN (SELECT id FROM clients WHERE name = 'テスト商事終了 [E2E_TEST]')
   OR number_client_id IN (SELECT id FROM clients WHERE name = 'テスト商事終了 [E2E_TEST]');
PRAGMA defer_foreign_keys = on;
DELETE FROM rooms
WHERE id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKC-*');
DELETE FROM channels WHERE purpose = 'case' AND name GLOB 'QKC-*';
PRAGMA defer_foreign_keys = off;

DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case150!_%' ESCAPE '!');
DELETE FROM user_role_assignments
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case150!_%' ESCAPE '!');
DELETE FROM channel_members
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case150!_%' ESCAPE '!');
DELETE FROM users WHERE login_id LIKE 'e2euser!_case150!_%' ESCAPE '!';
DELETE FROM departments WHERE substr(name, 1, 16) = '[E2E_TEST]部署150A';
DELETE FROM clients WHERE name = 'テスト商事終了 [E2E_TEST]';

-- 残りの件数（すべて 0 になることを確かめる。e2e/case-close.spec.ts の afterAll が出力を照合する）
SELECT
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_case150!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM departments WHERE substr(name, 1, 16) = '[E2E_TEST]部署150A') AS remaining_departments,
  (SELECT COUNT(*) FROM clients WHERE name = 'テスト商事終了 [E2E_TEST]') AS remaining_clients,
  (SELECT COUNT(*) FROM cases WHERE case_number GLOB 'QKC-*') AS remaining_cases,
  (SELECT COUNT(*) FROM channels WHERE purpose = 'case' AND name GLOB 'QKC-*') AS remaining_case_channels,
  (SELECT COUNT(*) FROM rooms WHERE id = '01JTE2E00000000000V0010150') AS remaining_rooms,
  (SELECT COUNT(*) FROM messages WHERE room_id = '01JTE2E00000000000V0010150') AS remaining_messages,
  (SELECT COUNT(*) FROM channel_members WHERE channel_id = '01JTE2E00000000000V0010150') AS remaining_case_members,
  (SELECT COUNT(*) FROM notifications WHERE target_id = '01JTE2E00000000000V0011150') AS remaining_notifications,
  (SELECT COUNT(*) FROM audit_logs WHERE target_id = '01JTE2E00000000000V0011150') AS remaining_audits,
  (SELECT COUNT(*) FROM case_departments WHERE case_id NOT IN (SELECT id FROM cases)) AS remaining_orphan_case_departments;
