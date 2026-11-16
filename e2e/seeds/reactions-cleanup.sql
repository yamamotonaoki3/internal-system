-- #138 E2E の後始末。社員ID e2euser_reaction_ で始まる利用者と、部署名 [E2E_TEST] リアクション の部署・そのチャンネルと、その部屋のメッセージ・リアクションだけを消す。
-- 外部キーの順：リアクション（message_reactions）→ スレッドの既読位置・既読位置 → 返信 → 親のメッセージ → 通知 → 監査・セッション
--   → 参加者 → チャンネル → ルーム → ロール → 社員 → 部署。
-- 削除するメッセージの集合は「テストの利用者が送ったもの、またはテストの部屋のもの」。リアクションは、付けた人がテストの利用者でなくても、その集合のメッセージに付いたものを消す。
-- LIKE のパターンは 50 バイト以内（D1）。部署名は先頭17文字の一致で絞る。
-- 1. リアクション（テストの利用者が付けたものと、集合のメッセージに付いたもの。集合のメッセージを親とする返信は、送った人・部屋がテストのものでなくても消す対象なので、その返信に付いたものも含める）
DELETE FROM message_reactions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_reaction!_%' ESCAPE '!')
   OR message_id IN (
     SELECT id FROM messages
     WHERE sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_reaction!_%' ESCAPE '!')
        OR room_id IN (
          SELECT room_id FROM channels
          WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 17) = '[E2E_TEST] リアクション')
        )
   )
   OR message_id IN (
     SELECT id FROM messages
     WHERE parent_message_id IN (
       SELECT id FROM messages
       WHERE sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_reaction!_%' ESCAPE '!')
        OR room_id IN (
          SELECT room_id FROM channels
          WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 17) = '[E2E_TEST] リアクション')
        )
     )
   );
-- 2. スレッドの既読位置・既読位置
DELETE FROM thread_read_positions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_reaction!_%' ESCAPE '!')
   OR parent_message_id IN (
     SELECT id FROM messages
     WHERE sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_reaction!_%' ESCAPE '!')
        OR room_id IN (
          SELECT room_id FROM channels
          WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 17) = '[E2E_TEST] リアクション')
        )
   );
DELETE FROM read_positions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_reaction!_%' ESCAPE '!')
   OR room_id IN (
     SELECT room_id FROM channels
     WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 17) = '[E2E_TEST] リアクション')
   );
-- 3. 返信（集合のメッセージを親とするものと、集合の返信。返信を先に）
DELETE FROM messages
WHERE parent_message_id IS NOT NULL
  AND (
    parent_message_id IN (
      SELECT id FROM messages
      WHERE sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_reaction!_%' ESCAPE '!')
         OR room_id IN (
           SELECT room_id FROM channels
           WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 17) = '[E2E_TEST] リアクション')
         )
    )
    OR sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_reaction!_%' ESCAPE '!')
    OR room_id IN (
      SELECT room_id FROM channels
      WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 17) = '[E2E_TEST] リアクション')
    )
  );
-- 4. 親のメッセージ（返信を消した後）
DELETE FROM messages
WHERE sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_reaction!_%' ESCAPE '!')
   OR room_id IN (
     SELECT room_id FROM channels
     WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 17) = '[E2E_TEST] リアクション')
   );
DELETE FROM notifications
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_reaction!_%' ESCAPE '!');
-- 5. 監査・セッション
DELETE FROM audit_logs
WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_reaction!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_reaction!_%' ESCAPE '!');
DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_reaction!_%' ESCAPE '!');
-- 6. 参加者 → チャンネル → ルーム（シードの固定の ID）
DELETE FROM channel_members
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_reaction!_%' ESCAPE '!')
   OR channel_id IN (
     SELECT room_id FROM channels
     WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 17) = '[E2E_TEST] リアクション')
   );
DELETE FROM channels
WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 17) = '[E2E_TEST] リアクション');
DELETE FROM rooms
WHERE id IN ('01JTE2E1380000000000000C01', '01JTE2E1380000000000000C02');
-- 7. ロール → 社員 → 部署
DELETE FROM user_role_assignments
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_reaction!_%' ESCAPE '!')
   OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 17) = '[E2E_TEST] リアクション');
UPDATE users SET status_updated_by = NULL
WHERE status_updated_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_reaction!_%' ESCAPE '!');
DELETE FROM users WHERE login_id LIKE 'e2euser!_reaction!_%' ESCAPE '!';
DELETE FROM departments WHERE substr(name, 1, 17) = '[E2E_TEST] リアクション';

-- 残りの件数（すべて 0 になることを確かめる。e2e/reactions.spec.ts の beforeAll・afterAll が出力を照合する）
SELECT
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_reaction!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM departments WHERE substr(name, 1, 17) = '[E2E_TEST] リアクション') AS remaining_departments,
  (SELECT COUNT(*) FROM rooms WHERE id IN ('01JTE2E1380000000000000C01', '01JTE2E1380000000000000C02')) AS remaining_rooms,
  (SELECT COUNT(*) FROM messages WHERE room_id IN ('01JTE2E1380000000000000C01', '01JTE2E1380000000000000C02')) AS remaining_messages,
  (SELECT COUNT(*) FROM message_reactions WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_reaction!_%' ESCAPE '!')
     OR message_id IN ('01M78ZTJC00000000000013801', '01M78ZTJC00000000000013802', '01M78ZTJC00000000000013803', '01M78ZTJC00000000000013804', '01M7938JW80000000000013811')) AS remaining_message_reactions;
