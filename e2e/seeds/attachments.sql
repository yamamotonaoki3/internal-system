-- #140 E2E専用（e2e/attachments.spec.ts）の架空データ。メッセージの添付（1-6 AC-1〜AC-3・AC-7・AC-9、1-4 AC-5）を確かめる。
-- 部署1件（[E2E_TEST] 添付）・社員2人（e2euser_att_a（A。参加者）・e2euser_att_b（B。非参加者））・非公開チャンネル1つを入れる。
--   C01 [E2E_TEST]添付の非公開 ：A だけが参加（B は未参加。B が添付の URL を開くと 404）
--         P01 A の投稿（S-07 で返信に添付する親）
-- 添付のファイルは spec の中でバイト列から作る（シードには入れない）。
-- 後始末は attachments-cleanup.sql（社員ID e2euser_att_・部署名 [E2E_TEST] 添付 と、その部屋のメッセージ・添付だけ）。R2 の手元の実体は spec が先に消す。
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 前提：#140 の migration 0023（message_attachments）が適用済み。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES
  ('01JTE2E1400000000000000D01', '[E2E_TEST] 添付', '[e2e_test] 添付', 1,
   '2026-11-16T00:00:00.000Z', '', 1, '2026-11-16T00:00:00.000Z');

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E140000000000000A01', 'e2euser_att_a', 'e2euser_att_a',
  'E2E添付利用者A', 'テスト本名添付A',
  'e2euser_att_a@example.com', 'e2euser_att_a@example.com',
  '01JTE2E1400000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E140000000000000A02', 'e2euser_att_b', 'e2euser_att_b',
  'E2E添付利用者B', 'テスト本名添付B',
  'e2euser_att_b@example.com', 'e2euser_att_b@example.com',
  '01JTE2E1400000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

-- 添付（perm.attachment.upload・download）・返信・閲覧は、一般のロールが持つ
INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES
  ('01JTE2E1400000000000000R01', '01JTE2E140000000000000A01', 'role_member', 'company', NULL, '2026-11-16T00:00:00.000Z'),
  ('01JTE2E1400000000000000R02', '01JTE2E140000000000000A02', 'role_member', 'company', NULL, '2026-11-16T00:00:00.000Z');

INSERT INTO rooms (id, kind, created_at) VALUES
  ('01JTE2E1400000000000000C01', 'channel', '2026-11-16T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES
  ('01JTE2E1400000000000000C01', '01JTE2E1400000000000000D01', '[E2E_TEST]添付の非公開',
   '[e2e_test]添付の非公開', '', 'private', 'normal', NULL, 1,
   '2026-11-16T00:00:00.000Z', '2026-11-16T00:00:00.000Z', NULL, NULL);

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E1400000000000000C01', '01JTE2E140000000000000A01', '2026-11-16T00:00:00.000Z');

INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at) VALUES
  ('01M78ZTJC00000000000014001', '01JTE2E1400000000000000C01', '01JTE2E140000000000000A01',
   'E2E添付利用者A', '[E2E_TEST]添付のスレッドの親', '2026-11-12T23:00:00.000Z');
