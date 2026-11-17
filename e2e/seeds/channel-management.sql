-- #143-b E2E専用（e2e/channel-management.spec.ts）。架空の部署2件（自動専用チャンネル2つずつ付き）と、
-- 部署 A のオーナー・部署 A の一般の社員・部署 B のオーナー、通常のチャンネル3件を入れる：
--   E2E_TEST_chmgmt_private：部署 A の非公開。オーナーは参加していない（参加者は一般の社員だけ）。S-39 に出ることを確かめる
--   E2E_TEST_chmgmt_public ：部署 A の公開。名前の絞り込みで外れることを確かめる
--   E2E_TEST_chmgmt_other  ：部署 B の非公開。部署 A のオーナーの S-39 に出ないことを確かめる
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 部署名は [E2E_TEST]chmgmt で始め、社員IDは e2euser_chmgmt_ で始める。チャンネル名には [ ] を使えないため（2-2 AC-13）、
-- 名前は E2E_TEST_chmgmt_ で始める。ID はすべて 01JTE2E143B で始まる固定値（ULID の形）。
-- channel-management-cleanup.sql でこの識別子だけを消す。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES
  ('01JTE2E143B000000000000D01', '[E2E_TEST]chmgmt部署A', '[e2e_test]chmgmt部署a', 1,
   '2026-11-18T00:00:00.000Z', '', 1, '2026-11-18T00:00:00.000Z'),
  ('01JTE2E143B000000000000D02', '[E2E_TEST]chmgmt部署B', '[e2e_test]chmgmt部署b', 1,
   '2026-11-18T00:00:00.000Z', '', 1, '2026-11-18T00:00:00.000Z');

INSERT INTO rooms (id, kind, created_at) VALUES
  ('01JTE2E143B000000000000R01', 'channel', '2026-11-18T00:00:00.000Z'),
  ('01JTE2E143B000000000000R02', 'channel', '2026-11-18T00:00:00.000Z'),
  ('01JTE2E143B000000000000R03', 'channel', '2026-11-18T00:00:00.000Z'),
  ('01JTE2E143B000000000000R04', 'channel', '2026-11-18T00:00:00.000Z'),
  ('01JTE2E143B000000000000C01', 'channel', '2026-11-18T00:00:00.000Z'),
  ('01JTE2E143B000000000000C02', 'channel', '2026-11-18T00:00:00.000Z'),
  ('01JTE2E143B000000000000C03', 'channel', '2026-11-18T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES
  ('01JTE2E143B000000000000R01', '01JTE2E143B000000000000D01', '[E2E_TEST]chmgmt部署A',
   '[e2e_test]chmgmt部署a', '', 'public', 'department', NULL, 1,
   '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z', NULL, NULL),
  ('01JTE2E143B000000000000R02', '01JTE2E143B000000000000D01', '[E2E_TEST]chmgmt部署Aのお知らせ',
   '[e2e_test]chmgmt部署aのお知らせ', '', 'public', 'announcement', NULL, 1,
   '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z', NULL, NULL),
  ('01JTE2E143B000000000000R03', '01JTE2E143B000000000000D02', '[E2E_TEST]chmgmt部署B',
   '[e2e_test]chmgmt部署b', '', 'public', 'department', NULL, 1,
   '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z', NULL, NULL),
  ('01JTE2E143B000000000000R04', '01JTE2E143B000000000000D02', '[E2E_TEST]chmgmt部署Bのお知らせ',
   '[e2e_test]chmgmt部署bのお知らせ', '', 'public', 'announcement', NULL, 1,
   '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z', NULL, NULL),
  ('01JTE2E143B000000000000C01', '01JTE2E143B000000000000D01', 'E2E_TEST_chmgmt_private',
   'e2e_test_chmgmt_private', '[E2E_TEST]参加していない非公開', 'private', 'normal', NULL, 1,
   '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z', NULL, NULL),
  ('01JTE2E143B000000000000C02', '01JTE2E143B000000000000D01', 'E2E_TEST_chmgmt_public',
   'e2e_test_chmgmt_public', '[E2E_TEST]公開', 'public', 'normal', NULL, 1,
   '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z', NULL, NULL),
  ('01JTE2E143B000000000000C03', '01JTE2E143B000000000000D02', 'E2E_TEST_chmgmt_other',
   'e2e_test_chmgmt_other', '[E2E_TEST]他部署の非公開', 'private', 'normal', NULL, 1,
   '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z', NULL, NULL);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E143B000000000000A01', 'e2euser_chmgmt_owner', 'e2euser_chmgmt_owner',
  'E2Eチャンネル管理オーナー', 'テスト本名チャンネル管理オーナー',
  'e2euser_chmgmt_owner@example.com', 'e2euser_chmgmt_owner@example.com',
  '01JTE2E143B000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E143B000000000000A02', 'e2euser_chmgmt_member', 'e2euser_chmgmt_member',
  'E2Eチャンネル管理一般', 'テスト本名チャンネル管理一般',
  'e2euser_chmgmt_member@example.com', 'e2euser_chmgmt_member@example.com',
  '01JTE2E143B000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E143B000000000000A03', 'e2euser_chmgmt_bowner', 'e2euser_chmgmt_bowner',
  'E2Eチャンネル管理Bオーナー', 'テスト本名チャンネル管理Bオーナー',
  'e2euser_chmgmt_bowner@example.com', 'e2euser_chmgmt_bowner@example.com',
  '01JTE2E143B000000000000D02', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

-- 部署ごとにオーナーは1人（部署とオーナーの不変条件）
INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES
  ('01JTE2E143B000000000000S01', '01JTE2E143B000000000000A01', 'role_owner', 'department', '01JTE2E143B000000000000D01', '2026-11-18T00:00:00.000Z'),
  ('01JTE2E143B000000000000S02', '01JTE2E143B000000000000A03', 'role_owner', 'department', '01JTE2E143B000000000000D02', '2026-11-18T00:00:00.000Z');

-- オーナー A は自部署の専用・お知らせ・公開にだけ参加し、非公開（C01）には参加しない
INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E143B000000000000R01', '01JTE2E143B000000000000A01', '2026-11-18T00:00:00.000Z'),
  ('01JTE2E143B000000000000R02', '01JTE2E143B000000000000A01', '2026-11-18T00:00:00.000Z'),
  ('01JTE2E143B000000000000C02', '01JTE2E143B000000000000A01', '2026-11-18T00:00:00.000Z'),
  ('01JTE2E143B000000000000R01', '01JTE2E143B000000000000A02', '2026-11-18T00:00:00.000Z'),
  ('01JTE2E143B000000000000R02', '01JTE2E143B000000000000A02', '2026-11-18T00:00:00.000Z'),
  ('01JTE2E143B000000000000C01', '01JTE2E143B000000000000A02', '2026-11-18T00:00:00.000Z'),
  ('01JTE2E143B000000000000R03', '01JTE2E143B000000000000A03', '2026-11-18T00:00:00.000Z'),
  ('01JTE2E143B000000000000R04', '01JTE2E143B000000000000A03', '2026-11-18T00:00:00.000Z'),
  ('01JTE2E143B000000000000C03', '01JTE2E143B000000000000A03', '2026-11-18T00:00:00.000Z');
