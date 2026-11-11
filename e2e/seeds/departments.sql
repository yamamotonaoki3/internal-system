-- #196 E2E専用（e2e/departments.spec.ts）。架空の全体管理者・既存部署・そのオーナーと一般社員を入れる。
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 部署名は [E2E_TEST]部署196 で始め、社員IDは e2euser_dept_ で始める。departments-cleanup.sql でこの識別子だけを消す。
-- 前提：#196 の migration（departments の description・version・updated_at、rooms・channels・channel_members）が適用済み。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES (
  '01JTE2E0000000000000002196', '[E2E_TEST]部署196営業', '[e2e_test]部署196営業', 1,
  '2026-11-09T00:00:00.000Z', '', 1, '2026-11-09T00:00:00.000Z'
);

INSERT INTO rooms (id, kind, created_at) VALUES
  ('01JTE2E0000000000000003196', 'channel', '2026-11-09T00:00:00.000Z'),
  ('01JTE2E0000000000000004196', 'channel', '2026-11-09T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES
  ('01JTE2E0000000000000003196', '01JTE2E0000000000000002196', '[E2E_TEST]部署196営業',
   '[e2e_test]部署196営業', '', 'public', 'department', NULL, 1,
   '2026-11-09T00:00:00.000Z', '2026-11-09T00:00:00.000Z', NULL, NULL),
  ('01JTE2E0000000000000004196', '01JTE2E0000000000000002196', '[E2E_TEST]部署196営業のお知らせ',
   '[e2e_test]部署196営業のお知らせ', '', 'public', 'announcement', NULL, 1,
   '2026-11-09T00:00:00.000Z', '2026-11-09T00:00:00.000Z', NULL, NULL);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E0000000000000000196', 'e2euser_dept_admin', 'e2euser_dept_admin',
  'E2E部署管理者', 'テスト本名部署管理者',
  'e2euser_dept_admin@example.com', 'e2euser_dept_admin@example.com',
  NULL, password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E0000000000000005196', 'e2euser_dept_owner', 'e2euser_dept_owner',
  'E2E部署オーナー', 'テスト本名部署オーナー',
  'e2euser_dept_owner@example.com', 'e2euser_dept_owner@example.com',
  '01JTE2E0000000000000002196', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E0000000000000006196', 'e2euser_dept_member', 'e2euser_dept_member',
  'E2E部署メンバー', 'テスト本名部署メンバー',
  'e2euser_dept_member@example.com', 'e2euser_dept_member@example.com',
  '01JTE2E0000000000000002196', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES
  ('01JTE2E0000000000000001196', '01JTE2E0000000000000000196', 'role_global_admin', 'company', NULL, '2026-11-09T00:00:00.000Z'),
  ('01JTE2E0000000000000007196', '01JTE2E0000000000000005196', 'role_owner', 'department', '01JTE2E0000000000000002196', '2026-11-09T00:00:00.000Z');

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E0000000000000003196', '01JTE2E0000000000000005196', '2026-11-09T00:00:00.000Z'),
  ('01JTE2E0000000000000004196', '01JTE2E0000000000000005196', '2026-11-09T00:00:00.000Z'),
  ('01JTE2E0000000000000003196', '01JTE2E0000000000000006196', '2026-11-09T00:00:00.000Z'),
  ('01JTE2E0000000000000004196', '01JTE2E0000000000000006196', '2026-11-09T00:00:00.000Z');
