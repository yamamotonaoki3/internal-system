-- #138 E2E専用（e2e/reactions.spec.ts）の架空データ。リアクション・スタンプ（1-7 AC-1〜AC-5、1-4 AC-6）を確かめる。
-- 部署1件（[E2E_TEST] リアクション）・社員2人（e2euser_reaction_a（A）・e2euser_reaction_b（B））・公開チャンネル2つを入れる。
--   C01 [E2E_TEST]リアクションの部屋 ：A・B が参加
--         M01 B の投稿（リアクションなし。A・B が付け外しする）
--         M02 A の投稿（自分の投稿にも付けられる）
--         M03 B の投稿＋ B の返信 R01（スレッドの返信へのリアクション）
--   C02 [E2E_TEST]リアクションの未参加 ：B だけが参加（A は未参加の公開チャンネル。A は読めるが付けられない）
--         M04 B の投稿。B が 👍 を付けている（A の画面では読み取り専用のチップ）
-- メッセージの ID は ULID の形で、時刻部分を 親 2026-11-12T23:00:00.000Z（01M78ZTJC0）・返信 2026-11-13T00:00:05.000Z（01M7938JW8）にそろえ、後ろを連番にして昇順にする（threads.sql と同じ形）。
-- 後始末は reactions-cleanup.sql（社員ID e2euser_reaction_・部署名 [E2E_TEST] リアクション と、その部屋のメッセージ・リアクションだけ）。
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。本文は [E2E_TEST] で始める。
-- 前提：#138 の migration 0022（message_reactions）が適用済み。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES
  ('01JTE2E1380000000000000D01', '[E2E_TEST] リアクション', '[e2e_test] リアクション', 1,
   '2026-11-16T00:00:00.000Z', '', 1, '2026-11-16T00:00:00.000Z');

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E1380000000000000A01', 'e2euser_reaction_a', 'e2euser_reaction_a',
  'E2Eリアクション利用者A', 'テスト本名リアクションA',
  'e2euser_reaction_a@example.com', 'e2euser_reaction_a@example.com',
  '01JTE2E1380000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E1380000000000000A02', 'e2euser_reaction_b', 'e2euser_reaction_b',
  'E2Eリアクション利用者B', 'テスト本名リアクションB',
  'e2euser_reaction_b@example.com', 'e2euser_reaction_b@example.com',
  '01JTE2E1380000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

-- リアクション（perm.reaction.manage.own）・返信・閲覧は、一般のロールが持つ
INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES
  ('01JTE2E1380000000000000R01', '01JTE2E1380000000000000A01', 'role_member', 'company', NULL, '2026-11-16T00:00:00.000Z'),
  ('01JTE2E1380000000000000R02', '01JTE2E1380000000000000A02', 'role_member', 'company', NULL, '2026-11-16T00:00:00.000Z');

INSERT INTO rooms (id, kind, created_at) VALUES
  ('01JTE2E1380000000000000C01', 'channel', '2026-11-16T00:00:00.000Z'),
  ('01JTE2E1380000000000000C02', 'channel', '2026-11-16T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES
  ('01JTE2E1380000000000000C01', '01JTE2E1380000000000000D01', '[E2E_TEST]リアクションの部屋',
   '[e2e_test]リアクションの部屋', '', 'public', 'normal', NULL, 1,
   '2026-11-16T00:00:00.000Z', '2026-11-16T00:00:00.000Z', NULL, NULL),
  ('01JTE2E1380000000000000C02', '01JTE2E1380000000000000D01', '[E2E_TEST]リアクションの未参加',
   '[e2e_test]リアクションの未参加', '', 'public', 'normal', NULL, 1,
   '2026-11-16T00:00:00.000Z', '2026-11-16T00:00:00.000Z', NULL, NULL);

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E1380000000000000C01', '01JTE2E1380000000000000A01', '2026-11-16T00:00:00.000Z'),
  ('01JTE2E1380000000000000C01', '01JTE2E1380000000000000A02', '2026-11-16T00:00:00.000Z'),
  ('01JTE2E1380000000000000C02', '01JTE2E1380000000000000A02', '2026-11-16T00:00:00.000Z');

-- 親の投稿（parent_message_id は NULL のまま）
INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at) VALUES
  ('01M78ZTJC00000000000013801', '01JTE2E1380000000000000C01', '01JTE2E1380000000000000A02',
   'E2Eリアクション利用者B', '[E2E_TEST]リアクション対象1', '2026-11-12T23:00:00.000Z'),
  ('01M78ZTJC00000000000013802', '01JTE2E1380000000000000C01', '01JTE2E1380000000000000A01',
   'E2Eリアクション利用者A', '[E2E_TEST]リアクション対象2のAの投稿', '2026-11-12T23:00:00.000Z'),
  ('01M78ZTJC00000000000013803', '01JTE2E1380000000000000C01', '01JTE2E1380000000000000A02',
   'E2Eリアクション利用者B', '[E2E_TEST]リアクション対象3のスレッドの親', '2026-11-12T23:00:00.000Z'),
  ('01M78ZTJC00000000000013804', '01JTE2E1380000000000000C02', '01JTE2E1380000000000000A02',
   'E2Eリアクション利用者B', '[E2E_TEST]リアクション対象4の未参加の部屋', '2026-11-12T23:00:00.000Z');

-- 返信（親と同じ部屋）
INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at, parent_message_id) VALUES
  ('01M7938JW80000000000013811', '01JTE2E1380000000000000C01', '01JTE2E1380000000000000A02',
   'E2Eリアクション利用者B', '[E2E_TEST]リアクション対象の返信', '2026-11-13T00:00:05.000Z',
   '01M78ZTJC00000000000013803');

-- B が M04（A は未参加の部屋）に 👍 を付けている
INSERT INTO message_reactions (message_id, user_id, kind, value, created_at) VALUES
  ('01M78ZTJC00000000000013804', '01JTE2E1380000000000000A02', 'emoji', '👍', '2026-11-13T00:00:10.000Z');
