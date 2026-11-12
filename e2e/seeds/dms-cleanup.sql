-- #136 E2E の後始末。社員ID e2euser_dm_ で始まる利用者と、部署名 [E2E_TEST]部署136 の部署・そのチャンネル、
-- その利用者が当事者に含まれる DM（シードの固定の DM と、spec の中で画面から作った DM）だけを消す。
-- 外部キーの順：DM のメッセージ → その DM の全員分の当事者（conversation_members）→ その DM（conversations）→ その部屋（rooms）
--   → チャンネルのメッセージ → 通知 → 監査 → セッション → 参加者 → チャンネル → ルーム → ロール → 社員 → 部署。
-- 1. テストの利用者が当事者に含まれる DM のメッセージ（相手の投稿も含む）
DELETE FROM messages
WHERE room_id IN (
  SELECT conversation_id FROM conversation_members
  WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_dm!_%' ESCAPE '!')
);
-- 2. その DM の全員分の当事者の行
DELETE FROM conversation_members
WHERE conversation_id IN (
  SELECT conversation_id FROM conversation_members
  WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_dm!_%' ESCAPE '!')
);
-- 3. その DM。当事者の行は 2 で消したため、当事者の行を持たず、direct_key（2人の利用者IDを ':' でつないだもの）にテストの利用者のIDを含むものだけを消す
DELETE FROM conversations
WHERE room_id NOT IN (SELECT conversation_id FROM conversation_members)
  AND EXISTS (
    SELECT 1 FROM users u
    WHERE u.login_id LIKE 'e2euser!_dm!_%' ESCAPE '!'
      AND instr(conversations.direct_key, u.id) > 0
  );
-- 4. その部屋。会話の行は 3 で消したため、会話の行もメッセージも持たない kind='direct' の部屋だけを消す（テスト用DBでだけ流す）
DELETE FROM rooms
WHERE kind = 'direct'
  AND id NOT IN (SELECT room_id FROM conversations)
  AND id NOT IN (SELECT room_id FROM messages);
-- 5. チャンネル（[E2E_TEST]部署136）のメッセージと、テストの利用者がほかの部屋に送ったメッセージ
DELETE FROM messages
WHERE sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_dm!_%' ESCAPE '!')
   OR room_id IN (
     SELECT room_id FROM channels
     WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署136')
   );
DELETE FROM notifications
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_dm!_%' ESCAPE '!');
DELETE FROM audit_logs
WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_dm!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_dm!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署136');
DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_dm!_%' ESCAPE '!');
DELETE FROM channel_members
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_dm!_%' ESCAPE '!')
   OR channel_id IN (
     SELECT room_id FROM channels
     WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署136')
   );
DELETE FROM channels
WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署136');
-- チャンネルのルームは、dms.sql が入れた固定のIDだけを消す（チャンネルの行を先に消したため、外部キーに当たらない）
DELETE FROM rooms WHERE id = '01JTE2E1360000000000000C01';
DELETE FROM user_role_assignments
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_dm!_%' ESCAPE '!')
   OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署136');
UPDATE users SET status_updated_by = NULL
WHERE status_updated_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_dm!_%' ESCAPE '!');
DELETE FROM users WHERE login_id LIKE 'e2euser!_dm!_%' ESCAPE '!';
DELETE FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署136';

-- 残りの件数（すべて 0 になることを確かめる。e2e/dms.spec.ts の afterAll が出力を照合する）
SELECT
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_dm!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署136') AS remaining_departments,
  (SELECT COUNT(*) FROM channels WHERE substr(name, 1, 15) = '[E2E_TEST]部署136') AS remaining_channels,
  (SELECT COUNT(*) FROM conversations WHERE direct_key LIKE '%01JTE2E136%') AS remaining_conversations,
  (SELECT COUNT(*) FROM conversation_members WHERE user_id LIKE '01JTE2E136%') AS remaining_conversation_members,
  (SELECT COUNT(*) FROM rooms
     WHERE id IN ('01JTE2E1360000000000000C01', '01JTE2E1360000000000000M01')
        OR (kind = 'direct' AND id NOT IN (SELECT room_id FROM conversations))) AS remaining_rooms,
  (SELECT COUNT(*) FROM messages
     WHERE sender_id LIKE '01JTE2E136%'
        OR room_id IN ('01JTE2E1360000000000000C01', '01JTE2E1360000000000000M01')) AS remaining_messages;
