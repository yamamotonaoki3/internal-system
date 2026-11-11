-- #199 E2E専用の架空データ。部署1件・全体管理者1人・一般社員1人を作る。後始末は accounts-cleanup.sql。
-- パスワードは既存の架空ログインfixture（e2euser_login_001）のテスト用ハッシュをDB内で参照し、値を書かない。本名は架空の平文で入れる（test 環境の seed-file が e2euser_ の平文の本名を各利用者のIDで暗号化する）。
INSERT INTO departments (id, name, name_normalized, is_active, created_at)
VALUES ('01JTE2E1990000000000000D01', '[E2E_TEST]アカウント発行部', '[e2e_test]アカウント発行部', 1, '2026-11-09T00:00:00.000Z');

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, password_hash, must_change_password, is_active, department_id
)
SELECT
  '01JTE2E1990000000000000A01', 'e2euser_account_admin', 'e2euser_account_admin',
  'testuser_account_admin', 'テスト本名アカウント管理者',
  'e2euser_account_admin@example.com', 'e2euser_account_admin@example.com',
  password_hash, 0, 1, '01JTE2E1990000000000000D01'
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, password_hash, must_change_password, is_active, department_id
)
SELECT
  '01JTE2E1990000000000000A02', 'e2euser_account_member', 'e2euser_account_member',
  'testuser_account_member', 'テスト本名アカウント社員',
  'e2euser_account_member@example.com', 'e2euser_account_member@example.com',
  password_hash, 0, 1, '01JTE2E1990000000000000D01'
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at)
VALUES
  ('01JTE2E1990000000000000R01', '01JTE2E1990000000000000A01', 'role_global_admin', 'company', NULL, '2026-11-09T00:00:00.000Z'),
  ('01JTE2E1990000000000000R02', '01JTE2E1990000000000000A02', 'role_member', 'company', NULL, '2026-11-09T00:00:00.000Z');
