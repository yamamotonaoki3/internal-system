# チャンネル・DMの未読の件数と既読（Issue #237）

コードは書き写さず、ファイル名・関数名で指す。決定は決定記録C-169（[decision-register.md](../requirements/decision-register.md)）。全体の方針は[ADR-0006](../adr/0006-id-cursor-unread.md)。

## 目的

参加しているチャンネルとDMごとに未読の件数をサイドバーとDM一覧（`/dms`）に出し（99件を超えたら「99+」）、部屋を開くと既読にする（3-1 AC-1・AC-2）。部屋の閲覧権限を失ったら、その部屋の未読を対象から外し、部屋の内容を含む通知を通知一覧から除く（3-1 AC-3）。未読の数は保存せず、既読位置から上限つきで数え直す（ADR-0006。カウンターと`rooms.last_message_id`は持たない）。

## 範囲

| 区分 | 内容 |
| --- | --- |
| このIssueで作ったもの | 表`read_positions`（migration 0018）／EP-3-01（`GET /api/me/unread`）・EP-3-02（`PUT /api/rooms/:roomId/read-position`）／サイドバーのチャンネル欄・DM欄と`/dms`の一覧の件数／部屋を開いたときの既読の送信／`visibleToRecipient`への部屋の閲覧条件／既存データの初期合わせのSQL |
| #240に分けたもの | S-14（通知一覧）の未読の部屋の行、EP-3-03（すべての部屋を既読）、下部メニューなどの合計の件数 |
| 作らないもの | 未参加の公開チャンネルの未読（対象外。1-1 AC-2・C-94）、S-09（チャンネルを探す）の件数、レート制限（上限がX-8で未決定。channels・messages・notificationsと同じ扱い）、スレッドの未読 |

## ファイルと役割

### 共有・DB

| ファイル | 役割 |
| --- | --- |
| `shared/unread-rules.ts` | 件数の規則の定義元。`UNREAD_COUNT_DISPLAY_MAX`（表示の最大。99）・`UNREAD_COUNT_LIMIT`（サーバーが数える上限。表示の最大＋1）・`formatUnreadCount`。サーバーの打ち切りと画面の表示上限は同じ知識なので1か所に置く。通知のベルの上限（#124）とは要件が別なので統合しない |
| `backend/db/schema.ts` | `readPositions`を追加。主キー（`user_id`, `room_id`）。`user_id`・`room_id`は外部キー。**`last_read_message_id`は外部キーにしない**（メッセージの直接削除・物理削除を既読位置が妨げない、または一緒に消えないため。比較はIDの大小だけで足りる。`notifications.message_id`と同じ判断）。追加の索引は作らない |
| `backend/db/migrations/0018_add_read_positions.sql`、`meta/0018_snapshot.json`、`meta/_journal.json` | drizzle-kitの生成物のまま（手で書き換えていない）。新しい表だけなので作り直しは起きない |
| `backend/db/scripts/backfill-read-positions.sql` | 既存データの初期合わせ（下の「既存データ」） |
| `backend/db/seeds/cleanup.sql` | テストの利用者・部屋の`read_positions`を、利用者・部屋より先に消す文と、残数`remaining_read_positions`を追加 |

### バックエンド

| ファイル | 役割 |
| --- | --- |
| `backend/src/routes/unread.ts` | `unreadRoutes()`。EP-3-01。クエリは`cursorQuerySchema`（`limit`既定20・最大100、`cursor`）に`strict()`を付け、余分なクエリは422。応答は`noStore` |
| `backend/src/routes/read-positions.ts` | `readPositionRoutes()`。EP-3-02。`roomId`とJSON本文`{ lastReadMessageId }`（ULID・余分な項目は422）。成功は204 |
| `backend/src/services/unread.service.ts` | `createUnreadService`の`list`・`markRead`。業務の判定の順を持つ |
| `backend/src/db/read-position.repository.ts` | `createReadPositionRepository`の`listUnread`・`advance`・`messageExistsInRoom`。DAOをまとめ、ServiceからD1の書き方を隠す |
| `backend/src/db/unread-targets.sql.ts`（DAO） | `listUnreadTargetRows`。未読の対象の部屋を`room_id`の昇順・カーソルより後で取る。チャンネルは参加の時刻`joined_at`、DMはnull、既読位置は`LEFT JOIN read_positions` |
| `backend/src/db/unread-counts.sql.ts`（DAO） | `listUnreadCountRows`。部屋と下限の組のJSONを1つのパラメータで`json_each`に渡し、部屋ごとに上限つきで数える。未読0の部屋は外す |
| `backend/src/db/read-position-advance.sql.ts`（DAO） | `advanceReadPosition`。条件付きupsert1文で、後戻りさせずに既読位置を進める。変更行数（1か0）を返す |
| `backend/src/lib/unread-bound.ts` | `unreadLowerBound`。未読を数える下限（このIDより大きいものだけ数える）を作る純粋関数 |
| `backend/src/lib/ulid.ts` | `ulidTimePrefix`（ULIDの時刻部分の10文字）と`MAX_TIME`を公開に変更。符号化は既存の`encodeTime`を使い、別の実装を作らない |
| `backend/src/db/notification.repository.ts` | `visibleToRecipient`に、部屋の内容を含む種類だけ「閲覧できる部屋」の条件（`viewableRoom`）を追加 |
| `backend/src/index.ts` | `/api/me/unread`を`/api/me`より前に（`/api/me/notifications`と同じ理由）、`/api/rooms`に`readPositionRoutes()`を登録 |
| `docs/api/openapi.json` | `listUnreadRooms`・`markRoomRead`を追加 |

### フロントエンド

| ファイル | 役割 |
| --- | --- |
| `frontend/src/features/unread/index.ts` | 公開は`RoomLinkLabel`・`UnreadCountBadge`・`UnreadCountsError`・`useMarkRoomRead`・`useUnreadCounts`だけ。ほかの機能（channels・dms）はここだけを通す。`unreadKeys`は公開しない（ほかで使う箇所がない） |
| `features/unread/api/unread-api.ts` | `fetchUnreadCounts`（`limit=100`で`nextCursor`がnullになるまで続け、`Map<roomId, count>`にする。応答はZodで検証。ページ数の上限`UNREAD_MAX_PAGES`（20）を超えたら一部だけの件数を出さずエラーにする）、`markRoomRead` |
| `features/unread/api/query-keys.ts` | `unreadKeys`（`all`・`counts`）。キーは1か所 |
| `features/unread/polling.ts` | `pollIntervalUnlessDenied`。間隔は`messages`の`MESSAGE_POLL_INTERVAL_MS`を使う。401・403で取り直しをやめる。`notifications`は参照しない |
| `features/unread/hooks/useUnreadCounts.ts` | 2秒ごとの取得。`retry: false`。失敗の間は呼び出し側が件数を出さない |
| `features/unread/hooks/useMarkRoomRead.ts` | 既読の送信（下の「既読の送信の時機」） |
| `features/unread/components/` | `UnreadCountBadge`（見える印は`aria-hidden`、読み上げ用の文を別に持つ）、`RoomLinkLabel`（未読があれば名前を太字にして印を添える。固定のクラスだけを使う。ADR-0015）、`UnreadCountsError`（取得失敗の表示） |
| `features/messages/components/RoomMessages.tsx` | 任意のprop`onLatestMessageIdChange`を追加。表示している最新のメッセージIDが変わったときに呼ぶ（0件・取得失敗では呼ばない）。渡さなければ既存の動きのまま |
| `features/channels/components/ChannelDetailView.tsx` | 詳細の取得が成功して参加中のときだけ、`useMarkRoomRead`の`markRead`を`RoomMessages`に渡す。既読の失敗を部屋の近くに出す |
| `features/channels/components/JoinedChannelsSection.tsx` | サイドバーのチャンネル欄。各リンクに件数。取得失敗の間は件数を出さず`UnreadCountsError`を出す |
| `features/dms/components/DmItems.tsx` | サイドバーのDM欄と`/dms`の一覧で共用。同じく件数と`UnreadCountsError` |
| `features/dms/components/DmView.tsx` | 当事者なので常に`markRead`を渡す。既読の失敗を出す |

`SidebarNav.tsx`・`MobileNav.tsx`・`navigation.ts`・`Header.tsx`・`ChannelDetailPage`は変えていない。依存の向きは`channels`・`dms` → `unread` → `messages`で、`messages`は`unread`を参照しない（循環なし）。

## 処理の流れ

### 未読の対象（どの部屋を数えるか）

自分が**参加中**（`channel_members`の行がある）で**未アーカイブ**（`deleted_at`がnull）のチャンネルと、自分が当事者のDMだけ。公開チャンネルを未参加で読んでいるだけの部屋は対象外（1-1 AC-2・C-94）。全体管理者・オーナーでも、参加していなければ対象外。

### 未読の一覧（EP-3-01）

1. `unreadService.list`が、最初に`perm.notification.own`を会社の範囲で`authorize`する（拒否は403で、DBを読まない）
2. `listUnread`が`listUnreadTargetRows`で対象の部屋を`limit + 1`件取り、`toPage`でページにする
3. 各部屋の下限を`unreadLowerBound`で作る
4. `listUnreadCountRows`が、部屋と下限の組を`json_each`に1つのパラメータで渡し、1本のSQLで数える

SQLは1回の取得で2本で、部屋の数に比例しない（N+1にしない）。応答は`{ items: [{ roomId, count }], nextCursor }`で、未読が1件以上の部屋だけを`room_id`の昇順で返す。`count`は1〜100。名前・種類は返さない（サイドバーが名前を持っている）。チャンネル・DMの一覧APIには載せない（両方とも無限スクロールで、2秒ごとに全ページを取り直すと重く、DM一覧は最終活動の順に動いてポーリングで重複・読み飛ばしが増えるため）。未読は軽い1本を2秒ごとに取り、各部品が`roomId`で引く。

### 下限（どのメッセージから数えるか）

下限は、メッセージIDと比べる文字列で、`unreadLowerBound`が作る。

- **チャンネル**：既読位置（なければ空文字）と、参加の時刻`joined_at`から作ったULIDの時刻部分（`ulidTimePrefix`）の、文字列として大きい方
- **DM**：既読位置（なければ空文字）。DMは会話・当事者2人・部屋を1回の`db.batch`で作り、メッセージはその後にしか投稿できず、当事者の入れ替えもない（2人固定。C-55）。したがって既読位置がなければ、そのDMのメッセージをすべて数えてよい
- 数える条件は、`messages.id`が下限より大きく、`sender_id`が自分でないこと（**自分の投稿は数えない**。C-169）。上限は`UNREAD_COUNT_LIMIT`件（100）で打ち切る

参加の時刻を下限に入れるのは、既読位置がない部屋で「参加する前の過去の投稿」まで未読に数えないため（C-169）。抜けて入り直した場合は、入り直しで新しい`joined_at`の行ができるので、最後の参加の時刻が下限になる（参加していなかった間の投稿は数えない）。既読位置が参加より後なら既読位置が下限になる。

**`created_at`ではなくIDの範囲で比べる理由**：`messages_room_id_id_idx`は（room_id, id）の索引で、下限をIDの範囲にすれば参加より後の行だけを索引で読める。`created_at`で比べると索引で絞れず、`LIMIT 100`は条件を満たした行だけを数えるため、参加の前の履歴（何千件でも）をすべて読んでから捨てることになる。参加が遅い部屋ほど重くなり、上限つきの数え直し（ADR-0006）の前提が崩れる。

**符号化の定義は1か所**：時刻部分の符号化は`ulid.ts`の`encodeTime`だけで、`unread-bound.ts`は`ulidTimePrefix`を使う（SQLで同じ変換を書く二重定義にしない）。

**同じミリ秒の扱い**：時刻部分だけの10文字は、同じ時刻部分を持つどの26文字のIDよりも辞書順で小さい。したがって下限`m.id > 時刻部分`は、参加と同じミリ秒に作られたIDを数える側に入る。同じミリ秒の投稿は参加の前か後かを区別できないが、数え漏れ（読んでいない投稿を既読扱い）より、1件多く数える側に倒す。

**時計の差**：IDの時刻はWorkerの時計、`joined_at`はDBの既定またはアプリの時刻で、数ミリ秒の差がありうる。参加の直前の投稿を1件多く数える、またはごくまれに参加の直後の投稿を数えないことがある。害が小さいため許容する。

**守り**：`Date.parse(joinedAt)`が整数でない、または0〜2^48−1（ULIDの時刻部分の範囲）の外のときは、参加の下限を付けず既読位置だけにする（すべて数える側に倒す。未読を隠さない）。

### ページ送り（nextCursorとitemsの関係）

カーソルは「調べた対象の部屋」の最後の`room_id`である。1ページは「対象の部屋を最大`limit`件調べ、そのうち未読のある部屋だけを返す」ため、**`items`は`limit`より少なく、0件でも`nextCursor`がありうる**。クライアントは`nextCursor`がnullになるまで続けて取る（`fetchUnreadCounts`がそうしている）。最後のページは`nextCursor`がnull。

### 既読にする（EP-3-02）

`unreadService.markRead`の判定の順は次のとおりで、**この順を変えない**。

1. 形（422。Controller）：`roomId`がULID、本文が`{ lastReadMessageId: ULID }`だけ
2. 部屋を探す：チャンネル（`findRoomForViewer`）で`canViewChannel`が偽なら404。見えるが未参加（公開を読んでいるだけ）は**403 `FORBIDDEN`**。チャンネルでなければDM（`findDirectForParticipant`）で、当事者でなければ404（存在しない・他人のDMは区別しない）
3. `perm.notification.own`を会社の範囲で`authorize`（拒否は監査に残る。部屋の判定を先にするのは、403で他人のDMの存在を教えないため。[dms.md](dms.md)の順と同じ）
4. `advanceReadPosition`で条件付きupsert。1行なら204
5. 0行のとき（もみ消さない）：部屋の判定をもう一度行い、崩れていれば404／403。次に「そのメッセージがその部屋にあるか」を読み、なければ404。あれば「すでに同じかより新しい位置まで既読」なので204（後戻りしないことが意図した結果）

`advanceReadPosition`は、メッセージがその部屋にあり、かつ参加中の未アーカイブのチャンネルか当事者のDMのときだけ挿入し、既にあれば新しいIDのときだけ更新する（`ON CONFLICT DO UPDATE … WHERE excluded.last_read_message_id > read_positions.last_read_message_id`）。SQLiteのupsertは`INSERT … SELECT`にWHERE句が必要で、上の条件がそれを兼ねる。D1は書き込みを直列に実行するため（[messages.md](messages.md)の前提）、同時の既読化でも最大のIDが残る。`db.transaction()`は使わず、1文で原子的に行う。既読は本人の閲覧の記録で、監査ログには残さない（#124と同じ方針）。

### 権限を失った部屋の扱い（3-1 AC-3）

`read_positions`の行は**消さず、取得のときに対象の部屋だけに絞る**。参加の解除・アーカイブなどの経路ごとに削除を足す必要がなく、取りこぼさない。権限が戻れば元の既読位置から数え直せる。

- チャンネルから外れた：参加の行がなくなり、対象外
- アーカイブ：`deleted_at`が入り、対象外（戻すと出る。既読位置が残るため）
- 非公開になった：参加者は引き続き閲覧でき、対象のまま

通知の側は`visibleToRecipient`に「閲覧できる部屋」の条件を足した（[notifications.md](notifications.md)）。

### 既読の送信の時機（`useMarkRoomRead`）

- 部屋（S-05・S-06）を開いて一覧が表示されたとき、表示している最新のメッセージIDまで送る。2秒ポーリングで新着を表示したときも、最新のIDが変わったらそのIDまで送る
- 送った（送信中を含む）IDより大きいIDが来たときだけ送る。同じIDを毎回送らない
- タブが非表示の間は送らない（見ていないため）。表示に戻ったとき（`visibilitychange`。外部との同期なので`useEffect`）に、保留していた最新のIDを送る
- 失敗したら、「送ったID」を最後に成功したIDに戻し、次の機会（次の新着・表示に戻ったとき）に送り直す。最後に成功したIDは、より大きいときだけ更新する（応答の順が入れ替わっても戻らない）
- 成功したら`unreadKeys.all`を取り直す（サイドバーの件数が再読み込みなしで消える）
- **状態は部屋ごと**：送ったID・成功したID・保留のIDを`roomId`と組にして持ち、`roomId`が変わったら初期化する。`ChannelDetailPage`は`ChannelDetailView`を`key`なしで描くため、チャンネルを移ってもフックの状態が残り、新しい部屋の最新IDが前の部屋より小さいと送られない、という問題を防ぐ。使う側の`key`には頼らない。送信は`{ roomId, messageId }`を変数に持たせ、結果が返ったときに今の`roomId`と同じときだけ状態を更新する（前の部屋の結果で今の部屋の判定を変えない）。失敗の表示も、今の部屋への送信の失敗だけを出す
- 公開チャンネルを未参加で読んでいるときは送らない（`ChannelDetailView`が参加中のときだけ渡す）。参加した直後は送る。詳細の取得中も渡さない
- ほかのタブ：サーバーが後戻りさせないので、古いタブが古いIDを送っても既読は戻らない。別のタブのサイドバーは、未読のポーリングで追いつく

### 失敗の表示

- 件数の取得に失敗している間は、件数を出さない（古い値や0を出して見落としにつなげない）。サイドバーのチャンネル欄・DM欄・`/dms`の一覧のそれぞれに「未読の件数を取得できません。しばらくすると自動で取り直します」を出す（`UnreadCountsError`）。欄ごとに出て重なることがあるが、各欄が件数の出ない理由を示すため、このままにしている
- 既読の送信の失敗は、`ChannelDetailView`・`DmView`が部屋の近くに「既読の状態を更新できませんでした」と次の行動の文を出す。次の既読の送信が成功したら消える。401は共通の処理

### 画面の見え方

リンクの名前は「{名前} 未読 3件」（100件以上は「未読 99件以上」）になる。見える印は件数の文字（99を超えたら「99+」）で、名前は太字になる（色だけに頼らない。非機能要件6・C-80）。件数が0・取得前・取得失敗のときは何も出さない。

## 既存データ（本番への反映の手順）

既読位置の行がない状態でコードを出すと、既存の利用者のチャンネル・DMが（DMは全件が数えられ）「99+」になりうる。これを避けるため、**SQL 1ファイル**`backend/db/scripts/backfill-read-positions.sql`で、既存の利用者の既読位置を「いまの最新のメッセージ」に合わせる（C-169。migrationにはしない。既存のデータの補完は`backend/db/scripts/`に置く、[project-rules.md](../project-rules.md)の方針に従う）。

- 対象：チャンネルの参加者（`channel_members`の全行。アーカイブ済みのチャンネルも含む。アーカイブを戻したときに「99+」にならないため）と、DMの当事者（`conversation_members`）の、利用者×部屋のうち、メッセージがある部屋。値はその時点の部屋の最新のメッセージID（`MAX(messages.id)`）。メッセージのない部屋・未参加の公開チャンネル・他人のDMには行を作らない
- べき等：`INSERT … SELECT … ON CONFLICT(user_id, room_id) DO NOTHING`の1文。既にある既読位置は変えない（利用者が進めた位置を、流し直しで巻き戻さないため）。何度流しても、まだない行だけが増える。チャンネルとDMの対象は`UNION ALL`の副問い合わせにまとめ、`WHERE`を持つ（upsertの構文のあいまいさを避けるため）
- 実行手順（本番。**AIは実行しない。利用者の承認のもとで利用者が行う**）：
  1. 適用前の復元ポイントを確かめる（[環境・デプロイのルール](../../.claude/skills/env-deploy/SKILL.md)）
  2. migration 0018を適用する
  3. 対象の件数を数える`SELECT`（対象の部屋のうち、メッセージがあり既読位置がない利用者×部屋）を`wrangler d1 execute <DB> --remote`で流す
  4. このSQLを`wrangler d1 execute <DB> --remote --file backend/db/scripts/backfill-read-positions.sql`で流す
  5. 3と同じ`SELECT`を流す。**0件でなければ、このSQLを流し直す（べき等）。0件になるまで繰り返す**。0件にならないのは、手順の間も旧コードで投稿・参加が続き、「メッセージがあり既読位置がない」組が新しくできるため。流し直しで、その時点の最新のIDに合わせる
  6. コードをデプロイする
- 未読の画面はデプロイまで出ないため、3〜5の間に「99+」は見えない。手順を飛ばしてデプロイしても、後から流せば直る（べき等で、既にある既読位置は変えない）。ただし、後から流すまでの間に利用者が既読にした部屋は、その位置のまま
- 件数が多く、1回の実行がD1の時間の上限に当たって失敗したとき：失敗してもべき等なので流し直してよい。それでも終わらないときは、`room_id`の範囲で分けた写しを順に流すか、利用者と相談してから進める
- 開発用のローカルDBで流すコマンド（品質チェックで実行して確かめた）：`node node_modules/wrangler/bin/wrangler.js d1 execute DB --local --persist-to .wrangler/state/development --file backend/db/scripts/backfill-read-positions.sql`（保存先は`npm run db:migrate:local`と同じ）。npmスクリプトは足していない（既存の`backfill-owner-channel-members.sql`にも無い。`scripts/db-local.ts`の`seed-file`は`e2e/seeds/`専用）
- **開発用DBに`backend/db/seeds/cleanup.sql`を流さない**：テスト用のDB向けで、デモのアカウント`testuser_001`も消すため
- 実行してよい範囲：ローカルの開発DBのみ。本番のD1は、migrationの適用と同じく、利用者の別途の承認を得てから行う。本Issueの完了条件には含めない（migration 0018の本番適用も同じ）
- 検証：`backend/src/db/read-positions-backfill.db.test.ts`が、`?raw`でこのファイルを読み、データを入れたD1に流して確かめる（件数と最新ID、対象外に行ができないこと、空のDBで失敗しないこと、2回流しても変わらないこと、アーカイブ済みの参加者にも行ができること、流した直後に未読が空になること）

### 出した直後の見え方

この手順で合わせた後は、既存の利用者の既読位置は最新のメッセージIDで、その後の投稿から数える。手順を実施する前に出した、またはまだ行がない新しい参加は、チャンネルは参加の後の投稿から、DMは全件（上限100）から数える。

## 索引とEXPLAIN QUERY PLAN（AC-4）

`backend/src/db/read-position.repository.db.test.ts`が、参加の前に履歴が1,000件ある部屋を含む状態で、取得の2本のSQLの`EXPLAIN QUERY PLAN`を確かめている。

- `messages`は`messages_room_id_id_idx (room_id=? AND id>?)`の範囲検索で読み、表を頭から読む`SCAN`がない
- `read_positions`は主キーの自動索引（`sqlite_autoindex_read_positions_1`）を使う
- 対象の部屋は`channel_members_user_id_idx`・`conversation_members_user_id_idx`・`channels`の主キーで引く
- 部屋の数（1・10・30）でSQLの数が変わらない

追加の索引は作っていない（`read_positions`は利用者×部屋の主キーを引くだけ）。`messages_room_id_id_idx`は`sender_id`を含まないため、自分の投稿を除く判定で範囲の行ごとに表を読むが、上限100件で打ち切るため許容した（負荷は#160で実測する）。

## 設計判断の理由

| 判断 | 理由 |
| --- | --- |
| 未読を別のAPI（EP-3-01）にする | 一覧APIに載せると2秒ごとに全ページの取り直しになり重い。軽い1本を2秒ごとに取る |
| 応答は`roomId`と`count`だけ | サイドバーが名前を持っている。返す情報を増やさない（api-draftの【案】から変えた） |
| 2本のSQLにして、下限はアプリ側で作る | SQLでULIDの時刻部分を作る式は、`ulid.ts`との二重定義になる。アプリ側の1関数にして、符号化の定義を1か所にする |
| 既読位置の行を権限喪失で消さない | 取得のときに対象に絞れば、参加の解除・アーカイブ・非公開化の経路ごとの削除が要らず、取りこぼさない |
| 2秒ごとに取る | ADR-0004のポーリング。リアルタイム化は#117 |
| `last_read_message_id`を外部キーにしない | メッセージの削除を妨げない（C-120・C-123の後続）。data-modelのERの注記に書いた |

## 申し送り

- **部屋を物理削除するIssue（C-123）**：`read_positions.room_id`が外部キーなので、部屋を消す前に、その部屋の`read_positions`の行を先に消す
- **見られる範囲が別の規則の部屋を足すIssue**（例：案件の参加者で決まる案件専用チャンネル）：`visibleToRecipient`の閲覧の条件（`viewableRoom`）と、未読の対象の部屋（`unread-targets.sql.ts`）の**両方**を広げる
- **公開チャンネルの扱いの違い**：公開チャンネルは抜けても閲覧できるため、部屋の内容を含む通知は残る。未読の対象は参加者だけ（C-94）、通知を消すのは閲覧権限を失ったとき（3-1 AC-3）、という違い
- **DMの前提が崩れる変更**（グループDM・当事者の追加）：`conversation_members`に参加の日時を足し、チャンネルと同じ下限の式にする（今のDMの下限は既読位置だけ）
- **S-14の未読の部屋の行・EP-3-03・下部メニューの合計**：#240で扱う

## 既知の制限

- 開いている部屋のリンクに、新着から既読の送信までの間（数秒）、件数が一瞬出ることがある
- 受け取った側のサイドバーに**新しいDMそのもの**が出るのは、[dms.md](dms.md)のとおりフォーカス時・マウント時。そのDMの件数は、DMが一覧に出た時点で出る。リアルタイム化は#117
- 2本のSQLの間に参加が変わると、その1回だけ古い対象で数える。次の2秒の取得で直る
- 取得のポーリングが1人1本増える。重ければADR-0006の将来案（`rooms.last_message_id`）を検討する。実測は#160
- 新しいフックには`notifyOnChangeProps`を入れていない。2秒ごとの再描画が少し増える（問題が出たら別Issue）
- DM一覧の読み飛ばし（[dms.md](dms.md)の「#133で見直す」）は未読と関係しないため、今回は見直していない

## 主な入出力

| 処理 | 入力 | 出力 |
| --- | --- | --- |
| `formatUnreadCount(count)` | 件数 | 99以下は数字、超えたら`99+` |
| `unreadLowerBound({ lastReadMessageId, joinedAt })` | 既読位置（null可）、参加の時刻（null可。DMはnull） | 数える下限のID文字列 |
| `ulidTimePrefix(ms)` | 0〜2^48−1の整数のミリ秒 | ULIDの時刻部分（10文字） |
| `createReadPositionRepository().listUnread` | 利用者ID、`limit`、`cursor?` | `{ items: [{ roomId, count }], nextCursor }`（itemsは未読のある部屋だけ） |
| `createReadPositionRepository().advance` | 利用者ID、部屋ID、メッセージID、現在時刻 | 変更した行数（1か0） |
| `createUnreadService().list` | 操作者、`limit`、`cursor?` | 上のページ。権限がなければ403 |
| `createUnreadService().markRead` | 操作者、部屋ID、最後に読んだメッセージID | なし（成功）。見えない部屋・メッセージなし404、未参加の公開403 |
| `useUnreadCounts()` | なし | 部屋IDで引ける対応表（`Map<roomId, count>`）のクエリ |
| `useMarkRoomRead(roomId)` | 部屋ID | `markRead(messageId)`と、今の部屋の送信の`error` |

## API契約

最終の形はOpenAPI（`docs/api/openapi.json`）に従う。

| API | 応答 |
| --- | --- |
| EP-3-01 `GET /api/me/unread`（`listUnreadRooms`） | 200（`items`・`nextCursor`）、401、403、422（`limit`の範囲外・壊れたカーソル・余分なクエリ） |
| EP-3-02 `PUT /api/rooms/{roomId}/read-position`（`markRoomRead`） | 204、401、403（`FORBIDDEN`：未参加の公開チャンネル／`FORBIDDEN_ORIGIN`）、404、422 |

## テストの場所

- 共有・純粋関数：`backend/src/lib/unread-rules.test.ts`、`backend/src/lib/unread-bound.test.ts`、`backend/src/lib/ulid.time-prefix.test.ts`
- DB結合：`backend/src/db/read-position.repository.db.test.ts`（件数の境界・自分の投稿・入り直し・DM・EXPLAIN・SQLの数・upsertの後戻りなしと同時実行・ページ送り）、`read-positions.schema.db.test.ts`（表・主キー・外部キー。カウンターを持たないこと）、`read-positions-backfill.db.test.ts`（初期合わせのSQL）、`channel-members.joined-at.db.test.ts`（参加の行を作る全経路の`joined_at`の形）、`notification.room-visibility.db.test.ts`（SQLの閲覧条件と`canViewChannel`の全組の一致）、`notification.repository.db.test.ts`（閲覧できない部屋の通知が4経路から除かれる）
- Service・route：`backend/src/services/unread.service.test.ts`（判定の順・0行の読み分け）、`backend/src/routes/unread.test.ts`、`backend/src/routes/read-positions.test.ts`、`backend/src/openapi.test.ts`
- フロントエンド：`frontend/src/features/unread/`の`UnreadCountBadge.test.tsx`・`useUnreadCounts.test.tsx`・`useMarkRoomRead.test.tsx`、`features/channels/channels.unread.test.tsx`・`channel-detail.unread.test.tsx`、`features/dms/DmItems.unread.test.tsx`・`DmView.unread.test.tsx`、`features/messages/messages.latest-id.test.tsx`
- テスト部品：`backend/test/read-position-fixtures.ts`、`frontend/src/test/unread-handlers.ts`。`frontend/src/test/server.ts`の既定の応答に、未読なしのGETと既読成功（204）のPUTを足した
- 既存の後始末の変更（既定の方針9）：外部キーのため、`backend/test/`の`message-fixtures.ts`・`dm-fixtures.ts`・`channel-request-fixtures.ts`・`company-general-fixtures.ts`・`department-fixtures.ts`・`role-fixtures.ts`と、`e2e/seeds/`の既存の`*-cleanup.sql`（利用者・部屋を消すもの）の先頭に、`read_positions`の削除を足した。確かめる性質は変えていない
- E2E：`e2e/unread.spec.ts`（[e2e.md](../testing/e2e.md)）。シードは`e2e/seeds/unread.sql`・`unread-cleanup.sql`。サイドバーのリンクを名前で探す既存のE2Eは、`e2e/room-link.ts`の`roomLinkName`で、未読の読み上げ名だけを許して名前の完全一致を保つ（`e2e/channels.spec.ts`・`e2e/dms.spec.ts`）。`e2e-prod/csp-style.spec.ts`は`GET /api/me/unread`を空の応答でモックする

## 未実施・未決定

| 項目 | 状態 |
| --- | --- |
| S-14の未読の部屋の行・EP-3-03・下部メニューの合計 | #240で扱う |
| 本番のD1へのmigration 0018の適用と、初期合わせのSQLの実行 | 未実施（利用者の承認が別途必要。上の手順） |
| 未読の取得の負荷の実測 | #160 |
| リアルタイム化 | #117 |
| 未読のレート制限 | 入れていない（X-8が未決定） |

## 関係するIssue・ADR

- Issue #237：本Issue。親Issue #133。#201（メッセージ）・#136（DM）・#124（通知）が先行。#240：分けた範囲
- 決定記録C-169
- ADR-0004：ポーリングから始める／ADR-0006：ID・カーソル・未読の持ち方／ADR-0012：サーバー側で毎回認可する／ADR-0015：スタイルの土台／ADR-0020：ミューテーション・E2Eの実行範囲
- 要件：3-1 AC-1〜AC-3、1-1 AC-2、EP-3-01・EP-3-02、S-01・S-05・S-06
