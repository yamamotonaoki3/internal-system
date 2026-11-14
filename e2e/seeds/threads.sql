-- #137 E2E専用（e2e/threads.spec.ts）の架空データ。スレッドの返信とスレッド一覧（1-4 AC-1〜AC-4）を確かめる。
-- 部署1件（[E2E_TEST]部署137）・社員2人（e2euser_thr_a（A）・e2euser_thr_b（B））・公開チャンネル2つを入れる。
--   C01 [E2E_TEST]部署137のスレッド ：A・B が参加
--         P1 B の投稿（返信なし。A が返信して「返信 1 件」になる）
--         P2 B の投稿＋ A の返信 R2（B の未読 1。最後の返信が古い）
--         P3 B の投稿＋ A の返信 R3（B の未読 1。最後の返信が新しい）
--         P4 A の投稿＋ B の返信 R4（A の未読 1。A が削除して、B の S-07 で入力欄が閉じることを確かめる）
--         P6 A の投稿＋ A の返信 R6（B は無関係。B のスレッド一覧に出ない）
--   C02 [E2E_TEST]部署137の未参加   ：B だけが参加（A は未参加の公開チャンネル。A は読めるが返信できない。C-94）
--         P5 B の投稿＋ B の返信 R5
-- メッセージの ID は ULID の形で、時刻部分を 親 2026-11-12T23:00:00.000Z（01M78ZTJC0）・返信 2026-11-13T00:00:05.000Z（01M7938JW8）・
--   R3 だけ 2026-11-13T00:00:10.000Z（01M7938QRG）にそろえ、後ろの16桁を連番にして昇順にする（R3 が最も新しい返信）。created_at も同じ時刻にそろえる。
-- 後始末は threads-cleanup.sql（社員ID e2euser_thr_・部署名 [E2E_TEST]部署137 と、その部屋のメッセージだけ。返信 → 親の順）。
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 本文は [E2E_TEST] で始める。前提：#137 の migration 0020（messages.parent_message_id・thread_read_positions）が適用済み。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES
  ('01JTE2E1370000000000000D01', '[E2E_TEST]部署137', '[e2e_test]部署137', 1,
   '2026-11-12T00:00:00.000Z', '', 1, '2026-11-12T00:00:00.000Z');

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E1370000000000000A01', 'e2euser_thr_a', 'e2euser_thr_a',
  'E2Eスレッド利用者A', 'テスト本名スレッドA',
  'e2euser_thr_a@example.com', 'e2euser_thr_a@example.com',
  '01JTE2E1370000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E1370000000000000A02', 'e2euser_thr_b', 'e2euser_thr_b',
  'E2Eスレッド利用者B', 'テスト本名スレッドB',
  'e2euser_thr_b@example.com', 'e2euser_thr_b@example.com',
  '01JTE2E1370000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

-- 返信（perm.message.reply）・スレッドの既読（perm.notification.own）・編集・削除は、一般のロールが持つ
INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES
  ('01JTE2E1370000000000000R01', '01JTE2E1370000000000000A01', 'role_member', 'company', NULL, '2026-11-12T00:00:00.000Z'),
  ('01JTE2E1370000000000000R02', '01JTE2E1370000000000000A02', 'role_member', 'company', NULL, '2026-11-12T00:00:00.000Z');

INSERT INTO rooms (id, kind, created_at) VALUES
  ('01JTE2E1370000000000000C01', 'channel', '2026-11-12T00:00:00.000Z'),
  ('01JTE2E1370000000000000C02', 'channel', '2026-11-12T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES
  ('01JTE2E1370000000000000C01', '01JTE2E1370000000000000D01', '[E2E_TEST]部署137のスレッド',
   '[e2e_test]部署137のスレッド', '', 'public', 'normal', NULL, 1,
   '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z', NULL, NULL),
  ('01JTE2E1370000000000000C02', '01JTE2E1370000000000000D01', '[E2E_TEST]部署137の未参加',
   '[e2e_test]部署137の未参加', '', 'public', 'normal', NULL, 1,
   '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z', NULL, NULL);

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E1370000000000000C01', '01JTE2E1370000000000000A01', '2026-11-12T00:00:00.000Z'),
  ('01JTE2E1370000000000000C01', '01JTE2E1370000000000000A02', '2026-11-12T00:00:00.000Z'),
  ('01JTE2E1370000000000000C02', '01JTE2E1370000000000000A02', '2026-11-12T00:00:00.000Z');

-- 親の投稿（parent_message_id は NULL のまま）
INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at) VALUES
  ('01M78ZTJC00000000000013701', '01JTE2E1370000000000000C01', '01JTE2E1370000000000000A02',
   'E2Eスレッド利用者B', '[E2E_TEST]親1の返信なし', '2026-11-12T23:00:00.000Z'),
  ('01M78ZTJC00000000000013702', '01JTE2E1370000000000000C01', '01JTE2E1370000000000000A02',
   'E2Eスレッド利用者B', '[E2E_TEST]親2の古いスレッド', '2026-11-12T23:00:00.000Z'),
  ('01M78ZTJC00000000000013703', '01JTE2E1370000000000000C01', '01JTE2E1370000000000000A02',
   'E2Eスレッド利用者B', '[E2E_TEST]親3の新しいスレッド', '2026-11-12T23:00:00.000Z'),
  ('01M78ZTJC00000000000013704', '01JTE2E1370000000000000C01', '01JTE2E1370000000000000A01',
   'E2Eスレッド利用者A', '[E2E_TEST]親4のAの投稿', '2026-11-12T23:00:00.000Z'),
  ('01M78ZTJC00000000000013705', '01JTE2E1370000000000000C02', '01JTE2E1370000000000000A02',
   'E2Eスレッド利用者B', '[E2E_TEST]親5の未参加のチャンネル', '2026-11-12T23:00:00.000Z'),
  ('01M78ZTJC00000000000013706', '01JTE2E1370000000000000C01', '01JTE2E1370000000000000A01',
   'E2Eスレッド利用者A', '[E2E_TEST]親6のBは無関係', '2026-11-12T23:00:00.000Z');

-- 返信（parent_message_id に親の ID）
INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at, parent_message_id) VALUES
  ('01M7938JW80000000000013712', '01JTE2E1370000000000000C01', '01JTE2E1370000000000000A01',
   'E2Eスレッド利用者A', '[E2E_TEST]返信2のAから', '2026-11-13T00:00:05.000Z', '01M78ZTJC00000000000013702'),
  ('01M7938QRG0000000000013713', '01JTE2E1370000000000000C01', '01JTE2E1370000000000000A01',
   'E2Eスレッド利用者A', '[E2E_TEST]返信3のAから', '2026-11-13T00:00:10.000Z', '01M78ZTJC00000000000013703'),
  ('01M7938JW80000000000013714', '01JTE2E1370000000000000C01', '01JTE2E1370000000000000A02',
   'E2Eスレッド利用者B', '[E2E_TEST]返信4のBから', '2026-11-13T00:00:05.000Z', '01M78ZTJC00000000000013704'),
  ('01M7938JW80000000000013715', '01JTE2E1370000000000000C02', '01JTE2E1370000000000000A02',
   'E2Eスレッド利用者B', '[E2E_TEST]返信5のBから', '2026-11-13T00:00:05.000Z', '01M78ZTJC00000000000013705'),
  ('01M7938JW80000000000013716', '01JTE2E1370000000000000C01', '01JTE2E1370000000000000A01',
   'E2Eスレッド利用者A', '[E2E_TEST]返信6のAから', '2026-11-13T00:00:05.000Z', '01M78ZTJC00000000000013706');
