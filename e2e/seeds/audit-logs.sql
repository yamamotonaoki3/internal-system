-- #156 E2E専用の架空データ。部署1件・全体管理者1人・一般メンバー1人・監査ログの対象の操作者1人・対象の社員1人と、監査ログ29件を作る。後始末は audit-logs-cleanup.sql。
-- パスワードは既存の架空ログインfixture（e2euser_login_001）のテスト用ハッシュをDB内で参照し、値を書かない。本名は架空の平文で入れる（test 環境の seed-file が暗号化する）。
-- 全体管理者は DB 全体で1人（部分一意索引）のため、ほかの spec の後始末が済んでいる前提で、このファイルの管理者だけを全体管理者にする。
-- 監査ログ（trace_id は '[E2E_TEST]audit-' で始まる）：操作者 e2euser_audit_actor が、2031-03-04 01:00:01〜01:00:29（JST 10:00 台。新しい順に最初に並ぶ）に行った操作
--   1〜25：アカウント無効化（成功）、26〜28：アカウント登録（成功）、29：アカウント登録の失敗（対象なし。エラー分類 validation_error・件数 7）。
INSERT INTO departments (id, name, name_normalized, is_active, created_at)
VALUES ('01JTE2E156A00000000000D001', '[E2E_TEST]156監査部署', '[e2e_test]156監査部署', 1, '2026-11-17T00:00:00.000Z');

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, password_hash, must_change_password, is_active, department_id
)
SELECT
  '01JTE2E156A00000000000A001', 'e2euser_audit_admin', 'e2euser_audit_admin',
  'testuser_audit_admin', 'テスト本名監査管理者',
  'e2euser_audit_admin@example.com', 'e2euser_audit_admin@example.com',
  password_hash, 0, 1, '01JTE2E156A00000000000D001'
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, password_hash, must_change_password, is_active, department_id
)
SELECT
  '01JTE2E156A00000000000A002', 'e2euser_audit_member', 'e2euser_audit_member',
  'testuser_audit_member', 'テスト本名監査メンバー',
  'e2euser_audit_member@example.com', 'e2euser_audit_member@example.com',
  password_hash, 0, 1, '01JTE2E156A00000000000D001'
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, password_hash, must_change_password, is_active, department_id
)
SELECT
  '01JTE2E156A00000000000A003', 'e2euser_audit_actor', 'e2euser_audit_actor',
  'testuser_audit_actor', 'テスト本名監査操作者',
  'e2euser_audit_actor@example.com', 'e2euser_audit_actor@example.com',
  password_hash, 0, 1, '01JTE2E156A00000000000D001'
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, password_hash, must_change_password, is_active, department_id
)
SELECT
  '01JTE2E156A00000000000A004', 'e2euser_audit_target', 'e2euser_audit_target',
  'testuser_audit_target', 'テスト本名監査対象',
  'e2euser_audit_target@example.com', 'e2euser_audit_target@example.com',
  password_hash, 0, 1, '01JTE2E156A00000000000D001'
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at)
VALUES ('01JTE2E156A00000000000R001', '01JTE2E156A00000000000A001', 'role_global_admin', 'company', NULL, '2026-11-17T00:00:00.000Z');

WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 29)
INSERT INTO audit_logs (id, occurred_at, actor_id, action, target_type, target_id, result, trace_id, detail)
SELECT
  printf('01JTE2E156A0000000000%05d', n),
  strftime('%Y-%m-%dT%H:%M:%fZ', '2031-03-04 01:00:00', '+' || n || ' seconds'),
  '01JTE2E156A00000000000A003',
  CASE WHEN n <= 25 THEN 'account.deactivate' ELSE 'account.create' END,
  'user',
  CASE WHEN n = 29 THEN NULL ELSE '01JTE2E156A00000000000A004' END,
  CASE WHEN n = 29 THEN 'failure' ELSE 'success' END,
  '[E2E_TEST]audit-' || printf('%02d', n),
  CASE WHEN n = 29 THEN '{"failureCategory":"validation_error","affectedCount":7}' ELSE NULL END
FROM seq;
