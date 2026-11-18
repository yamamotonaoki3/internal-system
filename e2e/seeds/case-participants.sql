-- #147（147-B）E2E専用（e2e/case-participants.spec.ts）。架空の部署1件・社員3人・取引先1件と、進行中の案件1件を入れる。
--   e2euser_casepart_member：案件の作成者で、一般の参加者（参加者の追加・削除・納期の変更をする人）
--   e2euser_casepart_owner：部署のオーナーで、案件の担当部署のオーナーとして参加している（自動参加の人。「削除」が出ないこと）
--   e2euser_casepart_newcomer：参加していない社員（追加される人）
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 識別子：社員ID e2euser_casepart_、部署名 [E2E_TEST]部署147B、取引先名 テスト商事参加者 [E2E_TEST]（コード QKH。既存の E2E のシードと重ならない）、
-- 件名・説明に [E2E_TEST] を付ける。案件番号・案件専用チャンネルの名前は QKH で始める。case-participants-cleanup.sql でこの識別子だけを消す。
-- 全体管理者は入れない（DB 全体で1人だけの制約があり、ほかの E2E の利用者の役割を変えないため）。オーナーはこのシードの部署だけに付ける
-- （部署のオーナーは1人だけ。新しい部署なので、ほかの E2E の部署・利用者の役割は変わらない）。
-- 案件は、部屋 → 案件専用チャンネル（purpose=case・private・部署なし）→ 案件 → 担当部署 → 参加の順に作る（外部キーの順）。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES (
  '01JTE2E00000000000P0002147', '[E2E_TEST]部署147B', '[e2e_test]部署147b', 1,
  '2026-11-18T00:00:00.000Z', '', 1, '2026-11-18T00:00:00.000Z'
);

INSERT INTO clients (id, code, name, name_normalized, is_active, version, created_at, updated_at)
VALUES (
  '01JTE2E00000000000P0003147', 'QKH', 'テスト商事参加者 [E2E_TEST]', 'テスト商事参加者 [e2e_test]', 1, 1,
  '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z'
);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000P0005147', 'e2euser_casepart_member', 'e2euser_casepart_member',
  'E2E参加者管理の作成者', 'テスト本名参加者管理作成者',
  'e2euser_casepart_member@example.com', 'e2euser_casepart_member@example.com',
  '01JTE2E00000000000P0002147', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000P0006147', 'e2euser_casepart_owner', 'e2euser_casepart_owner',
  'E2E参加者管理のオーナー', 'テスト本名参加者管理オーナー',
  'e2euser_casepart_owner@example.com', 'e2euser_casepart_owner@example.com',
  '01JTE2E00000000000P0002147', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000P0007147', 'e2euser_casepart_newcomer', 'e2euser_casepart_newcomer',
  'E2E参加者管理の追加対象', 'テスト本名参加者管理追加対象',
  'e2euser_casepart_newcomer@example.com', 'e2euser_casepart_newcomer@example.com',
  '01JTE2E00000000000P0002147', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES
  ('01JTE2E00000000000P0008147', '01JTE2E00000000000P0006147', 'role_owner', 'department', '01JTE2E00000000000P0002147', '2026-11-18T00:00:00.000Z');

INSERT INTO rooms (id, kind, created_at)
VALUES ('01JTE2E00000000000P0010147', 'channel', '2026-11-18T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES (
  '01JTE2E00000000000P0010147', NULL, 'QKH-261118-0001', 'case:qkh-261118-0001', '', 'private', 'case',
  '01JTE2E00000000000P0005147', 1, '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z', NULL, NULL
);

-- request_id は外部キーでない（申請の行は作らない）。この E2E だけの値にする。納期は未定から始める
INSERT INTO cases (
  id, case_number, number_client_id, client_id, channel_id, request_id, title, description, due_date,
  status, created_by, approved_by, version, created_at, updated_at
) VALUES (
  '01JTE2E00000000000P0011147', 'QKH-261118-0001', '01JTE2E00000000000P0003147', '01JTE2E00000000000P0003147',
  '01JTE2E00000000000P0010147', '01JTE2E00000000000P0012147', '[E2E_TEST]参加者管理の案件', '[E2E_TEST]参加者だけが見られる参加者管理の説明',
  NULL, 'active', '01JTE2E00000000000P0005147', '01JTE2E00000000000P0005147', 1,
  '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z'
);

INSERT INTO case_departments (case_id, department_id)
VALUES ('01JTE2E00000000000P0011147', '01JTE2E00000000000P0002147');

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E00000000000P0010147', '01JTE2E00000000000P0005147', '2026-11-18T00:00:00.000Z'),
  ('01JTE2E00000000000P0010147', '01JTE2E00000000000P0006147', '2026-11-18T00:00:01.000Z');
