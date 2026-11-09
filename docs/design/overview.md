# 設計書：全体の構成

実装したコードが、どのファイルが何を担当し、どうつながっているかを、1か所で見渡すための文書。実装したPRの中で更新する。

- コードは書き写さない。ファイル名・関数名で指し示す
- 機能ごとの設計書は、このフォルダに`<機能の名前>.md`として置き、下の「機能ごとの設計書」に足す。**機能ごとの設計書は、各機能のIssueで書く**（このIssue #105では書かない）
- 書き方（目的・ファイルと役割・処理の流れ・主な関数の入力と出力・テストの場所・関係するIssueとADR）は、`doc-writer`の「設計書の書き方」に従う
- 2026-11-02に、Issue #105（全体に関わる設計の方針）で、全体の構成と方針の要点を書いた。2026-11-03に、Issue #118で共通部品を実装した（下の「共通部品（Issue #118）」）。2026-11-03に、Issue #119でロール・権限・初回セットアップを実装した（[roles-and-setup.md](roles-and-setup.md)）。2026-11-03に、Issue #120でログイン・セッション・試行制限を実装した（[auth-session.md](auth-session.md)）。2026-11-04に、Issue #171でデザインの土台を実装した（[style-foundation.md](style-foundation.md)）。2026-11-05に、Issue #121で共通レイアウトの骨格を実装した（[app-shell.md](app-shell.md)）。2026-11-08に、Issue #192で取引先管理APIとS-36画面を実装した（[client-management.md](client-management.md)）。ただし、全体QAは未完了。2026-11-09に、Issue #199でアカウントの個別発行とアカウント一覧を実装した（[accounts.md](accounts.md)）。それ以外の内容は**方針**であり、実装したときに、実際のファイル・関数に合わせて直す

## 全体の構成

```text
ブラウザ（React。スマートフォンもブラウザ）
   │  同じドメイン（画面もAPIも1つのWorkersから配信）
   ▼
Cloudflare Workers（Hono）
   ├─ D1        … 利用者・セッション・メッセージ・案件・監査ログなどの正本（ADR-0005）
   ├─ R2        … 添付ファイル（Workers経由でアップロード・配信。C-126）
   ├─ Cron Triggers … 期限切れのセッション・ログイン試行の記録の掃除（ADR-0008）
   └─ Durable Objects（WebSocket）… 後で足す。最初はポーリング（ADR-0004）
```

- バックエンドは Cloudflare Workers 上の Hono、DBは D1（Drizzle ORM）、添付は R2、フロントエンドは React（Vite＋React Router）。技術とバージョンは`docs/tech-stack.md`
- 画面とAPIは1つのWorkersにまとめ、同じドメインから配信する（ADR-0003）。認証はクッキー方式のセッション
- バックエンドは Controller（`backend/src/routes/`）→ Service（`backend/src/services/`）→ Repository（`backend/src/db/`）の層に分ける（Skill「バックエンド」の層構成の規則）
- `shared/`はバックエンドとフロントエンドで共有する環境非依存の定義を置く葉の層で、`backend/`・`frontend/`へ依存しない。両アプリケーションから`shared/`を参照し、入力の最終検証・認可は常にサーバー側で行う。共有定義へ移した規則も、テストでは独立した期待値を保つ（詳細は[auth-session.md](auth-session.md)）。

## 全体に関わる設計の方針（要点）

各方針の理由・選択肢・影響は、ADRに書く。ここは要点と入口だけを書く。

| 項目 | 方針 | ADR |
| --- | --- | --- |
| リアルタイム更新 | 最初は2秒間隔のポーリング（Workers Paid前提）。あとでWebSocket（Durable Objects＋Hibernation）に置き換える（別のIssue）。「最後のID以降を取るAPI」を共通の土台にする | [0004](../adr/0004-realtime-polling-then-websocket.md) |
| DB | D1のみ（本番・ローカル・テストとも）。PostgreSQLへの一本化は採らない | [0005](../adr/0005-database-d1-only.md) |
| ID・ページ送り・未読 | 時刻順のULID相当のテキストID（自前生成）。一覧はすべてカーソル方式。未読は既読位置から上限つきで数え直す | [0006](../adr/0006-id-cursor-unread.md) |
| パスワードのハッシュ | `node:crypto`のscrypt（N=2^16, r=8, p=2）。PHC形式の自己記述の文字列。ログイン成功時に再ハッシュ。本番確認により確定（2026-11-03）。`maxmem`の指定が必須 | [0007](../adr/0007-password-hash-scrypt.md) |
| セッション・試行制限 | セッションはD1の`sessions`。ログインの試行制限は接続元単位（D1の`login_attempts`）。社員ID単位はロックせず待ち時間を増やす。**Issue #120で実装した**（受付枠はハッシュ計算の前にUPSERT 1文で確保。Cookieは`__Host-session`。`/api/*`は公開の許可リスト6件以外を既定で拒否。詳細は[auth-session.md](auth-session.md)） | [0003](../adr/0003-auth-cookie-session.md)・[0008](../adr/0008-session-and-login-throttle.md) |
| 管理者のMFA | 全体管理者だけTOTP（RFC 6238。WebCryptoで自作）を必須にする。細部は未決定 | [0009](../adr/0009-admin-mfa-totp.md) |
| 日本語の全文検索 | D1のFTS5 trigram（3文字以上は`MATCH`、1〜2文字は`LIKE`）。性能は実装時に実測 | [0010](../adr/0010-japanese-search-fts5-trigram.md) |
| 添付の検査 | Office新形式はzip構造を自前で確認。ウイルススキャンは別のIssueで調べてから決める | [0011](../adr/0011-attachment-inspection-and-virus-scan.md) |
| 初回セットアップの認証・本名の暗号化 | 初代全体管理者の登録は環境のシークレット`SETUP_TOKEN`で認証し（完了後は常に409、運用者がシークレットを削除）、本名は`PII_ENCRYPTION_KEY`でAES-256-GCMにより暗号化して保存する。`/api/setup`の試行制限は#120で適用した（接続元単位。[auth-session.md](auth-session.md)）。鍵の紛失・ローテーションは未決定 | [0013](../adr/0013-initial-setup-auth-and-pii-encryption.md) |
| セキュリティの原則 | ゼロトラスト（毎回、サーバー側で本人と権限を確認する）。既存の決定との対応表と、未決定の点を載せる | [0012](../adr/0012-zero-trust-principle.md) |

## DBの設計の型

D1の制約（対話型トランザクションがない、1文の束縛値は100個まで、FTS5を含むDBはエクスポートできない）への対処の型。ローカルのD1（`wrangler dev --local`）での確認結果は、[調査メモ spike-d1-hash.md](../research/spike-d1-hash.md)の4-2（5）に書いてある。**本番のD1での確認は未了**。

| 困る点 | 対処の型 |
| --- | --- |
| 複数の文を1つの塊にしたい | `db.batch([...])`を使う。途中で失敗すれば全体が取り消される。`db.transaction()`は使わない（Skill「データアクセス（Drizzle）」） |
| 「読む→判断→書く」 | 条件つきの1文（`UPDATE ... WHERE status = ...`の更新件数を見る、`INSERT ... SELECT ... WHERE NOT EXISTS`）にする。更新件数0は衝突として扱い、`409`を返す。楽観的ロック（`version`列）と組み合わせる |
| `batch`の中で、前の文の結果を使えない | IDをアプリ側で先に生成する（ADR-0006）。案件＋専用チャンネル＋参加者の同時作成、アカウント登録などで使う |
| 1文の束縛値が100個まで | 複数行を入れるときは、JSONを**1つの束縛値**で渡し、`json_each`で展開して1文で入れる。または`batch`に1行ずつの文を並べる（上限は文ごとの判定）。1つのINSERT文に複数行分の束縛値を並べる書き方は、`too many SQL variables`で失敗する |
| 連番の採番（案件番号など） | 1文の`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`で採番する（読む・足す・返すが1文で完結する）。ローカルで20件を同時に発行して重複しなかった。ユニーク制約を最後の守りにする。欠番は再利用しない（C-122） |
| FTS5を含むDBのエクスポート不可 | C-127で定期エクスポートを設けないため衝突しない。手動エクスポートは、仮想テーブルを削除して書き出し、`'rebuild'`で索引を作り直す（ADR-0010） |
| 一意性の最後の守り | ユーザーIDの正規化値、チャンネル名の大文字小文字を区別しない重複、`direct_key`、案件番号は、アプリの確認に加えて、DBの一意索引を置く |

## 索引の候補

「一覧の絞り込み条件＋並び順」と同じ並びの索引を、一覧ごとに作る。索引は書き込みのたびに更新され、D1の書き込み行数の課金にも効くため、使われる一覧だけに限る。下の表は**候補**であり、**確定は、実装時に`EXPLAIN QUERY PLAN`で確認して行う**。

| 対象 | 索引の候補 | 使う場面 |
| --- | --- | --- |
| `messages` | （ルーム, ID）。スレッド用に（親メッセージ, ID） | ルームの新しい順の一覧、スレッドの返信、未読の数え直し、「最後のID以降」の取得 |
| `read_positions` | 主キー（ユーザー, ルーム） | 未読の判定。ユーザーの全ルームをまとめて引く |
| `channel_members` / `case_participants` | （ユーザー, 状態）など | サイドバー、見られる範囲の判定 |
| `audit_logs` | （発生日時, ID）。絞り込み列は使われ方を見て追加 | 監査ログの絞り込みとページ送り、1年保持の掃除 |
| `sessions` | 主キー（ID＝トークンのハッシュ）。（ユーザー, 作成日時）【Issue #120で確定した索引】 | 認証、全端末の失効、掃除 |
| `login_attempts` | 主キー（種別, キー）。（最終更新日時）【Issue #120で確定した索引。掃除用】 | 試行制限、掃除 |
| 通知 | （ユーザー, 状態, ID） | 未読の通知 |
| 検索 | FTS5の仮想テーブル（ADR-0010） | 日本語の全文検索 |

## フォルダとファイルの役割

| 場所 | 役割 |
| --- | --- |
| `backend/src/routes/` | Controller。入力の受け取りと応答だけ |
| `backend/src/services/` | Service。業務のルール |
| `backend/src/db/` | Repository。DBへのアクセス |
| `backend/src/lib/` | 共通の部品（エラー・入力チェック・セキュリティなど。ハーネスが用意） |
| `backend/src/routes/clients.ts` | 取引先マスタの管理・社員向けルート（Issue #192）。`adminClientRoutes`・`clientRoutes`を`backend/src/index.ts`で登録 |
| `backend/src/services/client.service.ts` | `createClientService`で取引先管理の認可と業務規則を扱う |
| `backend/src/db/client.repository.ts` | `createClientRepository`で取引先の保存・一覧・更新と監査記録を扱う |
| `backend/src/db/client-rate-limit.repository.ts` | `createClientRateLimitRepository`で取引先APIの利用者ごとのレート制限状態を原子的に更新する |
| `shared/client-rules.ts` | 取引先コード・名前・検索語の入力規則と名前比較キー |
| `backend/db/schema.ts`、`backend/db/migrations/0005_add_clients.sql`、`backend/db/migrations/0006_seed_internal_client.sql`、`backend/db/migrations/0007_add_client_api_rate_limits.sql` | 取引先マスタ・INT初期行・取引先API rate状態のDB定義（Issue #192）。DDLは通常生成migration、INT初期行はADR-0018の例外となる専用migration |
| `frontend/src/features/clients/`、`frontend/src/pages/ClientsPage.tsx` | 取引先管理画面。API層・query key・フォーム・`ClientsManager`を構成し、詳細は[client-management.md](client-management.md)を参照 |
| `frontend/src/App.tsx`、`frontend/src/features/auth/api/auth-api.ts`、`frontend/src/features/app-shell/navigation.ts`、`SidebarNav.tsx` | 取引先管理画面の権限付きルートと管理メニュー。画面側の権限確認はサーバー認可の代わりにならない |
| `backend/src/routes/accounts.ts`、`backend/src/services/account.service.ts`、`backend/src/db/account.repository.ts` | アカウントの個別発行・一覧・部署の候補（Issue #199）。`adminAccountRoutes`を`backend/src/index.ts`で`/api/admin/accounts`へ登録。詳細は[accounts.md](accounts.md) |
| `shared/account-rules.ts` | アカウント発行の入力規則（本名・表示名の上限など）。社員ID・メール・内線・役職は`shared/setup-rules.ts`を参照する葉（Issue #199） |
| `frontend/src/features/accounts/`、`frontend/src/pages/AccountsPage.tsx`、`AccountCreatePage.tsx` | S-22（一覧）・S-23（登録）。API層・query key・フォーム・一覧表を構成し、初期パスワードはキャッシュに載せず`useState`だけで扱う（[accounts.md](accounts.md)） |
| `shared/setup-rules.ts` | 初回セットアップの入力上限と社員ID・内線・32 byte base64url形式の定義元。API・画面・設定から参照する環境非依存の葉（Issue #181） |
| `backend/src/rules-examples/` | Skillの良い例・悪い例のテスト（ハーネスが管理する。消さない） |
| `frontend/src/` | 画面（React） |
| `frontend/src/styles/` | デザインの土台。`index.css`（Tailwindの読み込み・デザイントークン・全体の基本のスタイル）と、色のコントラスト比のテスト（Issue #171。[style-foundation.md](style-foundation.md)） |
| `frontend/src/components/` | 画面で共通に使う部品。`Button`（`variant`：primary・secondary・danger・ghost）・`TextField`・`SelectField`・`SecretField`・`Alert`・`PageLayout`（`FieldMessages`は内部用）。使い分けと足す手順は [style-foundation.md](style-foundation.md) |
| `frontend/src/features/app-shell/` | ログイン後の全画面が使う共通レイアウト（S-01）。`AppShell`・`Header`・`Sidebar`・`SidebarNav`・`AdminMenu`・`MobileNav`・`Drawer`・`AvatarMenu`・`navigation.ts`（Issue #121）。項目を足す場所と書き方は [app-shell.md](app-shell.md) |
| `backend/src/routes/departments.ts`、`backend/src/services/department.service.ts`、`backend/src/db/department.repository.ts` | 部署の作成・一覧・改名・オーナー交代・オーナー候補（Issue #196）。`adminDepartmentRoutes`・`departmentRoutes`を`backend/src/index.ts`で登録。作成・改名・交代はそれぞれ1回の`db.batch`で部署・チャンネル・ロール・所属・参加・監査を確定する |
| `shared/department-rules.ts` | 部署名・説明の入力規則、比較キー、お知らせ専用チャンネルの名前の定義元（Issue #196） |
| `backend/db/schema.ts`、`backend/db/migrations/0008_add_department_channels.sql`、`0009_backfill_department_channels.sql` | `departments`への列の追加と、`rooms`・`channels`・`channel_members`（Issue #196）。0009はADR-0021の例外となる補完migration |
| `frontend/src/features/departments/`、`frontend/src/pages/DepartmentsPage.tsx`・`DepartmentCreatePage.tsx`、`frontend/src/components/SelectField.tsx` | 部署管理画面（S-24・S-08）。詳細は[department-management.md](department-management.md) |
| 取引先マスタ（Issue #192） | 管理・社員向けAPIとS-36管理画面を実装済み。先行テストはGreenだが、全体QAは未完了。ファイル責務と処理の流れは [client-management.md](client-management.md) に記載する |

（追加・変更したファイルを、実装したPRの中で、この表に足す。共通部品の個々のファイルは、下の「共通部品（Issue #118）」に書く）

## 共通部品（Issue #118）

機能のIssueが共通で使う部品。ADR-0006（ID・カーソル）、ADR-0012（権限は毎回サーバー側で確認する）に沿う。コードは書き写さず、ファイル名・関数名で指す。

| 部品 | ファイル | 役割・決まり |
| --- | --- | --- |
| ULID | `backend/src/lib/ulid.ts` | `newUlid`で時刻順のIDを作る（`createUlidFactory`で時計と乱数を差し替えられる）。`isUlid`で形式を確かめる。同じ要求の中で、同時刻・時計が戻った場合は直前の乱数に1を足して昇順を保つ（単調）。保証するのは同じWorkerのインスタンス内だけで、別インスタンス間は時刻順になるだけ。根拠は[調査メモ](../research/design-foundation.md)の12章 |
| カーソル | `backend/src/lib/cursor.ts` | 一覧はOFFSETを使わず、`(並び替えの値, ID)`の組で続きを取る。`cursorQuerySchema`が`cursor`と`limit`を検証し、`afterCursor`（並び替えの値＋ID）または`afterId`（IDだけ）が条件を作り、`toPage`が`limit+1`件の結果から1ページ分と`nextCursor`を作る。壊れたカーソルは`decodeCursor`が`VALIDATION_ERROR`（422）にする。件数は`PAGE_LIMIT`（メッセージ50・その他20・最大100）。並び替えの値の文字列は128文字まで、カーソル全体は1024文字まで |
| 監査ログの書き込み | `backend/src/db/audit-log.repository.ts` | `auditLogInsert`は挿入の文を**返すだけ**で実行しない。業務の更新と同じ`db.batch([...])`に入れて、同時に確定・失敗させる（`backend/src/db/database.ts`の`BatchItem`型）。`detail`に入れてよいのは件数・変更前後の識別子や状態・失敗の分類・文字数などの概要で、入れ子にしない。本文・氏名・メール・電話・CSVの行の値・秘密情報は入れない。`redact`は項目名による保険であり、個人情報を取り除く仕組みではない |
| 監査ログの操作の種類 | `backend/src/lib/audit-actions.ts` | `AUDIT_ACTIONS`の一覧。機能のIssueが操作を足すときにここへ足す。Issue #119で`setup.initial_admin.create`を、Issue #120で`auth.login`・`auth.logout`・`auth.rate_limited`・`setup.rate_limited`を足した。`auditLogInsertForSession`は、セッションがあるときだけ書く条件付きの監査（ログインの成功・ログアウト） |
| 権限判定 | `backend/src/lib/authorization.ts` | `createAuthorizer(known, resolve, { logger })`が`can`（真偽）と`authorize`（拒否は例外）を返す。範囲（`Scope`）は会社または部署。`known`にない権限IDは、Resolverが許可しても拒否する。未ログインは`UNAUTHENTICATED`、権限なしは`FORBIDDEN`にし、拒否は`logger.audit`で必ず記録する（利用者IDやResolverの権限集合は含めない）。**本番の権限IDの一覧とResolverは、Issue #119で`backend/src/services/authorizer.ts`（`createAppAuthorizer`。`createAuthorizer`を呼ぶ1か所）に組んだ**（[roles-and-setup.md](roles-and-setup.md)） |
| Cronの枠 | `backend/src/scheduled.ts`、`backend/src/index.ts` | `createScheduledHandler`が、`CronJob`（`cron`式・`name`・`run`）の一覧から、受け取った`controller.cron`と同じ式のジョブを順に実行する。失敗は記録して再スローする。`index.ts`は、名前付きの`app`と、`default`の`fetch`・`scheduled`を公開する。ジョブの一覧は#118では空で、機能のIssueが足す（**Issue #120で`authCleanupJob`（`auth-cleanup`。毎日UTC 18:17）を足し、`wrangler.jsonc`の`triggers.crons`に同じ式を設定した**。[auth-session.md](auth-session.md)）。**本番への適用は利用者が行う**（ADR-0008の掃除） |
| 要求の追跡ID | `backend/src/lib/trace-id.ts` | Issue #120で追加。`traceIdOf`が`X-Request-Id`を、形（`[A-Za-z0-9._-]`）と長さ（1〜64文字）を満たすときだけ使い、満たさなければ新しいULIDにする（利用者が送れる値が監査ログの`trace_id`に入るため） |
| エラー応答の`Retry-After` | `backend/src/lib/error-handler.ts` | Issue #120で追加。`RATE_LIMITED`の`details.retryAfterSeconds`を`Retry-After`ヘッダーにだけ出し、本文には出さない |
| ログのDBエラーの整形 | `backend/src/lib/logger/logger.ts` | Issue #120で追加。SQLとパラメータを含むDBのエラーは、固定の文言にして出力する |
| `audit_logs`テーブル | `backend/db/schema.ts`、`backend/db/migrations/0001_add_audit_logs.sql` | 列は`id`・`occurred_at`・`actor_id`・`action`・`target_type`・`target_id`・`result`・`trace_id`・`detail`。**外部キーは付けない**（操作者や対象が消えても監査ログを残すため）。索引は`(occurred_at, id)`。`result`は`success`／`failure`だけを許すCHECK制約。`occurred_at`はDBの既定値（UTCのISO形式） |

テストの場所：各ファイルの隣の`*.test.ts`。DBを使うものは`backend/src/db/audit-log.repository.db.test.ts`・`backend/src/db/database.types.db.test.ts`、入口は`backend/src/index.test.ts`、Cronは`backend/src/scheduled.test.ts`。

## 処理の流れ

（主な処理の入口から出口までの流れを、実装したPRの中で書く）

## 機能ごとの設計書

| 機能 | 設計書 | 関係するIssue |
| --- | --- | --- |
| ロール・権限・会社と部署の土台・初代全体管理者の初回セットアップ（権限ID67種類、固定の3ロール、Resolver、R-45の申し送り、`POST /api/setup`、初期パスワード、本名の暗号化、共有入力規則） | [roles-and-setup.md](roles-and-setup.md) | #119（親 #108）、#181（親 #180） |
| ログイン・ログアウト・セッション・試行制限・掃除・既定拒否・ログイン画面S-02（2段ログインと#122の拡張点、初回パスワードのゲート、公開の許可リスト6件、`__Host-session`、接続元の受付枠と社員IDの待ち時間、時間差対策と既知の限界、Cron） | [auth-session.md](auth-session.md) | #120（親 #108）、依存 #119 |
| デザインの土台（Tailwind CSS 4・デザイントークン・共通部品5つ・CSPを変えない決まり・クラスの規約・Preflightへの対処・画面幅の決まり・初回JS/CSSの大きさ） | [style-foundation.md](style-foundation.md) | #171（親 #108）、ADR-0015 |
| アカウントの個別発行（S-23）と一覧（S-22）（全体管理者の認可をroute・service両方で入力検証より先に行う、初期パスワードの一度だけの表示とキャッシュに載せない扱い、重複の409、後続の拡張点、未決定のレート制限と離脱確認） | [accounts.md](accounts.md) | #199（親 #126）、ADR-0012・0013 |
| 共通レイアウトの骨格S-01（ヘッダー・サイドバー・本文・下部メニュー・ドロワー・アバターメニュー、サイドバーの項目やヘッダーの部品を足す場所と書き方、管理メニューの仕組みと権限の扱い、認証ガードの各状態、jsdomの制約とE2Eの役割） | [app-shell.md](app-shell.md) | #121（親 #108）、依存 #120・#171、ADR-0015 |
| 部署の登録・改名・オーナー交代と部署の専用チャンネル2つ（batchの文の順序と前提の確認、`rooms`・`channels`・`channel_members`を後続が使う約束、初代部署の補完migration、本番適用前の注意、未実装の記録） | [department-management.md](department-management.md) | #196（親 #125）、ADR-0018・0021 |

## 関係する文書

- 要件：`docs/requirements.md`、`docs/requirements/`（決定記録は`docs/requirements/decision-register.md`のC-145〜C-153）
- 技術とバージョン：`docs/tech-stack.md`
- 調査メモ：`docs/research/`（[design-foundation.md](../research/design-foundation.md)・[db-d1-vs-postgres.md](../research/db-d1-vs-postgres.md)・[spike-d1-hash.md](../research/spike-d1-hash.md)ほか）
