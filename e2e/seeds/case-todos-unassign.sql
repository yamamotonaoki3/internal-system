-- #149（149-D）E2E専用（e2e/case-todos-unassign.spec.ts）。架空の部署1件・社員2人・取引先1件と、進行中の案件1件・TODO 1件を入れる。
--   e2euser_case149d_member：案件の参加者（案件の作成者。相手を参加者から外す人）
--   e2euser_case149d_partner：案件の参加者（TODO の担当。参加者から外される人）
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 識別子：社員ID e2euser_case149d_、部署名 [E2E_TEST]部署149D、取引先名 テスト商事TODO外し [E2E_TEST]（コード QKW。既存の E2E のシードと重ならない）、
-- 件名・説明・TODO の題名に [E2E_TEST] を付ける。案件番号・案件専用チャンネルの名前は QKW で始める。ID は 01JTE2E00000000000Y…149 の範囲。
-- case-todos-unassign-cleanup.sql でこの識別子だけを消す。
-- 題名・名前には、画面の否定の確認に使う語（「削除」「担当なし」「以前の担当」など）を入れない。
-- 役割（オーナー・全体管理者）は付けない（ほかの E2E の利用者の役割を変えない。この E2E の利用者は、ほかの spec と共有しない）。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES (
  '01JTE2E00000000000Y0002149', '[E2E_TEST]部署149D', '[e2e_test]部署149d', 1,
  '2026-11-20T00:00:00.000Z', '', 1, '2026-11-20T00:00:00.000Z'
);

INSERT INTO clients (id, code, name, name_normalized, is_active, version, created_at, updated_at)
VALUES (
  '01JTE2E00000000000Y0003149', 'QKW', 'テスト商事TODO外し [E2E_TEST]', 'テスト商事todo外し [e2e_test]', 1, 1,
  '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z'
);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000Y0005149', 'e2euser_case149d_member', 'e2euser_case149d_member',
  'E2E案件TODO外しの参加者', 'テスト本名案件TODO外し参加者',
  'e2euser_case149d_member@example.com', 'e2euser_case149d_member@example.com',
  '01JTE2E00000000000Y0002149', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000Y0006149', 'e2euser_case149d_partner', 'e2euser_case149d_partner',
  'E2E案件TODO外しの相手', 'テスト本名案件TODO外し相手',
  'e2euser_case149d_partner@example.com', 'e2euser_case149d_partner@example.com',
  '01JTE2E00000000000Y0002149', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

-- 進行中の案件（QKW-261120-0001）
INSERT INTO rooms (id, kind, created_at)
VALUES ('01JTE2E00000000000Y0010149', 'channel', '2026-11-20T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES (
  '01JTE2E00000000000Y0010149', NULL, 'QKW-261120-0001', 'case:qkw-261120-0001', '', 'private', 'case',
  '01JTE2E00000000000Y0005149', 1, '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z', NULL, NULL
);

INSERT INTO cases (
  id, case_number, number_client_id, client_id, channel_id, request_id, title, description, due_date,
  status, created_by, approved_by, version, created_at, updated_at
) VALUES (
  '01JTE2E00000000000Y0011149', 'QKW-261120-0001', '01JTE2E00000000000Y0003149', '01JTE2E00000000000Y0003149',
  '01JTE2E00000000000Y0010149', '01JTE2E00000000000Y0012149', '[E2E_TEST]TODO外しの進行中の案件', '[E2E_TEST]TODO外しの案件の説明',
  NULL, 'active', '01JTE2E00000000000Y0005149', '01JTE2E00000000000Y0005149', 1,
  '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z'
);

INSERT INTO case_departments (case_id, department_id)
VALUES ('01JTE2E00000000000Y0011149', '01JTE2E00000000000Y0002149');

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E00000000000Y0010149', '01JTE2E00000000000Y0005149', '2026-11-20T00:00:00.000Z'),
  ('01JTE2E00000000000Y0010149', '01JTE2E00000000000Y0006149', '2026-11-20T00:00:01.000Z');

-- TODO 1件（未完了・担当 partner・版1）と、その記録 create
INSERT INTO case_todos (
  id, case_id, title, assignee_id, recorded_assignee_id, recorded_assignee_name,
  completed_assignee_id, completed_assignee_name, is_done, version, created_by, created_at, updated_at, deleted_at, deleted_by
) VALUES (
  '01JTE2E00000000000Y0020149', '01JTE2E00000000000Y0011149', '[E2E_TEST]149D見積り',
  '01JTE2E00000000000Y0006149', '01JTE2E00000000000Y0006149', 'E2E案件TODO外しの相手',
  NULL, NULL, 0, 1, '01JTE2E00000000000Y0005149', '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z', NULL, NULL
);

INSERT INTO case_todo_events (
  id, todo_id, case_id, kind, actor_id, title, previous_title, assignee_id, assignee_name,
  previous_assignee_id, previous_assignee_name, created_at
) VALUES (
  '01JTE2E00000000000Y0021149', '01JTE2E00000000000Y0020149', '01JTE2E00000000000Y0011149', 'create',
  '01JTE2E00000000000Y0005149', '[E2E_TEST]149D見積り', NULL, '01JTE2E00000000000Y0006149', 'E2E案件TODO外しの相手',
  NULL, NULL, '2026-11-20T00:00:00.000Z'
);
