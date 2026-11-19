# 監査ログの閲覧（Issue #156。要件 0-6、画面 S-25）

## 目的

全体管理者が、監査ログ（誰が・いつ・何をしたか）を専用の画面で閲覧・絞り込みできるようにする。閲覧のたびに、閲覧した事実も監査ログに残す（0-6 AC-6）。監査ログを画面からも本番のコードからも変更・削除・書き出ししない（0-6 AC-4）。コードは書き写さず、ファイル名・関数名で指す。

## 範囲

| 区分 | 内容 |
| --- | --- |
| 作ったもの | 検索のAPI 1本（`POST /api/admin/audit-logs/search`。EP-0-19）／閲覧の記録（`audit_log.view`）を資格の確認と同じ`db.batch`で行う仕組み／絞り込み用の索引3つ（migration 0027）／セッションの`permissions`への`perm.audit_log.view`／S-25の画面とメニュー「監査ログ」／削除・更新の経路がないことを確かめる静的なテスト |
| 作らないもの | 変更・削除・書き出しのAPI・ボタン（0-6 AC-4、R-16）／429の試行制限（全体管理者だけが使うAPIで、既存の管理者の一覧にも試行制限がないため）／操作者の候補を返すAPI（操作者・対象は一覧の行から指定する）／1年の保持の削除の仕組み（C-74）／DBのトリガーで削除・更新を禁じること／運用ログ（`logger.audit`）の閲覧 |
| 表示の側だけ作ったもの | 0-6 AC-7（アカウント登録の失敗の記録）。失敗の分類（`failureCategory`）と件数（`affectedCount`）を表示し、対象の社員を出さない規則までを作った。**失敗を記録する側は、CSVの一括登録のIssue #129で作る**（利用者の決定。Issue #156のコメント）。この Issue の完了条件は「監査ログに記録されているものを、全体管理者が閲覧・絞り込みできる」 |
| 決定 | [C-180](../requirements/decision-register.md) |

### 閲覧の対象は、D1の`audit_logs`だけ

権限の拒否（`lib/authorization.ts`の`recordDenied`）・チャンネル申請の404/403・`client.rate_limited`などは`logger.audit`（運用ログ）にだけ出て、D1の`audit_logs`には入らない。この画面が見せるのはD1の記録だけで、運用ログの案内は画面にも出さない（要件にないため）。D1に失敗が入るのは、`auth.login`（操作者・対象は不明）、`auth.reauthenticate`・`auth.password_change`の誤ったパスワード、`auth.rate_limited`・`setup.rate_limited`など。

## ファイルと役割

### 共有・DB

| ファイル | 役割 |
| --- | --- |
| `backend/src/lib/audit-actions.ts` | `AUDIT_ACTIONS`に`audit_log.view`を足した（**Issue #143で、チャンネルの管理の`channel.update`・`channel.archive`・`channel.restore`の3つを足した**。値・理由の文は`detail`に入れない。[channels.md](channels.md)）。**Issue #147（147-B）で、案件の参加者の追加・削除と納期の変更の`case.participant.add`・`case.participant.remove`・`case.due_date.change`の3つと、対象の種類`case`を足した**（`detail`は`caseId`・`userId`・`self`・`before`・`after`だけ。[cases.md](cases.md)）。**Issue #150（150-A）で、案件の終了・再開の`case.close`・`case.reopen`の2つを足した**（`detail`は平坦で`caseId`・`notifiedCount`〔通知した人数〕だけ。氏名・本文を入れない。業務の更新と同じ`db.batch`で、前提が崩れたら残らない。再選定の結果の記録は150-B）。**Issue #148（148-B-2）で、案件の添付の公開範囲の変更の`case.attachment.visibility.change`と、対象の種類`attachment`を足した**（`detail`は平坦で`caseId`・`before`・`after`だけ。ファイル名・投稿者名を入れない。業務の更新と同じ`db.batch`で、監査を先に入れ、前提が崩れたら残らない。[cases.md](cases.md)の「148-B-2 の設計」）。`AUDIT_TARGET_TYPES`（対象の種類の固定の一覧。12種。147-B で`case`、148-B-2 で`attachment`を足した）を足した。`attachment`を足さないと、記録された行を「この対象で絞り込む」が 422 になる。検索の入力の検証と画面の絞り込みの定義元。各書き込みの`targetType`の型をこの一覧に絞ることはしていない |
| `backend/db/schema.ts` | `auditLogs`に複合索引3つを足した |
| `backend/db/migrations/0027_add_audit_log_filter_indexes.sql`、`meta/0027_snapshot.json`、`meta/_journal.json` | 索引3つだけの migration（`drizzle-kit generate`の生成物）。#146-B が0026を使ったため、mainの取り込みで0026から0027に振り直した |

### バックエンド

| ファイル | 役割 |
| --- | --- |
| `backend/src/db/audit-log.repository.ts` | 既存の書き込み（`auditLogInsert`など）は変えず、読み取りの`createAuditLogReader`（`search`・`findViewerFacts`）と`withAuditLogReader`を足した。`search`が閲覧の記録と一覧の取得を1回の`db.batch`で行う。資格の条件を作る内部関数`viewerStillAllowed`、閲覧の記録の`detail`を作る`viewDetail`、JSTの日付の境界（`jstDayStart`・`jstNextDayStart`）、資格が崩れたときの専用エラー`AuditLogViewStateChangedError`を持つ |
| `backend/src/services/audit-log.service.ts` | `createAuditLogService`の`authorize`・`search`。`toAuditLogItem`（一覧の行を、返してよい項目だけに整形する純粋な関数）。`canViewAuditLogs`（セッションの`permissions`用。拒否の記録を出さない`can`を使う）。`withAuditLogService`が構成する |
| `backend/src/routes/audit-logs.ts` | `adminAuditLogRoutes`。`requireAuditLogViewer`（全体管理者の認可。入力の検証より先）→ `POST /search`（`validate("json", …)`・`strict`・`noStore`）。変更・削除・書き出しのルートは置かない |
| `backend/src/index.ts` | `/api/admin/audit-logs`に登録した（経路の登録は`app.ts`ではなく`index.ts`にある） |
| `backend/src/services/session.service.ts` | `SessionPrincipal`に`sessionId`を足した。閲覧の記録を、セッションが今も有効であることの確認と同じ`db.batch`で行うために使う。応答・ログには出さない |
| `backend/src/routes/auth.ts` | セッションの応答の`permissions`に、全体管理者だけ`perm.audit_log.view`を足した（表示の制御。認可はサーバーが毎回行う） |
| `docs/api/openapi.json`、`backend/src/openapi.test.ts` | 検索のAPIと`permissions`の列挙値の定義、実routeとの契約の確認 |

### フロントエンド

依存の向きは、pages → features → 共通。`features/audit-logs/`は`index.ts`で`AuditLogsPage`だけを公開する。

| ファイル | 役割 |
| --- | --- |
| `frontend/src/features/audit-logs/audit-log-api.ts` | `searchAuditLogs`。共通の`apiClient`で`POST /admin/audit-logs/search`を呼び、応答をzodで検証する。決めた項目以外（`detail`・`trace_id`など）が紛れても画面に渡さない |
| `frontend/src/features/audit-logs/query-keys.ts` | `auditLogKeys.search`。キーに**利用者のID**と「絞り込む」を押した回数を含める（下の「画面」） |
| `frontend/src/features/audit-logs/action-labels.ts` | 操作の種類・対象の種類の日本語の名前（Issue #143で、`channel.update`・`channel.archive`・`channel.restore`の名前を足した）。名前がない操作は、操作のIDをそのまま出す（空にしない）。案件の作成の申請の承認・却下（`case_request.approve`・`case_request.reject`）の名前を含む。147-B で、`case.participant.add`（案件の参加者の追加）・`case.participant.remove`（案件の参加者の削除）・`case.due_date.change`（案件の納期の変更）と、対象の種類「案件」の名前を足した。150-A で、`case.close`（案件の終了）・`case.reopen`（案件の再開）の名前を足した。148-B-2 で、`case.attachment.visibility.change`（案件の添付の公開範囲の変更）と、対象の種類「添付ファイル」の名前を足した。足りない操作がないことは、画面のテストが`AUDIT_ACTIONS`と照らして確かめる |
| `frontend/src/features/audit-logs/AuditLogFilters.tsx` | 絞り込みのフォーム（期間・操作の種類・結果）。期間の誤りと、422の`fields`を入力欄の近くに文字で出す |
| `frontend/src/features/audit-logs/AuditLogsPage.tsx` | S-25。一覧（パソコンは表、狭い画面はカード形式）・「さらに読み込む」・エラー・0件。`useInfiniteQuery`を使う |
| `frontend/src/App.tsx` | `/audit-logs`と`AuditLogsRoute`（`perm.audit_log.view`がなければ`NotFoundPage`。セッション確認中は待つ） |
| `frontend/src/features/app-shell/navigation.ts` | 管理メニューの「マスタ・ログ」のまとまりに「監査ログ」を足した（`requires`は`perm.audit_log.view`。[app-shell.md](app-shell.md)）【Issue #143の143-bで、まとまりの名前を「マスタ・記録」に直した（C-183）。`id`・項目は変えていない】 |
| `frontend/src/features/auth/api/auth-api.ts` | セッションの`permissions`の型とzodの列挙値に`perm.audit_log.view`を足した（足さないと応答の検証で落ちる） |

## API（POST /api/admin/audit-logs/search。EP-0-19）

- 要件の草案の`/api/audit-logs/search`から、既存の管理APIに合わせて`/api/admin/`の下に置いた。POSTにしたのは、取得のたびに閲覧の記録を伴うため（`app.ts`の送信元の確認の対象になる）。GETの一覧は作らない
- 本文（`strict`）：`from`・`to`（JSTの日付`YYYY-MM-DD`。暦にない日付は422。`from`が`to`より後なら`fields`は`to`の422）、`actorId`、`action`（`AUDIT_ACTIONS`のどれか）、`targetType`・`targetId`（組で指定。片方だけなら422）、`result`（`success`・`failure`）、`cursor`・`limit`（`cursor.ts`の共通の部品。既定20件、最大100件）
- 期間：`from`はJSTのその日の0時以降、`to`はJSTのその日の終わりまで。`occurred_at`（UTCのISO 8601）と同じ形式の文字列に直し、`>=`と`<`で比べる。要件の草案のISO 8601の日時から変えた（画面が日付の入力のため。C-180）
- 応答200（`noStore`）：`items`と`nextCursor`。行は`id`・`occurredAt`・`action`・`result`・`actor`・`target`と、登録失敗のときだけ`failureCategory`・`affectedCount`、分類があるときだけ`reason`
- エラー：401・403（全体管理者以外はすべて同じ403）・422（`fields`）・500

### 応答に出さない項目

次は、SQLで選ばず、応答にも載せない。

- `detail`の原文（`toAuditLogItem`が、決めた3項目`failureCategory`・`affectedCount`・`reason`だけを、型を確かめて取り出す。DMの部屋のIDなどのほかの項目は返さない。`detail`が壊れたJSONでも、その1行を項目なしとして扱い、一覧全体は失敗させない）
- `trace_id`
- 本名（`legal_name`）・メール・ログインID（結合する表の列として選ばない）
- メッセージの本文・チャンネルの投稿内容（`messages`を結合しない）

## 判定の順と、存在の非開示

1. 認証（`app.ts`）→ 401
2. 送信元の確認（`app.ts`）→ 403
3. `requireAuditLogViewer`が、会社の範囲で`perm.audit_log.view`を認可 → 403（拒否は`authorize`が運用ログに出す）。**入力の検証より先**なので、権限のない人に絞り込みの規則を教えない
4. 入力の検証 → 422
5. Serviceの`search`が、もう一度認可し、閲覧の記録と取得を1回の`db.batch`で行う

- 全体管理者以外のロール（オーナー・一般メンバー）は、入力が正しくても誤っていても同じ403
- 件数は返さない。通知は出さない。閲覧するのは全社を見られる全体管理者なので、非公開チャンネルの名前も解決して見せる。**DMは名前を解決しない**（DMの部屋は`channels`に行がなく、`messages`も結合しない）

## 閲覧の記録を、資格の確認と同じbatchで行う仕組み

最初の判定の後に、セッションの失効・ログアウト・無効化・全体管理者の交代が起きても、**記録を回避した閲覧ができない**ようにする。

- `viewerStillAllowed`が、資格を1つの条件にまとめる。記録の`onlyWhen`と、一覧のSELECTのWHEREの**両方に同じ条件**を入れる（2か所に書かない）
- 条件は、最初の判定（`session.service.ts`の`resolveSession`・`session-policy.ts`の`isSessionExpired`・`permission-resolver.ts`）と1項目ずつ同じにしてある。セッションの行がある（かつ利用者が一致）／失効していない／無操作の期限（`SESSION_IDLE_MS`）を過ぎていない／作成からの期限（`SESSION_MAX_AGE_MS`）を過ぎていない／利用者が有効／全体管理者のロールが会社の範囲で割り当てられている。期限は「ちょうど」で切れるので比較は`>`。値は`session-policy.ts`の定数から作り、書き写さない
- 時刻は、ミドルウェアの認証で使ったのと同じ時計から、Serviceが`search`へ渡す
- batchの文の順：閲覧の記録（`audit_log.view`）→ 一覧のSELECT。D1のbatchは1つのトランザクションなので、記録と取得は同時に確定し、片方だけ起きない。条件が偽なら、記録も行も0になる
- 閲覧の記録：`targetType`は`audit_log`、`targetId`はnull、結果は成功。`detail`は入れ子にせず、`page`（最初か続きか）・絞り込みの種類（`filterAction`・`filterResult`・`filterTargetType`）・操作者と対象の指定の有無（`hasActor`・`hasTarget`）・期間（`from`・`to`）だけ。**操作者・対象のIDは入れない**（個人の検索の履歴を残しすぎないため）。閲覧の記録は一覧にも出る（自分の閲覧も見える）
- 同じ人の2要求は、記録が1件ずつ残る（検索・ページ送りの1回ごとに記録する決まり）

### 0行のときの読み直し

記録が0行（資格が崩れた）なら、`AuditLogViewStateChangedError`になる。Serviceが`findViewerFacts`で事実を読み直し、**最初と同じ順**で判定する。

1. セッションの行がない・利用者が違う・失効・期限切れ・利用者が無効 → 401
2. 全体管理者でない（ロールがない・範囲が会社でない） → 403
3. どれにも当たらなければ、成功にせず元のエラー（500）

セッションの状態を先に見るので、ログアウトした人に権限の状態を教えない。

## 監査の行は書き換えない（同じbatchの中で決まる値を入れるとき）

同じ`db.batch`の中で決まる値（採番した案件番号・数えた参加者数など）を監査の`detail`に入れるときは、**行を入れてから`UPDATE`で書き換えない**。値が決まった後に、`auditLogInsertWithDetailSql`（`audit-log.repository.ts`）で、`detail`をSQLの式（`json_object(...)`など）で組み立てて**1回の`INSERT…SELECT`**で入れる。項目名は呼び出し側で固定し、入れ子にしない。使っているのは案件の承認（`case-request.repository.ts`の`approve`）と、オーナーの交代・後任のある部署の作成（`department.repository.ts`の`auditWithCaseJoinCount`。`detail`の`caseJoinCount`＝案件に新しく入った行の合計。#147の147-C-2。件数は入る前の不足を数えるため、監査の文を参加の文より前に置く）。#146-Bの承認は、行を入れた直後に`json_set`で書き換えていたが、0-6 AC-4と合わないため、C-180で訂正した（`detail`の項目・値は変えていない）。

番人のテスト`backend/src/audit-log.immutable.test.ts`が見る範囲は、本番のコード（`backend/src`のテスト以外・`backend/db/migrations`・`backend/db/scripts`）のうち、`audit_logs`への`DELETE`・`UPDATE`・`DROP`・`TRUNCATE`と`.delete(auditLogs)`・`.update(auditLogs)`。`INSERT`は対象外。#146-Bの承認の書き換えは、このテストが、mainの取り込みで検出した。

## 一覧のSQLと名前の解決

- 1つのSELECTで、`audit_logs`に`users`（操作者）・`users`（対象が利用者）・`departments`・`clients`・`channels`をLEFT JOINする（N+1にしない）。対象の結合は`target_type`で絞る。チャンネルの`target_id`は`room_id`
- **同じ表（`users`）を2回結合するため、`is_active`の列に別名を付ける**。D1のbatchは結果を列名のオブジェクトで返すので、同じ列名が2つあると値が入れ替わる
- 並びは`occurred_at`・`id`の降順。続きは`cursor.ts`の`afterCursor`・`toPage`（OFFSETなし）。後から書かれた行は先頭側に入るので、続きで重複・欠落しない
- 名前の規則：有効・無効の社員は表示名（無効は`isActive: false`。画面は「（無効）」を付ける。本名は出さない）／部署・取引先・チャンネルは名前／行がない対象は`label: null`（画面は「（削除された対象）」）／`message`・`channel_request`・`case_request`・`case`（147-B。案件の名前は解決しない）・`attachment`（148-B-2。ファイル名は解決しない）・`retirement_request`・`source`・`audit_log`は名前を解決せず、種類の名前だけを出す
- 操作者が不明（ログイン失敗など）は`actor: null`。行がない操作者は`{ displayName: null, isActive: false }`
- アカウント登録の失敗（`account.create`で結果が失敗）は、`target`を解決せずnullにし、`failureCategory`・`affectedCount`を出す

## 索引（migration 0027）

`audit_logs_actor_occurred_idx`（`actor_id`・`occurred_at`・`id`）、`audit_logs_action_occurred_idx`（`action`・`occurred_at`・`id`）、`audit_logs_target_occurred_idx`（`target_type`・`target_id`・`occurred_at`・`id`）。期間だけ・絞り込みなしは既存の`(occurred_at, id)`を使う。`result`は2値で選択性が低いので索引にしない。操作者・操作・対象の各絞り込みで索引が使われ、全件の走査と並び替えの一時領域が出ないことは、`EXPLAIN QUERY PLAN`のテストで確かめる。

## 画面（S-25。`/audit-logs`）

- メニュー「監査ログ」（`perm.audit_log.view`）と`AuditLogsRoute`は表示の制御で、認可ではない。持たない人には、URLを直接開いても「見つからない」表示
- 一覧：日時（JSTの`YYYY-MM-DD HH:mm:ss`。実行環境の時刻帯に依存しない）・操作した人・操作の種類（日本語の名前）・対象・結果（「成功」「失敗」の文字）。登録失敗は分類と件数。パソコンは表、狭い画面はカード形式（CSSの切り替え）
- 絞り込み：期間・操作の種類・結果はフォームで、**操作した人・対象は一覧の行の「この人で絞り込む」「この対象で絞り込む」から**指定する（候補を返すAPIを作らないため）。指定中は外せる。「絞り込む」を押したときだけ検索する（入力ごとには送らない）
- ページ送りは**「さらに読み込む」**（`useInfiniteQuery`）。`nextCursor`がnullなら出さない。0件は「該当する記録はありません」。`screens.md`の「前へ／次へ」は、文書のほうを直した（C-180）
- 取得のたびに閲覧の記録が残るため、`refetchOnWindowFocus`・`refetchOnReconnect`・`retry`を無効にし、「絞り込む」「さらに読み込む」「再試行」を押したときだけ送る。同じ条件で押し直したときも最初から読み直すため、キーに押した回数を入れる。閲覧の内容を手元に長く残さないため`gcTime`は0
- 検索中（取得中）は「絞り込む」を無効にし、多重送信（検索と閲覧の記録の重複）を防ぐ
- **検索のキーに利用者のIDを含める**。401の処理はセッションのキャッシュだけを捨てるので、利用者が切り替わったときに、前の利用者の一覧を出さないため（0-2 AC-8。#284と同じ型の問題を、この画面では最初から避ける）。利用者のIDが確かめられるまで取得しない
- エラー：422の`fields`は該当の入力欄（期間の誤りは終了日）／403は「権限がありません」／そのほかは一覧の上に再試行つきのエラー
- 変更・削除・書き出しのボタンは置かない

## 監査ログを消す・書き換える経路を持たないこと（0-6 AC-4）

- 本番のコード（`backend/src`・`backend/db/migrations`・`backend/db/scripts`）に、`audit_logs`の`DELETE`・`UPDATE`・`DROP`はない。定期実行（`backend/src/index.ts`の`scheduled`は`authCleanupJob`だけ）が消すのは`sessions`・`login_attempts`だけ。`audit_logs`は外部キーを持たないので、連鎖の削除もない
- 削除があるのは、架空のテストデータを識別子だけで消すテストの後始末（`backend/db/seeds/cleanup.sql`・`e2e/seeds/*-cleanup.sql`・各テスト）だけ
- 番人のテスト`backend/src/audit-log.immutable.test.ts`が、本番のコードを読んで、削除・更新・破棄の書き方がないことを確かめる。テストが空振りしないよう、読んだファイルの数と、検出の規則が悪い例を検出することも確かめる。コードの性質を見るので、DBの振る舞いではなく静的に調べる
- ルートの面でも、`PUT`・`PATCH`・`DELETE`と`GET /export`は、全体管理者でも404（ルートがない）

## テストの場所

| 層 | ファイル |
| --- | --- |
| DB（SQL・名前の解決・各絞り込み・ページ送り・JSTの日の境界・閲覧の記録と資格の各条件） | `backend/src/db/audit-log.repository.list.db.test.ts`、`audit-log.repository.view.db.test.ts` |
| DB（`EXPLAIN QUERY PLAN`で索引を使うこと） | `backend/src/db/audit-log.repository.explain.db.test.ts` |
| 単体（`toAuditLogItem`・0行の読み直しの順・認可） | `backend/src/services/audit-log.service.test.ts` |
| 結合（ルート。401・403・422、認可が検証より先、変更・削除のルートがないこと） | `backend/src/routes/audit-logs.test.ts`、`backend/src/routes/auth.test.ts`（セッションの`permissions`） |
| 静的（削除・更新の経路がないこと） | `backend/src/audit-log.immutable.test.ts` |
| 契約・定数 | `backend/src/openapi.test.ts`（検索のAPIの`pattern`の番人：``の抜け・重なりを検出し、日付の形の項目が実際の日付に一致することを確かめる）、`backend/src/lib/audit-actions.test.ts` |
| 画面 | `frontend/src/features/audit-logs/AuditLogsPage.test.tsx`、`AuditLogsPage.session-switch.test.tsx`、`audit-log-api.test.ts`、`frontend/src/audit-logs-route.test.tsx`、`frontend/src/features/app-shell/navigation.audit-logs.test.tsx`、`frontend/src/features/auth/api/auth-api.audit-log.test.ts` |
| テストの部品 | `backend/test/audit-log-fixtures.ts`、`frontend/src/test/audit-log-handlers.ts` |
| E2E | `e2e/audit-logs.spec.ts`（シード`e2e/seeds/audit-logs.sql`、後始末`e2e/seeds/audit-logs-cleanup.sql`。[e2e.md](../testing/e2e.md)） |

## 関係するIssueとADR

- Issue #156（親なし）。前提：#118（監査ログの書き込み・`audit_logs`）。#129（CSVの一括登録）で、アカウント登録の失敗の記録を書く（0-6 AC-7の記録の側）
- 決定記録：[C-180](../requirements/decision-register.md)、C-74（保持1年）・C-76（表示項目・絞り込み・閲覧の記録）
- 関係するADR：[0020](../adr/0020-test-scope-mutation-e2e.md)（E2Eの範囲。セッションの権限の応答に1項目足すだけで、認証の判定は変えていないため(b)で実行した）。ADRの追加はない
- 関係する設計書：[auth-session.md](auth-session.md)（セッションと`permissions`）、[app-shell.md](app-shell.md)（管理メニュー）
