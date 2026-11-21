-- #155（155-A）E2E専用（e2e/search.spec.ts）の架空データ。メッセージの検索（4-1・S-15）を確かめる。
-- 部署1件（[E2E_TEST]部署155）・取引先1件・社員3人・公開チャンネル1つ・非公開チャンネル1つ・A と C の DM 1つ・A が参加する案件1件（専用チャンネル）を入れる。
--   e2euser_search155_a（A）：すべての部屋の参加者（公開・非公開・DM・案件）。検索・投稿・編集・削除をする本人
--   e2euser_search155_b（B）：どの部屋にも参加していない。公開チャンネルのメッセージだけが検索に出ることを確かめる別の利用者
--   e2euser_search155_c（C）：A との DM の相手
-- 部屋ごとの本文は、互いに区別できる語にする（公開の語・非公開の語・DMの語・案件の語）。共通の語は「検索155共通」。
-- 155-B：各部屋の投稿に、投稿済みの添付を1件ずつ結ぶ（名前は e2e155b-見積-0001.txt〜0004.txt。互いに含まれず、本文にも無い語）。
--   公開チャンネルには、255文字の名前の添付10件を結んだ投稿（名前は e2e155b長名00〜09 で始まる）も入れる（行の中で折り返すことの確認）。
--   添付の行の ID は 01JTE2E155B で始め、R2 の実体は置かない（検索の結果からファイルを開かないため）。索引は search-reindex で登録する。
-- 検索の索引（search_documents・search_fts）は、このシードの後に `node scripts/db-local.ts test search-reindex` で作る（spec の beforeAll。D-9）。
-- 後始末は search-cleanup.sql（社員ID e2euser_search155_・部署名 [E2E_TEST]部署155・取引先名 テスト商事検索 [E2E_TEST]・下の固定の部屋のIDと、その索引の行だけ）。
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES
  ('01JTE2E1550000000000000D01', '[E2E_TEST]部署155', '[e2e_test]部署155', 1,
   '2026-11-20T00:00:00.000Z', '', 1, '2026-11-20T00:00:00.000Z');

INSERT INTO clients (id, code, name, name_normalized, is_active, version, created_at, updated_at)
VALUES (
  '01JTE2E1550000000000000Q01', 'QSE', 'テスト商事検索 [E2E_TEST]', 'テスト商事検索 [e2e_test]', 1, 1,
  '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z'
);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E1550000000000000A01', 'e2euser_search155_a', 'e2euser_search155_a',
  'E2E検索利用者A', 'テスト本名検索A',
  'e2euser_search155_a@example.com', 'e2euser_search155_a@example.com',
  '01JTE2E1550000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E1550000000000000A02', 'e2euser_search155_b', 'e2euser_search155_b',
  'E2E検索利用者B', 'テスト本名検索B',
  'e2euser_search155_b@example.com', 'e2euser_search155_b@example.com',
  '01JTE2E1550000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E1550000000000000A03', 'e2euser_search155_c', 'e2euser_search155_c',
  'E2E検索利用者C', 'テスト本名検索C',
  'e2euser_search155_c@example.com', 'e2euser_search155_c@example.com',
  '01JTE2E1550000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

-- 検索（perm.search.message）・DM の閲覧・案件の閲覧は、一般のロールが持つ
INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES
  ('01JTE2E1550000000000000R01', '01JTE2E1550000000000000A01', 'role_member', 'company', NULL, '2026-11-20T00:00:00.000Z'),
  ('01JTE2E1550000000000000R02', '01JTE2E1550000000000000A02', 'role_member', 'company', NULL, '2026-11-20T00:00:00.000Z'),
  ('01JTE2E1550000000000000R03', '01JTE2E1550000000000000A03', 'role_member', 'company', NULL, '2026-11-20T00:00:00.000Z');

INSERT INTO rooms (id, kind, created_at) VALUES
  ('01JTE2E1550000000000000C01', 'channel', '2026-11-20T00:00:00.000Z'),
  ('01JTE2E1550000000000000C02', 'channel', '2026-11-20T00:00:00.000Z'),
  ('01JTE2E1550000000000000K01', 'channel', '2026-11-20T00:00:00.000Z'),
  ('01JTE2E1550000000000000M01', 'direct', '2026-11-20T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES
  ('01JTE2E1550000000000000C01', '01JTE2E1550000000000000D01', '[E2E_TEST]部署155の公開',
   '[e2e_test]部署155の公開', '', 'public', 'normal', NULL, 1,
   '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z', NULL, NULL),
  ('01JTE2E1550000000000000C02', '01JTE2E1550000000000000D01', '[E2E_TEST]部署155の非公開',
   '[e2e_test]部署155の非公開', '', 'private', 'normal', NULL, 1,
   '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z', NULL, NULL),
  ('01JTE2E1550000000000000K01', NULL, 'QSE-261120-0001',
   'case:qse-261120-0001', '', 'private', 'case', '01JTE2E1550000000000000A01', 1,
   '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z', NULL, NULL);

INSERT INTO cases (
  id, case_number, number_client_id, client_id, channel_id, request_id, title, description, due_date,
  status, created_by, approved_by, version, created_at, updated_at
) VALUES (
  '01JTE2E1550000000000000S01', 'QSE-261120-0001', '01JTE2E1550000000000000Q01', '01JTE2E1550000000000000Q01',
  '01JTE2E1550000000000000K01', '01JTE2E1550000000000000S02', '[E2E_TEST]検索の案件', '[E2E_TEST]検索の案件の説明',
  NULL, 'active', '01JTE2E1550000000000000A01', '01JTE2E1550000000000000A01', 1,
  '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z'
);

INSERT INTO case_departments (case_id, department_id)
VALUES ('01JTE2E1550000000000000S01', '01JTE2E1550000000000000D01');

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E1550000000000000C01', '01JTE2E1550000000000000A01', '2026-11-20T00:00:00.000Z'),
  ('01JTE2E1550000000000000C02', '01JTE2E1550000000000000A01', '2026-11-20T00:00:00.000Z'),
  ('01JTE2E1550000000000000K01', '01JTE2E1550000000000000A01', '2026-11-20T00:00:00.000Z');

-- A と C の DM。direct_key は2人の利用者IDを小さい順に ':' でつないだもの
INSERT INTO conversations (room_id, direct_key, created_at) VALUES
  ('01JTE2E1550000000000000M01',
   '01JTE2E1550000000000000A01:01JTE2E1550000000000000A03',
   '2026-11-20T00:00:00.000Z');
INSERT INTO conversation_members (conversation_id, user_id) VALUES
  ('01JTE2E1550000000000000M01', '01JTE2E1550000000000000A01'),
  ('01JTE2E1550000000000000M01', '01JTE2E1550000000000000A03');

-- 投稿。ID は ULID の形（時刻部分 2026-11-12T23:00:00.000Z = 01M78ZTJC0）で、後ろの16桁を連番にして昇順にする
INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at) VALUES
  ('01M78ZTJC00000000001550001', '01JTE2E1550000000000000C01', '01JTE2E1550000000000000A01',
   'E2E検索利用者A', '[E2E_TEST]検索155共通・開放室の語句', '2026-11-12T23:00:00.000Z'),
  ('01M78ZTJC00000000001550002', '01JTE2E1550000000000000C02', '01JTE2E1550000000000000A01',
   'E2E検索利用者A', '[E2E_TEST]検索155共通・非公開室の語句', '2026-11-12T23:00:00.000Z'),
  ('01M78ZTJC00000000001550003', '01JTE2E1550000000000000M01', '01JTE2E1550000000000000A03',
   'E2E検索利用者C', '[E2E_TEST]検索155共通・直接対話の語句', '2026-11-12T23:00:00.000Z'),
  ('01M78ZTJC00000000001550004', '01JTE2E1550000000000000K01', '01JTE2E1550000000000000A01',
   'E2E検索利用者A', '[E2E_TEST]検索155共通・案件室の語句', '2026-11-12T23:00:00.000Z');

-- 155-B：添付（投稿済み）。R2 の実体は置かない
INSERT INTO message_attachments (id, room_id, thread_parent_id, message_id, uploader_id, storage_key, original_name, kind, content_type, size_bytes, created_at) VALUES
  ('01JTE2E155B000000000000001', '01JTE2E1550000000000000C01', NULL, '01M78ZTJC00000000001550001', '01JTE2E1550000000000000A01',
   'attachments/01JTE2E155B000000000000001', 'e2e155b-見積-0001.txt', 'document', 'text/plain; charset=utf-8', 10, '2026-11-12T22:59:00.000Z'),
  ('01JTE2E155B000000000000002', '01JTE2E1550000000000000C02', NULL, '01M78ZTJC00000000001550002', '01JTE2E1550000000000000A01',
   'attachments/01JTE2E155B000000000000002', 'e2e155b-見積-0002.txt', 'document', 'text/plain; charset=utf-8', 10, '2026-11-12T22:59:00.000Z'),
  ('01JTE2E155B000000000000003', '01JTE2E1550000000000000M01', NULL, '01M78ZTJC00000000001550003', '01JTE2E1550000000000000A03',
   'attachments/01JTE2E155B000000000000003', 'e2e155b-見積-0003.txt', 'document', 'text/plain; charset=utf-8', 10, '2026-11-12T22:59:00.000Z'),
  ('01JTE2E155B000000000000004', '01JTE2E1550000000000000K01', NULL, '01M78ZTJC00000000001550004', '01JTE2E1550000000000000A01',
   'attachments/01JTE2E155B000000000000004', 'e2e155b-見積-0004.txt', 'document', 'text/plain; charset=utf-8', 10, '2026-11-12T22:59:00.000Z');

-- 155-B：255文字の名前の添付10件を結んだ投稿（公開チャンネル）
INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at) VALUES
  ('01M78ZTJC00000000001550005', '01JTE2E1550000000000000C01', '01JTE2E1550000000000000A01',
   'E2E検索利用者A', '[E2E_TEST]検索155長い名前の行', '2026-11-12T23:00:00.000Z');
INSERT INTO message_attachments (id, room_id, thread_parent_id, message_id, uploader_id, storage_key, original_name, kind, content_type, size_bytes, created_at)
WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 9)
SELECT
  '01JTE2E155B0000000000001' || printf('%02d', i), '01JTE2E1550000000000000C01', NULL, '01M78ZTJC00000000001550005', '01JTE2E1550000000000000A01',
  'attachments/01JTE2E155B0000000000001' || printf('%02d', i),
  'e2e155b長名' || printf('%02d', i) || substr(replace(hex(zeroblob(240)), '0', '長'), 1, 240) || '.txt',
  'document', 'text/plain; charset=utf-8', 10, '2026-11-12T22:59:00.000Z'
FROM n;
