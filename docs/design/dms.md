# ダイレクトメッセージ（DM。S-06。Issue #136）

## 目的

社員が、特定の相手と1対1でメッセージをやり取りできるようにする（1-2 AC-1〜AC-6）。やり取りは当事者だけが見られ、相手が不在でも送れて、ログインしたときに読める。相手のステータスと戻り予定をDMの画面の上部に出し、相手の選択でも部署とステータスを出す（6-1 AC-1・AC-4）。メッセージの一覧・投稿・2秒ポーリングは、#201の部品（[messages.md](messages.md)）をそのまま使う。

コードは書き写さず、ファイル名・関数名で指す。決定は決定記録C-168（[decision-register.md](../requirements/decision-register.md)）。

## 範囲

| 区分 | 内容 |
| --- | --- |
| このIssueで作ったもの | EP-1-05（開始）・EP-1-06（一覧）・新設の`GET /api/dms/:roomId`（詳細）／EP-1-01・EP-1-02のDMの枝／EP-7-01の`q`（表示名の検索）／migration 0016（`rooms.kind`を`direct`に）・0017（`conversations`・`conversation_members`）／S-06（`/dms/:roomId`）・相手の選択（`/dms/new`）・一覧（`/dms`）・サイドバーのDMの欄・下部メニューの「DM」／S-05・S-20・S-27の「DMを送る」／S-20の「表示名で検索」／DMの「退職者」の併記 |
| 作らないもの（別の起票先） | 未読【後からIssue #237で実装した。[unread.md](unread.md)】・下書き（#133）／チャンネルの「退職者」の併記（#133）【後からIssue #238で実装した。[messages.md](messages.md)】／添付（#140）／編集・削除（#134）／返信・リアクション・メンション・整理スペース・WebSocketによるリアルタイム化（#117）／DMの通知／投稿のレート制限（X-8が未決定）／グループDM（C-55）／本番への migration 0016・0017 の適用（完了条件に含めない。手順はADR-0025） |

## 全体の流れ

1. 利用者が、サイドバーの「＋ 新しいDM」（`/dms/new`）、S-20の行・S-27のカード、S-05の参加者の行の「DMを送る」から、`POST /api/dms`で相手を指定する。メッセージがなくてもDM（部屋・会話・当事者2人）を作り、新規・既存とも同じ形で`roomId`を返す
2. 画面は`/dms/:roomId`（S-06）に移る。`GET /api/dms/:roomId`で相手と`canPost`を取り、メッセージの一覧・投稿は`GET`・`POST /api/rooms/:roomId/messages`（#201）を使う。部屋のIDでチャンネルとDMを区別しない（部屋の種類はサーバーが判定する）
3. サイドバーの欄と一覧（`/dms`）は`GET /api/dms`で取る。最終活動の新しい順

## 表の構成（migration 0016・0017）

| 表 | 内容 |
| --- | --- |
| `rooms` | 部屋の共通の親。`kind`は`channel`か`direct`（CHECK `rooms_kind_check`）。DMの部屋は`direct` |
| `conversations` | DMの会話。`room_id`（主キー。`rooms.id`への外部キー）・`direct_key`（一意）・`created_at` |
| `conversation_members` | 当事者。（`conversation_id`・`user_id`）の複合主キー。索引`conversation_members_user_id_idx`。当事者は常に2人 |

- `direct_key`は、2人の利用者IDを小さい順に`:`でつないだ値（`backend/src/lib/dm-rules.ts`の`directKeyOf`。同じIDどうしは`Error`）。同じ2人のDMを重ねて作らないための一意制約
- 0016は`rooms`の作り直し（`rooms.kind`の`conversation`を`direct`に置き換え）。**`rooms`は`channels`・`messages`から外部キーで参照されるため、D1では生成物がそのまま通らず、PRAGMAの2行だけを`defer_foreign_keys`に置き換えた**（ADR-0025。0016の1本だけの例外。リハーサルの結果と本番適用の手順はADRに書いた）。0017は新しい表だけで、生成されたまま
- `rooms.kind`に`conversation`を書く本番コードはなかった。DB・テスト部品（`backend/test/message-fixtures.ts`の`insertDirectRoom`）の値を`direct`に合わせた

## ファイルと役割

### バックエンド

| ファイル | 役割 |
| --- | --- |
| `backend/db/schema.ts`、`backend/db/migrations/0016_change_room_kind_to_direct.sql`・`0017_add_conversations.sql`（と`meta/`） | 上の表の定義。`meta/`のsnapshot・journalは生成されたまま。`db:generate`の再実行で差分がない |
| `backend/src/lib/dm-rules.ts` | `directKeyOf`。画面にもDBにも依存しない純粋関数 |
| `backend/src/db/conversation.repository.ts` | `createConversationRepository`（`findRoomIdByDirectKey`・`findPartnerCandidate`・`create`・`listForUser`・`findForMember`）。`create`は部屋・会話・当事者2人を1回の`db.batch`で確定し、`direct_key`の一意制約違反を専用エラー`DirectConversationExistsError`に変える（ほかのDBエラーはそのまま伝える）。`withConversations`が構成する |
| `backend/src/db/conversation-list.sql.ts` | `listConversationRows`。DMの一覧のDAO。生SQLの実行と、結果の形のZod検証だけを行う |
| `backend/src/services/dm.service.ts` | `createDmService`（`start`・`list`・`get`）。判定の順とAppErrorへの変換。`withDmService`が構成する |
| `backend/src/routes/dms.ts` | `dmRoutes`（`POST /`・`GET /`・`GET /:roomId`）。入力の形（422）と応答だけを行う。`backend/src/index.ts`が`/api/dms`へ登録する |
| `backend/src/db/message.repository.ts`、`backend/src/services/message.service.ts` | EP-1-01・EP-1-02のDMの枝。詳細は[messages.md](messages.md)の「DMの部屋の判定の順」 |
| `backend/src/db/profile.repository.ts`、`backend/src/services/profile.service.ts`、`backend/src/routes/users.ts`、`shared/search-rules.ts` | EP-7-01の`q`。`listDirectory`が`keyword`を受ける。詳細は[profile-status.md](profile-status.md) |
| `docs/api/openapi.json`、`backend/src/openapi.test.ts` | `startDm`・`listDms`・`getDm`と、`listMessages`・`postMessage`・`listUsers`の変更 |
| `backend/db/seeds/cleanup.sql` | DMの後始末（下の「後始末」） |
| `stryker.config.json` | ミューテーションの対象に、DMと検索の重要処理（上の3ファイル、`shared/search-rules.ts`、`features/dms/**`、`MemberSearchField.tsx`）を足した（ADR-0020の範囲） |

### フロントエンド

依存の向きは、pages → features → 共通。`features/dms/index.ts`だけを公開し、他の層は`index.ts`を通して使う。

| ファイル | 役割 |
| --- | --- |
| `frontend/src/features/dms/api/dm-api.ts`、`query-keys.ts` | `startDm`・`fetchDms`・`fetchDm`。共通の`apiClient`だけを使い、応答をZodで検証する。キーは`dmKeys`（`all`・`list`・`detail(roomId)`） |
| `frontend/src/features/dms/hooks/` | `useDm`（詳細。404は待っても直らないため再試行しない）・`useDms`（カーソルで続きを取る。`uniqueDms`が`roomId`の重複を除く）・`useStartDm`（成功したら`dmKeys.all`を取り直す） |
| `frontend/src/features/dms/components/DmView.tsx` | S-06の中身。上部に`@表示名`・部署・`StatusBadge`、本体は`RoomMessages` |
| `frontend/src/features/dms/components/DmSection.tsx`・`DmItems.tsx`・`DmList.tsx` | サイドバーの欄、一覧の中身（サイドバーと一覧で共用。読み込み中・エラー・0件・ありの4つの状態）、`/dms`の中身 |
| `frontend/src/features/dms/components/DmPartnerPicker.tsx`・`StartDmButton.tsx` | 相手の選択、「DMを送る」ボタン |
| `frontend/src/features/dms/describe-error.ts` | 通信の失敗を利用者向けの文にする。`features/messages/describe-error.ts`・`features/channels/describe-error.ts`と内容が重複している（messages.mdの「未実施」の共通化と同じ扱い） |
| `frontend/src/pages/DmsPage.tsx`・`DmNewPage.tsx`・`DmPage.tsx` | 組み合わせだけ。`DmPage`は`roomId`を`key`にして、別のDMへ移るとき画面の状態（送信できなかった知らせ等）を持ち越さない |
| `frontend/src/App.tsx` | `/dms`・`/dms/new`・`/dms/:roomId`をレイアウトルートに登録 |
| `frontend/src/features/app-shell/SidebarNav.tsx`・`MobileNav.tsx`・`navigation.ts` | サイドバーの`DmSection`（`JoinedChannelsSection`の直後）、下部メニューの「DM」（ホーム → DM → 通知 → 自分）。[app-shell.md](app-shell.md) |
| `frontend/src/features/members/MemberSearchField.tsx` ほか | S-20とDMの相手の選択で共用する検索欄。`MembersList`の`q`・`renderMemberAction`・`renderProfileActions`、`useMembers(departmentId, q)`、`memberKeys.list(departmentId, q)` |
| `frontend/src/features/messages/components/`、`frontend/src/features/profile/ProfileCard.tsx`、`frontend/src/features/channels/components/ChannelDetailView.tsx` | 差し込み口（下の「機能の境界を保つ差し込み口」）と、S-05の参加者の行の「DMを送る」 |
| `frontend/src/pages/MembersPage.tsx` | S-20に検索欄を置き、「DMを送る」を`MembersList`へ差し込む |

## 判定の順（この順を変えない）

| 処理 | 順番 |
| --- | --- |
| 開始（`POST /api/dms`。`start`） | 形（422。Controller）→ `perm.dm.message.send`（403）→ 自分宛て（422。C-55）→ 相手がいない（404）→ 相手が無効（422。C-24）→ `direct_key`で既存を探して返す → なければ作る |
| 一覧（`GET /api/dms`。`list`） | 形（422。Controller）→ `perm.dm.message.view`（403）→ 自分が当事者のDMだけを読む（SQLの中で絞る） |
| 詳細（`GET /api/dms/:roomId`。`get`） | 形（422。`roomId`がULIDの形か。形だけの判定で存在は漏れない）→ 当事者か（404）→ `perm.dm.message.view`（403） |
| メッセージの一覧・投稿（EP-1-01・02のDMの枝） | 当事者か（404）→ 権限（一覧は`view`、投稿は`send`。403）→（投稿だけ）相手が無効なら409。[messages.md](messages.md) |

- **当事者でない人は、権限の有無にかかわらず404**。存在しない・チャンネルの部屋・他人のDMを区別しない（全体管理者・オーナーも同じ。ADR-0012）。詳細で当事者かを先にするのは、権限の拒否（403）で「そのIDのDMが存在する」ことを間接的に教えないため。当事者の判定は、自分が当事者の会話から入る読み取り（`findForMember`）だけで行い、当事者でない人にDMの中身を返す関数を作らない
- 一覧は、当事者の絞り込みがSQLの中にあるため、`authorize`が先
- 拒否（403）は`authorize`が監査（`logger.audit`）に残す。DMの権限は固定ロールの3つがすべて持つ
- 利用者IDはセッションから決め、本文・パラメータでは受けない。当事者は常に「セッションの利用者と相手」の2人

## `insertIfOrdered`のDMの条件と、権限をSQLに入れない理由

`message.repository.ts`の`insertIfOrdered`は、挿入の条件を「チャンネルの条件」**または**「DMの条件」にした（messages.mdの「条件付きのINSERT…SELECT」）。DMの条件は、投稿者が当事者であり、かつ当事者に無効な社員がいないこと。Serviceが確かめた後で、相手が無効化されても、無効な相手宛ての行を残さない（0行になり、Serviceが再判定して409にする）。

**権限（`perm.dm.message.send`）はSQLに入れない**。固定ロールの3つがすべて持ち、チャンネルの通常の投稿の権限もSQLに入れていないのと同じ扱いにしたため。権限はServiceの`authorize`だけで確かめる（拒否は監査に残る）。お知らせ専用の権限をSQLにも入れているのは、オーナー交代で結果が変わるから（messages.md）。

## 同時に作成したときの扱い

同じ2人が同時に「DMを送る」を押すと、確認から作成までの間に別の要求が先に作ることがある。`direct_key`の一意制約が最後の守りになり、後の1件は`create`が`DirectConversationExistsError`を投げ、**何も残らない**（`db.batch`は全体が取り消される）。`start`はこのエラーだけを受け止め、`direct_key`で読み直して先に作られた部屋を返す。読み直せなければ、想定外としてそのまま伝える（握りつぶさない）。ほかのDBエラーは受け止めずに伝える。

確認と作成の間に相手が無効化されると、無効な相手とのDMができうる。履歴は読め、投稿は409になるため、害はない（既定の方針7：不変条件を足さない）。

## 一覧のカーソル

並びは、最終活動（最後のメッセージのID。なければ部屋のID）の新しい順で、同じなら部屋のIDの新しい順。カーソルは（最終活動, 部屋ID）の組。**ページをまたぐ重複・読み飛ばしを許す**：ページを取っている間に、あるDMに新着があると最終活動が変わって別のページの位置へ動くため。画面は`uniqueDms`で`roomId`の重複を除く。読み飛ばしの扱いは、未読と一緒に#133で見直す。

## 取り直しの時機

DMの一覧・詳細に**ポーリングはかけない**。TanStack Queryの既定（マウント時・ウィンドウのフォーカス時。`staleTime`は0）で取り直し、自分の操作（開始・投稿）は`invalidateQueries`で即時に反映する。したがって、受け取った側のサイドバーは、画面を開いたときかウィンドウに戻ったときに更新される。リアルタイム化は#117（ADR-0004）。メッセージの一覧だけは、messages.mdの2秒ポーリングで更新される。

## 画面の構成

- **S-06（`DmView`）**：上部に`@表示名`（相手が有効なら`ProfileCardTrigger`、無効なら文字だけで「退職者」を併記しリンクなし）・部署（なければ「所属なし」）・`StatusBadge`（有効な相手だけ）。本体は`RoomMessages`（2秒ポーリング）。詳細の取得が404なら「この DM は見つかりません」（当事者でない・存在しない・チャンネルの部屋を区別しない）、そのほかの失敗は上にエラー。0件は「○○ さんへの最初のメッセージを送りましょう。相手が不在でも、ログインしたときに読まれます」。相手が無効なら入力欄の代わりに「相手のアカウントが無効になっているため、送信できません」
- **相手の選択（`DmPartnerPicker`。`/dms/new`）**：`MemberSearchField`（送信で確定。入力のたびには検索しない）と部署の絞り込み、`useMembers(departmentId, q)`。各行に表示名・部署・`StatusBadge`（文字つき）・「DMを送る」。**自分は候補に出さない**（セッションが届くまでは自分を除けないので、候補を出さない）。読み込み中・エラー・0件（「該当する社員がいません」）・あり・「さらに表示」の4状態
- **一覧（`DmList`。`/dms`）とサイドバーの欄（`DmSection`）**：`DmItems`を共用する。相手が無効なDMは表示名に「（退職者）」を併記する。【Issue #237で、`DmItems`が`useUnreadCounts`で部屋ごとの未読の件数を引き、名前の横に件数を出す（未読があれば名前を太字に。`RoomLinkLabel`）。取得に失敗している間は件数を出さず`UnreadCountsError`を出す。`DmView`は`useMarkRoomRead`で、表示している最新のメッセージまで既読を送る。[unread.md](unread.md)】取得に失敗しても、0件とは出さず、この部品の中にエラーを出す（枠は壊さない）
- **「DMを送る」（`StartDmButton`）**：送信中は押せない。成功したら`/dms/:roomId`へ移る（新規・既存とも）。失敗したら移らず、APIのメッセージをその場に出す。アクセシブルな名前（`aria-label`）は「{表示名} さんに DMを送る」で、見えている文字「DMを送る」をそのまま含める（WCAG 2.5.3）。相手の表示名も含むので、一覧の中で相手が違うボタンを区別できる。自分の行には出さない（表示の制御。認可はサーバー）

### 機能の境界を保つ差し込み口

依存の循環を避けるため、`dms`が他の機能の部品を使い、他の機能から`dms`は直接参照しない。次の任意のpropsを足した（既定値は既存の動きのまま）。

| 差し込み口 | 内容 |
| --- | --- |
| `MembersList`の`renderMemberAction`（行）・`renderProfileActions`（カード）、`ProfileCardTrigger`の`actions` | S-20の「DMを送る」を、`pages/MembersPage.tsx`から`StartDmButton`として差し込む。`members`・`profile`から`dms`を参照しない。S-06の`ProfileCardTrigger`には`actions`を渡さない |
| `RoomMessages`の`notFoundText`・`emptyText`・`cannotPostText`・`retiredAuthorIds`・`onPosted`・`onPostError`（`MessageList`・`MessageComposer`へ渡す） | DMの文言・「退職者」の併記・投稿後の処理を`features/dms`から渡す。`messages`から`dms`を参照しない。チャンネルの動きは変えない |
| `channels` → `dms` | `ChannelDetailView`が`StartDmButton`を、`dms/index.ts`の公開部分だけを通して直接使う（`dms`は`channels`を参照しない） |
| `app-shell` → `dms` | `SidebarNav.tsx`が`DmSection`を差し込み、`MobileNav.tsx`が`dmsNavItem`を使う |

### 「退職者」の併記はDMだけ

過去の投稿者の表示名に「（退職者）」を併記するのは、DMだけ（`RoomMessages`の`retiredAuthorIds`に、相手が無効なら相手のIDを渡す）。チャンネルの併記は#133に残す。【Issue #238で、チャンネルでも併記するようになった。EP-1-01の`author.isActive`（投稿者のアカウントが今有効か）が偽なら、`MessageList`が併記する（[messages.md](messages.md)の「退職者の併記（Issue #238）」）。DMも同じ応答を使うため、`isActive`でも併記される。DMの`retiredAuthorIds`は残し（`isRetired`は両方を見る）、重複の整理は#242で行う。元の記述は残す】投稿者の表示名は投稿時点のスナップショット（messages.md）で、併記は「今は無効」であることを示す。無効な相手のステータスは返さない（古い値を見せない。一覧・詳細とも`status`は`null`）。

### 開いている間に相手が無効になったとき（409）

入力欄が開いている間に相手が無効化されると、投稿が409になる。`DmView`の`onPostError`は、409のときだけ「相手のアカウントが無効になったため、送信できませんでした」を出し、**`dmKeys.all`を取り直す**（`dmKeys.detail`だけではなく`all`。詳細で`canPost`が偽になって入力欄が閉じ、サイドバー・一覧の相手の表示も更新される）。409以外のエラーは、`MessageComposer`が入力欄の近くに出す。

### 投稿後の処理（`onPosted`）の失敗は外へ伝える

投稿が成功したあとに呼ぶ`onPosted`（`DmView`では一覧の取り直し）は、`MessageComposer`の送信処理の`try`の**外**で呼ぶ。後処理の失敗を、送信の失敗として入力欄に表示せず、その場で`catch`して握りつぶすこともせず、**受け止めずに外へ伝える**（利用者の決定。AGENTS.mdの「エラーのもみ消し禁止」）。投稿自体は成功している（入力欄は空になる）。共通のロガーと、グローバルな受け止めは#234で扱う。

## 検索（`q`）：`LIKE`ではなく`instr`

EP-7-01の`q`は、`instr(lower(表示名), lower(検索語)) > 0`で絞る（`profile.repository.ts`の`listDirectory`）。**D1の`LIKE`はパターンが50バイトまでで**、日本語30文字（92バイト）で`LIKE or GLOB pattern too complex`（500）になり、100文字の検索語（C-90）を200で受けられなかったため、`LIKE`＋`ESCAPE`の案から変更した（C-168(3)）。`instr`は`%`・`_`・`\`を文字として扱い、値はパラメータで渡す。大文字小文字は、ASCIIだけ区別しない（`lower`の性質）。長さの定義元は`shared/search-rules.ts`で、サーバーと画面が参照する。詳細は[profile-status.md](profile-status.md)。

## EXPLAIN QUERY PLANの結果の要点

使い捨てのメモリDBに migration 0000〜0017 を適用して取った実測結果（実装の担当の報告）。**全件の走査（`SCAN`）はない**（`q`つきの社員一覧の部署指定なしを除く）。

| クエリ | 実測した計画 |
| --- | --- |
| DMの一覧（`listConversationRows`） | `SEARCH me USING INDEX conversation_members_user_id_idx (user_id=?)`／`SEARCH c USING COVERING INDEX sqlite_autoindex_conversations_1 (room_id=?)`／`SEARCH pm USING COVERING INDEX sqlite_autoindex_conversation_members_1 (conversation_id=?)`／`SEARCH u USING INDEX sqlite_autoindex_users_1 (id=?)`。最後のメッセージの相関サブクエリは `SEARCH m USING (COVERING) INDEX messages_room_id_id_idx (room_id=?)`。最後に `USE TEMP B-TREE FOR ORDER BY`（並べ替えの対象は自分のDMの件数分だけ） |
| 当事者の判定（`findForMember`・`findDirectForParticipant`） | `SEARCH cm USING COVERING INDEX sqlite_autoindex_conversation_members_1 (conversation_id=? AND user_id=?)`／`SEARCH pm …(conversation_id=?)`／`SEARCH u … (id=?)` |
| 投稿のDMの条件（`insertIfOrdered`） | `conversation_members` の主キーの索引だけを使う |
| `q`つきの社員一覧 | 部署の指定なし：`SCAN u USING INDEX users_display_name_idx`（表示名の順に走査する。部分一致なので全件を見る。#160で実測する）。部署の指定あり：`SEARCH u USING INDEX users_directory_idx (department_id=?)` |


## 認可・セキュリティ上の確認

- 当事者以外の404（本文も同じ）、全体管理者・オーナー・他の部署のオーナーも当事者でなければ見られない
- 利用者IDはセッションから決める。相手のIDだけを受け取る（`strict`）。状態を変えるAPIはOriginを確認する（`/api/*`に一括）
- DMの`roomId`の形は、ULIDだけを受け付ける（小文字・27文字・記号を含む値は422）。形が正しい他人のIDは404
- 検索語は値としてパラメータで渡し、SQLに埋め込まない。`'`・`;`・`--`・`OR 1=1`でも全件にならず、500にもならない
- ログ・監査に、本文・表示名・検索語を出さない。新しいログは足していない
- レート制限は入れていない（X-8が未決定）

## 後始末（テストデータ）

- `backend/db/seeds/cleanup.sql`（`npm run db:cleanup:test`）：テストの利用者（`testuser_`・`e2euser_`）が当事者に含まれる会話を、外部キーの順（メッセージ → 当事者の行（その会話の全員分）→ 会話 → 部屋）で消す。会話は、当事者の行を持たず、`direct_key`にテストの利用者のIDを含むものだけ。DMの部屋は、会話の行もメッセージも持たない`kind='direct'`のものだけを消す。残数に`remaining_conversations`・`remaining_direct_rooms`を足した
- `e2e/seeds/dms-cleanup.sql`：同じ順・同じ絞り方。会話・当事者・メッセージ・部屋・利用者の残数を返す（[e2e.md](../testing/e2e.md)）

## テストの場所

- 純粋関数：`backend/src/lib/dm-rules.test.ts`・`search-rules.test.ts`
- DB結合：`backend/src/db/conversation.repository.db.test.ts`・`conversations.schema.db.test.ts`（`direct_key`の一意・複合主キー・外部キー・作成の原子性・一覧のカーソル・クエリ数が件数に比例しないこと）・`channels.schema.db.test.ts`（`direct`は入り、`conversation`・`other`は拒否）
- Service・route：`backend/src/services/dm.service.test.ts`・`message.dm-authorize.test.ts`（偽の`authorizer`で、拒否時403・行が増えない・判定の順）・`message.dm-postable.test.ts`（ServiceとSQLの一致）、`backend/src/routes/dms.test.ts`・`messages.dm.test.ts`・`users.search.test.ts`、`backend/src/openapi.test.ts`
- テスト部品：`backend/test/dm-fixtures.ts`・`message-fixtures.ts`、`frontend/src/test/dm-handlers.ts`・`profile-handlers.ts`
- フロントエンド：`frontend/src/features/dms/`の`*.test.ts(x)`（`api/dm-api.test.ts`・`hooks/dm-hooks.test.tsx`・`DmView`・`DmSection`・`DmPartnerPicker`・`StartDmButton`）、`frontend/src/dms-route.test.tsx`、`features/app-shell/navigation.dms.test.ts`・`MobileNav.test.tsx`、`features/channels/channel-detail.dm.test.tsx`、`features/members/members.dm.test.tsx`、`features/messages/messages.dm-props.test.tsx`、`features/profile/profile-card.actions.test.tsx`、`pages/MembersPage.dm.test.tsx`
- E2E：`e2e/dms.spec.ts`（[e2e.md](../testing/e2e.md)）。本番形のスモーク`e2e-prod/csp-style.spec.ts`は、サイドバーが呼ぶ`GET /api/dms`を空の応答でモックする
- 既存テストの変更（C-168(1)・方針2・9）：`message-fixtures.ts`・`messages.test.ts`・`channels.schema.db.test.ts`（`conversation`→`direct`）、`MobileNav.test.tsx`・`e2e/notifications.spec.ts`の注記・`openapi.test.ts`・members系・`profile-handlers.ts`（項目の増加による件数・順番・名前。確かめる性質は変えていない）

## 未実施・未決定として記録するもの

| 項目 | 状態 |
| --- | --- |
| 未読・下書き・チャンネルの「退職者」の併記 | 下書き・チャンネルの「退職者」の併記は#133に残す（**チャンネルの併記は#238で実装した**。[messages.md](messages.md)）。**未読は#237で実装した**（サイドバーのDM欄と`/dms`の一覧の件数は`DmItems`、既読の送信は`DmView`。[unread.md](unread.md)） |
| リアルタイム化（受け取った側のサイドバーの即時更新） | #117。今は画面を開いたとき・フォーカス時に取り直す |
| 一覧のカーソルの重複・読み飛ばし | 許容している（画面で重複を除く）。#133で見直す【Issue #237では、未読が別のAPI（EP-3-01）で、DM一覧の並びに関係しないため見直していない】 |
| 共通のロガーとグローバルな受け止め（`onPosted`の失敗の扱いを含む） | #234 |
| 409のとき、詳細の取り直しが失敗するとアラートが2つ残る | 害が小さいため見送った（コードレビュー2回目の参考の指摘） |
| `q`の性能（全件走査） | #160で実測 |
| `describe-error.ts`の重複（`features/dms`・`messages`・`channels`） | 共通化していない。別のIssueで扱う |
| 投稿のレート制限 | 入れていない（X-8が未決定） |
| **本番のD1へのmigration 0016・0017の適用** | **未実施**。利用者の承認が別途必要。手順はADR-0025（件数の確認 → time-travelのブックマーク → コードのデプロイより先に適用 → 件数と整合性の確認 → 失敗したら止める） |

## 関係するIssue・ADR

- Issue #136：本Issue。親Issue #133。#201（メッセージ）・#130（プロフィール・社員一覧。`StatusBadge`・`ProfileCardTrigger`・EP-7-01）・#121（共通レイアウト）・#200（チャンネル）が先行
- [messages.md](messages.md)・[profile-status.md](profile-status.md)・[channels.md](channels.md)・[app-shell.md](app-shell.md)・[department-management.md](department-management.md)（`rooms`の約束）
- ADR-0004：ポーリングから始める／ADR-0006：ID・カーソル／ADR-0012：サーバー側で毎回認可する／ADR-0020：ミューテーション・E2Eの実行範囲／[ADR-0025](../adr/0025-rebuild-referenced-table-defer-foreign-keys.md)：参照される表の作り直し
- 要件：1-2 AC-1〜AC-6、6-1 AC-1・AC-4、7-3 AC-3。EP-1-01・EP-1-02・EP-1-05・EP-1-06・EP-7-01、S-06・S-20・S-27・S-05。決定記録C-168
