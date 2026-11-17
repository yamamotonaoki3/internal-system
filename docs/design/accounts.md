# アカウントの個別発行・一覧・無効化・再有効化（Issue #199・#128）

## 目的

全体管理者が、社員のアカウントを1人ずつ発行し（S-23）、発行済みのアカウントを一覧で確かめる（S-22）。発行時にシステムが初期パスワードを生成し、発行直後の画面で一度だけ全体管理者へ表示する。受け取った本人は、初回ログインでパスワードの変更を求められる（[auth-session.md](auth-session.md)）。

## 範囲

| 区分 | 内容 |
| --- | --- |
| このIssueで作ったもの | 個別発行API・管理者用の一覧API・所属部署の候補API（`/api/admin/accounts`）、S-22（一覧）、S-23（登録）、共通部品`SelectField`、セッション応答の権限`perm.account.create`、監査操作`account.create` |
| 親#126に残すもの | CSV一括登録、パスワードの再発行（#127）、社員情報の変更、一覧の検索・絞り込み、ロール付与。0-1 AC-15の「発行と同時に全社連絡へ参加させる」は、Issue #200で足した（下の「全社連絡と部署の専用チャンネルへの参加」）。無効化・再有効化は、Issue #128の最初の子（128-a）で足した（下の「無効化と再有効化」） |
| #128で後に足すもの | 部署異動（128-b）、退職処理の申請と通知（128-c）。128-aでは作っていない（決定記録 C-177） |
| 未決定として記録するもの | A-5 レート制限（X-8の上限が未決定のため、このIssueでは入れない）。A-8 離脱確認ダイアログ（0-1 AC-21。既存の仕組みがないため作らない） |

## ファイルと役割

| ファイル | 役割 |
| --- | --- |
| `shared/account-rules.ts` | 発行の入力規則の定義元。本名50文字・表示名30文字を持ち、社員ID・メール・内線・役職は`shared/setup-rules.ts`の定義を参照して二重に定義しない。`noControlCharacters`と各`account*Schema`をAPIと画面が共用する |
| `backend/src/routes/accounts.ts` | `adminAccountRoutes`。`requireAccountAdmin`が認可を入力検証より先に行い、`createSchema`で入力を検証する。発行応答に`noStore`を付ける。#128で`POST /:id/deactivate`・`POST /:id/reactivate`（`reactivateSchema`。応答は`noStore`）を足した |
| `backend/src/services/account.service.ts` | `createAccountService`が認可・部署の確認・初期パスワード生成とハッシュ・本名の暗号化・重複の409変換を行う。`withAccountService`が構成する。#128で`deactivate`・`reactivate`と、判定の純粋な関数`decideDeactivation`・`decideReactivation`、書き込みの失敗を読み直す`writeWithRecheck`を足した |
| `backend/src/db/account.repository.ts` | `createAccountRepository`が部署の確認、利用者の追加と監査ログの`db.batch`、一覧を扱う。一意制約違反を`AccountConflictError`にする。`withAccounts`が構成する。#128で`findAccountState`・`deactivate`・`reactivate`、前提の確認の`assertStatement`、前提が崩れたときの`AccountStateChangedError`、参加の文を発行と共用する`joinInitialChannels`を足した |
| `backend/src/services/authorizer.ts` | `canManageAccounts`が`perm.account.create`の会社scope判定を返す（セッション応答用） |
| `backend/src/routes/auth.ts` | セッション取得の`permissions`に`perm.account.create`を含める |
| `backend/src/lib/audit-actions.ts` | 監査操作名`account.create`を足した。#128で`account.deactivate`・`account.reactivate`を足した |
| `backend/src/index.ts` | `/api/admin/accounts`へ`adminAccountRoutes`を登録 |
| `frontend/src/features/accounts/DeactivateDialog.tsx`・`ReactivateDialog.tsx` | 無効化の確認ダイアログ、再有効化のダイアログ（部署の選択→送信→一時パスワードの一度だけの表示）。#128 |
| `frontend/src/features/accounts/useAccountLifecycle.ts` | `useDeactivateAccount`（`useMutation`）と、成功後に取り直す`invalidateAfterLifecycle`（`accountKeys`・`channelKeys`・`profileKeys`）。再有効化は一時パスワードを返すためhookにしない。#128 |
| `frontend/src/features/accounts/lifecycle-errors.ts` | `sendWithReauth`（再認証を挟んで送る。再認証が完了しなかったときは要求を送らず`NotSentError`にする）、`describeLifecycleError`（想定できる失敗を画面の文にし、想定外はnullを返して呼び出し側に再送出させる）。#128 |
| `docs/api/openapi.json`、`backend/src/openapi.test.ts` | 3操作のAPI仕様と実routeとの契約確認 |
| `frontend/src/features/accounts/account-api.ts` | `fetchDepartmentOptions`・`fetchAdminAccounts`・`submitAccount`。応答はzodで検証する。#128で`deactivateAccount`・`reactivateAccount`を足した |
| `frontend/src/features/accounts/query-keys.ts` | `accountKeys`（一覧・部署の候補） |
| `frontend/src/features/accounts/AccountForm.tsx`、`schemas/account-form.ts` | 入力フォーム（react-hook-form）と入力チェック。`initialDisplayName`が本名から表示名の初期値を作る。422の`fields`を該当欄へ、409・403・503をフォーム全体の案内にする |
| `frontend/src/features/accounts/AccountsList.tsx` | 一覧表。`useInfiniteQuery`でカーソル順に続きを取得する。#128で「操作」列（有効な行に「無効化」、無効な行に「再有効化」）を足した |
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
6. `createAccount`が、利用者の追加・全社連絡と所属部署の専用チャンネルへの参加・監査ログ（`account.create`）を1つの`db.batch`で確定する。片方が失敗したらどちらも残らない
7. 全社連絡がなければ503（上の節）。社員ID・メールの一意制約違反は`AccountConflictError`となり、Serviceが409`CONFLICT`にする。応答の文言は、どの項目かだけを伝え、重複した値は書かない
8. 201で、利用者の概要と`initialPassword`を返す

一覧（`GET /api/admin/accounts`）は認可の後、社員IDの正規化値順のカーソルページング（`cursorQuerySchema`、OFFSETなし）で返す。部署の候補（`GET /api/admin/accounts/department-options`）は、有効な部署を名前順で返す。

## API契約

| 操作 | 契約 |
| --- | --- |
| 発行 | `POST /api/admin/accounts`。本文は`loginId`・`legalName`・`displayName`・`email`・`emailConfirmed`（`true`のみ）・`departmentId`・任意の`extension`・`jobTitle`。余剰項目は422。成功時201で`id`・`loginId`・`displayName`・`departmentId`・`mustChangePassword`（`true`）・`createdAt`・`initialPassword`を返す。本名・メールは返さない。`Cache-Control: no-store` |
| 一覧 | `GET /api/admin/accounts`。`items`（`id`・`loginId`・`displayName`・`department`（`{id, name}`またはnull）・`email`・`extension`・`jobTitle`・`active`・`mustChangePassword`・`createdAt`）と`nextCursor`。メールを含み、本名は含めない。検索・絞り込みはない |
| 部署の候補 | `GET /api/admin/accounts/department-options`。`items`（`{id, name}`）を返す |
| エラー | 401、403（全体管理者以外）、422`VALIDATION_ERROR`（`fields`）、409`CONFLICT`（社員ID・メールの重複）、503`SERVICE_UNAVAILABLE`（本名の暗号化鍵が未設定、または全社連絡のチャンネルがない）。レート制限の429は入れていない（未決定） |

一覧の権限は、専用の権限IDを新設せず`perm.account.create`を流用する（承認済み）。メールの確認の記録は、確認した管理者と日時を`users`に保存し、監査ログの`detail`には部署IDと確認方法の分類だけを入れる。

## 主な入出力

| 処理 | 入力 | 出力 |
| --- | --- | --- |
| `createAccountService().create` | 操作者（利用者ID・traceId）、発行の入力、`piiKey` | `AccountCreated`（初期パスワードの平文を含む。保存しない）。部署不正は422、重複は409 |
| `createAccountService().authorize` | 操作者 | 全体管理者でなければ`FORBIDDEN`を投げる。Controllerが入力検証の前に呼ぶ |
| `createAccountService().listAdmin` / `.departmentOptions` | 操作者、カーソル・件数 / 操作者 | 一覧ページ / 有効な部署の候補 |
| `createAccountRepository().createAccount` | 利用者の入力（暗号化済みの本名・ハッシュ済みのパスワードを含む） | なし。利用者・チャンネルへの参加・監査ログをbatchで確定。一意制約違反は`AccountConflictError`、全社連絡がなければ`CompanyGeneralChannelMissingError` |
| `createAccountRepository().listAdmin` | 件数、カーソル | 本名を読まない一覧ページ |
| `canManageAccounts(env, userId, traceId)` | Workers環境、利用者ID、trace ID | `perm.account.create`の会社scope判定（真偽） |
| `submitAccount(input)` | 発行の入力 | `AccountCreated`（zod検証済み） |

## 全社連絡と部署の専用チャンネルへの参加（Issue #200）

`createAccount`の`db.batch`は、利用者の挿入の直後に全社連絡の存在確認の文を置き、続けて、全社連絡と所属部署の専用チャンネル2つ（`department`・`announcement`）への参加を入れ、最後に監査ログを書く。詳細は [channels.md](channels.md)。

- 全社連絡がない（またはアーカイブ済み）ときは、NOT NULL違反でbatch全体が失敗する。Repositoryが`CompanyGeneralChannelMissingError`にし、Serviceが`503 SERVICE_UNAVAILABLE`（「初期チャンネルが準備されていないため、アカウントを発行できません。システム管理者へ連絡してください。」）にして`logger.error`に記録する。利用者・参加・監査の行は残らない
- 所属部署に専用チャンネルがない場合（0009で名前が衝突して補われなかった部署など）は、全社連絡だけに参加して発行を成功させる。他部署のチャンネルには入らない
- ID・メールの重複（409）でも、参加の行は残らない
- 一意制約違反（409）と全社連絡の確認の失敗（503）以外のDBエラーは、変換せずそのまま再送出する（`translateError`）

## 無効化と再有効化（Issue #128。128-a）

決定は決定記録 C-177。実装したのは、無効化・再有効化だけ。部署異動（128-b）と退職処理の申請（128-c）は、まだない。

### API契約

| 操作 | 契約 |
| --- | --- |
| 無効化 | `POST /api/admin/accounts/:id/deactivate`。本文なし。成功は204 |
| 再有効化 | `POST /api/admin/accounts/:id/reactivate`。本文は`departmentId`だけ（余剰項目は422）。成功は200で`id`・`initialPassword`。`Cache-Control: no-store` |
| 409の`reason` | 無効化：`already_inactive`・`global_admin`・`department_owner`。再有効化：`already_active`。`reason`は、既存のエラー応答の形どおり、応答の最上位に出す |
| その他のエラー | 401、403（全体管理者以外・再認証の期限切れ`REAUTH_REQUIRED`）、404（対象がない）、422（本人の無効化、再有効化の部署がない・無効） |

### 判定の順

判定は純粋な関数ではなく、Service内の`decideDeactivation`・`decideReactivation`が事実を読んで順に確かめる。最初の判定と、書き込みの前提が崩れた後の読み直しで、同じ関数を使う。

- 無効化：対象がない（404）→ `perm.account.deactivate`（403）→ 対象が操作者本人（422）→ 再認証（403）→ 既に無効（409）→ 対象が全体管理者（409）→ 対象がいずれかの部署のオーナー（409）
- 再有効化：対象がない（404）→ `perm.account.reactivate`（403）→ 部署がない・無効（422。`fields`は`departmentId`）→ 再認証（403）→ 対象が既に有効（409）
- routeの`requireAccountAdmin`（`perm.account.create`）が先に全体管理者以外を403にする。そのためHTTPでは、全体管理者以外には対象の有無を教えない
- 操作の対象のボタンの出し分けは、管理画面を開けるのが全体管理者だけという既存のルートガード（`AccountManageRoute`）に任せる。認可はサーバーが毎回行う（ADR-0012）

### 書き込み：前提の確認と取り消し（#196の方式）

`createAccountRepository().deactivate`・`reactivate`は、`db.batch`の先頭に`assertStatement`を置く。前提の条件が崩れていると、`users.login_id`をNULLにするUPDATEになり、NOT NULL違反でbatch全体が取り消される。後続の文は無条件に書いてあり、先頭で確かめた前提がbatchの中で変わらないことに頼る。`translateError`は、この列の違反だけを`AccountStateChangedError`にし、ほかのDBエラーは変換せず再送出する。部署の管理（`department.repository.ts`）の同名の考え方だが、対象の表が違うため共通化していない。

| 操作 | 先頭の前提（すべて満たすときだけ書き込む） |
| --- | --- |
| 無効化 | 操作者≠対象、対象が有効で、判定の時に読んだ所属部署のまま、対象が全体管理者・オーナーでない、操作者が有効で会社範囲の全体管理者 |
| 再有効化 | 対象が無効、指定の部署が有効、操作者が有効で会社範囲の全体管理者 |

操作者の条件を書き込みにも入れるのは、全体管理者の引き継ぎ（0-10）の後の前任者や、無効になった操作者を拒否するため。再認証だけは、時刻がセッションの値でDBの行ではないため、Serviceで確かめ、書き込みの条件に入れない。

### 無効化で変わるもの

1つの`db.batch`で、次を確定する。順に、状態（`is_active`＝無効、`deactivated_at`、`department_id`＝NULL）、全チャンネルの参加の削除（全社連絡・部署の専用・個別。再有効化で戻さないため）、追加ロールの割り当ての削除（全体管理者・オーナーは前提で除外済み）、対象のセッションの失効（`revoked_at`）、監査`account.deactivate`（`detail`は元の部署IDだけ）。

DM（`conversation_members`）・既読位置・投稿には触れない。相手側のDMはそのまま残る（Issue #128の利用者の決定）。

### 再有効化で戻すもの・戻さないもの

- 戻すもの：同じ`users.id`・`login_id`で`is_active`を戻し、`deactivated_at`を消し、指定の部署に所属させる。全社連絡と、その部署の専用チャンネル2つ（`department`・`announcement`）へ参加させる（`joinInitialChannels`。発行と同じ文）。パスワードを新しい一時パスワードのハッシュに置き換え、`must_change_password`を立てる。監査`account.reactivate`（`detail`は部署IDだけ）
- 参加の行を作る前に、その社員の`channel_members`をすべて削除する（無効な間に紛れ込んだ行を残さないため。ダイレクトメッセージの参加は別の表のため触れない）
- 戻さないもの：ロールの割り当て、個別チャンネルへの参加（0-1 AC-14）。案件の参加は、案件の機能（#146以降）で扱う（案件の表がまだない）

### 一時パスワードの扱い

- 再有効化の中で、発行と同じ`generateInitialPassword`・`hashPassword`で作る。保存するのはハッシュだけ。値は応答に一度だけ入れ、`Cache-Control: no-store`を付ける。ログ・監査・エラーの詳細・例外のメッセージには出さない。Serviceの戻り値の型（`AccountReactivated`）を分け、routeは`id`と`initialPassword`だけを返す
- 画面では、`reactivateAccount`を`useMutation`に載せず、`ReactivateDialog`の`onSubmit`で直接awaitする。値はダイアログの`useState`だけに置き、「閉じる」で破棄する。storage・URL・遷移のstateには入れない（project-rules #199）。成功後は`invalidateAfterLifecycle`で一覧・チャンネル・社員一覧を取り直す。一時パスワードの表示は、一覧の取得の状態に左右されない
- 本人への伝達は、別の連絡手段で全体管理者が行う（0-3 AC-7）

### 前提が崩れた後の読み直し

Serviceの`writeWithRecheck`は、書き込みが`AccountStateChangedError`で失敗したときだけ、最初と同じ`decide`を呼んで事実を読み直す。操作者の認可から確かめ直すため、403・404・409・422のどれかが決まる。どれにも当たらなければ、成功扱いにせず`AccountStateChangedError`をそのまま投げる。それ以外のエラーは変換せず伝える。

### 同時の操作

無効化と再有効化が同時に来たときは、片方が先に確定し、もう片方は確定した後の状態に対して前提を確かめる。前提を満たせば、両方成功してよい（例：無効化の後の再有効化）。満たさなければ、前提が崩れてbatch全体が取り消され、読み直しで409になる。同じ操作が2つ同時に来たときは、一方だけが成功し、監査・失効・削除・参加は1回分だけになる（DBテストで確かめる）。

無効化と公開チャンネルへの自分での参加が同時に来たときは、参加の書き込みの条件に「本人が有効」を入れてあるため、無効化の後の参加は行が作られない。書き込みが0行で本人が無効なら、Serviceは401にする（[channels.md](channels.md)）。

### 画面の流れ（S-22）

- 行の操作列：有効な行に「無効化」（自分の行には出さない。表示の制御で、認可はサーバー）、無効な行に「再有効化」
- 無効化：`DeactivateDialog`で対象の表示名を示して確認 → `useDeactivateAccount`が`sendWithReauth`で再認証（期限内なら省く）を挟んで送る → 成功でダイアログが閉じ、一覧を取り直し、`onDone`で一覧の上に「アカウントを無効化しました」を出す。失敗はダイアログの中に出す（409は理由ごとの文、422は本人）
- 再有効化：`ReactivateDialog`で所属部署（`fetchDepartmentOptions`の候補）を選ぶ → 再認証を挟んで送る → 成功すると、同じダイアログに社員IDと一時パスワードを一度だけ表示する → 「閉じる」で一時パスワードを破棄してダイアログを閉じ、その時に`onDone`で一覧の上に「アカウントを再有効化しました」を出す（キャンセルや一時パスワード表示前の閉じ方では出さない）。メッセージに一時パスワードの値は含めない
- 完了のメッセージ：`AccountsList`の`useState`（`done`）に置き、`role="status"`の`Alert`で一覧の上に出す。時間では消さず、次の操作（無効化・再有効化のボタン）を始めたときに消す
- 一覧の取得がエラー・読み込み中になっても、開いているダイアログ（一時パスワードの表示中を含む）を破棄しない。ダイアログは一覧の状態の分岐の外に置く
- 再有効化が422で、`fields`に`departmentId`があるときは、所属部署の入力欄のエラーとして出す（`isDepartmentFieldError`）
- 再認証が完了しなかったときは、要求を送らず、その旨をダイアログに出す

### 要件・画面案との差

- `api-draft.md`のEP-0-10・EP-0-11と違い、パスは`/api/admin/accounts/:id/...`、無効化の応答は204、再有効化の応答は`id`・`initialPassword`。それぞれの行に実装の注記を足した

## 初期パスワードの扱い

- 生成するのはサーバーで、保存するのはハッシュだけ。平文は発行応答に一度だけ入れ、ログ・監査ログ・エラーには入れない。応答には`noStore`を付け、キャッシュさせない
- フロントエンドでは、`submitAccount`を`useMutation`に載せず、`AccountForm`の`onSubmit`で直接awaitする。`useMutation`の結果はMutationCacheに残るため、初期パスワードを載せない。受け取った値は`AccountCreatePage`の`useState`（`registered`）にだけ置き、「一覧へ戻る」で破棄する。localStorage・sessionStorage・URLにも残さない（E2Eで確認）
- 一覧へ戻ったときの「登録しました」は、画面遷移の`state`で一度だけ出す。初期パスワードは渡さない
- 表示前に失った場合は、全体管理者が再発行する（再発行は#127）。再有効化の一時パスワードも同じ扱い（上の「無効化と再有効化」）

## 再認証が不要な根拠

要件0-5本文は、アカウント登録を再認証の対象にしない。S-23の発行は再認証を求めない。無効化・再有効化は再認証の対象で、Serviceが`assertRecentReauth`（`credentials.service.ts`）で確かめる（Issue #128）。パスワード再発行など、対象になる操作を足すときも再認証を組み込む。

## 拡張点

| 後続 | 足す位置 |
| --- | --- |
| #127・#128・#129（再発行・部署異動・退職処理の申請・社員情報の変更など。無効化・再有効化は#128の128-aで実装済み） | 操作ごとにrouteを`adminAccountRoutes`へ足し、Serviceに認可つきの操作を足す。128-bの異動は、128-aと同じ`assertStatement`の方式でbatchを足す。128-cは、無効化のbatchに申請を完了にする文を足す（今は差し込み口を作らない）。一覧の行の操作は`AccountsList`の列に足す。`AccountListItem`は`active`・`mustChangePassword`を既に持つ。再認証が必要な操作は、既存の再認証の仕組み（[auth-session.md](auth-session.md)）を呼ぶ |
| 一覧の検索・絞り込み | `listAdmin`の入力に条件を足す。要件のEP-0-09は`status`・`departmentId`を想定している |
| 部署の候補の統合 | `listActiveDepartments`は部署の管理（#196）のRepositoryができたら、そちらへ統合する |

## テストの場所

- 入力規則：`backend/src/lib/account-rules.test.ts`、`frontend/src/features/accounts/schemas/account-form.test.ts`
- バックエンド：`backend/src/routes/accounts.test.ts`、`backend/src/services/account.service.test.ts`、`backend/src/db/account.repository.db.test.ts`・`account.repository.errors.db.test.ts`（参加・全社連絡がないとき）、`backend/src/services/account.service.logging.test.ts`、`backend/src/routes/accounts.channels.test.ts`、`backend/src/routes/auth.test.ts`（セッション応答の権限）、`backend/src/openapi.test.ts`
- バックエンド（#128 無効化・再有効化）：`backend/src/db/account.repository.lifecycle.db.test.ts`（batchの結果・前提の崩れ・同時の操作・監査）、`backend/src/services/account.service.lifecycle.test.ts`（判定の順・読み直し）、`backend/src/routes/accounts.lifecycle.test.ts`（認可・再認証・応答・ログ）
- フロントエンド：`frontend/src/pages/AccountsPage.test.tsx`、`AccountCreatePage.test.tsx`、`frontend/src/accounts-route.test.tsx`、`frontend/src/components/SelectField.test.tsx`、`frontend/src/features/accounts/account-lifecycle.test.tsx`（#128。ボタンの出し分け・一時パスワードの表示と消去）
- E2E：`e2e/accounts.spec.ts`（シードは`e2e/seeds/accounts.sql`・`accounts-cleanup.sql`）、`e2e/accounts-lifecycle.spec.ts`（#128。シードは`e2e/seeds/accounts-lifecycle.sql`・`accounts-lifecycle-cleanup.sql`。[e2e.md](../testing/e2e.md)）

## 要件定義書との食い違い（記録）

実装は、要件定義書の下書きと次の点で異なる。要件定義書の本文は変えず、API下書き（[api-draft.md](../requirements/api-draft.md)）のEP-0-07・EP-0-09に、このIssueで決めたことを追記した。

- パスは`/api/admin/accounts`（下書きは`POST /api/users`・`GET /api/admin/users`）
- 発行の入力に`displayName`（1〜30文字）と`emailConfirmed`を持つ。メールの重複も409にする
- 一覧はメールを含み本名を含まない。項目は`department`・`active`・`mustChangePassword`・`createdAt`で、下書きの`status`・`deactivatedAt`・絞り込みは持たない
- 部署の候補APIは下書きにない

## 関係するIssue・ADR

- Issue #199：アカウントの個別発行とアカウント一覧
- Issue #126：アカウント管理（親）。#127・#128・#129
- Issue #128：無効化・再有効化・部署異動・退職処理の申請。128-a（無効化・再有効化）を実装した。決定は決定記録 C-177
- Issue #200：全社連絡と部署の専用チャンネルへの参加を足した（[channels.md](channels.md)）
- ADR-0006：安定IDとカーソルページング
- ADR-0012：サーバー側で毎回認可する
- ADR-0013：初回セットアップの認証と本名の暗号化
- ADR-0020：ミューテーション・E2Eの実行範囲
