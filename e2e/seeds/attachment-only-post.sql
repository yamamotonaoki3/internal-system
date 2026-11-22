-- #270（270-B）E2E専用（e2e/attachment-only-post.spec.ts）の架空データ。添付だけの投稿（C-137(3)。本文なしの投稿・編集・最後の添付の案内）を、
-- 画面からバックエンドまで通して確かめる。
-- 部署1件（[E2E_TEST] 本文なし添付）・社員1人（e2euser_attonly_a。参加者）・非公開チャンネル1つを入れる。
--   C01 [E2E_TEST]添付だけの部屋：A だけが参加
-- 添付のファイルは spec の中でバイト列から作り、画面からアップロードする（シードには入れない）。メッセージもシードに入れない（画面から投稿する）。
-- 後始末は attachment-only-post-cleanup.sql（社員ID e2euser_attonly_・部署名 [E2E_TEST] 本文なし添付 と、その部屋のメッセージ・添付・監査だけ）。
--   R2 の手元の実体は spec が先に消す。
-- 識別子は、#140 の attachments-cleanup.sql（e2euser_att_・部署名の先頭 13 文字が [E2E_TEST] 添付）と、
--   270-A の attachment-delete-cleanup.sql（e2euser_attdel_・部署名 [E2E_TEST] 削除添付）に当たらないものにする（互いの後始末で消し合わない）。
-- ID は 26 文字の ULID の形（I・L・O・U を使わない）。01JTE2E270B で始める。
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES
  ('01JTE2E270B000000000000D01', '[E2E_TEST] 本文なし添付', '[e2e_test] 本文なし添付', 1,
   '2026-11-22T00:00:00.000Z', '', 1, '2026-11-22T00:00:00.000Z');

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E270B000000000000A01', 'e2euser_attonly_a', 'e2euser_attonly_a',
  'E2E添付だけ利用者A', 'テスト本名添付だけA',
  'e2euser_attonly_a@example.com', 'e2euser_attonly_a@example.com',
  '01JTE2E270B000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

-- 投稿・編集・添付のアップロード・削除は、一般のロールが持つ
INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES
  ('01JTE2E270B000000000000R01', '01JTE2E270B000000000000A01', 'role_member', 'company', NULL, '2026-11-22T00:00:00.000Z');

INSERT INTO rooms (id, kind, created_at) VALUES
  ('01JTE2E270B000000000000C01', 'channel', '2026-11-22T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES
  ('01JTE2E270B000000000000C01', '01JTE2E270B000000000000D01', '[E2E_TEST]添付だけの部屋',
   '[e2e_test]添付だけの部屋', '', 'private', 'normal', NULL, 1,
   '2026-11-22T00:00:00.000Z', '2026-11-22T00:00:00.000Z', NULL, NULL);

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E270B000000000000C01', '01JTE2E270B000000000000A01', '2026-11-22T00:00:00.000Z');
