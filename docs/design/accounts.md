# アカウントの個別発行と一覧（Issue #199）

## 目的

全体管理者が、社員のアカウントを1人ずつ発行し（S-23）、発行済みのアカウントを一覧で確かめる（S-22）。発行時にシステムが初期パスワードを生成し、発行直後の画面で一度だけ全体管理者へ表示する。受け取った本人は、初回ログインでパスワードの変更を求められる（[auth-session.md](auth-session.md)）。

## 範囲

| 区分 | 内容 |
| --- | --- |
| このIssueで作ったもの | 個別発行API・管理者用の一覧API・所属部署の候補API（`/api/admin/accounts`）、S-22（一覧）、S-23（登録）、共通部品`SelectField`、セッション応答の権限`perm.account.create`、監査操作`account.create` |
| 親#126に残すもの | CSV一括登録、無効化・再有効化、パスワードの再発行、社員情報の変更、一覧の検索・絞り込み、ロール付与。0-1 AC-15のうち「発行と同時に全社連絡へ参加させる」は、チャンネルの実装（#200）と統合するときに足す |
| 未決定として記録するもの | A-5 レート制限（X-8の上限が未決定のため、このIssueでは入れない）。A-8 離脱確認ダイアログ（0-1 AC-21。既存の仕組みがないため作らない） |

## ファイルと役割

| ファイル | 役割 |
| --- | --- |
| `shared/account-rules.ts` | 発行の入力規則の定義元。本名50文字・表示名30文字を持ち、社員ID・メール・内線・役職は`shared/setup-rules.ts`の定義を参照して二重に定義しない。`noControlCharacters`と各`account*Schema`をAPIと画面が共用する |
| `backend/src/routes/accounts.ts` | `adminAccountRoutes`。`requireAccountAdmin`が認可を入力検証より先に行い、`createSchema`で入力を検証する。発行応答に`noStore`を付ける |
| `backend/src/services/account.service.ts` | `createAccountService`が認可・部署の確認・初期パスワード生成とハッシュ・本名の暗号化・重複の409変換を行う。`withAccountService`が構成する |
| `backend/src/db/account.repository.ts` | `createAccountRepository`が部署の確認、利用者の追加と監査ログの`db.batch`、一覧を扱う。一意制約違反を`AccountConflictError`にする。`withAccounts`が構成する |
| `backend/src/services/authorizer.ts` | `canManageAccounts`が`perm.account.create`の会社scope判定を返す（セッション応答用） |
| `backend/src/routes/auth.ts` | セッション取得の`permissions`に`perm.account.create`を含める |
| `backend/src/lib/audit-actions.ts` | 監査操作名`account.create`を足した |
| `backend/src/index.ts` | `/api/admin/accounts`へ`adminAccountRoutes`を登録 |
| `docs/api/openapi.json`、`backend/src/openapi.test.ts` | 3操作のAPI仕様と実routeとの契約確認 |
| `frontend/src/features/accounts/account-api.ts` | `fetchDepartmentOptions`・`fetchAdminAccounts`・`submitAccount`。応答はzodで検証する |
| `frontend/src/features/accounts/query-keys.ts` | `accountKeys`（一覧・部署の候補） |
| `frontend/src/features/accounts/AccountForm.tsx`、`schemas/account-form.ts` | 入力フォーム（react-hook-form）と入力チェック。`initialDisplayName`が本名から表示名の初期値を作る。422の`fields`を該当欄へ、409・403・503をフォーム全体の案内にする |
| `frontend/src/features/accounts/AccountsList.tsx` | 一覧表。`useInfiniteQuery`でカーソル順に続きを取得する |
| `frontend/src/pages/AccountsPage.tsx`、`AccountCreatePage.tsx` | S-22・S-23の画面構成 |
| `frontend/src/components/SelectField.tsx` | 共通の選択欄（[style-foundation.md](style-foundation.md)） |
| `frontend/src/features/setup/components/InitialPasswordNotice.tsx` | 初回セットアップと共用の初期パスワード表示。`proceedLabel`で進むボタンの文言を変えられる（S-23は「一覧へ戻る」） |
| `frontend/src/App.tsx`、`frontend/src/features/app-shell/navigation.ts`、`frontend/src/features/auth/api/auth-api.ts` | `AccountManageRoute`（権限がなければ`NotFoundPage`）、管理メニューの「アカウント管理」、`SessionInfo.permissions`の型の拡張 |

## 処理の流れ

発行（`POST /api/admin/accounts`）：

1. 認証・送信元の確認（共通ミドルウェア）の後、`requireAccountAdmin`が`perm.account.create`（会社scope）を確かめる。入力検証より先に行い、管理者以外に入力の規則や設定の不備を教えない。Serviceの`create`も毎回認可する（route・serviceの二重の確認。ADR-0012）
2. `createSchema`で入力を検証する（不正は422。`emailConfirmed`は`true`でなければ422）
3. 本名の暗号化鍵（`PII_ENCRYPTION_KEY`）が未設定なら503
4. `findActiveDepartment`で有効な所属部署を確かめる。無ければ422（`fields`は`departmentId`）
5. 利用者IDを`newUlid`で先に作り、`generateInitialPassword`で初期パスワードを作る。`hashPassword`でハッシュ、`encryptLegalName`で本名を暗号化する
6. `createAccount`が、利用者の追加と監査ログ（`account.create`）を1つの`db.batch`で確定する。片方が失敗したらどちらも残らない
7. 社員ID・メールの一意制約違反は`AccountConflictError`となり、Serviceが409`CONFLICT`にする。応答の文言は、どの項目かだけを伝え、重複した値は書かない
8. 201で、利用者の概要と`initialPassword`を返す

一覧（`GET /api/admin/accounts`）は認可の後、社員IDの正規化値順のカーソルページング（`cursorQuerySchema`、OFFSETなし）で返す。部署の候補（`GET /api/admin/accounts/department-options`）は、有効な部署を名前順で返す。

## API契約

| 操作 | 契約 |
| --- | --- |
| 発行 | `POST /api/admin/accounts`。本文は`loginId`・`legalName`・`displayName`・`email`・`emailConfirmed`（`true`のみ）・`departmentId`・任意の`extension`・`jobTitle`。余剰項目は422。成功時201で`id`・`loginId`・`displayName`・`departmentId`・`mustChangePassword`（`true`）・`createdAt`・`initialPassword`を返す。本名・メールは返さない。`Cache-Control: no-store` |
| 一覧 | `GET /api/admin/accounts`。`items`（`id`・`loginId`・`displayName`・`department`（`{id, name}`またはnull）・`email`・`extension`・`jobTitle`・`active`・`mustChangePassword`・`createdAt`）と`nextCursor`。メールを含み、本名は含めない。検索・絞り込みはない |
| 部署の候補 | `GET /api/admin/accounts/department-options`。`items`（`{id, name}`）を返す |
| エラー | 401、403（全体管理者以外）、422`VALIDATION_ERROR`（`fields`）、409`CONFLICT`（社員ID・メールの重複）、503`SERVICE_UNAVAILABLE`（本名の暗号化鍵が未設定）。レート制限の429は入れていない（未決定） |

一覧の権限は、専用の権限IDを新設せず`perm.account.create`を流用する（承認済み）。メールの確認の記録は、確認した管理者と日時を`users`に保存し、監査ログの`detail`には部署IDと確認方法の分類だけを入れる。

## 主な入出力

| 処理 | 入力 | 出力 |
| --- | --- | --- |
| `createAccountService().create` | 操作者（利用者ID・traceId）、発行の入力、`piiKey` | `AccountCreated`（初期パスワードの平文を含む。保存しない）。部署不正は422、重複は409 |
| `createAccountService().authorize` | 操作者 | 全体管理者でなければ`FORBIDDEN`を投げる。Controllerが入力検証の前に呼ぶ |
| `createAccountService().listAdmin` / `.departmentOptions` | 操作者、カーソル・件数 / 操作者 | 一覧ページ / 有効な部署の候補 |
| `createAccountRepository().createAccount` | 利用者の入力（暗号化済みの本名・ハッシュ済みのパスワードを含む） | なし。利用者と監査ログをbatchで確定。一意制約違反は`AccountConflictError` |
| `createAccountRepository().listAdmin` | 件数、カーソル | 本名を読まない一覧ページ |
| `canManageAccounts(env, userId, traceId)` | Workers環境、利用者ID、trace ID | `perm.account.create`の会社scope判定（真偽） |
| `submitAccount(input)` | 発行の入力 | `AccountCreated`（zod検証済み） |

## 初期パスワードの扱い

- 生成するのはサーバーで、保存するのはハッシュだけ。平文は発行応答に一度だけ入れ、ログ・監査ログ・エラーには入れない。応答には`noStore`を付け、キャッシュさせない
- フロントエンドでは、`submitAccount`を`useMutation`に載せず、`AccountForm`の`onSubmit`で直接awaitする。`useMutation`の結果はMutationCacheに残るため、初期パスワードを載せない。受け取った値は`AccountCreatePage`の`useState`（`registered`）にだけ置き、「一覧へ戻る」で破棄する。localStorage・sessionStorage・URLにも残さない（E2Eで確認）
- 一覧へ戻ったときの「登録しました」は、画面遷移の`state`で一度だけ出す。初期パスワードは渡さない
- 表示前に失った場合は、全体管理者が再発行する（再発行は親#126に残す）

## 再認証が不要な根拠

要件0-5本文は、アカウント登録を再認証の対象にしない。S-23の発行は再認証を求めない。再有効化・パスワード再発行など、対象になる操作を足すときに再認証を組み込む。

## 拡張点

| 後続 | 足す位置 |
| --- | --- |
| #127・#128・#129（無効化・再有効化・再発行・社員情報の変更など） | 操作ごとにrouteを`adminAccountRoutes`へ足し、Serviceに認可つきの操作を足す。一覧の行の操作は`AccountsList`の列に足す。`AccountListItem`は`active`・`mustChangePassword`を既に持つ。再認証が必要な操作は、既存の再認証の仕組み（[auth-session.md](auth-session.md)）を呼ぶ |
| 親#126 AC-15（発行と同時に全社連絡へ参加） | `createAccount`の`db.batch`に、チャンネル参加の追加文を足す。利用者IDは先に生成済みなので、同じbatchで参照できる。#200のチャンネルのテーブルとあわせて統合する |
| 一覧の検索・絞り込み | `listAdmin`の入力に条件を足す。要件のEP-0-09は`status`・`departmentId`を想定している |
| 部署の候補の統合 | `listActiveDepartments`は部署の管理（#196）のRepositoryができたら、そちらへ統合する |

## テストの場所

- 入力規則：`backend/src/lib/account-rules.test.ts`、`frontend/src/features/accounts/schemas/account-form.test.ts`
- バックエンド：`backend/src/routes/accounts.test.ts`、`backend/src/services/account.service.test.ts`、`backend/src/db/account.repository.db.test.ts`、`backend/src/routes/auth.test.ts`（セッション応答の権限）、`backend/src/openapi.test.ts`
- フロントエンド：`frontend/src/pages/AccountsPage.test.tsx`、`AccountCreatePage.test.tsx`、`frontend/src/accounts-route.test.tsx`、`frontend/src/components/SelectField.test.tsx`
- E2E：`e2e/accounts.spec.ts`（シードは`e2e/seeds/accounts.sql`・`accounts-cleanup.sql`。[e2e.md](../testing/e2e.md)）

## 要件定義書との食い違い（記録）

実装は、要件定義書の下書きと次の点で異なる。要件定義書の本文は変えず、API下書き（[api-draft.md](../requirements/api-draft.md)）のEP-0-07・EP-0-09に、このIssueで決めたことを追記した。

- パスは`/api/admin/accounts`（下書きは`POST /api/users`・`GET /api/admin/users`）
- 発行の入力に`displayName`（1〜30文字）と`emailConfirmed`を持つ。メールの重複も409にする
- 一覧はメールを含み本名を含まない。項目は`department`・`active`・`mustChangePassword`・`createdAt`で、下書きの`status`・`deactivatedAt`・絞り込みは持たない
- 部署の候補APIは下書きにない

## 関係するIssue・ADR

- Issue #199：アカウントの個別発行とアカウント一覧
- Issue #126：アカウント管理（親）。#127・#128・#129、#200
- ADR-0006：安定IDとカーソルページング
- ADR-0012：サーバー側で毎回認可する
- ADR-0013：初回セットアップの認証と本名の暗号化
- ADR-0020：ミューテーション・E2Eの実行範囲
