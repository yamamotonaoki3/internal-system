-- #131 E2E専用（e2e/channel-requests.spec.ts）。架空の部署1件（自動専用チャンネル2つ付き）・全体管理者・部署のオーナー・一般社員を入れる。
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 部署名は [E2E_TEST]部署131 で始め、社員IDは e2euser_chreq_ で始める。画面から申請するチャンネル名は E2E_TEST_chreq_ で始め、
-- 説明に [E2E_TEST] を付ける（チャンネル名には [ ] を使えないため。2-2 AC-13）。channel-requests-cleanup.sql でこの識別子だけを消す。
-- 全体管理者は 1 人で確定している（2-1 AC-10）ため、このシナリオの全体管理者は e2euser_chreq_admin の 1 人だけ。
-- 前提：#131 の migration（channel_creation_requests）が適用済み。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES (
  '01JTE2E0000000000000002131', '[E2E_TEST]部署131営業', '[e2e_test]部署131営業', 1,
  '2026-11-12T00:00:00.000Z', '', 1, '2026-11-12T00:00:00.000Z'
);

INSERT INTO rooms (id, kind, created_at) VALUES
  ('01JTE2E0000000000000003131', 'channel', '2026-11-12T00:00:00.000Z'),
  ('01JTE2E0000000000000004131', 'channel', '2026-11-12T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES
  ('01JTE2E0000000000000003131', '01JTE2E0000000000000002131', '[E2E_TEST]部署131営業',
   '[e2e_test]部署131営業', '', 'public', 'department', NULL, 1,
   '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z', NULL, NULL),
  ('01JTE2E0000000000000004131', '01JTE2E0000000000000002131', '[E2E_TEST]部署131営業のお知らせ',
   '[e2e_test]部署131営業のお知らせ', '', 'public', 'announcement', NULL, 1,
   '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z', NULL, NULL);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E0000000000000000131', 'e2euser_chreq_admin', 'e2euser_chreq_admin',
  'E2E申請管理者', 'テスト本名申請管理者',
  'e2euser_chreq_admin@example.com', 'e2euser_chreq_admin@example.com',
  NULL, password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E0000000000000005131', 'e2euser_chreq_owner', 'e2euser_chreq_owner',
  'E2E申請オーナー', 'テスト本名申請オーナー',
  'e2euser_chreq_owner@example.com', 'e2euser_chreq_owner@example.com',
  '01JTE2E0000000000000002131', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E0000000000000006131', 'e2euser_chreq_member', 'e2euser_chreq_member',
  'E2E申請メンバー', 'テスト本名申請メンバー',
  'e2euser_chreq_member@example.com', 'e2euser_chreq_member@example.com',
  '01JTE2E0000000000000002131', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES
  ('01JTE2E0000000000000001131', '01JTE2E0000000000000000131', 'role_global_admin', 'company', NULL, '2026-11-12T00:00:00.000Z'),
  ('01JTE2E0000000000000007131', '01JTE2E0000000000000005131', 'role_owner', 'department', '01JTE2E0000000000000002131', '2026-11-12T00:00:00.000Z');

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E0000000000000003131', '01JTE2E0000000000000005131', '2026-11-12T00:00:00.000Z'),
  ('01JTE2E0000000000000004131', '01JTE2E0000000000000005131', '2026-11-12T00:00:00.000Z'),
  ('01JTE2E0000000000000003131', '01JTE2E0000000000000006131', '2026-11-12T00:00:00.000Z'),
  ('01JTE2E0000000000000004131', '01JTE2E0000000000000006131', '2026-11-12T00:00:00.000Z');
