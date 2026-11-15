-- #139 E2E専用の識別子だけを後始末する。ほかのシードには触れない。
DELETE FROM thread_read_positions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_mtn!_%' ESCAPE '!')
   OR parent_message_id IN (SELECT id FROM messages WHERE room_id = '01JTE2E1390000000000000C01');
DELETE FROM read_positions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_mtn!_%' ESCAPE '!')
   OR room_id = '01JTE2E1390000000000000C01';
DELETE FROM message_mentions
WHERE message_id IN (SELECT id FROM messages WHERE room_id = '01JTE2E1390000000000000C01');
DELETE FROM notifications
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_mtn!_%' ESCAPE '!')
   OR room_id = '01JTE2E1390000000000000C01';
DELETE FROM messages
WHERE room_id = '01JTE2E1390000000000000C01' AND parent_message_id IS NOT NULL;
DELETE FROM messages
WHERE room_id = '01JTE2E1390000000000000C01';
DELETE FROM audit_logs
WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_mtn!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_mtn!_%' ESCAPE '!')
   OR target_id = '01JTE2E1390000000000000D01';
DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_mtn!_%' ESCAPE '!');
DELETE FROM channel_members WHERE channel_id = '01JTE2E1390000000000000C01';
DELETE FROM channels WHERE room_id = '01JTE2E1390000000000000C01';
DELETE FROM rooms WHERE id = '01JTE2E1390000000000000C01';
DELETE FROM user_role_assignments
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_mtn!_%' ESCAPE '!')
   OR department_id = '01JTE2E1390000000000000D01';
UPDATE users SET status_updated_by = NULL
WHERE status_updated_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_mtn!_%' ESCAPE '!');
DELETE FROM users WHERE login_id LIKE 'e2euser!_mtn!_%' ESCAPE '!';
DELETE FROM departments WHERE id = '01JTE2E1390000000000000D01';
SELECT
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_mtn!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM departments WHERE id = '01JTE2E1390000000000000D01') AS remaining_departments,
  (SELECT COUNT(*) FROM rooms WHERE id = '01JTE2E1390000000000000C01') AS remaining_rooms,
  (SELECT COUNT(*) FROM messages WHERE room_id = '01JTE2E1390000000000000C01') AS remaining_messages,
  (SELECT COUNT(*) FROM notifications WHERE room_id = '01JTE2E1390000000000000C01') AS remaining_notifications;
