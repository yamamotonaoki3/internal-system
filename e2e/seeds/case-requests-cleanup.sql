-- #146（146-A）E2E専用。社員ID e2euser_casereq_、部署名 [E2E_TEST]部署146、取引先名 テスト商事 [E2E_TEST] の識別子だけを後始末する。
-- 外部キーの順：既読位置 → 通知 → 候補 → 申請の部署 → 申請（再申請の resubmitted_from の自己参照を先に NULL にしてから消す）→ 監査 → セッション →
--   ロールの割り当て → 参加 → 社員 → 部署 → 取引先。
-- 申請は「申請者が e2euser_casereq_ か、取引先が テスト商事 [E2E_TEST]」で絞る。
DELETE FROM read_positions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_casereq!_%' ESCAPE '!');
DELETE FROM notifications
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_casereq!_%' ESCAPE '!');
DELETE FROM case_creation_request_candidates
WHERE request_id IN (
    SELECT id FROM case_creation_requests
    WHERE requested_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_casereq!_%' ESCAPE '!')
       OR client_id IN (SELECT id FROM clients WHERE name = 'テスト商事 [E2E_TEST]'))
   OR user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_casereq!_%' ESCAPE '!')
   OR added_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_casereq!_%' ESCAPE '!');
DELETE FROM case_creation_request_departments
WHERE request_id IN (
    SELECT id FROM case_creation_requests
    WHERE requested_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_casereq!_%' ESCAPE '!')
       OR client_id IN (SELECT id FROM clients WHERE name = 'テスト商事 [E2E_TEST]'))
   OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署146');
UPDATE case_creation_requests SET resubmitted_from = NULL
WHERE requested_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_casereq!_%' ESCAPE '!')
   OR client_id IN (SELECT id FROM clients WHERE name = 'テスト商事 [E2E_TEST]');
DELETE FROM case_creation_requests
WHERE requested_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_casereq!_%' ESCAPE '!')
   OR client_id IN (SELECT id FROM clients WHERE name = 'テスト商事 [E2E_TEST]');
DELETE FROM audit_logs
WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_casereq!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_casereq!_%' ESCAPE '!');
DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_casereq!_%' ESCAPE '!');
DELETE FROM user_role_assignments
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_casereq!_%' ESCAPE '!')
   OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署146');
DELETE FROM channel_members
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_casereq!_%' ESCAPE '!');
DELETE FROM users WHERE login_id LIKE 'e2euser!_casereq!_%' ESCAPE '!';
DELETE FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署146';
DELETE FROM clients WHERE name = 'テスト商事 [E2E_TEST]';

-- 残りの件数（すべて 0 になることを確かめる。e2e/case-requests.spec.ts の afterAll が出力を照合する）
SELECT
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_casereq!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署146') AS remaining_departments,
  (SELECT COUNT(*) FROM clients WHERE name = 'テスト商事 [E2E_TEST]') AS remaining_clients,
  (SELECT COUNT(*) FROM case_creation_requests WHERE title LIKE '[E2E_TEST]%') AS remaining_requests,
  (SELECT COUNT(*) FROM case_creation_request_departments
     WHERE request_id NOT IN (SELECT id FROM case_creation_requests)) AS remaining_orphan_departments,
  (SELECT COUNT(*) FROM case_creation_request_candidates
     WHERE request_id NOT IN (SELECT id FROM case_creation_requests)) AS remaining_orphan_candidates,
  (SELECT COUNT(*) FROM notifications WHERE kind LIKE 'case_request.%') AS remaining_notifications;
