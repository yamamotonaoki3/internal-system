-- #237 E2E専用（e2e/unread.spec.ts）の架空データ。チャンネル・DM の未読の件数と既読（3-1 AC-1〜AC-3）を確かめる。
-- 部署1件・社員2人（e2euser_unread_a（A）・e2euser_unread_b（B））・公開チャンネル3つ・A と B の DM 1つを入れる。
--   C01 [E2E_TEST]部署237の未読     ：A・B が参加。A の参加の前に B の投稿3件、参加の後に B の投稿101件（A の未読は「99+」）
--   C02 [E2E_TEST]部署237の未参加   ：B だけが参加（A は未参加の公開チャンネル。未読の対象外。1-1 AC-2・C-94）。B の投稿2件
--   C03 [E2E_TEST]部署237の参加の前 ：A・B が参加。A の参加の前に B の投稿2件、参加の後に B の投稿1件（A の未読は「1」。参加の前は数えない。C-169 (2)）
--   M01 A と B の DM               ：B の投稿2件のあと A の投稿1件（A の未読は「2」。自分の投稿は数えない。C-169 (3)）
-- A の参加の時刻は 2026-11-13T00:00:00.000Z（ULID の時刻部分 01M7938E00）に固定する。メッセージの ID は ULID の形で、時刻部分を
--   参加の前 2026-11-12T23:00:00.000Z（01M78ZTJC0）・参加の後 2026-11-13T00:00:05.000Z（01M7938JW8）・DM 2026-11-13T00:00:10.000Z（01M7938QRG）
--   にそろえ、後ろの16桁を連番にして昇順にする。created_at も同じ時刻にそろえる。
-- 後始末は unread-cleanup.sql（社員ID e2euser_unread_・部署名 [E2E_TEST]部署237 と、その利用者が当事者の DM だけ）。
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 本文は [E2E_TEST] で始める。前提：#237 の migration 0018（read_positions）が適用済み。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES
  ('01JTE2E2370000000000000D01', '[E2E_TEST]部署237', '[e2e_test]部署237', 1,
   '2026-11-13T00:00:00.000Z', '', 1, '2026-11-13T00:00:00.000Z');

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E2370000000000000A01', 'e2euser_unread_a', 'e2euser_unread_a',
  'E2E未読利用者A', 'テスト本名未読A',
  'e2euser_unread_a@example.com', 'e2euser_unread_a@example.com',
  '01JTE2E2370000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E2370000000000000A02', 'e2euser_unread_b', 'e2euser_unread_b',
  'E2E未読利用者B', 'テスト本名未読B',
  'e2euser_unread_b@example.com', 'e2euser_unread_b@example.com',
  '01JTE2E2370000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES
  ('01JTE2E2370000000000000R01', '01JTE2E2370000000000000A01', 'role_member', 'company', NULL, '2026-11-13T00:00:00.000Z'),
  ('01JTE2E2370000000000000R02', '01JTE2E2370000000000000A02', 'role_member', 'company', NULL, '2026-11-13T00:00:00.000Z');

INSERT INTO rooms (id, kind, created_at) VALUES
  ('01JTE2E2370000000000000C01', 'channel', '2026-11-12T00:00:00.000Z'),
  ('01JTE2E2370000000000000C02', 'channel', '2026-11-12T00:00:00.000Z'),
  ('01JTE2E2370000000000000C03', 'channel', '2026-11-12T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES
  ('01JTE2E2370000000000000C01', '01JTE2E2370000000000000D01', '[E2E_TEST]部署237の未読',
   '[e2e_test]部署237の未読', '', 'public', 'normal', NULL, 1,
   '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z', NULL, NULL),
  ('01JTE2E2370000000000000C02', '01JTE2E2370000000000000D01', '[E2E_TEST]部署237の未参加',
   '[e2e_test]部署237の未参加', '', 'public', 'normal', NULL, 1,
   '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z', NULL, NULL),
  ('01JTE2E2370000000000000C03', '01JTE2E2370000000000000D01', '[E2E_TEST]部署237の参加の前',
   '[e2e_test]部署237の参加の前', '', 'public', 'normal', NULL, 1,
   '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z', NULL, NULL);

-- A の参加は 2026-11-13T00:00:00.000Z。B はそれより前から参加している
INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E2370000000000000C01', '01JTE2E2370000000000000A01', '2026-11-13T00:00:00.000Z'),
  ('01JTE2E2370000000000000C01', '01JTE2E2370000000000000A02', '2026-11-12T00:00:00.000Z'),
  ('01JTE2E2370000000000000C02', '01JTE2E2370000000000000A02', '2026-11-12T00:00:00.000Z'),
  ('01JTE2E2370000000000000C03', '01JTE2E2370000000000000A01', '2026-11-13T00:00:00.000Z'),
  ('01JTE2E2370000000000000C03', '01JTE2E2370000000000000A02', '2026-11-12T00:00:00.000Z');

-- C01：A の参加の前の B の投稿（3件）。A の未読に数えない
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 3)
INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at)
SELECT '01M78ZTJC0' || printf('%016d', n), '01JTE2E2370000000000000C01', '01JTE2E2370000000000000A02',
  'E2E未読利用者B', '[E2E_TEST]参加の前の投稿' || n, '2026-11-12T23:00:00.000Z'
FROM seq;

-- C01：A の参加の後の B の投稿（101件）。A の未読は 100 で打ち切られ、画面は「99+」
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 101)
INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at)
SELECT '01M7938JW8' || printf('%016d', n), '01JTE2E2370000000000000C01', '01JTE2E2370000000000000A02',
  'E2E未読利用者B', '[E2E_TEST]未読の投稿' || n, '2026-11-13T00:00:05.000Z'
FROM seq;

-- C02：A が未参加の公開チャンネルの B の投稿（2件）
INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at) VALUES
  ('01M7938JW80000000000002001', '01JTE2E2370000000000000C02', '01JTE2E2370000000000000A02',
   'E2E未読利用者B', '[E2E_TEST]未参加のチャンネルの投稿1', '2026-11-13T00:00:05.000Z'),
  ('01M7938JW80000000000002002', '01JTE2E2370000000000000C02', '01JTE2E2370000000000000A02',
   'E2E未読利用者B', '[E2E_TEST]未参加のチャンネルの投稿2', '2026-11-13T00:00:05.000Z');

-- C03：A の参加の前の B の投稿（2件）と、参加の後の B の投稿（1件）。A の未読は 1
INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at) VALUES
  ('01M78ZTJC00000000000000101', '01JTE2E2370000000000000C03', '01JTE2E2370000000000000A02',
   'E2E未読利用者B', '[E2E_TEST]参加の前の投稿101', '2026-11-12T23:00:00.000Z'),
  ('01M78ZTJC00000000000000102', '01JTE2E2370000000000000C03', '01JTE2E2370000000000000A02',
   'E2E未読利用者B', '[E2E_TEST]参加の前の投稿102', '2026-11-12T23:00:00.000Z'),
  ('01M7938JW80000000000001001', '01JTE2E2370000000000000C03', '01JTE2E2370000000000000A02',
   'E2E未読利用者B', '[E2E_TEST]参加の後の投稿', '2026-11-13T00:00:05.000Z');

-- A と B の DM。direct_key は2人の利用者IDを小さい順に ':' でつないだもの
INSERT INTO rooms (id, kind, created_at) VALUES
  ('01JTE2E2370000000000000M01', 'direct', '2026-11-13T00:00:00.000Z');

INSERT INTO conversations (room_id, direct_key, created_at) VALUES
  ('01JTE2E2370000000000000M01',
   '01JTE2E2370000000000000A01:01JTE2E2370000000000000A02',
   '2026-11-13T00:00:00.000Z');

INSERT INTO conversation_members (conversation_id, user_id) VALUES
  ('01JTE2E2370000000000000M01', '01JTE2E2370000000000000A01'),
  ('01JTE2E2370000000000000M01', '01JTE2E2370000000000000A02');

-- DM：B の投稿2件のあと A の投稿1件（A の未読は B の分だけの 2）
INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at) VALUES
  ('01M7938QRG0000000000000001', '01JTE2E2370000000000000M01', '01JTE2E2370000000000000A02',
   'E2E未読利用者B', '[E2E_TEST]BからAへのDM1', '2026-11-13T00:00:10.000Z'),
  ('01M7938QRG0000000000000002', '01JTE2E2370000000000000M01', '01JTE2E2370000000000000A02',
   'E2E未読利用者B', '[E2E_TEST]BからAへのDM2', '2026-11-13T00:00:10.000Z'),
  ('01M7938QRG0000000000000003', '01JTE2E2370000000000000M01', '01JTE2E2370000000000000A01',
   'E2E未読利用者A', '[E2E_TEST]AからBへのDM', '2026-11-13T00:00:10.000Z');
