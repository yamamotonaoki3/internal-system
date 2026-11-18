-- #148（148-A）E2E専用（e2e/cases-conversation.spec.ts）。架空の部署1件・社員3人・取引先1件と、案件2件（進行中・終了）を入れる。
--   e2euser_case148_member：両方の案件の参加者（投稿・返信・添付・リアクションをする人）
--   e2euser_case148_partner：両方の案件の参加者（別のブラウザで、member の投稿がポーリングで出ることを確かめる人）
--   e2euser_case148_outsider：どちらの案件にも参加していない社員（「参加者だけが見られます（非公開）」）
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 識別子：社員ID e2euser_case148_、部署名 [E2E_TEST]部署148A、取引先名 テスト商事やり取り [E2E_TEST]（コード QKJ。既存の E2E のシードと重ならない）、
-- 件名・説明・本文に [E2E_TEST] を付ける。案件番号・案件専用チャンネルの名前は QKJ で始める。cases-conversation-cleanup.sql でこの識別子だけを消す。
-- 役割（オーナー・全体管理者）は付けない（ほかの E2E の利用者の役割を変えない。この E2E の利用者は、ほかの spec と共有しない）。
-- 終了の案件は、シードで status = 'closed' にする（終了の API は #150 のため、まだない）。終了の案件には、閲覧の確認用のメッセージを1件入れる。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES (
  '01JTE2E00000000000V0002148', '[E2E_TEST]部署148A', '[e2e_test]部署148a', 1,
  '2026-11-18T00:00:00.000Z', '', 1, '2026-11-18T00:00:00.000Z'
);

INSERT INTO clients (id, code, name, name_normalized, is_active, version, created_at, updated_at)
VALUES (
  '01JTE2E00000000000V0003148', 'QKJ', 'テスト商事やり取り [E2E_TEST]', 'テスト商事やり取り [e2e_test]', 1, 1,
  '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z'
);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000V0005148', 'e2euser_case148_member', 'e2euser_case148_member',
  'E2E案件やり取りの参加者', 'テスト本名案件やり取り参加者',
  'e2euser_case148_member@example.com', 'e2euser_case148_member@example.com',
  '01JTE2E00000000000V0002148', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000V0006148', 'e2euser_case148_partner', 'e2euser_case148_partner',
  'E2E案件やり取りの相手', 'テスト本名案件やり取り相手',
  'e2euser_case148_partner@example.com', 'e2euser_case148_partner@example.com',
  '01JTE2E00000000000V0002148', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000V0007148', 'e2euser_case148_outsider', 'e2euser_case148_outsider',
  'E2E案件やり取りの非参加者', 'テスト本名案件やり取り非参加者',
  'e2euser_case148_outsider@example.com', 'e2euser_case148_outsider@example.com',
  '01JTE2E00000000000V0002148', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

-- 進行中の案件（QKJ-261118-0001）
INSERT INTO rooms (id, kind, created_at)
VALUES ('01JTE2E00000000000V0010148', 'channel', '2026-11-18T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES (
  '01JTE2E00000000000V0010148', NULL, 'QKJ-261118-0001', 'case:qkj-261118-0001', '', 'private', 'case',
  '01JTE2E00000000000V0005148', 1, '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z', NULL, NULL
);

INSERT INTO cases (
  id, case_number, number_client_id, client_id, channel_id, request_id, title, description, due_date,
  status, created_by, approved_by, version, created_at, updated_at
) VALUES (
  '01JTE2E00000000000V0011148', 'QKJ-261118-0001', '01JTE2E00000000000V0003148', '01JTE2E00000000000V0003148',
  '01JTE2E00000000000V0010148', '01JTE2E00000000000V0012148', '[E2E_TEST]やり取りの進行中の案件', '[E2E_TEST]進行中の案件の説明',
  NULL, 'active', '01JTE2E00000000000V0005148', '01JTE2E00000000000V0005148', 1,
  '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z'
);

INSERT INTO case_departments (case_id, department_id)
VALUES ('01JTE2E00000000000V0011148', '01JTE2E00000000000V0002148');

-- 終了の案件（QKJ-261118-0002）
INSERT INTO rooms (id, kind, created_at)
VALUES ('01JTE2E00000000000V0020148', 'channel', '2026-11-18T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES (
  '01JTE2E00000000000V0020148', NULL, 'QKJ-261118-0002', 'case:qkj-261118-0002', '', 'private', 'case',
  '01JTE2E00000000000V0005148', 1, '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z', NULL, NULL
);

INSERT INTO cases (
  id, case_number, number_client_id, client_id, channel_id, request_id, title, description, due_date,
  status, created_by, approved_by, version, created_at, updated_at
) VALUES (
  '01JTE2E00000000000V0021148', 'QKJ-261118-0002', '01JTE2E00000000000V0003148', '01JTE2E00000000000V0003148',
  '01JTE2E00000000000V0020148', '01JTE2E00000000000V0022148', '[E2E_TEST]やり取りの終了した案件', '[E2E_TEST]終了した案件の説明',
  NULL, 'closed', '01JTE2E00000000000V0005148', '01JTE2E00000000000V0005148', 1,
  '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z'
);

INSERT INTO case_departments (case_id, department_id)
VALUES ('01JTE2E00000000000V0021148', '01JTE2E00000000000V0002148');

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E00000000000V0010148', '01JTE2E00000000000V0005148', '2026-11-18T00:00:00.000Z'),
  ('01JTE2E00000000000V0010148', '01JTE2E00000000000V0006148', '2026-11-18T00:00:01.000Z'),
  ('01JTE2E00000000000V0020148', '01JTE2E00000000000V0005148', '2026-11-18T00:00:00.000Z'),
  ('01JTE2E00000000000V0020148', '01JTE2E00000000000V0006148', '2026-11-18T00:00:01.000Z');

INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at)
VALUES (
  '01JTE2E00000000000V0030148', '01JTE2E00000000000V0020148', '01JTE2E00000000000V0006148',
  'E2E案件やり取りの相手', '[E2E_TEST]終了した案件の過去のやり取り', '2026-11-18T00:00:02.000Z'
);
