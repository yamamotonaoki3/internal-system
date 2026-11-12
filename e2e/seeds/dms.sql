-- #136 E2E専用（e2e/dms.spec.ts）の架空データ。部署1件・その専用チャンネル1つ（公開。S-05 の参加者からの開始に使う）・社員4人・
-- 無効な社員との DM 1つ（kind='direct'。無効化の前の投稿を1件含む）を入れる。A と B の DM は spec の中で画面から作る。
-- 社員：e2euser_dm_a（A）・e2euser_dm_b（B。外出中で戻り予定を過ぎている）・e2euser_dm_c（第三者）・e2euser_dm_retired（無効。ログインしない）。
-- DM は、このシードの利用者どうしだけで作る（既存の利用者を当事者にしない）。後始末は dms-cleanup.sql（識別子だけで消す）。
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 部署名・チャンネル名は [E2E_TEST]部署136 で始め、社員IDは e2euser_dm_ で始める。本文は [E2E_TEST] で始める。
-- 前提：#136 の migration 0016（rooms.kind に 'direct'）・0017（conversations・conversation_members）が適用済み。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES
  ('01JTE2E1360000000000000D01', '[E2E_TEST]部署136', '[e2e_test]部署136', 1,
   '2026-11-12T00:00:00.000Z', '', 1, '2026-11-12T00:00:00.000Z');

INSERT INTO rooms (id, kind, created_at) VALUES
  ('01JTE2E1360000000000000C01', 'channel', '2026-11-12T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES
  ('01JTE2E1360000000000000C01', '01JTE2E1360000000000000D01', '[E2E_TEST]部署136',
   '[e2e_test]部署136', '', 'public', 'department', NULL, 1,
   '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z', NULL, NULL);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E1360000000000000A01', 'e2euser_dm_a', 'e2euser_dm_a',
  'E2EDM利用者A', 'テスト本名DMA',
  'e2euser_dm_a@example.com', 'e2euser_dm_a@example.com',
  '01JTE2E1360000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

-- B は外出中で、戻り予定（過去の日時）を過ぎている（6-1 AC-1 の超過の表示を確かめる）
INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active,
  status_kind, status_return_at
)
SELECT
  '01JTE2E1360000000000000A02', 'e2euser_dm_b', 'e2euser_dm_b',
  'E2EDM利用者B', 'テスト本名DMB',
  'e2euser_dm_b@example.com', 'e2euser_dm_b@example.com',
  '01JTE2E1360000000000000D01', password_hash, 0, 1,
  'away', '2026-01-01T00:00:00.000Z'
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E1360000000000000A03', 'e2euser_dm_c', 'e2euser_dm_c',
  'E2EDM利用者C', 'テスト本名DMC',
  'e2euser_dm_c@example.com', 'e2euser_dm_c@example.com',
  '01JTE2E1360000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

-- 無効化済みの社員（ログインしない。DM の相手としてだけ使う）
INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active, deactivated_at
)
SELECT
  '01JTE2E1360000000000000A04', 'e2euser_dm_retired', 'e2euser_dm_retired',
  'E2EDM利用者R', 'テスト本名DMR',
  'e2euser_dm_retired@example.com', 'e2euser_dm_retired@example.com',
  '01JTE2E1360000000000000D01', password_hash, 0, 0, '2026-11-11T00:00:00.000Z'
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES
  ('01JTE2E1360000000000000R01', '01JTE2E1360000000000000A01', 'role_member', 'company', NULL, '2026-11-12T00:00:00.000Z'),
  ('01JTE2E1360000000000000R02', '01JTE2E1360000000000000A02', 'role_member', 'company', NULL, '2026-11-12T00:00:00.000Z'),
  ('01JTE2E1360000000000000R03', '01JTE2E1360000000000000A03', 'role_member', 'company', NULL, '2026-11-12T00:00:00.000Z'),
  ('01JTE2E1360000000000000R04', '01JTE2E1360000000000000A04', 'role_member', 'company', NULL, '2026-11-12T00:00:00.000Z');

-- S-05 の参加者一覧から DM を始めるため、A と B をチャンネルの参加者にする
INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E1360000000000000C01', '01JTE2E1360000000000000A01', '2026-11-12T00:00:00.000Z'),
  ('01JTE2E1360000000000000C01', '01JTE2E1360000000000000A02', '2026-11-12T00:00:00.000Z');

-- A と無効な社員（R）の DM。direct_key は2人の利用者IDを小さい順に ':' でつないだもの。R が無効化の前に送った投稿を1件入れる
INSERT INTO rooms (id, kind, created_at) VALUES
  ('01JTE2E1360000000000000M01', 'direct', '2026-11-10T00:00:00.000Z');

INSERT INTO conversations (room_id, direct_key, created_at) VALUES
  ('01JTE2E1360000000000000M01',
   '01JTE2E1360000000000000A01:01JTE2E1360000000000000A04',
   '2026-11-10T00:00:00.000Z');

INSERT INTO conversation_members (conversation_id, user_id) VALUES
  ('01JTE2E1360000000000000M01', '01JTE2E1360000000000000A01'),
  ('01JTE2E1360000000000000M01', '01JTE2E1360000000000000A04');

INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at) VALUES
  ('01JTE2E1360000000000000G01', '01JTE2E1360000000000000M01', '01JTE2E1360000000000000A04',
   'E2EDM利用者R', '[E2E_TEST]無効化の前の投稿', '2026-11-10T00:00:00.000Z');
