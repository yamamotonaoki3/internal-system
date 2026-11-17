-- #128（128-c）E2E の後始末。e2euser_retire_ で始まる利用者と、[E2E_TEST]128c退職申請部署 だけを消す。
-- 順：notifications → retirement_requests → audit_logs → read_positions → sessions → channel_members → user_role_assignments → users → departments（外部キーの順）。
-- login_attempts は HMAC のキーで識別子から特定できないため対象外（検証DBの初期化 db:reset:test で消える）。
DELETE FROM notifications
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_retire!_%' ESCAPE '!');
DELETE FROM retirement_requests
WHERE requested_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_retire!_%' ESCAPE '!')
   OR target_user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_retire!_%' ESCAPE '!');
DELETE FROM audit_logs
WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_retire!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_retire!_%' ESCAPE '!');
DELETE FROM read_positions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_retire!_%' ESCAPE '!');
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_retire!_%' ESCAPE '!');
DELETE FROM channel_members WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_retire!_%' ESCAPE '!');
DELETE FROM user_role_assignments WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_retire!_%' ESCAPE '!');
DELETE FROM users WHERE login_id LIKE 'e2euser!_retire!_%' ESCAPE '!';
DELETE FROM departments WHERE id = '01JTE2E128C00000000000D001' AND name = '[E2E_TEST]128c退職申請部署';

-- 残りの件数（すべて 0 になることを確かめる。e2e/retirement-requests.spec.ts の beforeAll・afterAll が出力を照合する）
SELECT
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_retire!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM departments WHERE id = '01JTE2E128C00000000000D001') AS remaining_departments,
  (SELECT COUNT(*) FROM user_role_assignments WHERE id IN ('01JTE2E128C00000000000R001', '01JTE2E128C00000000000R002')) AS remaining_assignments,
  (SELECT COUNT(*) FROM retirement_requests
     WHERE target_user_id = '01JTE2E128C00000000000A003' OR requested_by = '01JTE2E128C00000000000A002') AS remaining_requests,
  (SELECT COUNT(*) FROM notifications WHERE kind LIKE 'retirement_request.%'
     AND user_id IN ('01JTE2E128C00000000000A001', '01JTE2E128C00000000000A002')) AS remaining_notifications,
  (SELECT COUNT(*) FROM audit_logs
     WHERE target_id IN ('01JTE2E128C00000000000A003')
        OR actor_id IN ('01JTE2E128C00000000000A001', '01JTE2E128C00000000000A002')) AS remaining_audits;
