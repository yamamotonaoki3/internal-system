-- #134 E2E専用（e2e/messages-edit-delete.spec.ts・e2e/messages-markdown.spec.ts）の架空データ。投稿の編集・削除（1-3）とマークダウンの表示（1-5）を確かめる。
-- 部署1件（[E2E_TEST]部署134）・社員3人・公開チャンネル2つ・A と B の DM 1つを入れる。
--   e2euser_edit134_a（A）：編集・削除をする本人。C01 の参加者。B との DM の当事者
--   e2euser_edit134_b（B）：他人。C01 の参加者。B との DM の当事者。開き直しで反映を確かめる別の利用者
--   e2euser_edit134_c（C）：マークダウンの表示を確かめる利用者。C02 の参加者
--   C01 [E2E_TEST]部署134の編集：A の投稿4件・B の投稿1件
--   C02 [E2E_TEST]部署134の記法：記法・HTML・危険なリンクを書いた C の投稿
--   M01（DM）：A の投稿2件・B の投稿1件
-- 後始末は messages-edit-cleanup.sql（社員ID e2euser_edit134_・部署名 [E2E_TEST]部署134・下の固定の部屋のIDだけ）。
-- パスワードのハッシュは、既存の架空ログインfixture（e2euser_login_001）の行から参照して、ここに値を書かない。
-- 本名は架空の平文で入れる（test 環境の seed-file が、e2euser_ の平文の本名を各利用者のIDで暗号化する）。
-- 本文は [E2E_TEST] で始める。リンクは example.com・example.org だけ。改行は char(10) で入れる。
-- 前提：#134 の migration（messages の edited_at・deleted_at・deleted_by）が適用済み。新しい列は入れず、NULL（未編集・未削除）のままにする。
INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
VALUES
  ('01JTE2E1340000000000000D01', '[E2E_TEST]部署134', '[e2e_test]部署134', 1,
   '2026-11-12T00:00:00.000Z', '', 1, '2026-11-12T00:00:00.000Z');

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E1340000000000000A01', 'e2euser_edit134_a', 'e2euser_edit134_a',
  'E2E編集利用者A', 'テスト本名編集A',
  'e2euser_edit134_a@example.com', 'e2euser_edit134_a@example.com',
  '01JTE2E1340000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E1340000000000000A02', 'e2euser_edit134_b', 'e2euser_edit134_b',
  'E2E編集利用者B', 'テスト本名編集B',
  'e2euser_edit134_b@example.com', 'e2euser_edit134_b@example.com',
  '01JTE2E1340000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

INSERT INTO users (
  id, login_id, login_id_normalized, display_name, legal_name,
  email, email_normalized, department_id, password_hash, must_change_password, is_active
)
SELECT
  '01JTE2E1340000000000000A03', 'e2euser_edit134_c', 'e2euser_edit134_c',
  'E2E記法利用者C', 'テスト本名記法C',
  'e2euser_edit134_c@example.com', 'e2euser_edit134_c@example.com',
  '01JTE2E1340000000000000D01', password_hash, 0, 1
FROM users WHERE login_id = 'e2euser_login_001';

-- 編集・削除の権限（perm.message.edit.own・perm.message.delete.own）と DM の閲覧は、一般のロールが持つ
INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES
  ('01JTE2E1340000000000000R01', '01JTE2E1340000000000000A01', 'role_member', 'company', NULL, '2026-11-12T00:00:00.000Z'),
  ('01JTE2E1340000000000000R02', '01JTE2E1340000000000000A02', 'role_member', 'company', NULL, '2026-11-12T00:00:00.000Z'),
  ('01JTE2E1340000000000000R03', '01JTE2E1340000000000000A03', 'role_member', 'company', NULL, '2026-11-12T00:00:00.000Z');

INSERT INTO rooms (id, kind, created_at) VALUES
  ('01JTE2E1340000000000000C01', 'channel', '2026-11-12T00:00:00.000Z'),
  ('01JTE2E1340000000000000C02', 'channel', '2026-11-12T00:00:00.000Z'),
  ('01JTE2E1340000000000000M01', 'direct', '2026-11-12T00:00:00.000Z');

INSERT INTO channels (
  room_id, department_id, name, name_normalized, description, visibility, purpose,
  created_by, version, created_at, updated_at, deleted_at, deleted_by
) VALUES
  ('01JTE2E1340000000000000C01', '01JTE2E1340000000000000D01', '[E2E_TEST]部署134の編集',
   '[e2e_test]部署134の編集', '', 'public', 'normal', NULL, 1,
   '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z', NULL, NULL),
  ('01JTE2E1340000000000000C02', '01JTE2E1340000000000000D01', '[E2E_TEST]部署134の記法',
   '[e2e_test]部署134の記法', '', 'public', 'normal', NULL, 1,
   '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z', NULL, NULL);

INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES
  ('01JTE2E1340000000000000C01', '01JTE2E1340000000000000A01', '2026-11-12T00:00:00.000Z'),
  ('01JTE2E1340000000000000C01', '01JTE2E1340000000000000A02', '2026-11-12T00:00:00.000Z'),
  ('01JTE2E1340000000000000C02', '01JTE2E1340000000000000A03', '2026-11-12T00:00:00.000Z');

-- A と B の DM。direct_key は2人の利用者IDを小さい順に ':' でつないだもの
INSERT INTO conversations (room_id, direct_key, created_at) VALUES
  ('01JTE2E1340000000000000M01',
   '01JTE2E1340000000000000A01:01JTE2E1340000000000000A02',
   '2026-11-12T00:00:00.000Z');
INSERT INTO conversation_members (conversation_id, user_id) VALUES
  ('01JTE2E1340000000000000M01', '01JTE2E1340000000000000A01'),
  ('01JTE2E1340000000000000M01', '01JTE2E1340000000000000A02');

-- 投稿。ID は ULID の形（時刻部分 2026-11-12T23:00:00.000Z = 01M78ZTJC0）で、後ろの16桁を連番にして昇順にする
-- C01：編集・削除（チャンネル）
INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at) VALUES
  ('01M78ZTJC00000000001340001', '01JTE2E1340000000000000C01', '01JTE2E1340000000000000A01',
   'E2E編集利用者A', '[E2E_TEST]Aの編集する投稿', '2026-11-12T23:00:00.000Z'),
  ('01M78ZTJC00000000001340002', '01JTE2E1340000000000000C01', '01JTE2E1340000000000000A01',
   'E2E編集利用者A', '[E2E_TEST]Aの削除する投稿', '2026-11-12T23:00:00.000Z'),
  ('01M78ZTJC00000000001340003', '01JTE2E1340000000000000C01', '01JTE2E1340000000000000A02',
   'E2E編集利用者B', '[E2E_TEST]Bの投稿', '2026-11-12T23:00:00.000Z'),
  ('01M78ZTJC00000000001340004', '01JTE2E1340000000000000C01', '01JTE2E1340000000000000A01',
   'E2E編集利用者A', '[E2E_TEST]開き直しで確かめる編集の投稿', '2026-11-12T23:00:00.000Z'),
  ('01M78ZTJC00000000001340005', '01JTE2E1340000000000000C01', '01JTE2E1340000000000000A01',
   'E2E編集利用者A', '[E2E_TEST]開き直しで確かめる削除の投稿', '2026-11-12T23:00:00.000Z');

-- M01：編集・削除（DM）
INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at) VALUES
  ('01M78ZTJC00000000001340006', '01JTE2E1340000000000000M01', '01JTE2E1340000000000000A01',
   'E2E編集利用者A', '[E2E_TEST]DMのAの編集する投稿', '2026-11-12T23:00:00.000Z'),
  ('01M78ZTJC00000000001340007', '01JTE2E1340000000000000M01', '01JTE2E1340000000000000A01',
   'E2E編集利用者A', '[E2E_TEST]DMのAの削除する投稿', '2026-11-12T23:00:00.000Z'),
  ('01M78ZTJC00000000001340008', '01JTE2E1340000000000000M01', '01JTE2E1340000000000000A02',
   'E2E編集利用者B', '[E2E_TEST]DMのBの投稿', '2026-11-12T23:00:00.000Z');

-- C02：マークダウンの表示
INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at) VALUES
  ('01M78ZTJC00000000001340011', '01JTE2E1340000000000000C02', '01JTE2E1340000000000000A03',
   'E2E記法利用者C',
   '[E2E_TEST]**記法の太字** と *記法の斜体* と ~~記法の取り消し~~ と `記法のコード` と ~記法の1つの波~',
   '2026-11-12T23:00:00.000Z'),
  ('01M78ZTJC00000000001340012', '01JTE2E1340000000000000C02', '01JTE2E1340000000000000A03',
   'E2E記法利用者C',
   '[E2E_TEST]箇条書き' || char(10) || char(10) || '- 記法の一つ目' || char(10) || '- 記法の二つ目',
   '2026-11-12T23:00:00.000Z'),
  ('01M78ZTJC00000000001340013', '01JTE2E1340000000000000C02', '01JTE2E1340000000000000A03',
   'E2E記法利用者C',
   '[E2E_TEST]番号' || char(10) || char(10) || '1. 記法の最初' || char(10) || '2. 記法の次',
   '2026-11-12T23:00:00.000Z'),
  ('01M78ZTJC00000000001340014', '01JTE2E1340000000000000C02', '01JTE2E1340000000000000A03',
   'E2E記法利用者C',
   '[E2E_TEST]引用とコード' || char(10) || char(10) || '> 記法の引用' || char(10) || char(10)
     || '```' || char(10) || 'const 記法 = 1' || char(10) || '```',
   '2026-11-12T23:00:00.000Z'),
  ('01M78ZTJC00000000001340015', '01JTE2E1340000000000000C02', '01JTE2E1340000000000000A03',
   'E2E記法利用者C',
   '[E2E_TEST]リンク [記法のリンク](https://example.com) と https://example.org/page',
   '2026-11-12T23:00:00.000Z'),
  ('01M78ZTJC00000000001340016', '01JTE2E1340000000000000C02', '01JTE2E1340000000000000A03',
   'E2E記法利用者C', '[E2E_TEST]<img src=x onerror=alert(1)>', '2026-11-12T23:00:00.000Z'),
  ('01M78ZTJC00000000001340017', '01JTE2E1340000000000000C02', '01JTE2E1340000000000000A03',
   'E2E記法利用者C', '[E2E_TEST]<script>alert(1)</script>', '2026-11-12T23:00:00.000Z'),
  ('01M78ZTJC00000000001340018', '01JTE2E1340000000000000C02', '01JTE2E1340000000000000A03',
   'E2E記法利用者C', '[E2E_TEST][記法の危険なリンク](javascript:alert(1))', '2026-11-12T23:00:00.000Z'),
  ('01M78ZTJC00000000001340019', '01JTE2E1340000000000000C02', '01JTE2E1340000000000000A03',
   'E2E記法利用者C',
   '[E2E_TEST]整形しない記法' || char(10) || char(10) || '# 記法の見出し' || char(10) || char(10)
     || '| a | b |' || char(10) || '| --- | --- |' || char(10) || '| 1 | 2 |' || char(10) || char(10)
     || '![記法の画像](https://example.com/a.png)' || char(10) || char(10)
     || '- [ ] 記法のタスク' || char(10) || char(10) || '---',
   '2026-11-12T23:00:00.000Z'),
  ('01M78ZTJC00000000001340020', '01JTE2E1340000000000000C02', '01JTE2E1340000000000000A03',
   'E2E記法利用者C', '[E2E_TEST]記法の一行目' || char(10) || '記法の二行目', '2026-11-12T23:00:00.000Z');
