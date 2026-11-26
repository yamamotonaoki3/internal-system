-- #339 E2E専用（e2e/case-access-loss-outside-view.spec.ts）。架空の部署1件・社員2人・取引先1件、進行中の案件2件を入れる。
--   e2euser_outv_a：2件の案件の参加者（S-35 で案件の部屋のスレッドだけを見る。B に外される）
--   e2euser_outv_b：2件の案件の作成者で、一般の参加者（A を参加者から外す人）
-- 案件ごとに使う場面を分ける：0001 は 1件目（S-35 だけのタブ）、0002 は 2件目（別タブの合図）。
-- 各案件の部屋に、B の親1件と A の返信1件を入れる（A のスレッド一覧に出す）。
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない（login.sql が先に流れている前提）。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 識別子：社員ID e2euser_outv_、部署名 [E2E_TEST]部署339、取引先名 テスト商事画面外 [E2E_TEST]（コード QKQ。既存の E2E のシードと重ならない）、
-- 件名・説明に [E2E_TEST] を付ける。案件番号・案件専用チャンネルの名前は QKQ で始める。
-- case-access-loss-outside-view-cleanup.sql でこの識別子だけを消す。全体管理者・部署のオーナーは入れない。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES (
  '01JTE2E00000000000V0002339', '[E2E_TEST]部署339', '[e2e_test]部署339', 1,
  '2026-11-26T00:00:00.000Z', '', 1, '2026-11-26T00:00:00.000Z'
);

INSERT INTO clients (id, code, name, name_normalized, is_active, version, created_at, updated_at)
VALUES (
  '01JTE2E00000000000V0003339', 'QKQ', 'テスト商事画面外 [E2E_TEST]', 'テスト商事画面外 [e2e_test]', 1, 1,
  '2026-11-26T00:00:00.000Z', '2026-11-26T00:00:00.000Z'
);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000V0005339', 'e2euser_outv_a', 'e2euser_outv_a',
  'E2E画面外A', 'テスト本名画面外A',
  'e2euser_outv_a@example.com', 'e2euser_outv_a@example.com',
  '01JTE2E00000000000V0002339', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000V0006339', 'e2euser_outv_b', 'e2euser_outv_b',
  'E2E画面外B', 'テスト本名画面外B',
  'e2euser_outv_b@example.com', 'e2euser_outv_b@example.com',
  '01JTE2E00000000000V0002339', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

-- 案件の閲覧・やり取りは、一般のロールが持つ（e2e/seeds/case-access-loss-reload.sql と同じ）
INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES
  ('01JTE2E00000000000V0008339', '01JTE2E00000000000V0005339', 'role_member', 'company', NULL, '2026-11-26T00:00:00.000Z'),
  ('01JTE2E00000000000V0009339', '01JTE2E00000000000V0006339', 'role_member', 'company', NULL, '2026-11-26T00:00:00.000Z');

-- 部屋 → 案件専用チャンネル（purpose=case・private・部署なし）→ 案件 → 担当部署 → 参加の順に作る（外部キーの順）
INSERT INTO rooms (id, kind, created_at) VALUES
  ('01JTE2E00000000000V0010339', 'channel', '2026-11-26T00:00:00.000Z'),
  ('01JTE2E00000000000V0020339', 'channel', '2026-11-26T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES
  ('01JTE2E00000000000V0010339', NULL, 'QKQ-261126-0001', 'case:qkq-261126-0001', '', 'private', 'case',
   '01JTE2E00000000000V0006339', 1, '2026-11-26T00:00:00.000Z', '2026-11-26T00:00:00.000Z', NULL, NULL),
  ('01JTE2E00000000000V0020339', NULL, 'QKQ-261126-0002', 'case:qkq-261126-0002', '', 'private', 'case',
   '01JTE2E00000000000V0006339', 1, '2026-11-26T00:00:00.000Z', '2026-11-26T00:00:00.000Z', NULL, NULL);

-- request_id は外部キーでない（申請の行は作らない）。この E2E だけの値にする
INSERT INTO cases (
  id, case_number, number_client_id, client_id, channel_id, request_id, title, description, due_date,
  status, created_by, approved_by, version, created_at, updated_at
) VALUES
  ('01JTE2E00000000000V0011339', 'QKQ-261126-0001', '01JTE2E00000000000V0003339', '01JTE2E00000000000V0003339',
   '01JTE2E00000000000V0010339', '01JTE2E00000000000V0012339', '[E2E_TEST]画面外の案件1', '[E2E_TEST]画面外の説明1',
   NULL, 'active', '01JTE2E00000000000V0006339', '01JTE2E00000000000V0006339', 1,
   '2026-11-26T00:00:00.000Z', '2026-11-26T00:00:00.000Z'),
  ('01JTE2E00000000000V0021339', 'QKQ-261126-0002', '01JTE2E00000000000V0003339', '01JTE2E00000000000V0003339',
   '01JTE2E00000000000V0020339', '01JTE2E00000000000V0022339', '[E2E_TEST]画面外の案件2', '[E2E_TEST]画面外の説明2',
   NULL, 'active', '01JTE2E00000000000V0006339', '01JTE2E00000000000V0006339', 1,
   '2026-11-26T00:00:00.000Z', '2026-11-26T00:00:00.000Z');

INSERT INTO case_departments (case_id, department_id) VALUES
  ('01JTE2E00000000000V0011339', '01JTE2E00000000000V0002339'),
  ('01JTE2E00000000000V0021339', '01JTE2E00000000000V0002339');

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E00000000000V0010339', '01JTE2E00000000000V0006339', '2026-11-26T00:00:00.000Z'),
  ('01JTE2E00000000000V0010339', '01JTE2E00000000000V0005339', '2026-11-26T00:00:01.000Z'),
  ('01JTE2E00000000000V0020339', '01JTE2E00000000000V0006339', '2026-11-26T00:00:00.000Z'),
  ('01JTE2E00000000000V0020339', '01JTE2E00000000000V0005339', '2026-11-26T00:00:01.000Z');

-- 案件の部屋のスレッド（親は B、返信は A。A が関わるスレッドとして S-35 に出る）
INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at) VALUES
  ('01M78ZTJC0000000000339P001', '01JTE2E00000000000V0010339', '01JTE2E00000000000V0006339',
   'E2E画面外B', '[E2E_TEST]画面外の親1', '2026-11-26T00:00:00.000Z'),
  ('01M78ZTJC0000000000339P002', '01JTE2E00000000000V0020339', '01JTE2E00000000000V0006339',
   'E2E画面外B', '[E2E_TEST]画面外の親2', '2026-11-26T00:00:00.000Z');

INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at, parent_message_id) VALUES
  ('01M7938JW80000000000339R01', '01JTE2E00000000000V0010339', '01JTE2E00000000000V0005339',
   'E2E画面外A', '[E2E_TEST]画面外の返信1', '2026-11-26T00:00:05.000Z', '01M78ZTJC0000000000339P001'),
  ('01M7938JW80000000000339R02', '01JTE2E00000000000V0020339', '01JTE2E00000000000V0005339',
   'E2E画面外A', '[E2E_TEST]画面外の返信2', '2026-11-26T00:00:05.000Z', '01M78ZTJC0000000000339P002');
