# 設計書：スレッドの返信とスレッド一覧

Issue #137（親：#133）。メッセージに返信し（スレッド。S-07）、自分が関わるスレッドを一覧する（S-35）。コードは書き写さず、ファイル名・関数名で指す。

## 目的

- 1-4 AC-1〜AC-4を実装する。参加者がメッセージに返信でき、返信は元のメッセージに紐づいて表示される。元のメッセージが削除されたら、既存の返信は残して読めるが、新しい返信は付けられない（C-59）。サイドバーの「スレッド」から、自分が関わるスレッドの一覧を開ける
- 返信は1段だけ（返信への返信は作らない）。返信も同じ部屋の「コミットの順にIDが増える」並びに入れ、部屋とスレッドのどちらの「最後のID以降」でも取りこぼさない（[messages.md](messages.md)の不変条件）
- 決定の記録は`docs/requirements/decision-register.md`のC-172（利用者の決定U-1〜U-8、統括の決定、計画で決めた案）。C-147の「スレッドごとの既読位置は未決定」を置き換えた

## 範囲

| 区分 | 内容 |
| --- | --- |
| このIssueで作ったもの | EP-1-07（返信の取得）・EP-1-08（返信の投稿）・EP-3-08（スレッド一覧）・EP-3-09（スレッドの既読）／EP-1-01への`parentMessageId`・`replyCount`の追加と、返信を一覧に含めない変更／`messages.parent_message_id`と表`thread_read_positions`（migration 0020）／S-07（スレッドの領域）・S-35（`/threads`）・サイドバーの「スレッド」・各投稿の「返信 n 件」／返信の入力欄の下書き（scope `thread:<部屋ID>:<親ID>`） |
| 作らないもの | 添付（#140）、リアクション（#138で別途追加。現在の仕様は[reactions.md](reactions.md)を参照）、メンション（#139で別途追加。現在の仕様は[mentions.md](mentions.md)を参照）、返信の通知、古い返信へのスクロール、他の人の編集・削除の即時反映（#117）、S-07を閉じる・S-35で別のスレッドへ切り替えるときの離脱の確認（#245。U-8）、サイドバーのスレッドの未読の合計（#240で検討）【#140で、返信への添付を別途追加した。現在の仕様は[attachments.md](attachments.md)を参照。元の記述は残す】 |

## データ

| 対象 | 内容 |
| --- | --- |
| `messages.parent_message_id` | NULL可・`messages(id)`への外部キー。返信のときだけ親のIDが入る。必ず最後の列にする（`message.repository.ts`の`insertIfOrdered`が`INSERT … SELECT`の末尾のNULLを列の並びに合わせて持つため。列を足したら、NULLの数を合わせる） |
| `thread_read_positions` | 主キー（`user_id`, `parent_message_id`）。`last_read_message_id`は外部キーにしない（`read_positions`と同じ。C-169(5)）。ADR-0006（既読位置が正で、件数は上限つきで数え直す）をそのまま当てはめた。スレッドへの関与（親の投稿者か、返信したか）は表に持たず`messages`から導く |
| 索引`messages_parent_message_id_id_idx`（`parent_message_id`, `id`） | 返信の取得・返信の件数・最後の返信・スレッドの未読の数え直し |
| 索引`messages_sender_id_parent_message_id_idx`（`sender_id`, `parent_message_id`） | 一覧の「自分が親の投稿者・自分が返信した」を、自分の投稿だけから引くため。ないと、会社全体の返信か`messages`の全件を走査する（実行計画は下の「EXPLAIN QUERY PLAN」） |

- migration `backend/db/migrations/0020_add_message_threads.sql`は`db:generate`の生成物のまま（列の追加は`ALTER TABLE … ADD`で、作り直しは生成されない。ADR-0024の書き換えは不要）。定義は`backend/db/schema.ts`
- **本番のD1へのmigration 0020の適用は未実施**（利用者の承認が別途必要）
- 共通のテストデータの削除`backend/db/seeds/cleanup.sql`は、削除するメッセージの集合を基準に、①その集合のメッセージを親とする返信（送った人がテストの利用者でなくても）を削除の集合に含める（テスト以外の利用者の返信を消した件数は`removed_foreign_replies`として別に出す）②その集合を親とする`thread_read_positions`とテストの利用者の既読を、メッセージより先に消す③返信を先に、親を後に消す。残数に`remaining_thread_read_positions`を足した

## ファイルと役割

### バックエンド

| ファイル | 役割 |
| --- | --- |
| `shared/message-rules.ts` | `REPLY_BLOCKED_REASONS`（`deleted_parent`・`not_joined`・`read_only`・`partner_inactive`）。返信できない理由の定義元。応答と画面の案内が同じ値を参照する |
| `backend/src/db/reply-insert.sql.ts` | DAO。返信の条件付き`INSERT … SELECT`1文（`insertReplyIfOrdered`）。条件は下の「書き込みの条件」 |
| `backend/src/db/message.repository.ts` | `listLatest`・`listAfter`に`parent_message_id IS NULL`と`replyCount`を追加。返信の関数：`findThreadParent`（親の確認用）・`findItem`（親の1件の表示用）・`listRepliesLatest`・`listRepliesAfter`・`insertReplyIfOrdered`。`maxId`は返信も含めた部屋全体のまま変えない。`toItem`はスレッド一覧の親の項目にも使う |
| `backend/src/services/message.service.ts` | `listReplies`（EP-1-07）・`postReply`（EP-1-08）・内部の`requireReplyable`・`requireReadableThread`・`roomReplyState`（`joined`・`roomWritable`・部屋が原因の理由を1か所で求める） |
| `backend/src/db/thread-list.sql.ts` | DAO。スレッド一覧の1本目のSQL（`listThreadRows`）。自分が投稿・返信・メンションしたスレッドの抽出、見える範囲の絞り込み・並び・LIMITを内側で済ませ、件数・部屋・既読位置は件数が決まった後の行にだけ付ける |
| `backend/src/db/thread-unread-counts.sql.ts` | DAO。スレッドごとの未読数の2本目のSQL（`listThreadUnreadCounts`）。スレッドと下限の組を`json_each`1つのパラメータで渡し、スレッドの数でクエリもパラメータも増えない |
| `backend/src/db/thread.repository.ts` | `createThreadRepository`の`listThreads`。2本のSQLをつなぎ、`unreadLowerBound`（スレッドの既読位置・チャンネルの`joined_at`）で下限を決める。`toPage`で`nextCursor`を作る |
| `backend/src/services/thread.service.ts` | `createThreadService`の`list`。`perm.notification.own`を`authorize`し、`perm.dm.message.view`を`can`で調べて、持たなければDMのスレッドを条件で除く |
| `backend/src/db/thread-read-advance.sql.ts` | DAO。スレッドの既読位置を進める条件付きupsert1文（`advanceThreadReadPosition`）。後戻りさせない |
| `backend/src/db/read-position.repository.ts` | `advanceThread`・`replyExistsInThread`・`threadPosition`（0行のときの読み分けに使う） |
| `backend/src/services/unread.service.ts` | `markThreadRead`（EP-3-09）。判定の順は下の「判定の順」 |
| `backend/src/routes/messages.ts` | `GET`・`POST /api/messages/:messageId/replies`（既存の`PATCH`・`DELETE /:messageId`と同じルート） |
| `backend/src/routes/threads.ts` | `GET /api/me/threads`。`cursorQuerySchema`に`.strict()`（余分なクエリを受け付けない）。`no-store` |
| `backend/src/routes/thread-read-positions.ts` | `PUT /api/messages/:messageId/thread-read-position`。本文は`{ lastReadMessageId }`だけ（`.strict()`）。`no-store` |
| `backend/src/index.ts` | `/api/me/threads`は`/api/me`より前に登録（既存の`/api/me/notifications`と同じ理由） |
| `backend/src/db/unread-counts.sql.ts`・`conversation-list.sql.ts` | 既存の変更：部屋の未読に返信を数えない（U-2）、DM一覧の並び（最終活動）に返信を含めない（U-3） |
| `docs/api/openapi.json` | EP-1-07・EP-1-08・EP-3-08・EP-3-09の追加と、EP-1-01の項目の追加 |

### フロントエンド

依存の向きは、`channels`・`dms`・`pages` → `threads` → `messages`・`unread`・`drafts`の一方向（機能間は`index.ts`だけを通す。`npm run deps:check`）。

| ファイル | 役割 |
| --- | --- |
| `features/threads/`（`index.ts`） | 公開は`ThreadLayout`・`ThreadList`・`ThreadPane`・`useThreadParam` |
| `features/threads/components/ThreadLayout.tsx` | チャンネル詳細・DM詳細の枠。`?thread=`があるとき、本体の隣（スマートフォンでは全画面）に`ThreadPane`を出す。**開いていても閉じていても同じ構造を返す**（下の「画面」） |
| `features/threads/components/ThreadPane.tsx` | S-07の領域。見出し「スレッド」・閉じる・`ThreadReplies`・既読の失敗の表示。参加者として最新の返信が表示されたら既読を送る。閉じたら、開いた要素へフォーカスを戻す |
| `features/threads/components/ThreadList.tsx` | S-35の一覧部分（4状態・未読の印・「さらに表示」・100件の案内） |
| `features/threads/hooks/useThreadParam.ts` | URLのクエリ`?thread=<親ID>`の読み書き（ほかのクエリを残す） |
| `features/threads/hooks/useMyThreads.ts` | `useInfiniteQuery`。先頭から最大5ページまで。2秒ごとの取り直し（`pollIntervalUnlessDenied`。権限がない・見つからないときは止める） |
| `features/threads/hooks/useMarkThreadRead.ts` | `useReadPositionSender`でスレッドの既読を送り、成功したら`threadKeys.all`を取り直す |
| `features/threads/api/thread-api.ts`・`query-keys.ts` | EP-3-08・EP-3-09の通信と応答のZod、`threadKeys` |
| `features/messages/components/ThreadReplies.tsx` | S-07の中身（親の表示・返信の一覧・返信の入力欄・案内）。親は表示だけ |
| `features/messages/hooks/useThreadReplies.ts` | 返信のキャッシュ（`messageKeys.thread`）と、2秒ごとの「最後のID以降」の取り足し。親・`replyBlockedReason`・`joined`・`roomWritable`は応答のたびに置き換える |
| `features/messages/hooks/message-polling.ts` | 部屋とスレッドの共通の部品：`hasMore`の間は続けて取る`catchUpMessages`・ポーリングの設定・非表示から戻ったときの取り直し |
| `features/messages/hooks/usePostMessage.ts`・`replace-room-message.ts`・`useEditMessage.ts`・`useDeleteMessage.ts` | 部屋とスレッドの両方を扱う。返信の投稿後は、スレッドを取り直し、部屋の一覧の親の`replyCount`を`setQueryData`で1増やす（返信はEP-1-01に出ず、取り直しでは件数が変わらないため） |
| `features/messages/components/MessageItem.tsx`・`MessageList.tsx`・`RoomMessages.tsx` | 各投稿に「返信 n 件」のボタン（読み上げ名に投稿者名と件数）。`MessageComposer`は`parentMessageId`で返信の入力欄になる（名前は「返信」） |
| `features/unread/hooks/useReadPositionSender.ts` | 部屋の既読とスレッドの既読が共通で使う送り方（最新のIDが進んだときだけ送る・非表示の間は送らない・失敗したら送り直す）。`useMarkRoomRead`から切り出した。状態は送り先（`target`）ごとに持つ |
| `features/drafts/draft-policy.ts` | `threadDraftScope`（`thread:<部屋ID>:<親ID>`） |
| `features/channels/components/ChannelDetailView.tsx`・`features/dms/components/DmView.tsx` | `ThreadLayout`で包み、`?thread=`でS-07を出す |
| `pages/ThreadsPage.tsx`・`App.tsx`・`features/app-shell/navigation.ts` | S-35（`/threads`）・ルート・サイドバーの固定リンク「スレッド」 |

## 処理の流れ

### 判定の順

**返信の投稿（`postReply`。EP-1-08。この順を変えない）**：①親が存在して見えるか（404）→ ②親が返信でないか（404。返信への返信は作らない）→ ③チャンネルで参加しているか（403）→ ④`perm.message.reply`（R-30。403で、`authorize`が監査に残す）→ ⑤親が削除済みか（409。C-59）→ ⑥部屋の状態（DMの相手が無効・部署が無効は409）→ ⑦条件付きのINSERT。0行のときは、①〜⑥をもう一度確かめ（状態が崩れていれば404・403・409）、どれにも当たらなければIDが部屋の最大以下だったとして、最大より大きいIDで作り直して再試行する（上限を超えたら503）。DMの返信のPOSTは`perm.message.reply`だけを見る（DMの本文を読む権限`perm.dm.message.view`は求めない）。お知らせ専用チャンネルでも参加者は返信できる（U-6）ので、`perm.announcement.post`は条件に入れない。

**返信の取得（`listReplies`。EP-1-07）**：①②まで（未参加の公開チャンネルも読める）。DMの部屋は、チャンネルの閲覧権限の代わりに`perm.dm.message.view`（拒否は403）。応答に、親の1件（削除済みなら`body: null`）・`replyBlockedReason`・`joined`・`roomWritable`を添える。

**スレッドの既読（`markThreadRead`。EP-3-09）**：①親が存在して見えるか（404）→ ②親が返信でないか（404）→ ③参加者か（未参加は403）→ ④`perm.notification.own`→ ⑤条件付きのupsert。0行のときは、①〜③をもう一度行い（崩れていれば404・403）、その返信がこのスレッドのものでなければ404、すでに同じかより新しい位置なら成功（204）、どれでもなければ409。`markRead`（部屋の既読）と同じ形で、確認と書き込みの間の退出・アーカイブに備える。

- 削除済みの返信のIDでも既読にできる。部署が無効のチャンネルでも既読にできる（読むだけの操作のため）
- 既読は本人の閲覧の記録で、監査に残さない（投稿と同じ。既定の方針4）

### 書き込みの条件（`reply-insert.sql.ts`）

返信のINSERTは、次のすべてを満たすときだけ1行を挿入する。確認からINSERTまでの間に状態が変わっても、条件を破る行を書かないため。

1. IDが、同じ部屋の最大のID（返信も含む）より大きい（[messages.md](messages.md)の不変条件。返信も部屋の並びに入る）
2. 親が同じ部屋にあり、通常の投稿（`parent_message_id`がNULL）で、削除済みでない（C-59）
3. チャンネル：未アーカイブで、投稿者が参加中・**部署が有効**（会社直属は有効として扱う）。DM：投稿者が当事者で、当事者に無効な社員がいない

### ID の並びの不変条件

- 返信も、同じ部屋のほかの投稿と同じ条件（同じ部屋に挿入するID以上のIDがない）で挿入するため、部屋の「最後のID以降」（EP-1-01の`after`）でも、スレッドの「最後のID以降」（EP-1-07の`after`）でも、取りこぼしがない
- EP-1-01の応答（最新・`after`の両方）には、`parent_message_id IS NULL`で返信を含めない。ただし、`hasMore`・`maxId`は部屋の全体の並びを基準にする。IDを作り直すときの`maxId`は返信も含めた部屋全体の最大のまま（返信を除くと、作り直しが終わらなくなる）
- 返信数`replyCount`は、削除済みの返信も数える（一覧の並びの「最後の返信」にも削除済みを含める。計画で決めた案。C-172）

### 返信できない理由と`joined`・`roomWritable`

- `replyBlockedReason`は、優先順で**1つだけ**返す：`deleted_parent`（親が削除済み）→ `not_joined`（未参加の公開チャンネル）→ `read_only`（部署が無効）→ `partner_inactive`（DMの相手が無効）。できるときは`null`
- 理由を1つに絞ると、隠れた理由が効かない（例：未参加で親が削除済みだと`not_joined`が届かず、画面が未参加でも既読を送って403になる）。そこで、独立した真偽として`joined`（参加しているか。DMは当事者なら`true`）と`roomWritable`（部屋に今書き込めるか）を返す。画面は、既読の送信と自分の返信の編集・削除の表示を`joined && roomWritable`で決める（`roomReplyState`が同じ材料から1か所で求め、サーバーの書き込みの条件`reply-insert.sql.ts`・`message-modify.sql.ts`と食い違わない）
- **これらは表示の制御だけ**で、認可ではない。認可は、POST・PATCH・DELETEのときに、サーバーが改めて行う

### スレッド一覧（EP-3-08。`GET /api/me/threads`）

- **含める条件（U-4）**：返信が1件以上あり、自分が親の投稿者か、自分が返信したスレッド。かつ、部屋が、参加中で未アーカイブのチャンネル、または当事者のDM（相手が無効でも含める）。参加していない公開チャンネル・抜けたチャンネル・アーカイブ済みは出さない。親が削除済みでも含める（`body: null`）
- **並び**：最後の返信のIDの降順、同じなら親のIDの降順（削除された返信も含める）。カーソルは`(最後の返信のID, 親のID)`。`cursor.ts`の`cursorQuerySchema`（既定20・最大100）
- **DMの権限**：`perm.dm.message.view`を持たない利用者には、DMのスレッドを含めない（一覧自体は200）。取得の後に除くとページの件数と`nextCursor`がずれるので、**SQLの条件**（`includeDirect`）で除く。表示の判定なので、`can`（拒否を監査に残さない）を使う。2秒ごとの取り直しで、拒否が監査に溜まらないようにするため
- **未読（`unreadCount`）**：0〜100（`UNREAD_COUNT_LIMIT`）。自分の返信と削除済みの返信は数えない。下限は`unreadLowerBound`（スレッドの既読位置と、チャンネルの`joined_at`の新しい方）
- **応答の形**：項目は`parent`（親の1件と`replyCount`）・`room`（チャンネルは`kind`・`id`・`name`、DMは`kind`・`id`・`partner`）・`lastReplyAt`・`unreadCount`。権限は`perm.notification.own`。応答は`no-store`
- SQLは2本（一覧 → 未読数）で、スレッドの数に比例しない。2本の間に返信が付く・既読になると、その1回だけ古い未読数になる（次の取得で直る）

### 画面

- **開いているスレッドは、URLのクエリ`?thread=<親ID>`で持つ**（チャンネル詳細・DM詳細・`/threads`）。再読み込み・リンクの共有・戻る操作でも保たれる。パソコンは右の領域、スマートフォンは全画面
- **`ThreadLayout`は、開いていても閉じていても同じ構造を返す**。開閉で親の要素の種類（`<>…</>`と`<div>`）を切り替えると、Reactが本体（一覧・入力欄）を作り直し、開いた要素のフォーカス・スクロール位置・入力中の状態を失う。jsdomのテストは部品を直接置いていて見逃し、実ブラウザのE2E（`threads.spec.ts`①）で見つかったため、実際の`ChannelDetailView`・`DmView`を通すテストを足した
- **別の部屋の親**を`?thread=`に指定したら、「スレッドが見つかりません」を出す（`ThreadPane`の`roomId`と照合）。S-35は部屋を限らない
- **同じ部屋の別のスレッドへ切り替えたとき**、入力欄が前の本文を別のスレッドへ送らないよう、返信の入力欄（`MessageComposer`）は「利用者ID＋scope」の`key`で、`ThreadReplies`は親IDの`key`で作り直す
- 取得に失敗しても、取得済みの返信は残して上にエラーを出す。返信できない理由があるときは入力欄の代わりに案内を出し、ポーリングで親が削除済みになったら入力欄を閉じる
- 「返信 n 件」は、**開いている間は他の人の返信で増えない**（部屋を開き直すと反映。U-7）。S-07の中身とS-35は2秒ごとに反映する。自分の返信は、部屋の一覧の件数・スレッド一覧にすぐ反映する（`/threads`で返信したときは、`ThreadPane`から渡した成功時の処理で`threadKeys.all`を取り直す。messagesからthreadsへの向きの参照を作らない）
- スレッド一覧は、**先頭から最大5ページ（20件×5＝100件）**まで読み込む。上限に達したら「さらに表示」を出さず、案内を出す。定数は`useMyThreads.ts`の`THREAD_LIST_MAX_PAGES`・`THREAD_LIST_MAX_ITEMS`。2秒ごとの取り直しは、読み込み済みのすべてのページを先頭から取り直し、並びの変化で生じる重複は親IDで除く（新しいページを優先）。**`maxPages`は使わない**（先頭のページを捨てると、取り直しが保持中の最初のページのカーソルから始まるため、返信で先頭へ動いたスレッドが表示から抜ける。TanStack Query 5.105.3）
- 下書き：scopeは`thread:<部屋ID>:<親ID>`（キーと値・期限・消す時点は[drafts.md](drafts.md)）。変更があるまま別の画面へ移るときは確認が出る（`LeaveGuardProvider`）。S-07を閉じる・S-35で別のスレッドへ切り替えるときの確認は#245（U-8）

## 主な入出力

| 関数 | 入力 | 出力 |
| --- | --- | --- |
| `createMessageService().listReplies` | 利用者・親ID・`after`または`cursor`と`limit` | `parent`・`replyBlockedReason`・`joined`・`roomWritable`・`items`（`after`なら`hasMore`、最新なら`nextCursor`）。見えなければ404（`AppError`） |
| `createMessageService().postReply` | 利用者・親ID・本文 | `{ id, roomId, parentMessageId, createdAt }`。404・403・409・503（`AppError`）【Issue #140：入力に`attachmentIds`（任意）を足した。返信用にアップロードした、同じ親の添付だけを結び付けられる】 |
| `insertReplyIfOrdered` | 返信の各値 | 挿入した行数（1か0） |
| `createThreadService().list` | 利用者・`limit`・`cursor` | `{ items, nextCursor }`（`ThreadItem`） |
| `createUnreadService().markThreadRead` | 利用者・親ID・`lastReadMessageId` | なし（成功は204）。404・403・409 |
| `advanceThreadReadPosition` | 利用者・親ID・最後に読んだ返信のID・時刻 | 変更した行数（1か0） |

## EXPLAIN QUERY PLAN（記録は Issue #137 のコメント）

| 対象 | プラン |
| --- | --- |
| EP-1-01の最新・`after` | `messages_room_id_id_idx`。`replyCount`は相関サブクエリで、`messages_parent_message_id_id_idx`のカバリング索引 |
| 返信の最新・`after` | `messages_parent_message_id_id_idx`（`parent_message_id=?`・`parent_message_id=? AND id>?`） |
| 返信の親 | 主キー |
| スレッド一覧のSQL1 | 自分の親は`messages_sender_id_parent_message_id_idx`、自分の返信は同索引のカバリング、最後の返信と件数は`messages_parent_message_id_id_idx`のカバリング、親・参加は主キー、既読は`thread_read_positions`の主キー |
| スレッド一覧のSQL2（未読数） | `messages_parent_message_id_id_idx (parent_message_id=? AND id>?)`（`json_each`はSCAN） |
| スレッドの既読 | 判定のSELECTはすべて主キー |
| 部屋の未読・DM一覧 | `messages_room_id_id_idx` |

SQLの本数：スレッド一覧は2本、返信のGETは6本（認証・親・部屋・親の項目・部署・返信）。どちらも件数に比例しない。

## 既知の限界

| 項目 | 内容 |
| --- | --- |
| 一覧の「返信 n 件」 | 開いている間は他の人の返信で増えない（U-7）。即時の反映は#117 |
| 一覧のページ送りと並びの変化 | 最後の返信の順で並ぶため、1ページ目の取得の後に、未取得のスレッドへ返信が付いて先頭側へ動くと、次のページから抜けうる（DMの一覧と同じ）。保証は「並びが変わらない間は、ページをまたいで重複も欠落もない」。2秒ごとの先頭からの取り直しで、先頭へ動いたスレッドは先頭に出る |
| 一覧は最近の100件まで | 上限を超えたスレッドは一覧では見られない（部屋から開ける）。100件を超えて一覧で見る必要が出たら、先頭の更新を保つ別の取得方式を別のIssueで作る |
| スレッド一覧のSQLの重さ | 自分の投稿（親・返信）の件数に比例する（`mine`を自分の投稿から求めるため）。会社全体の件数には比例しない。負荷の実測は#160 |
| S-07を閉じる・S-35で別のスレッドへ切り替えるときの離脱の確認 | #245（URLのパスが変わらないため、`LeaveGuardProvider`の画面の移動の確認が効かない。U-8）。別の画面へ移るときの確認は効く |
| 投稿側の部署が無効のときの扱い | 投稿（EP-1-02）の部署の有効の確認は#154まで未実装。返信は部署が有効であることをINSERTの条件に入れている（C-138(4)・C-171 U-9と同じ） |
| 本番のD1へのmigration 0020の適用 | 未実施（利用者の承認が別途必要） |

## テストの場所

| 区分 | 場所 |
| --- | --- |
| バックエンドの結合 | `backend/src/routes/messages.replies.test.ts`・`messages.replies.authz.test.ts`・`messages.replies.modify.test.ts`・`threads.test.ts`・`threads.room-effects.test.ts`・`thread-read-positions.test.ts`、既存の`openapi.test.ts`・`messages.edit.test.ts`・`messages.delete.test.ts` |
| Service・競合 | `backend/src/services/message.reply-service.test.ts`・`message.reply-race.test.ts`（確認からINSERTの間の変化）・`thread.service.test.ts`・`unread.thread-race.test.ts`（既読の確認と書き込みの間の変化）、`backend/src/lib/reply-blocked-reasons.test.ts` |
| DB（実際のD1相当） | `backend/src/db/message.reply-insert.db.test.ts`・`threads.schema.db.test.ts`（0020の制約・索引・列を足した後も通常の投稿が通る）・`threads.explain.db.test.ts`（実行計画）・`cleanup-sql.thread.db.test.ts`（共通の後片付け）。共通のデータ`backend/test/thread-fixtures.ts`・`message-fixtures.ts`・`dm-fixtures.ts` |
| 画面（MSW） | `frontend/src/features/threads/threads.pane.test.tsx`・`threads.room.test.tsx`（実際の`ChannelDetailView`・`DmView`を通す）・`threads.drafts.test.tsx`・`useThreadParam.test.tsx`、`pages/ThreadsPage.test.tsx`・`threads-route.test.tsx`、`features/messages/hooks/useThreadReplies.test.tsx`・`api/message-api.thread.test.ts`、`features/channels/channel-detail.thread.test.tsx`・`features/dms/DmView.thread.test.tsx`、`features/drafts/draft-policy.thread.test.ts`、`features/app-shell/navigation.threads.test.ts`。共通のデータ`frontend/src/test/thread-handlers.ts`・`thread-harness.tsx`・`message-handlers.ts` |
| E2E | `e2e/threads.spec.ts`（6件。[e2e.md](../testing/e2e.md)）。本番形の`e2e-prod/markdown-csp.spec.ts`は差し替える応答に必須の項目を足した |
| ミューテーション | [mutation.md](../testing/mutation.md) |

## 関係するIssue・ADR

- Issue #137（親：#133）。#139（メンション。1-4 AC-4の「自分がメンションされたスレッド」の条件を追記）・#140（添付）・#138（リアクション）・#117（リアルタイム化）・#245（離脱の確認）・#240（未読の合計）・#154（部署が無効の投稿）・#160（負荷の実測）に申し送る
- 決定：C-172（C-147の「スレッドごとの既読位置は未決定」を置き換えた）。C-59（親の削除）・C-94（公開チャンネルは未参加でも読める）・C-169（未読）・C-171（編集・削除）に従う
- [ADR-0006](../adr/0006-id-cursor-unread.md)（ID・カーソル・未読）・[ADR-0004](../adr/0004-realtime-polling-then-websocket.md)（ポーリング）・[ADR-0020](../adr/0020-test-scope-mutation-e2e.md)（ミューテーションとE2Eの範囲。(c)に当たる）
- 関連する設計書：[messages.md](messages.md)・[unread.md](unread.md)・[drafts.md](drafts.md)・[dms.md](dms.md)・[message-edit-markdown.md](message-edit-markdown.md)・[app-shell.md](app-shell.md)・[reactions.md](reactions.md)（#138。返信・親にもリアクションを付けられる。スレッド一覧の項目`reactions`、`ThreadReplies.tsx`の`canReact`）、[attachments.md](attachments.md)（#140。返信にも添付できる。返信用のアップロードの入口、スレッド一覧の親の項目`attachments`）
- 要件：1-4 AC-1〜AC-4、EP-1-07・EP-1-08・EP-3-08・EP-3-09、S-07・S-35
