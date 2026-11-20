-- #149（149-C）E2E専用（e2e/case-todos-history.spec.ts）。架空の部署1件・社員2人・取引先1件と、進行中の案件1件・TODO 2件を入れる。
--   e2euser_case149c_member：案件の参加者（案件の作成者。担当の変更・完了・削除・復元をする人）
--   e2euser_case149c_partner：案件の参加者（TODO の最初の担当。別のブラウザで復元の反映を見る人）
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 識別子：社員ID e2euser_case149c_、部署名 [E2E_TEST]部署149C、取引先名 テスト商事TODO履歴 [E2E_TEST]（コード QKX。既存の E2E のシードと重ならない）、
-- 件名・説明・TODO の題名に [E2E_TEST] を付ける。案件番号・案件専用チャンネルの名前は QKX で始める。ID は 01JTE2E00000000000Z…149 の範囲。
-- case-todos-history-cleanup.sql でこの識別子だけを消す。
-- 題名・名前には、画面の否定の確認に使う語（「削除」「復元」「担当なし」「以前の担当」「完了」など）を入れない。
-- 役割（オーナー・全体管理者）は付けない（ほかの E2E の利用者の役割を変えない。この E2E の利用者は、ほかの spec と共有しない）。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES (
  '01JTE2E00000000000Z0002149', '[E2E_TEST]部署149C', '[e2e_test]部署149c', 1,
  '2026-11-20T00:00:00.000Z', '', 1, '2026-11-20T00:00:00.000Z'
);

INSERT INTO clients (id, code, name, name_normalized, is_active, version, created_at, updated_at)
VALUES (
  '01JTE2E00000000000Z0003149', 'QKX', 'テスト商事TODO履歴 [E2E_TEST]', 'テスト商事todo履歴 [e2e_test]', 1, 1,
  '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z'
);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000Z0005149', 'e2euser_case149c_member', 'e2euser_case149c_member',
  'E2E案件TODO履歴の参加者', 'テスト本名案件TODO履歴参加者',
  'e2euser_case149c_member@example.com', 'e2euser_case149c_member@example.com',
  '01JTE2E00000000000Z0002149', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000Z0006149', 'e2euser_case149c_partner', 'e2euser_case149c_partner',
  'E2E案件TODO履歴の相手', 'テスト本名案件TODO履歴相手',
  'e2euser_case149c_partner@example.com', 'e2euser_case149c_partner@example.com',
  '01JTE2E00000000000Z0002149', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

-- 進行中の案件（QKX-261120-0001）
INSERT INTO rooms (id, kind, created_at)
VALUES ('01JTE2E00000000000Z0010149', 'channel', '2026-11-20T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES (
  '01JTE2E00000000000Z0010149', NULL, 'QKX-261120-0001', 'case:qkx-261120-0001', '', 'private', 'case',
  '01JTE2E00000000000Z0005149', 1, '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z', NULL, NULL
);

INSERT INTO cases (
  id, case_number, number_client_id, client_id, channel_id, request_id, title, description, due_date,
  status, created_by, approved_by, version, created_at, updated_at
) VALUES (
  '01JTE2E00000000000Z0011149', 'QKX-261120-0001', '01JTE2E00000000000Z0003149', '01JTE2E00000000000Z0003149',
  '01JTE2E00000000000Z0010149', '01JTE2E00000000000Z0012149', '[E2E_TEST]TODO履歴の進行中の案件', '[E2E_TEST]TODO履歴の案件の説明',
  NULL, 'active', '01JTE2E00000000000Z0005149', '01JTE2E00000000000Z0005149', 1,
  '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z'
);

INSERT INTO case_departments (case_id, department_id)
VALUES ('01JTE2E00000000000Z0011149', '01JTE2E00000000000Z0002149');

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E00000000000Z0010149', '01JTE2E00000000000Z0005149', '2026-11-20T00:00:00.000Z'),
  ('01JTE2E00000000000Z0010149', '01JTE2E00000000000Z0006149', '2026-11-20T00:00:01.000Z');

-- TODO 2件（どちらも未完了・版1）と、その記録 create
--   Z0020149：「[E2E_TEST]149C見積りの確認」（担当 partner。担当の変更・完了・削除・復元の対象）
--   Z0022149：「[E2E_TEST]149C請求の準備」（担当なし。進捗の数字を変えるための2件目）
INSERT INTO case_todos (
  id, case_id, title, assignee_id, recorded_assignee_id, recorded_assignee_name,
  completed_assignee_id, completed_assignee_name, is_done, version, created_by, created_at, updated_at, deleted_at, deleted_by
) VALUES
  (
    '01JTE2E00000000000Z0020149', '01JTE2E00000000000Z0011149', '[E2E_TEST]149C見積りの確認',
    '01JTE2E00000000000Z0006149', '01JTE2E00000000000Z0006149', 'E2E案件TODO履歴の相手',
    NULL, NULL, 0, 1, '01JTE2E00000000000Z0005149', '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z', NULL, NULL
  ),
  (
    '01JTE2E00000000000Z0022149', '01JTE2E00000000000Z0011149', '[E2E_TEST]149C請求の準備',
    NULL, NULL, NULL,
    NULL, NULL, 0, 1, '01JTE2E00000000000Z0005149', '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z', NULL, NULL
  );

INSERT INTO case_todo_events (
  id, todo_id, case_id, kind, actor_id, title, previous_title, assignee_id, assignee_name,
  previous_assignee_id, previous_assignee_name, created_at
) VALUES
  (
    '01JTE2E00000000000Z0021149', '01JTE2E00000000000Z0020149', '01JTE2E00000000000Z0011149', 'create',
    '01JTE2E00000000000Z0005149', '[E2E_TEST]149C見積りの確認', NULL, '01JTE2E00000000000Z0006149', 'E2E案件TODO履歴の相手',
    NULL, NULL, '2026-11-20T00:00:00.000Z'
  ),
  (
    '01JTE2E00000000000Z0023149', '01JTE2E00000000000Z0022149', '01JTE2E00000000000Z0011149', 'create',
    '01JTE2E00000000000Z0005149', '[E2E_TEST]149C請求の準備', NULL, NULL, NULL,
    NULL, NULL, '2026-11-20T00:00:00.000Z'
  );
