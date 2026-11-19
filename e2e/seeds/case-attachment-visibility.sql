-- #148（148-B-2）E2E専用（e2e/case-attachment-visibility.spec.ts）。架空の部署1件・社員4人・取引先1件と、進行中の案件1件を入れる。
--   e2euser_case148b2_uploader：案件の参加者（一般。添付して、自分の添付の公開範囲を変える人）
--   e2euser_case148b2_member：案件の参加者（一般。ほかの人の添付は変えられない）
--   e2euser_case148b2_owner：担当部署のオーナーで、案件の参加者（ほかの人の添付も変えられる）
--   e2euser_case148b2_outsider：案件に参加していない社員（添付の取得が 404）
-- 添付はシードで入れず、画面からアップロードする。パスワードのハッシュは架空ログインfixture（e2euser_login_001）の行から参照する。
-- 識別子：社員ID e2euser_case148b2_、部署名 [E2E_TEST]部署148B2、取引先名 テスト商事公開範囲 [E2E_TEST]（コード QKR）、件名・説明に [E2E_TEST]。
-- case-attachment-visibility-cleanup.sql でこの識別子だけを消す。148-B-1 の利用者とは共有しない。

INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES (
  '01JTE2E00000000000X0021482', '[E2E_TEST]部署148B2', '[e2e_test]部署148b2', 1,
  '2026-11-19T00:00:00.000Z', '', 1, '2026-11-19T00:00:00.000Z'
);

INSERT INTO clients (id, code, name, name_normalized, is_active, version, created_at, updated_at)
VALUES (
  '01JTE2E00000000000X0031482', 'QKR', 'テスト商事公開範囲 [E2E_TEST]', 'テスト商事公開範囲 [e2e_test]', 1, 1,
  '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z'
);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000X0051482', 'e2euser_case148b2_uploader', 'e2euser_case148b2_uploader',
  'E2E公開範囲の投稿者', 'テスト本名公開範囲投稿者',
  'e2euser_case148b2_uploader@example.com', 'e2euser_case148b2_uploader@example.com',
  '01JTE2E00000000000X0021482', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000X0061482', 'e2euser_case148b2_member', 'e2euser_case148b2_member',
  'E2E公開範囲の参加者', 'テスト本名公開範囲参加者',
  'e2euser_case148b2_member@example.com', 'e2euser_case148b2_member@example.com',
  '01JTE2E00000000000X0021482', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000X0071482', 'e2euser_case148b2_owner', 'e2euser_case148b2_owner',
  'E2E公開範囲のオーナー', 'テスト本名公開範囲オーナー',
  'e2euser_case148b2_owner@example.com', 'e2euser_case148b2_owner@example.com',
  '01JTE2E00000000000X0021482', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000X0081482', 'e2euser_case148b2_outsider', 'e2euser_case148b2_outsider',
  'E2E公開範囲の非参加者', 'テスト本名公開範囲非参加者',
  'e2euser_case148b2_outsider@example.com', 'e2euser_case148b2_outsider@example.com',
  '01JTE2E00000000000X0021482', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES
  ('01JTE2E00000000000X0091482', '01JTE2E00000000000X0071482', 'role_owner', 'department', '01JTE2E00000000000X0021482', '2026-11-19T00:00:00.000Z');

-- 進行中の案件（QKR-261119-0001）
INSERT INTO rooms (id, kind, created_at)
VALUES ('01JTE2E00000000000X0101482', 'channel', '2026-11-19T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES (
  '01JTE2E00000000000X0101482', NULL, 'QKR-261119-0001', 'case:qkr-261119-0001', '', 'private', 'case',
  '01JTE2E00000000000X0051482', 1, '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z', NULL, NULL
);

INSERT INTO cases (
  id, case_number, number_client_id, client_id, channel_id, request_id, title, description, due_date,
  status, created_by, approved_by, version, created_at, updated_at
) VALUES (
  '01JTE2E00000000000X0111482', 'QKR-261119-0001', '01JTE2E00000000000X0031482', '01JTE2E00000000000X0031482',
  '01JTE2E00000000000X0101482', '01JTE2E00000000000X0121482', '[E2E_TEST]148B2の進行中の案件', '[E2E_TEST]148B2の案件の説明',
  NULL, 'active', '01JTE2E00000000000X0051482', '01JTE2E00000000000X0051482', 1,
  '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z'
);

INSERT INTO case_departments (case_id, department_id)
VALUES ('01JTE2E00000000000X0111482', '01JTE2E00000000000X0021482');

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E00000000000X0101482', '01JTE2E00000000000X0051482', '2026-11-19T00:00:00.000Z'),
  ('01JTE2E00000000000X0101482', '01JTE2E00000000000X0061482', '2026-11-19T00:00:01.000Z'),
  ('01JTE2E00000000000X0101482', '01JTE2E00000000000X0071482', '2026-11-19T00:00:02.000Z');
