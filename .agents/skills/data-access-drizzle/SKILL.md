---
name: data-access-drizzle
description: Drizzle ORMでDBにアクセスするときのルール。スキーマの定義、CRUDの書き方、生SQL、トランザクション、マイグレーション、テストを扱うときに読む。
---


## データアクセスの共通ルール

どのライブラリを選んでも、次を守る。

### 書き方の書き分け

- 単純なCRUDや、入力によって条件が変わる検索は、ライブラリの通常の書き方でRepositoryに書く
- 次のいずれかを使う複雑なSQLは、DAOの専用ファイル（`*.sql.ts`等）に1クエリずつ書く
  - `GROUP BY`・集計関数、ウィンドウ関数、サブクエリ・`WITH`句、3つ以上のテーブルの`JOIN`
- 両方に当てはまる場合は、通常の書き方を基本にし、集計部分だけ生SQLの機能で埋め込む
- 詳しい基準はSkill「知見」の`db/sql-complexity`を読む

### 共通の禁止事項

- 利用者の入力を、文字列の連結でSQLに埋め込まない。値は必ずパラメータで渡す
- 必要な列だけを取得し、Entityを丸ごと画面やAPIに渡さない
- スキーマの変更は、マイグレーションファイルでだけ行う
- トランザクションの範囲はService層で決め、Repository／DAOで始めない


# Drizzle ORM

作業の過程と結果は、すべて日本語で書く。

このプロジェクトのDB：Cloudflare D1（標準）

## スキーマの定義

- テーブルの定義は、Drizzleのスキーマのファイル（`backend/db/schema.ts`）に書く。DB に触れる処理（Repository）は`backend/src/db/`に置く
- スキーマの定義を変えたら、`drizzle-kit generate --name <内容をsnake_caseで>`でマイグレーションファイルを作る（例：`--name add_users_email_index` → `0003_add_users_email_index.sql`）。`--name`を付けないと意味のない名前になるため、必ず付ける。作られたSQLの内容を確かめてからコミットする
- マイグレーションファイルを手で書き換えない。一度適用したものは変えず、新しいファイルを追加する

## マイグレーションの適用

- Cloudflare D1：`drizzle-kit generate`で作ったファイルを、wranglerのマイグレーション機能で適用する。適用の記録はD1の`d1_migrations`テーブルに残る
  - 開発：`npm run db:migrate:local`。検証：`npm run db:migrate:test`（環境別の一時保存先）
  - 検証・本番：`--remote`を付ける。利用者の承認を得て行い、AIは実行しない
  - `wrangler.jsonc`の`d1_databases`に`migrations_dir`（マイグレーションファイルの置き場所）を書く
- Vitestでは、`@cloudflare/vitest-pool-workers`の`readD1Migrations`で読み込み、`applyD1Migrations`でVitest専用の一時D1に適用する。この一時DBを外部の開発・検証DBと共有しない
- PostgreSQL：このプロジェクトはD1を使うため、PostgreSQLの適用の手順は使わない（PostgreSQLに変えるときに決める）
- 開発操作は`.env.development`、検証操作は`.env.test`を使う。PostgreSQLの検証DB名は`_test`で終わる必要がある。`npm run db:generate -- --name <名前>`は接続先を使わずマイグレーションを生成する

## CRUDの書き方（Repository）

- 必要な列だけを`select({ ... })`で指定して取得し、DTOの形で返す
- 入力によって変わる検索条件は、条件を配列に集めて`and(...)`等で組み立てる。文字列をつなげて作らない
- 一覧は必ずページング（`limit`・`offset`またはキー指定）を付ける

## 生SQL（DAO）

- 複雑なSQLは、DAOの`*.sql.ts`に、Drizzleの`` sql`...` ``で書く。値は`${}`で埋め込む（Drizzleがパラメータとして渡す）
- `sql.raw()`に利用者の入力を渡さない。並び替えの列名など、パラメータで渡せない部分は許可リストと照合してから使う
- 生SQLの結果の型は、DTOの型を明示し、Zod等で検証する

## トランザクション

- **Cloudflare D1**：`db.batch([...])`で、複数の文をまとめて実行する。途中の文が失敗すると、全体が取り消される
  - **`db.transaction()`はD1では使えない**（`Failed query: begin`のエラーになる）。使わない
  - 「読んだ結果を見て次の文を決める」処理は、`batch`にできないため、楽観的ロック（下記）と組み合わせて設計する
- **PostgreSQL**：`db.transaction(async (tx) => { ... })`を使う（ドライバは`pg`）。途中で失敗すると全体が取り消され、`tx.rollback()`で明示的に取り消すこともできる
- D1とPostgreSQLで書き方が違うため、Repositoryの内側に閉じ込め、Serviceからは同じ呼び出し方にする
- 楽観的ロック：`update(...).where(and(eq(id), eq(version))).run()`の`meta.changes`（更新した件数）が0なら、衝突として`409`を返す
- D1で書き込みが混み合ったときのエラーの種類は未確認。見つかった場合は、トランザクション全体のやり直し（Skill「バックエンド」）の対象に加え、この項目を更新する

## PostgreSQL（Hyperdrive経由）

- ドライバは`pg`（node-postgres）を使う（Cloudflareの推奨）。`drizzle-orm/node-postgres`で接続する
- `compatibility_date`が2026-08-04以降なら、`nodejs_compat`は既定で有効
- 楽観的ロックの更新件数は、更新の結果の`rowCount`で取る
- ローカルの開発では、Hyperdriveの接続先を環境変数`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_<バインディング名>`で渡す。接続先（パスワードを含む）を`wrangler.jsonc`に書かない
- `@cloudflare/vitest-pool-workers`の中では`pg`を読み込めない（2026-09-30時点）。Workers＋PostgreSQLの結合テストは、`wrangler dev`で起動したアプリのAPIに対して行う（API層のテスト）。`pg`を使う処理そのものの結合テストは、Node.js上でテスト用のPostgreSQLのコンテナに対して行う

## 良い例・悪い例

書くときは、良い例の形に合わせる。例は`backend/src/rules-examples/`のテスト（`*.db.test.ts`）にあり、このプロジェクトのDB（Cloudflare D1（標準））で動作を確かめてある。悪い例も、問題が起きることをテスト（「悪い例の問題」）で確かめてある。このフォルダは、ハーネスが管理するため、消さない。

### SQLインジェクション：値はパラメータで渡し、並び替えの列は許可リストで決める

#### 良い例

```ts
export function findByUsername(username: string) {
  // 値はクエリビルダーで渡す。ドライバがパラメータとして扱うため、入力はSQLの一部にならない
  // （sql テンプレートを使う場合も、値は ${username} で埋め込む）
  return db.select().from(users).where(eq(users.username, username));
}
```

```ts
const SORT_COLUMNS = { id: users.id, username: users.username };

export function listSorted(sort: string) {
  // 並び替えの列名はパラメータで渡せない。許可リストにある列だけを使い、それ以外は既定の列にする
  const column = Object.hasOwn(SORT_COLUMNS, sort)
    ? SORT_COLUMNS[sort as keyof typeof SORT_COLUMNS]
    : users.id;
  return db.select().from(users).orderBy(asc(column));
}
```

#### 悪い例

```ts
export function findByUsernameBad(username: string) {
  // 悪い例：入力を文字列でSQLにつなげている。' OR 1=1 -- を渡すと、全件が返る
  return db.all(
    sql.raw(
      `SELECT * FROM example_injection_users WHERE username = '${username}'`,
    ),
  );
}
```

- 問題：入力を文字列でつなげると、細工した入力（`' OR 1=1 --`）で、条件が無効になり、全件が返る

### N+1：一覧は、まとめて取る

#### 良い例

```ts
export async function listOrdersByUser(db: Db) {
  const allUsers = await db.select().from(users);
  // 利用者の件数にかかわらず、注文は1回のクエリで取る（inArray でまとめる。JOIN でもよい）
  const rows = await db
    .select()
    .from(orders)
    .where(
      inArray(
        orders.userId,
        allUsers.map((u) => u.id),
      ),
    );
  return allUsers.map((user) => ({
    username: user.username,
    items: rows.filter((o) => o.userId === user.id).map((o) => o.item),
  }));
}
```

#### 悪い例

```ts
export async function listOrdersByUserBad(db: Db) {
  const allUsers = await db.select().from(users);
  const result = [];
  for (const user of allUsers) {
    // 悪い例：利用者ごとにクエリを投げている。利用者が増えるほど、クエリの数も増える（N+1）
    const rows = await db
      .select()
      .from(orders)
      .where(eq(orders.userId, user.id));
    result.push({ username: user.username, items: rows.map((o) => o.item) });
  }
  return result;
}
```

- 問題：件数に比例してクエリが増える（1 + 件数）。良い例は、件数が増えても、クエリの数が変わらない

### トランザクション：途中で失敗したら、全体を取り消す

D1は`db.batch`、PostgreSQLは`db.transaction`で書く。次の例は、このプロジェクトのDB（Cloudflare D1（標準））の書き方。

#### 良い例

```ts
export async function transfer(
  db: Db,
  from: number,
  to: number,
  amount: number,
) {
  // D1 は db.transaction() を使えない。db.batch() にまとめると、途中の文が失敗したとき全体が取り消される
  await db.batch([
    db
      .update(accounts)
      .set({ balance: sql`${accounts.balance} + ${amount}` })
      .where(eq(accounts.id, to)),
    db
      .update(accounts)
      .set({ balance: sql`${accounts.balance} - ${amount}` })
      .where(eq(accounts.id, from)),
  ]);
}
```

#### 悪い例

```ts
export async function transferBad(
  db: Db,
  from: number,
  to: number,
  amount: number,
) {
  // 悪い例：文を1つずつ実行している。2つ目が失敗しても、1つ目の書き込みは残る
  await db
    .update(accounts)
    .set({ balance: sql`${accounts.balance} + ${amount}` })
    .where(eq(accounts.id, to));
  await db
    .update(accounts)
    .set({ balance: sql`${accounts.balance} - ${amount}` })
    .where(eq(accounts.id, from));
}
```

- 問題：文を1つずつ実行すると、途中で失敗しても、先に実行した書き込みが残る（例では、お金が増える）

### 楽観的ロック：更新した件数が0なら、衝突（409）

#### 良い例

```ts
export async function rename(
  db: Db,
  id: number,
  expectedVersion: number,
  name: string,
) {
  const result = await db
    .update(items)
    .set({ name, version: sql`${items.version} + 1` })
    .where(and(eq(items.id, id), eq(items.version, expectedVersion)))
    .run();
  // 更新した件数が0なら、読んだあとに誰かが更新している。上書きせず、衝突として知らせる
  if (result.meta.changes === 0) {
    throw new AppError(
      "CONFLICT",
      "他の人が先に更新しました。読み込み直してください",
    );
  }
}
```

#### 悪い例

```ts
export async function renameBad(db: Db, id: number, name: string) {
  // 悪い例：版を確かめずに更新している。古い画面からの更新が、他の人の変更を黙って上書きする
  await db
    .update(items)
    .set({ name, version: sql`${items.version} + 1` })
    .where(eq(items.id, id))
    .run();
}
```

- 問題：版を確かめない更新は、古い画面からの更新で、ほかの人の変更を黙って上書きする

### 生SQL（DAO）：戻り値をZodで検証する

#### 良い例

```ts
export async function totalsByUser(db: Db): Promise<Total[]> {
  const rows = await db.all(totalsQuery);
  // 生 SQL の結果は型が付かない。型の宣言（as）に頼らず、Zod で検証して、想定と違う行をここで見つける
  return z.array(totalSchema).parse(rows);
}
```

#### 悪い例

```ts
export async function totalsByUserBad(db: Db): Promise<Total[]> {
  const rows = await db.all(totalsQuery);
  // 悪い例：検証せずに型を宣言している。想定と違う行（注文のない利用者の total が null）も、number として通ってしまう
  return rows as Total[];
}
```

- 問題：検証せずに型を宣言すると、想定と違う行（例では`total`が`null`）が、そのまま通り、後の処理で壊れる

## テスト

- 例のテスト（`backend/src/rules-examples/*.db.test.ts`）は、`npm run check`で毎回動く。例を書き換えたら、テストも通す
  - D1：`npm test`（Workersのテスト）の中で、Vitest専用の一時D1に対して動く
  - PostgreSQL：`pg`をWorkersのテストの中で読めないため、Node.jsの別の設定（`vitest.db.config.ts`）で動かす。`npm test`の後に自動で`npm run test:db`が実行される。検証用DBのコンテナ（`npm run docker:up:test`）の起動が要る。接続先は`.env.test`の`DATABASE_URL`で、手元の`_test`で終わるDBだけを許す。表はその接続だけの一時的なもの（`CREATE TEMP TABLE`）で、マイグレーション・シード・既存のデータには触れない。コンテナの中で実行するときは、検証用のコンテナ（`npm run docker:up:test`）の中で行う
- 結合テストは`@cloudflare/vitest-pool-workers`（`cloudflareTest`の設定）で、Workersと同じ実行エンジンで行う。ローカルのD1（またはテスト用のPostgreSQLのコンテナ）に、マイグレーションとシードを適用してから行う
- `wrangler.jsonc`の`compatibility_date`は、テストの道具に同梱された実行エンジンが対応する日付以下にする（新しすぎると起動しない）
- 実行計画は`EXPLAIN QUERY PLAN <SQL>`で取得し、インデックスが使われているか（`USING INDEX`）を確かめる
- インデックスの付け方は、Skill「知見」の`db/index-design`（検索・結合・並び順の列、複合インデックスの列の順、外部キーの列、値の種類が少ない列、部分一致、書き込みへの影響）を読む
- 実行されたSQLの数を数えて、N+1が起きていないことを確かめる
