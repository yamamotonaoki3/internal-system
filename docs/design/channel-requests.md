# チャンネルの作成申請と承認（Issue #131）

## 目的

メンバーがチャンネルの作成を申請し（S-10）、承認者が承認・却下する（S-11）ことで、通常のチャンネルを作れるようにする。申請者本人は、承認・却下の前に申請を取り下げられる。申請・承認・却下の通知（3-4 AC-1・AC-2・AC-3）を、通知の土台（[notifications.md](notifications.md)）の最初の利用として出す。コードは書き写さず、ファイル名・関数名で指す。

## 範囲

| 区分 | 内容 |
| --- | --- |
| このIssueで作ったもの | `channel_creation_requests`テーブルと索引（migration 0015）／EP-2-07〜EP-2-11と、取り下げ（EP-2-41）／名前の規則の定義元（`shared/channel-name-rules.ts`）／通知の種類3つ／監査操作4つ／セッションの`permissions`への`perm.channel.request.approve.owner`／S-10・S-11／管理メニュー「承認＞チャンネル承認」／S-09の「チャンネルを申請」リンク |
| 作らないもの | 申請の編集（取り下げて申請し直す）、取り下げの通知、レート制限（X-8が未決定のため。#200・#124と同じ扱い）、第2段階の部署範囲のロールによる承認（2-2 AC-9。#159）、`channel_approvals`テーブルと`channels.status = pending`（下の「決定」） |
| 本Issueで確定した決定 | [C-167](../requirements/decision-register.md)（申請の持ち方、取り下げの追加、名前の整形、漢字の範囲、審査できない申請の応答、自動参加の監査、セッションの権限） |

## 決定（C-167の要点）

| 判断 | 内容と理由 |
| --- | --- |
| 申請中のチャンネルは申請専用のテーブルに持つ | data-modelの案（`channels`に`status = pending`、`channel_approvals`）は採らない。`channels`に状態の列はなく、一覧・詳細・参加・投稿・サイドバー・部署の自動作成は「行があれば使える」前提で、列を足すと既存クエリのすべてに条件が要り退行の危険が大きいため。チャンネルは承認の時に初めて作る。決裁の履歴は、申請の行の列（`status`・`decided_by`・`decided_at`・`decision_reason`）と監査ログで残す |
| 取り下げを作る | 申請者本人だけが、承認待ちの間に取り下げられる。再認証なし。通知しない。取り下げた申請の名前は、重複の比較から外れる。監査に残す |
| 名前の自動整形（C-121【案】の確定） | 全角英数字・「－」「＿」の半角化と、前後の空白（全角空白を含む）の除去だけ。NFKCは行わない（半角カナ・丸数字・全角記号は変えず、検証で拒否する） |
| 名前に使える漢字 | Unicodeの`Unified_Ideograph`（CJK統合漢字とその拡張。互換漢字の区画にある正式な統合漢字12字を含む）に限る。康熙部首・CJK部首補助・CJK互換漢字・CJK互換漢字補助・「〻」は不可。「々」「〆」は可 |
| 審査できない申請の応答 | 審査者でない人は403。審査者だが範囲外の申請は404（存在を漏らさない）。見えるが自分では決裁できない（オーナー自身の申請）は403。api-draft EP-2-10・11の「任命されていない全体管理者は403」を置き換える |
| 承認の自動参加の監査 | 承認で作るチャンネルへの申請者の自動参加は、承認の監査1件に含める（2-2 AC-14が決裁と一体の処理と定めるため。既定の方針4） |
| セッションの権限 | 部署のオーナーと全体管理者の`GET /api/auth/session`の`permissions`に`perm.channel.request.approve.owner`が載る。管理メニューの表示の制御であり、認可はサーバーが申請ごとに行う |
| `channel_id`は外部キーにしない | 将来の物理削除（2-6 AC-6）を止めないため（C-166 (6)と同じ考え） |
| 再申請 | 取り下げた・却下された名前で、申請し直せる（重複の比較は承認待ちの申請とチャンネルだけに行うため） |
| 決裁済みの行の`canApprove` | 承認待ち以外の行は常に`false` |

## ファイルと役割

### 共有・DB

| ファイル | 役割 |
| --- | --- |
| `shared/channel-name-rules.ts` | 名前・説明・却下理由の規則の**定義元**。定数`CHANNEL_NAME_MAX_LENGTH`（50）・`CHANNEL_DESCRIPTION_MAX_LENGTH`（500）・`REJECT_REASON_MAX_LENGTH`（200）、整形の`formatChannelName`、検証の`channelRequestNameSchema`・`channelRequestDescriptionSchema`・`rejectReasonSchema`。画面とサーバーが同じ定義を参照する（サーバー側の検証は省略しない）。重複判定の比較キーは既存の`channelNameKey`（`shared/department-rules.ts`）を使い、定義を増やさない |
| `shared/notification-kinds.ts` | 通知の種類に`channel_request.submitted`・`channel_request.approved`・`channel_request.rejected`を足した（3種類とも`containsRoomContent: false`） |
| `backend/db/schema.ts` | `channelCreationRequests`を追加（下の「データ」） |
| `backend/db/migrations/0015_add_channel_creation_requests.sql`、`meta/0015_snapshot.json`、`meta/_journal.json` | 新規テーブルと索引のmigration。`drizzle-kit generate`の生成物（新規テーブルのため作り直しは起きない） |

### バックエンド

| ファイル | 役割 |
| --- | --- |
| `backend/src/lib/channel-request-rules.ts` | 純粋関数。`canDecideChannelRequest`（承認・却下できるか）、`isReviewable`（審査一覧に出るか）、`channelRequestReviewerIds`（申請が届いたときの通知の宛先）。DB・HTTPを知らない |
| `backend/src/db/channel-request.repository.ts` | `createChannelRequestRepository`の`create`・`listMine`・`listReviewable`・`findForDecision`・`approve`・`reject`・`withdraw`・`findUserDepartmentId`・`readReviewerCandidates`。1操作＝1回の`db.batch`。前提の確認文と、DBエラーの専用エラー（`ChannelRequestConflictError`）への変換。`withChannelRequests`が構成する |
| `backend/src/services/channel-request.service.ts` | `createChannelRequestService`。審査者の門・再認証・申請の範囲・条件の判定を、決まった順に行い、専用エラーを`AppError`（409）に変える。`withChannelRequestService`が構成する |
| `backend/src/services/authorizer.ts` | `reviewerFactsOf`（割り当ての読み込みの結果から、全体管理者か・オーナーである部署の一覧を導く）と、`canReviewChannelRequests`（セッションの`permissions`用）。権限の組み立てを2か所にしないため、`resolvePermissions`と同じ条件にする |
| `backend/src/routes/channel-requests.ts` | `channelRequestRoutes`。入力の形の確認（422）と応答だけを行う。全応答に`noStore`。`/mine`は`/:requestId`より前に定義する。`backend/src/index.ts`が`/api/channel-requests`へ登録する |
| `backend/src/routes/auth.ts` | `GET /api/auth/session`の`permissions`に`perm.channel.request.approve.owner`を足した（`canReviewChannelRequests`の結果） |
| `backend/src/lib/audit-actions.ts` | `channel_request.create`・`.approve`・`.reject`・`.withdraw`を足した |
| `docs/api/openapi.json`、`backend/src/openapi.test.ts` | 6操作のAPI仕様と実routeとの契約確認 |
| `stryker.config.json` | ミューテーションの対象に、名前の規則・純粋関数・Repository・routeと、フロントのapi・schemas・hooks・componentsを足した |

### フロントエンド

依存の向きは、pages → features → 共通。`features/channel-requests/`は`index.ts`だけを公開する（`ChannelRequestForm`・`MyChannelRequestList`・`ChannelRequestReviewList`）。

| ファイル | 役割 |
| --- | --- |
| `frontend/src/features/channel-requests/api/channel-request-api.ts` | `createChannelRequest`・`fetchMyChannelRequests`・`fetchReviewChannelRequests`・`approveChannelRequest`・`rejectChannelRequest`・`withdrawChannelRequest`。`apiClient`だけを使い、応答はZodで検証する |
| `frontend/src/features/channel-requests/api/query-keys.ts` | `channelRequestKeys` |
| `frontend/src/features/channel-requests/hooks/` | `useMyChannelRequests`・`useReviewChannelRequests`（状態ごとに別のキャッシュ、カーソルの無限スクロール）・`useCreateChannelRequest`・`useWithdrawChannelRequest`・`useDecideChannelRequest`（承認・却下。再認証を経て送る。再認証が完了しなければ送らず、`NotSentError`にする） |
| `frontend/src/features/channel-requests/schemas/channel-request-form.ts` | S-10の入力チェック。名前・説明は`shared/channel-name-rules.ts`の定義を使う |
| `frontend/src/features/channel-requests/components/` | `ChannelRequestForm`（S-10の申請フォーム）・`MyChannelRequestList`（自分の申請）・`WithdrawDialog`（取り下げの確認）・`ChannelRequestReviewList`（S-11の審査一覧）・`RejectReasonDialog`（却下の理由） |
| `frontend/src/features/channel-requests/labels.ts`、`describe-error.ts` | 状態・公開範囲の表示名／通信の失敗の文言（`ApiError`のメッセージはそのまま使う） |
| `frontend/src/pages/ChannelRequestPage.tsx`（S-10）・`ChannelApprovalsPage.tsx`（S-11） | 画面の構成だけ。APIや状態は持たない |
| `frontend/src/App.tsx` | レイアウトルートの子に`/channel-requests`と`/channel-approvals`を足した。後者は`ChannelApprovalsRoute`で、`perm.channel.request.approve.owner`がなければ「ページが見つかりません」にする（セッション確認中は拒否せず待つ。表示の制御であり、認可はサーバー） |
| `frontend/src/pages/ChannelsPage.tsx`（S-09） | 「チャンネルを申請」リンク（`/channel-requests`）を足した |
| `frontend/src/features/app-shell/navigation.ts` | 管理メニュー「承認」のまとまりに「チャンネル承認」（`/channel-approvals`、`requires`は`perm.channel.request.approve.owner`）を足した（[app-shell.md](app-shell.md)） |
| `frontend/src/features/notifications/notification-views.ts` | 通知3種類の文言と移動先を対応表に足した |
| `frontend/src/features/auth/api/auth-api.ts`、`auth/index.ts` | セッションの`permissions`の列挙値に新しい権限を足し、`useReauth`を公開した（機能間は`index.ts`経由。既定の方針5） |
| `frontend/src/features/profile/index.ts` | `useMyProfile`を公開した（S-10が自分の所属の有無を知るため。既定の方針5） |

## データ（`channel_creation_requests`）

- 列：`id`（ULID）、`department_id`（`departments.id`。nullは会社直属）、`name`（整形後）、`name_normalized`（`channelNameKey`による比較キー）、`description`（既定は空）、`visibility`（public／private）、`requested_by`、`status`（pending／approved／rejected／withdrawn）、`version`（二重決裁の検出用。既定1）、`decided_by`、`decision_reason`（却下のときだけ）、`channel_id`（承認で作ったチャンネルの`room_id`）、`requested_at`、`decided_at`
- CHECK：`visibility`・`status`の値／rejectedなら`decision_reason`あり／approvedなら`channel_id`あり／pending以外なら`decided_at`と`decided_by`あり（取り下げでは`decided_by`に申請者本人を入れる）
- 索引：`name_normalized`の部分一意（`status = 'pending'`のものだけ。承認待ち同士の重複をDBで拒否）／`(requested_by, id)`（自分の申請）／`(status, department_id, id)`（審査一覧）
- 却下・取り下げ・承認済みの名前は、部分一意索引から外れる。承認済みの名前は`channels`側の一意制約で守る

## 処理の流れ

### 部署の決め方

クライアントは部署のIDを送らない。`scope`（`department`または`company`）だけを送り、Serviceが認証済みの利用者の所属（`findUserDepartmentId`）から部署を決める。他部署を指定する手段が構造上ない（2-2 AC-1「他部署は不可」を満たす）。api-draftの入力の`departmentId`の【案】とは形が違う。所属がない利用者の`department`は422（`fields`は`scope`）。

### 申請（POST /api/channel-requests。EP-2-07）

1. `perm.channel.request.create`を会社範囲で認可する
2. 部署を決め、通知の宛先の材料（部署のオーナーと全体管理者）を読む。宛先は`channelRequestReviewerIds`が決める：部署の申請は、申請者がその部署のオーナーなら全体管理者、それ以外はその部署のオーナー。会社直属は全体管理者。申請者本人は除く
3. `create`が1回の`db.batch`で、申請のINSERT → 監査`channel_request.create` → 通知`channel_request.submitted`（`target_id`は申請ID）を確定する
4. 名前の重複は、INSERTの`name_normalized`を「同じキーの`channels`があればNULL、なければキー」にして、NOT NULL違反で失敗させる（アーカイブ済みを含む全チャンネルが対象）。承認待ち同士は部分一意索引のUNIQUE違反。どちらも409`CONFLICT`
5. 申請時には部署の有効性を確かめない。無効な部署の申請は、承認の時点で拒否する（下の承認）

### 審査一覧（GET /api/channel-requests。EP-2-09）

1. 審査者の門（下の「判定の順番」(1)）。審査者でなければ403
2. 見える範囲を、`reviewScopeSql`として**SQLのWHERE**に入れる（取得後に取り除かない。ページ送りの件数が崩れず、範囲外の行が次のページに漏れないため）。範囲は`isReviewable`と同じ意味：会社直属は全体管理者／部署で申請者がそのオーナーなら全体管理者、または「そのオーナーが出した自分の申請」／それ以外はその部署のオーナー。`status`・`departmentId`・`cursor`は範囲の中で効く
3. 申請者がその部署のオーナーか（`requesterOwnsDepartmentSql`）は、一覧・決裁とも同じSQL部品で行ごとに持つ（N+1にしない。有効な利用者のオーナーの割り当て）
4. 各行の`canApprove`は`canDecideChannelRequest`で算出する。承認待ち以外の行は`false`
5. 順は申請IDの降順。`cursor.ts`の`afterCursor`・`toPage`を使う（OFFSETなし）。既定20件

### 自分の申請（GET /api/channel-requests/mine。EP-2-08）

`perm.channel.request.view.own`を認可し、本人の申請だけを申請IDの降順で返す。他人の申請は返さない。応答に申請者の情報は含めない。

### 判定の順番（承認・却下。全APIで固定）

1. **審査者の門**：全体管理者か、いずれかの部署のオーナーか（`reviewerFactsOf`）。申請IDによらない。審査者でなければ403。拒否は`authorize`が記録する
2. **再認証**：5分以内でなければ403`REAUTH_REQUIRED`（`assertRecentReauth`）
3. **見えない申請は404**：存在しない・範囲外（`isReviewable`が偽）。存在を漏らさない。`logger.audit`に記録する
4. **見えるが決裁できない申請は403**：オーナー自身の申請をそのオーナーが決裁しようとした場合。`logger.audit`に記録する
5. **決裁済みは409**：`db.batch`の中で確認する

- Resolverの`perm.channel.request.approve.owner`は候補にすぎない。門を通っても(3)(4)を必ず確かめる
- 判定は決裁時点の割り当てで行う（申請の後にオーナーが交代したら、新しいオーナーが審査する）
- 取り下げは審査者の門を通らない（申請者本人の操作）

### 承認（POST /api/channel-requests/:requestId/approve。EP-2-10）

`approve`が1回の`db.batch`で、次の順に文を並べる。

1. 前提の確認①：申請の`version`を確かめて進める文（`guardPending`）。承認待ちで、読んだ版のままでなければ、`version`をNULLにしてNOT NULL違反で全体を失敗させる。**先頭**に置くので、決裁済みなら部署が無効でも「すでに処理されています」になる
2. 前提の確認②（部署のチャンネルのときだけ。会社直属では入れない）：部署が有効かを確かめる文。値を変えずに、無効ならNULLにして失敗させる。**部署の`version`は上げない**（`bumpVersion`は使わない）
3. `rooms`→`channels`（`purpose = normal`、`created_by`は申請者、名前・説明・公開範囲・部署は申請の値、`name_normalized`は申請の値）→`channel_members`（申請者だけ。ロールの割り当ては増やさない。2-2 AC-14）
4. 申請の更新（approved・`decided_by`・`decided_at`・`channel_id`）
5. 監査`channel_request.approve`（`detail`は作ったチャンネルID・申請ID・部署ID・公開範囲。チャンネルの作成と自動参加はこの1件に含める）
6. 通知`channel_request.approved`（申請者宛て。`room_id`は作ったチャンネル。決裁者が申請者本人なら送らない）

失敗の変換（`translateError`。制約の表と列で見分け、未知のDBエラーは握りつぶさず再送出する）：

| 失敗 | 409のメッセージ |
| --- | --- |
| `channel_creation_requests.version`のNOT NULL違反 | この申請はすでに処理されています |
| `departments.version`のNOT NULL違反 | 部署が無効のため承認できません |
| `channels.name_normalized`のUNIQUE違反（申請の後に同名のチャンネルができた） | 同じ名前のチャンネルがあるため承認できません。却下してください |
| `channel_creation_requests.name_normalized`のUNIQUE違反（申請時） | 同じ名前のチャンネルまたは承認待ちの申請があります。別の名前を入力してください |

名前の重複で承認が失敗しても、何も作られず、申請は承認待ちのまま残る。その後に却下できる。画面はサーバーのメッセージをそのまま表示する。申請者が決裁の前に無効化されていても、承認はできる（無効化の扱いは#128）。

### 却下（POST /api/channel-requests/:requestId/reject。EP-2-11）

本文は`reason`だけ（前後の空白を除いて1〜200文字。空・空白のみ・201文字は422）。`reject`が1回の`db.batch`で、`guardPending`→申請の更新（rejected・理由）→監査`channel_request.reject`（**理由の本文は入れない**）→通知`channel_request.rejected`を確定する。チャンネルは作らない。

### 取り下げ（POST /api/channel-requests/:requestId/withdraw。EP-2-41）

- 申請者本人だけ。本人でない・存在しない申請は404（`logger.audit`に記録。他人の申請の存在を明かさない）。オーナー・全体管理者でも他人の申請は404
- `withdraw`が1回の`db.batch`で、`guardPending`→申請の更新（withdrawn、`decided_by`は本人）→監査`channel_request.withdraw`を確定する。**通知は送らない**。再認証は求めない
- 決裁済み・取り下げ済み・二重の取り下げは409。取り下げた後の承認・却下も409。取り下げた申請と同じ名前で再申請できる。審査一覧の承認待ちから消える

## 名前の規則

- 整形：全角英数字・「－」「＿」を半角にし、前後の空白（全角空白を含む）を除く。途中の全角空白は拒否する
- 長さ：整形後に1〜50文字。**UTF-16の単位**で数える。使っているzodの`max`はサロゲートペアを1文字と数えるため、`max`は使わず`refine`で長さを確かめる（既存の部署名と同じ単位）
- 使える文字：ひらがな（U+3041〜3096）・カタカナ（U+30A1〜30FA）・長音符「ー」・漢字（Unicodeの`Unified_Ideograph`プロパティで判定する。CJK統合漢字とその拡張で、互換漢字の区画にある正式な統合漢字12字（「﨑」など）を含む。手で範囲を列挙しない。互換漢字・互換漢字補助・康熙部首・CJK部首補助・「〻」は含めない）・「々」「〆」・半角英数字・「-」「_」。空白・記号（`[ ]`を含む）・制御文字・半角カナは使えない
- 説明は500文字まで（任意）。却下理由は前後の空白を除いて1〜200文字

## 通知

| 種類 | 宛先 | 対象ID／部屋 | 文言 | 移動先 |
| --- | --- | --- | --- | --- |
| `channel_request.submitted` | 部署：申請者がその部署のオーナーなら全体管理者、それ以外はその部署のオーナー。会社直属：全体管理者。申請者本人は除く | 申請ID／なし | チャンネルの作成の申請が届きました | `/channel-approvals` |
| `channel_request.approved` | 申請者（決裁者本人なら送らない） | 申請ID／作ったチャンネルの`room_id` | チャンネルの作成の申請が承認されました | `/channels/{roomId}` |
| `channel_request.rejected` | 申請者（同上） | 申請ID／なし | チャンネルの作成の申請が却下されました | `/channel-requests` |

- 通知は業務の`db.batch`に入れる（`notificationInserts`。[notifications.md](notifications.md)）。宛先の選定はこのIssueで決めてテストした
- 理由は通知に持たせない（S-10で見る。`reason`列は足していない）。他部署のオーナー・無関係のメンバー・（一般社員の部署申請での）任命されていない全体管理者には送らない
- 取り下げの通知はない

## 監査

| 操作 | 残す内容（`detail`） |
| --- | --- |
| `channel_request.create` | 部署ID・申請ID・公開範囲 |
| `channel_request.approve` | 作ったチャンネルID・申請ID・部署ID・公開範囲（チャンネルの作成と申請者の自動参加を含む。既定の方針4） |
| `channel_request.reject` | 部署ID・申請ID（理由の本文は入れない） |
| `channel_request.withdraw` | 部署ID・申請ID |

いずれも`auditLogInsert`を業務と同じ`db.batch`に入れる。名前・説明・理由の本文は`detail`に入れない。認可の拒否は`authorize`が、404と「オーナー自身の申請」の403は`logger.audit`が記録する。

## 画面

| 画面 | ファイル | 内容 |
| --- | --- | --- |
| S-10 チャンネル作成の申請（`/channel-requests`） | `pages/ChannelRequestPage.tsx`、`features/channel-requests/components/ChannelRequestForm.tsx`・`MyChannelRequestList.tsx` | 入口はS-09の「チャンネルを申請」。フォーム（作る場所：自部署／会社直属、公開範囲、名前、説明）と、AC-12の案内（案件に関する話題は非公開をおすすめする旨と、案件の専用チャンネルは案件の作成が承認されると自動でできる旨。公開も選べる）と、「自分の申請」の一覧。所属がない利用者は「自部署のチャンネル」を選べない（サーバーも422）。自部署名は出さず「自部署のチャンネル」と表記する。422の`fields`は該当の欄に、409は欄の外に出す。却下の理由は文字列として表示する（`dangerouslySetInnerHTML`を使わない）。承認待ちの行に「取り下げ」があり、確認のダイアログ（`WithdrawDialog`）→送信。送信中は押せない |
| S-11 チャンネル作成の承認（`/channel-approvals`） | `pages/ChannelApprovalsPage.tsx`、`features/channel-requests/components/ChannelRequestReviewList.tsx`・`RejectReasonDialog.tsx` | 状態の絞り込み（初期は承認待ち）、一覧（名前・部署か会社直属・公開範囲・申請者の表示名・状態・却下の理由）、`canApprove`のときだけ「承認」「却下」。承認は再認証を経て送る。却下は再認証→理由のダイアログ（1〜200文字。空・201文字では確定できない）→送信。409はサーバーのメッセージ（決裁済み・名前の重複・部署が無効）を表示し、一覧を取り直す。読み込み中・エラー・0件・ありの4状態 |
| 管理メニュー | `features/app-shell/navigation.ts` | 「承認＞チャンネル承認」。`perm.channel.request.approve.owner`を持つ人にだけ出す（[app-shell.md](app-shell.md)） |

- 取り直し（invalidate）：申請・取り下げは`channelRequestKeys.all`。承認は`channelRequestKeys.all`と`channelKeys.all`（申請者が自分で承認したとき、参加中のチャンネルが変わるため。既定の方針6）

## API契約

| 操作 | 契約 |
| --- | --- |
| 申請（EP-2-07） | `POST /api/channel-requests`。本文は`scope`・`name`・`description?`・`visibility`（`strict`）。201で申請の項目（`id`・`departmentId`・`name`・`visibility`・`status`・`rejectReason`・`createdAt`・`decidedAt`・`channelId`）。401／403（`FORBIDDEN_ORIGIN`）／409／422 |
| 自分の申請（EP-2-08） | `GET /api/channel-requests/mine`。クエリは`limit`・`cursor`。200で`items`（上と同じ項目）と`nextCursor`。401／422 |
| 審査一覧（EP-2-09） | `GET /api/channel-requests`。クエリは`status?`・`departmentId?`・`limit`・`cursor`。200で上の項目に`requesterId`・`requesterDisplayName`・`canApprove`を足した`items`と`nextCursor`。401／403（審査者でない）／422 |
| 承認（EP-2-10） | `POST /api/channel-requests/{requestId}/approve`。200で`requestId`・`status`（approved）・`channelId`・`roomId`。401／403（審査者でない・オーナー自身の申請・`FORBIDDEN_ORIGIN`・`REAUTH_REQUIRED`）／404／409 |
| 却下（EP-2-11） | `POST /api/channel-requests/{requestId}/reject`。本文は`reason`。200で`requestId`・`status`（rejected）・`reason`。401／403／404／409／422 |
| 取り下げ（EP-2-41） | `POST /api/channel-requests/{requestId}/withdraw`。200で`requestId`・`status`（withdrawn）。401／403（`FORBIDDEN_ORIGIN`）／404／409 |

応答の最終の形はOpenAPI（`docs/api/openapi.json`）に従う。`requestId`はULIDでなければ422。レート制限は入れていない。

## 主な入出力

| 処理 | 入力 | 出力 |
| --- | --- | --- |
| `formatChannelName(raw)` | 入力された名前 | 全角英数字などを半角にし、前後の空白を除いた名前 |
| `canDecideChannelRequest(input)` | `departmentId`・`requesterId`・`actorId`・`actorIsAdmin`・`actorOwnsDepartment`・`requesterOwnsDepartment` | 承認・却下できるか |
| `isReviewable(input)` | 同上 | 審査一覧に出るか |
| `channelRequestReviewerIds(input)` | `departmentId`・`requesterId`・`ownerId`・`adminId` | 申請が届いたときの通知の宛先（0件または1件） |
| `reviewerFactsOf(found)` | 割り当ての読み込みの結果 | `isAdmin`と`ownedDepartmentIds`（無効な利用者・存在しない利用者は何も持たない） |
| `canReviewChannelRequests(env, userId)` | 環境、利用者ID | 全体管理者か、いずれかの部署のオーナーか |
| `createChannelRequestService()`の各メソッド | 操作者（利用者ID・追跡ID・最終の再認証の時刻）、必要な引数 | 申請の項目／ページ／承認の結果（`channelId`・`roomId`）など |
| Repositoryの`approve`・`reject`・`withdraw` | `findForDecision`が読んだ申請、書き込みの情報（操作者・追跡ID） | 承認は作った`channelId`・`roomId`。失敗は`ChannelRequestConflictError`（`reason`で見分ける） |

## 個人情報・権限

- 部署と申請者は、認証済みの情報から取る。クライアントの値を受けない
- 審査一覧は、申請者の表示名とIDだけを返す。メール・本名は返さない
- 画面で隠すこと（メニュー・ボタン）を認可の代わりにしない。サーバーが申請ごとに毎回認可する
- CSRF対策は`/api/*`共通の`originCheck`。承認・却下は再認証が必要

## 既知の差・未実施・未決定として記録するもの

| 項目 | 状態 |
| --- | --- |
| オーナー交代と同時に前のオーナーが承認する場合 | **既知の差**。承認者の判定（読み取り）と書き込み（`db.batch`）の間に交代が割り込むと、前のオーナーの承認が通りうる。間は1回の要求の処理中（数ミリ〜数十ミリ秒程度。実測はしていない）。防ぐなら、`db.batch`に「今もオーナーである」確認の文を足す。要件（2-2）はデータの整合としては求めていないため、足していない（既定の方針7） |
| 部署名の自動チャンネル名との重複 | **既知の差**。部署の専用チャンネルの名前は整形しないまま比較キーにするため、部署名「Ｓａｌｅｓ」（全角）と申請「Sales」は重複にならない。部署名の整形を扱うIssueに引き継ぐ |
| 本番のD1へのmigration 0015の適用 | 未実施（利用者の承認が別途必要） |
| 共通化 | 承認・却下・再認証を経る送信の処理は、他の機能と似ている。共通化は#231で扱う |
| レート制限 | 入れていない（上限がX-8で未決定） |
| 2-2 AC-9（部署範囲のロールによる承認） | 第2段階の想定。#159で扱う。APIを持たない |
| 申請の編集 | 作らない（取り下げて申請し直す） |
| 通知の文言 | 案。3-4 AC-4・AC-5の文言とは別に、本Issueで決めた |

## テストの場所

- 共有・純粋関数：`backend/src/lib/channel-name-rules.test.ts`（整形・長さ・文字の種類・漢字の範囲）、`backend/src/lib/channel-request-rules.test.ts`（認可の表・通知の宛先）、`backend/src/lib/notification-kinds.channel-request.test.ts`（種類の定義）、`backend/src/services/authorizer.reviewer-facts.test.ts`（`reviewerFactsOf`が`resolvePermissions`と一致すること）
- route・DB結合（隔離したD1）：`backend/src/routes/channel-requests.test.ts`（申請・名前の規則と重複・監査と通知・自分の申請・取り下げ・401とOrigin）、`channel-requests.decide.test.ts`（承認できる人の表・判定の順番・承認の結果・承認時の名前の重複・batchの原子性・却下・決裁の通知）、`channel-requests.review-list.test.ts`（主体ごとの見える範囲・`canApprove`・絞り込み・ページ送り）。API仕様との契約：`backend/src/openapi.test.ts`
- テスト部品：`backend/test/channel-request-fixtures.ts`、`frontend/src/test/channel-request-handlers.tsx`（MSW）
- フロントエンド：`frontend/src/pages/ChannelRequestPage.test.tsx`・`ChannelApprovalsPage.test.tsx`・`ChannelRequestRoutes.test.tsx`、`frontend/src/features/app-shell/navigation.channel-approvals.test.tsx`、`frontend/src/features/notifications/notification-views.channel-request.test.ts`
- 期待を変えた既存テスト：`backend/src/routes/auth.test.ts`の2件（セッションの`permissions`にオーナーも新しい権限を持つようになったため。決定の置き換えとして、PR本文に列挙した）
- E2E：`e2e/channel-requests.spec.ts`。シードは`e2e/seeds/channel-requests.sql`と`channel-requests-cleanup.sql`（[e2e.md](../testing/e2e.md)）

## 関係するIssue・ADR

- Issue #131：本Issue。親Issue #111。通知の土台は#124（[notifications.md](notifications.md)）。共通化は#231、2-2 AC-9は#159
- [ADR-0006](../adr/0006-id-cursor-unread.md)：IDとカーソル／[ADR-0012](../adr/0012-zero-trust-principle.md)：サーバー側で毎回認可する／[ADR-0020](../adr/0020-test-scope-mutation-e2e.md)：ミューテーション・E2Eの実行範囲
- 要件：2-2 AC-1〜AC-15、3-4 AC-1〜AC-3、S-09〜S-11。決定記録[C-167](../requirements/decision-register.md)
- 関連する設計：[department-management.md](department-management.md)（`rooms`・`channels`・`channel_members`の約束と、`db.batch`の前提確認の書き方）、[channels.md](channels.md)、[auth-session.md](auth-session.md)
