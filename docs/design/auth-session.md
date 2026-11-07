# 設計書：ログイン・認証情報・セッション・試行制限

Issue #120（親 #108）と #123 で実装した、ログイン（S-02）・ログアウト・セッション・本人のパスワード変更・再認証・試行制限・掃除・既定拒否の設計。コードは書き写さず、ファイル名・関数名で指す。

## 目的

- 社員IDとパスワードでログインし、Cookieのセッションで本人を確かめる（0-2 AC-1〜AC-7）
- ログインしていない人には、公開の許可リスト以外のAPIを使わせない（既定拒否。0-2 AC-3、ADR-0012）
- 初回パスワードのままの利用者には、パスワードの変更が済むまで、ほかのAPIを使わせない（0-3 AC-5）
- 本人によるパスワード変更（0-3 AC-1〜5・AC-10・AC-11）と、後続の重要な操作で使う再認証（0-5）を提供する
- ログインの総当たりを、接続元単位の受付枠と社員ID単位の待ち時間で抑える（C-150。ADR-0008）
- 期限切れのセッションと古い試行制限の行を、Cronで掃除する
- 範囲外：TOTP（#122）、管理者によるパスワード再発行（#127）、アカウント無効化に伴う全セッション失効（別Issue）、実際の業務操作への再認証の組み込み（各業務Issue）、共通レイアウト（S-01。#121）

## 重要な境界

- ログインは2段で、第二要素（TOTP）を挿入できる位置を作ってある。**#122が入るまで、全体管理者もパスワードだけでログインできる**（ADR-0009の「全体管理者はTOTP必須」は未実装）。このため、**#122が入るまで、本番に出さない**
- 初回パスワード（`must_change_password`）の利用者はログインできるが、ゲート許可リスト（ログアウト・セッション確認・`PUT /api/me/password`）以外は`403 PASSWORD_CHANGE_REQUIRED`になる。変更APIは認証必須であり、公開の許可リストには加えない。S-03は変更フォームとログアウトを表示し、成功後ホームへ移る

## ファイルと役割

### バックエンド

| ファイル | 役割 |
| --- | --- |
| `backend/src/routes/auth.ts` | `authRoutes`。`POST /login`・`POST /reauthenticate`・`POST /logout`・`GET /session`（すべて`no-store`）。Cookieの設定と削除、`LOGIN_THROTTLE_KEY`未設定時の503、接続元キーの算出をここで行う。認証情報処理は`WithCredentials`で受け取る |
| `backend/src/routes/me.ts` | `meRoutes`。`PUT /password`を登録し、JSON検証・認証済み主体・現在セッション・設定・接続元キーを`changePassword`へ渡す。初回変更中も使えるよう、共通middlewareのゲート許可に含める |
| `backend/src/services/auth.service.ts` | `verifyFirstFactor`（第一要素の確認。セッションは作らない）・`issueSession`（セッションの発行）・`login`（この2つ＋再ハッシュ）・`logout`・`admitSource`（接続元の受付枠）・`cleanupExpired`・`authCleanupJob`（Cronのジョブ）。`createAuthDeps`が時刻・待ち・乱数・パスワードの計算を束ねる（テストが差し替える） |
| `backend/src/services/credentials.service.ts` | `changePassword`・`reauthenticate`が本人確認・規則判定後の処理をまとめる。内部の`checkPassword`は共通接続元受付枠・社員ID単位の遅延・現在のパスワード照合・失敗記録を行う。`assertRecentReauth`は業務Serviceから再認証の有効期限を確かめる |
| `backend/src/db/credential.repository.ts` | `createCredentialRepository`・`withCredentials`。現在の認証情報取得、試行失敗記録、パスワード変更と再認証時刻の条件付き更新を提供する。変更ごとの監査・社員ID失敗数リセット・他セッション失効を同じD1 `batch`にまとめる |
| `backend/src/lib/password-policy.ts`・`password-denylist.ts` | `isPasswordAllowed`が共通の構成判定と禁止判定を組み合わせてサーバー側で最終検証する。`password-denylist.ts`は既存の公開入口を保つ再exportで、判定定義は`shared/password-rules.ts`に置く |
| `backend/src/lib/session-policy.ts` | セッション期限判定とCookieの共通属性を定義する。`SESSION_COOKIE_ATTRIBUTES`は`Path=/`・`Secure`だけを共有し、`HttpOnly`・`SameSite`・`Max-Age`はCookieを設定する呼出元が個別に指定する |
| `backend/src/services/session.service.ts` | `resolveSession`。トークンからログイン中の利用者を求める（期限は読み取り時に判定。最終操作の時刻は1分に間引いて更新） |
| `backend/src/db/auth.repository.ts` | `createAuthRepository`・`withAuth`。受付枠の確保（`acquireSourceSlot`）、社員IDの失敗数（`readAccountThrottle`・`recordLoginFailure`）、利用者の検索（`findLoginUser`）、セッションの作成（`createSession`）、再ハッシュの置き換え（`updatePasswordHashIfUnchanged`）、ログアウト（`revokeSession`）、掃除（`deleteExpiredSessions`・`deleteExpiredLoginAttempts`）、ロックの監査（`recordRateLimited`） |
| `backend/src/db/session.repository.ts` | `createSessionRepository`・`withSessions`。セッションの読み取り（`findSession`）と最終操作の更新（`touchSession`）。失効の文`revokeAllForUserStatement`・`revokeOthersForUserStatement`（文を返すだけで、実行しない）。後者は`credential.repository.ts`がパスワード変更batchで実行する |
| `backend/src/db/audit-log.repository.ts` | 既存の`auditLogInsert`に加えて、`auditLogInsertForSession`（セッションがあるときだけ書く条件付きの監査。ログインの成功・ログアウトで使う） |
| `backend/src/lib/session-middleware.ts` | `loadSession`・`noStoreForProtected`・`requireAuth`・`requirePasswordChanged`。公開の許可リストと、ゲートの許可リストをここに持つ |
| `backend/src/lib/session-policy.ts` | Cookie名`SESSION_COOKIE`（`__Host-session`）、無操作30分・ログインから24時間・最終操作の更新間隔1分の定数、`isSessionExpired` |
| `backend/src/lib/session-token.ts` | `generateSessionToken`（32バイトの乱数のbase64url）・`hashSessionToken`（SHA-256の16進。DBの`sessions.id`） |
| `backend/src/lib/throttle-policy.ts` | 試行制限の値（`SOURCE_WINDOW_MS`・`SOURCE_LIMIT`・`SOURCE_LOCK_MS`・`ACCOUNT_RESET_MS`）、`accountDelayMs`・`retryAfterSeconds` |
| `backend/src/lib/source-key.ts` | `normalizeSourceIp`（IPの正規化）・`hmacKey`・`accountBucketKey`・`sourceBucketKey`（接続元不明時の扱い） |
| `backend/src/lib/trace-id.ts` | `traceIdOf`。`X-Request-Id`を使うが、`[A-Za-z0-9._-]`の1〜64文字だけを受け付け、それ以外は新しいULIDにする |
| `backend/src/lib/password.ts` | 既存の`hashPassword`・`verifyPassword`に加えて、`needsRehash`・`verifyPasswordConstantCost`（ログイン用の検証）。scryptの`maxmem`指定を含む（ADR-0007） |
| `backend/src/lib/app-error.ts`・`backend/src/lib/error-handler.ts` | エラーコード`INVALID_CREDENTIALS`（401）・`PASSWORD_CHANGE_REQUIRED`（403）を追加。`RATE_LIMITED`の`details.retryAfterSeconds`は、本文に出さず`Retry-After`ヘッダーにだけ出す |
| `backend/src/lib/audit-actions.ts` | 操作の種類に`auth.login`・`auth.logout`・`auth.rate_limited`・`setup.rate_limited`を追加 |
| `backend/src/lib/logger/logger.ts` | DBのエラー（SQLとパラメータを含む）を、固定の文言にして出力する（下の「ログ」） |
| `backend/src/app.ts`・`backend/src/index.ts` | `/api/*`の既定拒否の組み立て、`/api/auth`・`/api/me`・`/api/setup`の組み込み、Cron（`authCleanupJob`）の登録 |
| `backend/src/config.ts` | `loadConfig`が`loginThrottleKey`を読む。未設定・形式不正（43文字のbase64urlでない）は`null` |
| `backend/db/schema.ts`・`backend/db/migrations/0004_add_sessions_login_attempts.sql` | `sessions`・`login_attempts`（下の「テーブル」） |
| `wrangler.jsonc` | `triggers.crons`に`17 18 * * *`。本番への適用は利用者のデプロイ後 |

### フロントエンド

| ファイル | 役割 |
| --- | --- |
| `frontend/src/pages/LoginPage.tsx` | 画面S-02（`/login`）。部品を組み合わせるだけ。ログイン済みなら`/`へ移る。未ログインでも見えるよう、`HealthStatus`と`SetupEntryLink`もここに置く |
| `frontend/src/pages/HomePage.tsx` | ログイン後のホーム（`h1`「ホーム」と`WelcomeMessage`）。枠（`main`）と、ログイン済みの確認は、`App.tsx`のレイアウトルート（`RequireAuth`→`AppShell`）が持つ（#121。[app-shell.md](app-shell.md)） |
| `frontend/src/features/auth/components/LoginForm.tsx` | 入力フォームと送信。401（`INVALID_CREDENTIALS`）・429・422・通信エラー・その他で文言を分ける。どちらが違うかは示さない |
| `frontend/src/features/auth/components/RequireAuth.tsx` | `AppShell`を包む外側のガード。ログイン済みのときだけ中身を出す。`UNAUTHENTICATED`なら`/login`へ。確認中・確認できない・`mustChangePassword`は枠なしで`PageLayout`に包み、後者は`PasswordChangePending`からS-03のフォームを出す |
| `frontend/src/features/auth/components/LogoutButton.tsx`・`PasswordChangePending.tsx`・`WelcomeMessage.tsx` | ログアウトのボタン（共通レイアウトではアバターメニュー内に置く）、初回変更フォームと成功後ホームへの移動、ようこそ表示と案内文 |
| `frontend/src/features/auth/hooks/useSession.ts`・`useLogin.ts`・`useLogout.ts` | セッションの取得、ログイン、ログアウト（成功したら`queryClient.clear()`して`/login`へ） |
| `frontend/src/features/auth/api/auth-api.ts`・`query-keys.ts` | `SessionInfo`型と`fetchSession`・`login`・`logout`・`changePassword`・`reauthenticate`。共通の`apiClient`を使い、ログイン時の`reauthenticatedAt`は`null` |
| `frontend/src/features/auth/schemas/password-change-form.ts`・`components/PasswordChangeForm.tsx` | `createPasswordChangeSchema`は`shared/password-rules.ts`の構成・禁止判定を使い、確認欄と画面固有の項目エラーも検証する。これは入力時の案内であり、確定処理ではサーバーが`isPasswordAllowed`で再検証する。`PasswordChangeForm`は共有する長さ定数から説明を表示し、確認欄は送信しない |
| `frontend/src/features/auth/hooks/usePasswordChange.ts` | `usePasswordChange`が`changePassword`を呼び、成功した`SessionInfo`でセッションQueryを更新する |
| `frontend/src/pages/PasswordChangePage.tsx` | 通常変更（S-04）。`safeReturnPath`でアプリ内の戻り先を選び、成功・キャンセル後に戻る。直接訪問や不正な戻り先はホームへ戻す |
| `frontend/src/features/auth/ReauthProvider.tsx`・`hooks/useReauth.ts`・`components/ReauthDialog.tsx` | `ReauthProvider`が`withReauth(title, operation)`を提供する。再認証済み5分以内なら操作を直ちに実行し、それ以外は一つのダイアログで再認証してから操作する。キャンセル・ルート移動・認証切れでは保留操作を破棄し、遅延応答から操作を実行しない |
| `shared/password-rules.ts` | パスワードの長さ定数、本人識別子の最小部分一致長、禁止一覧、構成判定`isPasswordCompositionAllowed`、禁止判定`isDeniedPassword`と`PasswordIdentity`を定義する。バックエンド・フロントエンドから参照される共通定義で、画面側の確認・エラーは各フォームに残す |
| `shared/reauth-policy.ts` | 再認証の有効期間`REAUTH_VALIDITY_MS`を定義する。`credentials.service.ts`と`ReauthProvider.tsx`が同じ境界を参照する |
| `frontend/src/features/auth/schemas/login-form.ts` | 入力チェック（空でないこと） |
| `frontend/src/features/auth/unauthenticated-handler.ts` | 401の共通処理。`code`が`UNAUTHENTICATED`のときだけ、セッションのキャッシュを捨てて`/login`へ移る（`INVALID_CREDENTIALS`では移らない）。`frontend/src/main.tsx`が`setUnauthenticatedHandler`で1回だけ登録する（そのためルーターを部品の外で作る） |
| `frontend/src/components/SecretField.tsx` | 秘密の入力欄（表示の切り替え）。setupと共通にするため`features/setup/components/`から移した。表示切替の名前・`autoComplete`はpropsで渡す |

## テーブル

詳細な列は`backend/db/schema.ts`と`docs/requirements/data-model.md`が正。

- `sessions`：`id`（トークンのSHA-256の16進。トークンは保存しない）・`user_id`・`created_at`・`last_active_at`・`reauthenticated_at`（再認証の有効期間判定に使う）・`revoked_at`。索引は（`user_id`, `created_at`）
- `login_attempts`：主キーは（`bucket_type`, `bucket_key`）。`bucket_type`は`'source'`（ログインの接続元）・`'account'`（社員ID）・`'setup_source'`（初回セットアップの接続元）のCHECK制約。`bucket_key`は`HMAC-SHA256(LOGIN_THROTTLE_KEY, 値)`の16進で、生のIP・社員IDは保存しない
  - 接続元（`source`・`setup_source`）が使う列：`attempt_count`（受付数。成功も数える）・`window_started_at`・`locked_until`
  - 社員ID（`account`）が使う列：`failed_count`・`last_failed_at`
  - 全行：`updated_at`（最後に更新した時刻。掃除が使う）。索引は`updated_at`

## ログインの流れ

`POST /api/auth/login`（`routes/auth.ts`→`login`）の順序。

1. 入力の形（社員ID 1〜64文字、パスワード 1〜1024文字）の検証で422。社員ID・パスワードの規則（文字種など）は確かめない（規則に合わない入力も、存在しない社員IDと同じ401にして、規則を推測させないため）
2. `LOGIN_THROTTLE_KEY`が未設定・不正なら503
3. 接続元のキーを求める（`sourceBucketKey`。下の「接続元の特定」）。特定できなければ503
4. **接続元の受付枠を確保する**（`admitSource`→`acquireSourceSlot`）。**ハッシュの計算・利用者の検索より前**に行う。取れなければ429と`Retry-After`
5. 社員IDのキーの状態を読み、失敗数に応じた待ち時間だけ待つ（`deps.sleep`）。ロックはしない
6. 利用者を探し、`verifyPasswordConstantCost`で検証する。存在しない・無効な利用者は保存値なし（`null`）で呼び、現行パラメータのダミーの計算を1回行う
7. 失敗：社員IDの失敗数の加算と監査`auth.login`（失敗。`detail`は`reason`のみ。`unknown_user`・`inactive_user`・`wrong_password`）を1つの`db.batch`で確定し、401`INVALID_CREDENTIALS`。存在しない・無効・誤りで応答は同一
8. 成功：`issueSession`が新しいトークンを毎回発行し（固定化対策）、`createSession`で確定する。応答は`{ user: { id, displayName }, mustChangePassword }`と、`__Host-session`のSet-Cookie
9. `needsRehash`なら、成功の後で`hashPassword`し直して`updatePasswordHashIfUnchanged`で置き換える。失敗はログに残し、ログインは成功のまま（C-148）

### 2段ログインと#122の拡張点

- `verifyFirstFactor`は、社員ID・パスワードを確認して`VerifiedUser`を返すだけで、セッションを作らない。`issueSession`は`VerifiedUser`からセッションを作る。**#122は、この2つの間に、全体管理者に対する第二要素の確認を挿入する**。`login`は2つを続けて呼ぶ入口である
- 第二要素を足しても、失敗の記録・受付枠・時間差対策は第一要素の側で済んでいるため、変更しない

### セッションの作成の競合対策

`createSession`は、**検証したときのパスワードのハッシュと有効状態が、確定の時にも一致する場合だけ**セッションを入れる（`INSERT INTO sessions ... SELECT ... FROM users WHERE id=? AND password_hash=? AND is_active=1`）。同じ`db.batch`に、監査（セッションが入ったときだけ）・社員IDの失敗数のリセット・古いセッションの失効（提示されたCookieのセッション）を入れる。挿入が0件（検証と確定の間にパスワードの変更・無効化があった）なら、401`INVALID_CREDENTIALS`にする。別の端末のセッションは残す（0-2 AC-6）。

## セッション

- Cookie：`__Host-session`。`HttpOnly`・`Secure`・`SameSite=Lax`・`Path=/`・Domainなし・`Max-Age=86400`。`__Host-`は、Domainの指定を禁じ、`Secure`・`Path=/`を必須にするため選んだ（決定D-4）
- 値：32バイトの乱数のbase64url（43文字）。DBには`hashSessionToken`のSHA-256だけを保存する
- 有効期限（`isSessionExpired`。読み取り時に判定）：失効済み（`revoked_at`）、最終操作から30分、ログインから24時間のどれかで切れる。ちょうど30分・24時間で切れる
- 最終操作の更新（`resolveSession`）：前回の更新から1分以上たったときだけ`touchSession`（`last_active_at`が読んだ値のままのときだけ更新）。失敗しても認証の結果は変えず、`warn`を出す。無操作30分の判定が最大1分ずれる（C-149）
- 無効化された利用者（`is_active`が偽）のセッションは使えない
- 使えないCookie（失効・期限切れ・偽物）が付いてきたときは、`loadSession`がCookieを削除する。ただし`POST /api/auth/logout`では、失効が確定した後にハンドラが消す（DBの失敗で500のときにCookieを消さないため）
- `GET /api/auth/session`とログイン成功応答は`SessionInfo`を返す。`user`にはID・表示名・社員IDを含み、`reauthenticatedAt`はログイン直後・未再認証では`null`、再認証済みならUTC ISO 8601時刻になる。未ログインのsession確認は401`UNAUTHENTICATED`。

### ログアウト

- `POST /api/auth/logout`：提示されたCookieのセッションだけを対象に、失効（`revoked_at`）と監査`auth.logout`を**同じ`db.batch`**で確定する。DBの失敗は500のまま伝え、Cookieは消さない。確定後にCookieを消して204
- Cookieなし・偽物・失効済みは、DBを変えずCookieを消して204（べき等）。許可リストに入れてあるため、期限切れでも呼べる

### 失効の関数と呼び出し元

`revokeAllForUserStatement`（その利用者の有効なセッションをすべて失効させる）と`revokeOthersForUserStatement`（現在のセッションを除く）は文を返す。後者は`credential.repository.ts`がパスワード変更の`db.batch`で実行する。前者は再発行（#127）・無効化のIssueで使う。失効の書き込みが失敗したら、成功扱いにせずエラーにする（ADR-0008）。

## 既定拒否とゲート

`backend/src/app.ts`の`createApp`は、`options.sessions`が渡されたとき、`/api/*`に次の順で適用する：セキュリティヘッダー（全体）→ `originCheck`（送信元の確認）→ `noStoreForProtected` → `loadSession` → `requireAuth` → `requirePasswordChanged`。入口の`backend/src/index.ts`は必ず`sessions`を渡す（渡さないアプリは、ルートの組み立てだけを確かめるテスト用）。

### 公開の許可リスト（6件）

`session-middleware.ts`の`PUBLIC_ENDPOINTS`。メソッドとパスの完全一致で、これ以外は未ログインなら401`UNAUTHENTICATED`（存在しないAPIも401にして、どのAPIがあるかを示さない）。

- `GET /api/health`
- `GET /api/setup/status`
- `POST /api/setup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`（ハンドラの中で未ログインを401にする）

新しい公開APIは、ここに足す（足す理由はレビューで確かめる）。許可リスト以外の応答は、成功・失敗とも`Cache-Control: no-store`にする。`/api/sample-users`は保護の対象で、未認証は401。

### 初回パスワードのゲート

`requirePasswordChanged`は、`mustChangePassword`が真の利用者に対してゲート許可リスト（`POST /api/auth/logout`・`GET /api/auth/session`・`PUT /api/me/password`）以外を403`PASSWORD_CHANGE_REQUIRED`（no-store）で拒否する。これは認証必須ゲートの許可であり、公開の`PUBLIC_ENDPOINTS`には追加しない。`POST /api/auth/reauthenticate`は初回変更が済むまで使えない。

## 本人のパスワード変更と再認証（Issue #123）

### APIと処理の流れ

- `PUT /api/me/password`（`meRoutes`→`changePassword`）は`currentPassword`（1〜1024文字）と`newPassword`を受け取り、フォームの確認欄は送らない。`isPasswordAllowed`と現在のパスワードとの一致を先に検証し、明らかな新パスワード規則違反は試行枠を消費しない。`checkPassword`はログインと共通の接続元受付枠・社員IDごとの遅延を適用して現在のパスワードを照合する。誤りは`currentPassword`の422、パスワード規則・禁止判定は共通文言と`newPassword`の422、CAS競合は409。
- パスワード確定は`createCredentialRepository().changePassword`が、現在のpassword hash・有効な利用者・有効な現在セッションを条件に新hashへ更新する。要求ごとに異なるsaltで生成した新hashの存在を成功条件として、他セッション失効・`auth.password_change`監査・社員ID失敗数リセットを同じD1 `batch`に入れる。条件を満たさない場合、後続文はすべて副作用なしとなり、Serviceは409を返す。batch内の監査等が失敗した場合も全体を成功扱いしない。
- 成功応答は更新後の`SessionInfo`を返す。現在のセッショントークンと`reauthenticatedAt`は維持し、他のセッションだけを失効させる。現在のトークン自体が盗まれていた場合は変更後も使われる弱点が残る（ADR-0008）。
- `POST /api/auth/reauthenticate`（`authRoutes`→`reauthenticate`）は`password`（1〜1024文字）を受け取り、同じ`checkPassword`を使って現在のセッションを再認証する。誤りは403`REAUTH_FAILED`。成功時はUTC ISO 8601の`reauthenticatedAt`を返す。ログイン・パスワード変更・再認証で接続元受付枠と社員ID失敗遅延を共有する。
- 再認証の`createCredentialRepository().reauthenticate`は、現在セッションと照合済みpassword hashが有効で、現在の`reauthenticatedAt`が今回の時刻と異なる場合だけ、監査・失敗数リセット・セッション時刻更新を同じbatchの条件に含める。更新件数が1件でなければServiceは409を返す。同時刻に走る要求では先行batchが時刻を記録し、後続batchの条件を不成立にするため、敗者は成功監査や失敗数リセットなどの副作用を残さない。

### 後続業務での再認証

`assertRecentReauth`は有効なUTC ISO 8601時刻が現在より未来でなく、経過時間が5分未満であることを確かめ、失敗時は403`REAUTH_REQUIRED`を返す。各業務Issueでは`useReauth`の`withReauth(title, operation)`で画面側の確認を行い、業務API側でも`assertRecentReauth`を呼び出す。判定が通った場合の業務更新と業務操作監査は同じDB batchで確定する。現在、実業務APIは未実装であり、`backend/src/reauth-business.test.ts`のテスト専用操作がこの接続を検証する。再認証から業務確定までの間に5分境界を越える競合は承認済みの許容範囲（ADR-0008）。

## 試行制限

値は利用者の決定（D-1・D-2。C-159）。実装は`throttle-policy.ts`の定数1か所。

### 接続元単位（ログインは`source`、初回セットアップは`setup_source`）

- 窓15分・**受付30回まで**（成功も数える。成功しても戻さない。他人のIDを試し続ける攻撃を1回の成功で帳消しにされないため。ADR-0008）。31回目でロックに入り、15分間は429と`Retry-After`（解除までの秒数、切り上げ）。手動解除はない
- **受付枠は、ハッシュの計算より前に、UPSERT 1文（`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`）で原子的に確保する**（`acquireSourceSlot`）。受付数を増やす更新と上限の判定が1文のため、並行しても数え落とさず、上限を超えた分は計算に入らない。ロック中も受付数を増やす（ロックに入った受付＝上限+1回目だけを、並行しても1件に特定するため）。窓が過ぎるか、ロックが過ぎると数え直す
- 判定の状態は、`locked_until`が未来（ロック中）／ロックが過ぎた・窓が過ぎた（数え直し）／窓の中、の3つ
- 接続元の特定は`CF-Connecting-IP`だけ（下の「接続元の特定」）

### 社員ID単位

- **ロックしない**（第三者が他人を締め出せないようにするため）。これまでに記録した失敗数に応じて、検証の前に待つ：3回まで0秒・4回1秒・5回2秒・6回以上4秒（要求全体をクライアントの10秒のタイムアウトに収めるため、4秒で頭打ち）。最後の失敗から15分で数え直す。成功すると、その社員IDの行を消す（0に戻す）
- 待ち時間のあいだはCPU時間を使わない（`setTimeout`の待ち）
- 失敗数の加算は`recordLoginFailure`のUPSERT 1文。最後の失敗から15分たっていれば1から数え直す

### 接続元の特定

- `CF-Connecting-IP`だけを使う。`X-Forwarded-For`は利用者が偽れるため使わない
- `normalizeSourceIp`：IPv4はそのまま（先頭が0の数字は不正）。IPv6は展開・小文字化して`/64`（先頭4組）に丸める。IPv4を埋め込んだIPv6（`::ffff:a.b.c.d`）はIPv4として扱う。不正な値は`null`
- キー：`HMAC-SHA256(LOGIN_THROTTLE_KEY, 正規化した値)`の16進（`hmacKey`）。社員IDは小文字にしてからHMAC（`accountBucketKey`。`users.login_id_normalized`と同じ）。生のIP・社員IDはDBにもログにも残さない
- **ヘッダーがない・不正なとき**（`sourceBucketKey`）：本番は503と`logger.error`（接続元ごとの制限を回避させないため。ヘッダーの値・鍵は出さない）。開発・テストは固定の値`local`で数える（決定D-5）
- `LOGIN_THROTTLE_KEY`が未設定・不正なら、ログインと初回セットアップのPOSTは503（アプリ全体は止めない）。鍵を変えると、既存の試行の記録は参照できなくなり、数え直しになる

### 初回セットアップ（`/api/setup`）への適用

`backend/src/routes/setup.ts`の`POST /`が、**トークンの確認より前**に`setup_source`の受付枠を確保する（`admitSource`を使う）。処理の順序は、本文の形→鍵の503→接続元の特定（503）→受付枠（429）→設定の不備503・トークン403→入力の検証422→完了済み409。`setupRoutes`の第2引数（`withThrottle`）が渡されないときは、制限なしで動かさず503にする。`GET /api/setup/status`には制限をかけない。トークンの誤りは従来どおり`logger.audit`にだけ記録する。

### 監査と量の抑え方

- D1の`audit_logs`に残すのは、**ロックに入った1回だけ**（`auth.rate_limited`・`setup.rate_limited`。`detail`は解除の時刻のみ）。ロック中の429は`logger`だけに残す（存在しない社員IDや接続元の連打で`audit_logs`が増えないようにするため）
- ログインの失敗は`auth.login`（失敗）、成功は`auth.login`（成功）、ログアウトは`auth.logout`を、D1に残す。`actor_id`は失敗では`null`。社員ID文字列・パスワード・トークン・IPは`detail`に入れない
- 同時実行：受付枠は原子的に数えるため、30回の上限は守られる。社員IDの遅延の判定（読み取り）と失敗の記録は別の文のため、並行した失敗が同じ段階の待ち時間で入ることがある（許容）

## 時間差対策と既知の限界

- **存在する・しない、有効・無効、パスワードの正誤で、処理時間に差を作らない**。`verifyPasswordConstantCost`は、利用者なし・無効・形式不正・上限を超えるパラメータの場合に、**現行パラメータ（N=2^16, r=8, p=2）のダミーで必ず1回**計算し、`false`を返す。現行のハッシュは本物の検証を1回行う。応答の本文・ステータスも同一（ヘッダー比較は可変の項目を除く）
- **既知の限界**：パラメータを将来変えた**移行期間には、旧パラメータのハッシュを持つアカウントの存在が、時間差で推測されうる**。旧ハッシュは旧パラメータで検証し（現行より軽い）、追加の計算で現行の重さに揃えることはしない（合計が揃わないため）。現時点で保存されるハッシュはすべて現行なので、今は生じない。緩和策は、接続元の受付枠・社員IDの待ち時間・ログイン成功時の再ハッシュで移行期間を短くする運用（ADR-0007・0008）
- テストは、計算の内容（パラメータ）を記録して、現行のハッシュ・存在しない社員ID・形式不正が同一のパラメータで1回になることを確かめる。時間の実測は品質チェックの工程で行う

## ログ

`backend/src/lib/logger/logger.ts`の`redact`は、DBのエラー（Drizzleの`DrizzleQueryError`など。`message`が`Failed query:`で始まる、または`query`と`params`を持つもの）を、**固定の文言**（SQL・パラメータは出力しない）に置き換える。ログインの失敗時のSQLに社員ID・パスワードのパラメータが含まれて漏れないようにするため。原因の調査は、エラーの種類と`traceId`で行う。

## 掃除（Cron）

- `authCleanupJob`（名前`auth-cleanup`）。**毎日UTC 18:17（日本時間03:17）**。`wrangler.jsonc`の`triggers.crons`と同じ式（`17 18 * * *`）。`backend/src/index.ts`が`createScheduledHandler`に登録する。本番への適用は、利用者がデプロイして行う
- `cleanupExpired`が、**500件ずつ**、0件になるか1種類あたり100回の上限（5万件）まで繰り返す（べき等）。上限に達したら`warn`を出し、残りは次の実行で消す。DBの失敗は受け止めずに伝える
- 保持：`sessions`は、失効済み・ログインから24時間・最終操作から30分を過ぎたものを、次の掃除で消す。`login_attempts`は、`locked_until`がnullか過去で、`updated_at`が1日より前の行を消す（成功のみで作られた受付行も消える。ロック中の行は消えない）。決定D-3
- ログ：開始と終了を`info`で出す。終了の項目名は`deletedLoginRows`（セッション）・`deletedAttemptRows`（試行制限）。`session`などの語を含む項目名はロガーの伏せ字に当たるため避けた。実行履歴の表は作らない

## 画面とE2E

- S-02：ユーザーIDとパスワードの入力、パスワードの表示切り替え（`SecretField`）、送信中は押せない。失敗の文言：401は「ユーザーIDまたはパスワードが違います」（どちらが違うかを示さない）、429は「しばらくしてからお試しください」（制限の種類・残り時間を示さない）、422は「入力内容を確かめてください」、通信エラーは「接続できませんでした。もう一度お試しください」
- ログアウトで`queryClient.clear()`を行い、`/login`へ移る（0-2 AC-8の前半）。**端末の下書きの消去は、下書きの機能（1-1）が未実装のため、1-1へ申し送る**（無操作・期限切れの自動ログアウトでは消さない。C-82）
- ログイン・ログアウトの遷移は履歴を置き換え、戻る操作でも保護された画面を見られない
- E2E（`e2e/login.spec.ts`）：ログイン→ようこそ→ログアウト→戻る・進む・直接アクセスで`/login`／誤ったパスワード／初回パスワードでS-03が表示され、変更完了まで他画面へ進めないこと／`http://localhost`でも`__Host-session`のCookieが保存され（`HttpOnly`・`Secure`・`SameSite=Lax`・`Path=/`）、次の要求で送られること。未ログインのセッション確認の401は仕様どおりのため、`e2e/session-console.ts`の`allowSessionCheck401`で許す。シードは`e2e/seeds/login.sql`（架空の`e2euser_login_001`・`002`）、後始末は`e2e/seeds/login-cleanup.sql`
- E2E（`e2e/password-change.spec.ts`）：初回変更と通常変更、規則エラー、現在画面への復帰。架空の専用seedとcleanupは`e2e/seeds/password-change.sql`・`password-change-cleanup.sql`

## 既存のテストの移行

`/api/sample-users`を保護したため、次を「認証済みで成功・未認証は401」に移した：`backend/src/routes/sample-users.test.ts`、`e2e/sample-users.spec.ts`（ログインの手順を足した）、`frontend/src/pages/HomePage.test.tsx`。`SecretField.test.tsx`はファイルの移動に伴うimportの場所の変更。

## テストの場所

| 対象 | ファイル |
| --- | --- |
| パスワードの検証・時間差・境界 | `backend/src/lib/password.test.ts`・`password-verify.test.ts`・`password-boundary.test.ts`、workerdでのscrypt：`scrypt-runtime.test.ts` |
| Issue #123の規則・本人変更Service/Repository | `backend/src/lib/password-policy.test.ts`・`password-boundary.test.ts`、`backend/src/services/credentials.service.test.ts`、`backend/src/db/credential.repository.db.test.ts` |
| 本人変更・再認証route/API契約 | `backend/src/routes/me.test.ts`・`backend/src/routes/auth.test.ts`・`backend/src/openapi.test.ts` |
| 再認証と業務処理の接続 | `backend/src/reauth-business.test.ts`（テスト専用業務更新と監査。同Issueでは実業務APIを追加しない） |
| セッションのトークン・期限 | `backend/src/lib/session-token.test.ts`、期限の境界・1分の間引きは`backend/src/routes/auth.test.ts`、`backend/src/db/session.repository.db.test.ts`・`session.repository.read.db.test.ts` |
| 試行制限の値・接続元のキー | `backend/src/lib/throttle-policy.test.ts`、`source-key.test.ts`・`source-key-boundary.test.ts`、`backend/src/config.throttle.test.ts` |
| ログインのService・Repository | `backend/src/services/auth.service.test.ts`・`auth.service.mutation.test.ts`、`backend/src/db/auth.repository.db.test.ts` |
| ルート・既定拒否・ゲート | `backend/src/routes/auth.test.ts`・`auth.review.test.ts`・`auth.logout-failure.test.ts`・`access-control.test.ts`・`setup-throttle.test.ts` |
| エラー応答（`Retry-After`など） | `backend/src/lib/error-handler.auth.test.ts` |
| 掃除 | `backend/src/auth-cleanup.test.ts` |
| API仕様との一致 | `backend/src/openapi.test.ts` |
| 画面 | `frontend/src/pages/LoginPage.test.tsx`・`HomePage.test.tsx`、`frontend/src/features/auth/`配下の`*.test.ts(x)`、`frontend/src/components/SecretField.test.tsx` |
| Issue #123の画面・再認証 | `frontend/src/pages/PasswordChangePage.test.tsx`、`frontend/src/features/auth/schemas/password-change-form.test.ts`・`hooks/useReauth.test.tsx`・`components/`配下の関連テスト |
| E2E | `e2e/login.spec.ts`、`e2e/sample-users.spec.ts`（架空データ`e2euser_`・`@example.com`） |
| テスト用の部品 | `backend/test/auth-fixtures.ts`、`frontend/src/test/auth-handlers.ts` |
| 変異テスト | `stryker.config.json`の対象に、`password.ts`・`session-middleware.ts`・`source-key.ts`・`throttle-policy.ts`・`session-token.ts`・`auth.repository.ts`・`session.repository.ts`を足した |

## 申し送り

- **#122（TOTP）**：`verifyFirstFactor`と`issueSession`の間に第二要素を挿入する。#122までは全体管理者もパスワードだけでログインできるため、本番に出さない
- **#127（再発行）・無効化のIssue**：`revokeAllForUserStatement`を同じ`db.batch`に入れる（0-3 AC-8、0-1 AC-9）
- **1-1（下書き）**：手動ログアウトで、端末の下書きをすべて消す（0-2 AC-8）。今は`queryClient.clear()`のみ
- **#121（共通レイアウト）**：実装済み。`HomePage`の最小の枠は`AppShell`に置き換わった（[app-shell.md](app-shell.md)）
- **運用**：本番の`LOGIN_THROTTLE_KEY`は利用者が`wrangler secret put`で入れる（`docs/secrets.md`）。Cron Triggersは利用者のデプロイ後に有効になる。`wrangler.jsonc`には`limits.cpu_ms`の設定がまだない。scryptの計算（1回約270〜530ミリ秒）がCPU時間の既定に収まるか、Workers Paidでの`cpu_ms`の扱いは、本番のデプロイ前に利用者が確認する（ADR-0007、spike-d1-hash.mdの6章）

## 関係するIssueとADR

- Issue：#120（親 #108）、#123（本人パスワード変更・再認証）、依存 #119。後続：#121・#122・#127・無効化のIssue・各業務Issue
- ADR：[0003](../adr/0003-auth-cookie-session.md)（Cookieのセッション）、[0007](../adr/0007-password-hash-scrypt.md)（scrypt）、[0008](../adr/0008-session-and-login-throttle.md)（セッションと試行制限・token維持と5分境界競合）、[0009](../adr/0009-admin-mfa-totp.md)（TOTP）、[0012](../adr/0012-zero-trust-principle.md)（ゼロトラスト）、[0013](../adr/0013-initial-setup-auth-and-pii-encryption.md)（初回セットアップ）、[0017](../adr/0017-password-composition-policy.md)（password構成規則）
- 決定記録：C-148〜C-150、C-158、C-159〜C-161（`docs/requirements/decision-register.md`）
- 秘密情報の設定：`docs/secrets.md`の`LOGIN_THROTTLE_KEY`
- 関連する設計書：[roles-and-setup.md](roles-and-setup.md)（`/api/setup`、`password.ts`の元の部分）
