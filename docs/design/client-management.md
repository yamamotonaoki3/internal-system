# 取引先マスタ（Issue #192）

## 目的

案件で参照する取引先を管理し、全社員向けの参照一覧と有効な申請候補を提供する。管理操作は全体管理者に限る。コード変更と案件・採番履歴への結合は親Issue #145 に残し、このIssueではコード編集API/UIや案件・履歴テーブルを追加しない。

## ファイルと役割

Issue #192のバックエンドと管理画面を実装済み。2026-11-08の最終QAは合格し、PR統合待ちである。下記の先行テストは途中時点の履歴として最終結果と区別し、親#145・#189の完了とは扱わない。

| ファイル | 役割 |
| --- | --- |
| `backend/db/schema.ts`、`backend/db/migrations/0005_add_clients.sql` | 取引先テーブルとコード・正規化名の一意制約、コード・IDの一覧索引を定義 |
| `backend/db/schema.ts`、`backend/db/migrations/0007_add_client_api_rate_limits.sql` | 取引先APIのレート制限状態を利用者・read/write区分ごとに保存。利用者削除時は関連行も削除 |
| `shared/client-rules.ts` | コード・名前・検索語の入力schemaと名前比較キーを定義 |
| `backend/src/routes/clients.ts` | `adminClientRoutes`と`clientRoutes`で管理・社員向けHTTP契約を受け付け、入力検証と応答を行う |
| `backend/src/services/client.service.ts` | `createClientService`が管理認可、登録・改名・無効化規則、競合エラーを扱う。`withClientService`がserviceを構成し、`consumeClientApiRateLimit`がレートRepositoryの受付操作を呼ぶ |
| `backend/src/db/client.repository.ts` | `createClientRepository`が永続化・コード順cursor一覧・更新と監査記録のbatchを扱う。`withClients`がRepositoryと権限Repositoryを組み立てる |
| `backend/src/db/client-rate-limit.repository.ts` | `createClientRateLimitRepository().consume`が利用者・区分ごとの固定UTC 1分窓を原子的に更新し、保存済み窓と回数を返す。`withClientRateLimit`がRepositoryを構成 |
| `backend/src/services/authorizer.ts` | `canManageClients`が利用者の取引先管理権限を照会する |
| `backend/src/lib/audit-actions.ts` | `client.create`・`client.rename`・`client.deactivate`の監査操作名を定義 |
| `backend/src/index.ts` | `/api/admin/clients`と`/api/clients`へ各routeを登録 |
| `docs/api/openapi.json`、`backend/src/openapi.test.ts` | 取引先6操作のAPI仕様と実routeとの契約確認 |
| `frontend/src/features/clients/` | API呼び出し、一覧・登録・名前変更・無効化の画面部品 |
| `frontend/src/pages/ClientsPage.tsx` | S-36の画面構成 |
| `frontend/src/features/app-shell/navigation.ts`、`frontend/src/App.tsx` | 管理メニューと画面ルート |
| `frontend/src/features/auth/api/auth-api.ts`、`backend/src/routes/auth.ts`、`backend/src/services/authorizer.ts` | セッション取得に `canManageClients` が判定した管理権限を含め、画面の管理ルートガードに渡す |

## 処理の流れ

- 管理APIは既存セッションと `perm.client.manage` をサーバー側で確認する。画面上のメニュー制御は認可の代替にしない。
- 登録時に安定IDを割り当て、コード・名前・状態・管理用versionを保存する。コードは英大文字3文字、名前は前後空白を除いて1〜50文字。名前の比較は大文字小文字を区別しない。
- 名前変更と無効化は管理用versionを条件に更新する。古いversionや重複名などの競合は409とし、失敗時に取引先・version・監査ログを更新しない。業務更新と監査ログは同じbatchで確定する。
- 一覧はコード順のカーソルページングを用い、検索語は名前・コードに対する大文字小文字を区別しない部分一致とする。未指定・空・trim後空は検索なし、trim後1〜100文字を許可し、101文字以上は422とする。`client.repository.ts` はパラメーター化した `instr` 検索を使い、`%`・`_`を通常文字として扱う。これによりD1の`LIKE`パターン長の制約を避ける。
- 全社員向け一覧は有効・無効双方を返し、申請候補一覧は有効な取引先だけを返す。どちらも安定IDを参照キーとして公開し、案件や採番の実装は行わない。
- 予約コード `INT` の無効化は拒否する。初期データは、承認された[ADR-0018](../adr/0018-client-initial-seed-migration-exception.md)に従い専用migration `0006_seed_internal_client.sql` で登録する。通常生成した `0005_add_clients.sql` はテーブル作成を担当し、手作成migrationでは固定ULID・`INT`・「社内」・有効状態・version 1の初期行を投入する。名前変更は許す。無効化後の再有効化経路は設けない。
- 管理一覧の状態は `all`・`active`・`inactive`。省略時は `all`、不正値は422 `VALIDATION_ERROR`。
- version競合と `INT` の無効化は409 `CONFLICT`。失敗時は取引先と監査ログを変更しない。
- 取引先APIの利用者単位レート上限は読み取り3操作合算120回/分、登録・改名・無効化3操作合算30回/分。固定UTC 1分窓で数え、超過時は429と次の窓までの `Retry-After` 秒数を返す。窓の保存は単調に進め、遅れて到着した古い窓の要求で制限をリセットしない。DB障害時は503で拒否し、取引先の変更を続行しない。具体方式と閾値はX-8・`backend/src/db/client-rate-limit.repository.ts`・`backend/src/routes/clients.ts`に実装済み。
- 取引先routeのrate middlewareは、global authentication後かつ各routeの入力validation・業務認可前に動く。ログイン済みの403/422要求も枠を消費し、401要求は計数しない。read/write bucketは独立し、利用者あたり最大2行を保持する。429拒否は利用者・trace ID・bucketを含む`logger.audit`へ記録する。記録DB障害はbucket付き`logger.error`へ記録し、DBエラーのSQL・パラメーターは共通Loggerが伏せる。

## API契約

管理DTOは `{id, code, name, active, version}`。作成時の `active` は `true`、`version` は `1`。更新APIは更新後の管理DTOを単体で返す。

| 操作 | 契約 |
| --- | --- |
| 管理一覧 | `GET /api/admin/clients`。`items`（管理DTO配列）と `nextCursor`（文字列またはnull）を返す。`status`は`all`・`active`・`inactive`（省略時`all`）、不正値は422 |
| 登録 | `POST /api/admin/clients`。成功時201と管理DTOを返す |
| 名前変更 | `PATCH /api/admin/clients/{id}`。本文は `{name, version}`。余剰項目（`code`を含む）は422 `VALIDATION_ERROR` とし、データは不変 |
| 無効化 | `PATCH /api/admin/clients/{id}/status`。本文は `{active: false, version}`。有効化要求や余剰項目は受け付けず、version競合・INTは409 `CONFLICT` |
| 社員向け一覧 | `GET /api/clients`。`items`（`{id, code, name, active}`配列）と `nextCursor` を返し、有効・無効の両方を含む |
| 申請候補 | `GET /api/clients/candidates`。`items`（`{id, code, name}`配列）と `nextCursor` を返し、有効な取引先だけを含む |

ページングの上限は共通 `PAGE_LIMIT` とし、OFFSETは使わない。管理一覧の検索・状態絞り込みは要件5-7 AC-11に従う。共通エラー形式は既存API仕様に従う。取引先APIはX-8のread合算120回/分・write合算30回/分で制限し、rate middlewareのDB障害は503でfail closedにする。

## 主な入出力

| 処理 | 入力 | 出力 |
| --- | --- | --- |
| `createClientService().listAdmin` | 管理者、検索・状態・cursor・limit | Repositoryの管理DTOページ |
| `createClientService().create` | 管理者、code、name | 作成された管理DTO。Repositoryは登録と監査記録をbatchで確定 |
| `createClientService().rename` | 管理者、安定ID、name、version | 更新後管理DTO。競合・無効行・重複名はエラー |
| `createClientService().deactivate` | 管理者、安定ID、`active:false`、version | 更新後管理DTO。競合・INT・既無効行はエラー |
| `createClientService().listPublic` / `.listCandidates` | 検索・cursor・limit | 社員向けページ／有効候補ページ |
| `createClientRepository().listAdmin` / `.listPublic` / `.listCandidates` | `ClientListOptions` | コード・ID順でカーソル化された各DTOページ。検索はパラメーター化 `instr` を使う |
| `createClientRateLimitRepository().consume` | userId、`read`/`write`、現在時刻、区分の上限 | 原子的に記録した窓開始時刻と受付回数。窓が競合・逆順到着した場合も保存窓を戻さない |
| `withClientService(env, run)` | Workers環境、serviceを受け取る処理 | `createClientService`を構成してcallbackの結果を返す |
| `consumeClientApiRateLimit(env, input)` | Workers環境、利用者・bucket・現在時刻・上限 | 固定窓へ原子的に加算した結果。次窓までのRetry-After計算に必要な保存済み窓を含む |
| `canManageClients(env, userId, traceId)` | Workers環境、利用者ID、trace ID | `perm.client.manage`の会社scope判定 |

`clientRateLimit(bucket)` は `backend/src/routes/clients.ts` のroute middleware。次の固定窓までの残秒はRepositoryが返す実際の保存窓から算出し、429 `AppError` の `retryAfterSeconds` として渡す。レート状態の保存に失敗したときは `consumeClientApiRateLimit` から伝わるエラーを、routeが安全なERRORログに記録して503 `SERVICE_UNAVAILABLE` を返す。routes層からDB Repositoryを直接importせず、`withClientService`・`consumeClientApiRateLimit`・`canManageClients`のDB境界はservices層に置く。

フロントエンドでは `client-api.ts` の `fetchAdminClients`・`createClient`・`renameClient`・`deactivateClient`・`fetchClientCandidates` がAPIを呼び、`query-keys.ts` の `clientKeys` がキャッシュキーを定義する。`ClientsManager` が一覧の検索・状態・ページ送り、登録・改名・無効化を組み立て、`ClientForm` が入力を扱う。更新成功後は取引先関連queryをinvalidateする。`ClientsPage` は `ClientsManager` を配置する。登録・改名で409が返った場合はサーバーの安全な案内を表示し、フォームを閉じず入力値を保つ。

`App.tsx` の `ClientManageRoute` はセッション取得中に待機表示を出し、権限がない場合は `NotFoundPage` を表示する。`auth-api.ts` の `SessionInfo` は `GET /api/auth/session` 専用の読み取り専用 `permissions` を持ち、ログインAPIの応答形は従来どおりに保つ。パスワード変更後の `usePasswordChange` は同じ利用者のsession cacheに現在の権限を保ってからGET sessionを再取得し、再検証の結果を反映する。再取得中に別利用者へ切り替わった場合は、前利用者の応答で新利用者のsession cacheを上書きしない。`navigation.ts` の管理メニュー項目は `perm.client.manage` を要求し、`SidebarNav` が権限に応じて表示する。画面側のチェックはサーバー認可の代替ではない。

## テストの場所

関連テストは `backend/src/routes/clients.test.ts`・`clients.behavior.test.ts`・`clients.security.test.ts`・`clients.rate-limit.test.ts`、`backend/src/db/client.repository.db.test.ts`・`client-rate-limit.repository.db.test.ts`・`client.audit-atomicity.test.ts`、`backend/src/services/client.service.test.ts`、`backend/src/lib/client-rules.test.ts`、`backend/src/openapi.test.ts`、`frontend/src/features/clients/client-api.test.ts`、`frontend/src/pages/ClientsPage.test.tsx`、`frontend/src/clients-route.test.tsx`、`frontend/src/features/app-shell/navigation.test.ts`・`SidebarNav.session.test.tsx`、`frontend/src/features/auth/hooks/usePasswordChange.test.tsx`、`e2e/clients.spec.ts`。E2Eは専用の架空role/user/client fixtureと自己cleanupを用い、setup前提を保持する。Playwright workerは1に固定する。INT初期行の確認を含む先行5テストファイル33件はテスト専用D1でGreen。レート制限の検証には別途 `clients.rate-limit.test.ts` と `client-rate-limit.repository.db.test.ts` を追加した。テスト専用DB以外へは適用していない。

先行Green結果は当時の画面11件、候補navigation 16件、Sidebar 1件、URL guard 3件。重複登録409の安全な案内と入力保持も確認した。これらは途中時点の個別結果であり、最終合否には追加検証後の全体結果を使う。

品質計測の途中では、658変異中433検出・153生存・72 NoCoverage、65.81%で基準80%に達しなかった。Stryker 10.0.0の0件テスト時の誤分類と、明示`testFiles`が静的変異の起動を遅らせる制限を切り分け、公式修正版10.1.1へ更新した。同じテスト集合をVitest `include`・`related=false`で選び、製品・対象・閾値を変えず、公開動作を確認するテストを追加した。

最終QAは全体チェック106ファイル1179件、開発形式E2E55件、ローカル本番形式CSP E2E9件が成功した。重要15source・658変異の公式スコアは81.53%（Killed 534 / 有効分母655）で、Survived 108・NoCoverage 13・RuntimeError 3・Timeout 0。RuntimeError 3件は変異によるHonoのroute初期化失敗2件とZod schema初期化失敗1件で、公式分類のまま保持し、手動のKilled補正や対象除外は行っていない。元658変異の署名を保持した。追加8ケース後も製品・依存・設定のハッシュが不変であるため、直前のbuild・E2E・画面確認結果を再利用した。独立最終コードレビューは重大0・軽微0。検証用の起動物を終了し、使い捨て設定は既存値を読まず再生成済みである。親#145の実結合と#189の利用者との最終動作確認は、この子のQA合格とは別に行う。

## 関係するIssue・ADR

- Issue #192：取引先マスタ先行実装
- Issue #145：コード編集条件と案件・採番履歴への最終結合確認。#146・#147・#150完了後に全13ACを確認する
- Issue #189：全体確認と完了判断
- ADR-0006：安定IDとカーソルページング
- ADR-0012：サーバー側で毎回認可する
- ADR-0018：`INT` 初期登録専用migrationの手作成例外
- 要件X-8：取引先APIの利用者単位レート上限
