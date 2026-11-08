-- #192 E2E専用IDと名前接頭辞だけを後始末する。既存setup/login/role定義は残す。
DELETE FROM audit_logs
WHERE actor_id = '01JTE2E0000000000000000192'
   OR target_id IN (
     SELECT id FROM clients WHERE substr(name, 1, 16) = '[E2E_CLIENT_192]'
   );
DELETE FROM sessions WHERE user_id = '01JTE2E0000000000000000192';
DELETE FROM user_role_assignments WHERE user_id = '01JTE2E0000000000000000192';
DELETE FROM clients WHERE substr(name, 1, 16) = '[E2E_CLIENT_192]';
DELETE FROM users WHERE id = '01JTE2E0000000000000000192';
