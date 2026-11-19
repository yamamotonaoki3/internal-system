-- #148（148-C）E2E専用（e2e/case-activity.spec.ts）。架空の部署1件・社員3人・取引先1件と、進行中の案件1件を入れる。
--   e2euser_case148c_member：案件の参加者（S-17 から投稿する人。A）
--   e2euser_case148c_partner：案件の参加者（S-16・サイドバーに未読と最終更新が出ることを確かめる人。B）
--   e2euser_case148c_outsider：案件に参加していない社員（S-16 の「すべての案件」に、最終更新・未読が出ない。C）
-- メッセージはシードで入れず、画面から投稿する（最初は「最終更新：—」から始める）。
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 識別子：社員ID e2euser_case148c_、部署名 [E2E_TEST]部署148C、取引先名 テスト商事148C活動 [E2E_TEST]（コード QKP。既存の E2E のシードと重ならない）、
-- 件名・説明・本文に [E2E_TEST] を付ける。案件番号・案件専用チャンネルの名前は QKP で始める。case-activity-cleanup.sql でこの識別子だけを消す。
-- 役割（オーナー・全体管理者）は付けない（ほかの E2E の利用者の役割を変えない。この E2E の利用者は、ほかの spec と共有しない）。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES (
  '01JTE2E00000000000W0002148', '[E2E_TEST]部署148C', '[e2e_test]部署148c', 1,
  '2026-11-19T00:00:00.000Z', '', 1, '2026-11-19T00:00:00.000Z'
);

INSERT INTO clients (id, code, name, name_normalized, is_active, version, created_at, updated_at)
VALUES (
  '01JTE2E00000000000W0003148', 'QKP', 'テスト商事148C活動 [E2E_TEST]', 'テスト商事148c活動 [e2e_test]', 1, 1,
  '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z'
);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000W0005148', 'e2euser_case148c_member', 'e2euser_case148c_member',
  'E2E148C活動の投稿者', 'テスト本名148C活動投稿者',
  'e2euser_case148c_member@example.com', 'e2euser_case148c_member@example.com',
  '01JTE2E00000000000W0002148', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000W0006148', 'e2euser_case148c_partner', 'e2euser_case148c_partner',
  'E2E148C活動の相手', 'テスト本名148C活動相手',
  'e2euser_case148c_partner@example.com', 'e2euser_case148c_partner@example.com',
  '01JTE2E00000000000W0002148', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000W0007148', 'e2euser_case148c_outsider', 'e2euser_case148c_outsider',
  'E2E148C活動の非参加者', 'テスト本名148C活動非参加者',
  'e2euser_case148c_outsider@example.com', 'e2euser_case148c_outsider@example.com',
  '01JTE2E00000000000W0002148', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

-- 進行中の案件（QKP-261119-0001）
INSERT INTO rooms (id, kind, created_at)
VALUES ('01JTE2E00000000000W0010148', 'channel', '2026-11-19T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES (
  '01JTE2E00000000000W0010148', NULL, 'QKP-261119-0001', 'case:qkp-261119-0001', '', 'private', 'case',
  '01JTE2E00000000000W0005148', 1, '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z', NULL, NULL
);

INSERT INTO cases (
  id, case_number, number_client_id, client_id, channel_id, request_id, title, description, due_date,
  status, created_by, approved_by, version, created_at, updated_at
) VALUES (
  '01JTE2E00000000000W0011148', 'QKP-261119-0001', '01JTE2E00000000000W0003148', '01JTE2E00000000000W0003148',
  '01JTE2E00000000000W0010148', '01JTE2E00000000000W0012148', '[E2E_TEST]148C活動の進行中の案件', '[E2E_TEST]148C活動の案件の説明',
  NULL, 'active', '01JTE2E00000000000W0005148', '01JTE2E00000000000W0005148', 1,
  '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z'
);

INSERT INTO case_departments (case_id, department_id)
VALUES ('01JTE2E00000000000W0011148', '01JTE2E00000000000W0002148');

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E00000000000W0010148', '01JTE2E00000000000W0005148', '2026-11-19T00:00:00.000Z'),
  ('01JTE2E00000000000W0010148', '01JTE2E00000000000W0006148', '2026-11-19T00:00:01.000Z');
