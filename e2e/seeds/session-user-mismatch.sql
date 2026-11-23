-- #298 E2E専用（e2e/session-user-mismatch.spec.ts）。架空の部署1件・社員2人・取引先1件、進行中の案件1件を入れる。
--   e2euser_mismatch_001：画面の利用者 A（同じコンテキストの2つのページで開く）
--   e2euser_mismatch_002：別のタブでログインし直す利用者 B（API のログインで Cookie を B にする）
-- A・B とも案件の参加者にする（読み込み直した後の文書で、B として S-17 が出る。資格の喪失は起きない）。
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない（login.sql が先に流れている前提）。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 識別子：社員ID e2euser_mismatch_、部署名 [E2E_TEST]部署298、取引先名 テスト商事食い違い [E2E_TEST]（コード QMM。既存の E2E のシードと重ならない）、
-- 件名・説明に [E2E_TEST] を付ける。案件番号・案件専用チャンネルの名前は QMM で始める。
-- session-user-mismatch-cleanup.sql でこの識別子だけを消す。全体管理者・部署のオーナーは入れない。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES (
  '01JTE2E00000000000M0002298', '[E2E_TEST]部署298', '[e2e_test]部署298', 1,
  '2026-11-24T00:00:00.000Z', '', 1, '2026-11-24T00:00:00.000Z'
);

INSERT INTO clients (id, code, name, name_normalized, is_active, version, created_at, updated_at)
VALUES (
  '01JTE2E00000000000M0003298', 'QMM', 'テスト商事食い違い [E2E_TEST]', 'テスト商事食い違い [e2e_test]', 1, 1,
  '2026-11-24T00:00:00.000Z', '2026-11-24T00:00:00.000Z'
);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000M0005298', 'e2euser_mismatch_001', 'e2euser_mismatch_001',
  'E2E食い違いA', 'テスト本名食い違いA',
  'e2euser_mismatch_001@example.com', 'e2euser_mismatch_001@example.com',
  '01JTE2E00000000000M0002298', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000M0006298', 'e2euser_mismatch_002', 'e2euser_mismatch_002',
  'E2E食い違いB', 'テスト本名食い違いB',
  'e2euser_mismatch_002@example.com', 'e2euser_mismatch_002@example.com',
  '01JTE2E00000000000M0002298', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

-- 案件の閲覧・やり取りは、一般のロールが持つ（e2e/seeds/case-access-loss-cross-tab.sql と同じ）
INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES
  ('01JTE2E00000000000M0008298', '01JTE2E00000000000M0005298', 'role_member', 'company', NULL, '2026-11-24T00:00:00.000Z'),
  ('01JTE2E00000000000M0009298', '01JTE2E00000000000M0006298', 'role_member', 'company', NULL, '2026-11-24T00:00:00.000Z');

-- 部屋 → 案件専用チャンネル（purpose=case・private・部署なし）→ 案件 → 担当部署 → 参加の順に作る（外部キーの順）
INSERT INTO rooms (id, kind, created_at) VALUES
  ('01JTE2E00000000000M0010298', 'channel', '2026-11-24T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES
  ('01JTE2E00000000000M0010298', NULL, 'QMM-261124-0001', 'case:qmm-261124-0001', '', 'private', 'case',
   '01JTE2E00000000000M0006298', 1, '2026-11-24T00:00:00.000Z', '2026-11-24T00:00:00.000Z', NULL, NULL);

-- request_id は外部キーでない（申請の行は作らない）。この E2E だけの値にする
INSERT INTO cases (
  id, case_number, number_client_id, client_id, channel_id, request_id, title, description, due_date,
  status, created_by, approved_by, version, created_at, updated_at
) VALUES
  ('01JTE2E00000000000M0011298', 'QMM-261124-0001', '01JTE2E00000000000M0003298', '01JTE2E00000000000M0003298',
   '01JTE2E00000000000M0010298', '01JTE2E00000000000M0012298', '[E2E_TEST]食い違いの案件', '[E2E_TEST]食い違いの説明',
   NULL, 'active', '01JTE2E00000000000M0006298', '01JTE2E00000000000M0006298', 1,
   '2026-11-24T00:00:00.000Z', '2026-11-24T00:00:00.000Z');

INSERT INTO case_departments (case_id, department_id) VALUES
  ('01JTE2E00000000000M0011298', '01JTE2E00000000000M0002298');

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E00000000000M0010298', '01JTE2E00000000000M0006298', '2026-11-24T00:00:00.000Z'),
  ('01JTE2E00000000000M0010298', '01JTE2E00000000000M0005298', '2026-11-24T00:00:01.000Z');
