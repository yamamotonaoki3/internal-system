-- #201 E2E専用（e2e/messages.spec.ts）の架空データ。部署1件、その専用チャンネル1つ（公開）、社員2人（どちらもそのチャンネルの参加者）を入れる。
-- 全社連絡は migration（0011）が作る初期データのため、ここでは作らない。後始末は messages-cleanup.sql（識別子だけで消す）。
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 部署名・チャンネル名は [E2E_TEST]部署201 で始め、社員IDは e2euser_msg_ で始める。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES
  ('01JTE2E3000000000000000D01', '[E2E_TEST]部署201', '[e2e_test]部署201', 1,
   '2026-11-09T00:00:00.000Z', '', 1, '2026-11-09T00:00:00.000Z');

INSERT INTO rooms (id, kind, created_at) VALUES
  ('01JTE2E3000000000000000C01', 'channel', '2026-11-09T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES
  ('01JTE2E3000000000000000C01', '01JTE2E3000000000000000D01', '[E2E_TEST]部署201',
   '[e2e_test]部署201', '', 'public', 'department', NULL, 1,
   '2026-11-09T00:00:00.000Z', '2026-11-09T00:00:00.000Z', NULL, NULL);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E3000000000000000A01', 'e2euser_msg_a', 'e2euser_msg_a',
  'E2Eメッセージ利用者A', 'テスト本名メッセージA',
  'e2euser_msg_a@example.com', 'e2euser_msg_a@example.com',
  '01JTE2E3000000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E3000000000000000A02', 'e2euser_msg_b', 'e2euser_msg_b',
  'E2Eメッセージ利用者B', 'テスト本名メッセージB',
  'e2euser_msg_b@example.com', 'e2euser_msg_b@example.com',
  '01JTE2E3000000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E3000000000000000C01', '01JTE2E3000000000000000A01', '2026-11-09T00:00:00.000Z'),
  ('01JTE2E3000000000000000C01', '01JTE2E3000000000000000A02', '2026-11-09T00:00:00.000Z');
