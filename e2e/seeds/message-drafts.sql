-- #239 E2E専用（e2e/message-drafts.spec.ts）の架空データ。メッセージ入力欄の下書きの端末への一時保存（1-1 AC-4・C-82・C-117）を確かめる。
-- 部署1件・社員2人（e2euser_draft_a（A）・e2euser_draft_b（B））・公開チャンネル2つ（A・B とも参加）を入れる。
--   C01 [E2E_TEST]部署239の下書き1：B の投稿20件（スマホ幅・低い画面で、ページが縦にスクロールする高さにするため）
--   C02 [E2E_TEST]部署239の下書き2：投稿なし
-- 後始末は message-drafts-cleanup.sql（社員ID e2euser_draft_・部署名 [E2E_TEST]部署239 だけ）。
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。本文は [E2E_TEST] で始める。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES
  ('01JTE2E2390000000000000D01', '[E2E_TEST]部署239', '[e2e_test]部署239', 1,
   '2026-11-13T00:00:00.000Z', '', 1, '2026-11-13T00:00:00.000Z');

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E2390000000000000A01', 'e2euser_draft_a', 'e2euser_draft_a',
  'E2E下書き利用者A', 'テスト本名下書きA',
  'e2euser_draft_a@example.com', 'e2euser_draft_a@example.com',
  '01JTE2E2390000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E2390000000000000A02', 'e2euser_draft_b', 'e2euser_draft_b',
  'E2E下書き利用者B', 'テスト本名下書きB',
  'e2euser_draft_b@example.com', 'e2euser_draft_b@example.com',
  '01JTE2E2390000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES
  ('01JTE2E2390000000000000R01', '01JTE2E2390000000000000A01', 'role_member', 'company', NULL, '2026-11-13T00:00:00.000Z'),
  ('01JTE2E2390000000000000R02', '01JTE2E2390000000000000A02', 'role_member', 'company', NULL, '2026-11-13T00:00:00.000Z');

INSERT INTO rooms (id, kind, created_at) VALUES
  ('01JTE2E2390000000000000C01', 'channel', '2026-11-12T00:00:00.000Z'),
  ('01JTE2E2390000000000000C02', 'channel', '2026-11-12T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES
  ('01JTE2E2390000000000000C01', '01JTE2E2390000000000000D01', '[E2E_TEST]部署239の下書き1',
   '[e2e_test]部署239の下書き1', '', 'public', 'normal', NULL, 1,
   '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z', NULL, NULL),
  ('01JTE2E2390000000000000C02', '01JTE2E2390000000000000D01', '[E2E_TEST]部署239の下書き2',
   '[e2e_test]部署239の下書き2', '', 'public', 'normal', NULL, 1,
   '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z', NULL, NULL);

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E2390000000000000C01', '01JTE2E2390000000000000A01', '2026-11-12T00:00:00.000Z'),
  ('01JTE2E2390000000000000C01', '01JTE2E2390000000000000A02', '2026-11-12T00:00:00.000Z'),
  ('01JTE2E2390000000000000C02', '01JTE2E2390000000000000A01', '2026-11-12T00:00:00.000Z'),
  ('01JTE2E2390000000000000C02', '01JTE2E2390000000000000A02', '2026-11-12T00:00:00.000Z');

-- C01：B の投稿20件。ID は ULID の形（時刻部分 2026-11-12T23:00:00.000Z = 01M78ZTJC0）で、後ろの16桁を連番にして昇順にする
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 20)
INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at)
SELECT '01M78ZTJC0' || printf('%016d', 2390000 + n), '01JTE2E2390000000000000C01', '01JTE2E2390000000000000A02',
  'E2E下書き利用者B', '[E2E_TEST]下書きの確認用の投稿' || n, '2026-11-12T23:00:00.000Z'
FROM seq;
