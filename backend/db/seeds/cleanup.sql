-- 後始末：テストデータだけを、識別子（testuser_ または e2euser_ で始まるユーザー名。LIKE の _ は文字どおりに扱うため ESCAPE を使う）で消す（C-05）。
-- testuser_ は開発・単体のテストのデータ、e2euser_ は E2E のデータ。
-- 実行したあと、残りの件数が 0 になることを確かめる（下の SELECT の結果が 0）。
DELETE FROM sample_users WHERE username LIKE 'testuser!_%' ESCAPE '!' OR username LIKE 'e2euser!_%' ESCAPE '!';

SELECT COUNT(*) AS remaining FROM sample_users WHERE username LIKE 'testuser!_%' ESCAPE '!' OR username LIKE 'e2euser!_%' ESCAPE '!';

-- ロール・会社・部署・利用者のテストデータ（#119）。識別子：社員IDが testuser_ / e2euser_、部署名・会社名が [UNIT_TEST] / [E2E_TEST] で始まる。
-- 外部キーの順に消す：監査ログ（操作者がテストの利用者）→ セッション（#120）→ 割り当て → 利用者 → 部署・会社の設定。初期ロールと権限（roles・role_permissions）は消さない。
DELETE FROM audit_logs WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!' OR login_id LIKE 'e2euser!_%' ESCAPE '!');
-- login_attempts は識別子（社員ID・IP）を持たない HMAC のキーのため、ここでは消せない。テスト用DBの作り直し（npm run db:reset:test）で消える。
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!' OR login_id LIKE 'e2euser!_%' ESCAPE '!');
-- 部署のチャンネルと参加者（#196）。外部キーの順：参加者 → チャンネル → ルーム。ルームは、チャンネルの行を持たなくなった kind='channel' のものだけを消す。
DELETE FROM channel_members WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!' OR login_id LIKE 'e2euser!_%' ESCAPE '!') OR channel_id IN (SELECT room_id FROM channels WHERE department_id IN (SELECT id FROM departments WHERE name LIKE '[UNIT!_TEST]%' ESCAPE '!' OR name LIKE '[E2E!_TEST]%' ESCAPE '!'));
DELETE FROM channels WHERE department_id IN (SELECT id FROM departments WHERE name LIKE '[UNIT!_TEST]%' ESCAPE '!' OR name LIKE '[E2E!_TEST]%' ESCAPE '!');
DELETE FROM rooms WHERE kind = 'channel' AND id NOT IN (SELECT room_id FROM channels);
DELETE FROM user_role_assignments WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!' OR login_id LIKE 'e2euser!_%' ESCAPE '!');
DELETE FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!' OR login_id LIKE 'e2euser!_%' ESCAPE '!';
DELETE FROM departments WHERE name LIKE '[UNIT!_TEST]%' ESCAPE '!' OR name LIKE '[E2E!_TEST]%' ESCAPE '!';
DELETE FROM company_settings WHERE company_name LIKE '[UNIT!_TEST]%' ESCAPE '!' OR company_name LIKE '[E2E!_TEST]%' ESCAPE '!';

-- 残りの件数（すべて 0 になることを確かめる）
SELECT
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!' OR login_id LIKE 'e2euser!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM sessions WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!' OR login_id LIKE 'e2euser!_%' ESCAPE '!')) AS remaining_sessions,
  (SELECT COUNT(*) FROM departments WHERE name LIKE '[UNIT!_TEST]%' ESCAPE '!' OR name LIKE '[E2E!_TEST]%' ESCAPE '!') AS remaining_departments,
  (SELECT COUNT(*) FROM company_settings WHERE company_name LIKE '[UNIT!_TEST]%' ESCAPE '!' OR company_name LIKE '[E2E!_TEST]%' ESCAPE '!') AS remaining_company_settings;
