# 0024：既存テーブルへの列追加でテーブルの作り直しが生成されたとき、migrationをADD COLUMNに書き換える

- 状態：採用
- 日付：2026-11-11
- 関係：Issue #130（最初の適用：migration 0013）、[ADR-0018](0018-client-initial-seed-migration-exception.md)、[ADR-0021](0021-department-channel-backfill-migration-exception.md)、[ADR-0022](0022-company-general-channel-seed-migration-exception.md)、Skill「data-access-drizzle」、[project-rules.md](../project-rules.md)

## 背景

Issue #130で、`users`テーブルに5値のCHECK制約つきの列（`status_kind`）などを足す。`backend/db/schema.ts`にdrizzleの表レベルの`check()`を書いて`npm run db:generate`を実行すると、drizzle-kitは、SQLiteが`ADD CONSTRAINT`をサポートしないため、`users`テーブルの作り直し（`CREATE TABLE __new_users` → `INSERT … SELECT` → `DROP TABLE users` → `RENAME`）を生成した。

- 生成されたSQLは、新しい列を旧テーブルから読む。存在しない列名を二重引用符で囲むとSQLiteは文字列リテラルとして扱うため、壊れた値が入り、`npm run db:migrate:test`がCHECK違反で失敗した
- 本番のD1では、多数のテーブルから外部キーで参照される`users`をDROP・再作成するのは危険で、全行のコピーも伴う

Skill「data-access-drizzle」は「migrationを手で書き換えない」と定める。project-rulesの既定の方針1は、手作成migrationの例外をADR-0018・0021・0022の3本のままで増やさないと定める。この場面は、どちらのままでも解けない。

## 選択肢

A. DBのCHECKを付けず、zodと型だけで値を守る
   - 良い点：テーブルの作り直しが生成されない
   - 悪い点：既存のスキーマがCHECKを多用する方針と一貫しない。防御の層が減る

B. 生成されたmigrationを`ALTER TABLE … ADD COLUMN …`と`CREATE INDEX`に書き換えて使う
   - 良い点：テーブルのDROP・再作成・全行コピーがない。DBのCHECKを維持できる
   - 悪い点：生成されたmigrationを手で書き換えるため、Skillの禁止を緩める

C. 生成された作り直しを直して使う
   - 良い点：生成手順に近い
   - 悪い点：本番で`users`をDROPする危険が残る

D. 別のテーブルに分ける
   - 良い点：既存の`users`を変えない
   - 悪い点：計画とテストの作り直しが要り、行がない利用者の扱いが増える

## 決定

選択肢Bを採る。利用者が2026-11-11に承認した。

既存テーブルへの列追加で、drizzle-kitがテーブルの作り直しを生成するときは、生成されたmigrationのSQLを、`ALTER TABLE … ADD COLUMN …`（列の定義にDEFAULT・NOT NULL・CHECK・REFERENCESを含む）と`CREATE INDEX`に書き換える。

- テーブルのDROP・再作成・全行コピーは行わない
- `meta/<n>_snapshot.json`と`_journal.json`は、生成されたものを使う。書き換えない
- 書き換えたあとに`npm run db:generate`をもう一度実行し、差分が出ないこと（スキーマとスナップショットの整合）を確かめる
- 書き換えたmigrationの先頭に、コメントでこのADRの番号を書く
- 既存のmigrationは変えない
- 本番への適用は、従来どおり、別途利用者が承認する

これは、個別のmigrationごとの例外ではなく、この場面（既存テーブルへの列追加で作り直しが生成されたとき）に対する一般ルールである。今後の同じ場面には、利用者の確認なしで適用する。project-rulesの既定の方針1の「migrationが必要と考えたときは、作らずに利用者に戻す」は変えない。これは、migrationの要否ではなく、migrationの作り方を補うものである。

最初の適用は、migration 0013（Issue #130。`users`にステータスの列5つとインデックス2つ）である。

## 理由

SQLiteのADD COLUMNは、DEFAULTつきの列やCHECK・REFERENCESを含む列定義を受け付ける。このため、作り直しを使わなくても、列とその制約を足せる。既存の行は書き換わらず、他のテーブルからの外部キー参照も保たれる。DBのCHECKを維持できるので、防御の層も減らない。

## 影響

- Skill「data-access-drizzle」の「migrationを手で書き換えない」を、この場面に限って緩める。ほかの場面では、これまでどおり書き換えない
- 手作成migrationの例外（ADR-0018・0021・0022の3本）には数えない。この場面のルールは、手で新規に作るものではなく、生成されたmigrationの中身をADD COLUMNに直すものである
- 書き換え後も`meta/`のスナップショットは生成されたままなので、`npm run db:generate`で差分が出ないことが、スキーマとの整合の確認になる
- 列の追加以外（列の削除・型の変更・制約だけの変更）で作り直しが生成された場合は、この決定の範囲外である。止まって利用者に確認する
- 本番への適用は、この決定に含まれない。別途、利用者の承認が必要である
