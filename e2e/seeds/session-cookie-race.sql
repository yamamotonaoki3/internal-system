-- #383 E2E専用（e2e/session-cookie-race.spec.ts）。架空の部署1件・社員2人だけを入れる。
--   e2euser_cookierace_001：古いタブの利用者 A（画面からログインし、ホームを開いたままにする）
--   e2euser_cookierace_002：同じブラウザの別のタブでログインし直す利用者 B
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない（login.sql が先に流れている前提）。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 識別子：社員ID e2euser_cookierace_、部署名 [E2E_TEST]部署383。session-cookie-race-cleanup.sql でこの識別子だけを消す。
-- 全体管理者・部署のオーナーは入れない。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES (
  '01JTE2E00000000000C0001383', '[E2E_TEST]部署383', '[e2e_test]部署383', 1,
  '2026-11-28T00:00:00.000Z', '', 1, '2026-11-28T00:00:00.000Z'
);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000C0002383', 'e2euser_cookierace_001', 'e2euser_cookierace_001',
  'E2ECookie競合A', 'テスト本名Cookie競合A',
  'e2euser_cookierace_001@example.com', 'e2euser_cookierace_001@example.com',
  '01JTE2E00000000000C0001383', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000C0003383', 'e2euser_cookierace_002', 'e2euser_cookierace_002',
  'E2ECookie競合B', 'テスト本名Cookie競合B',
  'e2euser_cookierace_002@example.com', 'e2euser_cookierace_002@example.com',
  '01JTE2E00000000000C0001383', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

-- ホームの画面（サイドバーの一覧・未読の取得）は、一般のロールで足りる（e2e/seeds/session-user-mismatch.sql と同じ）
INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES
  ('01JTE2E00000000000C0004383', '01JTE2E00000000000C0002383', 'role_member', 'company', NULL, '2026-11-28T00:00:00.000Z'),
  ('01JTE2E00000000000C0005383', '01JTE2E00000000000C0003383', 'role_member', 'company', NULL, '2026-11-28T00:00:00.000Z');
