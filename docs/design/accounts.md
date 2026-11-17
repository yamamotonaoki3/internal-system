# アカウントの個別発行・一覧・無効化・再有効化・部署異動・退職処理の申請（Issue #199・#128）

## 目的

全体管理者が、社員のアカウントを1人ずつ発行し（S-23）、発行済みのアカウントを一覧で確かめる（S-22）。発行時にシステムが初期パスワードを生成し、発行直後の画面で一度だけ全体管理者へ表示する。受け取った本人は、初回ログインでパスワードの変更を求められる（[auth-session.md](auth-session.md)）。

## 範囲

| 区分 | 内容 |
| --- | --- |
| このIssueで作ったもの | 個別発行API・管理者用の一覧API・所属部署の候補API（`/api/admin/accounts`）、S-22（一覧）、S-23（登録）、共通部品`SelectField`、セッション応答の権限`perm.account.create`、監査操作`account.create` |
| 親#126に残すもの | CSV一括登録、パスワードの再発行（#127）、社員情報の変更、一覧の検索・絞り込み、ロール付与。0-1 AC-15の「発行と同時に全社連絡へ参加させる」は、Issue #200で足した（下の「全社連絡と部署の専用チャンネルへの参加」）。無効化・再有効化は、Issue #128の最初の子（128-a）で足した（下の「無効化と再有効化」）。部署異動（即時）は、2つ目の子（128-b）で足した（下の「部署異動」）。退職処理の申請と通知は、3つ目の子（128-c）で足した（下の「退職処理の申請と通知」） |
| #128の128-cで足したもの | 退職処理の申請の表`retirement_requests`（migration 0024）、申請の作成・自分の申請の一覧・取り下げ・全体管理者の一覧・却下のAPI（`/api/retirement-requests`・`/api/admin/retirement-requests`）、無効化のbatchへの「申請を完了にする」文の追加、通知3種類、社員一覧（S-20）の申請のボタンと自分の申請の一覧、S-22のタブ、セッション応答の`permissions`への`perm.workspace.manage`（いずれも128-a・128-bでは作っていない） |
| 後に回したもの | 部署異動の異動日の指定（予約）は #274（決定記録 C-177） |
| 未決定として記録するもの | A-5 レート制限（X-8の上限が未決定のため、このIssueでは入れない）。A-8 離脱確認ダイアログ（0-1 AC-21。既存の仕組みがないため作らない） |

## ファイルと役割

| ファイル | 役割 |
| --- | --- |
| `shared/account-rules.ts` | 発行の入力規則の定義元。本名50文字・表示名30文字を持ち、社員ID・メール・内線・役職は`shared/setup-rules.ts`の定義を参照して二重に定義しない。`noControlCharacters`と各`account*Schema`をAPIと画面が共用する |
| `backend/src/routes/accounts.ts` | `adminAccountRoutes`。`requireAccountAdmin`が認可を入力検証より先に行い、`createSchema`で入力を検証する。発行応答に`noStore`を付ける。#128で`POST /:id/deactivate`・`POST /:id/reactivate`（`reactivateSchema`。応答は`noStore`）・`POST /:id/transfer`（`transferSchema`。204）を足した |
| `backend/src/services/account.service.ts` | `createAccountService`が認可・部署の確認・初期パスワード生成とハッシュ・本名の暗号化・重複の409変換を行う。`withAccountService`が構成する。#128で`deactivate`・`reactivate`と、判定の純粋な関数`decideDeactivation`・`decideReactivation`、書き込みの失敗を読み直す`writeWithRecheck`を足した。128-bで`transfer`と、異動の判定`decideTransfer`（異動元の部署を返す）を足した |
| `backend/src/db/account.repository.ts` | `createAccountRepository`が部署の確認、利用者の追加と監査ログの`db.batch`、一覧を扱う。一意制約違反を`AccountConflictError`にする。`withAccounts`が構成する。#128で`findAccountState`・`deactivate`・`reactivate`、前提の確認の`assertStatement`、前提が崩れたときの`AccountStateChangedError`、参加の文を発行と共用する`joinInitialChannels`を足した。128-bで`findTransferState`（異動の判定に使う対象の事実）・`transfer`・型`AccountTransferState`・`AccountTransferInput`を足した（`AccountStateChangedError`・`assertStatement`は共用）。128-cで、`deactivate`に、申請中の退職処理の申請を読む処理・前提の条件・申請を完了にする文・通知・監査の`detail`への`retirementRequestId`を足した |
| `backend/src/routes/retirement-requests.ts` | `retirementRequestRoutes`（`POST /`・`GET /mine`・`POST /:requestId/withdraw`）と`adminRetirementRequestRoutes`（`GET /`・`POST /:requestId/reject`）。入力の形（`createSchema`・`rejectSchema`・カーソルと`status`のクエリ）の確認と応答だけを行い、認可・再認証・状態の確認はServiceに任せる。申請IDは形を確かめず渡す。`backend/src/index.ts`で`/api/retirement-requests`と`/api/admin/retirement-requests`へ登録した（128-c） |
| `backend/src/services/retirement-request.service.ts` | `createRetirementRequestService`（`create`・`listMine`・`listForReview`・`reject`・`withdraw`）。判定の関数（`decideCreate`・`decideReject`・`decideWithdraw`）が、最初の判定と、書き込みの前提が崩れた後の読み直し（`writeWithRecheck`）の両方に使われる。`withRetirementRequestService`が構成する。承認の専用の操作は作らない（128-c） |
| `backend/src/db/retirement-request.repository.ts` | `createRetirementRequestRepository`。対象・申請の事実を読む`findTarget`・`findForDecision`、通知の宛先を読む`findGlobalAdminIds`、`create`・`reject`・`withdraw`（1操作＝1つの`db.batch`。先頭に前提の確認、続けて申請の更新・監査・通知）、一覧の`listMine`・`listForReview`。前提の崩れは`RetirementRequestStateChangedError`、申請中の重複は`RetirementRequestConflictError`にし、それ以外のDBエラーは変換しない。`withRetirementRequests`が構成する（128-c） |
| `backend/db/schema.ts`、`backend/db/migrations/0024_add_retirement_requests.sql` | `retirement_requests`の定義と、migration（生成物のまま）。同じ対象の申請中の申請を1件に限る部分一意索引、状態・却下の理由・決裁の列のCHECK、索引2つ。詳しくは「退職処理の申請と通知」の「データ」（128-c） |
| `backend/src/services/authorizer.ts`、`backend/src/routes/auth.ts`、`backend/src/services/profile.service.ts`、`backend/src/db/profile.repository.ts` | `canManageAnyDepartment`（いずれかの部署で`perm.workspace.manage`を持つか。セッション応答の`permissions`の表示の制御）、社員一覧の行ごとの`canRequestRetirement`（`listDirectory`が`canForDepartments`で計算。`DirectoryRow.hasManagerRole`は応答に出さない）（128-c） |
| `shared/notification-kinds.ts`、`backend/src/lib/audit-actions.ts` | 通知の種類`retirement_request.submitted`・`.approved`・`.rejected`（`containsRoomContent`は偽）、監査操作`retirement_request.create`・`.reject`・`.withdraw`（128-c） |
| `frontend/src/features/retirement-requests/`、`frontend/src/pages/MyRetirementRequestsPage.tsx` | `api/`（通信・query key）、`hooks/useRetirementRequests.ts`（却下は再認証を挟む。申請・取り下げは挟まない）、`components/`（`RetirementRequestAction`＝S-20の行のボタンと申請の確認、`RetirementRequestReviewList`＝S-22のタブ、`RejectDialog`、`MyRetirementRequestList`＝自分の申請と取り下げ、共通の`ConfirmDialog`）、`labels.ts`（状態の表示名）、`describe-error.ts`、公開部分は`index.ts`（128-c） |
| `frontend/src/pages/MembersPage.tsx`、`frontend/src/pages/AccountsPage.tsx`、`frontend/src/features/accounts/DeactivateDialog.tsx`、`frontend/src/features/notifications/notification-views.ts`、`frontend/src/App.tsx` | 社員一覧の行のボタンと「自分の退職処理の申請」のリンク、S-22のタブ（`?tab=retirement-requests`）、申請のタブから開くための無効化ダイアログの対象の型の縮小（表示名とIDだけ）、通知の文言と移動先、ルート`/retirement-requests/mine`（128-c） |
| `backend/src/services/authorizer.ts` | `canManageAccounts`が`perm.account.create`の会社scope判定を返す（セッション応答用） |
| `backend/src/routes/auth.ts` | セッション取得の`permissions`に`perm.account.create`を含める |
| `backend/src/lib/audit-actions.ts` | 監査操作名`account.create`を足した。#128で`account.deactivate`・`account.reactivate`・`account.transfer`を足した |
| `backend/src/index.ts` | `/api/admin/accounts`へ`adminAccountRoutes`を登録 |
| `frontend/src/features/accounts/DeactivateDialog.tsx`・`ReactivateDialog.tsx` | 無効化の確認ダイアログ、再有効化のダイアログ（部署の選択→送信→一時パスワードの一度だけの表示）。#128 |
| `frontend/src/features/accounts/TransferDialog.tsx` | 異動のダイアログ（異動先の部署の選択→再認証を挟んで送信）。#128（128-b） |
| `frontend/src/features/accounts/useAccountLifecycle.ts` | `useDeactivateAccount`・`useTransferAccount`（どちらも`useMutation`）と、成功後に取り直す`invalidateAfterLifecycle`（`accountKeys`・`channelKeys`・`profileKeys`）。再有効化は一時パスワードを返すためhookにしない。#128 |
| `frontend/src/features/accounts/lifecycle-errors.ts` | `sendWithReauth`（再認証を挟んで送る。再認証が完了しなかったときは要求を送らず`NotSentError`にする）、`describeLifecycleError`（想定できる失敗を画面の文にし、想定外はnullを返して呼び出し側に再送出させる）。#128 |
| `docs/api/openapi.json`、`backend/src/openapi.test.ts` | 発行・無効化・再有効化・異動のAPI仕様と実routeとの契約確認 |
| `frontend/src/features/accounts/account-api.ts` | `fetchDepartmentOptions`・`fetchAdminAccounts`・`submitAccount`。応答はzodで検証する。#128で`deactivateAccount`・`reactivateAccount`・`transferAccount`を足した |
| `frontend/src/features/accounts/query-keys.ts` | `accountKeys`（一覧・部署の候補） |
| `frontend/src/features/accounts/AccountForm.tsx`、`schemas/account-form.ts` | 入力フォーム（react-hook-form）と入力チェック。`initialDisplayName`が本名から表示名の初期値を作る。422の`fields`を該当欄へ、409・403・503をフォーム全体の案内にする |
| `frontend/src/features/accounts/AccountsList.tsx` | 一覧表。`useInfiniteQuery`でカーソル順に続きを取得する。#128で「操作」列（有効な行に「異動」と「無効化」、無効な行に「再有効化」）を足した |
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

決定は決定記録 C-177。この節で扱うのは、無効化・再有効化（128-a）。部署異動は次の「部署異動」の節、退職処理の申請（128-c）は「退職処理の申請と通知」の節に書く。128-cで、無効化のbatchに、申請中の申請を完了にする文と通知を足した（「退職処理の申請と通知」の「無効化との連動」）。

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
| 無効化 | 操作者≠対象、対象が有効で、判定の時に読んだ所属部署のまま、対象が全体管理者・オーナーでない、操作者が有効で会社範囲の全体管理者。128-cで、「対象への申請中の退職処理の申請が、読んだときと同じ（なかったなら、今もない）」を足した |
| 再有効化 | 対象が無効、指定の部署が有効、操作者が有効で会社範囲の全体管理者 |

操作者の条件を書き込みにも入れるのは、全体管理者の引き継ぎ（0-10）の後の前任者や、無効になった操作者を拒否するため。再認証だけは、時刻がセッションの値でDBの行ではないため、Serviceで確かめ、書き込みの条件に入れない。

### 無効化で変わるもの

1つの`db.batch`で、次を確定する。順に、状態（`is_active`＝無効、`deactivated_at`、`department_id`＝NULL）、全チャンネルの参加の削除（全社連絡・部署の専用・個別。再有効化で戻さないため）、追加ロールの割り当ての削除（全体管理者・オーナーは前提で除外済み）、対象のセッションの失効（`revoked_at`）、監査`account.deactivate`（`detail`は元の部署ID`fromDepartmentId`。128-cで`retirementRequestId`を足した）。128-cで、監査の前に、対象への申請中の退職処理の申請を完了にする文と、申請者への通知を足した（「退職処理の申請と通知」の「無効化との連動」）。

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
- 部署異動（128-b）は、`api-draft.md`にEP番号がない（EP-0-16は社員情報の変更）。末尾の「2026-11-17 Issue #128（128-b）の実装」に形を追記した。要件0-1 AC-16の「異動日を指定」は #274 に回し、AC-16〜18の注記に実装の範囲を書いた
- 退職処理の申請（128-c）は、`api-draft.md`にEP番号がない（「退職処理を申請する」は「API候補あり・詳細未設計」）。末尾の「2026-11-17 Issue #128（128-c）の実装」に形を追記した。0-1 AC-20・3-4 AC-1〜3・状態の遷移（5.2）・画面（S-20・S-22）に、実装の注記を足した

## 部署異動（Issue #128。128-b）

決定は決定記録 C-177（利用者の決定U-4：異動は即時だけ。異動日の指定（予約）は Issue #274）。全体管理者が、有効な社員を別の部署へ即時に異動する。

### API契約

| 項目 | 契約 |
| --- | --- |
| 異動 | `POST /api/admin/accounts/:id/transfer`。本文は`departmentId`だけ（余剰項目は422）。成功は204 |
| 409の`reason` | `inactive`（対象が無効）・`department_owner`（対象が今の部署のオーナー）。応答の最上位に出す |
| その他のエラー | 401、403（全体管理者以外・再認証の期限切れ`REAUTH_REQUIRED`）、404（対象がない）、422（異動先の部署がない・無効、今と同じ部署。`fields`は`departmentId`） |

### 判定の順

Service内の`decideTransfer`が、事実（`findTransferState`）を読んで順に確かめる。最初の判定と、書き込みの前提が崩れた後の読み直しで、同じ関数を使う。成功すると異動元の部署（判定の時の所属）を返す。

1. 対象がない（404）
2. 権限`perm.employee.info.edit`を会社の範囲で持たない（403。全体管理者だけが持つ。R-12。決定記録 C-177）
3. 異動先の部署がない・無効（422）、異動先が今の部署と同じ（422）
4. 再認証（403`REAUTH_REQUIRED`）
5. 対象が無効、または所属がない（409`inactive`）、対象が今の部署のオーナー（409`department_owner`）

- routeの`requireAccountAdmin`（`perm.account.create`）が、先に全体管理者以外を403にする。HTTPでは、全体管理者以外には対象の有無を教えない
- 止めるのは、対象が今の部署のオーナーである場合だけ。ほかの部署のオーナー・全体管理者・本人は異動できる（C-177）。オーナーの割り当ては`findTransferState`が`ownedDepartmentIds`として返し、判定は「今の部署がその中にあるか」で行う

### 書き込み：前提の確認と取り消し（#196の方式）

`createAccountRepository().transfer`は、無効化・再有効化と同じく、`db.batch`の先頭に`assertStatement`を置く（`AccountStateChangedError`・`translateError`も共用）。先頭の前提は、次をすべて満たすときだけ書き込む。

| 前提 | 対応する判定 |
| --- | --- |
| 異動先が今の部署と違う | 422（今と同じ部署） |
| 対象が有効で、所属が判定の時に読んだ部署のまま | 409`inactive`、読んだ所属からの変化 |
| 対象が、その部署のオーナーでない | 409`department_owner` |
| 異動先の部署が有効 | 422 |
| 操作者が有効で、会社範囲の全体管理者 | 403 |

再認証は、無効化・再有効化と同じく、セッションの時刻でDBの行ではないため、Serviceで確かめ、前提に入れない。

### 異動で変わるもの・変わらないもの

1つの`db.batch`で、順に次を確定する。

- 変わるもの：所属（`users.department_id`）、旧部署の専用チャンネル2つ（`department`・`announcement`）の参加の削除、新部署の専用チャンネル2つ（削除されていないもの）への参加（すでに参加していれば入れない）、監査`account.transfer`
- 監査の`detail`：`fromDepartmentId`・`toDepartmentId`・`roleIds`。`roleIds`は、入れ子にしない決まりに合わせ、対象のロールの割り当ての役割IDを昇順に`,`で区切った文字列にする（C-177。batchの前に読む）。本名・メールは入れない
- 変わらないもの：全社連絡・個別のチャンネルの参加、DM（`conversation_members`）、ロールの割り当て、セッション
- 案件の作成申請の自動取消（5-3 AC-8）は、案件の表がまだないため作っていない（C-177の統括の決定(8)。128-bと146-Aのうち後にマージするほうで足す）

### 前提が崩れた後の読み直し

Serviceの`writeWithRecheck`（無効化・再有効化と共用）が、書き込みが`AccountStateChangedError`で失敗したときだけ、最初と同じ`decideTransfer`を呼んで事実を読み直す。権限の確認から順に確かめ直すため、403・404・409・422のどれかが決まる。どれにも当たらなければ、成功扱いにせず`AccountStateChangedError`をそのまま投げる。

### 同時の操作

同じ対象への異動が同時に来たときは、一方だけが先に確定する。もう一方は、確定した後の所属が判定の時に読んだ所属と変わっているため、前提が崩れてbatch全体が取り消される。読み直しで理由が決まればその応答（例：同じ部署への異動なら422）を返し、決まらなければ`AccountStateChangedError`のままになる。監査・参加の削除・参加は、確定した1回分だけになる（DBテストで確かめる）。【2026-11-17に直した：元は「異動と無効化が同時に来たときも、後に確定する側が前提（有効・所属が同じ）で止まる」と書いていたが、正確でない】異動と無効化が同時に来たときは、読んだ前提が崩れた側が取り消される。無効化が先に確定すれば、異動は「対象が有効」の前提が崩れて取り消される。異動が先に確定すれば、異動前の所属を読んだ無効化は「所属が読んだ部署のまま」の前提が崩れて取り消される。ただし、異動が確定した後の所属を無効化の側が読んだ場合は、無効化の前提は崩れず、両方とも成功しうる（異動の後に無効化。最終の状態は無効・所属なしで、不整合はない）。

### 画面の流れ（S-22）

- 行の操作列：有効な行に「異動」（本人の行にも出す）。表示の制御で、認可はサーバー。無効な行には出さない
- `TransferDialog`：対象の表示名と、変わるもの（今の部署の専用チャンネルから外れ、異動先の専用チャンネルに参加する。ロールと個別のチャンネルの参加は変わらない）を示し、異動先の部署（`fetchDepartmentOptions`の候補）を選ぶ。未選択は送らず欄のエラーにする。候補は有効な部署すべてで、今の部署はサーバーが422にする
- 送信：`useTransferAccount`が`sendWithReauth`で再認証（期限内なら省く）を挟んで送る。成功でダイアログが閉じ、`invalidateAfterLifecycle`で一覧・チャンネル・プロフィールを取り直し、`onDone`で一覧の上に「アカウントを異動しました」を出す（無効化・再有効化と同じ出し方。C-177）
- 失敗はダイアログの中に出す。422で`fields`に`departmentId`があるときは、異動先の欄のエラーにする（`isDepartmentFieldError`）。そのほかの409・422はサーバーのメッセージ、再認証が完了しなかったときは要求を送らない旨を出す
- 異動の確認のダイアログ・完了のメッセージは、画面の仕様（`screens.md`）に定めがなく、無効化・再有効化と同じ出し方で足した（C-177）

## 退職処理の申請と通知（Issue #128。128-c）

決定は決定記録 C-177（利用者の決定U-1〜U-3・U-8。統括の決定は「128-cのテストの作成で出た点」）。部署のオーナーが、自分の部署の有効な社員の退職処理を全体管理者へ申請する。申請しただけでは、対象の所属・状態・ロールは変わらない（0-1 AC-20）。全体管理者は、申請の行から無効化する（承認。専用のAPIは作らず、既存の無効化を使う）か、理由を付けて却下する。申請したオーナーは、申請中の申請を取り下げられる。差し戻しは作らない。

### データ

`retirement_requests`（migration 0024。`backend/db/schema.ts`の定義から生成。手作成しない）。

| 列・制約 | 内容 |
| --- | --- |
| `id`・`target_user_id`・`requested_by`・`department_id` | 申請のID、対象、申請者、申請した時の対象の部署。利用者・部署は外部キー |
| `status` | `pending`・`approved`・`rejected`・`withdrawn`（CHECK）。表示名は`labels.ts`（申請中・完了・却下・取り下げ済み） |
| `decision_reason`・`decided_by`・`decided_at` | 却下の理由、決裁者、決裁の日時。却下なら理由が必須、申請中以外なら決裁者・日時が必須（CHECK）。取り下げは決裁者＝申請者 |
| `retirement_requests_pending_target_unique` | `target_user_id`の部分一意索引（`status = 'pending'`のときだけ）。同じ対象の申請中の申請を1件に限る |
| 索引 | （`requested_by`, `id`）＝自分の一覧、（`status`, `id`）＝全体管理者の一覧 |

利用者・部署を消すテスト・E2Eの後始末（`backend/db/seeds/cleanup.sql`、`e2e/seeds/*-cleanup.sql`の既存のもの）は、`retirement_requests`を利用者・部署より先に消す（外部キーのため）。

### API契約

| 操作 | 契約 |
| --- | --- |
| 作成 | `POST /api/retirement-requests`。本文は`targetUserId`だけ（ULIDの形でなければ422。余剰項目は422）。成功は201で`id`・`targetUserId`・`departmentId`・`status`（`pending`）・`createdAt`。`Cache-Control: no-store` |
| 自分の申請の一覧 | `GET /api/retirement-requests/mine`。認証だけ。`cursor`・`limit`で新しい順に返す。`items`（`id`・`status`・`target`（`{id, displayName}`）・`department`（`{id, name}`）・`decisionReason`・`createdAt`・`decidedAt`）と`nextCursor`。本名・メールは含めない。申請者は本人のため含めない |
| 取り下げ | `POST /api/retirement-requests/:requestId/withdraw`。本文なし。成功は200で`id`・`status`（`withdrawn`） |
| 全体管理者の一覧 | `GET /api/admin/retirement-requests`。`status`（任意）・`cursor`・`limit`。`items`は自分の一覧に`requester`（`{id, displayName}`）を足した形。本名・メールは含めない |
| 却下 | `POST /api/admin/retirement-requests/:requestId/reject`。本文は`reason`だけ。前後の空白を除いて1〜200文字（定義元`shared/channel-name-rules.ts`の`REJECT_REASON_MAX_LENGTH`・`rejectReasonSchema`。チャンネルの作成申請と同じ）。成功は200で`id`・`status`（`rejected`） |
| 承認（完了） | 専用のAPIはない。`POST /api/admin/accounts/:id/deactivate`（128-a）で対象を無効化すると、申請中の申請が完了（`approved`）になる |
| 409の`reason` | `department_owner`・`global_admin`（作成。対象が今の部署のオーナー〔申請者自身を含む〕・全体管理者）、`duplicate_pending`（作成。同じ対象に申請中の申請がある）、`not_pending`（却下・取り下げ。申請中でない）。応答の最上位に出す |
| その他のエラー | 401、403（権限なし・対象が無効または所属なし・対象が申請者の部署の社員でない。却下は、再認証の期限切れ`REAUTH_REQUIRED`も403）、404（対象の社員・申請がない）、422（入力の形・却下の理由の長さ） |

OpenAPIは`docs/api/openapi.json`、契約の確認は`backend/src/openapi.test.ts`。

### 判定の順

Serviceの`decideCreate`・`decideReject`・`decideWithdraw`が、事実を読んで順に確かめる。最初の判定と、書き込みの前提が崩れた後の読み直し（`writeWithRecheck`）で、同じ関数を使う。読み直しでどの理由にも当たらなければ、成功にせず`RetirementRequestStateChangedError`をそのまま投げる。

| 操作 | 順 |
| --- | --- |
| 作成 | 対象がない（404）→ 対象が無効・所属なし、または操作者が対象の今の部署で`perm.workspace.manage`を持たない（403。対象が無効・所属なし・ほかの部署の社員でも、同じ403）→ 対象が部署のオーナー（409`department_owner`。申請者自身を含む）→ 対象が全体管理者（409`global_admin`）。申請中の重複は、判定ではなく書き込みの部分一意索引の違反を409`duplicate_pending`に変える |
| 却下 | 会社の範囲で`perm.account.deactivate`を持たない（403。申請の有無にかかわらず同じ）→ 再認証（403）→ 申請がない（404）→ 申請中でない（409`not_pending`） |
| 取り下げ | 申請がない・自分の申請でない（404。同じ応答）→ 申請中でない（409`not_pending`）。再認証は求めない |

- 再認証は、却下だけが求める（無効化は128-aのとおり）。申請の作成と取り下げは求めない（要件0-5のとおり。利用者の決定で、統括が一度「作成も求める」と決めたのを訂正した。C-177）。権限は、作成が`perm.workspace.manage`（R-54）を対象の今の部署の範囲で、一覧・却下が`perm.account.deactivate`を会社の範囲で。取り下げは申請者本人であること
- 認可・再認証・状態の確認はServiceが毎回行う（ADR-0012）。routeは入力の形の確認と応答だけを行う

### 書き込み：前提の確認と取り消し（#196の方式）

`createRetirementRequestRepository`の`create`・`reject`・`withdraw`は、`db.batch`の先頭に`assertRequestState`を置く（無効化・異動の`assertStatement`と同じ考え方だが、エラーの変換先が違うため共通化していない）。前提が崩れていると`users.login_id`をNULLにするUPDATEになり、NOT NULL違反でbatch全体が取り消される。`translateError`は、この列の違反を`RetirementRequestStateChangedError`、申請の部分一意索引の違反を`RetirementRequestConflictError`（`duplicate_pending`）にし、ほかのDBエラーは変換せず再送出する。

| 操作 | 先頭の前提（すべて満たすときだけ書き込む） |
| --- | --- |
| 作成 | 操作者≠対象、対象が有効で判定の時に読んだ部署に所属、対象が全体管理者・オーナーでない、操作者が有効で、その部署の範囲のオーナーの割り当てを持つ、通知の宛先（申請者を除く有効で会社範囲の全体管理者）が読んだときと同じ顔ぶれ |
| 却下 | 申請が申請中で、申請者が読んだとおり、操作者が有効で会社範囲の全体管理者 |
| 取り下げ | 操作者が申請者本人、申請が申請中で自分の申請、操作者が有効。申請者が今もその部署のオーナーであることは条件にしない（異動・オーナーの交代の後に残った申請を整理できるようにする） |

batchの中身は、先頭の前提の確認の後に、申請の更新（作成は挿入）、監査、通知の順。

| 操作 | 監査（`detail`） | 通知 |
| --- | --- | --- |
| 作成 | `retirement_request.create`（`targetUserId`・`departmentId`） | `retirement_request.submitted`を全体管理者へ |
| 却下 | `retirement_request.reject`（`requestedBy`。理由の文は入れない） | `retirement_request.rejected`を申請者へ |
| 取り下げ | `retirement_request.withdraw`（`requestedBy`） | なし |

### 通知

| 種類 | 宛先 | 送らない場合 | 移動先 |
| --- | --- | --- | --- |
| `retirement_request.submitted` | 有効で会社範囲の全体管理者 | 申請者本人が全体管理者のとき、本人には送らない | S-22の申請のタブ（`/accounts?tab=retirement-requests`） |
| `retirement_request.rejected` | 申請者 | 決裁者が申請者本人のとき | 自分の申請の一覧（`/retirement-requests/mine`） |
| `retirement_request.approved` | 申請者 | 申請中の申請がなかったとき（無効化のbatchの中で作る） | 自分の申請の一覧 |

- 取り下げは通知しない（チャンネルの作成申請と同じ。C-167）
- 通知の行に対象の社員の名前を保存しないため、文言は固定（「退職処理の申請が届きました」「…が完了しました」「…が却下されました」。`notification-views.ts`）。`containsRoomContent`は偽（部屋の内容を含まない）
- 宛先の確かめ方：Serviceが`findGlobalAdminIds`で宛先を読み、`create`のbatchの前提に「宛先が読んだときと同じ顔ぶれ」（`reviewersUnchanged`）を入れる。顔ぶれが変わっていれば、前提が崩れて何も残らず、読み直す。関係しない社員・ほかの部署のオーナーには送らない（3-4 AC-3。DBテスト・結合テストで確かめる）

### 無効化との連動（U-3）

`createAccountRepository().deactivate`（128-aの無効化）が、申請を通さない直接の無効化でも、対象への申請中の申請を完了にする。

- batchの前に、対象への申請中の申請（ID・申請者）を読む。読んだ申請が、batchの時点でも同じ（なかったなら、今もない）ことを、先頭の前提の条件に入れる
- 申請中の申請があれば、同じbatchで、状態を`approved`、決裁者を無効化の操作者、決裁日時を操作の時刻にし、申請者へ`retirement_request.approved`を通知する。なければ、申請の更新も通知も行わない
- 監査`account.deactivate`の`detail`に、`fromDepartmentId`に加えて`retirementRequestId`（完了にした申請のID。なければnull）を入れる
- 異動（128-b）とオーナーの交代では、申請を残す。全体管理者が、残った申請を、無効化・却下で判断する（取り下げは申請者が行える）

### 存在の非開示

- 作成：対象がない社員だけが404。対象が無効・所属なし・申請者の部署の社員でないときは、同じ403にする
- 却下・一覧：全体管理者でなければ、申請の有無にかかわらず同じ403
- 取り下げ：ない申請と、他人の申請は、同じ404。形の違うIDも、存在しない申請と同じ404（Controllerは形を確かめずServiceに渡す）
- 応答に本名・メールを含めない。表示名・部署・申請者・日時だけ

### 画面の流れ

- S-20（社員一覧。`MembersPage`）：サーバーが行ごとに返す`canRequestRetirement`（`profile.service.ts`の`listDirectory`。対象の部署で`perm.workspace.manage`を持ち、対象が自分・オーナー・全体管理者でない行）が真の行にだけ、「退職処理を申請」（読み上げ名に表示名を含む）を出す。表示の制御で、認可はサーバー。押すと、確認のダイアログ（対象の表示名を示す）→ 送信（再認証なし）。成功でダイアログが閉じ、一覧の上に「全体管理者へ退職処理を申請しました。処理が完了するまで社員は有効です」を出す（次の操作を始めたら消す）。失敗はダイアログの中に出し、閉じない
- S-20のリンク「自分の退職処理の申請」：セッションの`permissions`に`perm.workspace.manage`があるときだけ出す。押すと`/retirement-requests/mine`へ移る。この判定のために、セッション応答の`permissions`に、いずれかの部署のオーナーであるとき`perm.workspace.manage`を含める（`authorizer.ts`の`canManageAnyDepartment`。権限の一覧は増やさない。[auth-session.md](auth-session.md)）
- 自分の申請の一覧（`MyRetirementRequestsPage`。`/retirement-requests/mine`）：対象・部署・状態・申請日時・操作の表。却下された申請には理由を文字列のまま出す（HTMLとして解釈しない）。申請中の行にだけ「取り下げ」（確認のダイアログ → 送信。再認証なし）
- S-22（`AccountsPage`）：タブ「アカウント」と「退職処理の申請」。選んだタブはURLの`tab`に持つ（通知の移動先から開ける）。申請のタブは、申請中の申請を、対象・部署・申請者・申請日時で出し、行に「無効化」（128-aの`DeactivateDialog`を、表示名とIDだけの対象で開く）と「却下」（`RejectDialog`。理由を1〜200文字で入力し、再認証を挟んで送る）を出す。成功すると、一覧の上に「アカウントを無効化しました」「却下しました」を出し、次の操作を始めたら消す。ダイアログは一覧の取得の状態に左右されない
- 取り直し：申請・却下・取り下げの成功で、申請の一覧と社員一覧のキャッシュを取り直す。無効化の成功では、アカウントの一覧（128-aの`invalidateAfterLifecycle`）に加えて、申請の一覧も取り直す（無効化で申請が完了になるため）。自分の操作で自分の通知は増えないため、通知は取り直さない

### 同時の操作

- 同じ対象への申請が同時に来たときは、部分一意索引で一方だけが残り、もう一方は409`duplicate_pending`になる
- 申請の作成と対象の無効化が同時に来たときは、読んだ前提が崩れた側が取り消される。無効化が先なら、作成は「対象が有効」の前提が崩れ、読み直しで403になる。作成が先なら、無効化は「読んだ申請の有無が同じ」の前提が崩れて取り消される（読み直しでどの理由にも当たらなければ、成功にせず前提の崩れのまま返す）
- 却下・取り下げ・無効化が同じ申請に同時に来たときは、先に確定した1つだけが残り、後の側は申請中の前提が崩れて取り消される。読み直しで、却下・取り下げは409`not_pending`になる

### 範囲外・定めていないこと

- 申請の差し戻しは作らない（U-1）。オーナー自身・全体管理者の退職処理は、先にオーナーを交代させる（0-1 AC-9）
- S-13（部署管理）は作らない（U-8）。申請の画面はS-20とS-22のタブ
- 案件の作成申請の自動取消（5-3 AC-8）は、128-cでは作っていない（C-177の統括の決定(8)。案件の機能の#146で足す）

## 初期パスワードの扱い

- 生成するのはサーバーで、保存するのはハッシュだけ。平文は発行応答に一度だけ入れ、ログ・監査ログ・エラーには入れない。応答には`noStore`を付け、キャッシュさせない
- フロントエンドでは、`submitAccount`を`useMutation`に載せず、`AccountForm`の`onSubmit`で直接awaitする。`useMutation`の結果はMutationCacheに残るため、初期パスワードを載せない。受け取った値は`AccountCreatePage`の`useState`（`registered`）にだけ置き、「一覧へ戻る」で破棄する。localStorage・sessionStorage・URLにも残さない（E2Eで確認）
- 一覧へ戻ったときの「登録しました」は、画面遷移の`state`で一度だけ出す。初期パスワードは渡さない
- 表示前に失った場合は、全体管理者が再発行する（再発行は#127）。再有効化の一時パスワードも同じ扱い（上の「無効化と再有効化」）

## 再認証が不要な根拠

要件0-5本文は、アカウント登録を再認証の対象にしない。S-23の発行は再認証を求めない。無効化・再有効化・部署異動は再認証の対象で、Serviceが`assertRecentReauth`（`credentials.service.ts`）で確かめる（Issue #128）。退職処理の申請の作成と取り下げは再認証の対象外（要件0-5のとおり。C-177の利用者の決定）。却下は再認証の対象で、同じ関数で確かめる。パスワード再発行など、対象になる操作を足すときも再認証を組み込む。

## 拡張点

| 後続 | 足す位置 |
| --- | --- |
| #127・#128・#129（再発行・部署異動・退職処理の申請・社員情報の変更など。無効化・再有効化は#128の128-a、部署異動（即時）は128-b、退職処理の申請は128-cで実装済み） | 操作ごとにrouteを`adminAccountRoutes`へ足し、Serviceに認可つきの操作を足す。128-bの異動は、128-aと同じ`assertStatement`の方式でbatchを足した。異動日の指定（#274）は、予約の仕組みを別に足す。128-cは、無効化のbatchに申請を完了にする文を足し、申請そのものは別のroute（`retirement-requests.ts`）・Service・Repositoryに置いた。一覧の行の操作は`AccountsList`の列に足す。`AccountListItem`は`active`・`mustChangePassword`を既に持つ。再認証が必要な操作は、既存の再認証の仕組み（[auth-session.md](auth-session.md)）を呼ぶ |
| 一覧の検索・絞り込み | `listAdmin`の入力に条件を足す。要件のEP-0-09は`status`・`departmentId`を想定している |
| 部署の候補の統合 | `listActiveDepartments`は部署の管理（#196）のRepositoryができたら、そちらへ統合する |

## テストの場所

- 入力規則：`backend/src/lib/account-rules.test.ts`、`frontend/src/features/accounts/schemas/account-form.test.ts`
- バックエンド：`backend/src/routes/accounts.test.ts`、`backend/src/services/account.service.test.ts`、`backend/src/db/account.repository.db.test.ts`・`account.repository.errors.db.test.ts`（参加・全社連絡がないとき）、`backend/src/services/account.service.logging.test.ts`、`backend/src/routes/accounts.channels.test.ts`、`backend/src/routes/auth.test.ts`（セッション応答の権限）、`backend/src/openapi.test.ts`
- バックエンド（#128 無効化・再有効化）：`backend/src/db/account.repository.lifecycle.db.test.ts`（batchの結果・前提の崩れ・同時の操作・監査）、`backend/src/services/account.service.lifecycle.test.ts`（判定の順・読み直し）、`backend/src/routes/accounts.lifecycle.test.ts`（認可・再認証・応答・ログ）
- バックエンド（#128 部署異動）：`backend/src/db/account.repository.transfer.db.test.ts`（batchの結果・前提の崩れ・同時の操作・監査）、`backend/src/services/account.service.transfer.test.ts`（判定の順・読み直し）、`backend/src/routes/accounts.transfer.test.ts`（認可・再認証・応答）。契約は`backend/src/openapi.test.ts`
- フロントエンド：`frontend/src/pages/AccountsPage.test.tsx`、`AccountCreatePage.test.tsx`、`frontend/src/accounts-route.test.tsx`、`frontend/src/components/SelectField.test.tsx`、`frontend/src/features/accounts/account-lifecycle.test.tsx`（#128。ボタンの出し分け・一時パスワードの表示と消去）、`account-transfer.test.tsx`（#128。異動のダイアログ・再認証・エラー・完了のメッセージ）
- E2E：`e2e/accounts.spec.ts`（シードは`e2e/seeds/accounts.sql`・`accounts-cleanup.sql`）、`e2e/accounts-lifecycle.spec.ts`（#128。無効化・再有効化と異動の2本。シードは`e2e/seeds/accounts-lifecycle.sql`・`accounts-lifecycle-cleanup.sql`。[e2e.md](../testing/e2e.md)）
- バックエンド（#128 退職処理の申請）：`backend/src/db/retirement-request.repository.db.test.ts`（作成・却下・取り下げのbatch・前提の崩れ・一意索引・一覧・通知の宛先）、`backend/src/db/account.repository.retirement.db.test.ts`（無効化との連動・異動では残る・監査の`retirementRequestId`）、`backend/src/services/retirement-request.service.test.ts`（判定の順・読み直し）、`backend/src/routes/retirement-requests.test.ts`（認可・再認証・応答・存在の非開示）、`backend/src/lib/notification-kinds.retirement-request.test.ts`（通知の種類）、`backend/src/routes/auth.test.ts`（セッション応答の`perm.workspace.manage`）、`backend/src/routes/users.test.ts`（`canRequestRetirement`）。共通のデータは`backend/test/retirement-request-fixtures.ts`。契約は`backend/src/openapi.test.ts`
- フロントエンド（#128 退職処理の申請）：`frontend/src/features/retirement-requests/retirement-request.members.test.tsx`（S-20のボタンの出し分け・申請・リンク）、`retirement-request.pages.test.tsx`（S-22のタブ・却下・無効化・自分の申請の一覧と取り下げ）、`frontend/src/features/notifications/notification-views.retirement-request.test.ts`（通知の文言と移動先）
- E2E（#128 退職処理の申請）：`e2e/retirement-requests.spec.ts`（1本。オーナーがS-20で申請 → 全体管理者が通知からS-22のタブを開いて無効化 → オーナーに完了の通知。シードは`e2e/seeds/retirement-requests.sql`・`retirement-requests-cleanup.sql`。[e2e.md](../testing/e2e.md)）

## 要件定義書との食い違い（記録）

実装は、要件定義書の下書きと次の点で異なる。要件定義書の本文は変えず、API下書き（[api-draft.md](../requirements/api-draft.md)）のEP-0-07・EP-0-09に、このIssueで決めたことを追記した。

- パスは`/api/admin/accounts`（下書きは`POST /api/users`・`GET /api/admin/users`）
- 発行の入力に`displayName`（1〜30文字）と`emailConfirmed`を持つ。メールの重複も409にする
- 一覧はメールを含み本名を含まない。項目は`department`・`active`・`mustChangePassword`・`createdAt`で、下書きの`status`・`deactivatedAt`・絞り込みは持たない
- 部署の候補APIは下書きにない

## 関係するIssue・ADR

- Issue #199：アカウントの個別発行とアカウント一覧
- Issue #126：アカウント管理（親）。#127・#128・#129
- Issue #128：無効化・再有効化・部署異動・退職処理の申請。128-a（無効化・再有効化）・128-b（部署異動。即時）・128-c（退職処理の申請と通知）を実装した。決定は決定記録 C-177
- Issue #274：部署異動の異動日の指定（予約）。128-bでは作っていない
- Issue #200：全社連絡と部署の専用チャンネルへの参加を足した（[channels.md](channels.md)）
- ADR-0006：安定IDとカーソルページング
- ADR-0012：サーバー側で毎回認可する
- ADR-0013：初回セットアップの認証と本名の暗号化
- ADR-0020：ミューテーション・E2Eの実行範囲
