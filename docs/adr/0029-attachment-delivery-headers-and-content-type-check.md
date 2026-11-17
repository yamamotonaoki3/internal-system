# 0029：添付の配信の応答だけ、共通のセキュリティヘッダーを上書きさせず、`content_type`にCHECK制約を付けない

- 状態：採用
- 日付：2026-11-16
- 関係：Issue #140、決定記録 C-176・C-126・C-153、[ADR-0011](0011-attachment-inspection-and-virus-scan.md)、[ADR-0012](0012-zero-trust-principle.md)、[docs/design/attachments.md](../design/attachments.md)、Skill「security」・「data-access-drizzle」

## 背景

Issue #140（メッセージの添付）の実装中に、計画で決めていなかった2つの設計の判断が出た。どちらも、計画を変えて実装した。

### 1. 配信の応答のセキュリティヘッダー

利用者が上げたファイルは、別のスクリプトを含みうる。そのため、配信の応答（`GET /api/attachments/:attachmentId`）には、アプリ全体の値ではなく、次の値を付ける（Skill「security」の「ファイルのアップロード」）。

- `Content-Security-Policy: default-src 'none'; sandbox`（スクリプト・スタイル・画像などを一切読ませず、`sandbox`で開く）
- `Cache-Control: private, no-store`

ところが、アプリ全体の2つのミドルウェアが、ルートの設定の**後で**これらを上書きしていた。

- `backend/src/lib/security.ts`の`securityHeaders`（Honoの`secureHeaders`）：全応答の`Content-Security-Policy`を、アプリ用の値（`default-src 'self'`など）にする
- `backend/src/lib/session-middleware.ts`の`noStoreForProtected`：認証が必要なAPIの応答の`Cache-Control`を`no-store`にする（C-58）

配信用のCSPがアプリ用の値に置き換わると、`sandbox`が外れ、アプリのオリジンで添付が開かれたときの防御が弱くなる。

### 2. `content_type`列のCHECK制約

`message_attachments.content_type`には、サーバーの検査が付ける固定の一覧（11種類）のCHECK制約を付ける予定だった。しかし、値`text/plain; charset=utf-8`にある「;」で、drizzle-kitの生成が、migrationのSQLを途中で切り、壊れたmigrationができた。

## 選択肢

### 配信のヘッダー

1. 共通のミドルウェアの対象から、配信のルートを外す：認証・送信元の確認など、ほかの共通の処理も外れる恐れがある。許可リストの管理が増える
2. 共通のミドルウェアはそのまま適用し、配信の応答が自分で付けた**特定の値だけ**を残す：アプリ全体の方針（CSP・`no-store`）を弱めない。ほかの応答には影響しない
3. 配信のルートで、共通のミドルウェアの後にヘッダーを付け直す：Honoのミドルウェアの順序の外で付けることになり、ルートに共通の処理の知識が漏れる

### `content_type`の制約

1. `;`を含まない形に値を変える（例：`text/plain`だけにする）：テキストの文字コード（UTF-8）の指定が失われ、ブラウザでの表示が文字化けしうる
2. CHECK制約を手で書いたmigrationに直す：生成物を手で書き換えない規則（Skill「data-access-drizzle」）と、ADR-0024・0025の例外の範囲に当たらない
3. CHECK制約を付けず、値の一覧をTypeScriptの型と共有定義で守る：DBの層での制約はなくなるが、書き込みの経路は検査の結果だけ

## 決定

### 配信のヘッダー（選択肢2）

- `security.ts`に`DOWNLOAD_CONTENT_SECURITY_POLICY`（`default-src 'none'; sandbox`）を定義し、`securityHeaders`は、応答が**この値と完全に一致する**CSPを付けた場合だけ、それを残す。アプリ全体のCSPより緩い値、または別の値は残さない。
- `session-middleware.ts`の`noStoreForProtected`は、応答がすでに`no-store`を含む`Cache-Control`（配信の`private, no-store`）を付けていれば、それを残す。ほかのAPIは、従来どおり`no-store`にする。
- 配信のルートは、`routes/attachments.ts`で、この2つに加えて`X-Content-Type-Options: nosniff`・`Cross-Origin-Resource-Policy: same-origin`を付ける。
- アプリの画面のCSP（`public/_headers`）は変えない。

### `content_type`（選択肢3）

- `content_type`にCHECK制約を付けない。値は、`shared/attachment-rules.ts`の`ATTACHMENT_CONTENT_TYPES`とTypeScriptの型（`AttachmentContentType`）で守る。
- `Content-Type`は、サーバーの検査（`attachment-inspection.ts`）の結果だけから付ける。利用者の入力（申告された種類・拡張子）は、`content_type`の列にも配信の応答にも入らない。
- ほかの列のCHECK（`original_name`の長さ、`kind`、`size_bytes`）は、そのまま付ける。

## 理由

- 配信の応答は、利用者が上げた内容をそのまま返すため、アプリ全体のCSPより**厳しい**値を付けたい。上書きを許すと、より弱い値になってしまう。完全一致の値だけを残すので、将来、別のルートが緩いCSPを付けても、アプリ全体の値に戻る（安全側）。
- `content_type`は、書き込みの経路が検査の結果の1か所だけで、利用者の入力が入らない。CHECK制約がなくても、不正な値が入る経路がない。一方、生成物を手で書き換える例外を増やすと、migrationの規則が弱くなる。
- `text/plain; charset=utf-8`の文字コードの指定は、日本語のテキスト・CSVを文字化けなく見せるために必要。

## 影響

- 共通のヘッダーの設定（`security.ts`・`session-middleware.ts`）に、配信の応答だけの例外ができた。ヘッダーの設定を変えるときは、配信の応答（`backend/src/routes/attachments.test.ts`のヘッダーの確認）も確かめる。
- DBの層では、`content_type`に一覧外の値が入ることを防げない。`message_attachments`へ書く経路を増やすとき（#270などでの変更を含む）は、検査の結果以外の値を入れない。CHECK制約を付け直す場合は、生成の問題が解決してから、ADR-0024の規則に従って別のIssueで行う。
- 見直す条件：drizzle-kitが`;`を含むCHECKを正しく生成できるようになったとき、配信のCSPの値を変えるとき、Workersの応答の扱いが変わったとき。
- [ADR-0011](0011-attachment-inspection-and-virus-scan.md)の「配信のヘッダーは実装の計画で決める」（具体的な項目）は、このIssueで決めた（上の決定と`docs/design/attachments.md`）。ADR-0011の元の記述は変えない。
