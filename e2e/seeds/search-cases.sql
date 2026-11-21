-- #155（155-C）E2E専用（e2e/search-cases.spec.ts）の架空データ。案件の検索（4-2 AC-1〜AC-3・S-15 の案件の区画）を確かめる。
-- 部署1件（[E2E_TEST]部署155C）・取引先1件（E2E検索取引先155C [E2E_TEST]。コード QSK）・社員2人・案件2件（専用チャンネルつき）を入れる。
--   e2euser_search155c_a（A）：案件 S01 の参加者。S02 には参加していない。検索・再編集をする本人
--   e2euser_search155c_b（B）：案件 S02 の参加者
-- 件名は「[E2E_TEST]155C若草会館の改修」（S01）と「[E2E_TEST]155C若草会館の点検」（S02）。互いに含まれず、語「若草会館」は両方に含まれる。
-- 案件番号は QSK-261121-0001・0002（ほかの E2E のシードの番号と重ならない）。S02 の説明は参加者だけが見られる（A の画面に出ない）。
-- 件名の索引（search_documents の kind = 'case_title'）は、このシードの後に `node scripts/db-local.ts test search-reindex` で作る（spec の beforeAll。
--   利用者の決定 2026-11-21：既存の案件の索引は、メッセージと同じ登録の処理で作る）。
-- 後始末は search-cases-cleanup.sql（社員ID e2euser_search155c_・部署名 [E2E_TEST]部署155C・取引先名 E2E検索取引先155C [E2E_TEST]・
--   下の固定の ID と、その件名の索引の行だけ）。
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- ID は 26 文字で、I・L・O・U を使わない（01JTE2E155C で始める）。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES
  ('01JTE2E155C000000000000D01', '[E2E_TEST]部署155C', '[e2e_test]部署155c', 1,
   '2026-11-21T00:00:00.000Z', '', 1, '2026-11-21T00:00:00.000Z');

INSERT INTO clients (id, code, name, name_normalized, is_active, version, created_at, updated_at)
VALUES (
  '01JTE2E155C000000000000Q01', 'QSK', 'E2E検索取引先155C [E2E_TEST]', 'e2e検索取引先155c [e2e_test]', 1, 1,
  '2026-11-21T00:00:00.000Z', '2026-11-21T00:00:00.000Z'
);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E155C000000000000A01', 'e2euser_search155c_a', 'e2euser_search155c_a',
  'E2E案件検索利用者A', 'テスト本名案件検索A',
  'e2euser_search155c_a@example.com', 'e2euser_search155c_a@example.com',
  '01JTE2E155C000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E155C000000000000A02', 'e2euser_search155c_b', 'e2euser_search155c_b',
  'E2E案件検索利用者B', 'テスト本名案件検索B',
  'e2euser_search155c_b@example.com', 'e2euser_search155c_b@example.com',
  '01JTE2E155C000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

-- 案件の概要の閲覧（perm.case.summary.view）・再編集は、一般のロールが持つ
INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES
  ('01JTE2E155C000000000000R01', '01JTE2E155C000000000000A01', 'role_member', 'company', NULL, '2026-11-21T00:00:00.000Z'),
  ('01JTE2E155C000000000000R02', '01JTE2E155C000000000000A02', 'role_member', 'company', NULL, '2026-11-21T00:00:00.000Z');

INSERT INTO rooms (id, kind, created_at) VALUES
  ('01JTE2E155C000000000000K01', 'channel', '2026-11-21T00:00:00.000Z'),
  ('01JTE2E155C000000000000K02', 'channel', '2026-11-21T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES
  ('01JTE2E155C000000000000K01', NULL, 'QSK-261121-0001',
   'case:qsk-261121-0001', '', 'private', 'case', '01JTE2E155C000000000000A01', 1,
   '2026-11-21T00:00:00.000Z', '2026-11-21T00:00:00.000Z', NULL, NULL),
  ('01JTE2E155C000000000000K02', NULL, 'QSK-261121-0002',
   'case:qsk-261121-0002', '', 'private', 'case', '01JTE2E155C000000000000A02', 1,
   '2026-11-21T00:00:00.000Z', '2026-11-21T00:00:00.000Z', NULL, NULL);

INSERT INTO cases (
  id, case_number, number_client_id, client_id, channel_id, request_id, title, description, due_date,
  status, created_by, approved_by, version, created_at, updated_at
) VALUES
  ('01JTE2E155C000000000000S01', 'QSK-261121-0001', '01JTE2E155C000000000000Q01', '01JTE2E155C000000000000Q01',
   '01JTE2E155C000000000000K01', '01JTE2E155C000000000000S11', '[E2E_TEST]155C若草会館の改修', '[E2E_TEST]155C改修の説明',
   NULL, 'active', '01JTE2E155C000000000000A01', '01JTE2E155C000000000000A01', 1,
   '2026-11-21T00:00:00.000Z', '2026-11-21T00:00:00.000Z'),
  ('01JTE2E155C000000000000S02', 'QSK-261121-0002', '01JTE2E155C000000000000Q01', '01JTE2E155C000000000000Q01',
   '01JTE2E155C000000000000K02', '01JTE2E155C000000000000S12', '[E2E_TEST]155C若草会館の点検', '[E2E_TEST]155C参加者だけの点検の説明',
   NULL, 'active', '01JTE2E155C000000000000A02', '01JTE2E155C000000000000A02', 1,
   '2026-11-21T00:01:00.000Z', '2026-11-21T00:01:00.000Z');

INSERT INTO case_departments (case_id, department_id) VALUES
  ('01JTE2E155C000000000000S01', '01JTE2E155C000000000000D01'),
  ('01JTE2E155C000000000000S02', '01JTE2E155C000000000000D01');

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E155C000000000000K01', '01JTE2E155C000000000000A01', '2026-11-21T00:00:00.000Z'),
  ('01JTE2E155C000000000000K02', '01JTE2E155C000000000000A02', '2026-11-21T00:00:00.000Z');
