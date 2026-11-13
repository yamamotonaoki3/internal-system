-- #123が作成した利用者とsessionだけを後始末する。全体の検証DB初期化と独立に使える。
-- #237：部屋を開くと既読位置（read_positions）の行ができ、利用者・部屋を外部キーで指すため、利用者・部屋より先に消す。
DELETE FROM read_positions WHERE user_id IN (SELECT id FROM users WHERE login_id IN ('e2euser_password_001', 'e2euser_password_002'));
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE login_id IN ('e2euser_password_001', 'e2euser_password_002'));
DELETE FROM audit_logs WHERE actor_id IN (SELECT id FROM users WHERE login_id IN ('e2euser_password_001', 'e2euser_password_002'));
DELETE FROM users WHERE login_id IN ('e2euser_password_001', 'e2euser_password_002');
