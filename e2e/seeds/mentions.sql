-- #139 E2E専用の架空データ。A・Bは公開チャンネル参加、Cは非参加。
-- パスワードのハッシュは既存のテスト用利用者から参照し、値を複製しない。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES ('01JTE2E1390000000000000D01', '[E2E_TEST]部署139', '[e2e_test]部署139', 1,
  '2026-11-15T00:00:00.000Z', '', 1, '2026-11-15T00:00:00.000Z');

INSERT INTO rooms (id, kind, created_at)
VALUES ('01JTE2E1390000000000000C01', 'channel', '2026-11-15T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES (
  '01JTE2E1390000000000000C01', '01JTE2E1390000000000000D01',
  '[E2E_TEST]指名チャンネル139', '[e2e_test]指名チャンネル139', '', 'public',
  'department', NULL, 1, '2026-11-15T00:00:00.000Z',
  '2026-11-15T00:00:00.000Z', NULL, NULL
);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT '01JTE2E1390000000000000A01', 'e2euser_mtn_a', 'e2euser_mtn_a',
  'testuser_mtn_a', 'テスト本名指名A', 'e2euser_mtn_a@example.com',
  'e2euser_mtn_a@example.com', '01JTE2E1390000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT '01JTE2E1390000000000000A02', 'e2euser_mtn_b', 'e2euser_mtn_b',
  'testuser_mtn_b', 'テスト本名指名B', 'e2euser_mtn_b@example.com',
  'e2euser_mtn_b@example.com', '01JTE2E1390000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT '01JTE2E1390000000000000A03', 'e2euser_mtn_c', 'e2euser_mtn_c',
  'testuser_mtn_c', 'テスト本名指名C', 'e2euser_mtn_c@example.com',
  'e2euser_mtn_c@example.com', '01JTE2E1390000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E1390000000000000C01', '01JTE2E1390000000000000A01', '2026-11-15T00:00:00.000Z'),
  ('01JTE2E1390000000000000C01', '01JTE2E1390000000000000A02', '2026-11-15T00:00:00.000Z');
