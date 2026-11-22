-- #341 E2E専用（e2e/case-access-loss-cross-tab.spec.ts）。架空の部署1件・社員2人・取引先1件、進行中の案件2件を入れる。
--   e2euser_xtab_a：2件の案件の参加者（同じコンテキストの3つのページで開く。B に外される）
--   e2euser_xtab_b：2件の案件の作成者で、一般の参加者（A を参加者から外す人）
-- 案件ごとに使う場面を分ける：0001 は T-E1（合図で読み込み直す）、0002 は T-E2（対照。合図の経路を止める）。
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない（login.sql が先に流れている前提）。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 識別子：社員ID e2euser_xtab_、部署名 [E2E_TEST]部署341、取引先名 テスト商事別タブ [E2E_TEST]（コード QKZ。既存の E2E のシードと重ならない）、
-- 件名・説明に [E2E_TEST] を付ける。案件番号・案件専用チャンネルの名前は QKZ で始める。
-- case-access-loss-cross-tab-cleanup.sql でこの識別子だけを消す。全体管理者・部署のオーナーは入れない。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES (
  '01JTE2E00000000000X0002341', '[E2E_TEST]部署341', '[e2e_test]部署341', 1,
  '2026-11-23T00:00:00.000Z', '', 1, '2026-11-23T00:00:00.000Z'
);

INSERT INTO clients (id, code, name, name_normalized, is_active, version, created_at, updated_at)
VALUES (
  '01JTE2E00000000000X0003341', 'QKZ', 'テスト商事別タブ [E2E_TEST]', 'テスト商事別タブ [e2e_test]', 1, 1,
  '2026-11-23T00:00:00.000Z', '2026-11-23T00:00:00.000Z'
);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000X0005341', 'e2euser_xtab_a', 'e2euser_xtab_a',
  'E2E別タブA', 'テスト本名別タブA',
  'e2euser_xtab_a@example.com', 'e2euser_xtab_a@example.com',
  '01JTE2E00000000000X0002341', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000X0006341', 'e2euser_xtab_b', 'e2euser_xtab_b',
  'E2E別タブB', 'テスト本名別タブB',
  'e2euser_xtab_b@example.com', 'e2euser_xtab_b@example.com',
  '01JTE2E00000000000X0002341', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

-- 案件の閲覧・やり取りは、一般のロールが持つ（e2e/seeds/case-access-loss-reload.sql と同じ）
INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES
  ('01JTE2E00000000000X0008341', '01JTE2E00000000000X0005341', 'role_member', 'company', NULL, '2026-11-23T00:00:00.000Z'),
  ('01JTE2E00000000000X0009341', '01JTE2E00000000000X0006341', 'role_member', 'company', NULL, '2026-11-23T00:00:00.000Z');

-- 部屋 → 案件専用チャンネル（purpose=case・private・部署なし）→ 案件 → 担当部署 → 参加の順に作る（外部キーの順）
INSERT INTO rooms (id, kind, created_at) VALUES
  ('01JTE2E00000000000X0010341', 'channel', '2026-11-23T00:00:00.000Z'),
  ('01JTE2E00000000000X0020341', 'channel', '2026-11-23T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES
  ('01JTE2E00000000000X0010341', NULL, 'QKZ-261123-0001', 'case:qkz-261123-0001', '', 'private', 'case',
   '01JTE2E00000000000X0006341', 1, '2026-11-23T00:00:00.000Z', '2026-11-23T00:00:00.000Z', NULL, NULL),
  ('01JTE2E00000000000X0020341', NULL, 'QKZ-261123-0002', 'case:qkz-261123-0002', '', 'private', 'case',
   '01JTE2E00000000000X0006341', 1, '2026-11-23T00:00:00.000Z', '2026-11-23T00:00:00.000Z', NULL, NULL);

-- request_id は外部キーでない（申請の行は作らない）。この E2E だけの値にする
INSERT INTO cases (
  id, case_number, number_client_id, client_id, channel_id, request_id, title, description, due_date,
  status, created_by, approved_by, version, created_at, updated_at
) VALUES
  ('01JTE2E00000000000X0011341', 'QKZ-261123-0001', '01JTE2E00000000000X0003341', '01JTE2E00000000000X0003341',
   '01JTE2E00000000000X0010341', '01JTE2E00000000000X0012341', '[E2E_TEST]別タブの案件1', '[E2E_TEST]別タブの説明1',
   NULL, 'active', '01JTE2E00000000000X0006341', '01JTE2E00000000000X0006341', 1,
   '2026-11-23T00:00:00.000Z', '2026-11-23T00:00:00.000Z'),
  ('01JTE2E00000000000X0021341', 'QKZ-261123-0002', '01JTE2E00000000000X0003341', '01JTE2E00000000000X0003341',
   '01JTE2E00000000000X0020341', '01JTE2E00000000000X0022341', '[E2E_TEST]別タブの案件2', '[E2E_TEST]別タブの説明2',
   NULL, 'active', '01JTE2E00000000000X0006341', '01JTE2E00000000000X0006341', 1,
   '2026-11-23T00:00:00.000Z', '2026-11-23T00:00:00.000Z');

INSERT INTO case_departments (case_id, department_id) VALUES
  ('01JTE2E00000000000X0011341', '01JTE2E00000000000X0002341'),
  ('01JTE2E00000000000X0021341', '01JTE2E00000000000X0002341');

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E00000000000X0010341', '01JTE2E00000000000X0006341', '2026-11-23T00:00:00.000Z'),
  ('01JTE2E00000000000X0010341', '01JTE2E00000000000X0005341', '2026-11-23T00:00:01.000Z'),
  ('01JTE2E00000000000X0020341', '01JTE2E00000000000X0006341', '2026-11-23T00:00:00.000Z'),
  ('01JTE2E00000000000X0020341', '01JTE2E00000000000X0005341', '2026-11-23T00:00:01.000Z');
