-- #120 E2E の後始末：e2e/seeds/login.sql と login.spec.ts が作ったデータだけを、社員IDの識別子（e2euser_ で始まる）で消す。
-- 外部キーの順：監査ログ（操作者がテストの利用者）→ セッション → ロールの割り当て → 利用者。login_attempts は生の社員IDを持たない（HMAC）ため、ここでは消さない（テスト用DBは実行の開始時に作り直す）。
DELETE FROM audit_logs WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_%' ESCAPE '!');
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_%' ESCAPE '!');
DELETE FROM user_role_assignments WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_%' ESCAPE '!');
DELETE FROM users WHERE login_id LIKE 'e2euser!_%' ESCAPE '!';

-- 残りの件数（すべて 0 になることを確かめる）
SELECT
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM sessions WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_%' ESCAPE '!')) AS remaining_sessions;
