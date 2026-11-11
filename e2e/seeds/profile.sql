-- #130 E2E専用（e2e/profile.spec.ts）。架空の部署1件（自動専用チャンネル2つ付き）・全体管理者1人・一般社員1人を入れる。
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- カードで本名を確かめる社員は、本名を正しく暗号化するため、spec の中でアカウント発行の API から作る（e2euser_profile_card）。
-- 部署名は [E2E_TEST]部署130 で始め、社員IDは e2euser_profile_ で始める。profile-cleanup.sql でこの識別子だけを消す。
-- 前提：#130 の migration 0013（users のステータスの列）が適用済み。ステータスの列は既定値（在席）にする。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES (
  '01JTE2E0000000000000002130', '[E2E_TEST]部署130営業', '[e2e_test]部署130営業', 1,
  '2026-11-11T00:00:00.000Z', '', 1, '2026-11-11T00:00:00.000Z'
);

INSERT INTO rooms (id, kind, created_at) VALUES
  ('01JTE2E0000000000000003130', 'channel', '2026-11-11T00:00:00.000Z'),
  ('01JTE2E0000000000000004130', 'channel', '2026-11-11T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES
  ('01JTE2E0000000000000003130', '01JTE2E0000000000000002130', '[E2E_TEST]部署130営業',
   '[e2e_test]部署130営業', '', 'public', 'department', NULL, 1,
   '2026-11-11T00:00:00.000Z', '2026-11-11T00:00:00.000Z', NULL, NULL),
  ('01JTE2E0000000000000004130', '01JTE2E0000000000000002130', '[E2E_TEST]部署130営業のお知らせ',
   '[e2e_test]部署130営業のお知らせ', '', 'public', 'announcement', NULL, 1,
   '2026-11-11T00:00:00.000Z', '2026-11-11T00:00:00.000Z', NULL, NULL);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, extension, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E0000000000000000130', 'e2euser_profile_admin', 'e2euser_profile_admin',
  'E2Eプロフィール管理者', 'テスト本名プロフ001',
  'e2euser_profile_admin@example.com', 'e2euser_profile_admin@example.com',
  '01JTE2E0000000000000002130', '1300', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, extension, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E0000000000000005130', 'e2euser_profile_member', 'e2euser_profile_member',
  'E2Eプロフィール社員', 'テスト本名プロフ002',
  'e2euser_profile_member@example.com', 'e2euser_profile_member@example.com',
  '01JTE2E0000000000000002130', '1301', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES
  ('01JTE2E0000000000000001130', '01JTE2E0000000000000000130', 'role_global_admin', 'company', NULL, '2026-11-11T00:00:00.000Z');

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E0000000000000003130', '01JTE2E0000000000000000130', '2026-11-11T00:00:00.000Z'),
  ('01JTE2E0000000000000004130', '01JTE2E0000000000000000130', '2026-11-11T00:00:00.000Z'),
  ('01JTE2E0000000000000003130', '01JTE2E0000000000000005130', '2026-11-11T00:00:00.000Z'),
  ('01JTE2E0000000000000004130', '01JTE2E0000000000000005130', '2026-11-11T00:00:00.000Z');
