-- #237 E2E の後始末。社員ID e2euser_unread_ で始まる利用者と、部署名 [E2E_TEST]部署237 の部署・そのチャンネル、
-- その利用者が当事者に含まれる DM（シードの固定の DM）だけを消す。
-- 外部キーの順：既読位置（read_positions）→ メッセージ → 通知 → DM の当事者 → DM（conversations）→ 監査 → セッション
--   → 参加者 → チャンネル → ルーム → ロール → 社員 → 部署。
-- LIKE のパターンは 50 バイト以内（D1）。部署名は先頭15文字の一致で絞る。
-- 1. 既読位置（テストの利用者の行と、消す部屋の行）
DELETE FROM read_positions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_unread!_%' ESCAPE '!')
   OR room_id IN (
     SELECT room_id FROM channels
     WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署237')
   )
   OR room_id IN (
     SELECT conversation_id FROM conversation_members
     WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_unread!_%' ESCAPE '!')
   );
-- 2. メッセージ（テストの利用者の投稿、部署237のチャンネル、テストの利用者が当事者の DM）
DELETE FROM messages
WHERE sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_unread!_%' ESCAPE '!')
   OR room_id IN (
     SELECT room_id FROM channels
     WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署237')
   )
   OR room_id IN (
     SELECT conversation_id FROM conversation_members
     WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_unread!_%' ESCAPE '!')
   );
DELETE FROM notifications
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_unread!_%' ESCAPE '!');
-- 3. DM：当事者（その DM の全員分）→ DM → 部屋
DELETE FROM conversation_members
WHERE conversation_id IN (
  SELECT conversation_id FROM conversation_members
  WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_unread!_%' ESCAPE '!')
);
DELETE FROM conversations
WHERE room_id NOT IN (SELECT conversation_id FROM conversation_members)
  AND EXISTS (
    SELECT 1 FROM users u
    WHERE u.login_id LIKE 'e2euser!_unread!_%' ESCAPE '!'
      AND instr(conversations.direct_key, u.id) > 0
  );
DELETE FROM rooms
WHERE id = '01JTE2E2370000000000000M01';
-- 4. 監査・セッション
DELETE FROM audit_logs
WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_unread!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_unread!_%' ESCAPE '!');
DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_unread!_%' ESCAPE '!');
-- 5. 参加者 → チャンネル → ルーム（シードの固定の ID）
DELETE FROM channel_members
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_unread!_%' ESCAPE '!')
   OR channel_id IN (
     SELECT room_id FROM channels
     WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署237')
   );
DELETE FROM channels
WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署237');
DELETE FROM rooms
WHERE id IN ('01JTE2E2370000000000000C01', '01JTE2E2370000000000000C02', '01JTE2E2370000000000000C03');
-- 6. ロール → 社員 → 部署
DELETE FROM user_role_assignments
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_unread!_%' ESCAPE '!')
   OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署237');
UPDATE users SET status_updated_by = NULL
WHERE status_updated_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_unread!_%' ESCAPE '!');
DELETE FROM users WHERE login_id LIKE 'e2euser!_unread!_%' ESCAPE '!';
DELETE FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署237';

-- 残りの件数（すべて 0 になることを確かめる。e2e/unread.spec.ts の beforeAll・afterAll が出力を照合する）
SELECT
  (SELECT COUNT(*) FROM read_positions
     WHERE user_id LIKE '01JTE2E237%'
        OR room_id IN ('01JTE2E2370000000000000C01', '01JTE2E2370000000000000C02',
                       '01JTE2E2370000000000000C03', '01JTE2E2370000000000000M01')) AS remaining_read_positions,
  (SELECT COUNT(*) FROM messages
     WHERE sender_id LIKE '01JTE2E237%'
        OR room_id IN ('01JTE2E2370000000000000C01', '01JTE2E2370000000000000C02',
                       '01JTE2E2370000000000000C03', '01JTE2E2370000000000000M01')) AS remaining_messages,
  (SELECT COUNT(*) FROM channel_members
     WHERE user_id LIKE '01JTE2E237%' OR channel_id LIKE '01JTE2E237%') AS remaining_channel_members,
  (SELECT COUNT(*) FROM conversation_members WHERE user_id LIKE '01JTE2E237%') AS remaining_conversation_members,
  (SELECT COUNT(*) FROM conversations WHERE direct_key LIKE '%01JTE2E237%') AS remaining_conversations,
  (SELECT COUNT(*) FROM channels WHERE substr(name, 1, 15) = '[E2E_TEST]部署237') AS remaining_channels,
  (SELECT COUNT(*) FROM rooms
     WHERE id IN ('01JTE2E2370000000000000C01', '01JTE2E2370000000000000C02',
                  '01JTE2E2370000000000000C03', '01JTE2E2370000000000000M01')) AS remaining_rooms,
  (SELECT COUNT(*) FROM sessions WHERE user_id LIKE '01JTE2E237%') AS remaining_sessions,
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_unread!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署237') AS remaining_departments;
