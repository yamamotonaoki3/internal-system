-- #135 E2E専用（e2e/channel-invite.spec.ts）。架空の部署1件（自動専用チャンネル2つ付き）・部署のオーナー・招待する社員A・招待される社員Bを入れる。
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 部署名は [E2E_TEST]部署135 で始め、社員IDは e2euser_chinv_ で始める。非公開チャンネルは spec の中で申請→承認の API で作り、
-- 名前は E2E_TEST_invite_ で始め、説明に [E2E_TEST] を付ける（チャンネル名には [ ] を使えないため。2-2 AC-13）。
-- channel-invite-cleanup.sql でこの識別子だけを消す。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES (
  '01JTE2E0000000000000002135', '[E2E_TEST]部署135招待', '[e2e_test]部署135招待', 1,
  '2026-11-16T00:00:00.000Z', '', 1, '2026-11-16T00:00:00.000Z'
);

INSERT INTO rooms (id, kind, created_at) VALUES
  ('01JTE2E0000000000000003135', 'channel', '2026-11-16T00:00:00.000Z'),
  ('01JTE2E0000000000000004135', 'channel', '2026-11-16T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES
  ('01JTE2E0000000000000003135', '01JTE2E0000000000000002135', '[E2E_TEST]部署135招待',
   '[e2e_test]部署135招待', '', 'public', 'department', NULL, 1,
   '2026-11-16T00:00:00.000Z', '2026-11-16T00:00:00.000Z', NULL, NULL),
  ('01JTE2E0000000000000004135', '01JTE2E0000000000000002135', '[E2E_TEST]部署135招待のお知らせ',
   '[e2e_test]部署135招待のお知らせ', '', 'public', 'announcement', NULL, 1,
   '2026-11-16T00:00:00.000Z', '2026-11-16T00:00:00.000Z', NULL, NULL);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E0000000000000005135', 'e2euser_chinv_owner', 'e2euser_chinv_owner',
  'E2E招待オーナー', 'テスト本名招待オーナー',
  'e2euser_chinv_owner@example.com', 'e2euser_chinv_owner@example.com',
  '01JTE2E0000000000000002135', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E0000000000000006135', 'e2euser_chinv_a', 'e2euser_chinv_a',
  'E2E招待A', 'テスト本名招待A',
  'e2euser_chinv_a@example.com', 'e2euser_chinv_a@example.com',
  '01JTE2E0000000000000002135', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E0000000000000008135', 'e2euser_chinv_b', 'e2euser_chinv_b',
  'E2E招待B', 'テスト本名招待B',
  'e2euser_chinv_b@example.com', 'e2euser_chinv_b@example.com',
  '01JTE2E0000000000000002135', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES
  ('01JTE2E0000000000000007135', '01JTE2E0000000000000005135', 'role_owner', 'department', '01JTE2E0000000000000002135', '2026-11-16T00:00:00.000Z');

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E0000000000000003135', '01JTE2E0000000000000005135', '2026-11-16T00:00:00.000Z'),
  ('01JTE2E0000000000000004135', '01JTE2E0000000000000005135', '2026-11-16T00:00:00.000Z'),
  ('01JTE2E0000000000000003135', '01JTE2E0000000000000006135', '2026-11-16T00:00:00.000Z'),
  ('01JTE2E0000000000000004135', '01JTE2E0000000000000006135', '2026-11-16T00:00:00.000Z'),
  ('01JTE2E0000000000000003135', '01JTE2E0000000000000008135', '2026-11-16T00:00:00.000Z'),
  ('01JTE2E0000000000000004135', '01JTE2E0000000000000008135', '2026-11-16T00:00:00.000Z');
