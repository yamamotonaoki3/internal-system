# 0031：検索用の表（FTS5 の仮想の表）の migration を手で書く

- 状態：採用
- 日付：2026-11-20
- 関係：Issue #155（155-A。最初の適用：migration 0033）、Issue #160（本番での確認と適用）、[ADR-0010](0010-japanese-search-fts5-trigram.md)、[ADR-0018](0018-client-initial-seed-migration-exception.md)・[ADR-0021](0021-department-channel-backfill-migration-exception.md)・[ADR-0022](0022-company-general-channel-seed-migration-exception.md)（手作成の migration の例外）、[ADR-0024](0024-add-column-rewrite-for-table-rebuild.md)（列の追加の書き換え）、決定記録 C-152・C-200、Skill「data-access-drizzle」「env-deploy」、[project-rules.md](../project-rules.md)、設計書 [search.md](../design/search.md)

## 背景

メッセージの検索（機能4。C-152・ADR-0010）は、D1 の FTS5 の`trigram`で行う。そのためには、検索用の仮想の表`search_fts`（`CREATE VIRTUAL TABLE … USING fts5(…)`）が要る。

- Drizzle（drizzle-kit）は、仮想の表を`schema.ts`に書けず、migration を生成できない。ADR-0010 は「drizzle-kit が仮想テーブルの差分を誤って消さないかを、導入前に確かめる」としていた
- Skill「data-access-drizzle」は「migration を手で書き換えない」と定め、project-rules の既定の方針1は、手作成の migration の例外を ADR-0018・0021・0022 の3本のままで増やさないと定める。この場面は、どちらのままでも解けない
- 既定の方針1は「migration が必要と考えたときは、作らずに利用者に戻す」と定めるため、利用者に諮った（Issue #155 の D-1）

## 選択肢

索引の作り方を3つ比べた（計画の 4.1。どれも仮想の表は要るので、手で書く migration はどれでも要る）。

| 観点 | ① 外部の内容の表＋トリガー | ② 自分で中身を持つ表＋アプリの側で更新 | ③ 自分で中身を持つ表＋トリガー |
| --- | --- | --- | --- |
| 元の行との対応 | 外部の内容の表は元の表の rowid を読む。`messages`は文字列の主キーで、隠れた rowid に頼る形が残る | 対応の表`search_documents`の整数の主キーを rowid にする（自前の採番） | ②と同じ（対応の表をトリガーで保つ） |
| 削除の正しさ | 削除の命令に古い本文が要り、論理削除などの遷移で壊れやすい | 中身を持つ表は rowid だけで消せる。古い本文が要らない | ②と同じ |
| D1 の`meta.changes` | トリガーの中の書き込みが数に入り、既存の戻り値が変わる | 変わらない（索引は batch の別の文） | ①と同じ問題 |
| C-152(3)（記号を除いた本文を索引にする） | SQL で記号を除けない → 食い違う | 合う（アプリの関数で除く） | 食い違う |
| 書き込みの漏れ | 漏れない | 漏れうる → 部品を1つにし、書き込みの一覧のテストで防ぐ | 漏れない |
| 既存のデータ | migration で入れられる | アプリの関数で除くため、別の登録の手順が要る | migration で入れられる |

## 決定

②を採り、検索用の表の migration を手で書く例外を認める。利用者が 2026-11-20 に承認した（Issue #155 の D-1・D-9）。

- **作り方**：`npm run db:generate -- --custom --name <名前>`で空の migration を作り、`CREATE VIRTUAL TABLE`の文を手で書く。ラッパー（`scripts/db-local.ts`・引数の検査`scripts/db-generate-args.ts`の`generateArgs`）は、引数なし・`--name <名前>`・`--custom --name <名前>`だけを通す。`meta/<n>_snapshot.json`と`_journal.json`は、生成されたものを使う
- **最初の適用**：migration 0033（`0033_add_search_fts.sql`。`search_fts`を`fts5(text, tokenize='trigram')`で作る1文だけ。トリガーは作らない）。対応の表`search_documents`は、通常どおり`schema.ts`に書いて生成した（migration 0032）
- **手で書いた表は`schema.ts`に書かない**。書くと、drizzle-kit が仮想の表を普通の表として扱い、消す・作り直す差分を作るため
- **batch に入れる文を組むための表の形**（`sqliteTable("search_fts", …)`）は、`backend/src/db/search-index.sql.ts`の中だけに置く。ほかのファイルから検索用の表に書かない
- **生成の後に、毎回、差分が出ないことを確かめる**：手で書いた migration を足した後と、その後の`schema.ts`の変更のたびに、`npm run db:generate`を実行し、検索用の表を消す・作り直す migration が出ないことを確かめる
- **`search_documents`を作り直す変更が出たとき**（列・CHECK の変更で drizzle-kit がテーブルの作り直しを生成したとき）は、検索用の表も手で合わせる（rowid と`search_documents.id`の対応が保たれるかを確かめ、保てないなら検索用の表を作り直して登録し直す）。止まって利用者に確認する
- **既存のメッセージの索引**は、migration ではなく、登録の処理`backend/src/db/search-reindex.ts`の`reindexMessages`で作る（記号を除く規則がアプリの関数`toSearchText`にあり、SQL で書けないため。D-9）。手元は`node scripts/db-local.ts <環境> search-reindex`。project-rules の既定の方針1（既存データの補完は`backend/db/scripts/`の SQL にする）とは別の形になるが、利用者が D-9 で承認した
- これは、手作成の migration の4本目の例外である。ADR-0018・0021・0022 の3本は、初期データだけの migration の例外で、この決定はそれを広げない。対象は「Drizzle の生成に乗らない DDL（FTS5 の仮想の表）」に限る。ほかの種類の DDL を手で書く必要が出たときは、止まって利用者に確認する

### ADR-0024 との違い

| 観点 | ADR-0024 | この ADR |
| --- | --- | --- |
| 対象 | 生成された migration（テーブルの作り直し）の中身を、`ADD COLUMN`に書き換える | 生成されない DDL（仮想の表）を、空の migration に新しく書く |
| `schema.ts` | 表を書く（生成の元） | 仮想の表は書かない |
| snapshot | 生成されたものを使う | 生成されたもの（`--custom`で作ったもの）を使う。仮想の表は snapshot に現れない |
| 生成の後の確認 | `npm run db:generate`で差分が出ない | 同じ。加えて、仮想の表を消す差分が出ないことを見る |

### 本番で失敗したときの扱い（案。本番での実行は #160）

- 検索用の表と対応の表は、元の表（`messages`）を変えない。失敗しても、メッセージのデータは失われない
- 検索用の表の作成が失敗した、または索引が壊れたときは、2つの表の行を消して（または表を消して作り直して）、`reindexMessages`で登録し直す。登録の処理は、べき等で、途中から再開できる
- 戻すときは、`search_fts`と`search_documents`の2つの表を消す migration を足す（検索の API は使えなくなる）
- **本番での実行（migration 0032・0033 の適用と、既存のメッセージの登録）は、#160 で、手順・競合の確認・検索を公開する条件を示し、利用者の承認を得てから行う**。この ADR の承認は、本番での実行の承認を含まない

## 理由

- 仮想の表は、Drizzle の生成で作る方法がない。手で書くほかにない
- ②は、C-152 の原文（記号を除いた本文・1つの表・種類の列）に合い、対応・削除・件数の問題が構造で起きない
- 例外の範囲を「生成に乗らない DDL」に限り、生成の後の差分の確認を毎回行えば、`schema.ts`と migration の整合を保てる

## 影響

- **D1 の`meta.changes`**：検索用の表への書き込みは、FTS5 の内部の表への書き込みも`meta.changes`に数えられる（手元の D1 で、INSERT で3、DELETE で6。T-0 で確かめた）。件数の判定には、主の文の`meta.changes`か、SQL の`changes()`だけを使い、索引の文の結果を使わない
- **`PRAGMA compile_options`は D1 では許可されない**。FTS5 が使えることは、表が作れることで確かめた（`backend/src/db/search-fts5-capability.db.test.ts`）
- **書き出し**：C-152(4) のとおり、FTS5 を含む DB は`wrangler d1 export`で書き出せない（C-127 で定期エクスポートは設けないため、方針とは衝突しない）。手動で書き出すときは、検索用の表を消してから書き出し、`reindexMessages`で登録し直す手順になる
- **Time Travel**：FTS5 を含む DB を Time Travel で戻せるかは、まだ確かめていない（ADR-0010 の未確認事項）。#160 で確かめる
- 書き込みの漏れ：メッセージの本文を書く処理を足すときは、同じ batch の末尾に`search-index.sql.ts`の組を足す（[messages.md](../design/messages.md)・[search.md](../design/search.md)）
- 155-B（添付ファイル名）・155-C（案件の件名）で`search_documents.kind`を増やすときは、CHECK（いまは`'message'`だけ）を変える migration が要る。drizzle-kit がテーブルの作り直しを生成した場合は、上の「`search_documents`を作り直す変更が出たとき」に当たる

## 追記（2026-11-21。Issue #155 の155-B。元の記述は残す）：`search_documents`を作り直すときの手順

上の「`search_documents`を作り直す変更が出たとき」を、次のとおり具体化する。利用者が 2026-11-21 に承認した（Issue #155 の B-1）。

### 背景

- 155-B で、`kind`の CHECK に`attachment`（と、155-C の`case_title`。B-2）を足した。SQLite は CHECK を後から変えられないため、`npm run db:generate`は表の作り直し（新しい表を作る → 全行を`id`ごと写す → 古い表を消す → 名前を変える）を生成した
- 生成された作り直しは、行の`id`は保つが、採番の記録（`sqlite_sequence`の、この表の行）を失う。表を消すと記録も消え、新しい表の採番は「写した行の最大の`id`」から続く。このため、最大の番号の行を消した後に作り直すと、その番号が使い回される
- 検索用の表`search_fts`に、対応の行のない古い行（後始末の順・途中の失敗で残りうる）があると、使い回された番号の新しい対応の行に、古い文が結び付く（索引の組は「検索用の表に行が既にあれば入れない」ため）。別のメッセージの文で一致する、誤った結果になる
- 作り直しのないいまは、`AUTOINCREMENT`が番号の使い回しを防いでいるため、この問題は起きていない（155-A の時点の不具合ではない）

### 決定

- **作り直しの前に、2つの表の写しを全部消す、手で書いた migration を置く**（今回は`0034_clear_search_index.sql`。`--custom --name`で作り、`DELETE FROM search_fts`と`DELETE FROM search_documents`を書く）。片方だけが当たる状態を作らないよう、**2つの`DELETE`は同じ migration に書く**。先頭のコメントに理由と、この ADR の番号を書く
- その後に、**生成のままの作り直し**を当てる（今回は`0035_change_search_document_kinds.sql`。書き換えない。表は0行なので、写すものがない）。生成の後に`npm run db:generate`を再実行し、差分が出ないことを確かめる
- 当てた後に、**全種類の索引を登録し直し**（`reindexMessages`。メッセージの本文と添付のファイル名）、**索引と元の表の不一致が0件であることを確かめる**
- **今後、`search_documents`を作り直すときも、この手順を決まりにする**（今回限りにしない）
- この手で書く migration は、上の「決定」の例外の範囲（生成に乗らない DDL）の外にある、行の削除だけの migration である。この ADR の例外に、この1つの形（作り直しの直前に、索引の写しの2つの表を空にする）だけを足す。ほかの形の、手で書く migration は、これまでどおり止まって利用者に確認する

### 検討した案

| 案 | 内容 | 採らなかった理由 |
| --- | --- | --- |
| 採番の記録を、手で退避・復元する | 生成された作り直しに、`sqlite_sequence`の行を写す文を足す | 生成物の書き換えになる（ADR-0024 の範囲の外）。`sqlite_sequence`を直接書くことが D1 で許されるかも確かめていない。索引は元の行からいつでも作り直せる写しなので、守る必要が小さい |
| CHECK を外し、コードの定数だけで種類を守る | 以後は種類を足しても作り直しが出ない | 外すにも作り直しが1回要り、同じ問題が起きる。DB が誤った値を止められなくなる |

### 影響

- 写しを消した後に登録し直すのを忘れると、既存のメッセージ・添付が検索に出ない。誤った一致は出ない（古い文が1行も残らないため）
- 手元の DB：既存の手元の DB に migration を当てた後は、`node scripts/db-local.ts <development|test> search-reindex`で登録し直す（README）。テストの DB は、テストの準備が登録する。E2E は spec の準備が登録し直す
- 本番：0032 以降が未適用で、索引は空。#160 の次の区切りで、0032〜0035 を当てた後に登録する
- `0035`は生成のままで`PRAGMA foreign_keys`の行を含むが、`search_documents`はほかの表から参照されないため、ADR-0025 の置き換えは要らなかった

### 確かめたこと・確かめていないこと

- 確かめた：手元の D1（Miniflare）で、0034・0035 が通ること。0033 まで当てた DB に、最大の番号の対応の行だけを消した孤立した検索用の行を入れてから 0034・0035 を当て、両方の表が0件になること、新しい投稿で古い文が一致しないこと、登録し直した後に不一致が0件であること、CHECK が3つの種類を通しほかを拒否すること（`backend/src/db/search-documents-kind.upgrade.db.test.ts`）
- 確かめていない：本物の D1 での 0034・0035 の適用（#160・#350）
