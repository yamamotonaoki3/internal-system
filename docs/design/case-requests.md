# 案件の作成の申請と承認（Issue #146 の 146-A・146-B）

## 目的

社員が案件の作成を申請し（S-18）、自分の申請を見て、審査中の間は取り下げ、却下・取り下げ済みの申請は修正して再申請できるようにする。申請が届いたときの通知（3-4 AC-1）を、通知の土台（[notifications.md](notifications.md)）で出す。申請者の無効化・部署異動のときの自動取消（5-3 AC-8）も、146-Aで足した。146-Bで、審査者が申請を審査して承認・却下し（S-29）、承認で案件・案件番号・案件専用チャンネル・参加者を作る。コードは書き写さず、ファイル名・関数名で指す。

Issue #146 は2つの子に分けた。**この設計書は、146-A（申請・自分の申請・取り下げ・類似件名の確認・自動取消）と、146-B（審査一覧・承認・却下、採番、専用チャンネル、自動参加）の両方の範囲**で、146-Bの分は「146-Bの設計」の節（と各表の「146-B」の行）にまとめた。同じ「申請 → 審査」の型として、[channel-requests.md](channel-requests.md)（チャンネルの作成申請）を参考にしている。

## 範囲

| 区分 | 内容 |
| --- | --- |
| 146-Aで作ったもの | 表3つ（`case_creation_requests`・`case_creation_request_departments`・`case_creation_request_candidates`。migration 0024）／申請・自分の申請・取り下げ・類似件名の確認のAPI4つ／件名・説明・納期の規則の定義元`shared/case-rules.ts`／通知の種類`case_request.submitted`／監査操作2つ／S-18（申請フォームと自分の申請）／メニュー「案件の申請」／説明欄の下書き／申請者の無効化・部署異動による自動取消（`account.repository.ts`） |
| 146-Bで作ったもの | 表3つ（`cases`・`case_departments`・`case_number_sequences`。migration 0026）／審査一覧・承認・却下のAPI3つ（EP-5-03〜05）／審査者の判定（`canDecideCaseRequest`・`isCaseRequestReviewable`）／案件番号の採番と案件専用チャンネル・参加者の自動参加（承認の1回の`db.batch`）／通知の種類`case_request.approved`・`case_request.rejected`／監査操作2つ／S-29（案件承認）とメニュー「承認＞案件承認」／自分の申請（S-18）の承認済みの行に案件番号／類似件名の比較に案件を足したこと／チャンネル一覧から案件専用チャンネルを除いたこと／セッションの権限`perm.case.request.approve` |
| 作らないもの | 申請の編集（取り下げて再申請する）、取り下げ・自動取消の通知、レート制限（X-8が未決定のため）、S-18の「キャンセル → 元の画面」・自動で参加する旨の案内・離れる前の確認（S-16がまだない、文言が未決定、#245）、案件の一覧・詳細（#147）、担当部署の付け替えの通知（#154）、案件の終了・再開・再編集（#150）、案件専用チャンネルでのやり取りと招待の409（#148・#135）、オーナー交代・全体管理者の任命による既存の案件への自動参加（C-133(4)・C-134(3)。#147か役割のIssue）、案件番号の検索（#155）、却下の理由のダイアログのチャンネル申請との共通化（後のIssue） |
| 本Issueで確定した決定 | [C-178](../requirements/decision-register.md)（146-Aの分と、146-Bに引き継いだ決定）、[C-179](../requirements/decision-register.md)（146-Bで確定した決定） |

## ファイルと役割

### 共有・DB

| ファイル | 役割 |
| --- | --- |
| `shared/case-rules.ts` | 件名・説明・納期の規則の**定義元**。定数`CASE_TITLE_MAX_LENGTH`（100）・`CASE_DESCRIPTION_MAX_LENGTH`（2000）、件名の整形`formatCaseTitle`、検証の`caseTitleSchema`・`caseDescriptionSchema`・`caseDueDateSchema`、日本時間の日付`jstDateOf`、納期が今日より前かの`isDueDateBeforeToday`。画面とサーバーが同じ定義を参照する（サーバー側の検証は省略しない）。`yymmdd`は146-Bの採番（承認のrepository）が使う。却下理由の規則は`shared/case-rules.ts`に足さず、却下のrouteと画面が`shared/channel-name-rules.ts`の`rejectReasonSchema`を参照する（C-91と同じ規則） |
| `shared/notification-kinds.ts` | 通知の種類に`case_request.submitted`を足した（`containsRoomContent: false`） |
| 〃（146-B） | 通知の種類に`case_request.approved`・`case_request.rejected`を足した（どちらも`containsRoomContent: false`） |
| `backend/db/schema.ts` | `caseCreationRequests`・`caseCreationRequestDepartments`・`caseCreationRequestCandidates`を追加（下の「データ」） |
| `backend/db/migrations/0024_add_case_creation_requests.sql`、`meta/0024_snapshot.json`、`meta/_journal.json` | 新規テーブル3つと索引のmigration。`drizzle-kit generate`の生成物 |
| `backend/db/schema.ts`・`backend/db/migrations/0026_add_cases.sql`、`meta/0026_snapshot.json`、`meta/_journal.json`（146-B） | `cases`・`case_departments`・`case_number_sequences`の3表と索引のmigration（下の「146-Bの設計」の「データ」）。`drizzle-kit generate`の生成物。0026は、`main`の取り込みのときに番号を振り直した（取り込む側が合わせる取り決め） |
| `backend/db/seeds/cleanup.sql` | 手元の確認用の後始末に、新しい3つの表を外部キーの順で足した（候補 → 申請の部署 → 申請。再申請の自己参照を先に外す）。残数の確認にも足した |
| 〃（146-B） | 案件と案件専用チャンネルの後始末を足した（既読位置 → 通知 → メッセージ → 参加者 → 案件の部署 → 案件の順。案件専用チャンネル・部屋は案件からしか辿れないため、`defer_foreign_keys`の範囲で部屋・チャンネルを案件より先に消す。連番は、テストの取引先のものだけ）。残数の確認に、案件・案件の部署の孤児・案件専用チャンネルの孤児・連番を足した |

### バックエンド

| ファイル | 役割 |
| --- | --- |
| `backend/src/lib/case-request-rules.ts` | 純粋関数`caseRequestSubmittedRecipients`（申請が届いたときの通知の宛先）。146-Bで、審査者の判定`isCaseRequestReviewable`（範囲に入るか）・`canDecideCaseRequest`（承認・却下できるか）と、その入力型`CaseDecisionInput`を足した。DB・HTTPを知らない |
| `backend/src/db/case-request.repository.ts` | `createCaseRequestRepository`の`create`・`listMine`・`findOwnItem`・`findOwnForWithdraw`・`withdraw`・`hasSimilarTitle`・`findOwnResubmittable`・`findUserDepartmentId`・`readSubmittedRecipientCandidates`。1操作＝1回の`db.batch`。前提の確認文（`CASE WHEN … ELSE NULL`）と、DBエラーの専用エラー（`CaseRequestWriteError`）への変換（`translateError`）、取り下げの`guardPending`。`withCaseRequests`が構成する |
| 〃（146-B） | `listReviewable`（審査一覧）・`findForDecision`・`countActiveUsers`・`approve`・`reject`を足した。範囲は`reviewScopeSql`、類似件名（自分自身を除く）は`similarToOthersSql`、決裁者の資格の確認文は`reviewerGuard`、`guardPending`は決裁にも使う。`translateError`は、操作ごとの対応表（作成・取り下げ・承認・却下）で、制約の種類（NOT NULL・UNIQUE・CHECK）と表・列から専用エラーの`reason`を決める。`hasSimilarTitle`に案件との比較を足した。自分の申請の項目に`caseNumber`を足した |
| `backend/src/services/case-request.service.ts` | `createCaseRequestService`の`create`・`listMine`・`withdraw`・`checkSimilarTitle`。権限・所属・整形後の長さ・納期・再申請の元の判定を決まった順に行い、専用エラーを`AppError`に変える。`withCaseRequestService`が構成する |
| 〃（146-B） | `listForReview`・`approve`・`reject`を足した。審査者の門（`requireReviewer`）→ 範囲外・存在しないは404 → 自分の申請は403 → 足す候補の確認（422）→ batchの中で409、の順（`loadDecidable`が前半）。batchの中の409の文言を1つの表（`CONFLICT_MESSAGE_OF`）にまとめ、画面がそのまま出す。`CASE_REQUEST_STATUSES`をrouteに再公開する |
| `backend/src/routes/case-requests.ts` | `caseRequestRoutes`。入力の形の確認（422、`strict`）と応答だけを行う。全応答に`noStore`。`/mine`と`/similar-title`は`/:requestId/withdraw`より前に定義する。`backend/src/index.ts`が`/api/case-requests`へ登録する |
| 〃（146-B） | `GET /`（審査一覧）・`POST /:requestId/approve`・`POST /:requestId/reject`を足した。審査一覧のクエリは`status?`・`limit`・`cursor`、承認の本文は`additionalCandidateIds?`、却下の本文は`reason`（`rejectReasonSchema`）。すべて`strict`・`noStore` |
| `backend/src/db/account.repository.ts` | 申請者の無効化・部署異動の`db.batch`に、審査中の申請の自動取消を足した（`readPendingCaseRequests`・`caseRequestsUnchangedSql`・`autoCancelCaseRequests`・`cancelledCountOf`）。無効化と異動で同じ知識を1か所にまとめる。詳細は[accounts.md](accounts.md) |
| `backend/src/routes/auth.ts`（146-B） | セッションの`permissions`に`perm.case.request.approve`を足した。チャンネルの作成申請の審査と同じ判定の結果（全体管理者か、いずれかの部署のオーナー）を共用する（C-179(9)） |
| `backend/src/db/channel.repository.ts`（146-B） | `list`の条件に、案件専用チャンネル（`purpose = 'case'`）を除くことを足した。参加者にも一覧に出さない（5-1 AC-6。案件の画面から開く）。詳細は[channels.md](channels.md) |
| `backend/src/lib/audit-actions.ts` | `case_request.create`・`case_request.withdraw`を足した。146-Bで`case_request.approve`・`case_request.reject`を足した |
| `docs/api/openapi.json`、`backend/src/openapi.test.ts` | 4操作（146-Bで3操作を足して7操作）のAPI仕様と実routeとの契約確認 |
| `stryker.config.json` | ミューテーションの対象に、`shared/case-rules.ts`・`case-request-rules.ts`・`case-request.repository.ts`・`routes/case-requests.ts`と、フロントのapi・schemas・hooks・componentsを足した（[mutation.md](../testing/mutation.md)） |

146-Aでは、`services/authorizer.ts`・`channel.repository.ts`・`shared/channel-name-rules.ts`・`routes/auth.ts`は変えていない。146-Bで変えたのは`channel.repository.ts`と`routes/auth.ts`だけ（`services/authorizer.ts`・`shared/channel-name-rules.ts`は変えていない）。全体管理者かどうかは、既存の`reviewerFactsOf`で読む。

### フロントエンド

依存の向きは、pages → features → 共通。`features/case-requests/`は`index.ts`だけを公開する（`CaseRequestWorkspace`・146-Bで足した`CaseRequestReviewList`）。

| ファイル | 役割 |
| --- | --- |
| `frontend/src/features/case-requests/api/case-request-api.ts` | `createCaseRequest`・`fetchMyCaseRequests`・`withdrawCaseRequest`・`checkSimilarTitle`と、欄の候補を読む`fetchClientChoices`・`fetchDepartmentChoices`・`searchCandidateUsers`。`apiClient`だけを使い、応答はZodで検証する |
| 〃（146-B） | `fetchReviewCaseRequests`（審査一覧）・`approveCaseRequest`・`rejectCaseRequest`と、審査一覧の項目の型`CaseRequestReviewItem`、状態の一覧`CASE_REQUEST_STATUSES`を足した。審査一覧の項目は、自分の申請の項目から`caseNumber`を除き、候補の`isActive`・`requesterId`・`requesterDisplayName`・`hasSimilarTitle`・`canApprove`を足した形。自分の申請の項目には`caseNumber`を足した。応答はZodで検証する |
| `frontend/src/features/case-requests/api/query-keys.ts` | `caseRequestKeys`（申請・取り下げの後に`all`を取り直す）と、欄の候補用の`caseRequestChoiceKeys` |
| `frontend/src/features/case-requests/hooks/` | `useMyCaseRequests`（カーソルの無限スクロール）・`useCreateCaseRequest`・`useWithdrawCaseRequest`・`useSimilarTitle`・`useCaseRequestChoices`（取引先・部署・社員の検索）・`useSettledValue`（入力が止まってから値を返す） |
| 〃（146-B） | `useReviewCaseRequests`（状態で絞る審査一覧。カーソルの無限スクロール。キーは`caseRequestKeys.review`）・`useDecideCaseRequest`（承認・却下。成功しても失敗しても`caseRequestKeys.all`を取り直す。再認証は挟まない） |
| `frontend/src/features/case-requests/schemas/case-request-form.ts` | S-18の入力チェック。件名・説明・納期は`shared/case-rules.ts`の定義を使う。件名は整形した値を送らない（整形で値が変わったかをサーバーが返すため） |
| `frontend/src/features/case-requests/components/` | `CaseRequestWorkspace`（フォームと自分の申請をまとめ、下書きを1つだけ開く。「修正して再申請」でフォームを作り直す）・`CaseRequestForm`（申請フォーム）・`CandidatePicker`（追加の候補の検索と選択）・`MyCaseRequestList`（自分の申請）・`WithdrawDialog`（取り下げの確認） |
| 〃（146-B） | `CaseRequestReviewList`（S-29の一覧。状態の絞り込み・4状態・承認のダイアログ`ApproveDialog`（同じファイルの中）・409の表示）・`RejectReasonDialog`（却下の理由。チャンネルの作成申請のダイアログとは共通化しない） |
| `frontend/src/features/case-requests/components/MyCaseRequestList.tsx`（146-B） | 承認済みの行に案件番号を出す（`caseNumber`） |
| `frontend/src/features/case-requests/labels.ts`、`describe-error.ts` | 状態の表示名（5つ。`auto_cancelled`は「自動取消」）／通信の失敗の文言 |
| `frontend/src/pages/CaseRequestPage.tsx` | S-18の構成だけ。APIや状態は持たない |
| `frontend/src/pages/CaseApprovalsPage.tsx`（146-B） | S-29の構成だけ（見出し「案件作成の承認」と`CaseRequestReviewList`）。APIや状態は持たない |
| `frontend/src/App.tsx` | レイアウトルートの子に`/case-requests`を足した。146-Bで`/case-approvals`を足した（`CaseApprovalsRoute`。セッションに`perm.case.request.approve`がなければ「ページが見つかりません」。セッション確認中は拒否せず待つ。表示の制御で、認可はサーバーが申請ごとに行う） |
| `frontend/src/features/app-shell/navigation.ts` | メニューに「案件の申請」を全員に出す項目として足した。146-Bで、管理のメニューの「承認」の下に「案件承認」（`/case-approvals`。`perm.case.request.approve`がある人だけ）を足した（[app-shell.md](app-shell.md)） |
| `frontend/src/features/notifications/notification-views.ts` | `case_request.submitted`の文言と移動先を足した。146-Bで、`submitted`の移動先を`/case-approvals`に変え、`approved`・`rejected`の文言と移動先（どちらも`/case-requests`）を足した |
| `frontend/src/features/drafts/draft-policy.ts`・`index.ts` | 下書きの`scope`として`caseRequestDraftScope`を足して公開した（[drafts.md](drafts.md)） |
| `frontend/src/features/auth/api/auth-api.ts`（146-B） | セッションの権限の列挙に`perm.case.request.approve`を足した |

## データ

- `case_creation_requests`：`id`（ULID）、`client_id`（NOT NULL）、`title`（整形後）、`description`（既定は空）、`due_date`（YYYY-MM-DD。NULL可）、`requested_by`、`status`（既定`pending`）、`version`（既定1。二重の操作の検出用）、`decided_by`、`decision_reason`、`case_id`、`resubmitted_from`（自己参照。再申請の元）、`requested_at`、`decided_at`
- CHECK：`status`は`pending`・`approved`・`rejected`・`withdrawn`・`auto_cancelled`の5つ／`rejected`なら`decision_reason`あり／`approved`なら`case_id`あり／`pending`以外なら`decided_at`と`decided_by`あり／`due_date`はNULLか数字4桁-2桁-2桁の形
- 索引：`(requested_by, id)`（自分の申請）・`(status, id)`・`(client_id, title)`（類似件名の比較）
- `case_id`は外部キーにしない（将来の物理削除を止めないため。`channel_creation_requests.channel_id`と同じ考え）。`approved`・`rejected`・`case_id`は146-Bが使うので、CHECKの作り直しを避けるため146-Aで先に入れた。`auto_cancelled`は、本人による「取り下げ」と区別するための状態
- `case_creation_request_departments`：`(request_id, department_id)`が主キー。`department_id`に索引。担当部署は複数持てる（上限なし。最低1つ）
- `case_creation_request_candidates`：`(request_id, user_id)`が主キー。`added_by`（申請時は申請者）・`added_at`
- 案件の参加者の持ち方は、`channel_members`を正とする方針（利用者の決定。C-178）。`case_participants`表は作らない。146-Bで、この方針どおりに実装した（下の「146-Bの設計」）

## 処理の流れ

### 申請（POST /api/case-requests。EP-5-01）

判定の順（Serviceの`create`。変えない）：

1. `perm.case.request.create`を会社の範囲で認可する（拒否は`authorize`が記録する）
2. 全体管理者でなく、所属部署もなければ403「所属部署がないため申請できません」（`logger.audit`に記録）
3. 入力の形の検査（routeで422）
4. 整形後の件名が1〜100文字か。納期が今日（日本時間）より前なら422（`fields`は`dueDate`。再申請でも同じ）。候補に申請者本人を含めると422
5. `resubmitOf`は、本人の`rejected`・`withdrawn`・`auto_cancelled`の申請でなければ422（`fields`は`resubmitOf`。C-178）。他人の申請・存在しない・審査中・承認済みを区別せず、同じ422・同じ本文にする（存在を明かさない）
6. 類似件名の有無（書き込みの前に読む。後では自分の申請が一致するため）と、通知の宛先の材料（担当部署の有効なオーナーと有効な全体管理者）を読み、宛先を`caseRequestSubmittedRecipients`で決める
7. `create`が1回の`db.batch`で確定する（次の節）

- 担当部署は、誰でも全部署から選べる（C-132）。部署の範囲で403にしない
- 応答は、自分の申請の項目に`titleFormatted`（整形で値が変わったか）と`hasSimilarTitle`を足したもの

### batchの中で確かめる前提と、崩れたときの応答

最初の判定で確かめたDBの状態は、batchの中でも確かめ直す（判定と書き込みの間に状態が変わっても、不整合を残さない）。崩れたら、NOT NULL違反でbatch全体を取り消し、何も残さない。`translateError`が、制約の表と列で見分けて専用エラーにし、Serviceが`AppError`にする。未知のDBエラーは握りつぶさず再送出する。

| 前提 | batchの中の確かめ方 | 崩れたときの応答 |
| --- | --- | --- |
| 取引先が存在して有効 | 申請のINSERTの`client_id`を、有効な取引先があればその値、なければNULLにする | 422（`fields`は`clientId`） |
| 申請者の資格（有効で、所属があるか、現在の全体管理者） | 同じINSERTの`requested_by`を、資格があればその値、なければNULLにする | 403「申請できません」（`logger.audit`に記録） |
| 担当部署が存在して有効 | 部署のINSERT…SELECT（`json_each`の1文）で、有効ならその値、なければNULLにする | 422（`fields`は`departmentIds`） |
| 候補が存在して有効 | 候補のINSERT…SELECT（同上）で、有効な社員ならその値、なければNULLにする | 422（`fields`は`candidateIds`） |
| 再申請の元が本人の`rejected`・`withdrawn`・`auto_cancelled`（`RESUBMITTABLE_STATUSES`） | `resubmitted_from`を、使える元ならその値、なければNULLにし、NULLなら件名をNULLにして失敗させる確認文を置く | 422（`fields`は`resubmitOf`） |
| 通知の宛先が読んだときと同じ | 通知の前に、いまの割り当てから求めた宛先の集合が読んだ集合と同じかを確かめ、違えば申請の`version`をNULLにする | 409「審査する人が変わりました。もう一度申請してください」 |

- 部署・候補は`json_each`の1文で入れるので、件数が増えても文の数と束縛する値の数は増えない（件数の上限を設けない）
- 通知のIDはアプリで作る（`notificationInserts`）ため、宛先をSQLだけで確定せず、「読んだ宛先と同じか」の確認文で守る。これで、オーナーの交代・無効化・全体管理者への切り替えが読んだ後に起きても、古い宛先に通知が届かず、申請も残らない
- batchの文の順：申請 → （再申請のとき）元の確認 → 担当部署 → 候補 → 宛先の確認 → 監査`case_request.create` → 通知`case_request.submitted`（`target_id`は申請ID）
- 通知の宛先：担当部署の有効なオーナーから申請者本人を除く。その集合が空のときだけ、有効な全体管理者から本人を除く（利用者の決定。C-178）。申請者が担当部署のオーナーだけなら、全体管理者になる

### 自分の申請（GET /api/case-requests/mine。EP-5-02）

`perm.case.request.create`を認可し、本人の申請だけを申請IDの降順で返す（範囲はSQLのWHERE。他人の申請はページを送っても出ない）。部署と候補は、そのページの申請IDを`IN`にした読み込みで取る（N+1にしない）。`cursor.ts`を使う（OFFSETなし、既定20件、最大100件）。取引先・部署は`isActive`を持つので、申請の後に無効になったものは画面で「（無効）」と出せる。

### 取り下げ（POST /api/case-requests/:requestId/withdraw）

1. `perm.case.request.create`を認可する
2. 本人の申請でなければ404「申請が見つかりません」（`logger.audit`に記録）。存在しない申請と他人の申請を区別しない。オーナー・全体管理者でも他人の申請は404
3. `withdraw`が1回の`db.batch`で、`guardPending`（`pending`で読んだ版のままなら`version`を1上げる。崩れたらNOT NULL違反）→ 申請の更新（`withdrawn`、`decided_by`は本人、`decided_at`）→ 監査`case_request.withdraw`を確定する
4. すでに審査中でない・二重の取り下げは409「この申請はすでに処理されています」。UPDATEが0行（本人の申請の行がない）のときは成功にせず404にする
- 通知は送らない。再認証は求めない

### 類似件名の確認（GET /api/case-requests/similar-title）

`perm.case.request.create`を認可し、`hasSimilar`と`formattedTitle`だけを返す。他人の件名・申請者・件数は返さない（真偽だけにして、推測の手がかりを最小にする）。比べる対象は、同じ取引先で整形後の件名が完全一致する**審査中**の申請。却下・取り下げ済み・自動取消・別の取引先は対象外。件名の整形後の長さの誤りは422。警告が出ても申請・承認は止めない。比べる対象に、146-Bで、同じ取引先で件名が完全一致する案件（進行中・終了。`cases`）を足した（5-3 AC-14・C-141(3)）。

### 件名の整形（`formatCaseTitle`）

次の順に行う。かなの変換はしない。決定は[C-178](../requirements/decision-register.md)（C-144と5-3 AC-13の案を採った）。

1. 全角の英数字を半角にする
2. ハイフン類（U+2010〜2015・U+2212・U+FF0D・U+FE63）を「-」にする。長音符「ー」と波ダッシュは変えない
3. 連続する空白（全角空白を含む）を半角の空白1つにする
4. 前後の空白を除く

長さは整形後に1〜100文字で、UTF-16の単位で数える（zodの`max`は使わず`refine`で数える）。説明は2000文字まで。納期は実在する日付で、今日（日本時間）以降。判定はサーバーが`jstDateOf`で行い、画面も同じ関数で事前に確かめる。

### 無効化・異動による自動取消（5-3 AC-8）

申請者の無効化と部署異動の`db.batch`（[accounts.md](accounts.md)）に、その申請者の審査中の申請を`auto_cancelled`にする文を足した。

- `decided_at`は無効化・異動の時刻、`decided_by`は操作した全体管理者。`version`を1上げる
- 全体管理者の申請は取り消さない（要件のとおり、全体管理者の部署変更は対象外）
- 申請ごとの監査・通知は作らない。無効化の監査`account.deactivate`と異動の監査の`detail`に、取り消した件数`cancelledCaseRequestCount`を足した
- 取り消す件数と、対象が全体管理者かは、batchの前に読み、batchの先頭の前提の確認（`caseRequestsUnchangedSql`）でも同じ値かを確かめる。崩れたら、既存の前提が崩れた扱い（読み直し）に入る
- 審査中でなくなった申請（取り下げ済みなど）は対象にならない。取り下げと自動取消が同時に来たときは、先に確定したほうだけが成り立ち、もう片方は審査中でないため成り立たない（取り下げは409）
- 自動取消の通知（申請者への通知）は、後の Issue

### 存在の非開示

- 取り下げ：他人の申請・存在しない申請は同じ404・同じ本文
- 再申請の元：他人・存在しない・審査中・承認済みは同じ422・同じ本文（ID の形の検査は、`requestId`のパスでは行わず、404に合わせる）
- 類似件名の確認：真偽だけ。件数・件名・申請者を返さない
- 一覧：本人の申請だけ（SQLのWHERE）
- 審査（146-B）：審査者でなければ403。審査の範囲外（全体管理者でなく、担当部署のどれのオーナーでもない）の申請と、存在しない申請は、同じ404・同じ本文「申請が見つかりません」（`logger.audit`に記録）。審査一覧の範囲は、SQLのWHEREに入れる（ページを送っても範囲外が出ない）

### 同時の操作

| 組み合わせ | 結果 |
| --- | --- |
| 取り下げ × 取り下げ | 片方が先に確定し、もう片方は`guardPending`で409 |
| 取り下げ × 自動取消 | 先に確定したほうが成り立つ。後の取り下げは409 |
| 申請 × 申請者の無効化・所属の喪失 | 申請のbatchの資格の確認で403。何も残らない |
| 申請 × 担当部署のオーナーの交代・無効化 | 宛先の確認で409。何も残らない |
| 申請 × 取引先・部署・候補の無効化 | それぞれの確認で422。何も残らない |
| 申請 × 申請者の無効化・異動（取り消す件数が変わる） | 無効化・異動のbatchの前提の確認が崩れ、読み直す |
| 承認 × 承認・却下・取り下げ・自動取消（同じ申請） | 先に確定したほうが成り立つ。後の操作は`guardPending`で409「この申請はすでに処理されています」 |
| 承認 × 決裁者の資格の喪失（オーナーの交代・無効化・全体管理者でなくなる） | 決裁者の資格の確認文で403。何も残らない |
| 承認・却下 × 申請者がオーナーになる交代（全体管理者でない申請者が自分の申請を決裁する経路） | 同じ確認文で403。何も残らない |
| 承認 × 担当部署・取引先・候補の無効化 | それぞれの確認で409（部署・取引先・申請の候補）。承認者が足した候補は422。何も残らない |
| 承認 × 承認（同じ取引先・同じ年） | 連番の`UPSERT`が直列に進み、番号は重複せず抜けもない。残りが少ないときは、上限を超える承認が409（`number_exhausted`）で何も作らない。UNIQUEを最後の砦にする |

## 画面

| 画面 | ファイル | 内容 |
| --- | --- | --- |
| S-18 案件の作成の申請（`/case-requests`） | `pages/CaseRequestPage.tsx`、`features/case-requests/components/CaseRequestForm.tsx`・`CandidatePicker.tsx` | 取引先（`/api/clients/candidates`）、件名（欄の近くに注意書き「件名は参加していない人にも見える場合があります。機密情報を書かないでください」）、説明、納期（日付の入力。下限は日本時間の今日）、担当部署（`/api/users/departments`。**checkboxのグループ**で1つ以上）、追加の候補（社員の検索から選ぶ）。欄の名前は「件名」。件名と取引先が入り、入力が止まって400ミリ秒たったら類似件名を確かめ、「似た案件があります」を出す（送信は止めない）。送信の後、`titleFormatted`が真なら「表記を整えて保存しました」を出す。所属がなく全体管理者でもない社員には「所属部署がないため申請できません」を出し、送信させない（サーバーも403。全体管理者かの判定はセッションの権限を使う表示の制御）。422の`fields`は該当の欄に、409・403は欄の外に出す。送信中は押せない |
| 自分の申請 | `MyCaseRequestList.tsx`・`WithdrawDialog.tsx` | 状態（承認待ち・承認済み・却下・取り下げ済み・自動取消）・件名・取引先名（無効なら「（無効）」）・担当部署・納期・却下理由（文字列として出す。HTMLを解釈しない）。承認待ちの行に「取り下げ」（確認のダイアログを経る）。却下・取り下げ済み・自動取消の行に「修正して再申請」（フォームに元の値を入れ、`resubmitOf`を付ける。納期が過去なら欄にエラーを出す）。続きの読み込みは「**次のページ**」のボタン（既存の一覧と同じ）。読み込み中・エラー・0件・ありの4状態 |
| 入口 | `App.tsx`、`features/app-shell/navigation.ts` | メニュー「案件の申請」（全員に出す。案件一覧のS-16が#147でできるまでの仮の入口） |
| S-29 案件作成の承認（`/case-approvals`。146-B） | `pages/CaseApprovalsPage.tsx`、`features/case-requests/components/CaseRequestReviewList.tsx`・`RejectReasonDialog.tsx` | 状態の絞り込み（承認待ち・承認済み・却下・取り下げ・自動取消。初期は承認待ち）。行は件名・状態・「似た案件があります」・取引先（無効なら「（無効）」）・担当部署・納期・申請者・候補・却下の理由（文字列として出す）。`canApprove`が真の行だけに「承認」「却下」を出す。承認は確認のダイアログで、追加の候補を足せる（申請の画面と同じ`CandidatePicker`。足す候補は申請の候補と重なってよく、重複は入れない）。却下は理由（前後の空白を除いて1〜200文字）のダイアログ。どちらも再認証を経ない（`useReauth`を使わない）。成功しても失敗しても確認を閉じ、失敗（409・403・422等）の文言を一覧の上に出して一覧を取り直す（409はサーバーの文言のまま）。続きは「次のページ」のボタン。読み込み中・エラー・0件・ありの4状態。メニューは「承認＞案件承認」（`perm.case.request.approve`がある人だけ）で、権限のない人が`/case-approvals`を開くと「ページが見つかりません」 |
| 通知 | `features/notifications/notification-views.ts` | `case_request.submitted`の文言は「案件の作成の申請が届きました」。146-Bで足した`case_request.approved`は「案件の作成の申請が承認されました」、`case_request.rejected`は「案件の作成の申請が却下されました」で、移動先はどちらも自分の申請（`/case-requests`。案件の画面S-16ができたら、承認のほうを案件の画面に変える）。146-Bで、移動先を`/case-approvals`（S-29）に変えた |

- 取り直し（invalidate）：申請・取り下げの後は`caseRequestKeys.all`
- 申請の画面は、説明欄だけ下書きを端末に保存する（screens S-18「下書き」・C-120・1-1 AC-4）。`features/drafts`の公開の入口から`useDraft(userId, caseRequestDraftScope())`を使い、マウントで復元し、入力のたびに保存する。**件名・取引先・担当部署・候補・納期は保存しない**（C-82・C-117）。送信が成功したら`discard`で消し、失敗したら残す。保存先が使えないとき（`unavailable`）も入力と送信はできる。再申請でフォームに値を入れたときは、元の申請の説明を入れ、それも下書きとして保存する。scopeは`caseRequestDraftScope`（`draft-policy.ts`）が決め、部屋・スレッドのscopeと重ならない
- 自分の申請（S-18）の承認済みの行に、案件番号を出す（`caseNumber`。5-1 AC-18。146-B）
- 146-Aのコードレビューで直した3件（S-18。この設計書への反映は146-Bで行う約束だった。コードは146-Aのマージに含まれている）：(1) 「修正して再申請」で、元の申請の取引先・担当部署が無効になっていたら、初期の選択から外し、「担当部署『…』は無効になったため、選択から外しました」「取引先『…』は無効になったため、選択から外しました」と案内する（選び直してもらう）。(2) 追加の候補の検索（`CandidatePicker`）は、続きを「次のページ」のボタンで読み込む。(3) 類似件名の確認が失敗したら、「類似なし」にせず「類似の件名を確認できませんでした」と出し、「もう一度確認」で取り直せる（送信は止めない）
- 審査の一覧（S-29）と自分の申請の一覧（S-18）のキャッシュのキーに、利用者のIDを含める（`caseRequestKeys.review`・`mine`。キーは`["case-requests", …, 利用者のID, …]`の形）。利用者のIDがセッションで確かめられる前は取得しない。状態の切り替えなどで前のデータを残すのは同じ利用者のときだけで、利用者が替わったときは前の利用者の一覧を見せない（`placeholderData`で判定）。アカウントの切り替え全体の確認は#284（146-Bのレビューの修正）
- 承認・却下が422で、`fields`にダイアログの該当の欄（承認は`additionalCandidateIds`、却下は`reason`）があるときは、ダイアログを閉じず入力も残し、サーバーの文をその欄のエラーとして出す。該当の欄がない失敗は、これまでどおりダイアログを閉じて、一覧の上に出す

## API契約

全応答に`noStore`。変更系は`/api/*`共通の`originCheck`を通る。再認証は求めない。

| 操作 | 契約 |
| --- | --- |
| 申請（EP-5-01） | `POST /api/case-requests`。本文（`strict`）は`clientId`・`title`・`description?`・`dueDate?`・`departmentIds`（1件以上・重複不可・件数の上限なし）・`candidateIds?`（重複不可・申請者本人を含めない・件数の上限なし）・`resubmitOf?`。201で自分の申請の項目に`titleFormatted`と`hasSimilarTitle`を足したもの。401／403（所属なしの一般社員・オーナー、資格の喪失、`FORBIDDEN_ORIGIN`）／409（宛先の変化）／422 |
| 自分の申請（EP-5-02） | `GET /api/case-requests/mine`。クエリは`limit`・`cursor`。200で`items`と`nextCursor`。項目は`id`・`title`・`description`・`dueDate`・`client`（`id`・`code`・`name`・`isActive`）・`departments`（`id`・`name`・`isActive`）・`candidates`（`userId`・`displayName`）・`status`・`rejectReason`・`caseId`・`resubmittedFrom`・`createdAt`・`decidedAt`。146-Bで、承認済みの案件番号`caseNumber`（承認済み以外は`null`）を足した。401／403（権限なし）／422 |
| 取り下げ | `POST /api/case-requests/{requestId}/withdraw`。200で`requestId`・`status`（`withdrawn`）。401／403（`FORBIDDEN_ORIGIN`）／404／409 |
| 類似件名の確認 | `GET /api/case-requests/similar-title`。クエリは`clientId`・`title`。200で`hasSimilar`・`formattedTitle`だけ。401／403／422 |
| 審査一覧（EP-5-03。146-B） | `GET /api/case-requests`。クエリは`status?`・`limit`・`cursor`。200で`items`と`nextCursor`。項目は自分の申請の項目から`caseNumber`を除き、`requesterId`・`requesterDisplayName`・`candidates`（`isActive`つき）・`hasSimilarTitle`（自分自身を除く）・`canApprove`を足したもの。申請IDの降順。401／403（審査者でない）／422 |
| 承認（EP-5-04。146-B） | `POST /api/case-requests/{requestId}/approve`。本文（`strict`）は`additionalCandidateIds?`（重複不可・件数の上限なし。本文自体も省略できる）。200で`requestId`・`status`（`approved`）・`caseId`・`caseNumber`・`roomId`。401／403（審査者でない・自分の申請・決裁者の資格の喪失、`FORBIDDEN_ORIGIN`）／404（存在しない・範囲外）／409／422（`additionalCandidateIds`）。再認証は求めない（`REAUTH_REQUIRED`にならない） |
| 却下（EP-5-05。146-B） | `POST /api/case-requests/{requestId}/reject`。本文（`strict`）は`reason`（`rejectReasonSchema`。前後の空白を除いて1〜200文字）。200で`requestId`・`status`（`rejected`）。401／403／404／409／422。再認証は求めない |

応答の最終の形はOpenAPI（`docs/api/openapi.json`）に従う。レート制限は入れていない。

## 主な入出力

| 処理 | 入力 | 出力 |
| --- | --- | --- |
| `formatCaseTitle(raw)` | 入力された件名 | 全角英数字・ハイフン類・空白を整えた件名 |
| `jstDateOf(now)` | 現在時刻 | 日本時間の`date`（YYYY-MM-DD）・`year`・`yymmdd`（`yymmdd`は146-Bの採番で使う） |
| `isDueDateBeforeToday(dueDate, now)` | 納期・現在時刻 | 日本時間の今日より前か |
| `caseRequestSubmittedRecipients(input)` | `requesterId`・`ownerIds`・`adminIds` | 通知の宛先（申請者を除く。オーナーが空なら全体管理者。重複なし） |
| `isCaseRequestReviewable(input)`・`canDecideCaseRequest(input)`（146-B） | `CaseDecisionInput`（申請の担当部署・申請者・決裁者・決裁者が全体管理者か・決裁者がオーナーである部署） | 審査の範囲に入るか（全体管理者か、担当部署のどれかのオーナー）／承認・却下できるか（範囲に入り、全体管理者でなければ自分の申請でない） |
| `createCaseRequestService()`の各メソッド | 操作者（利用者ID・追跡ID）、必要な引数 | 申請の項目＋`titleFormatted`・`hasSimilarTitle`／ページ／`requestId`と`status`／`hasSimilar`と`formattedTitle` |
| Repositoryの`create`・`withdraw` | 申請の情報（整形済みの件名・読んだ宛先・版・操作者・追跡ID） | `create`は作った申請ID。失敗は`CaseRequestWriteError`（`reason`で見分ける） |
| Repositoryの`approve`・`reject`（146-B） | 申請ID・読んだ版・決裁者・時刻・追跡ID（承認は足す候補のID、却下は理由） | `approve`は案件ID・案件番号・チャンネルID（batchの後に`cases`を`request_id`で読み直す。0行なら成功にしない）。`reject`は戻り値なし。失敗は`CaseRequestWriteError`（`reason`で見分ける） |
| Repositoryの`listReviewable`・`findForDecision`・`countActiveUsers`（146-B） | 審査の範囲（全体管理者か・オーナーの部署）・状態・ページ送り／申請ID／社員のID一覧 | 審査一覧のページ／決裁の判定に使う申請の状態・版・申請者・担当部署（存在しなければ`null`）／存在して有効な社員の数 |
| Serviceの`listForReview`・`approve`・`reject`（146-B） | 操作者、`status`・`limit`・`cursor`／申請IDと足す候補／申請IDと理由 | `canApprove`つきのページ／`requestId`・`status`・`caseId`・`caseNumber`・`roomId`／`requestId`・`status` |

## 監査

| 操作 | 残す内容（`detail`） |
| --- | --- |
| `case_request.create` | 申請ID・取引先ID・部署数・候補数・再申請の元のID |
| `case_request.withdraw` | 申請ID・部署数 |
| `case_request.approve`（146-B） | 申請ID・案件ID・案件番号・チャンネルID・担当部署数・参加者数・自動参加の内訳（担当部署の有効なオーナーの数・有効な全体管理者の数）。案件番号と参加者数は同じbatchの中で決まるため、監査の行を入れた直後に、同じbatchの中で値を入れる |
| `case_request.reject`（146-B） | 申請ID・担当部署数（理由の本文は入れない） |
| 自動取消 | 申請ごとには残さない。`account.deactivate`と異動の監査の`detail`の`cancelledCaseRequestCount`に件数を残す |

いずれも`auditLogInsert`を業務と同じ`db.batch`に入れる。件名・説明・理由の本文・氏名は`detail`に入れない。認可の拒否は`authorize`が、404と業務の403は`logger.audit`が記録する。

## 個人情報・権限

- 申請者は認証済みの情報から取る。クライアントの値を受けない
- 申請・自分の申請・取り下げ・類似件名の確認は、すべて`perm.case.request.create`（R-60）を確かめる。申請できる人が、自分の申請を見て取り下げられる。権限の一覧は足していない
- 画面で隠すこと（メニュー・ボタン）を認可の代わりにしない。サーバーが毎回認可する
- 件名は参加していない人にも見える場合があるため、画面に注意書きを出す（5-3 AC-10）
- 通知は部屋の内容を含まない（`containsRoomContent: false`）。通知に件名・理由を持たせない
- 審査・承認・却下（146-B）は、`perm.case.request.approve`（全体管理者か、いずれかの部署のオーナー）を最初の門にし、そのあと申請ごとに、範囲（担当部署のどれかのオーナー、または全体管理者）と自己承認の禁止（全体管理者を除く）を、決裁の時点の割り当てで判定する。画面のボタンの出し分け（`canApprove`）は表示の制御で、認可の代わりにしない。承認・却下は再認証を求めない（要件0-5・C-81）
- 案件専用チャンネルは、参加者にもチャンネル一覧に出さない（案件の画面から開く）。承認者であることだけでは参加者にならない（担当部署のオーナー・全体管理者であれば、その役割で参加する）

## 146-Bの設計

承認・却下・採番・案件専用チャンネルの作り方をまとめる。決定は[C-178](../requirements/decision-register.md)（利用者の決定U-1・U-2、統括の決定(7)）と[C-179](../requirements/decision-register.md)。

### データ（migration 0026）

- `cases`：`id`（ULID）、`case_number`（NOT NULL・UNIQUE）、`number_client_id`（発行時の取引先。FK）、`client_id`（現在の取引先。FK）、`channel_id`（FK `channels.room_id`・UNIQUE）、`request_id`（UNIQUE。申請との対応。申請の`case_id`と対になる）、`title`・`description`・`due_date`、`status`（`active`か`closed`。既定`active`）、`created_by`（申請者）・`approved_by`（承認者）、`version`、`created_at`・`updated_at`
- `case_number`のCHECK：長さが15で、「英大文字3文字・`-`・数字6桁・`-`・数字4桁」。D1のLIKE・GLOBのパターンの長さの上限のため、1つのGLOBにせず、長さと部分ごとのGLOBに分けた（C-179(7)）。`status`のCHECKは`active`・`closed`
- 索引：`case_number`・`channel_id`・`request_id`のUNIQUE、`(client_id, title)`（類似件名の比較）
- `case_departments`：`(case_id, department_id)`が主キー。`department_id`に索引
- `case_number_sequences`：`(client_id, year)`が主キー。`last_number`は1〜9999のCHECK。案件を消しても戻らない（C-117）。年は日本時間の西暦
- 参加者の正は`channel_members`（C-178のU-1）。`case_participants`は作らず、自動参加の印の列も持たない（いまの役割から導く）。アーカイブの列は作らない（#150以降）
- `cases.created_by`と、案件専用チャンネル（`channels.created_by`）の作成者は申請者。`approved_by`は承認者（C-179(6)）

### 審査の判定の順（承認・却下）

Serviceの`loadDecidable`と`approve`・`reject`が、この順に行う。決裁の時点の割り当て（`reviewerFactsOf`）で判定するので、オーナーの交代の後は、新しいオーナーが審査する。前のオーナーは、交代でどの部署のオーナーでもなくなった（審査者の資格を失った）なら、1の審査者の門で403になる。ほかの部署のオーナーの資格が残っているなら、この申請の範囲外として2で404になる。

1. 審査者の門：`perm.case.request.approve`（全体管理者か、いずれかの部署のオーナー）。でなければ403（拒否は`authorize`が記録する）
2. 申請が存在しない、または審査の範囲外（全体管理者でなく、担当部署のどれのオーナーでもない）なら404「申請が見つかりません」（`logger.audit`に記録。存在しない場合と同じ本文）
3. 全体管理者でない人が、自分の申請を決裁しようとしたら403「この申請は承認・却下できません」（`logger.audit`に記録。全体管理者に限り、自分の申請を承認できる。5-3 AC-4）
4. （承認だけ）承認者が足す候補が存在しない・無効なら422（`fields`は`additionalCandidateIds`）
5. batchの中の409・403（次の節）

### 承認のbatch

`approve`が、1回の`db.batch`で次の順に確定する。**文の順が、失敗の理由の優先になる**（先に崩れた前提の理由が出る）。前提が崩れたら、NOT NULL・CHECK・UNIQUEの違反でbatch全体を取り消し、何も残さない。`translateError`が、制約の種類と表・列で専用エラーにし、Serviceが`AppError`にする。

| 順 | 文 | 崩れたときの応答 |
| --- | --- | --- |
| 1 | `guardPending`：審査中で、読んだ版のままなら版を1上げる | 409「この申請はすでに処理されています」（最優先） |
| 2 | 決裁者の資格の確認（`reviewerGuard`）：決裁者が有効で、全体管理者か、申請者本人でなく担当部署のどれかのオーナーでなければ、申請の`requested_by`をNULLにする | 403「この申請を審査する権限がありません」（`logger.audit`に記録） |
| 3 | 担当部署の有効性：`departments.version`を、有効なら元の値、無効ならNULLにする（値と版は変えない） | 409「担当部署の一部が無効のため承認できません。却下して再申請を依頼してください」 |
| 4 | 取引先の有効性（C-178のU-2）：`clients.version`で同じ形 | 409「取引先が無効のため承認できません。却下して再申請を依頼してください」 |
| 5 | 承認者が足す候補を、申請の候補に入れる（`added_by`は承認者。すでに候補の人は入れない）。存在しない・無効なら`added_by`がNULLになる | 422（`fields`は`additionalCandidateIds`） |
| 6 | 申請の時からの候補の有効性：候補の`user_id`を、有効なら元の値、無効ならNULLにする | 409「無効になった候補がいます。申請者に取り下げと再申請を依頼してください」 |
| 7 | 採番：`case_number_sequences`の`UPSERT`（`ON CONFLICT`で`last_number`に1を足す） | 9999を超えると`last_number`のCHECKで409「この取引先の今年の案件番号が上限に達したため承認できません」 |
| 8 | `rooms` → `channels`：種別は`case`、非公開、`department_id`はNULL、名前は案件番号、`name_normalized`は`case:`と小文字の案件番号。作成者は申請者 | `channels.name_normalized`のUNIQUE違反は409「採番が競合しました。もう一度承認してください」 |
| 9 | `cases`・`case_departments`：取引先のコード・日本時間のYYMMDD・4桁の連番から案件番号を組み立てる（`INSERT…SELECT`） | `cases.case_number`のUNIQUE違反は、同じ409「採番が競合しました。もう一度承認してください」 |
| 10 | `channel_members`：申請者・候補・全担当部署の有効なオーナー・有効な全体管理者を、現在の割り当てから`INSERT…SELECT`で確定する（`UNION`で重複を除く。読んだ値を埋め込まない）。無効な社員は入れない。承認者であることを理由には入れない | 該当者がいなくても失敗にしない（申請者は必ず入る） |
| 11 | 申請を`approved`にし、`case_id`・`decided_by`・`decided_at`を入れる | — |
| 12 | 監査`case_request.approve`（「監査」の節）。直後に、同じbatchの中で案件番号と参加者数などの値を入れる | — |
| 13 | 通知`case_request.approved`：申請者に送る。決裁者が申請者本人なら送らない（3-4 AC-3） | — |

- 申請者・担当部署の数は、batchの前に1回読む（`readDecisionFacts`。申請の後に変わらない）。batchの後に、`cases`を`request_id`で読み直して応答する。0行のときは成功にせず、エラーにする
- 案件番号の形は「取引先のコード（英大文字3文字）-YYMMDD（日本時間の承認日）-4桁の連番」。連番は取引先ごと・年ごと。年が変わると0001から
- 通知の宛先（申請者）は、申請の行の`requested_by`で決まり、割り当てに依存しないため、宛先の確認文は置かない
- 同時の承認：同じ取引先・同じ年の承認は、連番の`UPSERT`で直列になり、番号は重複せず抜けもない。手元のD1（Miniflare）のテストで確かめた（最後に使った番号が9997のとき、3件を同時に承認すると、9998・9999の2件が成功し、1件は409で何も作らない）。テスト専用の本物のD1での確認は#160

### 却下のbatch

`reject`が、1回の`db.batch`で、`guardPending` → 決裁者の資格の確認 → 申請を`rejected`にして理由・決裁者・時刻を入れる → 監査`case_request.reject`（理由の本文なし）→ 通知`case_request.rejected`（申請者。決裁者が本人なら送らない）を確定する。部署・取引先・候補が無効でも却下できる（却下して再申請してもらう。C-141(1)）。却下の理由の規則はチャンネルの作成申請と同じ（C-91。`rejectReasonSchema`）。

### 審査一覧（EP-5-03）

`listReviewable`が、審査の範囲の申請を申請IDの降順で返す。範囲はSQLのWHERE（`reviewScopeSql`）に入れる：全体管理者は全部、オーナーは担当部署のどれかが自分の部署の申請。ページを送っても範囲外は出ない。`status`で絞れる（APIの既定は絞らない。画面は承認待ちから始める）。`hasSimilarTitle`は、自分自身を除き、同じ取引先の審査中の申請か案件（進行中・終了）に同じ件名があるか（`similarToOthersSql`）。`canApprove`は、審査中で、決裁できる（`canDecideCaseRequest`）ときだけ真。部署と候補は、そのページの申請IDで読む（N+1にしない）。

### 案件専用チャンネル

承認のbatchの8で作る。一覧に出さない（`channel.repository.ts`の`list`が`purpose = 'case'`を除く）ため、参加者にもチャンネル一覧に出ない。名前（案件番号）は通常のチャンネルと衝突しない（`name_normalized`が`case:`で始まる）。参加者の追加・案件の画面・招待の409は#147・#148・#135。

## 既知の差・未実施・未決定として記録するもの

| 項目 | 状態 |
| --- | --- |
| 審査（S-29）・承認・却下・案件の作成 | 146-Bで作った |
| 類似件名の比較の対象 | 審査中の申請と、案件（進行中・終了）。146-Bで案件を足した（5-3 AC-14） |
| 自動取消の申請者への通知 | 作らない（後の Issue） |
| 担当部署の付け替えの通知（5-3 AC-9の C-143(3)） | #154 |
| 本番のD1へのmigration 0024・0026の適用 | 未実施（利用者の承認が別途必要） |
| 案件の終了・再開・再編集、案件専用チャンネルでのやり取り、オーナー交代・全体管理者の任命による既存の案件への自動参加 | #150・#148・#147か役割のIssue（上の「作らないもの」） |
| 案件の画面（S-16）ができたときの通知の移動先 | 承認の通知（`case_request.approved`）の移動先を、案件の画面に変える（いまは自分の申請） |
| 却下の理由のダイアログ | チャンネルの作成申請のものと共通化していない（後のIssue） |
| レート制限 | 入れていない（X-8が未決定） |
| 本物のD1での採番の同時実行の確認 | #160（手元のD1での同時承認のテストは146-Bで書いた） |

## テストの場所

- 共有・純粋関数：`backend/src/lib/case-rules.test.ts`（整形・長さ・納期・`jstDateOf`）、`backend/src/lib/case-request-rules.test.ts`（宛先）、`backend/src/lib/notification-kinds.case-request.test.ts`（種類の定義）
- DB（隔離したD1）：`backend/src/db/case-request.schema.db.test.ts`（CHECK・主キー・索引）、`case-request.repository.db.test.ts`（batchの原子性・前提の崩れ・類似件名・取り下げ・宛先の変化）、`cleanup-sql.case-requests.db.test.ts`（後始末のSQL）、`account.repository.case-request.db.test.ts`・`account.repository.transfer.case-request.db.test.ts`（無効化・異動による自動取消）
- route・Service：`backend/src/routes/case-requests.test.ts`（状態コード・判定の順・応答の形・通知と監査）、`backend/src/services/case-request.service.test.ts`、`backend/src/openapi.test.ts`（契約）
- テスト部品：`backend/test/case-request-fixtures.ts`、`frontend/src/test/case-request-handlers.tsx`（MSW）
- フロントエンド：`frontend/src/pages/CaseRequestPage.test.tsx`・`CaseRequestPage.drafts.test.tsx`・`CaseRequestRoutes.test.tsx`、`frontend/src/features/app-shell/navigation.case-requests.test.ts`、`frontend/src/features/notifications/notification-views.case-request.test.ts`、`frontend/src/features/drafts/draft-policy.case-request.test.ts`
- 146-B（DB）：`backend/src/db/case-request.approve.db.test.ts`（承認のbatch・採番の形・同時の承認・前提の崩れの理由と優先・最初の判定の後の資格の変化・却下・類似件名に案件）、`backend/src/db/channel.repository.case-channel.db.test.ts`（案件専用チャンネルがチャンネル一覧に出ないこと・通常のチャンネルの名前と衝突しないこと）
- 146-B（route・Service）：`backend/src/routes/case-requests.decide.test.ts`（判定の順・承認と却下の応答・409・通知と監査・審査一覧・類似件名の確認・自分の申請の案件番号）、`backend/src/routes/auth.test.ts`（セッションの`perm.case.request.approve`）、`backend/src/openapi.test.ts`（契約）。テスト部品は`backend/test/case-approval-fixtures.ts`
- 146-B（フロントエンド）：`frontend/src/pages/CaseApprovalsPage.test.tsx`（S-29の表示・ボタンの出し分け・ダイアログ・409の表示と取り直し・4状態）、`CaseApprovalRoutes.test.tsx`（権限のない人のルート）、`frontend/src/features/app-shell/navigation.case-approvals.test.tsx`（メニューの出し分け）、`frontend/src/features/notifications/notification-views.case-request.test.ts`。テスト部品は`frontend/src/test/case-approval-handlers.tsx`
- 146-B（E2E）：`e2e/case-approvals.spec.ts`。シードは`e2e/seeds/case-approvals.sql`、確認は`case-approvals-check.sql`（読み取りだけ）、後始末は`case-approvals-cleanup.sql`（[e2e.md](../testing/e2e.md)）
- E2E（146-A）：`e2e/case-requests.spec.ts`。シードは`e2e/seeds/case-requests.sql`と`case-requests-cleanup.sql`（[e2e.md](../testing/e2e.md)）

## 関係するIssue・ADR

- Issue #146：本Issue（146-A・146-Bに分けた。146-Bで案件番号・案件専用チャンネルを作る）。通知の土台は#124（[notifications.md](notifications.md)）。無効化・異動は#128（[accounts.md](accounts.md)）。参加者の自動参加の続きは#147など。案件の一覧・詳細は#147、本物のD1での確認は#160、担当部署の付け替えの通知は#154
- [ADR-0006](../adr/0006-id-cursor-unread.md)：IDとカーソル／[ADR-0012](../adr/0012-zero-trust-principle.md)：サーバー側で毎回認可する／[ADR-0020](../adr/0020-test-scope-mutation-e2e.md)・[ADR-0028](../adr/0028-lighter-process-and-narrowed-scope.md)：ミューテーション・E2Eの実行範囲
- 要件：5-3 AC-1〜AC-15（146-AでAC-1・AC-5〜AC-8・AC-10〜AC-15、146-BでAC-2〜AC-6・AC-8・AC-9・AC-14のS-29の部分を満たす。詳しくは[05-case.md](../requirements/05-case.md)の注記）、5-1 AC-1・AC-19、3-4 AC-1、S-18。決定記録[C-178](../requirements/decision-register.md)
- 関連する設計：[channel-requests.md](channel-requests.md)（同じ「申請 → 審査」の型）、[accounts.md](accounts.md)、[drafts.md](drafts.md)、[notifications.md](notifications.md)
