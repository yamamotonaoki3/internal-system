-- #124 E2E専用（e2e/notifications.spec.ts）。架空の部署1件・一般社員2人（e2euser_notif_01・e2euser_notif_02）・通知を入れる。
-- 通知の種類は本Issueでは0件のため、対応表に無い任意の文字列（e2e_sample）で作る（画面は汎用の「通知」表示になる）。
--   e2euser_notif_01 宛て：未読3件・既読1件（計4件）／e2euser_notif_02 宛て：未読1件（他人宛てが01の画面に出ないことを確かめる）
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 部署名は [E2E_TEST]部署124 で始め、社員IDは e2euser_notif_ で始める。notifications-cleanup.sql でこの識別子だけを消す。
-- 前提：#124 の migration 0014（notifications テーブル）が適用済み。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES (
  '01JTE2E0000000000000002124', '[E2E_TEST]部署124営業', '[e2e_test]部署124営業', 1,
  '2026-11-11T00:00:00.000Z', '', 1, '2026-11-11T00:00:00.000Z'
);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, extension, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E0000000000000000124', 'e2euser_notif_01', 'e2euser_notif_01',
  'E2E通知社員01', 'テスト本名通知001',
  'e2euser_notif_01@example.com', 'e2euser_notif_01@example.com',
  '01JTE2E0000000000000002124', '1240', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, extension, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E0000000000000005124', 'e2euser_notif_02', 'e2euser_notif_02',
  'E2E通知社員02', 'テスト本名通知002',
  'e2euser_notif_02@example.com', 'e2euser_notif_02@example.com',
  '01JTE2E0000000000000002124', '1241', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO notifications (id, user_id, kind, room_id, message_id, target_id, created_at, read_at) VALUES
  ('01JTE2E00000000000000N0124', '01JTE2E0000000000000000124', 'e2e_sample', NULL, NULL, NULL,
   '2026-11-10T00:00:00.000Z', '2026-11-10T01:00:00.000Z'),
  ('01JTE2E00000000000000N1124', '01JTE2E0000000000000000124', 'e2e_sample', NULL, NULL, NULL,
   '2026-11-10T00:01:00.000Z', NULL),
  ('01JTE2E00000000000000N2124', '01JTE2E0000000000000000124', 'e2e_sample', NULL, NULL, NULL,
   '2026-11-10T00:02:00.000Z', NULL),
  ('01JTE2E00000000000000N3124', '01JTE2E0000000000000000124', 'e2e_sample', NULL, NULL, NULL,
   '2026-11-10T00:03:00.000Z', NULL),
  ('01JTE2E00000000000000N5124', '01JTE2E0000000000000005124', 'e2e_sample', NULL, NULL, NULL,
   '2026-11-10T00:05:00.000Z', NULL);
