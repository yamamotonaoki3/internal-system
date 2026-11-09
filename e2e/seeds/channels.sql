-- #200 E2E専用（e2e/channels.spec.ts）の架空データ。部署2件（営業・開発）、各部署の専用チャンネル2つ（通常・お知らせ）、全体管理者1人（営業所属）を入れる。
-- 全社連絡は migration（0011）が作る初期データのため、ここでは作らない。後始末は channels-cleanup.sql（識別子だけで消す）。
-- パスワードのハッシュ・本名の値は、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 部署名・チャンネル名は [E2E_TEST]部署200 で始め、社員IDは e2euser_chan_ で始める。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES
  ('01JTE2E2000000000000000D01', '[E2E_TEST]部署200営業', '[e2e_test]部署200営業', 1,
   '2026-11-09T00:00:00.000Z', '', 1, '2026-11-09T00:00:00.000Z'),
  ('01JTE2E2000000000000000D02', '[E2E_TEST]部署200開発', '[e2e_test]部署200開発', 1,
   '2026-11-09T00:00:00.000Z', '', 1, '2026-11-09T00:00:00.000Z');

INSERT INTO rooms (id, kind, created_at) VALUES
  ('01JTE2E2000000000000000C01', 'channel', '2026-11-09T00:00:00.000Z'),
  ('01JTE2E2000000000000000C02', 'channel', '2026-11-09T00:00:00.000Z'),
  ('01JTE2E2000000000000000C03', 'channel', '2026-11-09T00:00:00.000Z'),
  ('01JTE2E2000000000000000C04', 'channel', '2026-11-09T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES
  ('01JTE2E2000000000000000C01', '01JTE2E2000000000000000D01', '[E2E_TEST]部署200営業',
   '[e2e_test]部署200営業', '', 'public', 'department', NULL, 1,
   '2026-11-09T00:00:00.000Z', '2026-11-09T00:00:00.000Z', NULL, NULL),
  ('01JTE2E2000000000000000C02', '01JTE2E2000000000000000D01', '[E2E_TEST]部署200営業のお知らせ',
   '[e2e_test]部署200営業のお知らせ', '', 'public', 'announcement', NULL, 1,
   '2026-11-09T00:00:00.000Z', '2026-11-09T00:00:00.000Z', NULL, NULL),
  ('01JTE2E2000000000000000C03', '01JTE2E2000000000000000D02', '[E2E_TEST]部署200開発',
   '[e2e_test]部署200開発', '', 'public', 'department', NULL, 1,
   '2026-11-09T00:00:00.000Z', '2026-11-09T00:00:00.000Z', NULL, NULL),
  ('01JTE2E2000000000000000C04', '01JTE2E2000000000000000D02', '[E2E_TEST]部署200開発のお知らせ',
   '[e2e_test]部署200開発のお知らせ', '', 'public', 'announcement', NULL, 1,
   '2026-11-09T00:00:00.000Z', '2026-11-09T00:00:00.000Z', NULL, NULL);

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E2000000000000000A01', 'e2euser_chan_admin', 'e2euser_chan_admin',
  'E2Eチャンネル管理者', legal_name,
  'e2euser_chan_admin@example.com', 'e2euser_chan_admin@example.com',
  '01JTE2E2000000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES
  ('01JTE2E2000000000000000R01', '01JTE2E2000000000000000A01', 'role_global_admin', 'company', NULL, '2026-11-09T00:00:00.000Z');
