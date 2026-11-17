-- #147（147-A）E2E専用（e2e/cases.spec.ts）。架空の部署1件・参加者（案件の作成者）1人・非参加者1人・取引先1件と、参加者だけが参加している進行中の案件1件を入れる。
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 識別子：社員ID e2euser_cases_、部署名 [E2E_TEST]部署147A、取引先名 テスト商事案件 [E2E_TEST]（コード QKG。既存の E2E のシードと重ならない）、
-- 件名・説明に [E2E_TEST] を付ける。案件番号・案件専用チャンネルの名前は QKG で始める。cases-cleanup.sql でこの識別子だけを消す。
-- 全体管理者・オーナーは入れない（全体管理者は1人だけの制約があり、この E2E の流れに要らないため）。
-- 案件は、部屋 → 案件専用チャンネル（purpose=case・private・部署なし）→ 案件 → 担当部署 → 参加の順に作る（外部キーの順）。
-- 前提：#146 の migration（cases・case_departments）が適用済み。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES (
  '01JTE2E00000000000C0002147', '[E2E_TEST]部署147A', '[e2e_test]部署147a', 1,
  '2026-11-17T00:00:00.000Z', '', 1, '2026-11-17T00:00:00.000Z'
);

INSERT INTO clients (id, code, name, name_normalized, is_active, version, created_at, updated_at)
VALUES (
  '01JTE2E00000000000C0003147', 'QKG', 'テスト商事案件 [E2E_TEST]', 'テスト商事案件 [e2e_test]', 1, 1,
  '2026-11-17T00:00:00.000Z', '2026-11-17T00:00:00.000Z'
);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000C0005147', 'e2euser_cases_member', 'e2euser_cases_member',
  'E2E案件参加者', 'テスト本名案件参加者',
  'e2euser_cases_member@example.com', 'e2euser_cases_member@example.com',
  '01JTE2E00000000000C0002147', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000C0006147', 'e2euser_cases_outsider', 'e2euser_cases_outsider',
  'E2E案件非参加者', 'テスト本名案件非参加者',
  'e2euser_cases_outsider@example.com', 'e2euser_cases_outsider@example.com',
  '01JTE2E00000000000C0002147', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO rooms (id, kind, created_at)
VALUES ('01JTE2E00000000000C0010147', 'channel', '2026-11-17T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES (
  '01JTE2E00000000000C0010147', NULL, 'QKG-261117-0001', 'case:qkg-261117-0001', '', 'private', 'case',
  '01JTE2E00000000000C0005147', 1, '2026-11-17T00:00:00.000Z', '2026-11-17T00:00:00.000Z', NULL, NULL
);

-- request_id は外部キーでない（申請の行は作らない）。この E2E だけの値にする
INSERT INTO cases (
  id, case_number, number_client_id, client_id, channel_id, request_id, title, description, due_date,
  status, created_by, approved_by, version, created_at, updated_at
) VALUES (
  '01JTE2E00000000000C0011147', 'QKG-261117-0001', '01JTE2E00000000000C0003147', '01JTE2E00000000000C0003147',
  '01JTE2E00000000000C0010147', '01JTE2E00000000000C0012147', '[E2E_TEST]案件一覧の案件', '[E2E_TEST]参加者だけが見られる説明',
  '2026-12-01', 'active', '01JTE2E00000000000C0005147', '01JTE2E00000000000C0005147', 1,
  '2026-11-17T00:00:00.000Z', '2026-11-17T00:00:00.000Z'
);

INSERT INTO case_departments (case_id, department_id)
VALUES ('01JTE2E00000000000C0011147', '01JTE2E00000000000C0002147');

INSERT INTO channel_members (channel_id, user_id, joined_at)
VALUES ('01JTE2E00000000000C0010147', '01JTE2E00000000000C0005147', '2026-11-17T00:00:00.000Z');
