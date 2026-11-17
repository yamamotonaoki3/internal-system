# 案件の作成の申請（Issue #146 の 146-A）

## 目的

社員が案件の作成を申請し（S-18）、自分の申請を見て、審査中の間は取り下げ、却下・取り下げ済みの申請は修正して再申請できるようにする。申請が届いたときの通知（3-4 AC-1）を、通知の土台（[notifications.md](notifications.md)）で出す。申請者の無効化・部署異動のときの自動取消（5-3 AC-8）も、この子で足す。コードは書き写さず、ファイル名・関数名で指す。

Issue #146 は2つの子に分けた。**この設計書は146-A（申請・自分の申請・取り下げ・類似件名の確認・自動取消）の範囲**で、146-B（審査・承認・却下、採番、専用チャンネル）は、作るときにこの設計書へ足す（下の「146-Bで足すもの」）。同じ「申請 → 審査」の型として、[channel-requests.md](channel-requests.md)（チャンネルの作成申請）を参考にしている。

## 範囲

| 区分 | 内容 |
| --- | --- |
| 146-Aで作ったもの | 表3つ（`case_creation_requests`・`case_creation_request_departments`・`case_creation_request_candidates`。migration 0024）／申請・自分の申請・取り下げ・類似件名の確認のAPI4つ／件名・説明・納期の規則の定義元`shared/case-rules.ts`／通知の種類`case_request.submitted`／監査操作2つ／S-18（申請フォームと自分の申請）／メニュー「案件の申請」／説明欄の下書き／申請者の無効化・部署異動による自動取消（`account.repository.ts`） |
| 146-Bで作るもの | 審査一覧（S-29）・承認・却下／案件番号の採番・`cases`表／案件専用チャンネルと参加者の自動参加／承認・却下の通知／類似件名の比較に案件を足すこと／既存のチャンネル一覧から案件専用チャンネルを除くこと |
| 作らないもの | 申請の編集（取り下げて再申請する）、取り下げ・自動取消の通知、レート制限（X-8が未決定のため）、S-18の「キャンセル → 元の画面」・自動で参加する旨の案内・離れる前の確認（S-16がまだない、文言が未決定、#245）、案件の一覧・詳細（#147）、担当部署の付け替えの通知（#154） |
| 本Issueで確定した決定 | [C-178](../requirements/decision-register.md)（Issue #146のコメントの利用者の決定・統括の決定。146-Bで使う決定も含む。実装は146-Aだけ） |

## ファイルと役割

### 共有・DB

| ファイル | 役割 |
| --- | --- |
| `shared/case-rules.ts` | 件名・説明・納期の規則の**定義元**。定数`CASE_TITLE_MAX_LENGTH`（100）・`CASE_DESCRIPTION_MAX_LENGTH`（2000）、件名の整形`formatCaseTitle`、検証の`caseTitleSchema`・`caseDescriptionSchema`・`caseDueDateSchema`、日本時間の日付`jstDateOf`、納期が今日より前かの`isDueDateBeforeToday`。画面とサーバーが同じ定義を参照する（サーバー側の検証は省略しない）。却下理由の規則は、146-Bで`shared/channel-name-rules.ts`の`rejectReasonSchema`を参照する（C-91と同じ規則） |
| `shared/notification-kinds.ts` | 通知の種類に`case_request.submitted`を足した（`containsRoomContent: false`） |
| `backend/db/schema.ts` | `caseCreationRequests`・`caseCreationRequestDepartments`・`caseCreationRequestCandidates`を追加（下の「データ」） |
| `backend/db/migrations/0024_add_case_creation_requests.sql`、`meta/0024_snapshot.json`、`meta/_journal.json` | 新規テーブル3つと索引のmigration。`drizzle-kit generate`の生成物 |
| `backend/db/seeds/cleanup.sql` | 手元の確認用の後始末に、新しい3つの表を外部キーの順で足した（候補 → 申請の部署 → 申請。再申請の自己参照を先に外す）。残数の確認にも足した |

### バックエンド

| ファイル | 役割 |
| --- | --- |
| `backend/src/lib/case-request-rules.ts` | 純粋関数`caseRequestSubmittedRecipients`（申請が届いたときの通知の宛先）。DB・HTTPを知らない |
| `backend/src/db/case-request.repository.ts` | `createCaseRequestRepository`の`create`・`listMine`・`findOwnItem`・`findOwnForWithdraw`・`withdraw`・`hasSimilarTitle`・`findOwnResubmittable`・`findUserDepartmentId`・`readSubmittedRecipientCandidates`。1操作＝1回の`db.batch`。前提の確認文（`CASE WHEN … ELSE NULL`）と、DBエラーの専用エラー（`CaseRequestWriteError`）への変換（`translateError`）、取り下げの`guardPending`。`withCaseRequests`が構成する |
| `backend/src/services/case-request.service.ts` | `createCaseRequestService`の`create`・`listMine`・`withdraw`・`checkSimilarTitle`。権限・所属・整形後の長さ・納期・再申請の元の判定を決まった順に行い、専用エラーを`AppError`に変える。`withCaseRequestService`が構成する |
| `backend/src/routes/case-requests.ts` | `caseRequestRoutes`。入力の形の確認（422、`strict`）と応答だけを行う。全応答に`noStore`。`/mine`と`/similar-title`は`/:requestId/withdraw`より前に定義する。`backend/src/index.ts`が`/api/case-requests`へ登録する |
| `backend/src/db/account.repository.ts` | 申請者の無効化・部署異動の`db.batch`に、審査中の申請の自動取消を足した（`readPendingCaseRequests`・`caseRequestsUnchangedSql`・`autoCancelCaseRequests`・`cancelledCountOf`）。無効化と異動で同じ知識を1か所にまとめる。詳細は[accounts.md](accounts.md) |
| `backend/src/lib/audit-actions.ts` | `case_request.create`・`case_request.withdraw`を足した |
| `docs/api/openapi.json`、`backend/src/openapi.test.ts` | 4操作のAPI仕様と実routeとの契約確認 |
| `stryker.config.json` | ミューテーションの対象に、`shared/case-rules.ts`・`case-request-rules.ts`・`case-request.repository.ts`・`routes/case-requests.ts`と、フロントのapi・schemas・hooks・componentsを足した（[mutation.md](../testing/mutation.md)） |

`services/authorizer.ts`・`channel.repository.ts`・`shared/channel-name-rules.ts`・`routes/auth.ts`は変えていない。全体管理者かどうかは、既存の`reviewerFactsOf`で読む。

### フロントエンド

依存の向きは、pages → features → 共通。`features/case-requests/`は`index.ts`だけを公開する（`CaseRequestWorkspace`）。

| ファイル | 役割 |
| --- | --- |
| `frontend/src/features/case-requests/api/case-request-api.ts` | `createCaseRequest`・`fetchMyCaseRequests`・`withdrawCaseRequest`・`checkSimilarTitle`と、欄の候補を読む`fetchClientChoices`・`fetchDepartmentChoices`・`searchCandidateUsers`。`apiClient`だけを使い、応答はZodで検証する |
| `frontend/src/features/case-requests/api/query-keys.ts` | `caseRequestKeys`（申請・取り下げの後に`all`を取り直す）と、欄の候補用の`caseRequestChoiceKeys` |
| `frontend/src/features/case-requests/hooks/` | `useMyCaseRequests`（カーソルの無限スクロール）・`useCreateCaseRequest`・`useWithdrawCaseRequest`・`useSimilarTitle`・`useCaseRequestChoices`（取引先・部署・社員の検索）・`useSettledValue`（入力が止まってから値を返す） |
| `frontend/src/features/case-requests/schemas/case-request-form.ts` | S-18の入力チェック。件名・説明・納期は`shared/case-rules.ts`の定義を使う。件名は整形した値を送らない（整形で値が変わったかをサーバーが返すため） |
| `frontend/src/features/case-requests/components/` | `CaseRequestWorkspace`（フォームと自分の申請をまとめ、下書きを1つだけ開く。「修正して再申請」でフォームを作り直す）・`CaseRequestForm`（申請フォーム）・`CandidatePicker`（追加の候補の検索と選択）・`MyCaseRequestList`（自分の申請）・`WithdrawDialog`（取り下げの確認） |
| `frontend/src/features/case-requests/labels.ts`、`describe-error.ts` | 状態の表示名（5つ。`auto_cancelled`は「自動取消」）／通信の失敗の文言 |
| `frontend/src/pages/CaseRequestPage.tsx` | S-18の構成だけ。APIや状態は持たない |
| `frontend/src/App.tsx` | レイアウトルートの子に`/case-requests`を足した |
| `frontend/src/features/app-shell/navigation.ts` | メニューに「案件の申請」を全員に出す項目として足した（[app-shell.md](app-shell.md)） |
| `frontend/src/features/notifications/notification-views.ts` | `case_request.submitted`の文言と移動先（`/case-requests`）を足した |
| `frontend/src/features/drafts/draft-policy.ts`・`index.ts` | 下書きの`scope`として`caseRequestDraftScope`を足して公開した（[drafts.md](drafts.md)） |

## データ

- `case_creation_requests`：`id`（ULID）、`client_id`（NOT NULL）、`title`（整形後）、`description`（既定は空）、`due_date`（YYYY-MM-DD。NULL可）、`requested_by`、`status`（既定`pending`）、`version`（既定1。二重の操作の検出用）、`decided_by`、`decision_reason`、`case_id`、`resubmitted_from`（自己参照。再申請の元）、`requested_at`、`decided_at`
- CHECK：`status`は`pending`・`approved`・`rejected`・`withdrawn`・`auto_cancelled`の5つ／`rejected`なら`decision_reason`あり／`approved`なら`case_id`あり／`pending`以外なら`decided_at`と`decided_by`あり／`due_date`はNULLか数字4桁-2桁-2桁の形
- 索引：`(requested_by, id)`（自分の申請）・`(status, id)`・`(client_id, title)`（類似件名の比較）
- `case_id`は外部キーにしない（将来の物理削除を止めないため。`channel_creation_requests.channel_id`と同じ考え）。`approved`・`rejected`・`case_id`は146-Bが使うので、CHECKの作り直しを避けるため146-Aで先に入れた。`auto_cancelled`は、本人による「取り下げ」と区別するための状態
- `case_creation_request_departments`：`(request_id, department_id)`が主キー。`department_id`に索引。担当部署は複数持てる（上限なし。最低1つ）
- `case_creation_request_candidates`：`(request_id, user_id)`が主キー。`added_by`（申請時は申請者）・`added_at`
- 案件の参加者の持ち方は、`channel_members`を正とする方針（利用者の決定。C-178）。`case_participants`表は作らない。これは146-Bで使う

## 処理の流れ

### 申請（POST /api/case-requests。EP-5-01）

判定の順（Serviceの`create`。変えない）：

1. `perm.case.request.create`を会社の範囲で認可する（拒否は`authorize`が記録する）
2. 全体管理者でなく、所属部署もなければ403「所属部署がないため申請できません」（`logger.audit`に記録）
3. 入力の形の検査（routeで422）
4. 整形後の件名が1〜100文字か。納期が今日（日本時間）より前なら422（`fields`は`dueDate`。再申請でも同じ）。候補に申請者本人を含めると422
5. `resubmitOf`は、本人の`rejected`か`withdrawn`の申請でなければ422（`fields`は`resubmitOf`）。他人の申請・存在しない・審査中・承認済み・自動取消を区別せず、同じ422・同じ本文にする（存在を明かさない）
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
| 再申請の元が本人の`rejected`か`withdrawn` | `resubmitted_from`を、使える元ならその値、なければNULLにし、NULLなら件名をNULLにして失敗させる確認文を置く | 422（`fields`は`resubmitOf`） |
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

`perm.case.request.create`を認可し、`hasSimilar`と`formattedTitle`だけを返す。他人の件名・申請者・件数は返さない（真偽だけにして、推測の手がかりを最小にする）。比べる対象は、同じ取引先で整形後の件名が完全一致する**審査中**の申請。却下・取り下げ済み・自動取消・別の取引先は対象外。件名の整形後の長さの誤りは422。警告が出ても申請・承認は止めない。案件（`cases`）は表がまだないため、146-Bで比較に足す。

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
- 再申請の元：他人・存在しない・審査中・承認済み・自動取消は同じ422・同じ本文（ID の形の検査は、`requestId`のパスでは行わず、404に合わせる）
- 類似件名の確認：真偽だけ。件数・件名・申請者を返さない
- 一覧：本人の申請だけ（SQLのWHERE）

### 同時の操作

| 組み合わせ | 結果 |
| --- | --- |
| 取り下げ × 取り下げ | 片方が先に確定し、もう片方は`guardPending`で409 |
| 取り下げ × 自動取消 | 先に確定したほうが成り立つ。後の取り下げは409 |
| 申請 × 申請者の無効化・所属の喪失 | 申請のbatchの資格の確認で403。何も残らない |
| 申請 × 担当部署のオーナーの交代・無効化 | 宛先の確認で409。何も残らない |
| 申請 × 取引先・部署・候補の無効化 | それぞれの確認で422。何も残らない |
| 申請 × 申請者の無効化・異動（取り消す件数が変わる） | 無効化・異動のbatchの前提の確認が崩れ、読み直す |

## 画面

| 画面 | ファイル | 内容 |
| --- | --- | --- |
| S-18 案件の作成の申請（`/case-requests`） | `pages/CaseRequestPage.tsx`、`features/case-requests/components/CaseRequestForm.tsx`・`CandidatePicker.tsx` | 取引先（`/api/clients/candidates`）、件名（欄の近くに注意書き「件名は参加していない人にも見える場合があります。機密情報を書かないでください」）、説明、納期（日付の入力。下限は日本時間の今日）、担当部署（`/api/users/departments`。**checkboxのグループ**で1つ以上）、追加の候補（社員の検索から選ぶ）。欄の名前は「件名」。件名と取引先が入り、入力が止まって400ミリ秒たったら類似件名を確かめ、「似た案件があります」を出す（送信は止めない）。送信の後、`titleFormatted`が真なら「表記を整えて保存しました」を出す。所属がなく全体管理者でもない社員には「所属部署がないため申請できません」を出し、送信させない（サーバーも403。全体管理者かの判定はセッションの権限を使う表示の制御）。422の`fields`は該当の欄に、409・403は欄の外に出す。送信中は押せない |
| 自分の申請 | `MyCaseRequestList.tsx`・`WithdrawDialog.tsx` | 状態（承認待ち・承認済み・却下・取り下げ済み・自動取消）・件名・取引先名（無効なら「（無効）」）・担当部署・納期・却下理由（文字列として出す。HTMLを解釈しない）。承認待ちの行に「取り下げ」（確認のダイアログを経る）。却下・取り下げ済みの行に「修正して再申請」（フォームに元の値を入れ、`resubmitOf`を付ける。納期が過去なら欄にエラーを出す）。続きの読み込みは「**次のページ**」のボタン（既存の一覧と同じ）。読み込み中・エラー・0件・ありの4状態 |
| 入口 | `App.tsx`、`features/app-shell/navigation.ts` | メニュー「案件の申請」（全員に出す。案件一覧のS-16が#147でできるまでの仮の入口） |
| 通知 | `features/notifications/notification-views.ts` | `case_request.submitted`の文言は「案件の作成の申請が届きました」。S-29が146-Bでできるまで、移動先は`/case-requests` |

- 取り直し（invalidate）：申請・取り下げの後は`caseRequestKeys.all`
- 申請の画面は、説明欄だけ下書きを端末に保存する（screens S-18「下書き」・C-120・1-1 AC-4）。`features/drafts`の公開の入口から`useDraft(userId, caseRequestDraftScope())`を使い、マウントで復元し、入力のたびに保存する。**件名・取引先・担当部署・候補・納期は保存しない**（C-82・C-117）。送信が成功したら`discard`で消し、失敗したら残す。保存先が使えないとき（`unavailable`）も入力と送信はできる。再申請でフォームに値を入れたときは、元の申請の説明を入れ、それも下書きとして保存する。scopeは`caseRequestDraftScope`（`draft-policy.ts`）が決め、部屋・スレッドのscopeと重ならない

## API契約

全応答に`noStore`。変更系は`/api/*`共通の`originCheck`を通る。再認証は求めない。

| 操作 | 契約 |
| --- | --- |
| 申請（EP-5-01） | `POST /api/case-requests`。本文（`strict`）は`clientId`・`title`・`description?`・`dueDate?`・`departmentIds`（1件以上・重複不可・件数の上限なし）・`candidateIds?`（重複不可・申請者本人を含めない・件数の上限なし）・`resubmitOf?`。201で自分の申請の項目に`titleFormatted`と`hasSimilarTitle`を足したもの。401／403（所属なしの一般社員・オーナー、資格の喪失、`FORBIDDEN_ORIGIN`）／409（宛先の変化）／422 |
| 自分の申請（EP-5-02） | `GET /api/case-requests/mine`。クエリは`limit`・`cursor`。200で`items`と`nextCursor`。項目は`id`・`title`・`description`・`dueDate`・`client`（`id`・`code`・`name`・`isActive`）・`departments`（`id`・`name`・`isActive`）・`candidates`（`userId`・`displayName`）・`status`・`rejectReason`・`caseId`・`resubmittedFrom`・`createdAt`・`decidedAt`。401／403（権限なし）／422 |
| 取り下げ | `POST /api/case-requests/{requestId}/withdraw`。200で`requestId`・`status`（`withdrawn`）。401／403（`FORBIDDEN_ORIGIN`）／404／409 |
| 類似件名の確認 | `GET /api/case-requests/similar-title`。クエリは`clientId`・`title`。200で`hasSimilar`・`formattedTitle`だけ。401／403／422 |

応答の最終の形はOpenAPI（`docs/api/openapi.json`）に従う。レート制限は入れていない。

## 主な入出力

| 処理 | 入力 | 出力 |
| --- | --- | --- |
| `formatCaseTitle(raw)` | 入力された件名 | 全角英数字・ハイフン類・空白を整えた件名 |
| `jstDateOf(now)` | 現在時刻 | 日本時間の`date`（YYYY-MM-DD）・`year`・`yymmdd`（`yymmdd`は146-Bの採番で使う） |
| `isDueDateBeforeToday(dueDate, now)` | 納期・現在時刻 | 日本時間の今日より前か |
| `caseRequestSubmittedRecipients(input)` | `requesterId`・`ownerIds`・`adminIds` | 通知の宛先（申請者を除く。オーナーが空なら全体管理者。重複なし） |
| `createCaseRequestService()`の各メソッド | 操作者（利用者ID・追跡ID）、必要な引数 | 申請の項目＋`titleFormatted`・`hasSimilarTitle`／ページ／`requestId`と`status`／`hasSimilar`と`formattedTitle` |
| Repositoryの`create`・`withdraw` | 申請の情報（整形済みの件名・読んだ宛先・版・操作者・追跡ID） | `create`は作った申請ID。失敗は`CaseRequestWriteError`（`reason`で見分ける） |

## 監査

| 操作 | 残す内容（`detail`） |
| --- | --- |
| `case_request.create` | 申請ID・取引先ID・部署数・候補数・再申請の元のID |
| `case_request.withdraw` | 申請ID・部署数 |
| 自動取消 | 申請ごとには残さない。`account.deactivate`と異動の監査の`detail`の`cancelledCaseRequestCount`に件数を残す |

いずれも`auditLogInsert`を業務と同じ`db.batch`に入れる。件名・説明・理由の本文・氏名は`detail`に入れない。認可の拒否は`authorize`が、404と業務の403は`logger.audit`が記録する。

## 個人情報・権限

- 申請者は認証済みの情報から取る。クライアントの値を受けない
- 申請・自分の申請・取り下げ・類似件名の確認は、すべて`perm.case.request.create`（R-60）を確かめる。申請できる人が、自分の申請を見て取り下げられる。権限の一覧は足していない
- 画面で隠すこと（メニュー・ボタン）を認可の代わりにしない。サーバーが毎回認可する
- 件名は参加していない人にも見える場合があるため、画面に注意書きを出す（5-3 AC-10）
- 通知は部屋の内容を含まない（`containsRoomContent: false`）。通知に件名・理由を持たせない

## 146-Bで足すもの

146-Bは、146-Aと#135のマージの後に、最新の`main`に合わせて作る。ここでは範囲だけを書き、詳細は作るときにこの設計書へ足す。

- 審査一覧S-29（EP-5-03）・承認（EP-5-04）・却下（EP-5-05）。承認の判定の順・自己承認の禁止・存在の非開示（範囲外は404）
- 承認のbatch：担当部署・取引先・候補の有効性の確認（申請の後に取引先が無効になったら承認を409で止め、却下して再申請してもらう。利用者の決定）、案件番号の採番、`cases`・`case_departments`・`case_number_sequences`、案件専用チャンネルと参加者の自動参加（参加者の正は`channel_members`。利用者の決定）
- 通知`case_request.approved`・`case_request.rejected`、`submitted`の移動先を`/case-approvals`に変えること
- 類似件名の比較に、進行中・終了の案件を足すこと
- `channel.repository.ts`の一覧から案件専用チャンネルを除くこと（`channels.md`）
- 採番の同時実行のテスト（手元のD1。着手前の条件の置き換え。本物のD1での確認は#160）

## 既知の差・未実施・未決定として記録するもの

| 項目 | 状態 |
| --- | --- |
| 審査（S-29）・承認・却下・案件の作成 | 146-Bで作る。146-Aでは申請が`pending`のまま残る |
| 類似件名の比較の対象 | 審査中の申請だけ。案件は146-Bで足す（5-3 AC-14） |
| 自動取消の申請者への通知 | 作らない（後の Issue） |
| 担当部署の付け替えの通知（5-3 AC-9の C-143(3)） | #154 |
| 自動取消になった申請の再申請 | 再申請の元にできるのは`rejected`・`withdrawn`だけ。`auto_cancelled`を元にすると422になる（要件に定めがなく、決まるまで広げない） |
| 本番のD1へのmigration 0024の適用 | 未実施（利用者の承認が別途必要） |
| レート制限 | 入れていない（X-8が未決定） |
| 本物のD1での採番の同時実行の確認 | #160（146-Bの採番） |

## テストの場所

- 共有・純粋関数：`backend/src/lib/case-rules.test.ts`（整形・長さ・納期・`jstDateOf`）、`backend/src/lib/case-request-rules.test.ts`（宛先）、`backend/src/lib/notification-kinds.case-request.test.ts`（種類の定義）
- DB（隔離したD1）：`backend/src/db/case-request.schema.db.test.ts`（CHECK・主キー・索引）、`case-request.repository.db.test.ts`（batchの原子性・前提の崩れ・類似件名・取り下げ・宛先の変化）、`cleanup-sql.case-requests.db.test.ts`（後始末のSQL）、`account.repository.case-request.db.test.ts`・`account.repository.transfer.case-request.db.test.ts`（無効化・異動による自動取消）
- route・Service：`backend/src/routes/case-requests.test.ts`（状態コード・判定の順・応答の形・通知と監査）、`backend/src/services/case-request.service.test.ts`、`backend/src/openapi.test.ts`（契約）
- テスト部品：`backend/test/case-request-fixtures.ts`、`frontend/src/test/case-request-handlers.tsx`（MSW）
- フロントエンド：`frontend/src/pages/CaseRequestPage.test.tsx`・`CaseRequestPage.drafts.test.tsx`・`CaseRequestRoutes.test.tsx`、`frontend/src/features/app-shell/navigation.case-requests.test.ts`、`frontend/src/features/notifications/notification-views.case-request.test.ts`、`frontend/src/features/drafts/draft-policy.case-request.test.ts`
- E2E：`e2e/case-requests.spec.ts`。シードは`e2e/seeds/case-requests.sql`と`case-requests-cleanup.sql`（[e2e.md](../testing/e2e.md)）

## 関係するIssue・ADR

- Issue #146：本Issue（146-A・146-Bに分けた）。通知の土台は#124（[notifications.md](notifications.md)）。無効化・異動は#128（[accounts.md](accounts.md)）。参加者の自動参加の続きは#147など。案件の一覧・詳細は#147、本物のD1での確認は#160、担当部署の付け替えの通知は#154
- [ADR-0006](../adr/0006-id-cursor-unread.md)：IDとカーソル／[ADR-0012](../adr/0012-zero-trust-principle.md)：サーバー側で毎回認可する／[ADR-0020](../adr/0020-test-scope-mutation-e2e.md)・[ADR-0028](../adr/0028-lighter-process-and-narrowed-scope.md)：ミューテーション・E2Eの実行範囲
- 要件：5-3 AC-1〜AC-15（146-AでAC-1・AC-5〜AC-8・AC-10〜AC-15を満たす。詳しくは[05-case.md](../requirements/05-case.md)の注記）、5-1 AC-1・AC-19、3-4 AC-1、S-18。決定記録[C-178](../requirements/decision-register.md)
- 関連する設計：[channel-requests.md](channel-requests.md)（同じ「申請 → 審査」の型）、[accounts.md](accounts.md)、[drafts.md](drafts.md)、[notifications.md](notifications.md)
