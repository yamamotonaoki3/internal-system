-- #383 E2E専用。社員ID e2euser_cookierace_、部署名 [E2E_TEST]部署383 の識別子だけを後始末する。
-- 外部キーの順：既読位置 → 通知 → 監査（ログインの記録） → セッション → ロールの割り当て → チャンネルの参加 → 社員 → 部署。
-- login_attempts は生の社員IDを持たない（HMAC）ため、ここでは消さない（テスト用DBは E2E の実行の開始時に作り直す。login-cleanup.sql と同じ）。
DELETE FROM read_positions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_cookierace!_%' ESCAPE '!');
DELETE FROM notifications
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_cookierace!_%' ESCAPE '!');
DELETE FROM audit_logs
WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_cookierace!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_cookierace!_%' ESCAPE '!');
DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_cookierace!_%' ESCAPE '!');
DELETE FROM user_role_assignments
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_cookierace!_%' ESCAPE '!');
DELETE FROM channel_members
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_cookierace!_%' ESCAPE '!');
DELETE FROM users WHERE login_id LIKE 'e2euser!_cookierace!_%' ESCAPE '!';
DELETE FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署383';

-- 残りの件数（すべて 0 になることを確かめる。e2e/session-cookie-race.spec.ts の afterAll が出力を照合する）
SELECT
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_cookierace!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM sessions WHERE user_id IN ('01JTE2E00000000000C0002383', '01JTE2E00000000000C0003383')) AS remaining_sessions,
  (SELECT COUNT(*) FROM user_role_assignments WHERE id IN ('01JTE2E00000000000C0004383', '01JTE2E00000000000C0005383')) AS remaining_role_assignments,
  (SELECT COUNT(*) FROM audit_logs WHERE actor_id IN ('01JTE2E00000000000C0002383', '01JTE2E00000000000C0003383')) AS remaining_audit_logs,
  (SELECT COUNT(*) FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署383') AS remaining_departments;
