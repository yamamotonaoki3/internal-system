-- #150（150-A）E2E専用（e2e/case-close.spec.ts）。架空の部署1件・社員2人・取引先1件と、進行中の案件1件を入れる。
--   e2euser_case150_a：案件の参加者（終了する人）
--   e2euser_case150_b：案件の参加者（別のブラウザで、終了の通知を受け、再開する人）
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 識別子：社員ID e2euser_case150_、部署名 [E2E_TEST]部署150A、取引先名 テスト商事終了 [E2E_TEST]（コード QKC。既存の E2E のシードと重ならない）、
-- 件名・説明に [E2E_TEST] を付ける。案件番号・案件専用チャンネルの名前は QKC で始める。case-close-cleanup.sql でこの識別子だけを消す。
-- 役割（オーナー・全体管理者）は付けない（ほかの E2E の利用者の役割を変えない。この E2E の利用者・案件は、ほかの spec と共有しない）。
-- 案件の状態を変える E2E のため、毎回この seed で作り直す（前の実行で状態を変えた案件を使い回さない）。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES (
  '01JTE2E00000000000V0002150', '[E2E_TEST]部署150A', '[e2e_test]部署150a', 1,
  '2026-11-18T00:00:00.000Z', '', 1, '2026-11-18T00:00:00.000Z'
);

INSERT INTO clients (id, code, name, name_normalized, is_active, version, created_at, updated_at)
VALUES (
  '01JTE2E00000000000V0003150', 'QKC', 'テスト商事終了 [E2E_TEST]', 'テスト商事終了 [e2e_test]', 1, 1,
  '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z'
);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000V0005150', 'e2euser_case150_a', 'e2euser_case150_a',
  'E2E案件終了の参加者A', 'テスト本名案件終了参加者A',
  'e2euser_case150_a@example.com', 'e2euser_case150_a@example.com',
  '01JTE2E00000000000V0002150', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000V0006150', 'e2euser_case150_b', 'e2euser_case150_b',
  'E2E案件終了の参加者B', 'テスト本名案件終了参加者B',
  'e2euser_case150_b@example.com', 'e2euser_case150_b@example.com',
  '01JTE2E00000000000V0002150', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

-- 進行中の案件（QKC-261118-0001）
INSERT INTO rooms (id, kind, created_at)
VALUES ('01JTE2E00000000000V0010150', 'channel', '2026-11-18T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES (
  '01JTE2E00000000000V0010150', NULL, 'QKC-261118-0001', 'case:qkc-261118-0001', '', 'private', 'case',
  '01JTE2E00000000000V0005150', 1, '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z', NULL, NULL
);

INSERT INTO cases (
  id, case_number, number_client_id, client_id, channel_id, request_id, title, description, due_date,
  status, created_by, approved_by, version, created_at, updated_at
) VALUES (
  '01JTE2E00000000000V0011150', 'QKC-261118-0001', '01JTE2E00000000000V0003150', '01JTE2E00000000000V0003150',
  '01JTE2E00000000000V0010150', '01JTE2E00000000000V0012150', '[E2E_TEST] 終了の確認', '[E2E_TEST]終了・再開の確認の案件の説明',
  NULL, 'active', '01JTE2E00000000000V0005150', '01JTE2E00000000000V0005150', 1,
  '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z'
);

INSERT INTO case_departments (case_id, department_id)
VALUES ('01JTE2E00000000000V0011150', '01JTE2E00000000000V0002150');

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E00000000000V0010150', '01JTE2E00000000000V0005150', '2026-11-18T00:00:00.000Z'),
  ('01JTE2E00000000000V0010150', '01JTE2E00000000000V0006150', '2026-11-18T00:00:01.000Z');
