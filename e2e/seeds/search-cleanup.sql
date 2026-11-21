-- #155（155-A）E2E の後始末（e2e/search.spec.ts）。
-- 社員ID e2euser_search155_ で始まる利用者、部署名 [E2E_TEST]部署155 の部署・そのチャンネル、取引先名 テスト商事検索 [E2E_TEST] の案件、
-- search.sql が入れた固定の部屋だけを消す。検索の索引の行（search_documents・search_fts）は、消すメッセージの分と、元のメッセージのない分を消す。
-- 155-B：添付の写し（kind = 'attachment'）は、固定の部屋・消すメッセージに結ぶ分と、元の添付のない分を消す。添付の行（message_attachments）は、
--   メッセージより先に消す（R2 の実体は spec が先に消す）。残数の確認は、種類ごとの条件で数える（kind='message' は元のメッセージ、kind='attachment' は元の添付）。
-- 155-C：案件の件名の写し（kind = 'case_title'）は、search.sql の案件の分と、元の案件のない分を消す（残数も数える）。
-- 外部キーの順：検索の索引 → 既読位置 → リアクション → メッセージ → DM の当事者 → DM → 通知 → 監査 → セッション → 参加者
--   → 案件の担当部署 → 案件 → チャンネル → ルーム → ロール → 社員 → 取引先 → 部署。
-- LIKE のパターンは 50 バイト以内（D1）。部署名は先頭15文字の一致で絞る。
DELETE FROM search_fts
WHERE rowid IN (
  SELECT id FROM search_documents
  WHERE kind = 'message'
    AND (ref_id IN (SELECT id FROM messages
                     WHERE sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_search155!_%' ESCAPE '!')
                        OR room_id IN ('01JTE2E1550000000000000C01', '01JTE2E1550000000000000C02', '01JTE2E1550000000000000K01', '01JTE2E1550000000000000M01'))
      OR room_id IN ('01JTE2E1550000000000000C01', '01JTE2E1550000000000000C02', '01JTE2E1550000000000000K01', '01JTE2E1550000000000000M01')
      OR ref_id NOT IN (SELECT id FROM messages)));
DELETE FROM search_documents
WHERE kind = 'message'
  AND (ref_id IN (SELECT id FROM messages
                   WHERE sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_search155!_%' ESCAPE '!')
                      OR room_id IN ('01JTE2E1550000000000000C01', '01JTE2E1550000000000000C02', '01JTE2E1550000000000000K01', '01JTE2E1550000000000000M01'))
    OR room_id IN ('01JTE2E1550000000000000C01', '01JTE2E1550000000000000C02', '01JTE2E1550000000000000K01', '01JTE2E1550000000000000M01')
    OR ref_id NOT IN (SELECT id FROM messages));
DELETE FROM search_fts
WHERE rowid IN (
  SELECT id FROM search_documents
  WHERE kind = 'attachment'
    AND (room_id IN ('01JTE2E1550000000000000C01', '01JTE2E1550000000000000C02', '01JTE2E1550000000000000K01', '01JTE2E1550000000000000M01')
      OR ref_id LIKE '01JTE2E155B%'
      OR message_id IN (SELECT id FROM messages
                         WHERE sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_search155!_%' ESCAPE '!')
                            OR room_id IN ('01JTE2E1550000000000000C01', '01JTE2E1550000000000000C02', '01JTE2E1550000000000000K01', '01JTE2E1550000000000000M01'))
      OR ref_id NOT IN (SELECT id FROM message_attachments)));
DELETE FROM search_documents
WHERE kind = 'attachment'
  AND (room_id IN ('01JTE2E1550000000000000C01', '01JTE2E1550000000000000C02', '01JTE2E1550000000000000K01', '01JTE2E1550000000000000M01')
    OR ref_id LIKE '01JTE2E155B%'
    OR message_id IN (SELECT id FROM messages
                       WHERE sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_search155!_%' ESCAPE '!')
                          OR room_id IN ('01JTE2E1550000000000000C01', '01JTE2E1550000000000000C02', '01JTE2E1550000000000000K01', '01JTE2E1550000000000000M01'))
    OR ref_id NOT IN (SELECT id FROM message_attachments));
-- 155-C：案件の件名の写し（kind = 'case_title'）。search.sql の案件（S01）の分と、元の案件のない分を消す（search-reindex が既存の案件の件名も登録するため）
DELETE FROM search_fts
WHERE rowid IN (
  SELECT id FROM search_documents
  WHERE kind = 'case_title'
    AND (ref_id = '01JTE2E1550000000000000S01'
      OR ref_id IN (SELECT id FROM cases WHERE client_id IN (SELECT id FROM clients WHERE name = 'テスト商事検索 [E2E_TEST]'))
      OR ref_id NOT IN (SELECT id FROM cases)));
DELETE FROM search_documents
WHERE kind = 'case_title'
  AND (ref_id = '01JTE2E1550000000000000S01'
    OR ref_id IN (SELECT id FROM cases WHERE client_id IN (SELECT id FROM clients WHERE name = 'テスト商事検索 [E2E_TEST]'))
    OR ref_id NOT IN (SELECT id FROM cases));
DELETE FROM search_fts WHERE rowid NOT IN (SELECT id FROM search_documents);
DELETE FROM message_attachments
WHERE id LIKE '01JTE2E155B%'
   OR room_id IN ('01JTE2E1550000000000000C01', '01JTE2E1550000000000000C02', '01JTE2E1550000000000000K01', '01JTE2E1550000000000000M01')
   OR uploader_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_search155!_%' ESCAPE '!');
DELETE FROM read_positions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_search155!_%' ESCAPE '!')
   OR room_id IN ('01JTE2E1550000000000000C01', '01JTE2E1550000000000000C02', '01JTE2E1550000000000000K01', '01JTE2E1550000000000000M01');
DELETE FROM thread_read_positions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_search155!_%' ESCAPE '!')
   OR parent_message_id IN (SELECT id FROM messages
     WHERE room_id IN ('01JTE2E1550000000000000C01', '01JTE2E1550000000000000C02', '01JTE2E1550000000000000K01', '01JTE2E1550000000000000M01'));
DELETE FROM message_reactions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_search155!_%' ESCAPE '!')
   OR message_id IN (SELECT id FROM messages
     WHERE room_id IN ('01JTE2E1550000000000000C01', '01JTE2E1550000000000000C02', '01JTE2E1550000000000000K01', '01JTE2E1550000000000000M01'));
DELETE FROM message_mentions
WHERE message_id IN (SELECT id FROM messages
  WHERE room_id IN ('01JTE2E1550000000000000C01', '01JTE2E1550000000000000C02', '01JTE2E1550000000000000K01', '01JTE2E1550000000000000M01'));
DELETE FROM messages
WHERE parent_message_id IN (SELECT id FROM messages
  WHERE room_id IN ('01JTE2E1550000000000000C01', '01JTE2E1550000000000000C02', '01JTE2E1550000000000000K01', '01JTE2E1550000000000000M01'));
DELETE FROM messages
WHERE sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_search155!_%' ESCAPE '!')
   OR room_id IN ('01JTE2E1550000000000000C01', '01JTE2E1550000000000000C02', '01JTE2E1550000000000000K01', '01JTE2E1550000000000000M01');
DELETE FROM conversation_members
WHERE conversation_id = '01JTE2E1550000000000000M01'
   OR user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_search155!_%' ESCAPE '!');
DELETE FROM conversations WHERE room_id = '01JTE2E1550000000000000M01';
DELETE FROM notifications
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_search155!_%' ESCAPE '!');
DELETE FROM audit_logs
WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_search155!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_search155!_%' ESCAPE '!')
   OR target_id IN ('01JTE2E1550000000000000C01', '01JTE2E1550000000000000C02', '01JTE2E1550000000000000K01', '01JTE2E1550000000000000M01', '01JTE2E1550000000000000S01')
   OR target_id LIKE '01M78ZTJC000000000015500%';
DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_search155!_%' ESCAPE '!');
DELETE FROM channel_members
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_search155!_%' ESCAPE '!')
   OR channel_id IN ('01JTE2E1550000000000000C01', '01JTE2E1550000000000000C02', '01JTE2E1550000000000000K01');
DELETE FROM case_departments WHERE case_id = '01JTE2E1550000000000000S01';
DELETE FROM cases
WHERE id = '01JTE2E1550000000000000S01'
   OR client_id IN (SELECT id FROM clients WHERE name = 'テスト商事検索 [E2E_TEST]');
DELETE FROM channels
WHERE room_id IN ('01JTE2E1550000000000000C01', '01JTE2E1550000000000000C02', '01JTE2E1550000000000000K01')
   OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署155');
DELETE FROM rooms
WHERE id IN ('01JTE2E1550000000000000C01', '01JTE2E1550000000000000C02', '01JTE2E1550000000000000K01', '01JTE2E1550000000000000M01');
DELETE FROM user_role_assignments
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_search155!_%' ESCAPE '!')
   OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署155');
UPDATE users SET status_updated_by = NULL
WHERE status_updated_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_search155!_%' ESCAPE '!');
DELETE FROM users WHERE login_id LIKE 'e2euser!_search155!_%' ESCAPE '!';
DELETE FROM case_number_sequences
WHERE client_id IN (SELECT id FROM clients WHERE name = 'テスト商事検索 [E2E_TEST]');
DELETE FROM clients WHERE name = 'テスト商事検索 [E2E_TEST]';
DELETE FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署155';

-- 残りの件数（すべて 0 になることを確かめる。spec の beforeAll・afterAll が出力を照合する）
SELECT
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_search155!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署155') AS remaining_departments,
  (SELECT COUNT(*) FROM clients WHERE name = 'テスト商事検索 [E2E_TEST]') AS remaining_clients,
  (SELECT COUNT(*) FROM cases WHERE id = '01JTE2E1550000000000000S01') AS remaining_cases,
  (SELECT COUNT(*) FROM channels WHERE room_id LIKE '01JTE2E155%' OR substr(name, 1, 15) = '[E2E_TEST]部署155') AS remaining_channels,
  (SELECT COUNT(*) FROM rooms WHERE id LIKE '01JTE2E155%') AS remaining_rooms,
  (SELECT COUNT(*) FROM conversations WHERE room_id = '01JTE2E1550000000000000M01') AS remaining_conversations,
  (SELECT COUNT(*) FROM conversation_members
     WHERE conversation_id = '01JTE2E1550000000000000M01' OR user_id LIKE '01JTE2E155%') AS remaining_conversation_members,
  (SELECT COUNT(*) FROM messages WHERE sender_id LIKE '01JTE2E155%' OR room_id LIKE '01JTE2E155%') AS remaining_messages,
  (SELECT COUNT(*) FROM channel_members WHERE user_id LIKE '01JTE2E155%' OR channel_id LIKE '01JTE2E155%') AS remaining_channel_members,
  (SELECT COUNT(*) FROM sessions WHERE user_id LIKE '01JTE2E155%') AS remaining_sessions,
  (SELECT COUNT(*) FROM audit_logs WHERE actor_id LIKE '01JTE2E155%') AS remaining_audit_logs,
  (SELECT COUNT(*) FROM search_documents
     WHERE kind = 'message'
       AND (room_id LIKE '01JTE2E155%' OR ref_id LIKE '01M78ZTJC000000000015500%' OR ref_id NOT IN (SELECT id FROM messages))) AS remaining_search_documents,
  (SELECT COUNT(*) FROM search_documents
     WHERE kind = 'attachment'
       AND (room_id LIKE '01JTE2E155%' OR ref_id LIKE '01JTE2E155B%' OR message_id LIKE '01M78ZTJC000000000015500%'
         OR ref_id NOT IN (SELECT id FROM message_attachments))) AS remaining_attachment_search_documents,
  (SELECT COUNT(*) FROM message_attachments
     WHERE id LIKE '01JTE2E155B%' OR room_id LIKE '01JTE2E155%' OR uploader_id LIKE '01JTE2E155%') AS remaining_message_attachments,
  (SELECT COUNT(*) FROM search_documents
     WHERE kind = 'case_title'
       AND (ref_id = '01JTE2E1550000000000000S01' OR ref_id NOT IN (SELECT id FROM cases))) AS remaining_case_title_documents,
  (SELECT COUNT(*) FROM search_fts WHERE rowid NOT IN (SELECT id FROM search_documents)) AS remaining_orphan_search_fts;
