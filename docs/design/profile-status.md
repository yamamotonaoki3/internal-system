# プロフィール・社員一覧・ステータス（Issue #130）

## 目的

社員が自分の表示名とステータス（在席・外出・欠席・休暇・会議中。戻り予定と一言メッセージつき）を設定でき、ほかの社員が社員一覧とプロフィールカードで、部署とステータスを一緒に見られるようにする。オーナーは自部署の社員のステータスを、全体管理者は全部署の社員のステータスを、代わりに設定できる。ヘッダーにステータスのボタンを置き、画面を移らずに切り替えられるようにする。コードは書き写さず、ファイル名・関数名で指す。

## 範囲

| 区分 | 内容 |
| --- | --- |
| このIssueで作ったもの | 自分のプロフィールの取得・変更（EP-0-03の詳細・EP-0-12）／ステータスの代理設定（EP-0-15）／社員一覧（EP-7-01）／一覧の部署の候補（新設。EP番号なし）／プロフィールカード（EP-0-18）／`users`へのステータスの5列と索引（migration 0013）／画面S-19（プロフィール設定）・S-20（社員一覧）・S-27（プロフィールカード）／ヘッダーのステータスボタン／アバターメニューの切り替え／ナビの「社員一覧」／ステータスの色のトークン |
| 別Issueに分けたもの | #221：全体管理者による社員情報（役職・メール・内線）の変更（0-4 AC-7・8・12・13）。#222：本名変更届の提出と承認（0-4 AC-14・15）。#136：DMの画面S-06での相手のステータス表示と、DMの相手選択での表示（6-1 AC-1・AC-4のDM部分）。#223：拠点ラベルでの絞り込み（7-3 AC-3の後半。拠点ラベル7-1 AC-5〜8の新Issue）。アバター画像（0-4 AC-2・AC-2a）は#141 |
| 作らないもの | 表示名・ステータスの変更の通知やリアルタイム反映（#117）、S-19の「本名変更届を提出」（動かない仮の項目は置かない）、S-20・S-27の「DMを送る」（#136で足す）、本人のステータス変更の監査 |

分割した結果、「0-4のアバター以外をすべて満たす」とは言えない（AC-7・8・12〜15が未達）。決定は[C-165](../requirements/decision-register.md)に記録した。

## ファイルと役割

### 共有・DB

| ファイル | 役割 |
| --- | --- |
| `shared/profile-rules.ts` | ステータスの5値（`USER_STATUS_KINDS`）、一言メッセージの上限（`STATUS_MESSAGE_MAX_LENGTH`＝100）と入力のschema（`statusMessageSchema`）、戻り予定のschema（`returnAtSchema`）、戻り予定の上限の時刻を返す`latestReturnAt`の定義元。DBのCHECK制約・APIの検証・画面の入力チェックが参照する |
| `backend/db/schema.ts` | `users`に、`status_kind`（既定は在席・5値のCHECK制約`users_status_kind_check`）・`status_return_at`・`status_message`・`status_updated_at`・`status_updated_by`（`users.id`を参照）と、索引`users_directory_idx`（部署・表示名・ID）・`users_display_name_idx`（表示名・ID）を追加した。CHECKの値はschemaが`USER_STATUS_KINDS`から作る |
| `backend/db/migrations/0013_add_user_status.sql`、`meta/0013_snapshot.json`、`meta/_journal.json` | 上の列と索引のmigration。drizzle-kitはテーブルの作り直しを生成したため、`ALTER TABLE … ADD`と`CREATE INDEX`に書き換えた（[ADR-0024](../adr/0024-add-column-rewrite-for-table-rebuild.md)） |
| `backend/src/lib/audit-actions.ts` | `status.proxy_set`と`profile.display_name_change`を足した |

### バックエンド

| ファイル | 役割 |
| --- | --- |
| `backend/src/routes/me.ts` | `GET /api/me/profile`と`PATCH /api/me/profile`を追加した（既存の`PUT /api/me/password`は変えていない）。PATCHの本文は`strict`で、変える項目だけを送り、0項目は422。本名・メール・内線・役職・部署は受け付けない |
| `backend/src/routes/users.ts`（新） | `userRoutes`。`GET /`（社員一覧）・`GET /departments`（部署の候補）・`GET /:userId/profile-card`・`PUT /:userId/status`。入力の形の確認（422）と応答だけを行う。ユーザーIDは`isUlid`で確かめ、形式が不正なら422 |
| `backend/src/lib/actor.ts`（新） | `actorOf`。認証済みの操作者（利用者IDと追跡ID）をリクエストから取り出す。`me.ts`と`users.ts`が共用する |
| `backend/src/services/profile.service.ts`（新） | `createProfileService`。認可、戻り予定の検証（現在時刻は注入できる）、本名の復号（`decryptLegalName`）、一覧の`canSetStatus`の組み立て。`withProfileService`が構成する |
| `backend/src/db/profile.repository.ts`（新） | `createProfileRepository`。`findOwnProfile`・`updateOwnProfile`・`findProfileCard`・`listDirectory`・`listActiveDepartments`・`findStatusTarget`・`setStatusByProxy`。本名は暗号化したまま返す。`withProfiles`が構成する |
| `backend/src/services/authorizer.ts` | `canForDepartments(repository, userId, permission, departmentIds)`を追加した。割り当てを1回だけ読み、部署ごとに`resolvePermissions`で判定して`Map(部署ID, 真偽)`を返す。`createAppAuthorizer`と同じResolverを使うため、権限の組み立ては2か所にならない |
| `backend/src/index.ts` | `/api/users`へ`userRoutes`を登録した |
| `docs/api/openapi.json`、`backend/src/openapi.test.ts` | 6操作のAPI仕様と、実routeとの契約確認 |
| `stryker.config.json` | ミューテーションの対象に`shared/profile-rules.ts`・`profile.repository.ts`・`routes/users.ts`・`features/profile/schemas/profile-form.ts`を足した |

### フロントエンド

| ファイル | 役割 |
| --- | --- |
| `frontend/src/features/profile/`（新） | `index.ts`が公開する部品。`api/profile-api.ts`（`getMyProfile`・`updateMyProfile`・`getProfileCard`。応答をZodで検証）、`api/query-keys.ts`（`profileKeys`）、`hooks/useMyProfile.ts`・`useUpdateMyProfile.ts`、`schemas/profile-form.ts`（S-19の入力チェック）、`ProfileForm.tsx`（S-19の中身）、`StatusBadge.tsx`、`StatusPicker.tsx`、`StatusButton.tsx`、`StatusKindRadios.tsx`、`ProfileCard.tsx`（`ProfileCardTrigger`）、`status-labels.ts`、`return-at.ts`（入力欄の日時とUTCのISO 8601の変換）、`server-errors.ts`・`describe-error.ts` |
| `frontend/src/features/members/`（新） | `index.ts`が公開する部品。`api/member-api.ts`（`fetchMembers`・`fetchDepartments`・`setMemberStatus`）、`query-keys.ts`（`memberKeys`。`profileKeys`の下に置く）、`hooks/useMembers.ts`・`useSetMemberStatus.ts`、`MembersList.tsx`、`DepartmentFilter.tsx`、`ProxyStatusDialog.tsx` |
| `frontend/src/pages/ProfilePage.tsx`・`MembersPage.tsx`（新） | 画面の構成だけ。APIや状態は持たない |
| `frontend/src/App.tsx` | レイアウトルートの子に`/profile`と`/members`を足した |
| `frontend/src/features/app-shell/Header.tsx`・`AvatarMenu.tsx`・`navigation.ts` | ヘッダーに`StatusButton`、アバターメニューに「プロフィール設定」リンクと`StatusPicker`、ナビに「社員一覧」を足した（[app-shell.md](app-shell.md)）。`features/profile/index.ts`を通して使う |
| `frontend/src/features/auth/index.ts`（新） | `authKeys`と`useSession`を公開する。`features/profile`・`features/members`が、`auth`の内部を直接参照しないため |
| `frontend/src/styles/index.css`、`tokens.test.ts` | `--color-status-available`・`-away`・`-absent`・`-vacation`・`-meeting`の5トークンと、その組み合わせのテスト（[style-foundation.md](style-foundation.md)） |

## 処理の流れ

### 共通の順序（Service）

認可（`createAppAuthorizer`の`authorize`。拒否は`logger.audit`に残る）→ 業務の検証（戻り予定。書き込みより前）→ Repository（1操作＝1回の`db.batch`、または1文）。未知のDBエラーは握りつぶさず再送出する。ログと監査には、本名・メール・表示名・一言の値を出さない。

### 自分のプロフィールの取得（GET /api/me/profile）

1. principalの利用者IDで`findOwnProfile`を読む（他人のIDは受け取らない）。行がなければ404
2. 本名を`decryptLegalName`で復号して返す。本名の暗号鍵（`PII_ENCRYPTION_KEY`）がなければ503
3. 応答に`Cache-Control: no-store`を付ける

### 自分のプロフィールの変更（PATCH /api/me/profile）

1. `perm.profile.edit.own`の認可。本人のIDはprincipalから取る
2. ステータスの扱い（`resolveReturnAt`）：
   - `status`を送った：在席なら戻り予定を持たない（`returnAt`を一緒に送ると422）。在席以外は、`returnAt`を送ればその値、送らなければ戻り予定は消える
   - `status`を送らず`returnAt`だけ送った：いまの種類に対して設定する。いまが在席なら422。確認から書き込みの間に在席へ変わる競合に備え、`updateOwnProfile`の`onlyIfNotAvailable`で、UPDATEの`WHERE`に「在席でない」を加える（表示名の監査も同じbatchの同じ条件）。0行で返ればServiceが422にする
   - `returnAt`は「現在より後、かつ現在から1年以内」。ちょうど現在は不可、`latestReturnAt`ちょうどは可。判定のあとはUTCのISO 8601にそろえて保存する
   - 「1年」は暦の1年（翌年の同じ月日。2月29日は翌年3月1日）
3. `statusMessage`は、前後の空白を除いて100文字まで。制御文字（改行を含む）は不可。空は`null`で保存する（一言を消す）。`null`そのものは受け付けない
4. `updateOwnProfile`が、渡された項目だけを更新する。ステータス系の項目を変えたときは`status_updated_at`・`status_updated_by`（本人）も更新する
5. **`displayName`が送られたときだけ**、`profile.display_name_change`の監査を、更新と同じ`db.batch`に入れる。監査の挿入が失敗すれば表示名の更新も取り消される。`detail`は空で、表示名の値を入れない。ステータス・一言だけの変更は監査に残さない

### ステータスの代理設定（PUT /api/users/:userId/status）

1. `findStatusTarget`で対象を読む。対象がいない・無効化済み・所属なしのときは、認可の前に404（所属なしの有効な社員は、0-4 AC-8によりいない前提）
2. `perm.status.proxy.set`を、**対象者の部署の範囲**で`authorize`する（オーナーは自部署、全体管理者は全部署）。他部署の社員やメンバーは403
3. 本文は`status`（必須）と`returnAt`（任意）だけ。一言は扱わず、本人の一言は変えない。戻り予定の規則は上と同じ
4. `setStatusByProxy`が、`status_*`の更新（`status_updated_by`は操作者）と`status.proxy_set`の監査を、同じ`db.batch`で確定する。`detail`は`departmentId`と`status`（種類）だけ
5. 自分自身への特別な拒否は設けない。オーナーの自部署には自分も含まれるため、自分への設定は認可どおり200になり、操作者と対象者が同じ`status.proxy_set`が残る

### 社員一覧のページ送り（GET /api/users）

1. `perm.employee.view`（会社範囲）の認可。一般メンバーも閲覧できる
2. クエリは`departmentId`（任意。形式が不正なら422）・`limit`（既定20・最大100）・`cursor`。余剰のクエリは422
3. `listDirectory`が、有効かつ所属ありの社員だけを、表示名・IDの昇順で読む（自分も含む）。続きは`cursor.ts`の`afterCursor`（並び替えの値＝表示名、ID）で取り、OFFSETは使わない。`limit+1`件を読み`toPage`で`nextCursor`を作る。壊れたカーソルは422
4. 本名は読まない。項目は`id`・`displayName`・`department`（`id`・`name`）・`extension`・`email`・`status`（`kind`・`returnAt`・`message`）・`canSetStatus`だけ
5. `canSetStatus`は、一覧の部署のIDを`canForDepartments`に渡し、**割り当ての読み込み1回**で部署ごとに算出する（行ごとに`authorize`を呼ばない）。これは表示の制御で、認可は`PUT`で対象ごとに行う

### 部署の候補（GET /api/users/departments）

`perm.employee.view`（会社範囲）の認可のあと、有効な部署の`id`と`name`だけを名前順で返す。一般メンバーが使える部署の一覧が既存になかった（既存は管理用の`/api/admin/departments`だけ）ため新設した。

### プロフィールカード（GET /api/users/:userId/profile-card）

1. `perm.employee.legal_name.view`（ログイン後の全員）の認可。未ログインは401
2. 対象がいない・無効化済みなら404。所属なしの有効な社員は`department`が`null`
3. 本名を復号して返す（本名の復号経路はこのAPIと自分のプロフィールだけ）。ログ・監査には出さない
4. 閲覧は監査に残さない（C-75）

### フロントエンドの取得と反映

- 自分の変更（`useUpdateMyProfile`）と代理設定（`useSetMemberStatus`）は、成功したら`profileKeys.all`（自分・一覧・カード・部署の候補）を取り直す。自分の変更は、あわせてセッション（`authKeys.session`。アバターの表示名）も取り直す。再読込なしで、ヘッダー・一覧・カードに反映される
- 他の人の画面への反映は、ポーリングをしない。一覧とカードは、開いたとき（マウント）とフォーカスしたときにTanStack Queryの既定（`staleTime`は0）で取り直す。個別の設定は入れていない。リアルタイムの反映は#117
- 戻り予定の超過の判定（`StatusBadge`）は、描画したときの時刻で行う。開いたままでは更新しない。超過してもステータスは自動では変えず、「戻り予定を過ぎています」を添えるだけ
- S-19の戻り予定の入力欄（`datetime-local`）の`min`は現在、`max`は1年後。入力の目安で、最終の判定はサーバー

## 画面

| 画面 | ファイル | 内容 |
| --- | --- | --- |
| S-19 プロフィール設定（`/profile`） | `pages/ProfilePage.tsx`、`features/profile/ProfileForm.tsx` | 表示名のフォーム、ステータス（種類・戻り予定・一言）のフォーム、表示だけの項目（本名・部署・役職・メール・内線）。サーバーの422の`fields`を各欄のエラーにする。読み込み中・エラー・成功の状態を出す |
| S-20 社員一覧（`/members`） | `pages/MembersPage.tsx`、`features/members/` | 部署での絞り込み、表（表示名ボタン・部署・内線・メール・ステータス・操作）、「さらに表示」。メールは`mailto`リンク、内線はリンクにしない。読み込み中・エラー・0件・ありの4状態。`canSetStatus`が真で、かつ自分以外の行にだけ「ステータスを代理設定」を出す（`<dialog>`の`ProxyStatusDialog`。一言は変えない） |
| S-27 プロフィールカード | `features/profile/ProfileCard.tsx` | 表示名のボタン（`ProfileCardTrigger`）が、ネイティブの`popover`でカードを開く。本名・部署・ステータス・一言・戻り予定。閉じるボタン、Esc、キーボードで開閉でき、閉じたら起動ボタンにフォーカスを戻す。内容は開いたときに取る |
| ヘッダーのステータスボタン | `features/profile/StatusButton.tsx` | 現在の種類を、色つきの丸＋文字で出す。読み込み中・エラーのときは、灰色の丸と読み上げ名（「ステータス：確認中」「ステータス：取得できません」）を出す。767px以下は丸だけ（文字は読み上げ用に残す）。押すとpopoverで5種類と戻り予定の入力欄（`StatusPicker`）。選ぶとすぐPATCHを送る。`StatusPicker`のヒント文で、入力してから種類を押すと一緒に送ること、同じ種類をもう一度押すと戻り予定だけ変えること、在席を選ぶと戻り予定が消えることを伝える。失敗したら表示を変えず、その場でエラーを知らせる |
| アバターメニュー | `features/app-shell/AvatarMenu.tsx` | 並びは、プロフィール設定 → ステータス（`StatusPicker`）→ パスワード変更 → ログアウト |

- 表示名・一言は、文字として表示する（`dangerouslySetInnerHTML`は使わない）。種類は色だけに頼らず、文字でも出す
- ヘッダーのステータスとアバターメニューは、どちらも`popover="auto"`で、同時に1つだけ開く
- 代理設定の操作を自分の行に出さないのは、ヘッダーとS-19で変えられるため。表示の制御であり、認可ではない
- 一言メッセージは、S-19だけで入力する（ヘッダーでは入力しない）

## 個人情報

- 本名を復号して返す経路は、**プロフィールカード（EP-0-18）と自分のプロフィール（GET /api/me/profile）の2つだけ**。社員一覧には含めない
- ログ（`createLogger`）・監査の`detail`に、本名・メール・表示名・一言の値を出さない。`status.proxy_set`の`detail`のキーは`departmentId`と`status`だけ、`profile.display_name_change`の`detail`は空
- メールと内線は、ログイン後の全員が一覧で見られる項目（7-3 AC-2）。一覧のAPIの応答は`noStore`

## 既存データ

migration 0013は、定数の既定値を持つ列の追加なので、既存の`users`の行は「在席・戻り予定なし・一言なし」になる。補完のスクリプトは要らない。既存の`INSERT`（初回セットアップ・アカウント発行・各シード）も、既定値のまま通る。本番のD1への0013の適用は、このIssueの完了条件に含めず、別途利用者の承認を得て行う（[ADR-0024](../adr/0024-add-column-rewrite-for-table-rebuild.md)）。

## API契約

| 操作 | 契約 |
| --- | --- |
| 自分のプロフィール | `GET /api/me/profile`。200で`id`・`loginId`・`displayName`・`legalName`・`department`（`id`・`name`。なければ`null`）・`jobTitle`・`email`・`extension`・`status`（`kind`・`returnAt`・`message`）。401／404／503 |
| 自分の変更 | `PATCH /api/me/profile`。入力は`displayName`・`status`・`returnAt`・`statusMessage`の一部（0項目は422）。200で`displayName`・`status`・`returnAt`・`statusMessage`・`updatedAt`。401／403（`FORBIDDEN_ORIGIN`・`FORBIDDEN`）／422（`fields`） |
| 代理設定 | `PUT /api/users/{userId}/status`。入力は`status`（必須）・`returnAt`（任意）。200で`userId`・`status`・`returnAt`・`updatedAt`。401／403（`FORBIDDEN`・`FORBIDDEN_ORIGIN`）／404／422 |
| 社員一覧 | `GET /api/users`。クエリは`departmentId`・`limit`・`cursor`。200で`items`と`nextCursor`。401／403／422 |
| 部署の候補 | `GET /api/users/departments`。200で`items`（`id`・`name`）。401／403 |
| プロフィールカード | `GET /api/users/{userId}/profile-card`。200で`userId`・`displayName`・`legalName`・`department`・`status`。401／403／404／422／503 |

応答の最終の形はOpenAPI（`docs/api/openapi.json`）に従う。レート制限は入れていない（上限がX-8で未決定のため。channels・messagesと同じ扱い）。

## 主な入出力

| 処理 | 入力 | 出力 |
| --- | --- | --- |
| `createProfileService().getOwnProfile` | 操作者 | 本名を復号した自分のプロフィール |
| `.updateOwnProfile` | 操作者、`displayName?`・`status?`・`returnAt?`・`statusMessage?` | 更新後の表示名・種類・戻り予定・一言・更新日時 |
| `.setStatusByProxy` | 操作者、対象の利用者ID、`status`、`returnAt?` | 対象のID・種類・戻り予定・更新日時 |
| `.listDirectory` | 操作者、`departmentId?`・`limit`・`cursor?` | `canSetStatus`つきの社員の一覧と`nextCursor` |
| `.listDepartments` | 操作者 | 有効な部署の`id`・`name` |
| `.getProfileCard` | 操作者、対象の利用者ID | 本名を復号したカードの内容 |
| `canForDepartments(repository, userId, permission, departmentIds)` | 割り当ての取得元、利用者ID、権限、部署IDの一覧 | 部署IDごとの真偽（重複は1つにまとめる。存在しない・無効な利用者は全部`false`） |
| `latestReturnAt(now)` | 現在時刻 | 戻り予定に指定できる最も遅い時刻 |

## テストの場所

- 共有規則：`backend/src/lib/profile-rules.test.ts`
- DB結合：`backend/src/db/profile.repository.db.test.ts`（既定値・CHECK・一覧の絞り込み/並び/カーソル・代理設定と監査の原子性・表示名の監査）
- Service・route：`backend/src/services/profile.service.test.ts`、`backend/src/services/authorizer.can-for-departments.test.ts`（読み込みが1回であること、部署ごとの`authorize`との一致）、`backend/src/routes/me.profile.test.ts`、`backend/src/routes/users.test.ts`
- 追加のテスト：`backend/src/db/profile.repository.write.db.test.ts`（書き込みの条件・競合）、`backend/src/services/profile.service.rules.test.ts`（業務の規則）、`backend/src/routes/me.guards.test.ts`（入力・認証・Originの拒否）、`frontend/src/features/profile/schemas/profile-form.test.ts`（S-19の入力チェック）
- テスト部品：`backend/test/profile-fixtures.ts`、`frontend/src/test/profile-handlers.ts`（MSW）
- フロントエンド：`frontend/src/features/profile/profile.test.tsx`、`frontend/src/features/members/members.test.tsx`、`frontend/src/features/app-shell/navigation.members.test.ts`、`frontend/src/styles/tokens.test.ts`
- 期待を変えた既存テスト：`e2e/app-shell.spec.ts`の2件（アバターメニューのTab順。最初のTabが「プロフィール設定」になり、ログアウトまで進めるようにした）。`frontend/src/features/app-shell/AvatarMenu.test.tsx`の2件（アバターメニューにステータスの切り替えが加わり、ヘッダーにもpopoverが増えたため。「popoverが文書内に1つ」の確認を「アバターメニューのidが1つ」に、「パネル内のボタンが1つ」の確認を「ログアウトのボタンが1つ」に変えた。確かめる意図は同じ）。API仕様との契約：`backend/src/openapi.test.ts`
- E2E：`e2e/profile.spec.ts`。seedは`e2e/seeds/profile.sql`と`profile-cleanup.sql`

## 未実施・未決定として記録するもの

| 項目 | 状態 |
| --- | --- |
| 本番のD1へのmigration 0013の適用 | 未実施（利用者の承認が別途必要） |
| 全体管理者による社員情報の変更（0-4 AC-7・8・12・13）、本名変更届（AC-14・15） | #221・#222 |
| DMの画面・相手選択でのステータス表示 | #136。`StatusBadge`・`ProfileCardTrigger`と取得APIは用意済み |
| 拠点ラベルでの絞り込み | #223 |
| 表示名・ステータスのリアルタイム反映 | #117 |
| ヘッダーのステータス表示のための自分のプロフィール取得 | `GET /api/me/profile`は本名の復号を伴う。ステータスだけを返す、復号を伴わないAPIにする改善は#224 |
| 一覧・カード・更新のレート制限 | 入れていない（X-8が未決定） |
| 本人のステータス変更の監査 | 残さない（高頻度の本人操作。C-165）。表示名の変更と代理設定は残す |

## 関係するIssue・ADR

- Issue #130：本Issue。親Issue #109。分割先は#221・#222・#223、後続は#136
- [ADR-0024](../adr/0024-add-column-rewrite-for-table-rebuild.md)：列の追加でテーブルの作り直しが生成されたときの、ADD COLUMNへの書き換え／[ADR-0012](../adr/0012-zero-trust-principle.md)：サーバー側で毎回認可する／[ADR-0006](../adr/0006-id-cursor-unread.md)：IDとカーソル／[ADR-0020](../adr/0020-test-scope-mutation-e2e.md)：ミューテーション・E2Eの実行範囲
- 要件：0-4 AC-1・3〜6・9〜11、6-1 AC-2〜4、7-3 AC-1・2・4（AC-3は部署の絞り込みのみ）、S-19・S-20・S-27。決定記録[C-165](../requirements/decision-register.md)
