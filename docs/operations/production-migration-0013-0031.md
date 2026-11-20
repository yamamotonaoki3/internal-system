# 本番の D1 に migration 0013〜0031 と埋め戻しの SQL を当てる手順書

- 関係：Issue #333（この手順書）、#160（リリース前の検証・利用者の決定・実行の記録）、Skill「env-deploy」、[ADR-0005](../adr/0005-database-d1-only.md)、[ADR-0024](../adr/0024-add-column-rewrite-for-table-rebuild.md)、[ADR-0025](../adr/0025-rebuild-referenced-table-defer-foreign-keys.md)、決定 C-88・C-127・C-164・C-169、[T-05 の調査](../research/T-05-d1-backup-recovery.md)、設計書 [unread.md](../design/unread.md)・[dms.md](../design/dms.md)・[department-management.md](../design/department-management.md)
- 作った日：2026-11-20（main `e4c92f8` の時点の SQL を読んで書いた）

> **この手順書の、すべての `--remote` のコマンドと本番への操作は、利用者が実行する。AI は実行しない。**
> 実行の前に、下の「9. 承認」の欄で、範囲・手順・戻し方を確かめて承認する。1 つでも「違ったら止める」に当たったら、その場で止めて、#160 に結果を書く。

## 目次

1. 目的と範囲
2. 対象の一覧（migration ごと）
3. 当てる前の確認
4. 当てる順とコマンド
5. 埋め戻しの SQL
6. 当てた後の確認
7. 失敗したときの扱いと戻し方
8. 所要の見込みと、利用者への影響
9. 承認
10. 未決定・確かめが要る点の一覧

この手順書の中で、**「SQL を読んで確かめた」**と書いたことは、`backend/db/migrations/` と `backend/db/scripts/` のファイルを読んで確かめたことである。**「確かめが要る」**と書いたことは、AI が確かめていないことで、10 章に集めた。

---

## 1. 目的と範囲

### 当てるもの

- migration：`backend/db/migrations/` の **0013〜0031 の 19 本**（#160 の記録では、本番に当たっている最後は 0012。**AI は本番の状態を確かめていない**。3 章の手順で、利用者が確かめる）
- 埋め戻しの SQL：
  - `backend/db/scripts/backfill-case-auto-participants.sql`（案件の自動参加の人を補う。#147。Issue #333 の範囲）
  - `backend/db/scripts/backfill-read-positions.sql`（既読位置の初期合わせ。C-169。**Issue #333 の本文には書かれていないが、0018 を当てるときに必須とされている**〔設計書 [unread.md](../design/unread.md) の「既存データ」〕。含めるかを 9 章で利用者が決める。10 章 U-1）

### 当てないもの

- 検索（#155）の migration 0032・0033 と、既存のメッセージの索引の作成（次の区切り。#160 の 2026-11-20 の決定）
- `backend/db/scripts/backfill-owner-channel-members.sql`（C-164。「本番は 0008〜0012 の適用の承認と同じ枠」とされている。本番で流したかの記録を AI は見つけられなかった。10 章 U-2）
- 秘密情報（`wrangler secret`）・R2 のバケット・独自ドメインの設定。ただし、アプリのデプロイの前提になるため、3 章で「あるか」だけを確かめる

### 誰が実行するか

- 利用者が、自分の PC のターミナルで実行する。Cloudflare に、本番のアカウントでログインしている必要がある
- AI は、`--remote` のコマンド・`wrangler deploy`・`time-travel restore` など、本番に触れる操作を実行しない

---

## 2. 対象の一覧（migration ごと）

### 読み方

- **破壊的**：表の作り直し（`CREATE TABLE __new_…` → コピー → `DROP` → `RENAME`）・列の削除・既存のデータの書き換え（`UPDATE`・`DELETE`）・既存の行が違反しうる制約の追加
- **既存のデータへの影響**：本番に今ある行が、当てた後にどうなるか
- **戻し方**：「Time Travel」は、3 章で控えた時点に DB 全体を戻すこと（7 章）。「逆の SQL」は、足したものを消す SQL（**この手順書では用意していない**。7 章）

### 一覧

| 番号 | ファイル | 何をするか（SQL を読んで確かめた） | 関係する機能・Issue | 破壊的か | 既存のデータへの影響 | 戻し方 |
| --- | --- | --- | --- | --- | --- | --- |
| 0013 | `0013_add_user_status.sql` | `users` に列 5 つを追加（`status_kind` は `DEFAULT 'available' NOT NULL` と 5 値の CHECK つき、`status_updated_by` は `users` への REFERENCES つき）。`users` に索引 2 つを追加。ADR-0024 で、作り直しを ADD COLUMN に書き換えたもの | 在席状態（#130） | いいえ（作り直しなし） | 既存の全社員の `status_kind` が `'available'`、ほかの 4 列は NULL になる。既定値が CHECK を満たすため、違反は起きない | Time Travel。逆の SQL は、CHECK・REFERENCES・索引つきの列は SQLite の `DROP COLUMN` で消せないため、`users` の作り直しが要る（危険。採らない） |
| 0014 | `0014_add_notifications.sql` | 表 `notifications` と索引 2 つを追加 | 通知 | いいえ | なし | Time Travel／新しい表を `DROP TABLE` |
| 0015 | `0015_add_channel_creation_requests.sql` | 表 `channel_creation_requests` と索引 3 つ（うち一意 1 つ）を追加 | チャンネルの作成の申請 | いいえ | なし | Time Travel／`DROP TABLE` |
| **0016** | `0016_change_room_kind_to_direct.sql` | **表 `rooms` の作り直し**。`__new_rooms` を作り、全行をコピーし、`rooms` を `DROP` して `RENAME`。CHECK を `('channel','conversation')` から `('channel','direct')` に変える。外部キーの検査を `PRAGMA defer_foreign_keys` で後回しにする（ADR-0025） | DM（#136） | **はい（表の作り直し）**。`rooms` は `channels`・`messages` から参照されている | 行の値は変わらない（`id`・`kind`・`created_at` をそのままコピー）。**`kind = 'conversation'` の行が 1 件でもあると、CHECK の違反で 0016 全体が失敗する**（ADR-0025）。3 章の手順 9 で 0 件を確かめる | Time Travel。逆の SQL（もう一度作り直す）は採らない |
| 0017 | `0017_add_conversations.sql` | 表 `conversations`・`conversation_members` と索引 2 つ（うち一意 1 つ）を追加 | DM（#136） | いいえ | なし | Time Travel／`DROP TABLE` |
| 0018 | `0018_add_read_positions.sql` | 表 `read_positions` を追加 | 未読（#237） | いいえ | なし。ただし**この直後に `backfill-read-positions.sql` を流す決まり**（C-169。5 章） | Time Travel／`DROP TABLE` |
| 0019 | `0019_add_message_edit_delete.sql` | `messages` に列 `edited_at`・`deleted_at`・`deleted_by`（`users` への REFERENCES つき）を追加 | メッセージの編集・削除 | いいえ | 既存のメッセージは 3 列とも NULL（編集・削除されていない扱い） | Time Travel。逆の SQL は REFERENCES つきの列を `DROP COLUMN` で消せないため採らない |
| 0020 | `0020_add_message_threads.sql` | 表 `thread_read_positions` を追加。`messages` に列 `parent_message_id`（`messages` への REFERENCES つき）を追加。`messages` に索引 2 つを追加 | スレッド（返信） | いいえ | 既存のメッセージは `parent_message_id` が NULL（返信でない投稿）。**索引の作成で `messages` の全行を読む**（件数が多いと時間がかかる。8 章） | Time Travel |
| 0021 | `0021_add_message_mentions.sql` | 表 `message_mentions` と索引 1 つを追加 | メンション | いいえ | なし | Time Travel／`DROP TABLE` |
| 0022 | `0022_add_message_reactions.sql` | 表 `message_reactions` と索引 1 つを追加 | リアクション | いいえ | なし | Time Travel／`DROP TABLE` |
| 0023 | `0023_add_message_attachments.sql` | 表 `message_attachments` と索引 4 つ（うち一意 1 つ）を追加 | 添付（#140） | いいえ | なし。**アプリのデプロイには、本番の R2 のバケットが要る**（`docs/secrets.md`。3 章の手順 13） | Time Travel／`DROP TABLE` |
| 0024 | `0024_add_case_creation_requests.sql` | 表 `case_creation_requests`・`case_creation_request_candidates`・`case_creation_request_departments` と索引 4 つを追加 | 案件の申請（#148 ほか） | いいえ | なし | Time Travel／`DROP TABLE` |
| 0025 | `0025_add_retirement_requests.sql` | 表 `retirement_requests` と索引 3 つ（うち一意 1 つ）を追加 | 退職の申請 | いいえ | なし | Time Travel／`DROP TABLE` |
| 0026 | `0026_add_cases.sql` | 表 `cases`・`case_departments`・`case_number_sequences` と索引 5 つ（うち一意 3 つ）を追加 | 案件（#148） | いいえ | なし。**当てた直後の `cases` は 0 行**（5 章の埋め戻しの対象が 0 件になる理由） | Time Travel／`DROP TABLE` |
| 0027 | `0027_add_audit_log_filter_indexes.sql` | `audit_logs` に索引 3 つを追加 | 監査ログの絞り込み | いいえ | 行は変わらない。**索引の作成で `audit_logs` の全行を読む**（8 章） | Time Travel／`DROP INDEX` |
| 0028 | `0028_add_channel_archive_events.sql` | 表 `channel_archive_events` と索引 2 つ（うち一意 1 つ）を追加 | チャンネルのアーカイブ | いいえ | なし | Time Travel／`DROP TABLE` |
| 0029 | `0029_add_case_todos.sql` | 表 `case_todos`・`case_todo_events` と索引 2 つを追加 | 案件の TODO（#149） | いいえ | なし | Time Travel／`DROP TABLE` |
| 0030 | `0030_add_attachment_publication_visibility.sql` | `message_attachments` に列 `publication_visibility`（`DEFAULT 'participants_only' NOT NULL` と 2 値の CHECK つき）を追加。ADR-0024 で ADD COLUMN に書き換えたもの | 添付の公開範囲（#150） | いいえ（作り直しなし） | `message_attachments` は 0023 で作ったばかりで、本番では 0 行の見込み。行があっても `'participants_only'` が入り、CHECK を満たす | Time Travel。逆の SQL は CHECK つきの列を `DROP COLUMN` で消せないため採らない |
| 0031 | `0031_add_case_todos_assignee_index.sql` | `case_todos` に索引 1 つを追加 | 案件の TODO（#149） | いいえ | なし | Time Travel／`DROP INDEX` |

### 破壊的なもののまとめ（AC-2）

- **破壊的なのは 0016 の 1 本だけ**（表 `rooms` の作り直し）。注意点：
  1. 当てる前に `rooms` の `kind = 'conversation'` が 0 件であることを確かめる（1 件以上なら、当てずに止める。ADR-0025 の「守ること」1）
  2. D1 では `PRAGMA foreign_keys=OFF` が効かないため、`defer_foreign_keys` に置き換えてある（ADR-0025）。手元の使い捨ての D1 のリハーサルで、データのある DB に通ることを確かめ済み（ADR-0025 の (a)〜(g)）。**本番では未実施**
  3. 当てた後に、`rooms`・`channels`・`messages`・`channel_members` の件数が当てる前と同じであることと、外部キーの違反がないことを確かめる（6 章）
- **列の削除・既存のデータの書き換え（`UPDATE`・`DELETE`）は、0013〜0031 のどこにもない**（SQL を読んで確かめた）
- **NOT NULL の列の追加**は 0013・0030 の 2 本。どちらも既定値つきで、既定値が CHECK を満たすため、既存の行が違反することはない

---

## 3. 当てる前の確認

### 準備するもの

- 作業する PC に、このリポジトリを置き、**デプロイする版**を取り出しておく（10 章 U-3。候補は main の `e4c92f8`）。その版の `backend/db/migrations/` の最後が **0031** であることを、エクスプローラーなどで確かめる。**0032・0033 があったら止める**（`migrations apply` は、未適用のものを全部当てるため、検索の migration まで当たってしまう）
- `npm install` が済んでいること（`npx wrangler` で、リポジトリに固定した版の wrangler が動く）
- この手順書のコマンドは、リポジトリの一番上のフォルダ（`package.json` があるところ）で実行する
- DB の名前は `internal-system-db`（`wrangler.jsonc` の `database_name`）。本番の ID・トークンは、コマンドにも、この手順書にも書かない

### 手順

1. **ログインしているアカウントを確かめる**

   ```sh
   npx wrangler whoami
   ```

   - 見るべき結果：本番の Cloudflare アカウントが表示される
   - 違ったら：止める。`npx wrangler login` でログインし直してから、もう一度確かめる

2. **本番の migration の状態を確かめる**（読み取りだけ）

   ```sh
   npx wrangler d1 migrations list internal-system-db --remote
   ```

   - 見るべき結果：未適用の一覧が、**`0013_add_user_status.sql` から `0031_add_case_todos_assignee_index.sql` までの 19 本ちょうど**
   - 違ったら：止める。0012 より前が未適用・0013 より後の一部が適用済み・0032 以降が出る、のどれでも、#160 に出力を貼って AI に相談する

3. **Time Travel の、いまの時点（ブックマーク）を控える**（Skill「env-deploy」の「本番 DB の変更」、ADR-0025 の手順 2）

   ```sh
   npx wrangler d1 time-travel info internal-system-db
   ```

   - 見るべき結果：いまのブックマーク（長い文字列）が表示される
   - 控え方：表示されたブックマークと、実行した日時を、#160 の実行の記録に書く（ブックマークは時点の印で、秘密情報ではない）
   - 違ったら（エラーになる・表示されない）：止める。戻す手段がないまま当てない

4. **（任意）書き出しによる控え**：このプロジェクトでは、定期の書き出しは設けない（C-127）。当てる前の 1 回だけの書き出し（`wrangler d1 export`）をするかは**未決定**（10 章 U-4）。決めるまで、Time Travel だけを戻す手段とする。なお、書き出しは実行中に他の要求を止め（T-05）、書き出したファイルには個人情報が入るため、リポジトリの中に置かない

5. **Time Travel の保持期間を確かめる**：Cloudflare の管理画面または公式ページで、いまのプランの保持期間（有料は最大 30 日、無料は 7 日。C-127）を確かめる。戻す必要が出たら、その期間の内に戻す

6. **アプリの、いまのデプロイの版を控える**

   ```sh
   npx wrangler deployments list
   ```

   - 見るべき結果：いま本番で動いている版（Version の ID と日時）
   - 控え方：#160 に書く。7 章でアプリを前の版に戻すときに使う
   - このコマンドの出力の形は、AI は本番で確かめていない（10 章 U-5）。出力が読めないときは、止めて AI に相談する

7. **本番の Worker に入っている秘密情報の名前を確かめる**（値は表示されない）

   ```sh
   npx wrangler secret list
   ```

   - 見るべき結果：`docs/secrets.md` の「設定する項目の一覧」で、本番に入れるとされている項目の名前がそろっている
   - 違ったら：migration は当ててよいが、**アプリのデプロイはしない**。足りない項目を `docs/secrets.md` の手順で入れてから進む

8. **当てる前の件数を控える**（読み取りだけ。当てた後に見比べる）

   ```sh
   npx wrangler d1 execute internal-system-db --remote --command "SELECT 'users' AS t, COUNT(*) AS n FROM users UNION ALL SELECT 'departments', COUNT(*) FROM departments UNION ALL SELECT 'rooms', COUNT(*) FROM rooms UNION ALL SELECT 'channels', COUNT(*) FROM channels UNION ALL SELECT 'channel_members', COUNT(*) FROM channel_members UNION ALL SELECT 'messages', COUNT(*) FROM messages UNION ALL SELECT 'audit_logs', COUNT(*) FROM audit_logs UNION ALL SELECT 'clients', COUNT(*) FROM clients UNION ALL SELECT 'user_role_assignments', COUNT(*) FROM user_role_assignments"
   ```

   - 見るべき結果：9 行の表（表の名前と件数）
   - 控え方：#160 に件数を書く（件数だけ。行の中身は書かない）
   - 違ったら（エラーになる）：止める。表がない場合は、本番が 0012 まで当たっていない可能性がある

9. **0016 の前提を確かめる**（ADR-0025 の「守ること」1）

   ```sh
   npx wrangler d1 execute internal-system-db --remote --command "SELECT kind, COUNT(*) AS n FROM rooms GROUP BY kind"
   ```

   - 見るべき結果：`channel` の行だけ（件数は手順 8 の `rooms` と同じ）
   - 違ったら（`conversation` など、`channel` 以外の行がある）：**止める**。0016 が CHECK の違反で失敗するため。#160 に件数を書いて AI に相談する

10. **所要の見込みを立てる**：手順 8 の `messages` と `audit_logs` の件数を見る。8 章を読んで、作業の時間帯を決める

11. **デプロイする版を、手元で確かめる**（Skill「env-deploy」：本番へは、検証で確認済みの同じ版を出す）。デプロイする版で、品質チェック（`npm run check`）と本番形の E2E（`npm run test:e2e:prod`）が通っていることを、#160・PR の記録で確かめる。**`test:e2e:prod` は、手元で本番用にビルドした画面を、手元の検証用の DB で確かめるもので、本番の Cloudflare には触れない**（`playwright.prod.config.ts`）

12. **埋め戻しの SQL を流すかを決める**：9 章の承認の欄で、`backfill-read-positions.sql` を含めるか（U-1）を決めておく

13. **本番の R2 のバケットがあるかを確かめる**（読み取りだけ）

    ```sh
    npx wrangler r2 bucket list
    ```

    - 見るべき結果：`internal-system-attachments` がある
    - 違ったら：migration は当ててよいが、**アプリのデプロイはしない**。バケットの作り方（Terraform か wrangler か）は未決定（10 章 U-6）

14. **`wrangler.jsonc` の `ALLOWED_ORIGINS` を確かめる**：いまの値は手元の画面の URL（`http://localhost:5173`）。このままデプロイすると、本番の画面からの、状態を変える要求（投稿・申請など）が通らない見込み（10 章 U-7）。本番の値が決まって反映されるまで、**アプリのデプロイはしない**

---

## 4. 当てる順とコマンド

### 順番の考え方

- **migration を先に、アプリのデプロイを後に**する。新しいコードは、新しい表・列（`cases`・`case_todos`・`read_positions`・`message_attachments` など）を前提にするため、先にデプロイすると、それらを使う API が DB のエラーになる
- 古いコード（いま本番で動いている版）は、新しい表・列があっても動く見込み。0016 以外は「追加」だけで、既存の列・値を変えないため。0016 は `rooms.kind` の許す値を `conversation` から `direct` に変えるが、ADR-0025 によると、古いコードは `channel` だけを書く。**ただし、いま本番で動いている版が、ADR-0025 の言う「古いコード」と同じかは、AI は確かめていない**（10 章 U-5）
- `backfill-read-positions.sql` は、**0018 の後、アプリのデプロイの前**に流す（C-169）。今回は 0013〜0031 をまとめて当てるため、「全部の migration の後、デプロイの前」に流す
- `backfill-case-auto-participants.sql` は、**0026 の後**ならいつでもよい（`cases`・`case_departments` を読むため）。デプロイの前に流す（5 章のとおり、対象は 0 件の見込み）

### 全体の順

1. 3 章の確認（すべて通っていること）
2. migration 0013〜0031 を当てる（下の手順 A）
3. `backfill-read-positions.sql` を流す（5 章の 5-2。承認した場合）
4. `backfill-case-auto-participants.sql` を流す（5 章の 5-1）
5. 当てた後の確認（6 章の 6-1〜6-3）
6. アプリをデプロイする（下の手順 B）
7. デプロイの後の確認（6 章の 6-4）
8. #160 に記録する

### 手順 A：migration を当てる

1. 次を実行する

   ```sh
   npx wrangler d1 migrations apply internal-system-db --remote
   ```

2. 当てる前に、当てる一覧が表示され、続けるかを聞かれる
   - 見るべき結果：一覧が 0013〜0031 の 19 本ちょうど（3 章の手順 2 と同じ）
   - 違ったら：**続けずに断る**（`n` を入れる）。止める
3. 続ける（`y` を入れる）
   - 見るべき結果：19 本それぞれに成功の印が付き、エラーが出ずに終わる
   - 違ったら（途中で失敗した）：**それ以上の操作をしない**。7 章の「途中で失敗したとき」へ進む。アプリはデプロイしない

### 手順 B：アプリをデプロイする

- **このプロジェクトでは、本番へのデプロイのコマンドが、まだ文書・npm スクリプトに決まっていない**（10 章 U-8）。`infra/README.md` は「Worker のコードのデプロイは wrangler」とだけ定める。画面は Worker と同じ設定（`wrangler.jsonc` の `assets`）で配信される
- AI が想定する形は「`npm run build` でビルドしてから、`npx wrangler deploy` で出す」だが、`@cloudflare/vite-plugin` を使っているため、ビルドの出力からデプロイする正しい形は**確かめが要る**。決まるまで、手順 B を実行しない（migration と埋め戻しは、先に済ませてよい。古いコードは新しい表・列があっても動く見込みのため）
- 決まったら、デプロイの直後に 6 章の 6-4 を行う

---

## 5. 埋め戻しの SQL（AC-3）

### 5-1. `backfill-case-auto-participants.sql`（案件の自動参加の人を補う）

**何をするか**（SQL を読んで確かめた）：`channel_members` に行を足す（`INSERT … SELECT`）。2 つの文がある。

1. 有効な全体管理者（`user_role_assignments` で `role_id = 'role_global_admin'` かつ `scope_type = 'company'`、`users.is_active = 1`）を、**すべての案件**（`cases`。進行中・終了とも）の専用チャンネル（`cases.channel_id`）に入れる
2. 担当部署（`case_departments`）の有効なオーナー（`role_id = 'role_owner'`）を、その案件の専用チャンネルに入れる（複数の担当部署を兼ねても 1 行だけ）

- 対象の行の条件：上の人のうち、その案件のチャンネルに**まだ参加していない**人（`WHERE NOT EXISTS`）。案件専用でないチャンネルには触れない
- **本番での見込み：対象は 0 件**。`cases` は 0026 で新しく作る表で、当てた直後は 0 行のため（2 章）。デプロイの後に作られる案件は、新しいコードが作るときに自動参加の人を入れる。それでも、手順として流して 0 件であることを確かめる（害はない）

**流す前に、対象の件数を確かめる**（読み取りだけ）

```sh
npx wrangler d1 execute internal-system-db --remote --command "SELECT COUNT(*) AS n FROM (SELECT k.channel_id, u.id FROM cases k JOIN user_role_assignments g ON g.role_id = 'role_global_admin' AND g.scope_type = 'company' JOIN users u ON u.id = g.user_id AND u.is_active = 1 WHERE NOT EXISTS (SELECT 1 FROM channel_members m WHERE m.channel_id = k.channel_id AND m.user_id = u.id) UNION SELECT k.channel_id, u.id FROM cases k JOIN case_departments cd ON cd.case_id = k.id JOIN user_role_assignments o ON o.role_id = 'role_owner' AND o.department_id = cd.department_id JOIN users u ON u.id = o.user_id AND u.is_active = 1 WHERE NOT EXISTS (SELECT 1 FROM channel_members m WHERE m.channel_id = k.channel_id AND m.user_id = u.id))"
```

- 見るべき結果：`n` が 0（デプロイの前に流す場合）
- 0 でなかったら：止める。`cases` に行がある理由（本番が 0012 より先まで当たっていた等）を、#160 に書いて AI に相談する

**流す**

```sh
npx wrangler d1 execute internal-system-db --remote --file backend/db/scripts/backfill-case-auto-participants.sql
```

- 見るべき結果：エラーなく終わる

**流した後の確かめ**：上の「対象の件数」と同じコマンドをもう一度実行し、`n` が 0 であることを確かめる。0 でなければ、もう一度流してから確かめる（べき等のため）。2 回目でも 0 にならなければ止める

**何度実行しても同じ結果になるか（べき等か）**：**べき等である**（SQL を読んで判断した）。2 つの文とも `WHERE NOT EXISTS` で、参加済みの組には行を足さない。2 回目以降は、まだ参加していない組だけが足され、すでにある行の `joined_at` は変わらない。2 つ目の文は `SELECT DISTINCT` で、同じ組を 1 文の中で 2 回足さない。ただし、1 つ目の文と 2 つ目の文で同じ人（全体管理者でありオーナーでもある人）が対象になる場合、1 つ目で入り、2 つ目は `NOT EXISTS` で足さない

**戻し方**：足した行を、ほかの参加の行と確実に見分ける印（タグ・専用の列）は**ない**。`joined_at` は流した時刻になるが、同じ時刻に普通の参加が起きることもあるため、時刻だけで消すのは確実でない。本番での対象は 0 件の見込みなので、戻す必要は出ない見込み。行が足された場合に戻すときは、Time Travel で流す前の時点に戻す（7 章）

### 5-2. `backfill-read-positions.sql`（既読位置の初期合わせ。承認した場合だけ）

**何をするか**（SQL を読んで確かめた）：`read_positions` に行を足す。チャンネルの参加者（`channel_members` の全行。アーカイブ済みのチャンネルも含む）と DM の当事者（`conversation_members`）の、利用者×部屋のうち、メッセージがある部屋について、既読の位置を、その時点の部屋の最新のメッセージ ID にする

- なぜ要るか：既読位置がないままデプロイすると、既存の利用者のチャンネルが「99+」の未読になりうる（C-169。設計書 [unread.md](../design/unread.md)）
- 対象の行の条件：メッセージがあり、まだ既読位置がない、利用者×部屋。`conversation_members` は 0017 で作る表で、本番では 0 行の見込み。実際の対象は、チャンネルの参加者の分

**流す前に、対象の件数を確かめる**（読み取りだけ）

```sh
npx wrangler d1 execute internal-system-db --remote --command "SELECT COUNT(*) AS n FROM (SELECT cm.user_id AS user_id, cm.channel_id AS room_id FROM channel_members cm UNION ALL SELECT conv.user_id, conv.conversation_id FROM conversation_members conv) t WHERE EXISTS (SELECT 1 FROM messages m WHERE m.room_id = t.room_id) AND NOT EXISTS (SELECT 1 FROM read_positions r WHERE r.user_id = t.user_id AND r.room_id = t.room_id)"
```

- 見るべき結果：0 以上の件数（控えて #160 に書く）

**流す**

```sh
npx wrangler d1 execute internal-system-db --remote --file backend/db/scripts/backfill-read-positions.sql
```

**流した後の確かめ**：上の「対象の件数」と同じコマンドを実行し、`n` が 0 であることを確かめる。0 でなければ、流し直す（べき等）。0 にならないのは、手順の間も古いコードで投稿・参加が続くため（[unread.md](../design/unread.md)）。0 になったら、間を空けずに 4 章の手順 B（デプロイ）へ進む

**べき等か**：**べき等である**（SQL を読んで判断した）。`ON CONFLICT (user_id, room_id) DO NOTHING` の 1 文で、すでにある既読位置は変えない。何度流しても、まだない行だけが増える

**戻し方**：`read_positions` は 0018 で作る新しい表で、当てた直後は 0 行のため、デプロイの前なら、表の中の行はすべてこの SQL が足したものになる。ただし、戻す必要は低い（既読位置があっても、古いコードは読まない）。戻す場合は Time Travel を使う（7 章）

### 5-3. 件数が多くて失敗したとき

D1 の 1 回の実行の時間の上限に当たって失敗した場合は、どちらの SQL もべき等なので、流し直してよい。それでも終わらないときは、止めて AI に相談する（[unread.md](../design/unread.md) と同じ扱い）

---

## 6. 当てた後の確認

### 6-1. migration の状態

```sh
npx wrangler d1 migrations list internal-system-db --remote
```

- 見るべき結果：未適用の migration がない
- 違ったら：止める。7 章へ

### 6-2. 表と索引があること

```sh
npx wrangler d1 execute internal-system-db --remote --command "SELECT type, name FROM sqlite_master WHERE name IN ('notifications','channel_creation_requests','conversations','conversation_members','read_positions','thread_read_positions','message_mentions','message_reactions','message_attachments','case_creation_requests','case_creation_request_candidates','case_creation_request_departments','retirement_requests','cases','case_departments','case_number_sequences','channel_archive_events','case_todos','case_todo_events','users_directory_idx','messages_parent_message_id_id_idx','audit_logs_actor_occurred_idx','case_todos_assignee_id_id_idx') ORDER BY type, name"
```

- 見るべき結果：表（`table`）19 行と、索引（`index`）4 行の、合わせて 23 行
- 違ったら：止める。足りない名前を #160 に書く

### 6-3. 件数の見比べと、0016 の整合

1. 3 章の手順 8 と同じコマンドを実行し、9 つの表の件数が、控えた件数と**同じ**であることを確かめる（migration は既存の行を足し引きしないため。デプロイの前で、古いコードで利用が続いていると、`messages`・`audit_logs` などは増えることがある。増えた分は、その間の利用によるものかを見て判断する。**減っていたら止める**）
2. `rooms` の種類を確かめる

   ```sh
   npx wrangler d1 execute internal-system-db --remote --command "SELECT kind, COUNT(*) AS n FROM rooms GROUP BY kind"
   ```

   - 見るべき結果：`channel` の行だけで、件数が当てる前と同じ（または利用で増えた分だけ多い）

3. 外部キーの違反がないことを確かめる（ADR-0025 の手順 4）

   ```sh
   npx wrangler d1 execute internal-system-db --remote --command "PRAGMA foreign_key_check"
   ```

   - 見るべき結果：結果の行が 0 行
   - 違ったら（行が出る）：止める。7 章へ
   - このコマンドが本番の D1 で使えるかは、AI は確かめていない（ADR-0025 では、`integrity_check` は D1 経由で使えなかった）。権限のエラーで実行できない場合は、#160 に書いて止める（10 章 U-9）

4. 埋め戻しの確認（5 章の「流した後の確かめ」で 0 件）

### 6-4. アプリの動作の確認（デプロイの後）

本番の画面で、利用者が手で確かめる。**本物の利用者のデータを書き換えない**ため、確かめ用の架空の案件・チャンネルを使い、名前に `[本番確認]` のような印を付ける（後から見分けて片付けられるように）

1. ログインできる
2. サイドバーのチャンネルに、大量の未読（「99+」）が出ていない（5-2 を流した場合）
3. 既存のチャンネルの、過去のメッセージが読める
4. メッセージを投稿し、編集・削除・返信・リアクションができる
5. 添付を 1 つ付けて投稿し、開ける（R2 が使えること）
6. 案件の申請 → 承認 → 案件のチャンネルができ、担当部署のオーナーと全体管理者が参加者に入っている
7. 案件で、やり取り・添付・TODO の作成と完了・終了と再開・内容の再編集ができる
8. 在席状態を変えられる。通知が届く
9. 監査ログの一覧が開ける

- 違ったら：画面のエラーと時刻を #160 に書き、7 章の「アプリを前の版に戻す」を検討する
- 確かめ用に作った案件・チャンネルの片付け方は、画面の操作（終了・アーカイブ）で行う。DB から直接は消さない

---

## 7. 失敗したときの扱いと戻し方

### 途中の migration で失敗したとき

- **1 本の migration の中は、まとめて取り消される**：最後の文で失敗すると、その 1 本の変更と、`d1_migrations` の記録が取り消される（ADR-0025 の、手元の D1 のリハーサルで確かめた事実。本番では未確認）
- **それより前に成功した migration は、当たったまま残る**見込み（wrangler は 1 本ずつ当てて記録するため）。**本番で、失敗した 1 本の後の migration が当たらずに止まるかは、AI は確かめていない**（10 章 U-10）
- 失敗したら：
  1. 何もしない（コマンドを繰り返さない・アプリをデプロイしない）
  2. 出力（エラーの文）を #160 に貼る（秘密情報が含まれていないかを見てから）
  3. 6-1 の `migrations list` で、どこまで当たったかを確かめて #160 に書く
  4. AI と、次の選択肢から決める

### 戻し方の選択肢

| 選択肢 | やること | 失われるもの | 向いている場面 |
| --- | --- | --- | --- |
| A. そのまま止める | 当たった分を残し、アプリはデプロイしない | なし | 失敗の原因を調べてから、続きを当てられる場合。当たった migration は「追加」だけ（0016 を除く）で、古いコードはそのまま動く見込み |
| B. Time Travel で戻す | 3 章の手順 3 で控えたブックマークに、DB 全体を戻す | **控えた時点より後に、本番に書かれたすべてのデータ**（その間の投稿・申請など）。R2 に上げたファイルは戻らない（DB の行だけが消え、ファイルが残る） | 0016 の後でデータの不整合が見つかった場合など、DB を当てる前に戻す必要がある場合 |
| C. 逆の SQL を流す | 足した表・索引を消す SQL を、新しく作って流す | 消した表に書かれたデータ | **この手順書では用意していない**。0013・0019・0020・0030 の列は、CHECK・REFERENCES・索引があり SQLite の `DROP COLUMN` で消せないため、表の作り直しが要り、危険。0016 を元に戻すのも作り直しになる。採る場合は、別の Issue で SQL を作り、リハーサルしてから |

**B（Time Travel）のコマンド**（利用者が実行する。**実行する前に、必ず AI と相談し、改めて承認する**）

```sh
npx wrangler d1 time-travel restore internal-system-db --bookmark=<3 章の手順 3 で控えたブックマーク>
```

- `<…>` の部分は、#160 に控えたブックマークに置き換える
- 戻すと、出力に「戻す前の時点のブックマーク」が表示される。これも #160 に控える（戻したことを取り消すときに使う。T-05）
- 戻している間は、処理中の要求が取り消される（T-05）。利用者への告知が要る
- 戻した後に、6-1 の `migrations list` で、0013〜0031 が未適用に戻ったことを確かめる

### アプリを前の版に戻す

- Skill「env-deploy」の「切り戻し」：前の版を、もう一度デプロイすることを基本にする
- 3 章の手順 6 で控えた版に戻す。wrangler の `npx wrangler rollback`（版の ID を指定）が使える見込みだが、このプロジェクトで手順が決まっておらず、**確かめが要る**（10 章 U-8）
- DB は 0031 まで当たったままでも、前の版のコードは動く見込み（4 章の「順番の考え方」）。前の版に戻すときに、DB を戻す必要は原則ない

---

## 8. 所要の見込みと、利用者への影響

- **所要の時間は、いまの本番のデータの量で決まる。AI は本番の件数を知らないため、3 章の手順 8 の件数を見てから見積もる**
  - 時間がかかりうるのは、既存の大きな表を読む次のもの：0016（`rooms` の全行のコピー）・0013（`users` の索引 2 つ）・0020（`messages` の索引 2 つ）・0027（`audit_logs` の索引 3 つ）・5-2（参加者×部屋ごとに最新のメッセージを探す）
  - ほかの migration は、空の表と索引を作るだけで、時間はほとんどかからない見込み
  - D1 の 1 回の実行の時間の上限に当たるかは、件数を見てから判断する（10 章 U-11）
- **止める必要があるか**：互換性の上では、止めなくても当てられる見込み（migration を先に当て、古いコードは新しい表・列があっても動くため）。ただし：
  - migration・索引の作成の間は、D1 への書き込みが待たされ、画面が遅くなる・失敗することがありうる
  - 5-2 を流してからデプロイするまでの間に投稿が続くと、流し直しが要る
  - Time Travel で戻すことになった場合は、当てる前の時点より後の書き込みが失われる
  - このため、**業務の時間外に行い、作業の間は使わないよう、利用者に前もって知らせる**ことを勧める（C-88：計画停止は業務時間外を推奨）
- **利用者から見た変化**：デプロイまでは、画面は今のまま（新しい表・列は使われない）。デプロイの後に、案件・TODO・添付・DM・通知などの新しい機能が使えるようになる

---

## 9. 承認

利用者が、次を確かめてから記入する。**承認の後に、3 章から実行する**。

| 確かめること | 確かめた（記入） |
| --- | --- |
| 範囲：0013〜0031 の 19 本を当て、0032・0033 は当てない | |
| 範囲：`backfill-case-auto-participants.sql` を流す | |
| 範囲：`backfill-read-positions.sql` を流す（流す／流さない。U-1） | |
| 範囲：`backfill-owner-channel-members.sql` の扱い（U-2） | |
| 破壊的な変更は 0016 の 1 本（`rooms` の作り直し）で、その注意（2 章） | |
| 戻し方：Time Travel のブックマークを控えてから当てる。戻すと、その後の書き込みが失われる | |
| アプリのデプロイは、U-3・U-6・U-7・U-8 が決まるまで行わない | |
| 作業の日時と、利用者への事前の知らせ | |

- 承認した日：
- 承認した人：
- 実行の記録の場所：**#160 のコメント**。次を書く：実行した日時・3 章の手順 2・3・6・8・9 の結果（ブックマーク・版・件数）・各手順の結果・6 章の確認の結果・失敗した場合はその出力と取った選択肢

---

## 10. 未決定・確かめが要る点の一覧

推測で埋めず、ここに集めた。利用者に確かめる、または実行の前に決める。

| 番号 | 内容 | 決まるまでの扱い |
| --- | --- | --- |
| U-1 | `backfill-read-positions.sql` を、今回の範囲に含めるか。Issue #333 の本文には書かれていないが、C-169 と [unread.md](../design/unread.md) では「0018 の直後、デプロイの前」に流す決まり | 9 章で利用者が決める。含めないと、デプロイの後に既存のチャンネルが「99+」になりうる（後から流せば直る） |
| U-2 | `backfill-owner-channel-members.sql`（C-164）を、本番で流したか。「0008〜0012 の適用の承認と同じ枠」とされているが、流した記録を AI は見つけられなかった | 利用者に確かめる。流していなければ、今回含めるかを決める |
| U-3 | デプロイする版。main は今後、検索（0032・0033 を前提にするコード）を含みうる。0013〜0031 だけに合う版（候補：`e4c92f8`）を決める | 決まるまでデプロイしない |
| U-4 | 当てる前に、1 回だけの書き出し（`wrangler d1 export`）をするか。C-127 は定期の書き出しを設けないと決めたが、1 回だけの控えは決まっていない。書き出しの間は他の要求が止まり、ファイルに個人情報が入る | 決まるまで、Time Travel だけを戻す手段とする |
| U-5 | いま本番で動いている Worker の版と、その版が古いコードとして新しい表・列（特に 0016 の `rooms.kind`）と両立するか。`wrangler deployments list` の出力の形も未確認 | 3 章の手順 6 で版を控え、AI が版を確かめる |
| U-6 | 本番の R2 のバケット `internal-system-attachments` の作り方。`infra/` に R2 の定義（`r2.tf`）がない | バケットがなければ、デプロイしない |
| U-7 | `wrangler.jsonc` の `ALLOWED_ORIGINS` の本番の値（本番のドメイン）。いまは手元の URL | 決まるまでデプロイしない |
| U-8 | 本番へのデプロイ・前の版へ戻すコマンド（`@cloudflare/vite-plugin` のビルドの出力からの `wrangler deploy`、`wrangler rollback`）。プロジェクトの文書・npm スクリプトに決まっていない | 決まるまでデプロイしない（migration と埋め戻しは先に済ませてよい） |
| U-9 | 本番の D1 で `PRAGMA foreign_key_check` を `wrangler d1 execute` から実行できるか | 実行できなければ止めて、確かめ方を AI と決める |
| U-10 | 本番で、途中の migration が失敗したとき、後の migration が当たらずに止まるか（1 本の中が取り消されることは、手元のリハーサルで確かめ済み） | 失敗したら、それ以上の操作をせず、`migrations list` で確かめる |
| U-11 | 所要の時間と、D1 の 1 回の実行の時間の上限に当たるか（本番の件数を AI は知らない） | 3 章の手順 8 の件数を見てから見積もる |
| U-12 | Time Travel で戻すのにかかる時間（RTO）。C-127 で未決定 | 戻す場合は、時間が読めないことを前提に、利用者へ知らせる |
| U-13 | 本番が、本当に 0012 まで当たっているか（#160 の記録による。AI は確かめていない） | 3 章の手順 2 で確かめる |
