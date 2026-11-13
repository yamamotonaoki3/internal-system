-- #199 E2E の後始末。e2euser_account_ で始まる利用者と [E2E_TEST]アカウント発行部 だけを消す。
-- 子テーブル（sessions・audit_logs・channel_members・user_role_assignments）を先に消し、最後に利用者と部署を消す。
-- login_attempts は HMAC のキーで識別子から特定できないため対象外（検証DBの初期化 db:reset:test で消える）。
-- #237：部屋を開くと既読位置（read_positions）の行ができ、利用者・部屋を外部キーで指すため、利用者・部屋より先に消す。
DELETE FROM read_positions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_account!_%' ESCAPE '!');
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_account!_%' ESCAPE '!');
DELETE FROM audit_logs
WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_account!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_account!_%' ESCAPE '!');
-- #200：発行した利用者は全社連絡と所属部署の専用チャンネルに参加するため、参加の行も先に消す
DELETE FROM channel_members WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_account!_%' ESCAPE '!');
DELETE FROM user_role_assignments WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_account!_%' ESCAPE '!');
DELETE FROM users WHERE login_id LIKE 'e2euser!_account!_%' ESCAPE '!';
DELETE FROM departments WHERE id = '01JTE2E1990000000000000D01' AND name = '[E2E_TEST]アカウント発行部';
