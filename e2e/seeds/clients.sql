-- #192 E2E専用。既存の架空ログインfixtureのテスト用ハッシュをDB内で参照し、値を表示しない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 会社設定・初期ロール定義は変えない。clients-cleanup.sqlでこのIDだけを後始末する。
INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E0000000000000000192', 'e2euser_client_admin',
  'e2euser_client_admin', 'testuser_client_admin', 'テスト本名取引先管理者',
  'e2euser_client_admin@example.com', 'e2euser_client_admin@example.com',
  password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO user_role_assignments (
  id, user_id, role_id, scope_type, department_id, assigned_at
) VALUES (
  '01JTE2E0000000000000001192', '01JTE2E0000000000000000192',
  'role_global_admin', 'company', NULL, '2026-11-07T00:00:00.000Z'
);
