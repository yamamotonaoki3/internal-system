-- #128（128-c）E2E専用の架空データ。部署1件・全体管理者1人・部署のオーナー1人・退職処理の対象の一般社員1人を作る。後始末は retirement-requests-cleanup.sql。
-- パスワードは既存の架空ログインfixture（e2euser_login_001）のテスト用ハッシュをDB内で参照し、値を書かない。本名は架空の平文で入れる（test 環境の seed-file が e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 全体管理者は DB 全体で1人（部分一意索引）のため、ほかの spec の後始末が済んでいる前提で、このファイルの管理者だけを全体管理者にする。
INSERT INTO departments (id, name, name_normalized, is_active, created_at)
VALUES ('01JTE2E128C00000000000D001', '[E2E_TEST]128c退職申請部署', '[e2e_test]128c退職申請部署', 1, '2026-11-17T00:00:00.000Z');

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, password_hash, must_change_password, is_active, department_id
)
SELECT
  '01JTE2E128C00000000000A001', 'e2euser_retire_admin', 'e2euser_retire_admin',
  'testuser_retire_admin', 'テスト本名退職申請管理者',
  'e2euser_retire_admin@example.com', 'e2euser_retire_admin@example.com',
  password_hash, 0, 1, '01JTE2E128C00000000000D001'
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, password_hash, must_change_password, is_active, department_id
)
SELECT
  '01JTE2E128C00000000000A002', 'e2euser_retire_owner', 'e2euser_retire_owner',
  'testuser_retire_owner', 'テスト本名退職申請オーナー',
  'e2euser_retire_owner@example.com', 'e2euser_retire_owner@example.com',
  password_hash, 0, 1, '01JTE2E128C00000000000D001'
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, password_hash, must_change_password, is_active, department_id
)
SELECT
  '01JTE2E128C00000000000A003', 'e2euser_retire_target', 'e2euser_retire_target',
  'testuser_retire_target', 'テスト本名退職申請対象',
  'e2euser_retire_target@example.com', 'e2euser_retire_target@example.com',
  password_hash, 0, 1, '01JTE2E128C00000000000D001'
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at)
VALUES
  ('01JTE2E128C00000000000R001', '01JTE2E128C00000000000A001', 'role_global_admin', 'company', NULL, '2026-11-17T00:00:00.000Z'),
  ('01JTE2E128C00000000000R002', '01JTE2E128C00000000000A002', 'role_owner', 'department', '01JTE2E128C00000000000D001', '2026-11-17T00:00:00.000Z');
