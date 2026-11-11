# 通知の土台（Issue #124）

## 目的

申請・審査・お知らせの依頼・アーカイブなどの通知を、後続のIssueが「種類を足すだけ」で出せるようにする土台を作る。通知の表、業務の更新と同時に通知を作る部品、自分宛ての一覧・未読数・既読のAPI、通知の一覧（S-14）、ヘッダーの通知（ベル）、スマホ幅の下部メニューの「通知」を用意する。コードは書き写さず、ファイル名・関数名で指す。

## 範囲

| 区分 | 内容 |
| --- | --- |
| このIssueで作ったもの | `notifications`テーブルと索引（migration 0014）／通知の種類の定義元（`shared/notification-kinds.ts`。**種類は0件**）／作成の部品`notificationInserts`／一覧・未読数・1件既読・すべて既読のAPI（EP-3-04〜07）／S-14／ヘッダーの`NotificationBell`／下部メニューの「通知」 |
| 作らないもの | 通知の種類（0件）、種類ごとの文言・移動先、理由の列、メール送信、他人宛ての通知を取るAPI（R-57）、「最後のID以降」を取るAPI、作成・既読の監査、スマホ幅のベルのアイコン化 |
| 後続のIssueが足すもの | 下の「後続のIssueへの申し送り」 |

3-4 AC-1〜5は、このIssueでは「後続のIssueが満たせる土台」までを満たす（利用者の決定。[C-166](../requirements/decision-register.md)）。各ACの分担は次のとおり。

| 要件 | 土台として満たした部分 | 満たすIssue |
| --- | --- | --- |
| 3-4 AC-1・2（申請の提出・審査結果） | 宛先を呼び出し側が渡す作成部品を、業務の`db.batch`に入れられる形で提供。本人宛てだけの一覧 | #131（チャンネル作成申請）・#146（案件作成申請）・#128（無効化・異動・退職処理の申請）・#153（再開申請） |
| 3-4 AC-3（関係しない社員に送らない・メールなし） | 一覧・未読数・既読はすべて「本人宛て」の条件を通る。メール送信の仕組みは作らない | 各Issueが宛先の選定をテストする |
| 3-4 AC-4（お知らせの依頼・緊急削除・取消・直接削除） | 種類の定義元と画面の対応表に1件ずつ足せる作り | #142（理由の列もここで足す） |
| 3-4 AC-5（アーカイブ・復元） | 通知を消さずに残す。種類ごとに部屋の可視性による除外を外せる作り | #143・#151 |
| 3-1 AC-3（参考） | `room_id`列と、読み取りの条件を1関数に集めた | #133 |
| 3-2・3-3（参考） | 同上 | #139・#150 |

## ファイルと役割

### 共有・DB

| ファイル | 役割 |
| --- | --- |
| `shared/notification-kinds.ts` | 通知の種類の**定義元**。`NOTIFICATION_KIND_DEFINITIONS`（種類ごとの属性。属性は`containsRoomContent`＝部屋の内容を含むか）、`NotificationKind`型、`isNotificationKind`、`roomContentKinds`。内部の`KINDS`が今は空。後続のIssueはここに1件足す |
| `backend/db/schema.ts` | `notifications`を追加した。列は`id`・`user_id`（`users.id`を参照）・`kind`・`room_id`・`message_id`・`target_id`・`created_at`・`read_at`。索引は`(user_id, created_at, id)`（一覧）と、`read_at is null`の行だけの`(user_id)`部分索引（未読数） |
| `backend/db/migrations/0014_add_notifications.sql`、`meta/0014_snapshot.json`、`meta/_journal.json` | 新規テーブルと索引のmigration。`drizzle-kit generate --name add_notifications`で生成し、手で書き換えていない（新規テーブルなので作り直しは起きない） |
| `backend/db/seeds/cleanup.sql` | `notifications`の削除を足した。`user_id`の外部キーのため、利用者より先に消す |

### バックエンド

| ファイル | 役割 |
| --- | --- |
| `backend/src/db/notification.repository.ts` | `notificationInserts`（作成の文を返すだけ）、`visibleToRecipient`（読み取りの条件）、`createNotificationRepository`の`listForRecipient`・`countUnread`・`markRead`・`markAllRead`、`withNotifications`。DBへのアクセスはここに閉じる |
| `backend/src/services/notification.service.ts` | `createNotificationService`・`withNotificationService`。認可（`perm.notification.own`を会社範囲で）→ Repository。1件既読の0件更新を404にする。宛先は常に操作した本人で、他人の利用者IDを受け取る引数を持たない |
| `backend/src/routes/notifications.ts` | `notificationRoutes`。入力の形の確認（422）と応答だけを行う。全応答に`noStore`を付ける |
| `backend/src/index.ts` | `/api/me/notifications`へ登録した。`/api/me`より**前**に登録する（先に`/api/me`を登録すると、`/api/me/notifications`が`meRoutes`に取られるため） |
| `docs/api/openapi.json`、`backend/src/openapi.test.ts` | 4操作のAPI仕様と、実routeとの契約確認 |
| `stryker.config.json` | ミューテーションの対象に、定義元・Repository・route・フロントのapi/hooks/対応表を足した |

### フロントエンド

| ファイル | 役割 |
| --- | --- |
| `frontend/src/features/notifications/` | `index.ts`が公開する部品は`NotificationBell`・`NotificationList`。`api/notification-api.ts`（応答をZodで検証）、`api/query-keys.ts`（`notificationKeys.all`・`list`・`unreadCount`）、`hooks/useNotifications.ts`・`useUnreadNotificationCount.ts`・`useMarkNotificationRead.ts`・`useMarkAllNotificationsRead.ts`、`notification-views.ts`（種類ごとの文言・移動先の対応表`NOTIFICATION_VIEWS`と、純粋関数`describeNotification`）、`polling.ts`（ポーリングの間隔と停止の判定）、`describe-error.ts` |
| `frontend/src/pages/NotificationsPage.tsx` | S-14の構成だけ。APIや状態は持たない |
| `frontend/src/App.tsx` | レイアウトルートの子に`/notifications`を足した |
| `frontend/src/features/app-shell/Header.tsx`・`MobileNav.tsx`・`navigation.ts` | ヘッダーに`NotificationBell`、下部メニューに「通知」、`notificationsNavItem`を足した（[app-shell.md](app-shell.md)）。`features/notifications/index.ts`を通して使う |
| `frontend/src/features/messages/index.ts` | `MESSAGE_POLL_INTERVAL_MS`を公開した。ポーリングの間隔（ADR-0004の2秒）の定義を1か所に保つため、通知も`messages`の定義を使う（既定の方針5） |

## 処理の流れ

### 通知を作る（`notificationInserts`。HTTPなし）

1. 後続のIssueのServiceが、業務の更新（申請の提出など）の`db.batch([...])`に、`notificationInserts(db, 宛先の利用者ID, { kind, roomId?, messageId?, targetId? })`の戻り値を並べる。文を返すだけで実行しないので、業務の更新と通知の作成が**同時に確定・失敗する**（`auditLogInsert`と同じ型）
2. 宛先の重複は1件にまとめ、0人なら空の配列を返す
3. **宛先の絞り込みは呼び出し側の責務**。「操作した本人を除く」「承認権限者だけ」などは、呼び出し側が選んで渡す。この部品は、渡された宛先にだけ作る（3-4 AC-3）
4. `kind`の型引数の既定値は`NotificationKind`。本番のコードは、定義元にない種類を渡すと型エラーになる。テストだけが型引数で任意の文字列の種類を使える
5. 作成は監査に残さない（下の「設計判断の理由」）

### 一覧（GET /api/me/notifications）

1. `perm.notification.own`（全ロール可）を会社範囲で認可。宛先は常にセッションの利用者
2. クエリは`limit`（既定は`PAGE_LIMIT.default`）と`cursor`。壊れたカーソル・範囲外の`limit`は422
3. `listForRecipient`が、`visibleToRecipient`を通した行を、`created_at`・`id`の降順（新しい順）で`limit+1`件読む。続きは`cursor.ts`の`afterCursor`で取り（OFFSETは使わない）、`toPage`が`nextCursor`を作る
4. 応答は`items`（`id`・`kind`・`roomId`・`messageId`・`targetId`・`createdAt`・`readAt`）と`nextCursor`。文言や本文は含まない

### 未読数（GET /api/me/notifications/unread-count）

`countUnread`が、`visibleToRecipient`と`read_at is null`の行を、**100件で打ち切って**数える。応答は`{ count }`。画面は99を超えたら「99+」と表示する。

### 既読（POST …/:notificationId/read、POST …/read-all）

- 1件既読：`markRead`が、`visibleToRecipient`と`id`で絞った行の`read_at`を、まだ空のときだけ設定する（既読済みの`read_at`は最初の時刻のまま）。更新対象の行がなければ（他人宛て・存在しない・ULIDでない・閲覧できない）、Serviceが**404**にする。存在を漏らさないため、他人宛てと存在しないIDで応答を変えない。成功は204
- すべて既読：`markAllRead`が、本人の未読（`visibleToRecipient`を通る分）を既読にする。204
- 既読にしても行は消さない（3-4 AC-5）

### 読み取りの条件（`visibleToRecipient`）

一覧・未読数・1件既読・すべて既読の**四つが同じ条件を通る**。条件は`notification.repository.ts`のこの1関数に集める。

- 常に「本人宛て」（`user_id = 本人`）
- 定義元で`containsRoomContent: true`の種類にだけ、部屋の条件を足す。`roomContentKinds()`が空のとき（今の0件）は部屋の条件を付けない（空の`IN ()`を作らない）。今の部屋の条件は「その種類の通知が`room_id`を持つこと」だけ
- **#133が条件を足す位置はここ**：3-1 AC-3の「閲覧権限を失った部屋の内容を含む通知を除く」を、`containsRoomContent`が真の種類の部屋の条件として足す。権限が戻れば通知は再び見える（行は消さないため）
- `containsRoomContent`が偽の種類（アーカイブ・復元）は、権限を失っても残る

## 画面

| 画面 | ファイル | 内容 |
| --- | --- | --- |
| ヘッダーの通知 | `features/notifications/NotificationBell.tsx` | 押すとS-14へ直接移る（C-65）。未読が1件以上なら件数の印を出す。99を超えたら「99+」。件数は読み上げ用の名前（`aria-label`）にも含める。未読数の取得に失敗している間は、誤った件数を出さない。未読数は2秒ごとに取り直す（ADR-0004）。401・403が返ったら取り直しをやめる（`polling.ts`）。スマホ幅でも今は文字のまま（アイコン化は後続） |
| S-14 通知（`/notifications`） | `pages/NotificationsPage.tsx`、`features/notifications/NotificationList.tsx` | 読み込み中・エラー・0件（「新しい通知はありません」）・ありの4状態。「すべて既読にする」ボタン、「さらに表示」。移動先のある通知は、押すと既読にしてから移動する（既読に失敗したら移動せず、エラーを出す）。移動先のない未読は「既読にする」ボタンで既読にする。送信中は押せない |
| 下部メニュー | `features/app-shell/MobileNav.tsx` | 「ホーム」「通知」「自分」の順（[app-shell.md](app-shell.md)） |

- 文言と移動先は保存せず、`notification-views.ts`の対応表から組み立てる。対応表に無い種類は、汎用の「通知」・移動先なしで表示する（落ちない）
- 一覧の取り直し（ポーリング）は、**1ページ目だけを読み込んでいる間**だけ2秒ごとに行う。2ページ目以降を読み込んだら止める（全ページの取り直しは最初のカーソルで取り直すため、新着に押し出された通知が抜けるのを防ぐ）。ヘッダーの未読数は別のクエリで動き続ける
- 2ページ目以降を読み込んだ後でも、既読の操作による取り直し（invalidate）は全ページを取り直すため、まれに、新着で押し出された通知が抜けることがある。手動の操作をしたときだけで、画面を開き直せば正しく出る。許容する（ポーリングで抜けるのとは別の、操作時の限定的な抜け）
- 既読にしたとき（1件・すべて）は、成功後に`notificationKeys.all`を取り直す。一覧とヘッダーの未読数が、再読み込みなしで一度に変わる
- 本名・本文は通知の行にも画面にも出ない

## 後続のIssueへの申し送り

通知の種類を足すIssueは、次を行う。

1. `shared/notification-kinds.ts`の`KINDS`に種類を1件足す。**`containsRoomContent`を必ず決める**（メッセージなど部屋の内容を含むなら`true`。アーカイブ・復元のように、権限を失っても残したいものは`false`）
2. `frontend/src/features/notifications/notification-views.ts`の`NOTIFICATION_VIEWS`に、同じ種類の文言（`label`）と移動先（`to`）を1件足す。移動先の無い種類は`null`を返す
3. 業務のServiceで、`notificationInserts`の戻り値を業務の`db.batch`に入れる。宛先の選定（承認権限者・申請者・操作した本人を除く等）は、このIssueで決めてテストする
4. 理由の文（C-120・C-124）を持たせる種類は、**使うIssueがnullableの`reason`列を足す**（`ALTER TABLE … ADD COLUMN`で済む。drizzle-kitが作り直しを生成したらADR-0024の手順）。今は使う機能がないので足していない
5. アーカイブ・復元の通知（#143・#151）は`containsRoomContent: false`にする。「アーカイブされました」の表示は、そのIssueが対応表と移動先で作る
6. #133は、`visibleToRecipient`に部屋の閲覧権限の条件を足す（`containsRoomContent`が真の種類にだけ）
7. 種類の文字列を、定義元以外に書かない（型で守る）。DBの`kind`にCHECKは付いていない

## 設計判断の理由

| 判断 | 理由 |
| --- | --- |
| 文言を保存しない。種類と対象IDだけを持ち、画面の対応表で組み立てる | 3-4 AC-4・5の文言が未決定で、保存した文言は過去の通知に残って直せない。対応表だけ直せば過去の通知にも反映される。本名・本文が通知の行に入らない（個人情報の扱い） |
| `kind`にCHECKを付けない | SQLiteでCHECKの値を増やすにはテーブルの作り直しが要る。種類は#131・#133・#139・#142・#143・#146・#150・#151などが次々に足すため。値は定義元の型と`isNotificationKind`で守る |
| `room_id`・`message_id`・`target_id`を外部キーにしない | 直接削除・物理削除（C-120・C-123）の通知は、消えた対象を指しうる。外部キーにすると対象の物理削除ができないか、通知も消える。可視性や「アーカイブされました」の判定は、読むときに行う。`user_id`だけは`users.id`を参照する |
| `request_id`を`target_id`に一般化 | data-modelの`request_id`は依頼・申請だけを指すが、案件（#150・#151）も指すため。参照先は種類で決まる |
| 「最後のID以降」を取るAPIを作らない。1ページ目と未読数を2秒ごとに取り直す | 通知は新しい順で件数が少なく、取り直しで足りる。after方式は「宛先ごとにコミット順にIDが増える」保証（#201の条件付きINSERT）を、複数のServiceからの作成すべてに課すことになり、今の要求に対して重い。`docs/project-rules.md`の規則は「afterで取る一覧」に限り、このAPIには当たらない |
| 未読数は100で打ち切る | 画面は「99+」で足りる。数え上げを軽く保つ |
| 閲覧権限を失った通知は消さず、読むときに除外する | C-65の「一覧から除く」を満たしつつ、権限が戻れば再び見える。アーカイブ・復元の通知を`containsRoomContent: false`で残せる |
| 1件既読も`visibleToRecipient`を通す | 一覧に出ない通知を、IDを直接指定して既読にできてしまうのを防ぐ。読み取りの四つの経路が同じ条件になる |
| 作成・既読は監査に残さない | 作成は人の操作でなく業務の付随で、既読は本人の閲覧の記録。`logger`のauditの対象に当たらない（既定の方針4）。認可の拒否は`authorize`が記録する |
| 種類を0件で進める | 既存の機能（#196・#206・#130）は要件に通知の規定がなく、申請・審査・お知らせの依頼・アーカイブは機能が未実装のため。テスト用の種類は本番コードに作らない（テストは型引数で任意の文字列を使う） |
| 取得に失敗している間は件数を出さない | 誤った件数（古い値・0）を出すと、未読の見落としにつながるため |

## 個人情報・権限

- 読み書きは常に`user_id = 本人`。他人宛てを取るAPIは作らない（R-57）。他人宛てのIDの既読は404（存在を漏らさない）
- 応答は`noStore`。通知の行に本名・本文を入れない
- メール送信の仕組みは作らない（C-39）
- CSRF対策は`/api/*`共通の`originCheck`（POSTはOriginなしで403）

## 既存データ

新規テーブルのみで、補完は要らない。**本番のD1へのmigration 0014の適用は、このIssueの完了条件に含めず、別途利用者の承認を得て行う**。

## API契約

| 操作 | 契約 |
| --- | --- |
| 一覧（EP-3-04） | `GET /api/me/notifications`。クエリは`limit`・`cursor`。200で`items`と`nextCursor`。401／422 |
| 未読数（EP-3-05） | `GET /api/me/notifications/unread-count`。200で`count`（最大100）。401 |
| 1件既読（EP-3-06） | `POST /api/me/notifications/{notificationId}/read`。204（既読済みも204）。401／403（`FORBIDDEN_ORIGIN`）／404（存在しない・他人宛て・ULIDでない）／429 |
| すべて既読（EP-3-07） | `POST /api/me/notifications/read-all`。204。401／403（`FORBIDDEN_ORIGIN`）／429 |

応答の最終の形はOpenAPI（`docs/api/openapi.json`）に従う。EP-3-03（`POST /api/me/read-all`。部屋の未読。#133）とは別物。レート制限は入れていない（上限がX-8で未決定のため。channels・messages・profileと同じ扱い）。

## 主な入出力

| 処理 | 入力 | 出力 |
| --- | --- | --- |
| `notificationInserts(db, recipientIds, input)` | 宛先の利用者IDの一覧、`kind`・`roomId?`・`messageId?`・`targetId?` | 通知を作る文の配列（実行しない。重複した宛先は1件、0人は空） |
| `visibleToRecipient(recipientId, definitions?)` | 宛先の利用者ID、種類の定義（既定は定義元） | 読み取りのSQL条件 |
| `createNotificationRepository().listForRecipient` | 利用者ID、`limit`・`cursor?` | `items`と`nextCursor` |
| `.countUnread` | 利用者ID | 未読数（最大100） |
| `.markRead` | 利用者ID、通知ID、現在時刻 | 本人宛てとして存在したか（既読済みも真） |
| `.markAllRead` | 利用者ID、現在時刻 | 既読にした件数 |
| `createNotificationService().list`・`.countUnread`・`.markRead`・`.markAllRead` | 操作者（利用者ID・追跡ID）、必要な引数 | 同上。`markRead`は0件なら404 |
| `describeNotification(item, views?)` | 通知の項目、対応表（既定は`NOTIFICATION_VIEWS`） | 表示の`label`と移動先`to`（対応表に無い種類は「通知」・`null`） |
| `isNotificationKind(value, definitions?)`・`roomContentKinds(definitions?)` | 値、種類の定義 | 種類か否か／部屋の内容を含む種類の一覧 |

## テストの場所

- 共有：`backend/src/lib/notification-kinds.test.ts`
- DB結合：`backend/src/db/notification.repository.db.test.ts`（業務の更新と同じ`db.batch`での原子性、宛先の絞り込み・重複・0人、四つの経路が同じ条件を通ること、`containsRoomContent`の種類にだけ部屋の条件が当たること、定義0件で本人宛てがすべて見えること、既読にしても行が残ること）
- Service・route：`backend/src/services/notification.service.test.ts`、`backend/src/routes/notifications.test.ts`（他人宛てが出ない・404・新しい順とカーソル・`limit`の境界・100件の打ち切り・401／403）。API仕様との契約：`backend/src/openapi.test.ts`
- テスト部品：`backend/test/notification-fixtures.ts`（任意の種類の文字列で通知の行を作る）、`frontend/src/test/notification-handlers.ts`（MSW）。`frontend/src/test/server.ts`に、未読数0件の既定の応答を足した（枠を描画する全テストで、ヘッダーの未読数の通信が未処理にならないため）
- フロントエンド：`frontend/src/features/notifications/notifications.test.tsx`、`notification-views.test.ts`
- 期待を変えた既存テスト：`frontend/src/features/app-shell/MobileNav.test.tsx`の3点（下部メニューにリンクが増えたため。リンクの件数を1→2に、順を「ホーム」「通知」に、テスト名とコメントを「ホーム・通知のリンクと『自分』のボタンだけ」に変えた。確かめる意図（動かない仮項目を置かない）は同じ。既定の方針9）
- E2E：`e2e/notifications.spec.ts`。シードは`e2e/seeds/notifications.sql`と`notifications-cleanup.sql`（[e2e.md](../testing/e2e.md)）

## 未実施・未決定として記録するもの

| 項目 | 状態 |
| --- | --- |
| 本番のD1へのmigration 0014の適用 | 未実施（利用者の承認が別途必要） |
| 通知の種類・種類ごとの文言と移動先 | 0件。後続のIssueが足す。3-4 AC-4・5の文言は要件で未決定 |
| 3-4 AC-1〜5の本体 | #131・#146・#128・#153・#142・#143・#151（上の分担表） |
| 部屋の閲覧権限による除外（3-1 AC-3） | #133が`visibleToRecipient`に足す |
| スマホ幅でのベルのアイコン化 | 後続（今は文字のまま） |
| 理由の列（C-120・C-124） | 使うIssueが足す |
| 通知の作成・既読のレート制限 | 入れていない（X-8が未決定） |

## 関係するIssue・ADR

- Issue #124：本Issue。親Issue #109。後続は#131・#146・#128・#153・#142・#143・#151・#133・#139・#150
- [ADR-0004](../adr/0004-realtime-polling-then-websocket.md)：2秒ポーリング／[ADR-0006](../adr/0006-id-cursor-unread.md)：IDとカーソル・未読／[ADR-0012](../adr/0012-zero-trust-principle.md)：サーバー側で毎回認可する／[ADR-0020](../adr/0020-test-scope-mutation-e2e.md)：ミューテーション・E2Eの実行範囲（共通レイアウトを変えるためE2Eは全件）／[ADR-0024](../adr/0024-add-column-rewrite-for-table-rebuild.md)：列の追加で作り直しが生成されたとき（後続の`reason`列）
- 要件：3-4 AC-1〜5（土台）、3-1 AC-3・3-2・3-3（参考）、S-14。決定記録[C-166](../requirements/decision-register.md)
