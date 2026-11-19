-- #149（149-A）E2E専用（e2e/case-todos.spec.ts）。架空の部署1件・社員3人・取引先1件と、進行中の案件1件を入れる（TODO は入れない。画面から足す）。
--   e2euser_case149_member：案件の参加者（TODO を追加する人。担当者に partner を選ぶ）
--   e2euser_case149_partner：案件の参加者（別のブラウザで、追加された TODO がポーリングで出ることを確かめ、完了にする人）
--   e2euser_case149_outsider：案件に参加していない社員（S-17 に TODO が出ないことを確かめる人）
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 識別子：社員ID e2euser_case149_、部署名 [E2E_TEST]部署149A、取引先名 テスト商事TODO [E2E_TEST]（コード QKT。既存の E2E のシードと重ならない）、
-- 件名・説明・TODO の題名に [E2E_TEST] を付ける。案件番号・案件専用チャンネルの名前は QKT で始める。case-todos-cleanup.sql でこの識別子だけを消す。
-- 役割（オーナー・全体管理者）は付けない（ほかの E2E の利用者の役割を変えない。この E2E の利用者は、ほかの spec と共有しない）。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES (
  '01JTE2E00000000000V0002149', '[E2E_TEST]部署149A', '[e2e_test]部署149a', 1,
  '2026-11-18T00:00:00.000Z', '', 1, '2026-11-18T00:00:00.000Z'
);

INSERT INTO clients (id, code, name, name_normalized, is_active, version, created_at, updated_at)
VALUES (
  '01JTE2E00000000000V0003149', 'QKT', 'テスト商事TODO [E2E_TEST]', 'テスト商事todo [e2e_test]', 1, 1,
  '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z'
);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000V0005149', 'e2euser_case149_member', 'e2euser_case149_member',
  'E2E案件TODOの参加者', 'テスト本名案件TODO参加者',
  'e2euser_case149_member@example.com', 'e2euser_case149_member@example.com',
  '01JTE2E00000000000V0002149', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000V0006149', 'e2euser_case149_partner', 'e2euser_case149_partner',
  'E2E案件TODOの相手', 'テスト本名案件TODO相手',
  'e2euser_case149_partner@example.com', 'e2euser_case149_partner@example.com',
  '01JTE2E00000000000V0002149', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000V0007149', 'e2euser_case149_outsider', 'e2euser_case149_outsider',
  'E2E案件TODOの非参加者', 'テスト本名案件TODO非参加者',
  'e2euser_case149_outsider@example.com', 'e2euser_case149_outsider@example.com',
  '01JTE2E00000000000V0002149', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

-- 進行中の案件（QKT-261118-0001）
INSERT INTO rooms (id, kind, created_at)
VALUES ('01JTE2E00000000000V0010149', 'channel', '2026-11-18T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES (
  '01JTE2E00000000000V0010149', NULL, 'QKT-261118-0001', 'case:qkt-261118-0001', '', 'private', 'case',
  '01JTE2E00000000000V0005149', 1, '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z', NULL, NULL
);

INSERT INTO cases (
  id, case_number, number_client_id, client_id, channel_id, request_id, title, description, due_date,
  status, created_by, approved_by, version, created_at, updated_at
) VALUES (
  '01JTE2E00000000000V0011149', 'QKT-261118-0001', '01JTE2E00000000000V0003149', '01JTE2E00000000000V0003149',
  '01JTE2E00000000000V0010149', '01JTE2E00000000000V0012149', '[E2E_TEST]TODOの進行中の案件', '[E2E_TEST]TODOの案件の説明',
  NULL, 'active', '01JTE2E00000000000V0005149', '01JTE2E00000000000V0005149', 1,
  '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z'
);

INSERT INTO case_departments (case_id, department_id)
VALUES ('01JTE2E00000000000V0011149', '01JTE2E00000000000V0002149');

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E00000000000V0010149', '01JTE2E00000000000V0005149', '2026-11-18T00:00:00.000Z'),
  ('01JTE2E00000000000V0010149', '01JTE2E00000000000V0006149', '2026-11-18T00:00:01.000Z');
