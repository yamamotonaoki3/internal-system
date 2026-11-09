-- #200 E2E の後始末。社員ID e2euser_chan_ で始まる利用者（画面から発行した利用者を含む）と、部署名 [E2E_TEST]部署200 の部署・そのチャンネルだけを消す。
-- 全社連絡（migration が作る初期データ）は消さない。消すのは、e2euser_chan_ の利用者の参加の行だけ。
-- 外部キーの順：監査 → セッション → 参加者 → チャンネル → ルーム → ロール → 社員 → 部署。
DELETE FROM audit_logs
WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chan!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chan!_%' ESCAPE '!')
   OR target_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署200');
DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chan!_%' ESCAPE '!');
DELETE FROM channel_members
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chan!_%' ESCAPE '!')
   OR channel_id IN (
     SELECT room_id FROM channels
     WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署200')
   );
DELETE FROM channels
WHERE department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署200');
-- ルームは、channels.sql が入れた固定のIDだけを消す（チャンネルの行を先に消したため、外部キーに当たらない）
DELETE FROM rooms
WHERE id IN ('01JTE2E2000000000000000C01', '01JTE2E2000000000000000C02', '01JTE2E2000000000000000C03', '01JTE2E2000000000000000C04');
DELETE FROM user_role_assignments
WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chan!_%' ESCAPE '!')
   OR department_id IN (SELECT id FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署200');
DELETE FROM users WHERE login_id LIKE 'e2euser!_chan!_%' ESCAPE '!';
DELETE FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署200';

-- 残りの件数（すべて 0 になることを確かめる）
SELECT
  (SELECT COUNT(*) FROM users WHERE login_id LIKE 'e2euser!_chan!_%' ESCAPE '!') AS remaining_users,
  (SELECT COUNT(*) FROM departments WHERE substr(name, 1, 15) = '[E2E_TEST]部署200') AS remaining_departments,
  (SELECT COUNT(*) FROM channels WHERE substr(name, 1, 15) = '[E2E_TEST]部署200') AS remaining_channels,
  (SELECT COUNT(*) FROM channel_members WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_chan!_%' ESCAPE '!')) AS remaining_members;
