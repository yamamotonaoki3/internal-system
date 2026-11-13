-- #238 E2E専用（e2e/messages-retired.spec.ts）の架空データ。チャンネルのメッセージ一覧で、無効化された投稿者に「退職者」を併記することを確かめる（1-1 AC-3・C-74）。
-- 部署1件（[E2E_TEST]部署238）、その公開チャンネル1つ、社員3人：
--   e2euser_ret238_a       ：ログインして S-05 を開く閲覧者（有効・参加者）
--   e2euser_ret238_b       ：有効な投稿者（投稿あり）
--   e2euser_ret238_retired ：無効（is_active=0）な投稿者（投稿あり）。投稿時点の表示名と、今の表示名（users.display_name）は別の名前にする
-- 画面は、投稿時点の表示名（messages.sender_display_name）と「退職者」を出し、今の表示名は出さない。
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 後始末は messages-retired-cleanup.sql（社員ID e2euser_ret238_・部署名 [E2E_TEST]部署238 だけ）。本文は [E2E_TEST] で始める。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES
  ('01JTE2E2380000000000000D01', '[E2E_TEST]部署238', '[e2e_test]部署238', 1,
   '2026-11-13T00:00:00.000Z', '', 1, '2026-11-13T00:00:00.000Z');

INSERT INTO rooms (id, kind, created_at) VALUES
  ('01JTE2E2380000000000000C01', 'channel', '2026-11-13T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES
  ('01JTE2E2380000000000000C01', '01JTE2E2380000000000000D01', '[E2E_TEST]部署238',
   '[e2e_test]部署238', '', 'public', 'department', NULL, 1,
   '2026-11-13T00:00:00.000Z', '2026-11-13T00:00:00.000Z', NULL, NULL);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E2380000000000000A01', 'e2euser_ret238_a', 'e2euser_ret238_a',
  'E2E退職者表示の閲覧者A', 'テスト本名退職者表示A',
  'e2euser_ret238_a@example.com', 'e2euser_ret238_a@example.com',
  '01JTE2E2380000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E2380000000000000A02', 'e2euser_ret238_b', 'e2euser_ret238_b',
  'E2E在職の投稿者B', 'テスト本名退職者表示B',
  'e2euser_ret238_b@example.com', 'e2euser_ret238_b@example.com',
  '01JTE2E2380000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

-- 無効な投稿者。今の表示名（display_name）は、投稿時点の名前（messages.sender_display_name）と別にする
INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active, deactivated_at
)
SELECT
  '01JTE2E2380000000000000A03', 'e2euser_ret238_retired', 'e2euser_ret238_retired',
  'E2E今の名前の退職者', 'テスト本名退職者表示R',
  'e2euser_ret238_retired@example.com', 'e2euser_ret238_retired@example.com',
  '01JTE2E2380000000000000D01', password_hash, 0, 0, '2026-11-13T00:00:30.000Z'
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E2380000000000000C01', '01JTE2E2380000000000000A01', '2026-11-13T00:00:00.000Z'),
  ('01JTE2E2380000000000000C01', '01JTE2E2380000000000000A02', '2026-11-13T00:00:00.000Z'),
  ('01JTE2E2380000000000000C01', '01JTE2E2380000000000000A03', '2026-11-13T00:00:00.000Z');

-- 投稿：無効になる前の投稿時点の表示名で、退職者 → 有効な B の順（ULID の時刻部分は 2026-11-13T00:00:05.000Z）
INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at) VALUES
  ('01M7938JW80000000000238001', '01JTE2E2380000000000000C01', '01JTE2E2380000000000000A03',
   'E2E投稿時の元社員名', '[E2E_TEST]無効な社員の投稿', '2026-11-13T00:00:05.000Z'),
  ('01M7938JW80000000000238002', '01JTE2E2380000000000000C01', '01JTE2E2380000000000000A02',
   'E2E在職の投稿者B', '[E2E_TEST]在職者の投稿', '2026-11-13T00:00:05.000Z');
