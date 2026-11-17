-- #156 E2E の後始末。e2euser_audit_ で始まる利用者と、[E2E_TEST]156監査部署、trace_id が '[E2E_TEST]audit-' で始まる監査ログと、
-- この spec の利用者が操作者の監査ログ（管理者が検索したときの閲覧の記録 audit_log.view やログインの記録を含む）だけを消す。
-- 監査ログは本番では消さない（0-6 AC-4）。ここで消すのは、識別子で絞った架空のテストデータだけ（外部キーはないが、利用者より先に消す）。
-- 順：audit_logs → read_positions → sessions → channel_members → user_role_assignments → users → departments。
-- login_attempts は HMAC のキーで識別子から特定できないため対象外（検証DBの初期化 db:reset:test で消える）。
DELETE FROM audit_logs
WHERE trace_id LIKE '[E2E_TEST]audit-%'
   OR actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_audit!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_audit!_%' ESCAPE '!');
DELETE FROM read_positions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_audit!_%' ESCAPE '!');
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_audit!_%' ESCAPE '!');
DELETE FROM channel_members WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_audit!_%' ESCAPE '!');
DELETE FROM user_role_assignments WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_audit!_%' ESCAPE '!');
DELETE FROM users WHERE login_id LIKE 'e2euser!_audit!_%' ESCAPE '!';
DELETE FROM departments WHERE id = '01JTE2E156A00000000000D001' AND name = '[E2E_TEST]156監査部署';

-- 残りの件数（すべて 0 になることを確かめる。e2e/audit-logs.spec.ts の beforeAll・afterAll が出力を照合する）
SELECT
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_audit!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM departments WHERE id = '01JTE2E156A00000000000D001') AS remaining_departments,
  (SELECT COUNT(*) FROM user_role_assignments WHERE id = '01JTE2E156A00000000000R001') AS remaining_assignments,
  (SELECT COUNT(*) FROM audit_logs
     WHERE trace_id LIKE '[E2E_TEST]audit-%'
        OR actor_id IN ('01JTE2E156A00000000000A001', '01JTE2E156A00000000000A002', '01JTE2E156A00000000000A003', '01JTE2E156A00000000000A004')
        OR target_id IN ('01JTE2E156A00000000000A001', '01JTE2E156A00000000000A002', '01JTE2E156A00000000000A003', '01JTE2E156A00000000000A004')) AS remaining_audits;
