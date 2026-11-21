-- #155（155-C）E2E の後始末（e2e/search-cases.spec.ts）。
-- 社員ID e2euser_search155c_ で始まる利用者、部署名 [E2E_TEST]部署155C の部署、取引先名 E2E検索取引先155C [E2E_TEST] の案件、
-- search-cases.sql が入れた固定の ID（01JTE2E155C で始まる）だけを消す。件名の索引の行（search_documents の kind = 'case_title' と search_fts）は、
-- この E2E の案件の分と、元の案件のない分を消す（再編集で作り直された行を含む）。
-- 外部キーの順：件名の索引 → 既読位置 → 通知 → 監査 → セッション → 参加者 → 案件の担当部署 → 案件 → チャンネル → ルーム → ロール → 社員 → 連番 → 取引先 → 部署。
-- LIKE のパターンは 50 バイト以内（D1）。
DELETE FROM search_fts
WHERE rowid IN (
  SELECT id FROM search_documents
  WHERE kind = 'case_title'
    AND (ref_id LIKE '01JTE2E155C%'
      OR ref_id IN (SELECT id FROM cases WHERE client_id IN (SELECT id FROM clients WHERE name = 'E2E検索取引先155C [E2E_TEST]'))
      OR ref_id NOT IN (SELECT id FROM cases)));
DELETE FROM search_documents
WHERE kind = 'case_title'
  AND (ref_id LIKE '01JTE2E155C%'
    OR ref_id IN (SELECT id FROM cases WHERE client_id IN (SELECT id FROM clients WHERE name = 'E2E検索取引先155C [E2E_TEST]'))
    OR ref_id NOT IN (SELECT id FROM cases));
DELETE FROM search_fts WHERE rowid NOT IN (SELECT id FROM search_documents);
DELETE FROM read_positions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_search155c!_%' ESCAPE '!')
   OR room_id LIKE '01JTE2E155C%';
DELETE FROM notifications
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_search155c!_%' ESCAPE '!')
   OR room_id LIKE '01JTE2E155C%';
DELETE FROM audit_logs
WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_search155c!_%' ESCAPE '!')
   OR target_id LIKE '01JTE2E155C%';
DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_search155c!_%' ESCAPE '!');
DELETE FROM channel_members
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_search155c!_%' ESCAPE '!')
   OR channel_id LIKE '01JTE2E155C%';
DELETE FROM case_departments WHERE case_id LIKE '01JTE2E155C%';
DELETE FROM cases
WHERE id LIKE '01JTE2E155C%'
   OR client_id IN (SELECT id FROM clients WHERE name = 'E2E検索取引先155C [E2E_TEST]');
DELETE FROM channels WHERE room_id LIKE '01JTE2E155C%';
DELETE FROM rooms WHERE id LIKE '01JTE2E155C%';
DELETE FROM user_role_assignments
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_search155c!_%' ESCAPE '!')
   OR id LIKE '01JTE2E155C%';
UPDATE users SET status_updated_by = NULL
WHERE status_updated_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_search155c!_%' ESCAPE '!');
DELETE FROM users WHERE login_id LIKE 'e2euser!_search155c!_%' ESCAPE '!';
DELETE FROM case_number_sequences
WHERE client_id IN (SELECT id FROM clients WHERE name = 'E2E検索取引先155C [E2E_TEST]');
DELETE FROM clients WHERE name = 'E2E検索取引先155C [E2E_TEST]';
DELETE FROM departments WHERE name = '[E2E_TEST]部署155C';

-- 残りの件数（すべて 0 になることを確かめる。spec の beforeAll・afterAll が出力を照合する）
SELECT
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_search155c!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM departments WHERE name = '[E2E_TEST]部署155C') AS remaining_departments,
  (SELECT COUNT(*) FROM clients WHERE name = 'E2E検索取引先155C [E2E_TEST]') AS remaining_clients,
  (SELECT COUNT(*) FROM cases WHERE id LIKE '01JTE2E155C%') AS remaining_cases,
  (SELECT COUNT(*) FROM channels WHERE room_id LIKE '01JTE2E155C%') AS remaining_channels,
  (SELECT COUNT(*) FROM rooms WHERE id LIKE '01JTE2E155C%') AS remaining_rooms,
  (SELECT COUNT(*) FROM channel_members WHERE channel_id LIKE '01JTE2E155C%' OR user_id LIKE '01JTE2E155C%') AS remaining_channel_members,
  (SELECT COUNT(*) FROM sessions WHERE user_id LIKE '01JTE2E155C%') AS remaining_sessions,
  (SELECT COUNT(*) FROM audit_logs WHERE actor_id LIKE '01JTE2E155C%' OR target_id LIKE '01JTE2E155C%') AS remaining_audit_logs,
  (SELECT COUNT(*) FROM search_documents
     WHERE kind = 'case_title' AND (ref_id LIKE '01JTE2E155C%' OR ref_id NOT IN (SELECT id FROM cases))) AS remaining_case_title_documents,
  (SELECT COUNT(*) FROM search_fts WHERE rowid NOT IN (SELECT id FROM search_documents)) AS remaining_orphan_search_fts;
