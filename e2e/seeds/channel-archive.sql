-- #143-a E2E専用（e2e/channel-archive.spec.ts）。架空の部署1件（自動専用チャンネル2つ付き）・部署のオーナー・参加者1人と、
-- 2人が参加する公開の通常のチャンネル1件（名前 E2E_TEST_charch_1、説明に [E2E_TEST]）を入れる。
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 部署名は [E2E_TEST]部署143 で始め、社員IDは e2euser_charch_ で始める。チャンネル名には [ ] を使えないため（2-2 AC-13）、
-- 名前は E2E_TEST_charch_ で始め、行は固定のルームID（01JTE2E0000000000000008143）で消す。
-- channel-archive-cleanup.sql でこの識別子だけを消す。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES (
  '01JTE2E0000000000000002143', '[E2E_TEST]部署143アーカイブ', '[e2e_test]部署143アーカイブ', 1,
  '2026-11-17T00:00:00.000Z', '', 1, '2026-11-17T00:00:00.000Z'
);

INSERT INTO rooms (id, kind, created_at) VALUES
  ('01JTE2E0000000000000003143', 'channel', '2026-11-17T00:00:00.000Z'),
  ('01JTE2E0000000000000004143', 'channel', '2026-11-17T00:00:00.000Z'),
  ('01JTE2E0000000000000008143', 'channel', '2026-11-17T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES
  ('01JTE2E0000000000000003143', '01JTE2E0000000000000002143', '[E2E_TEST]部署143アーカイブ',
   '[e2e_test]部署143アーカイブ', '', 'public', 'department', NULL, 1,
   '2026-11-17T00:00:00.000Z', '2026-11-17T00:00:00.000Z', NULL, NULL),
  ('01JTE2E0000000000000004143', '01JTE2E0000000000000002143', '[E2E_TEST]部署143アーカイブのお知らせ',
   '[e2e_test]部署143アーカイブのお知らせ', '', 'public', 'announcement', NULL, 1,
   '2026-11-17T00:00:00.000Z', '2026-11-17T00:00:00.000Z', NULL, NULL),
  ('01JTE2E0000000000000008143', '01JTE2E0000000000000002143', 'E2E_TEST_charch_1',
   'e2e_test_charch_1', '[E2E_TEST]アーカイブの流れ', 'public', 'normal', NULL, 1,
   '2026-11-17T00:00:00.000Z', '2026-11-17T00:00:00.000Z', NULL, NULL);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E0000000000000005143', 'e2euser_charch_owner', 'e2euser_charch_owner',
  'E2Eアーカイブオーナー', 'テスト本名アーカイブオーナー',
  'e2euser_charch_owner@example.com', 'e2euser_charch_owner@example.com',
  '01JTE2E0000000000000002143', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E0000000000000006143', 'e2euser_charch_member', 'e2euser_charch_member',
  'E2Eアーカイブ参加者', 'テスト本名アーカイブ参加者',
  'e2euser_charch_member@example.com', 'e2euser_charch_member@example.com',
  '01JTE2E0000000000000002143', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES
  ('01JTE2E0000000000000007143', '01JTE2E0000000000000005143', 'role_owner', 'department', '01JTE2E0000000000000002143', '2026-11-17T00:00:00.000Z');

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E0000000000000003143', '01JTE2E0000000000000005143', '2026-11-17T00:00:00.000Z'),
  ('01JTE2E0000000000000004143', '01JTE2E0000000000000005143', '2026-11-17T00:00:00.000Z'),
  ('01JTE2E0000000000000008143', '01JTE2E0000000000000005143', '2026-11-17T00:00:00.000Z'),
  ('01JTE2E0000000000000003143', '01JTE2E0000000000000006143', '2026-11-17T00:00:00.000Z'),
  ('01JTE2E0000000000000004143', '01JTE2E0000000000000006143', '2026-11-17T00:00:00.000Z'),
  ('01JTE2E0000000000000008143', '01JTE2E0000000000000006143', '2026-11-17T00:00:00.000Z');
