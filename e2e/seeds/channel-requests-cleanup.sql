-- #131 E2E専用。社員ID e2euser_chreq_、部署名 [E2E_TEST]部署131 で始まる部署、シードの固定のルーム（01JTE2E0000000000000003131・01JTE2E0000000000000004131）、
-- 識別子を持つ申請（申請者が e2euser_chreq_ か、部署が [E2E_TEST]部署131）の承認で作られたチャンネル（申請の channel_id）だけを後始末する。
-- ルームは識別子で絞れないため、シードの固定の ID と、識別子を持つ申請の channel_id だけを対象にする。そのため、申請は channels・rooms を消した後に消す。
-- 外部キーの順：通知 → 参加者 → チャンネル → ルーム → 申請（requested_by・decided_by・department_id の外部キーのため、利用者・部署より先）→ 監査 → セッション → ロール → 社員 → 部署。
-- #237：部屋を開くと既読位置（read_positions）の行ができ、利用者・部屋を外部キーで指すため、利用者・部屋より先に消す。
DELETE FROM read_positions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chreq!_%' ESCAPE '!')
   OR room_id IN ('01JTE2E0000000000000003131', '01JTE2E0000000000000004131')
   OR room_id IN (
     SELECT channel_id FROM channel_creation_requests
     WHERE channel_id IS NOT NULL
       AND (requested_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chreq!_%' ESCAPE '!')
         OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署131'))
   );
DELETE FROM notifications
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chreq!_%' ESCAPE '!');
DELETE FROM channel_members
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chreq!_%' ESCAPE '!')
   OR channel_id IN ('01JTE2E0000000000000003131', '01JTE2E0000000000000004131')
   OR channel_id IN (
     SELECT channel_id FROM channel_creation_requests
     WHERE channel_id IS NOT NULL
       AND (requested_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chreq!_%' ESCAPE '!')
         OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署131'))
   );
DELETE FROM channels
WHERE room_id IN ('01JTE2E0000000000000003131', '01JTE2E0000000000000004131')
   OR room_id IN (
     SELECT channel_id FROM channel_creation_requests
     WHERE channel_id IS NOT NULL
       AND (requested_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chreq!_%' ESCAPE '!')
         OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署131'))
   );
DELETE FROM rooms
WHERE id IN ('01JTE2E0000000000000003131', '01JTE2E0000000000000004131')
   OR id IN (
     SELECT channel_id FROM channel_creation_requests
     WHERE channel_id IS NOT NULL
       AND (requested_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chreq!_%' ESCAPE '!')
         OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署131'))
   );
DELETE FROM channel_creation_requests
WHERE requested_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chreq!_%' ESCAPE '!')
   OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署131');
DELETE FROM audit_logs
WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chreq!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chreq!_%' ESCAPE '!');
DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chreq!_%' ESCAPE '!');
DELETE FROM user_role_assignments
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chreq!_%' ESCAPE '!')
   OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署131');
DELETE FROM users WHERE login_id LIKE 'e2euser!_chreq!_%' ESCAPE '!';
DELETE FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署131';

-- 残りの件数（すべて 0 になることを確かめる。e2e/channel-requests.spec.ts の afterAll が出力を照合する）
SELECT
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_chreq!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署131') AS remaining_departments,
  (SELECT COUNT(*) FROM channels
     WHERE name_normalized LIKE 'e2e!_test!_chreq!_%' ESCAPE '!' OR substr(name, 1, 15) = '[E2E_TEST]部署131') AS remaining_channels,
  (SELECT COUNT(*) FROM rooms
     WHERE id IN ('01JTE2E0000000000000003131', '01JTE2E0000000000000004131')) AS remaining_seed_rooms,
  (SELECT COUNT(*) FROM channel_creation_requests
     WHERE name_normalized LIKE 'e2e!_test!_chreq!_%' ESCAPE '!') AS remaining_requests,
  (SELECT COUNT(*) FROM notifications WHERE kind LIKE 'channel_request.%') AS remaining_notifications;
