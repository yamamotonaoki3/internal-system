-- #146（146-B）E2E専用（e2e/case-approvals.spec.ts）。架空の部署1件・その部署のオーナー・一般社員・取引先1件と、一般社員の審査中の申請2件
-- （承認する用・却下する用）を入れる。
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 識別子：社員ID e2euser_caseapp_、部署名 [E2E_TEST]部署146B、取引先名 テスト商事承認 [E2E_TEST]（コード QKF。既存の E2E のシードと重ならない）、
-- 件名・説明に [E2E_TEST] を付ける。case-approvals-cleanup.sql でこの識別子だけを消す。
-- 全体管理者は入れない（1人だけの制約があるため）。
-- 前提：#146 の migration（申請の表3つと、146-B の cases・case_departments・case_number_sequences）が適用済み。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES (
  '01JTE2E00000000000B0002146', '[E2E_TEST]部署146B', '[e2e_test]部署146b', 1,
  '2026-11-17T00:00:00.000Z', '', 1, '2026-11-17T00:00:00.000Z'
);

INSERT INTO clients (id, code, name, name_normalized, is_active, version, created_at, updated_at)
VALUES (
  '01JTE2E00000000000B0003146', 'QKF', 'テスト商事承認 [E2E_TEST]', 'テスト商事承認 [e2e_test]', 1, 1,
  '2026-11-17T00:00:00.000Z', '2026-11-17T00:00:00.000Z'
);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000B0005146', 'e2euser_caseapp_owner', 'e2euser_caseapp_owner',
  'E2E案件承認オーナー', 'テスト本名案件承認オーナー',
  'e2euser_caseapp_owner@example.com', 'e2euser_caseapp_owner@example.com',
  '01JTE2E00000000000B0002146', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000B0006146', 'e2euser_caseapp_member', 'e2euser_caseapp_member',
  'E2E案件承認メンバー', 'テスト本名案件承認メンバー',
  'e2euser_caseapp_member@example.com', 'e2euser_caseapp_member@example.com',
  '01JTE2E00000000000B0002146', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES
  ('01JTE2E00000000000B0007146', '01JTE2E00000000000B0005146', 'role_owner', 'department', '01JTE2E00000000000B0002146', '2026-11-17T00:00:00.000Z');

-- 一般社員の審査中の申請2件（承認する用・却下する用）
INSERT INTO case_creation_requests (
  id, client_id, title, description, due_date, requested_by, status, version,
  decided_by, decision_reason, case_id, resubmitted_from, requested_at, decided_at
) VALUES
  ('01JTE2E00000000000B0008146', '01JTE2E00000000000B0003146', '[E2E_TEST]承認する案件', '[E2E_TEST]承認の流れ', NULL,
   '01JTE2E00000000000B0006146', 'pending', 1, NULL, NULL, NULL, NULL, '2026-11-17T00:00:00.000Z', NULL),
  ('01JTE2E00000000000B0009146', '01JTE2E00000000000B0003146', '[E2E_TEST]却下する案件', '[E2E_TEST]却下の流れ', NULL,
   '01JTE2E00000000000B0006146', 'pending', 1, NULL, NULL, NULL, NULL, '2026-11-17T00:00:01.000Z', NULL);
INSERT INTO case_creation_request_departments (request_id, department_id) VALUES
  ('01JTE2E00000000000B0008146', '01JTE2E00000000000B0002146'),
  ('01JTE2E00000000000B0009146', '01JTE2E00000000000B0002146');
