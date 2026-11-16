-- #135 E2E専用。社員ID e2euser_chinv_、部署名 [E2E_TEST]部署135 で始まる部署、シードの固定のルーム（01JTE2E0000000000000003135・01JTE2E0000000000000004135）、
-- 識別子を持つ申請（申請者が e2euser_chinv_ か、部署が [E2E_TEST]部署135）の承認で作られたチャンネル（申請の channel_id）だけを後始末する。
-- 汎用の backend/db/seeds/cleanup.sql は作成申請を消さず、申請で作ったチャンネルも条件から外れるため使わない（channel-requests-cleanup.sql と同じ方式）。
-- 外部キーの順：既読位置 → 通知 → 参加者 → チャンネル → ルーム → 申請（チャンネル・ルームの後）→ 監査 → セッション → ロール → 社員 → 部署。
-- 招待の監査（channel.invite）と、招待の通知（channel.invited）も、操作者・宛先が e2euser_chinv_ の行として消す。
DELETE FROM read_positions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chinv!_%' ESCAPE '!')
   OR room_id IN ('01JTE2E0000000000000003135', '01JTE2E0000000000000004135')
   OR room_id IN (
     SELECT channel_id FROM channel_creation_requests
     WHERE channel_id IS NOT NULL
       AND (requested_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chinv!_%' ESCAPE '!')
         OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署135'))
   );
DELETE FROM notifications
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chinv!_%' ESCAPE '!');
DELETE FROM channel_members
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chinv!_%' ESCAPE '!')
   OR channel_id IN ('01JTE2E0000000000000003135', '01JTE2E0000000000000004135')
   OR channel_id IN (
     SELECT channel_id FROM channel_creation_requests
     WHERE channel_id IS NOT NULL
       AND (requested_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chinv!_%' ESCAPE '!')
         OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署135'))
   );
DELETE FROM channels
WHERE room_id IN ('01JTE2E0000000000000003135', '01JTE2E0000000000000004135')
   OR room_id IN (
     SELECT channel_id FROM channel_creation_requests
     WHERE channel_id IS NOT NULL
       AND (requested_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chinv!_%' ESCAPE '!')
         OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署135'))
   );
DELETE FROM rooms
WHERE id IN ('01JTE2E0000000000000003135', '01JTE2E0000000000000004135')
   OR id IN (
     SELECT channel_id FROM channel_creation_requests
     WHERE channel_id IS NOT NULL
       AND (requested_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chinv!_%' ESCAPE '!')
         OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署135'))
   );
DELETE FROM channel_creation_requests
WHERE requested_by IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chinv!_%' ESCAPE '!')
   OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署135');
DELETE FROM audit_logs
WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chinv!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chinv!_%' ESCAPE '!');
DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chinv!_%' ESCAPE '!');
DELETE FROM user_role_assignments
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chinv!_%' ESCAPE '!')
   OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署135');
-- #138：リアクション（message_reactions）は利用者・メッセージを外部キーで指すため、メッセージ・利用者より先に消す。付けた人がテストの利用者のものと、消すメッセージに付いたもの。
DELETE FROM message_reactions
WHERE user_id IN (SELECT id FROM users WHERE (login_id LIKE 'e2euser!_chinv!_%' ESCAPE '!'));
DELETE FROM users WHERE login_id LIKE 'e2euser!_chinv!_%' ESCAPE '!';
DELETE FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署135';

-- 残りの件数（すべて 0 になることを確かめる。e2e/channel-invite.spec.ts の beforeAll・afterAll が出力を照合する）
SELECT
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_chinv!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署135') AS remaining_departments,
  (SELECT COUNT(*) FROM channels
     WHERE name_normalized LIKE 'e2e!_test!_invite!_%' ESCAPE '!' OR substr(name, 1, 15) = '[E2E_TEST]部署135') AS remaining_channels,
  (SELECT COUNT(*) FROM rooms
     WHERE id IN ('01JTE2E0000000000000003135', '01JTE2E0000000000000004135')) AS remaining_seed_rooms,
  (SELECT COUNT(*) FROM channel_creation_requests
     WHERE name_normalized LIKE 'e2e!_test!_invite!_%' ESCAPE '!') AS remaining_requests,
  (SELECT COUNT(*) FROM notifications
     WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chinv!_%' ESCAPE '!')) AS remaining_notifications,
  (SELECT COUNT(*) FROM audit_logs
     WHERE action = 'channel.invite'
       AND actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chinv!_%' ESCAPE '!')) AS remaining_invite_audits;
