# チャンネルのメッセージの投稿・一覧と2秒ポーリング（Issue #201）

## 目的

チャンネルの参加者が、メッセージを投稿し、同じチャンネル（S-05）を開いている人の画面に、再読み込みなしで（2秒間隔のポーリングで）新着が出るようにする。あわせて、DM・スレッド・案件が後で使う「最後のID以降を取るAPI」の土台を作る（ADR-0004）。コードは書き写さず、ファイル名・関数名で指す。

## 範囲

| 区分 | 内容 |
| --- | --- |
| このIssueで作ったもの | EP-1-01（一覧）・EP-1-02（投稿）のうち、本文だけのチャンネルの部分／`messages`テーブル（migration 0012）／EP-2-06への`canPost`の追加／S-05の一覧・入力欄・2秒ポーリング／共通部品`TextAreaField` |
| 親#133に残すもの（未実施） | 未読（3-1。#124が要る）、下書き（1-1 AC-4）、退職者の併記（1-1 AC-3の後半）、編集・削除（#134）、Markdown、添付、メンション、リアクション、スレッド（返信）、DM【Issue #136で、DMの部屋の一覧・投稿は実装した。下の「DMの部屋（Issue #136）」。元の記述は残す】、過去へのスクロール（画面の「さらに古いメッセージ」）、自動スクロール、投稿の印（`pendingMarks`）、WebSocket（#117） |
| 範囲外（別の起票先に残す） | **無効にした部署のチャンネルを読み取り専用にすること**（部署の無効化が未実装のため。`department.repository.ts`に無効化の処理がない）。**投稿のレート制限**（上限がX-8で未決定のため入れず、別Issueで扱う）。キャッシュの件数の上限（長時間開いたときのメモリ。親#133に残す）。同時50人・2秒の実測（#160） |

## ファイルと役割

### バックエンド

| ファイル | 役割 |
| --- | --- |
| `backend/db/schema.ts`、`backend/db/migrations/0012_add_messages.sql` | `messages`テーブルと索引`messages_room_id_id_idx`（`room_id`, `id`）。`db:generate`で生成したmigration（手で書き換えていない）。本文の下限（1文字以上）だけをCHECKにし、上限はアプリで検証する（SQLiteの`length`はコードポイント数でUTF-16と数え方が違うため）。返信・編集・削除用の列は入れていない（後から`ADD COLUMN`で足せる） |
| `shared/message-rules.ts` | 本文の上限`MESSAGE_BODY_MAX_LENGTH`・`messageBodySchema`・純粋関数`canPostToChannel`の**定義元**。サーバーと画面が参照する。サーバー側の検証は省略しない |
| `backend/src/lib/ulid.ts` | `ulidAfter(previous, now)`を足した。指定したIDより必ず大きいULIDを返す（既存の`createUlidFactory`・`newUlid`は変えていない） |
| `backend/src/lib/cursor.ts` | 「最後のID以降」の共通部品`afterIdQuerySchema`（`after`は必須・ULID形式、`limit`は1〜100で既定100）と`toAfterIdPage`（`limit+1`件から`items`と`hasMore`を作る）を足した。DM・スレッドなどが同じ部品を使う |
| `backend/src/db/message.repository.ts` | `createMessageRepository`が`listLatest`（新しい順）・`listAfter`（ID昇順）・`maxId`・`findDisplayName`・`insertIfOrdered`（条件付きの投稿）を扱う。見えるかの読み取りは`channel.repository.ts`の`findForViewer`を再利用する。`withMessages`が構成する【Issue #136で、`findDirectForParticipant`（自分が当事者のDMか・相手が有効か）と、`insertIfOrdered`のDMの条件を足した】 |
| `backend/src/services/message.service.ts` | `createMessageService`が`list`・`post`を扱う。判定の順、お知らせ専用の権限（`authorize`）、表示名の取得、IDの作り直し（再試行）と503への変換。`withMessageService`が構成する【Issue #136で、DMの部屋の枝（当事者か → 権限 → 相手が有効か）を足した。下の「DMの部屋の判定の順」】 |
| `backend/src/routes/messages.ts` | `messageRoutes`（`GET /:roomId/messages`・`POST /:roomId/messages`）。入力は`validate`で確かめ（不正は422）、受付と返却だけを行う。`backend/src/index.ts`が`/api/rooms`へ登録する |
| `backend/src/db/channel.repository.ts` | `findForViewer`の取得項目に`purpose`を足した（足しただけ） |
| `backend/src/services/channel.service.ts` | EP-2-06の応答に`canPost`を足した。判定は`can`（拒否を監査に記録しない）で行い、規則は`canPostToChannel`の1か所にする |
| `docs/api/openapi.json`、`backend/src/openapi.test.ts` | 2操作のAPI仕様と、実routeとの契約確認（`openapi.test.ts`の組み立てに`/api/rooms`を足した） |
| `backend/db/seeds/cleanup.sql` | `messages`の削除を足した（外部キーの順：メッセージ → 参加者 → チャンネル → ルーム） |
| `stryker.config.json` | ミューテーションの対象に、メッセージ関連の重要処理（`shared/message-rules.ts`・`message.repository.ts`・`message.service.ts`・`routes/messages.ts`・`ulid.ts`・`cursor.ts`、フロントの`api`・`hooks`・`merge-messages.ts`・`components`）を足した（認可・取りこぼし防止の重要処理。ADR-0020の範囲） |

### フロントエンド

依存の向きは、pages → features → 共通。`features/messages/`は`index.ts`だけを公開し、`features/channels/components/ChannelDetailView.tsx`がそこから`RoomMessages`を使う。DM・スレッドが後で同じ部品を使えるよう、`channels`の中には置いていない。

| ファイル | 役割 |
| --- | --- |
| `frontend/src/features/messages/api/message-api.ts`、`query-keys.ts` | `fetchLatestMessages`・`fetchMessagesAfter`・`postMessage`。共通の`apiClient`だけを使い、応答はzodで検証する。`messageKeys.room(roomId)`が部屋ごとのキー |
| `frontend/src/features/messages/polling.ts` | `MESSAGE_POLL_INTERVAL_MS`（2000）と`MESSAGE_POLL_MAX_CONSECUTIVE_FETCHES`（5）。画面だけで使う値のため`shared/`には置かない |
| `frontend/src/features/messages/merge-messages.ts` | `mergeMessages`。既存の一覧と新着を、IDで重複を除いてID昇順に並べる純粋関数 |
| `frontend/src/features/messages/hooks/useRoomMessages.ts` | 2秒ごとの取得。`refetchInterval`で繰り返す |
| `frontend/src/features/messages/hooks/usePostMessage.ts` | 投稿。成功したらその部屋の一覧を`invalidateQueries`で取り直し、取り直しが終わるまで送信中のままにする |
| `frontend/src/features/messages/schemas/message-form.ts` | 入力チェック。本文の規則は`shared/message-rules.ts`を参照する |
| `frontend/src/features/messages/components/` | `RoomMessages`（一覧と入力欄を並べる。`roomId`・`canPost`・`joined`を受け取る）・`MessageList`（読み込み中・エラー・0件・ありの4つの状態。`role="log"`・`aria-live="polite"`）・`MessageComposer`（入力欄。React Hook Form＋Zod）【Issue #136で、`RoomMessages`に任意のprops（`notFoundText`・`emptyText`・`cannotPostText`・`retiredAuthorIds`・`onPosted`・`onPostError`）を足した。既定値はチャンネルの文言と動きのままで、DMは`features/dms`から渡す。`MessageList`は`emptyText`・`retiredAuthorIds`、`MessageComposer`は`onPosted`・`onPostError`を受ける】 |
| `frontend/src/features/messages/describe-error.ts` | 通信の失敗を利用者向けの文にする。`features/channels/describe-error.ts`と**内容が重複している**（下の「未実施・未決定」） |
| `frontend/src/components/TextAreaField.tsx` | 複数行の入力欄の共通部品（`TextField`と同じ作り）。素の`textarea`にクラスを書かない規則（ADR-0015）のために足した |
| `frontend/src/features/channels/api/channel-api.ts` | 詳細のスキーマに`canPost`を足した |
| `frontend/src/features/channels/components/ChannelDetailView.tsx` | 見出しの下に`RoomMessages`を置いた。未参加の公開チャンネルでは、入力欄の代わりに既存の「参加する」の案内を出す |

## 不変条件：部屋の中では、コミットの順にIDが増える

「最後のID以降」で新着を取る方式（`after=最後に見たID`）は、**後からコミットされたメッセージのIDが、すでに見たIDより小さい**と、そのメッセージを永久に取りこぼす。ULIDの単調性は同じWorkerのインスタンス内でしか保証されない（`ulid.ts`の説明、[調査メモ](../research/design-foundation.md)の12章）。別のインスタンスが少し遅れた時計で作ったIDや、同じミリ秒で乱数部が小さいIDは、先にコミットされた大きいIDより小さくなり得る。

そこで、アプリの時計に頼らず、DBで次の不変条件を保証する。

- **部屋の中では、コミットの順にIDが必ず増える**。投稿が成功したメッセージのIDは、その時点の部屋の最大のIDより必ず大きい
- したがって、`after=最後に見たID`で読む利用者は、後から確定したメッセージを必ず次の取得で得る（取りこぼさない）

### 条件付きのINSERT…SELECT

`message.repository.ts`の`insertIfOrdered`は、確認と挿入を**1文**で行う。挿入は、次のすべてを満たすときだけ行われ、挿入した行数（1か0）を返す。

1. **IDの順序**：同じ部屋に、挿入するID以上のIDがない（`NOT EXISTS (… room_id = ? AND id >= ?)`）
2. チャンネルがアーカイブされていない
3. 投稿者が今も参加者である
4. お知らせ専用（`purpose = announcement`）なら、投稿者がそのチャンネルの部署のオーナー、または全体管理者である

**【Issue #136で、DMの部屋を足した（C-168）。元の記述は残す】** 1に加えて、2〜4（チャンネルの条件）**または**次の条件のどちらかを満たすときに挿入する（SQLでは`(チャンネルの条件) OR (DMの条件)`）。5. DMの条件：投稿者がその部屋の当事者であり（`conversation_members`に行がある）、かつ当事者に無効な社員（`users.is_active = 0`）がいない。チャンネルの部屋は`conversation_members`に行がなく、DMの部屋は`channels`に行がないので、2つの条件が同時に成り立つことはない

DMの権限（`perm.dm.message.send`）は、**SQLに入れない**。固定ロール（メンバー・オーナー・全体管理者）がすべて持つため、チャンネルの通常の投稿（権限の判定がSQLにない）と同じ扱いにし、Serviceの`authorize`だけで確かめる。権限を持たせない（カスタムロール等）仕組みが入るときは、お知らせ専用のように、SQLの条件との一致をテストで固定する。

2〜4は、Serviceが投稿の前に確かめた後で状態が変わっても（アーカイブ・退出・オーナー交代）、条件を破る行を残さないための二重の守り。1文なので、確認から書き込みまでの間に別の投稿が入ることがない。

### 前提：D1は書き込みを直列に実行する

この1文が原子的であることは、D1が1つのデータベースへのクエリを1つずつ（直列に）処理することに依存する。根拠とする公式文書：

- <https://developers.cloudflare.com/d1/platform/limits/>
- <https://developers.cloudflare.com/d1/worker-api/d1-database/>

**状態：確認済み（2026-11-10。実装担当が上の公式文書を確認した。記載の要旨）。** limitsのページに「Each individual D1 database is inherently single-threaded, and processes queries one at a time」とある。各データベースは単一のDurable Objectで支えられ、read replicationを使うと、各レプリカは別のDurable Objectになる。d1-databaseのページには、`batch`は「sequentially, non-concurrently」に実行されるとある。この設計書の作成者自身は本文を取得していないため、要旨は実装担当の報告による。Cloudflareの文書は変わり得るので、仕様が変わったと分かったときは、この節を見直す。**前提：読み書きとも primary を使い、Sessions API・読み取りレプリカを使わない。** 直列実行が成り立たなくなったときは、案B（取得時に最後のIDの数秒前から読み、画面でIDにより重複を除く）の併用を検討する（弱い保証のため単独では採らない）。

**読み取りレプリカ（Sessions API）を使わない前提。** 今は使っていない。使うと、ポーリングが古いレプリカを読むことがあるが、増える方向（古い側が見えるだけ）なので、次の`after`で拾え、取りこぼしにはならない。ただし前提が変わるため、使う前にこの節を見直す。

### 追加の読み取りが要らない通常の場合

時計がそろっていれば、最初のIDで1回で挿入できる。条件のために索引`(room_id, id)`の末尾を1回読むだけで、追加の問い合わせは発生しない。

## 処理の流れ

### 判定の順（Service。この順を変えない）

`createMessageService`の`list`・`post`は、次の順で判定する。

1. **見えるか**（`channel-rules.ts`の`canViewChannel`）：アーカイブされておらず、公開か、参加中の非公開。見えなければ**404**。存在しない・非公開で未参加・アーカイブ済み・チャンネルでない部屋（DMなど。`channels`に行がない）を区別しない（存在を開示しない）
2. **参加者か**：未参加なら**403**（公開チャンネルは未参加でも**読める**ので、一覧は200、投稿だけが403）
3. **お知らせ専用なら権限**（`purpose = announcement`のとき）：`perm.announcement.post`を部署の範囲（`channel.departmentId`）で`authorize`する。持たなければ**403**。拒否は`authorize`が`logger.audit`に記録する。全体管理者・オーナーでも、**未参加なら②で403**（参加者だけが投稿できる、を先に判定する）
4. 本文の形（1〜4,000文字、空白だけは不可、余分な項目は不可）は**Controllerの`validate`が先に422**にする。見えないチャンネルに不正な本文を送ると422になり得るが、本文の形だけの判定で、存在の開示にはならない（既存の`channels`のルートと同じ順序）

#### DMの部屋の判定の順（Issue #136。C-168。元の記述は残す）

上の1の「チャンネルでない部屋（DMなど）を区別しない」は、**当事者でないDM**を指すように変わった。部屋の種類は、まずチャンネルとして探し（`findRoomForViewer`）、見つからなければDMとして探す（`findDirectForParticipant`。自分が当事者のDMなら、相手が有効かを返す）。チャンネルの経路の問い合わせは増やしていない。DMの部屋は、次の順で判定する。

1. **当事者か**：当事者でない・存在しない部屋は**404**（文言はチャンネルと同じ。全体管理者・オーナーも当事者でなければ404）
2. **権限**：一覧は`perm.dm.message.view`、投稿は`perm.dm.message.send`を`authorize`する。持たなければ**403**（拒否は`authorize`が監査に残す）
3. **（投稿だけ）相手が有効か**：無効なら**409**（`CONFLICT`）。一覧は相手が無効でも**200**で読める

投稿の0行のときの再判定でも、同じ順で確かめる（当事者でなくなれば404、相手が無効になっていれば409）。DMの詳細（`GET /api/dms/:roomId`）は`dm.service.ts`が扱い、詳しい順番は[dms.md](dms.md)に書く。

### 投稿（`POST /api/rooms/:roomId/messages`）

1. `post`が判定の順を確かめ、`findDisplayName`で投稿者の現在の表示名を取る（`users`がなければ401）
2. `newUlid`でIDを作り、`createdAt`を取り、`insertIfOrdered`を呼ぶ。`sender_id`・表示名はセッションの利用者から決め、本文の`body`以外は受け付けない（`strict`）
3. 1行入ったら、`id`・`roomId`・`createdAt`を返す（201）
4. **0行のとき**（`changes = 0`）は、もみ消さずに原因を読み分ける：
   1. 判定の順（見えるか・参加者か・権限）をもう一度確かめる。崩れていれば、**404／403**にする（再試行を使い切った最後の挿入の後にも確かめ、503に隠さない）
   2. 崩れていなければ、**IDが部屋の最大以下だった**。`maxId`で最大のIDを読み、`ulidAfter`で**それより必ず大きいID**を作って、再試行する
5. **再試行は3回まで**（最初の1回に加えて）。上限を超えたら、WARNでログに残し（`roomId`だけ。本文は出さない）、**503** `SERVICE_UNAVAILABLE`を返す。使い切った後の状態の再確認で404／403になる場合は、そちらを優先する
6. **`createdAt`は再試行のたびに取り直す**。作り直したIDの投稿が、直前の投稿より過去の時刻にならないようにするため
7. 未知のDBエラーはそのまま再送出する（`app.onError`に任せる）

### `ulidAfter`

指定したIDより必ず大きいULIDを返す。時刻部は`max(now, 前のIDの時刻)`で、前のIDと同じ時刻になるときは、乱数部に1を足して昇順を保つ。乱数部が桁あふれするときは`Error`を投げる。形式が不正なID・範囲外の時刻も`Error`。

### 一覧（`GET /api/rooms/:roomId/messages`）

- クエリは`after`・`cursor`・`limit`。**`after`と`cursor`の同時指定は422**（排他）。余分なクエリは422
- **`after`なし**：新しい順に`limit`件（既定`PAGE_LIMIT.message`＝50）と`nextCursor`（より古い側の続き。`cursor.ts`の`afterCursor`・`toPage`）。画面の初回の取得に使う
- **`after`あり**：ID昇順で、`after`**より後**（`after`自身は含まない。`afterId`は`gt`）を`limit`件（既定100、最大100）。**取得上限**を超える分があるとき`hasMore`が真になる（`limit+1`件を読み、`limit`件に切る）。壊れた`after`は422
- 項目は`id`・`roomId`・`author`（`id`・`displayName`）・`body`・`createdAt`。EP-1-01のそのほかの項目（`editedAt`・`deleted`・`attachments`・`reactions`・`replyCount`・`pendingMarks`）は範囲外のため返さない
- GETはDBを変えない。一覧は`messages`だけを読む（表示名はスナップショット列のため`users`を結合しない）

### 表示名のスナップショット

`messages.sender_display_name`に、**投稿時点**の`users.display_name`を保存する。応答の`author.displayName`はこの値を返すので、投稿者が後で表示名を変えても、過去の投稿は変わらない（AC-6）。退職者の併記は親#133に残す。

### 認可：お知らせ専用の権限（ServiceとSQLの両方）

お知らせ専用への投稿の権限は、**同じ規則を2か所で判定する**。

| 場所 | 判定 | 役割 |
| --- | --- | --- |
| Service（`requirePostable`の`authorize`） | `perm.announcement.post`を部署の範囲で。権限を持つのは、自部署のオーナーと全体管理者（`permission-resolver.ts`） | 拒否を`logger.audit`に残す。403を返す |
| SQL（`insertIfOrdered`の条件4） | 役割`ROLE_IDS.owner`（同じ`department_id`）か`ROLE_IDS.globalAdmin`の`EXISTS` | 確認から書き込みまでの間にオーナーが交代しても、交代前のオーナーの投稿を通さない |

この2つが食い違うと、権限の定義とSQLが別の人を許してしまう。**4者（自部署のオーナー／全体管理者／一般の参加者／他部署のオーナー）で、Serviceの判定とSQLの結果が一致する**ことを`backend/src/services/message.postable-permission.test.ts`で固定している。権限の定義（`backend/src/lib/permissions.ts`）を変えるときは、このテストが落ちるはずなので、SQLも同時に直す。

- **全社連絡（`company_general`）は、参加者なら誰でも投稿できる**。権限で制限するのはお知らせ専用だけ。`department_id`が`NULL`のため、部署の範囲を`authorize`・`can`に渡さない。この規則は`canPostToChannel`・EP-2-06の`canPost`・投稿APIのいずれも同じ
- **仮定U-14**：要件（use-cases・2-1 AC-16・2-3）に全社連絡の投稿制限の記載がないため、「制限はない」と仮定した。**デモで利用者に確認する**
- 詳細（EP-2-06）の`canPost`は`can`で判定し、監査に記録しない。拒否を記録するのは投稿APIの`authorize`だけ（お知らせ専用の詳細を一般の参加者が開いても、拒否の監査は増えない）

### 監査ログ

**投稿の監査ログは残さない**。EP-1-02に監査（X-12）の指定がなく、Skill「バックエンド」の対象（ログイン・権限変更・認可の拒否・管理者の操作）にも当たらない。認可の拒否は`authorize`が記録する。投稿は`INSERT`1文で原子的に書く。

### フロントエンドのポーリング

`useRoomMessages`が、一覧を**Queryのキャッシュだけ**に持つ（`useState`にコピーしない）。

- 初回（キャッシュが空）：`fetchLatestMessages`で最新50件（新しい順）を取り、昇順に直す
- 以降：キャッシュの**末尾のID**から導いた`after`で`fetchMessagesAfter`を呼ぶ。`hasMore`が真の間は待たずに続けて取り、**1回のポーリングで最大5回**（`MESSAGE_POLL_MAX_CONSECUTIVE_FETCHES`）。残りは次の間隔で取る。`mergeMessages`でIDの重複を除いて昇順にする
- 繰り返し：`refetchInterval`が**2秒**（`MESSAGE_POLL_INTERVAL_MS`。`polling.ts`）。`useEffect`・`setInterval`は使わない
- **非表示のタブでは止まる**（`refetchIntervalInBackground`は既定の偽）。`useRoomMessages`の`visibilitychange`の購読が、非表示から表示に戻ったとき、次の間隔を待たずに取り直す（取得中なら重ねない）。取りこぼしは`after`で起きない
- **停止する失敗**：401・403・404は、待っても直らないので`refetchInterval`が偽を返し、要求を重ねない。401は共通の処理（`features/auth/unauthenticated-handler.ts`）が1回だけ`/login`へ移す。404で止まったら、`RoomMessages`が「このチャンネルは表示できません」を出し、一覧も入力欄も出さない（403で`/login`には移らない）
- それ以外の失敗（500など）：`retry: false`で、取得済みの一覧をキャッシュに残したまま、`MessageList`が上にエラーを出し、次の間隔でもう一度取る。取得に失敗したのに0件とは出さない
- 自分の投稿の後の取り直しと定期の取り直しが重なっても、同じキーの取得は1つにまとまり、`mergeMessages`が重複を除く。別のチャンネルへ移ると、キーが変わるので混ざらない
- `notifyOnChangeProps`で、取得のたびの`isFetching`の切り替えでは描き直さない

### 入力欄

- **Enterは改行**。**Ctrl+Enter（MacはCmd+Enter）か「送信」ボタンで送る**。送信中は「送信」を押せず、Ctrl+Enterでも送らない（多重送信の防止）
- 画面でも入力を確かめる（空白だけ・4,000文字超）が、サーバーの検証が正（422の`fields`に`body`があれば入力欄の下に出す）
- 成功したら入力欄を空にする。本文はテキストとして出し、`dangerouslySetInnerHTML`を使わない（改行は表示のスタイルで保つ）

## API契約

詳細な形はOpenAPI（`docs/api/openapi.json`）と[api-draft.md](../requirements/api-draft.md)のEP-1-01・EP-1-02・EP-2-06に従う。

| 操作 | 契約 |
| --- | --- |
| 一覧（EP-1-01の一部） | `GET /api/rooms/{roomId}/messages`。`after?`・`cursor?`・`limit`。`after`なしは200で`items`（新しい順）と`nextCursor`、`after`ありは`items`（ID昇順）と`hasMore`。401／404／422 |
| 投稿（EP-1-02の一部） | `POST /api/rooms/{roomId}/messages`。本文は`body`だけ。201で`id`・`roomId`・`createdAt`。401／403（未参加の公開・お知らせ専用で権限なし）／403（Origin）／404／422／503（IDの作り直しが上限を超えた） |
| 詳細（EP-2-06） | 応答に`canPost`（参加者で、お知らせ専用なら部署のオーナーか全体管理者）を足した。既存の項目は変えていない |

## 主な入出力

| 処理 | 入力 | 出力 |
| --- | --- | --- |
| `createMessageService().list` | 操作者、ルームID、`{ after, limit }`または`{ cursor?, limit }` | `after`あり：`{ items, hasMore }`、なし：`{ items, nextCursor }`。見えなければ404 |
| `createMessageService().post` | 操作者、ルームID、本文 | `{ id, roomId, createdAt }`。見えない404／未参加・権限なし403／再試行超過503 |
| `createMessageRepository().insertIfOrdered` | ID・ルームID・投稿者ID・表示名・本文・`createdAt?` | 挿入した行数（1か0）。0は条件を満たさなかった |
| `ulidAfter(previous, now?)` | 前のID、時刻 | `previous`より大きいULID。桁あふれは`Error` |
| `canPostToChannel({ purpose, isMember, canPostAnnouncement })` | 目的・参加者か・お知らせの権限 | 真偽 |
| `mergeMessages(current, incoming)` | 既存の一覧、新着 | IDの重複を除いたID昇順の一覧 |

## D1の直列実行と性能（前提とリスク）

- 不変条件は、D1が1つのDBの書き込みを直列に実行することに依存する（上の「前提」。公式文書で確認済み・2026-11-10）
- 条件のために、挿入のたびに索引`(room_id, id)`の末尾を1回読む。性能は#160で実測する
- 2秒ポーリングは1人あたり毎分30回の読み取りになる。新着がなければ索引の探索1回で0行。**空の部屋でも2秒ごとに最新の取得（`after`なしの50件）を繰り返す**（キャッシュが空のままのため）。負荷は#160で実測し、問題なら対応する
- 索引は`EXPLAIN QUERY PLAN`で`(room_id, id)`が使われることを確かめ、結果をIssueに残す

## テストの場所

- 純粋関数：`shared/`の規則は`backend/src/lib/message-rules.test.ts`、`backend/src/lib/ulid.after.test.ts`・`ulid.boundary.test.ts`、`backend/src/lib/cursor.after-id.test.ts`・`cursor.boundary.test.ts`
- DB結合：`backend/src/db/message.repository.db.test.ts`（条件付きINSERT・IDの順序・同時投稿・別の部屋）、`backend/src/db/messages.schema.db.test.ts`（表の制約と索引）、`backend/src/db/company-general-backfill.db.test.ts`（「0011が最後」の決め打ちを「0010の直後」に変えた）
- Service・route：`backend/src/routes/messages.test.ts`・`messages.boundary.test.ts`・`messages.validation-shape.test.ts`・`channels.can-post.test.ts`、`backend/src/services/message.service.retry.test.ts`・`message.service.exhausted.test.ts`・`message.service.created-at.test.ts`・`message.postable-permission.test.ts`（ServiceとSQLの権限の一致）、`backend/src/openapi.test.ts`
- テスト部品：`backend/test/api-request.ts`・`message-fixtures.ts`、`frontend/src/test/message-handlers.ts`
- フロントエンド：`frontend/src/features/messages/merge-messages.test.ts`、`hooks/useRoomMessages.test.tsx`（fake timers）、`messages.components.test.tsx`、`messages.mutation.test.tsx`、`frontend/src/features/channels/channel-detail.messages.test.tsx`、`channels.components.test.tsx`、`frontend/src/channels-route.test.tsx`
- E2E：`e2e/messages.spec.ts`（[e2e.md](../testing/e2e.md)）。シードは`e2e/seeds/messages.sql`・`messages-cleanup.sql`

## 未実施・未決定として記録するもの

| 項目 | 状態 |
| --- | --- |
| 親#133の残りの受け入れ条件（未読、下書き、退職者の併記） | 親に残す。このIssueでは作っていない。**DMの「退職者」の併記だけはIssue #136で実装した**（チャンネルは#133に残す。[dms.md](dms.md)） |
| 無効にした部署のチャンネルの読み取り専用 | 範囲外。部署の無効化が未実装のため。実装したら、条件付きのINSERTの条件に**部署が有効であること**を足す |
| 投稿のレート制限 | 入れていない。上限がX-8で決まっていないため、別Issueで扱う（[project-rules.md](../project-rules.md)。Skill「セキュリティ」の「公開するAPIすべてにレート制限」に従えない点） |
| U-14：全社連絡の投稿規則 | **仮定**（参加者なら誰でも投稿できる）。デモで利用者に確認する |
| `features/messages/describe-error.ts`と`features/channels/describe-error.ts`の重複 | 今回は共通化していない。別のIssueで共通化する |
| 空の部屋での2秒ごとの最新取得 | 上記のとおり。#160で実測する |
| `merge-messages.ts`のミューテーションのスコア | 他より低めである。理由：`mergeMessages`の比較関数は、IDが重複しない前提では`a.id < b.id`と`a.id <= b.id`などが同じ結果になる**同値変異**が生き残るため。振る舞い（重複の除去・昇順）は単体テストで確かめている。計測値はIssueとPRに記録する |
| 過去へのスクロール、自動スクロール、Markdown、添付、メンション、リアクション、スレッド、編集・削除 | 未実装（親#133以降） |
| D1の直列実行の公式文書の照合 | 確認済み（2026-11-10。上の「前提」）。ただし、Sessions API・読み取りレプリカを使わないことが前提 |
| **本番のD1へのmigration 0012の適用** | **未実施**。利用者の承認が別途必要。ローカルの使い捨てD1でのリハーサルは実施済み：①0011まで適用済みでデータのあるDBに0012を適用、②新規のDBに全migrationを適用 |

## 関係するIssue・ADR

- Issue #201：本Issue。親Issue #133。#200（チャンネル。`channel.repository`・EP-2-06・S-05が重なる）が先行。DM・スレッド・案件（#133の後続）が「最後のID以降」の部品を使う
- Issue #136：DMの部屋の一覧・投稿を、この設計の上に足した（`insertIfOrdered`のDMの条件、判定の順のDMの枝、`RoomMessages`の任意のprops）。詳細は[dms.md](dms.md)。決定記録C-168
- [channels.md](channels.md)（#200）、[department-management.md](department-management.md)（#196。`rooms`・`channels`・`channel_members`の約束）
- ADR-0004：ポーリングから始める／ADR-0006：ID・カーソル／ADR-0012：サーバー側で毎回認可する／ADR-0015：共通部品を使う／ADR-0020：ミューテーション・E2Eの実行範囲
- 要件：1-1 AC-1〜6、1-9 AC-1、2-3 AC-4、S-05。EP-1-01・EP-1-02・EP-2-06
