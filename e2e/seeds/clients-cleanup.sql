-- #192 E2E専用IDと名前接頭辞だけを後始末する。既存setup/login/role定義は残す。
-- #237：部屋を開くと既読位置（read_positions）の行ができ、利用者・部屋を外部キーで指すため、利用者・部屋より先に消す。
DELETE FROM read_positions WHERE user_id = '01JTE2E0000000000000000192';
DELETE FROM audit_logs
WHERE actor_id = '01JTE2E0000000000000000192'
   OR target_id IN (
     SELECT id FROM clients WHERE substr(name, 1, 16) = '[E2E_CLIENT_192]'
   );
DELETE FROM sessions WHERE user_id = '01JTE2E0000000000000000192';
DELETE FROM user_role_assignments WHERE user_id = '01JTE2E0000000000000000192';
DELETE FROM clients WHERE substr(name, 1, 16) = '[E2E_CLIENT_192]';
DELETE FROM users WHERE id = '01JTE2E0000000000000000192';
