-- #308 E2E専用（e2e/case-access-loss.spec.ts）。架空の部署1件・社員2人・取引先1件と、進行中の案件1件を入れる。
--   e2euser_loss_a：案件の作成者で、一般の参加者（相手を参加者から外す人）
--   e2euser_loss_b：案件に参加している社員（外される人。案件の画面を開いたままにする）
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 識別子：社員ID e2euser_loss_、部署名 [E2E_TEST]部署308、取引先名 テスト商事外され [E2E_TEST]（コード QKM。既存の E2E のシードと重ならない）、
-- 件名・説明に [E2E_TEST] を付ける。案件番号・案件専用チャンネルの名前は QKM で始める。case-access-loss-cleanup.sql でこの識別子だけを消す。
-- 全体管理者・部署のオーナーは入れない（DB 全体の役割の制約と、ほかの E2E の利用者の役割を変えないため。2人とも自動参加ではないので、どちらも外せる）。
-- 案件は、部屋 → 案件専用チャンネル（purpose=case・private・部署なし）→ 案件 → 担当部署 → 参加の順に作る（外部キーの順）。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES (
  '01JTE2E00000000000Q0002308', '[E2E_TEST]部署308', '[e2e_test]部署308', 1,
  '2026-11-19T00:00:00.000Z', '', 1, '2026-11-19T00:00:00.000Z'
);

INSERT INTO clients (id, code, name, name_normalized, is_active, version, created_at, updated_at)
VALUES (
  '01JTE2E00000000000Q0003308', 'QKM', 'テスト商事外され [E2E_TEST]', 'テスト商事外され [e2e_test]', 1, 1,
  '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z'
);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000Q0005308', 'e2euser_loss_a', 'e2euser_loss_a',
  'E2E外す人A', 'テスト本名外す人A',
  'e2euser_loss_a@example.com', 'e2euser_loss_a@example.com',
  '01JTE2E00000000000Q0002308', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000Q0006308', 'e2euser_loss_b', 'e2euser_loss_b',
  'E2E外される人B', 'テスト本名外される人B',
  'e2euser_loss_b@example.com', 'e2euser_loss_b@example.com',
  '01JTE2E00000000000Q0002308', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO rooms (id, kind, created_at)
VALUES ('01JTE2E00000000000Q0010308', 'channel', '2026-11-19T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES (
  '01JTE2E00000000000Q0010308', NULL, 'QKM-261119-0001', 'case:qkm-261119-0001', '', 'private', 'case',
  '01JTE2E00000000000Q0005308', 1, '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z', NULL, NULL
);

-- request_id は外部キーでない（申請の行は作らない）。この E2E だけの値にする
INSERT INTO cases (
  id, case_number, number_client_id, client_id, channel_id, request_id, title, description, due_date,
  status, created_by, approved_by, version, created_at, updated_at
) VALUES (
  '01JTE2E00000000000Q0011308', 'QKM-261119-0001', '01JTE2E00000000000Q0003308', '01JTE2E00000000000Q0003308',
  '01JTE2E00000000000Q0010308', '01JTE2E00000000000Q0012308', '[E2E_TEST]外された人の画面の案件', '[E2E_TEST]外された人には見えなくなる説明',
  NULL, 'active', '01JTE2E00000000000Q0005308', '01JTE2E00000000000Q0005308', 1,
  '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z'
);

INSERT INTO case_departments (case_id, department_id)
VALUES ('01JTE2E00000000000Q0011308', '01JTE2E00000000000Q0002308');

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E00000000000Q0010308', '01JTE2E00000000000Q0005308', '2026-11-19T00:00:00.000Z'),
  ('01JTE2E00000000000Q0010308', '01JTE2E00000000000Q0006308', '2026-11-19T00:00:01.000Z');
