-- #128（128-a）E2E の後始末。e2euser_deact_ で始まる利用者と [E2E_TEST]128部署 だけを消す。
-- 順：notifications → audit_logs → sessions → channel_members → user_role_assignments → users → departments（外部キーの順）。
-- login_attempts は HMAC のキーで識別子から特定できないため対象外（検証DBの初期化 db:reset:test で消える）。
-- 既読位置（read_positions）・リアクション（message_reactions）は利用者を外部キーで指すため、利用者より先に消す。
DELETE FROM notifications
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_deact!_%' ESCAPE '!');
DELETE FROM audit_logs
WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_deact!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_deact!_%' ESCAPE '!');
DELETE FROM read_positions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_deact!_%' ESCAPE '!');
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_deact!_%' ESCAPE '!');
DELETE FROM channel_members WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_deact!_%' ESCAPE '!');
DELETE FROM user_role_assignments WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_deact!_%' ESCAPE '!');
DELETE FROM message_reactions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_deact!_%' ESCAPE '!');
DELETE FROM users WHERE login_id LIKE 'e2euser!_deact!_%' ESCAPE '!';
DELETE FROM departments WHERE id = '01JTE2E1280000000000000D01' AND name = '[E2E_TEST]128部署';

-- 残りの件数（すべて 0 になることを確かめる。e2e/accounts-lifecycle.spec.ts の beforeAll・afterAll が出力を照合する）
SELECT
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_deact!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM departments WHERE id = '01JTE2E1280000000000000D01') AS remaining_departments,
  (SELECT COUNT(*) FROM user_role_assignments WHERE id IN ('01JTE2E1280000000000000R01', '01JTE2E1280000000000000R02')) AS remaining_assignments,
  (SELECT COUNT(*) FROM audit_logs
     WHERE action IN ('account.deactivate', 'account.reactivate')
       AND target_id = '01JTE2E1280000000000000A02') AS remaining_audits;
