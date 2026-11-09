# 部署の登録・改名・オーナー交代と、部署の専用チャンネル（Issue #196）

## 目的

全体管理者が、部署の登録・改名・オーナーの任命と交代を行えるようにする。部署を作ると、公開の専用チャンネル2つ（通常・お知らせ）を同時に作り、自部署の社員を自動で参加させる。あわせて、チャンネルとその参加者を持つ表（`rooms`・`channels`・`channel_members`）を、後続のIssue（#200・#201）が使える形で用意する。コードは書き写さず、ファイル名・関数名で指す。

## 範囲

| 区分 | 内容 |
| --- | --- |
| このIssueで作ったもの | 部署の登録（EP-2-01）・一覧（EP-2-03）・改名（EP-2-23）・オーナー交代（EP-0-21）・オーナー候補の取得（新規）／部署の専用チャンネル2つの作成・改名への追従・所属変更に伴う参加の付け替え／`rooms`・`channels`・`channel_members`の表と`departments`への列の追加／初代部署の専用チャンネルの補完／管理画面S-24（部署の一覧・改名・オーナー交代）とS-08（部署の作成） |
| 親#125に残すもの | 案件への新オーナーの自動参加、案件専用チャンネルへの参加、前オーナーの案件への残留。案件の機能（#147）が完成した後に、親で統合する。案件のテーブルや`purpose = case`の行は、このIssueでは作らない |
| 後続Issue | #200：全社連絡と公開チャンネルの一覧・閲覧・参加。#201：メッセージ（`messages`） |
| 作らないもの | 部署の削除・無効化（2-1 AC-14）、オーナー用の部署管理画面（S-13。利用者が見送りを承認）、部署APIの試行制限（記録のみ。下の「未実装・未決定」） |

## ファイルと役割

### バックエンド

| ファイル | 役割 |
| --- | --- |
| `backend/db/schema.ts`、`backend/db/migrations/0008_add_department_channels.sql` | `departments`に`description`・`version`・`updated_at`を追加し、`rooms`・`channels`・`channel_members`を作る。新しい表の追加とADD COLUMNだけで、既存の列は変えない。`updated_at`はADD COLUMNで式の既定値を付けられないためNULLを許し、作成・改名・交代のたびにアプリが値を入れる |
| `backend/db/migrations/0009_backfill_department_channels.sql` | 既存の部署に専用チャンネル2つと参加者を補うデータ移行。手作成（[ADR-0021](../adr/0021-department-channel-backfill-migration-exception.md)） |
| `shared/department-rules.ts` | 部署名・説明の入力schema（`departmentNameSchema`・`departmentDescriptionSchema`）、比較キー（`departmentNameKey`・`channelNameKey`）、お知らせ専用チャンネルの名前（`announcementChannelName`・`ANNOUNCEMENT_SUFFIX`・`DEPARTMENT_ANNOUNCEMENT_NAME_MAX`）の定義元 |
| `backend/src/routes/departments.ts` | `departmentRoutes`（`POST /`・`PUT /:id/owner`）と`adminDepartmentRoutes`（`GET /`・`GET /owner-candidates`・`PATCH /:id`）。入力の形（422）の確認と応答だけを行う |
| `backend/src/services/department.service.ts` | `createDepartmentService`が認可・再認証・存在確認の順で処理し、Repositoryの専用エラーを`AppError`に変える（`toAppError`）。`withDepartmentService`が構成する |
| `backend/src/db/department.repository.ts` | `createDepartmentRepository`が一覧・候補・作成・改名・交代を扱う。作成・改名・交代は、それぞれ1回の`db.batch`で確定する。`DuplicateDepartmentError`（名前の重複。部署名かチャンネル名かを区別）と`DepartmentConflictError`（版の不一致・前提の不成立など。理由を持つ）を投げる。`withDepartments`が構成する |
| `backend/src/db/setup.repository.ts` | `createInitialAdmin`の`db.batch`に、初代部署の専用チャンネル2つと初代管理者の参加を足した |
| `backend/src/services/authorizer.ts` | `canManageDepartments`が`perm.workspace.create`の会社範囲の判定を行う（`canManageClients`と同形） |
| `backend/src/routes/auth.ts` | `GET /api/auth/session`の`permissions`に、部署管理の権限`perm.workspace.create`を足した |
| `backend/src/lib/audit-actions.ts` | `department.create`・`department.rename`・`department.owner_change`・`department.channel_backfill`を足した |
| `backend/src/index.ts` | `/api/admin/departments`と`/api/departments`へ各routeを登録 |
| `backend/db/seeds/cleanup.sql` | 部署のチャンネル・参加者・ルームの後始末を足した（`[UNIT_TEST]`・`[E2E_TEST]`で始まる部署のものだけ） |
| `docs/api/openapi.json`、`backend/src/openapi.test.ts` | 部署の5操作のAPI仕様と実routeとの契約確認 |
| `stryker.config.json` | ミューテーションの対象に、上のRepository・route・共有規則・フロントエンドの主な部品・`setup.repository.ts`を足した |

### フロントエンド

| ファイル | 役割 |
| --- | --- |
| `frontend/src/features/departments/department-api.ts` | `fetchDepartments`・`fetchOwnerCandidates`・`createDepartment`・`renameDepartment`・`changeDepartmentOwner` |
| `frontend/src/features/departments/query-keys.ts` | `departmentKeys`（キャッシュのキー） |
| `frontend/src/features/departments/useDepartmentMutations.ts` | 作成・改名・交代の各操作を、再認証（`withReauth`）で包んで送り、成功したら一覧とセッションのキャッシュを無効にする。再認証が完了しなかったときは、要求を送らず`NotSentError`にする |
| `frontend/src/features/departments/DepartmentsManager.tsx` | S-24の一覧。改名（`DepartmentRenameForm`）とオーナー交代（`OwnerChangeDialog`）の入口。削除・無効化の操作は出さない |
| `frontend/src/features/departments/DepartmentCreateForm.tsx` | S-08の入力。成功するとS-24（`/departments`）に移る |
| `frontend/src/features/departments/OwnerChangeDialog.tsx`、`OwnerSelectFields.tsx`、`owner-selection.ts` | オーナーの選択。別部署の現オーナーを選んだときだけ元部署の後任を選ばせる（`needsSuccessor`・`successorCandidates`）。画面の補助であり、最終の確認はサーバー |
| `frontend/src/features/departments/write-errors.ts` | 書き込みの失敗を利用者向けの文にする（`describeWriteError`） |
| `frontend/src/pages/DepartmentsPage.tsx`、`DepartmentCreatePage.tsx` | 画面の構成 |
| `frontend/src/components/SelectField.tsx` | 共通の選択欄。ラベル・ヒント・エラーを結ぶ（`FieldMessages`を共用）。#199にも同名の部品があり、統合時に1つにそろえる。[style-foundation.md](style-foundation.md)の部品の一覧には、統合時にまとめて足す |
| `frontend/src/App.tsx` | `DepartmentManageRoute`が`/departments`と`/departments/new`を、`perm.workspace.create`がないときは`NotFoundPage`にする（表示の制御であり、認可はサーバー） |
| `frontend/src/features/app-shell/navigation.ts` | 管理メニューの「部署」のまとまりに「部署管理」を足した（[app-shell.md](app-shell.md)） |
| `frontend/src/features/auth/api/auth-api.ts` | セッションの`permissions`に`perm.workspace.create`を許した |

## 処理の流れ

### 共通の順序（Service）

1. 認可（`createAppAuthorizer`。会社範囲）。拒否は403で、存在を漏らさない
2. 書き込みは再認証の確認（`assertRecentReauth`。作成・改名・交代。期限切れは`403 REAUTH_REQUIRED`で何も変わらない）
3. 対象の部署の存在確認（改名・交代。なければ404）
4. Repository（1操作＝1回の`db.batch`）
5. 専用エラーを`AppError`に変換する。未知のエラーは握りつぶさず、そのまま再送出する

入力の形（部署名の長さ・制御文字、余剰項目）は、routeの`validate`が先に422にする。

### 前提の確認の書き方（S-3。[project-rules.md](../project-rules.md)）

D1は対話型トランザクションがなく、`db.batch`は途中で文が失敗すると全体を取り消す。そこで、「読んだ事実がbatchの時点でも同じか」「最後に不変条件が成り立つか」を、**条件が崩れたらNOT NULL違反で失敗する文**で確かめる。

- 版を確認する文：`departments.version`を`CASE WHEN 条件 THEN 版 ELSE NULL END`に更新する（`bumpVersion`・`assertStatement`）。条件が崩れると`departments.version`のNOT NULL違反でbatch全体が失敗する
- 不変条件を確認する文：batchの最後に、同じ形の文（`assertStatement`）で、対象部署ごとにオーナーがちょうど1人・全体管理者でないオーナーは所属する1部署だけ・自動チャンネルがちょうど2つ、を確かめる
- 失敗は`translateError`が制約の表と列の名前で振り分ける。`departments.name_normalized`と`channels.name_normalized`は`DuplicateDepartmentError`（409）、前提の確認の文や並行する更新で起きうる制約（`departments.version`、`user_role_assignments`・`channel_members`・`channels`の一意・NOT NULL違反）は`DepartmentConflictError`の`state_changed`（409）。対象の制約は`translateError`の定義に従い、必要なものに限る。**それ以外のDBエラーは変換せず再送出する**

### 作成（EP-2-01）

Repositoryの`create`は、batchの前に`planOwnerTransfer`で事実を読み、満たさない前提を専用エラーにする（何も書かない）。batchの文は次の順に並ぶ。

1. 部署の挿入（版1・`updated_at`あり）
2. `rooms`の挿入（専用・お知らせの2行）
3. `channels`の挿入（専用は部署名、お知らせは部署名＋「のお知らせ」。ともに公開・説明は空）
4. 元部署の版を確認して進める文（別部署の現オーナーを指名したときだけ）
5. 事実の確認（現オーナーの有無、指名された社員が有効か、全体管理者かどうか、後任が元部署の有効な一般社員か）
6. ロール・所属・参加の付け替え（下の「所属とオーナーの付け替え」）
7. 不変条件の確認（オーナーが1人、自動チャンネルが2つ）
8. 監査ログ（`department.create`）

名前が既存のチャンネル（アーカイブ済みを含む）や部署と大文字小文字を区別せず衝突したときは、2〜3または1の一意制約の違反でbatch全体が取り消される。部署・チャンネル・ロール・所属・参加・監査のどれも残らない。衝突の文言は「同じ名前の部署またはチャンネルがあります。別の部署名を入力してください」。切詰めや連番の付加はしない。「営業」のお知らせチャンネルと、部署名「営業のお知らせ」の通常チャンネルの衝突も、同じ一意制約で防ぐ。

ownerUserIdを省略すると、作成した全体管理者がオーナーになる。

### 改名（EP-2-23）

`rename`は、版・有効かを`bumpVersion`で確かめながら部署名を更新し（1文目）、専用・お知らせの2チャンネルの名前を同じbatchで更新し、最後に「2チャンネルの名前が新しい部署名に追従した」ことを確かめ、監査ログ（`department.rename`）を書く。

**更新の順序**：SQLiteの一意制約は1文ごとに判定される。そのため、同じ部署の2チャンネルの名前を入れ替える更新は、順序を誤ると自分自身と衝突する。新しいお知らせ名が自分の専用チャンネルの今の名前と同じとき（「Xのお知らせ」→「X」）は専用を先に、それ以外（「a」→「aのお知らせ」など）はお知らせを先に更新する。

### オーナー交代（EP-0-21）

`changeOwner`は、対象部署の版を進める文、元部署の版を進める文（別部署の現オーナーを指名したときだけ）、事実の確認、付け替え、不変条件の確認、監査ログ（`department.owner_change`）の順。

- オーナーは部署ごとに常に1人。前のオーナーの削除と新しいオーナーの挿入を同じbatchに入れ、既存の部分一意インデックス（`user_role_assignments_owner_department_unique`）と最後の確認文で守る
- 元部署の版も+1する。読んだ版と違えばbatch全体が失敗する（利用者は元部署の版を画面で見ないため、API入力にはなく、Repositoryが読んだ時点の版を使う）
- 前のオーナーが全体管理者なら、兼任が外れるだけで所属は動かない。それ以外の前オーナーは一般メンバーに戻り、所属は変えない
- 無効な社員の任命は422。すでにその部署のオーナーなら409。別部署の現オーナーを指名したときは、元部署の有効な一般社員を後任に指定する必要があり、指定がない（422）・不要なのに指定した（422）・後任が不適格（無効・全体管理者・他部署・オーナー・指名された本人）（422）は拒否する。何も変わらない

### 所属とオーナーの付け替え（作成と交代で共通）

`transferStatements`が、現オーナーの削除、元部署の後任の割り当て、新オーナーの割り当て、所属の更新、自動チャンネルの参加の付け替えを並べる。

- 全体管理者は**所属を動かさず、自動チャンネルにも参加させない**（S-8）。所属する社員だけが自動参加する。全体管理者は#200で手動参加する
- 全体管理者でない新オーナーは、所属が移り、旧部署の自動チャンネル2つから外れ（行を削除）、新部署の自動チャンネル2つに参加する。他のチャンネルには触れない
- 参加の追加は`INSERT ... SELECT`で、すでに参加している行は作らない

## API契約

| 操作 | 契約 |
| --- | --- |
| 作成 | `POST /api/departments`。入力`name`・`description?`・`ownerUserId?`・`previousDepartmentSuccessorUserId?`。201で`id`・`name`・`description`・`version`・`createdAt`・`ownerUserId`・`dedicatedChannelId`・`announcementChannelId`。401／403（`FORBIDDEN`・`REAUTH_REQUIRED`）／404（指名した社員がいない）／409（名前の重複・状態の競合）／422（形式・無効な社員・後任の不足・過剰・不適格） |
| 一覧 | `GET /api/admin/departments`。`limit`・`cursor`。`items`（`id`・`name`・`isActive`・`ownerUserId`・`ownerDisplayName`・`memberCount`・`version`）と`nextCursor`。名前の比較キー・IDの順 |
| 改名 | `PATCH /api/admin/departments/{id}`。入力`name`・`version`。200で`id`・`name`・`version`・`updatedAt`。409（名前の重複・版の不一致・無効な部署） |
| オーナー交代 | `PUT /api/departments/{id}/owner`。入力`ownerUserId`・`previousDepartmentSuccessorUserId?`・`version`。200で`departmentId`・`ownerUserId`・`version`・`updatedAt`。409（すでにオーナー・版の不一致・無効な部署）／422（上の通り） |
| オーナー候補 | `GET /api/admin/departments/owner-candidates`。`q?`（100文字まで）・`limit`（最大50）・`cursor`。有効な社員の`id`・`displayName`・`departmentId`・`ownedDepartmentId`・`isGlobalAdmin`。本名・メール・社員IDは返さない |

入力は`strict`で、余剰項目は422。部署名・説明の規則は`shared/department-rules.ts`。部署名は前後の空白を除いて1〜50文字（UTF-16の長さで数える）、使える文字は制限せず制御文字だけを拒否する。説明は500文字まで。比較は前後の空白を除いて小文字にしたキーで行う。応答の最終の形はOpenAPI（`docs/api/openapi.json`）に従う。

## 権限

| 操作 | 権限ID | 備考 |
| --- | --- | --- |
| 一覧・改名・オーナー候補 | `perm.workspace.create` | 権限表に専用の行がないため、部署の作成と同じ権限IDを使う（S-6）。全体管理者のみ |
| 作成 | `perm.workspace.create` | `ownerUserId`を指定するときは、加えて`perm.workspace.owner.designate` |
| オーナー交代 | `perm.role.assign` | 全体管理者のみ |

画面の出し分けには、セッション取得の`permissions`に含まれる`perm.workspace.create`を使う。サーバー側の認可は毎回行い、画面の制御を認可の代わりにしない。

## rooms・channels・channel_members を後続がどう使うか

後続（#200・#201）が追加の表や列なしに使えるよう、次の約束で作ってある。

| 項目 | 決まり |
| --- | --- |
| `rooms` | チャンネルとDMの共通の入れ物。`kind`は`channel`か`conversation`。#201は`messages.room_id`を`rooms.id`に結ぶ |
| `channels.department_id` | NULLは会社直属。部署のチャンネルはその部署のID |
| `channels.purpose` | `normal`（通常）・`department`（部署の専用）・`announcement`（部署のお知らせ専用）・`company_general`（全社連絡。会社直属）・`case`（案件専用。**値の予約だけで、案件のテーブルや行は作らない**） |
| CHECK | `department`・`announcement`は`department_id`が必須かつ公開。`company_general`は`department_id`がNULL |
| 一意性 | `name_normalized`は、アーカイブ済み（`deleted_at`あり）を含めて会社内で一意（V-25・C-124）。物理削除すると再利用できる。`(department_id, purpose)`は`department`・`announcement`の行に限って一意（部署ごとに専用・お知らせが1つずつ） |
| アーカイブ | `deleted_at`・`deleted_by`で表す。一覧・閲覧・参加の判断は、`purpose`・`deleted_at`・`channel_members`の有無で行う |
| 参加 | `channel_members`の**行の有無**で表す。`state`列はない。退出・異動での除外は行の削除（S-11）。本名・メール等の個人情報は持たない |
| 自動チャンネルの手動改名の禁止（2-6 AC-5②） | 表の制約では防がない。後続のチャンネル編集のServiceが`purpose`を見て拒否する。部署の改名は、このIssueのRepositoryがチャンネルの名前を追従させる |
| 全社連絡 | `purpose = company_general`で#200が作る。部署名「全社連絡」を登録すると、#200の初期チャンネルと名前が衝突する（部署の専用チャンネルが同名で先に存在すると、#200の作成が一意制約で失敗する）。#200は、衝突時の扱いを決めてから作ること |
| CHECKの値を増やすとき | SQLiteは既存のCHECKを後から変えられないため、`purpose`などの許容値を増やすmigrationは、表の作り直し（新しい表を作り、行を写し、入れ替える）が必要。生成ツールで作る |

## 初代部署の専用チャンネルの補完（S-4）と、本番適用前の注意

#196より前に作られた部署（初回セットアップの初代部署など）には専用チャンネルがない。次の2つで補う。

- **今後のセットアップ**：`setup.repository.ts`の`createInitialAdmin`が、初代部署の専用チャンネル2つと初代管理者の参加を、同じbatchで作る
- **既存のDB**：`0009_backfill_department_channels.sql`が、専用チャンネルを持たない部署に2つのチャンネルと、その部署に所属する有効な社員の参加を補う。何度流しても同じ結果になる（すでに持つ部署は対象外）。チャンネルのルームIDは、部署IDの2文字目だけを専用は`Y`、お知らせは`Z`に置き換えた26文字。**衝突する部署は補わない**：既存のチャンネル名（アーカイブ済みを含む）や、補う部署どうしの名前（「X」と「Xのお知らせ」）と衝突する部署は、専用・お知らせの両方とも作らず、`audit_logs`に`department.channel_backfill`・`failure`・対象は部署ID・`detail`は`channel_name_conflict`で1件だけ記録する（migration自体は失敗させず、ほかの部署は補う）。補えなかった部署は、名前の衝突を解消してから別の手段で補う必要がある。無効な部署も対象に含まれる
- 手作成は[ADR-0021](../adr/0021-department-channel-backfill-migration-exception.md)の例外に限る

**本番適用前の注意（ローカルのリハーサルは確認済み、本番適用は未実施）**：

- 通常のDBテストは**空のDBにmigrationを流す**ため、補完のmigrationが効くのは「部署がすでにある状態」でだけであり、別に検証が要る。`backend/src/db/department-channel-backfill.db.test.ts`が、部署のある状態に0009を流して確かめている
- **ローカルの使い捨てD1でのリハーサルで確認済み**：0007まで適用 → 部署1件・有効社員2名（うちオーナー1）・無効社員1名を投入 → `wrangler d1 migrations apply`で0008・0009を適用。結果は、専用チャンネル1・お知らせ1・rooms 2・channel_members 4（無効社員は入らない）・衝突の失敗記録0。0009のSQLを直接再実行しても件数は変わらない（冪等）
- **本番のD1への適用は未実施**。[ADR-0021](../adr/0021-department-channel-backfill-migration-exception.md)のとおり、本番への適用は利用者の承認を得てから行う

## 未実装・未決定として記録するもの

| 項目 | 状態 |
| --- | --- |
| 案件への新オーナーの自動参加、案件専用チャンネルの参加、前オーナーの残留 | 親#125に残す（#147の完成後に統合） |
| 部署APIの試行制限（S-7） | 入れていない。取引先APIのレート制限（X-8）に相当する規則が部署にはないため。必要なら規則を決めてから別Issueで入れる |
| オーナー用の部署管理画面（S-13）の「部署の部分」（S-15） | 作らない。何を表示するかが要件で未確定 |
| 部署名に使える文字（S-10、V-29） | 制限しない（制御文字のみ拒否）。使用可能文字の規則を決めるときは、決定記録に追記して改める |
| 0009で補えなかった部署（名前の衝突）の復旧 | 補えなかった部署は専用チャンネルを持たないまま残る。この部署を改名しても、改名の最後の確認は「名前が違う自動チャンネルがない」ことだけで、2チャンネルの存在は確かめないため、改名は成功してもチャンネルは揃わない（作成のbatchには存在数の確認がある）。復旧は、運用の手順（衝突している名前のチャンネルまたは部署を解消してから、専用・お知らせの2チャンネルと参加者を作り直す）、または、改名のときに足りないチャンネルを作る別Issueで行う。どちらも未実施。補えなかった部署は`audit_logs`の`department.channel_backfill`・`failure`で見つけられる |
| 全社連絡と公開チャンネルの一覧・閲覧・参加、メッセージ | #200・#201 |
| 部署の無効化・削除 | 追加しない（2-1 AC-14） |
| 本番のD1での0008・0009の適用 | 未実施（ローカルのリハーサルは確認済み。本番は利用者の承認が別途必要。上の「本番適用前の注意」） |

## 主な入出力

| 処理 | 入力 | 出力 |
| --- | --- | --- |
| `createDepartmentService().create` | 操作者、`name`、`description?`、`ownerUserId?`、`previousDepartmentSuccessorUserId?` | 作成した部署、オーナーのID、専用・お知らせのチャンネルID |
| `createDepartmentService().rename` | 操作者、部署ID、`name`、`version` | 部署のID・名前・新しい版・更新日時 |
| `createDepartmentService().changeOwner` | 操作者、部署ID、`ownerUserId`、後任?、`version` | 部署のID・新オーナーのID・新しい版・更新日時 |
| `createDepartmentService().list` / `.listOwnerCandidates` | 操作者、`limit`・`cursor`（候補は`q`も） | カーソル方式のページ |
| `createDepartmentRepository().create` / `.rename` / `.changeOwner` | 入力と`DepartmentWrite`（操作者ID・trace ID） | 上の結果。前提が崩れていれば専用エラー（何も書かない、またはbatch全体を取り消し） |
| `canManageDepartments(env, userId, traceId)` | 環境、利用者ID、trace ID | `perm.workspace.create`の会社範囲の判定 |
| `announcementChannelName(name)` | 部署名 | 部署名＋「のお知らせ」 |

## テストの場所

- 共有規則：`backend/src/lib/department-rules.test.ts`（50・51文字、お知らせ名の境界、比較キー）
- DB結合：`backend/src/db/department.repository.db.test.ts`（作成・改名・交代・同時更新・途中失敗での全体取消・名前衝突・参加の付け替え）、`backend/src/db/channels.schema.db.test.ts`（表の制約）、`backend/src/db/department-channel-backfill.db.test.ts`（0009の補完・衝突・べき等）
- Service・route：`backend/src/services/department.service.test.ts`、`backend/src/routes/departments.test.ts`
- 既存テストの変更：`backend/src/routes/auth.test.ts`（セッションの`permissions`）、`backend/src/routes/setup.test.ts`（初代部署のチャンネル）、`backend/src/openapi.test.ts`
- テスト部品：`backend/test/department-fixtures.ts`、`frontend/src/test/department-harness.tsx`
- フロントエンド：`frontend/src/features/departments/DepartmentsManager.test.tsx`・`DepartmentCreateForm.test.tsx`・`departments-branches.test.tsx`、`frontend/src/departments-route.test.tsx`（ルートの権限）、`frontend/src/features/app-shell/navigation.test.ts`
- E2E：`e2e/departments.spec.ts`（[e2e.md](../testing/e2e.md)）。seedは`e2e/seeds/departments.sql`と`departments-cleanup.sql`

## 関係するIssue・ADR

- Issue #196：本Issue。親Issue #125（部署と案件の統合は親で行う）
- Issue #199：アカウントの個別発行（`SelectField`など共有ファイルが重なる）。#200・#201：後続
- ADR-0006：ID・カーソル／ADR-0012：サーバー側で毎回認可する／ADR-0018：`INT`初期登録の手作成例外／ADR-0020：ミューテーション・E2Eの実行範囲
- [ADR-0021](../adr/0021-department-channel-backfill-migration-exception.md)：初代部署の専用チャンネルを補う手作成migrationの例外
- 要件：2-1 AC-1・2・4・12・13・18、0-8 AC-1〜8・10、7-1 AC-1〜3、S-08・S-24。決定記録C-162・C-163
