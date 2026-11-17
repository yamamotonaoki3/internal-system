-- #146（146-A）E2E専用（e2e/case-requests.spec.ts）。架空の部署1件・その部署のオーナー・一般社員・取引先1件と、類似件名の比較用の審査中の申請1件を入れる。
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 識別子：社員ID e2euser_casereq_、部署名 [E2E_TEST]部署146、取引先名 テスト商事 [E2E_TEST]（コード QKE。既存の E2E のシードと重ならない）、
-- 件名・説明に [E2E_TEST] を付ける。case-requests-cleanup.sql でこの識別子だけを消す。
-- 一意の制約：users.login_id_normalized・email_normalized、departments.name_normalized、clients.code・name_normalized。全体管理者は入れない（1人だけの制約があるため）。
-- 前提：#146 の migration（case_creation_requests・case_creation_request_departments・case_creation_request_candidates）が適用済み。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES (
  '01JTE2E0000000000000002146', '[E2E_TEST]部署146', '[e2e_test]部署146', 1,
  '2026-11-17T00:00:00.000Z', '', 1, '2026-11-17T00:00:00.000Z'
);

INSERT INTO clients (id, code, name, name_normalized, is_active, version, created_at, updated_at)
VALUES (
  '01JTE2E0000000000000003146', 'QKE', 'テスト商事 [E2E_TEST]', 'テスト商事 [e2e_test]', 1, 1,
  '2026-11-17T00:00:00.000Z', '2026-11-17T00:00:00.000Z'
);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E0000000000000005146', 'e2euser_casereq_owner', 'e2euser_casereq_owner',
  'E2E案件オーナー', 'テスト本名案件オーナー',
  'e2euser_casereq_owner@example.com', 'e2euser_casereq_owner@example.com',
  '01JTE2E0000000000000002146', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E0000000000000006146', 'e2euser_casereq_member', 'e2euser_casereq_member',
  'E2E案件メンバー', 'テスト本名案件メンバー',
  'e2euser_casereq_member@example.com', 'e2euser_casereq_member@example.com',
  '01JTE2E0000000000000002146', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES
  ('01JTE2E0000000000000007146', '01JTE2E0000000000000005146', 'role_owner', 'department', '01JTE2E0000000000000002146', '2026-11-17T00:00:00.000Z');

-- 類似件名の比較用：オーナーの審査中の申請（件名は整形済みの値）
INSERT INTO case_creation_requests (
  id, client_id, title, description, due_date, requested_by, status, version,
  decided_by, decision_reason, case_id, resubmitted_from, requested_at, decided_at
) VALUES (
  '01JTE2E0000000000000008146', '01JTE2E0000000000000003146', '[E2E_TEST]保守契約', '[E2E_TEST]比較用の申請', NULL,
  '01JTE2E0000000000000005146', 'pending', 1, NULL, NULL, NULL, NULL, '2026-11-17T00:00:00.000Z', NULL
);
INSERT INTO case_creation_request_departments (request_id, department_id) VALUES
  ('01JTE2E0000000000000008146', '01JTE2E0000000000000002146');
