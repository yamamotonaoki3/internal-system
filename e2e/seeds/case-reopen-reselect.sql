-- #150（150-B）E2E専用（e2e/case-reopen-reselect.spec.ts）。架空の部署1件・社員3人・取引先1件と、終了中の案件1件・過去のやり取り1件を入れる。
--   e2euser_reopen_a：案件の作成者で参加者（再開して、B を外し C を足す人）
--   e2euser_reopen_b：案件の参加者（外される人。案件の画面を開いたままにする）
--   e2euser_reopen_c：案件に参加していない社員（足される人。再開の通知を受け、過去のやり取りを読む）
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 識別子：社員ID e2euser_reopen_、部署名 [E2E_TEST]部署150B、取引先名 テスト商事選び直し [E2E_TEST]（コード QKR。既存の E2E のシードと重ならない）、
-- 件名・説明・本文に [E2E_TEST] を付ける。案件番号・案件専用チャンネルの名前は QKR で始める。case-reopen-reselect-cleanup.sql でこの識別子だけを消す。
-- 全体管理者・部署のオーナーは入れない（ほかの E2E の利用者の役割を変えないため。3人とも自動参加ではないので、B を外せる）。
-- 案件の状態を変える E2E のため、毎回この seed で作り直す。
-- 案件は、部屋 → 案件専用チャンネル（purpose=case・private・部署なし）→ 案件 → 担当部署 → 参加 → メッセージの順に作る（外部キーの順）。
-- ID は 26 文字で、I・L・O・U を使わない。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES (
  '01JTE2E00000000000W0002150', '[E2E_TEST]部署150B', '[e2e_test]部署150b', 1,
  '2026-11-19T00:00:00.000Z', '', 1, '2026-11-19T00:00:00.000Z'
);

INSERT INTO clients (id, code, name, name_normalized, is_active, version, created_at, updated_at)
VALUES (
  '01JTE2E00000000000W0003150', 'QKR', 'テスト商事選び直し [E2E_TEST]', 'テスト商事選び直し [e2e_test]', 1, 1,
  '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z'
);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000W0005150', 'e2euser_reopen_a', 'e2euser_reopen_a',
  'E2E再開する人A', 'テスト本名再開する人A',
  'e2euser_reopen_a@example.com', 'e2euser_reopen_a@example.com',
  '01JTE2E00000000000W0002150', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000W0006150', 'e2euser_reopen_b', 'e2euser_reopen_b',
  'E2E外れる人B', 'テスト本名外れる人B',
  'e2euser_reopen_b@example.com', 'e2euser_reopen_b@example.com',
  '01JTE2E00000000000W0002150', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E00000000000W0007150', 'e2euser_reopen_c', 'e2euser_reopen_c',
  'E2E足される人C', 'テスト本名足される人C',
  'e2euser_reopen_c@example.com', 'e2euser_reopen_c@example.com',
  '01JTE2E00000000000W0002150', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO rooms (id, kind, created_at)
VALUES ('01JTE2E00000000000W0010150', 'channel', '2026-11-19T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES (
  '01JTE2E00000000000W0010150', NULL, 'QKR-261119-0001', 'case:qkr-261119-0001', '', 'private', 'case',
  '01JTE2E00000000000W0005150', 1, '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z', NULL, NULL
);

-- request_id は外部キーでない（申請の行は作らない）。この E2E だけの値にする
INSERT INTO cases (
  id, case_number, number_client_id, client_id, channel_id, request_id, title, description, due_date,
  status, created_by, approved_by, version, created_at, updated_at
) VALUES (
  '01JTE2E00000000000W0011150', 'QKR-261119-0001', '01JTE2E00000000000W0003150', '01JTE2E00000000000W0003150',
  '01JTE2E00000000000W0010150', '01JTE2E00000000000W0012150', '[E2E_TEST] 再開の選び直し', '[E2E_TEST]選び直しの案件の説明',
  NULL, 'closed', '01JTE2E00000000000W0005150', '01JTE2E00000000000W0005150', 1,
  '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z'
);

INSERT INTO case_departments (case_id, department_id)
VALUES ('01JTE2E00000000000W0011150', '01JTE2E00000000000W0002150');

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E00000000000W0010150', '01JTE2E00000000000W0005150', '2026-11-19T00:00:00.000Z'),
  ('01JTE2E00000000000W0010150', '01JTE2E00000000000W0006150', '2026-11-19T00:00:01.000Z');

-- 終了の前の過去のやり取り（足される人 C に共有されることを確かめる）
INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at)
VALUES (
  '01JTE2E00000000000W0030150', '01JTE2E00000000000W0010150', '01JTE2E00000000000W0006150',
  'E2E外れる人B', '[E2E_TEST]再開の前の過去のやり取り', '2026-11-19T00:00:02.000Z'
);
