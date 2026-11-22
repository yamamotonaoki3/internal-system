-- #338 E2E専用（e2e/case-access-loss-reload.spec.ts）。架空の部署1件・社員2人・取引先1件、進行中の案件3件、通常のチャンネル1つを入れる。
--   e2euser_reload_a：3件の案件の作成者で、一般の参加者（相手を参加者から外す人）。チャンネルの投稿者で、その投稿にリアクションを付けている
--   e2euser_reload_b：3件の案件の参加者（E-1・E-2 で外され、E-3 で自分から退出する）。チャンネルの参加者（E-2 の「付けた人」のダイアログを開く）
-- 案件ごとに使う場面を分ける：0001 は E-1、0002 は E-2、0003 は E-3（前の場面で外された案件を、後の場面で使わない）。
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない（login.sql が先に流れている前提）。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 識別子：社員ID e2euser_reload_、部署名 [E2E_TEST]部署338、取引先名 テスト商事読み込み直し [E2E_TEST]（コード QKL。既存の E2E のシードと重ならない）、
-- 件名・説明・本文に [E2E_TEST] を付ける。案件番号・案件専用チャンネルの名前は QKL で始める。通常のチャンネルの名前は E2E_TEST_reload_ で始める。
-- case-access-loss-reload-cleanup.sql でこの識別子だけを消す。全体管理者・部署のオーナーは入れない。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES (
  '01JTE2E00000000000R0002338', '[E2E_TEST]部署338', '[e2e_test]部署338', 1,
  '2026-11-22T00:00:00.000Z', '', 1, '2026-11-22T00:00:00.000Z'
);

INSERT INTO clients (id, code, name, name_normalized, is_active, version, created_at, updated_at)
VALUES (
  '01JTE2E00000000000R0003338', 'QKL', 'テスト商事読み込み直し [E2E_TEST]', 'テスト商事読み込み直し [e2e_test]', 1, 1,
  '2026-11-22T00:00:00.000Z', '2026-11-22T00:00:00.000Z'
);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000R0005338', 'e2euser_reload_a', 'e2euser_reload_a',
  'E2E読み込み直しA', 'テスト本名読み込み直しA',
  'e2euser_reload_a@example.com', 'e2euser_reload_a@example.com',
  '01JTE2E00000000000R0002338', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000R0006338', 'e2euser_reload_b', 'e2euser_reload_b',
  'E2E読み込み直しB', 'テスト本名読み込み直しB',
  'e2euser_reload_b@example.com', 'e2euser_reload_b@example.com',
  '01JTE2E00000000000R0002338', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

-- チャンネルの閲覧・投稿・リアクションは、一般のロールが持つ（e2e/seeds/reactions.sql と同じ）
INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES
  ('01JTE2E00000000000R0008338', '01JTE2E00000000000R0005338', 'role_member', 'company', NULL, '2026-11-22T00:00:00.000Z'),
  ('01JTE2E00000000000R0009338', '01JTE2E00000000000R0006338', 'role_member', 'company', NULL, '2026-11-22T00:00:00.000Z');

-- 部屋 → 案件専用チャンネル（purpose=case・private・部署なし）→ 案件 → 担当部署 → 参加の順に作る（外部キーの順）
INSERT INTO rooms (id, kind, created_at) VALUES
  ('01JTE2E00000000000R0010338', 'channel', '2026-11-22T00:00:00.000Z'),
  ('01JTE2E00000000000R0020338', 'channel', '2026-11-22T00:00:00.000Z'),
  ('01JTE2E00000000000R0030338', 'channel', '2026-11-22T00:00:00.000Z'),
  ('01JTE2E00000000000R0040338', 'channel', '2026-11-22T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES
  ('01JTE2E00000000000R0010338', NULL, 'QKL-261122-0001', 'case:qkl-261122-0001', '', 'private', 'case',
   '01JTE2E00000000000R0005338', 1, '2026-11-22T00:00:00.000Z', '2026-11-22T00:00:00.000Z', NULL, NULL),
  ('01JTE2E00000000000R0020338', NULL, 'QKL-261122-0002', 'case:qkl-261122-0002', '', 'private', 'case',
   '01JTE2E00000000000R0005338', 1, '2026-11-22T00:00:00.000Z', '2026-11-22T00:00:00.000Z', NULL, NULL),
  ('01JTE2E00000000000R0030338', NULL, 'QKL-261122-0003', 'case:qkl-261122-0003', '', 'private', 'case',
   '01JTE2E00000000000R0005338', 1, '2026-11-22T00:00:00.000Z', '2026-11-22T00:00:00.000Z', NULL, NULL),
  ('01JTE2E00000000000R0040338', '01JTE2E00000000000R0002338', 'E2E_TEST_reload_部屋', 'e2e_test_reload_部屋', '',
   'public', 'normal', NULL, 1, '2026-11-22T00:00:00.000Z', '2026-11-22T00:00:00.000Z', NULL, NULL);

-- request_id は外部キーでない（申請の行は作らない）。この E2E だけの値にする
INSERT INTO cases (
  id, case_number, number_client_id, client_id, channel_id, request_id, title, description, due_date,
  status, created_by, approved_by, version, created_at, updated_at
) VALUES
  ('01JTE2E00000000000R0011338', 'QKL-261122-0001', '01JTE2E00000000000R0003338', '01JTE2E00000000000R0003338',
   '01JTE2E00000000000R0010338', '01JTE2E00000000000R0012338', '[E2E_TEST]読み込み直しの案件1', '[E2E_TEST]読み込み直しの説明1',
   NULL, 'active', '01JTE2E00000000000R0005338', '01JTE2E00000000000R0005338', 1,
   '2026-11-22T00:00:00.000Z', '2026-11-22T00:00:00.000Z'),
  ('01JTE2E00000000000R0021338', 'QKL-261122-0002', '01JTE2E00000000000R0003338', '01JTE2E00000000000R0003338',
   '01JTE2E00000000000R0020338', '01JTE2E00000000000R0022338', '[E2E_TEST]読み込み直しの案件2', '[E2E_TEST]読み込み直しの説明2',
   NULL, 'active', '01JTE2E00000000000R0005338', '01JTE2E00000000000R0005338', 1,
   '2026-11-22T00:00:00.000Z', '2026-11-22T00:00:00.000Z'),
  ('01JTE2E00000000000R0031338', 'QKL-261122-0003', '01JTE2E00000000000R0003338', '01JTE2E00000000000R0003338',
   '01JTE2E00000000000R0030338', '01JTE2E00000000000R0032338', '[E2E_TEST]読み込み直しの案件3', '[E2E_TEST]読み込み直しの説明3',
   NULL, 'active', '01JTE2E00000000000R0005338', '01JTE2E00000000000R0005338', 1,
   '2026-11-22T00:00:00.000Z', '2026-11-22T00:00:00.000Z');

INSERT INTO case_departments (case_id, department_id) VALUES
  ('01JTE2E00000000000R0011338', '01JTE2E00000000000R0002338'),
  ('01JTE2E00000000000R0021338', '01JTE2E00000000000R0002338'),
  ('01JTE2E00000000000R0031338', '01JTE2E00000000000R0002338');

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E00000000000R0010338', '01JTE2E00000000000R0005338', '2026-11-22T00:00:00.000Z'),
  ('01JTE2E00000000000R0010338', '01JTE2E00000000000R0006338', '2026-11-22T00:00:01.000Z'),
  ('01JTE2E00000000000R0020338', '01JTE2E00000000000R0005338', '2026-11-22T00:00:00.000Z'),
  ('01JTE2E00000000000R0020338', '01JTE2E00000000000R0006338', '2026-11-22T00:00:01.000Z'),
  ('01JTE2E00000000000R0030338', '01JTE2E00000000000R0005338', '2026-11-22T00:00:00.000Z'),
  ('01JTE2E00000000000R0030338', '01JTE2E00000000000R0006338', '2026-11-22T00:00:01.000Z'),
  ('01JTE2E00000000000R0040338', '01JTE2E00000000000R0005338', '2026-11-22T00:00:00.000Z'),
  ('01JTE2E00000000000R0040338', '01JTE2E00000000000R0006338', '2026-11-22T00:00:01.000Z');

-- E-2：通常のチャンネルの、A の投稿1件と、A が付けたリアクション1件（スマホ幅で「付けた人」のボタンが出る）
INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at) VALUES
  ('01M7A00000000000000R033801', '01JTE2E00000000000R0040338', '01JTE2E00000000000R0005338',
   'E2E読み込み直しA', '[E2E_TEST]読み込み直しのリアクション付きの投稿', '2026-11-22T00:00:10.000Z');

INSERT INTO message_reactions (message_id, user_id, kind, value, created_at) VALUES
  ('01M7A00000000000000R033801', '01JTE2E00000000000R0005338', 'emoji', '👍', '2026-11-22T00:00:20.000Z');
