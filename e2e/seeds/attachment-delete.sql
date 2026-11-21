-- #270（270-A）E2E専用（e2e/attachment-delete.spec.ts）の架空データ。添付の削除（1-6 AC-4）を、画面からバックエンドまで通して確かめる。
-- 部署1件（[E2E_TEST] 削除添付）・社員1人（e2euser_attdel_a。参加者）・非公開チャンネル1つを入れる。
--   C01 [E2E_TEST]添付の削除の部屋：A だけが参加
-- 添付のファイルは spec の中でバイト列から作り、画面からアップロードする（シードには入れない）。
-- 後始末は attachment-delete-cleanup.sql（社員ID e2euser_attdel_・部署名 [E2E_TEST] 削除添付 と、その部屋のメッセージ・添付・監査だけ）。
--   R2 の手元の実体は spec が先に消す。
-- 識別子は #140 の attachments-cleanup.sql（e2euser_att_・部署名の先頭 [E2E_TEST] 添付）に当たらないものにする（互いの後始末で消し合わない）。
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 前提：#270 の migration（message_attachments の deleted_at・deleted_by）が適用済み。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES
  ('01JTE2E2700000000000000D01', '[E2E_TEST] 削除添付', '[e2e_test] 削除添付', 1,
   '2026-11-21T00:00:00.000Z', '', 1, '2026-11-21T00:00:00.000Z');

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E2700000000000000A01', 'e2euser_attdel_a', 'e2euser_attdel_a',
  'E2E添付削除利用者A', 'テスト本名添付削除A',
  'e2euser_attdel_a@example.com', 'e2euser_attdel_a@example.com',
  '01JTE2E2700000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

-- 添付のアップロード・削除（perm.attachment.delete.own）は、一般のロールが持つ
INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES
  ('01JTE2E2700000000000000R01', '01JTE2E2700000000000000A01', 'role_member', 'company', NULL, '2026-11-21T00:00:00.000Z');

INSERT INTO rooms (id, kind, created_at) VALUES
  ('01JTE2E2700000000000000C01', 'channel', '2026-11-21T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES
  ('01JTE2E2700000000000000C01', '01JTE2E2700000000000000D01', '[E2E_TEST]添付の削除の部屋',
   '[e2e_test]添付の削除の部屋', '', 'private', 'normal', NULL, 1,
   '2026-11-21T00:00:00.000Z', '2026-11-21T00:00:00.000Z', NULL, NULL);

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E2700000000000000C01', '01JTE2E2700000000000000A01', '2026-11-21T00:00:00.000Z');
