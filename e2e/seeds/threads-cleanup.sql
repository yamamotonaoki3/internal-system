-- #137 E2E の後始末。社員ID e2euser_thr_ で始まる利用者と、部署名 [E2E_TEST]部署137 の部署・そのチャンネルと、その部屋のメッセージだけを消す。
-- 外部キーの順：スレッドの既読位置（thread_read_positions）・既読位置（read_positions）→ 返信 → 親のメッセージ → 通知 → 監査・セッション
--   → 参加者 → チャンネル → ルーム → ロール → 社員 → 部署。
-- 削除するメッセージの集合は「テストの利用者が送ったもの、またはテストの部屋のもの」。次の順で消す。
--   ① その集合のメッセージを親とする thread_read_positions（読んだ人がテストの利用者でなくても）と、テストの利用者の thread_read_positions
--   ② その集合のメッセージを親とする返信（送った人がテストの利用者でなくても）と、集合の返信（返信を先に。親が先だと外部キーに当たる）
--   ③ 集合の親のメッセージ
-- LIKE のパターンは 50 バイト以内（D1）。部署名は先頭15文字の一致で絞る。
-- 1. スレッドの既読位置・既読位置
DELETE FROM thread_read_positions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_thr!_%' ESCAPE '!')
   OR parent_message_id IN (
     SELECT id FROM messages
     WHERE sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_thr!_%' ESCAPE '!')
        OR room_id IN (
          SELECT room_id FROM channels
          WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署137')
        )
   );
DELETE FROM read_positions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_thr!_%' ESCAPE '!')
   OR room_id IN (
     SELECT room_id FROM channels
     WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署137')
   );
-- 2. 返信（集合のメッセージを親とするものと、集合の返信）
-- #138：リアクション（message_reactions）は利用者・メッセージを外部キーで指すため、メッセージ・利用者より先に消す。付けた人がテストの利用者のものと、消すメッセージに付いたもの。
DELETE FROM message_reactions
WHERE user_id IN (SELECT id FROM users WHERE (login_id LIKE 'e2euser!_thr!_%' ESCAPE '!'))
   OR message_id IN (SELECT id FROM messages WHERE (parent_message_id IS NOT NULL AND ( parent_message_id IN ( SELECT id FROM messages WHERE sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_thr!_%' ESCAPE '!') OR room_id IN ( SELECT room_id FROM channels WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署137') ) ) OR sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_thr!_%' ESCAPE '!') OR room_id IN ( SELECT room_id FROM channels WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署137') ) )) OR (sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_thr!_%' ESCAPE '!') OR room_id IN ( SELECT room_id FROM channels WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署137') )));
DELETE FROM messages
WHERE parent_message_id IS NOT NULL
  AND (
    parent_message_id IN (
      SELECT id FROM messages
      WHERE sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_thr!_%' ESCAPE '!')
         OR room_id IN (
           SELECT room_id FROM channels
           WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署137')
         )
    )
    OR sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_thr!_%' ESCAPE '!')
    OR room_id IN (
      SELECT room_id FROM channels
      WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署137')
    )
  );
-- 3. 親のメッセージ（返信を消した後）
DELETE FROM messages
WHERE sender_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_thr!_%' ESCAPE '!')
   OR room_id IN (
     SELECT room_id FROM channels
     WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署137')
   );
DELETE FROM notifications
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_thr!_%' ESCAPE '!');
-- 4. 監査・セッション
DELETE FROM audit_logs
WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_thr!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_thr!_%' ESCAPE '!');
DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_thr!_%' ESCAPE '!');
-- 5. 参加者 → チャンネル → ルーム（シードの固定の ID）
DELETE FROM channel_members
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_thr!_%' ESCAPE '!')
   OR channel_id IN (
     SELECT room_id FROM channels
     WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署137')
   );
DELETE FROM channels
WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署137');
DELETE FROM rooms
WHERE id IN ('01JTE2E1370000000000000C01', '01JTE2E1370000000000000C02');
-- 6. ロール → 社員 → 部署
DELETE FROM user_role_assignments
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_thr!_%' ESCAPE '!')
   OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署137');
UPDATE users SET status_updated_by = NULL
WHERE status_updated_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_thr!_%' ESCAPE '!');
DELETE FROM users WHERE login_id LIKE 'e2euser!_thr!_%' ESCAPE '!';
DELETE FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署137';

-- 残りの件数（すべて 0 になることを確かめる。e2e/threads.spec.ts の beforeAll・afterAll が出力を照合する）
SELECT
  (SELECT COUNT(*) FROM thread_read_positions
     WHERE user_id LIKE '01JTE2E137%' OR parent_message_id LIKE '01M78ZTJC00000000000013%') AS remaining_thread_read_positions,
  (SELECT COUNT(*) FROM read_positions
     WHERE user_id LIKE '01JTE2E137%'
        OR room_id IN ('01JTE2E1370000000000000C01', '01JTE2E1370000000000000C02')) AS remaining_read_positions,
  (SELECT COUNT(*) FROM messages
     WHERE parent_message_id IS NOT NULL
       AND (sender_id LIKE '01JTE2E137%'
            OR room_id IN ('01JTE2E1370000000000000C01', '01JTE2E1370000000000000C02'))) AS remaining_replies,
  (SELECT COUNT(*) FROM messages
     WHERE sender_id LIKE '01JTE2E137%'
        OR room_id IN ('01JTE2E1370000000000000C01', '01JTE2E1370000000000000C02')) AS remaining_messages,
  (SELECT COUNT(*) FROM channel_members
     WHERE user_id LIKE '01JTE2E137%' OR channel_id LIKE '01JTE2E137%') AS remaining_channel_members,
  (SELECT COUNT(*) FROM channels WHERE substr(name, 1, 15) = '[E2E_TEST]部署137') AS remaining_channels,
  (SELECT COUNT(*) FROM rooms
     WHERE id IN ('01JTE2E1370000000000000C01', '01JTE2E1370000000000000C02')) AS remaining_rooms,
  (SELECT COUNT(*) FROM sessions WHERE user_id LIKE '01JTE2E137%') AS remaining_sessions,
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_thr!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署137') AS remaining_departments;
