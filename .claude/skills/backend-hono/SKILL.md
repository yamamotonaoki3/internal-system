---
name: backend-hono
description: HonoでバックエンドのAPIを作るときのルール。ルーティング、入力チェック、エラー処理、セキュリティの設定、Cloudflare Workersでのバッチ処理を扱うときに読む。
---

# Hono

作業の過程と結果は、すべて日本語で書く。

## 用意されている共通の部品（`backend/src/lib/`）

| ファイル | 役割 | 使い方 |
| --- | --- | --- |
| `app-error.ts` | 想定できるエラーの型（`AppError`） | 入力の誤り・権限不足・リソースなし・競合などは`throw new AppError("CONFLICT", "利用者向けのメッセージ")`で投げる |
| `error-handler.ts` | グローバル例外ハンドリング | `app.onError(handleError)`・`app.notFound(handleNotFound)`で登録する。各層でエラーを`try`〜`catch`で変換しない |
| `security.ts` | セキュリティヘッダー・送信元の確認・`no-store` | `app.use(securityHeaders)`・`app.use(originCheck(...))`を全体に、`noStore`を認証が必要なAPIに付ける |
| `validation.ts` | 入力チェック | `validate("json", スキーマ)`を使う。`@hono/zod-validator`の`zValidator`を直接使わない |
| `security.test.ts` | 必須のテスト | GETで状態が変わらない・送信元の拒否・入力の誤りの形式・セキュリティヘッダーを確かめる。APIを追加しても、ルーティングの定義から自動で対象になる |

## 守ること

- **MUST NOT**：Honoの`csrf`ミドルウェアだけでCSRF対策を済ませない。JSONの要求を確かめないため、`originCheck`を使う
- **MUST NOT**：`zValidator`を直接使わない。Zodの詳しいエラーが利用者に返ってしまう
- **MUST**：Controller（ルートの処理）は、入力の受付と応答の返却だけにし、業務の処理はServiceに渡す
- **MUST**：許可する送信元（`ALLOWED_ORIGINS`）は、環境ごとに環境変数で持つ
- **MUST**：CSPに外部のサービスを追加する場合は、`security.ts`を直し、理由をADRに記録する

## 良い例・悪い例

書くときは、良い例の形に合わせる。例は`backend/src/rules-examples/`のテストにあり、動作を確かめてある。悪い例も、問題が起きることをテスト（「悪い例の問題」）で確かめてある。このフォルダは、ハーネスが管理するため、消さない。

### Controller は入力の受け取りと応答だけ、業務のルールは Service

#### 良い例

```ts
// Service：業務のルール（同じユーザー名は登録できない）。HTTP（Hono）を知らない
export function registerUser(names: string[], username: string): void {
  if (names.includes(username)) {
    throw new AppError("CONFLICT", "そのユーザー名はすでにあります");
  }
  names.push(username);
}

// Controller：入力の受け取りと応答だけ。入力は validate() で確かめ、処理は Service に渡す
export function userRoutes(names: string[]) {
  return new Hono().post("/", validate("json", userSchema), (c) => {
    const { username } = c.req.valid("json");
    registerUser(names, username);
    return c.json({ username }, 201);
  });
}
```

- 入力は`validate()`で確かめる。失敗は、決めた形式（`VALIDATION_ERROR`と、誤った項目の名前`fields`）の`422`で返る
- 業務のルール（重複の禁止など）はServiceに書く。ルートを通らない入口（バッチなど）でも、同じルールが効く

#### 悪い例

```ts
export function userRoutesBad(names: string[]) {
  return new Hono().post("/", validate("json", userSchema), (c) => {
    const { username } = c.req.valid("json");
    // 悪い例：業務のルール（重複の禁止）を Controller に直接書いている。ルートを通らない入口には、このルールが効かない
    if (names.includes(username)) {
      throw new AppError("CONFLICT", "そのユーザー名はすでにあります");
    }
    names.push(username);
    return c.json({ username }, 201);
  });
}

// ルールを再利用できないため、バッチ処理は、確認を書かずに直接追加してしまう
export function importUsersBad(names: string[], list: string[]): void {
  for (const username of list) names.push(username);
}
```

- 問題：業務のルールをControllerに書くと、ルートでは効いても、ほかの入口（バッチなど）では効かず、重複を通してしまう

### 入力の検証は`validate()`を使う

#### 悪い例

```ts
export const zValidatorRoutesBad = new Hono().post(
  "/",
  // 悪い例：zValidator を直接使っている。失敗の応答が決めた形にならず、Zod の詳しいエラーがそのまま返る
  zValidator("json", userSchema),
  (c) => c.json(c.req.valid("json"), 201),
);
```

- 問題：`zValidator`を直接使うと、失敗の応答が決めた形（`code`・`fields`）にならず、Zodの詳しいエラーが利用者に返る。良い例は上の「Controller は入力の受け取りと応答だけ」の`validate("json", スキーマ)`

### エラーは`AppError`で投げ、各層で`try`〜`catch`して500にしない

#### 良い例

```ts
export function itemRoutes(items: Set<string>) {
  return new Hono().post("/:name", (c) => {
    // 想定できるエラーは、Service が AppError で投げる。ここでは try〜catch せず、
    // グローバルのエラーハンドラ（app.onError(handleError)）が、HTTP のステータスとエラーコードに変える
    addItem(items, c.req.param("name"));
    return c.json({ name: c.req.param("name") }, 201);
  });
}
```

- `AppError`は、エラーハンドラで、HTTPステータス（例：`CONFLICT`は`409`）とエラーコード（`code`）に変わる

#### 悪い例

```ts
export function itemRoutesBad(items: Set<string>) {
  return new Hono().post("/:name", (c) => {
    try {
      addItem(items, c.req.param("name"));
      return c.json({ name: c.req.param("name") }, 201);
    } catch (error) {
      // 悪い例：各層で try〜catch して、自分で 500 を返している。409 のはずが 500 になり、エラーコード（code）も失われる
      return c.json({ error: String(error) }, 500);
    }
  });
}
```

- 問題：各層で`try`〜`catch`して自分で500を返すと、`409`のはずの重複が`500`になり、エラーコード（`code`）も失われる

## Cloudflare Workersでのバッチ処理

| 役割 | 使うもの |
| --- | --- |
| 起動の合図 | Cron Triggers（`scheduled`の処理）。設定はUTCで書き、日本時間を併記する |
| 大量の件数を小分けに処理する | Queues。メッセージは2回以上届く前提で、処理済みかをDBで確かめてから処理する。再試行の上限とデッドレターキューを設定する |
| 複数の手順を、途中から再開できるように進める | Workflows。実行ごとに一意の名前（例：`daily-summary-2026-09-30`）で起動する |

- 短い処理（数秒）はCron Triggersの中で直接実行してよい。迷ったら、Cron Triggersは起動の合図だけにする
- 実行の記録（開始・終了・件数・結果）を、DBの実行履歴とログに残す

## 型

- Workersの環境変数・バインディングの型は、`wrangler types`で生成する。`wrangler.jsonc`を変えたら生成し直す。生成したファイルはLint・整形の対象から外す
