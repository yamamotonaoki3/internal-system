-- #150（150-C）E2E専用（e2e/case-edit.spec.ts）。架空の部署2件・社員3人・取引先2件・部署のオーナーの割り当て2件と、進行中の案件1件を入れる。
--   e2euser_caseedit_a：案件の作成者で参加者（件名・説明・取引先を変え、部署 X を足す人）
--   e2euser_caseedit_b：案件の担当部署 Y のオーナーで、案件に参加していない（非参加の管理者。件名だけを変える）
--   e2euser_caseedit_c：部署 X のオーナーで、案件に参加していない（部署 X を足されると自動で参加する）
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 識別子：社員ID e2euser_caseedit_、部署名 [E2E_TEST]部署150C（Y）・[E2E_TEST]部署150CX（X）、
--   取引先名 テスト商事再編集 [E2E_TEST]（コード QKS）・テスト商事再編集後 [E2E_TEST]（コード QKY）（既存の E2E のシードと重ならない）、
--   件名・説明に [E2E_TEST] を付ける。案件番号・案件専用チャンネルの名前は QKS で始める。case-edit-cleanup.sql でこの識別子だけを消す。
-- 全体管理者は入れない。オーナーは、この E2E の新しい社員にだけ割り当てる（ほかの E2E の利用者の役割を変えないため）。
-- 案件の内容と参加者を変える E2E のため、毎回この seed で作り直す。
-- 案件は、部屋 → 案件専用チャンネル（purpose=case・private・部署なし）→ 案件 → 担当部署 → 参加の順に作る（外部キーの順）。
-- ID は 26 文字で、I・L・O・U を使わない（この E2E の ID は 01JTE2E00000000000R…150 の形）。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES
  ('01JTE2E00000000000R0002150', '[E2E_TEST]部署150C', '[e2e_test]部署150c', 1,
   '2026-11-20T00:00:00.000Z', '', 1, '2026-11-20T00:00:00.000Z'),
  ('01JTE2E00000000000R0004150', '[E2E_TEST]部署150CX', '[e2e_test]部署150cx', 1,
   '2026-11-20T00:00:00.000Z', '', 1, '2026-11-20T00:00:00.000Z');

INSERT INTO clients (id, code, name, name_normalized, is_active, version, created_at, updated_at)
VALUES
  ('01JTE2E00000000000R0003150', 'QKS', 'テスト商事再編集 [E2E_TEST]', 'テスト商事再編集 [e2e_test]', 1, 1,
   '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z'),
  ('01JTE2E00000000000R0013150', 'QKY', 'テスト商事再編集後 [E2E_TEST]', 'テスト商事再編集後 [e2e_test]', 1, 1,
   '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z');

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000R0005150', 'e2euser_caseedit_a', 'e2euser_caseedit_a',
  'E2E編集する人A', 'テスト本名編集する人A',
  'e2euser_caseedit_a@example.com', 'e2euser_caseedit_a@example.com',
  '01JTE2E00000000000R0002150', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000R0006150', 'e2euser_caseedit_b', 'e2euser_caseedit_b',
  'E2E部署のオーナーB', 'テスト本名部署のオーナーB',
  'e2euser_caseedit_b@example.com', 'e2euser_caseedit_b@example.com',
  '01JTE2E00000000000R0002150', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000R0007150', 'e2euser_caseedit_c', 'e2euser_caseedit_c',
  'E2E足す部署のオーナーC', 'テスト本名足す部署のオーナーC',
  'e2euser_caseedit_c@example.com', 'e2euser_caseedit_c@example.com',
  '01JTE2E00000000000R0004150', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES
  ('01JTE2E00000000000R0008150', '01JTE2E00000000000R0006150', 'role_owner', 'department', '01JTE2E00000000000R0002150', '2026-11-20T00:00:00.000Z'),
  ('01JTE2E00000000000R0009150', '01JTE2E00000000000R0007150', 'role_owner', 'department', '01JTE2E00000000000R0004150', '2026-11-20T00:00:00.000Z');

INSERT INTO rooms (id, kind, created_at)
VALUES ('01JTE2E00000000000R0010150', 'channel', '2026-11-20T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES (
  '01JTE2E00000000000R0010150', NULL, 'QKS-261120-0001', 'case:qks-261120-0001', '', 'private', 'case',
  '01JTE2E00000000000R0005150', 1, '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z', NULL, NULL
);

-- request_id は外部キーでない（申請の行は作らない）。この E2E だけの値にする
INSERT INTO cases (
  id, case_number, number_client_id, client_id, channel_id, request_id, title, description, due_date,
  status, created_by, approved_by, version, created_at, updated_at
) VALUES (
  '01JTE2E00000000000R0011150', 'QKS-261120-0001', '01JTE2E00000000000R0003150', '01JTE2E00000000000R0003150',
  '01JTE2E00000000000R0010150', '01JTE2E00000000000R0012150', '[E2E_TEST] 再編集の前の件名', '[E2E_TEST]再編集の前の説明',
  NULL, 'active', '01JTE2E00000000000R0005150', '01JTE2E00000000000R0005150', 1,
  '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z'
);

INSERT INTO case_departments (case_id, department_id)
VALUES ('01JTE2E00000000000R0011150', '01JTE2E00000000000R0002150');

-- 参加者は A だけ（B は担当部署のオーナーだが参加していない。C は参加していない）
INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E00000000000R0010150', '01JTE2E00000000000R0005150', '2026-11-20T00:00:00.000Z');
