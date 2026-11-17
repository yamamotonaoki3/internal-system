# 全社連絡と、公開チャンネルの一覧・閲覧・参加（Issue #200）

## 目的

社員が、チャンネルを探して（S-09）、公開チャンネルに自分で参加できるようにする。あわせて、申請なしの初期データとして「全社連絡」を用意し、全員を参加させる。サイドバーには、参加中のチャンネルを出す。コードは書き写さず、ファイル名・関数名で指す。

## 範囲

| 区分 | 内容 |
| --- | --- |
| このIssueで作ったもの | EP-2-04（一覧）・EP-2-05（参加）・EP-2-06（詳細）／全社連絡の用意（部分一意インデックスのmigration 0010と、初期データのmigration 0011）／アカウント発行・初回セットアップでの全社連絡と部署の専用チャンネルへの参加／S-09（チャンネルを探す）・詳細画面の入口・サイドバーの「参加中のチャンネル」／監査操作`channel.join`・`channel.company_general_backfill` |
| 親#132に残すもの（未実施。**チャンネルの名前・説明の変更とアーカイブ・復元は、後から#143の143-aで実装した**。下の「チャンネルの管理」） | 検索（2-3 AC-3）、申請で作るチャンネル（**#131で実装した**。[channel-requests.md](channel-requests.md)）、非公開チャンネルの招待（2-4 AC-1〜4。**#135で実装した**。下の「チャンネルへの招待」）、拠点ラベル（C-119）、未読（#124）、チャンネルのアーカイブ、退出。なお、お知らせ専用チャンネルの投稿制限（2-3 AC-4）とメッセージは**#201で実装した**（[messages.md](messages.md)） |
| 作らないもの | 退出のAPI（全社連絡にも作らない。Q-2）、新しい権限ID（認証済みの有効な社員であれば足りる。Q-7）、レート制限（上限がX-8で未決定のため入れない。別Issueで扱う。Q-8） |

## ファイルと役割

### バックエンド

| ファイル | 役割 |
| --- | --- |
| `backend/db/schema.ts`、`backend/db/migrations/0010_add_company_general_unique.sql` | `channels`に、全社連絡を会社で1つに限る部分一意インデックス`channels_company_general_unique`（`purpose`が`company_general`の行だけ）を足す。生成したmigration（DDLだけ） |
| `backend/db/migrations/0011_seed_company_general_channel.sql` | 全社連絡の初期データを補う手作成のmigration。[ADR-0022](../adr/0022-company-general-channel-seed-migration-exception.md)の例外 |
| `backend/db/migrations/meta/` | 0010・0011のsnapshotと`_journal.json`。0011のsnapshotは0010のものを複製して作った（手作成のため。0006・0009と同じ扱い） |
| `backend/src/lib/channel-rules.ts` | 全社連絡の固定値（`COMPANY_GENERAL_CHANNEL_NAME`・`COMPANY_GENERAL_ROOM_ID`。0011の値と一致させ、テストで突き合わせる）、詳細が返す参加者の先頭の件数`MEMBERS_PREVIEW_LIMIT`、純粋関数`canViewChannel`・`canJoinChannel` |
| `backend/src/db/channel.repository.ts` | `createChannelRepository`が一覧（`list`）・詳細の行（`findForViewer`）・参加者の数と先頭（`countMembers`・`listMembers`）・部署の存在確認（`departmentExists`）・参加（`join`）を扱う。`withChannels`が構成する |
| `backend/src/services/channel.service.ts` | `createChannelService`が見てよいか・参加してよいかの判定と`AppError`（404）への変換を行う。`withChannelService`が構成する |
| `backend/src/routes/channels.ts` | `channelRoutes`（`GET /`・`GET /:channelId`・`POST /:channelId/join`）。入力は`validate`で確かめ（不正は422）、受付と返却だけを行う。`backend/src/index.ts`が`/api/channels`へ登録する |
| `backend/src/lib/audit-actions.ts` | `channel.join`・`channel.company_general_backfill`を足した |
| `backend/src/db/account.repository.ts`、`backend/src/services/account.service.ts` | アカウント発行の`db.batch`に、全社連絡の存在確認と、全社連絡・所属部署の専用チャンネル2つへの参加を足した（[accounts.md](accounts.md)） |
| `backend/src/db/setup.repository.ts` | 初回セットアップの`db.batch`に、全社連絡の存在確認と、最初の管理者の参加を足した（[roles-and-setup.md](roles-and-setup.md)） |
| `docs/api/openapi.json`、`backend/src/openapi.test.ts` | 3操作のAPI仕様と実routeとの契約確認 |
| `stryker.config.json` | ミューテーションの対象に、`channel-rules.ts`・`channel.repository.ts`・`channel.service.ts`・`routes/channels.ts`などを足した（認可の重要処理。ADR-0020の範囲） |

### フロントエンド

依存の向きは、pages → features → 共通。`features/channels/`は`index.ts`だけを公開する。

| ファイル | 役割 |
| --- | --- |
| `frontend/src/features/channels/api/channel-api.ts` | `fetchChannels`・`fetchChannel`・`joinChannel`。共通の`apiClient`だけを使い、応答はzodで検証する。詳細は、参加済み（`joined: true`）なのに参加者の情報（`memberCount`・`members`）がない応答を、サーバーの不具合として検証エラーにする |
| `frontend/src/features/channels/api/query-keys.ts` | `channelKeys`（`all`・`list`・`detail`）。参加したときは`all`を取り直す |
| `frontend/src/features/channels/hooks/` | `useChannels`（絞り込みごとに別のキャッシュ。カーソルで続きを取る無限スクロール型）・`useJoinedChannels`（`useChannels`に`joined: true`を渡すだけ）・`useChannelDetail`・`useJoinChannel`（成功したら`channelKeys.all`を無効にし、一覧・サイドバー・詳細を取り直す。取り直しが終わるまで送信中のまま） |
| `frontend/src/features/channels/components/` | `ChannelList`（読み込み中・エラー・なし・ありの4つの状態）・`ChannelSummary`（1行。参加ボタンは参加済みなら出さず、送信中は押せない）・`DepartmentFilter`・`JoinedChannelsSection`（サイドバー用）・`ChannelDetailView`（詳細。#201でS-05になり、`features/messages`の`RoomMessages`を使う。下の「S-05への統合」） |
| `frontend/src/features/channels/describe-error.ts` | 通信の失敗を利用者向けの文にする。`ApiError`のメッセージはそのまま使い、それ以外は一般的な文にする |
| `frontend/src/pages/ChannelsPage.tsx`（S-09）・`ChannelDetailPage.tsx` | 画面の構成だけ。API通信は書かない。**Issue #131で、S-09に「チャンネルを申請」リンク（`/channel-requests`。S-10への入口）を足した** |
| `frontend/src/App.tsx` | レイアウトルートの子に`/channels`・`/channels/:channelId`を足した |
| `frontend/src/features/app-shell/navigation.ts`、`SidebarNav.tsx` | `primaryNavItems`に「チャンネルを探す」を足し、`SidebarNav`の「ここに差し込む」の位置に`JoinedChannelsSection`を1行で差し込んだ（[app-shell.md](app-shell.md)） |

## 全社連絡の用意

- **0010**：`channels_company_general_unique`を足す。既存のDBに全社連絡が2件あると失敗するが、作る経路がなかったため0件のはず（ローカルのリハーサルで確認済み）
- **0011**：次の順に文だけで流れ、何度流しても同じ結果になる（べき等）。全社連絡は固定のIDではなく`purpose`で取る
  1. 全社連絡がなく、名前「全社連絡」の比較キーが既存のチャンネル（アーカイブ済みを含む）と衝突するとき：作らず、`audit_logs`に`channel.company_general_backfill`・`failure`（`detail`は`channel_name_conflict`）を1件だけ記録する。記録済みなら追加しない。migration自体は失敗させない
  2. 全社連絡がなく、衝突もないとき：`rooms`・`channels`に1行ずつ入れる（公開・会社直属・説明は空）
  3. 有効な社員（`is_active = 1`）のうち未参加の人を、全員参加させる（列の組み立ては0009と同じ。参加日時は既定値）
- 新規のDBでは、セットアップより前に0011が流れるため、参加者0名の全社連絡ができる。最初の管理者は、セットアップのときに参加する
- チャンネル→参加者の順に流すため、`PRAGMA defer_foreign_keys`は使わない
- **衝突で作れなかったときの復旧**：衝突したチャンネルを改名して衝突を解消し、0011と同じ補完をもう一度行う。それまでは全社連絡がないため、アカウント発行とセットアップは失敗する（アカウント発行は503）
- 固定のルームIDは、実装のときにリポジトリ全体を検索し、ほかで使われていないことを確かめた（使っているのは`0011`と`channel-rules.ts`だけ）
- 通常のDBテストは空のDBにmigrationを流すため、補完は別に検証する（`backend/src/db/company-general-backfill.db.test.ts`）

## 処理の流れ

### 判定の順（Service。この順を変えない）

`createChannelService`の`join`は、次の順で判定する。

1. **見えるか**（`canViewChannel`）：アーカイブされておらず、公開か、参加中の非公開。見えなければ404（非公開・アーカイブ済み・存在しないものを区別しない。存在を開示しない）
2. **参加済みか**：参加済みなら、何もせず200（べき等）。監査ログは書かない。参加日時は、すでにある行の値を返す
3. **参加できるか**（`canJoinChannel`）：アーカイブされていない公開チャンネル。できなければ404
4. 参加する（Repositoryの`join`）

`get`は①の後、**参加者にだけ**参加者の数（`memberCount`）と先頭`MEMBERS_PREVIEW_LIMIT`件（`members`）を付ける。未参加の公開チャンネルの詳細には、この2項目を含めない。参加者の数と一覧には、無効にした社員を含めない。メッセージは返さない（一覧は`GET /api/rooms/:roomId/messages`。[messages.md](messages.md)）。`isCaseChannel`は今はつねに`false`。**#201で`canPost`（真偽）を足した**：未参加は偽、参加者で、お知らせ専用なら自部署のオーナーか全体管理者のときだけ真、それ以外の参加者は真。判定は`shared/message-rules.ts`の`canPostToChannel`で、権限の確認は`can`（拒否を監査に記録しない）。全社連絡は部署の範囲を渡さず、参加者なら真。

### 一覧（`GET /api/channels`）

- 見せる範囲：アーカイブされていない、会社直属と全部署の公開チャンネル、および自分が参加している非公開チャンネル。参加していない非公開は出さない。**案件専用チャンネル（`purpose = 'case'`）は、参加者にも一覧に出さない**（Issue #146の146-B。5-1 AC-6。案件の画面から開く。条件は`channel.repository.ts`の`list`の`WHERE`に入れてある。[case-requests.md](case-requests.md)）
- 各項目に、`departmentId`（会社直属は`null`）、`departmentName`（会社直属は`null`）、`joined`を含める。参加の有無は`channel_members`のLEFT JOINで求めるため、件数が増えてもSQLの数は増えない
- 絞り込み：`departmentId`（存在しない部署は404）、`joined`（`true`／`false`）。並びは名前の比較キー・ルームIDの昇順で、`cursor.ts`のカーソル方式（`PAGE_LIMIT`。既定20、最大100）。壊れたカーソルは422

### 参加（`POST /api/channels/:channelId/join`）

`join`は、参加の行の挿入と監査ログ（`channel.join`）を**同じ`db.batch`**で確定する。

- 監査ログの文を、参加の挿入より**前**に置く。どちらも「今も公開で未アーカイブ」かつ「参加の行がまだない」ときだけ書く。順序が逆だと、挿入済みで条件が常に偽になり、監査が1件も残らない（テストで検出する）。初回は監査が1件、2回目は0件
- 確認から書き込みまでの間にアーカイブ・非公開化された場合は、参加の行が作られず、`join`が`null`を返す。Serviceはこれを404にする
- 参加の書き込みの条件（`joinable`）に、本人が有効（`is_active = 1`）であることも入れる。無効化と同時の参加で、無効な社員の参加の行を残さないため（Issue #128）。書き込みが0行で、本人が無効なら、Serviceは401（`UNAUTHENTICATED`）にする。それ以外は404
- 送信元の確認（`originCheck`）と認証は、`/api/*`に一括でかかる。許可されていないOriginのPOSTは403、未認証は401。無効にされた社員は、セッションの層で401になる
- 全体管理者が他部署の専用チャンネルに手動で参加することも、このAPIで満たす（C-163 S-8）。全体管理者は、自分が**オーナーになった部署**の専用チャンネル2つには、部署の作成・オーナー交代のときに自動で参加する（C-164。Issue #206。[department-management.md](department-management.md)）。それ以外の部署の専用チャンネルへは自動参加しない

### アカウント発行・セットアップでの参加

- **アカウント発行**（`createAccount`）：利用者の挿入の直後に、全社連絡の存在確認の文（`purpose = company_general`かつ`deleted_at IS NULL`でなければ、NOT NULL違反でbatch全体を失敗させる。書き方は[project-rules.md](../project-rules.md)の`assertStatement`と同じ）を置く。続けて、全社連絡と、所属部署の専用チャンネル2つ（`department`・`announcement`。アーカイブされていないもの）への参加を、`INSERT ... SELECT`で1文で入れる。存在確認と参加の文は、同じ条件で全社連絡を取る
- 部署に専用チャンネルがない場合（0009で名前が衝突して補われなかった部署など）は、全社連絡だけに参加して発行を成功させる
- **全社連絡がないときの応答**：Repositoryが`CompanyGeneralChannelMissingError`を投げ、Serviceが`503 SERVICE_UNAVAILABLE`（メッセージは「初期チャンネルが準備されていないため、アカウントを発行できません。システム管理者へ連絡してください。」）にする。Serviceは`logger.error`に記録する（個人情報は出さない）。利用者・参加・監査の行は残らない。全社連絡がアーカイブ済みのときも同じ
- ID・メールの重複（409）でも、参加の行は残らない（batch全体の取消し）
- **初回セットアップ**（`createInitialAdmin`）：同じ存在確認の文を置き、最初の管理者を全社連絡に参加させる。全社連絡を作る処理は書かない。全社連絡がなければセットアップは失敗し、何も残らない（アカウント発行と違い、専用の503には変えておらず、想定外のエラー（500）になる。利用者に向けた案内を出す改善は未実施）

### S-05への統合（Issue #201）

- `ChannelDetailView`は、見出し・説明の下に`RoomMessages`（`roomId`・`canPost`・`joined`を渡す）を置き、参加者の一覧を下に出す。メッセージの一覧・投稿・ポーリングの設計は[messages.md](messages.md)
- **Issue #136で足したこと**：参加者の一覧の各行（自分以外）に、`features/dms`の`StartDmButton`（「DMを送る」）を置いた。`channels`から`dms`を、`dms/index.ts`の公開部分だけを通して直接参照する（`dms`は`channels`を参照しないので循環しない）。自分の行かは`useSession`の利用者IDで判定し、セッションが届くまでは出さない（表示の制御。認可はサーバー）。押すと、新規・既存とも同じDM（S-06）に移る。詳細は [dms.md](dms.md)
- 参加中で`canPost`が真：入力欄を出す／参加中でお知らせ専用の権限なし：入力欄の代わりに案内を出す／未参加の公開：入力欄を出さず、既存の「参加する」の案内を出す（本文は読める）
- `channel-api.ts`の詳細のスキーマに`canPost`（必須の真偽）を足した。テストのMSWの応答（`channels.components.test.tsx`・`channels-route.test.tsx`・`frontend/src/test/server.ts`）にも`canPost`を足した
- `findForViewer`（`channel.repository.ts`）の取得項目に`purpose`を足した（足しただけ）

### フロントエンドの取得とサイドバー

- `JoinedChannelsSection`は`GET /api/channels?joined=true`を取り、参加中のチャンネルを名前順に並べる。1ページ（既定20件）を超えるときは「さらに表示」で続きを取る。上限の定数は設けず、ページ送りで対応した
- 読み込み中・エラー・なしの表示は、このセクションの中に出し、枠全体は壊さない。エラーは`describeError`の文にする
- **未読の件数（Issue #237。元の記述は残す）**：`JoinedChannelsSection`が`useUnreadCounts`で部屋ごとの件数を引き、各リンクに件数を出す（`RoomLinkLabel`。未読があれば名前を太字に）。取得に失敗している間は件数を出さず、`UnreadCountsError`を出す。`ChannelDetailView`は、詳細の取得が成功して参加中のときだけ、`useMarkRoomRead`の`markRead`を`RoomMessages`に渡す（公開チャンネルを未参加で読んでいるだけでは既読にしない）。既読の失敗は部屋の近くに出す。`ChannelDetailPage`は変えていない。[unread.md](unread.md)
- **401のとき**：サイドバーの取得も共通の`apiClient`を通る。401（`UNAUTHENTICATED`）は、`main.tsx`が登録した共通の処理（`features/auth/unauthenticated-handler.ts`）が、セッションのキャッシュを捨てて`/login`へ移す。サイドバー固有の処理は書かない
- リンクの見た目は枠（app-shell）が決める。機能から枠を参照しないよう、`JoinedChannelsSection`はリンクのクラス関数を引数で受け取る
- S-09の部署の絞り込み（`DepartmentFilter`）は、絞り込まない一覧に出てくる部署から選択肢を作る。読み込み済みの分だけが選択肢になるため、ページ送りの先にしかない部署は、先を読み込むまで選べない（今の件数では問題にならないが、制限として記録する）
- 詳細画面（`ChannelDetailView`）は、404を「チャンネルが見つかりません」と表示する。参加ボタンの成功後は、一覧とサイドバーを取り直す
- テストでは、サイドバーが一覧を取るため、MSWの既定の応答（`frontend/src/test/server.ts`）に`GET /api/channels`の空の一覧を足した

## チャンネルへの招待（Issue #135・#132の残り。EP-2-12・S-12）

参加者が有効な社員をチャンネルに追加する。招待の表は作らず、`channel_members`の行と監査ログ`channel.invite`で記録する（C-175）。確定と同時に参加者になり、`201`で`channelId`・`userId`・`joinedAt`を返す。migrationはない。

### ファイルと役割

| ファイル | 役割 |
| --- | --- |
| `backend/src/lib/channel-rules.ts` | `canInviteToChannel`：閲覧可否（`not_found`）→ 招待者の参加（`not_member`）→ チャンネルの状態（`case_channel`・`department_inactive`）の順に、先に当たった理由を返す純粋関数。権限と再認証はこの関数に含めず、Serviceが`not_member`と`case_channel`の間で確かめる（権限、再認証の順） |
| `backend/src/db/channel-invite.sql.ts` | 書き込みの3文（監査・通知・参加）と、3文に共通の条件`invitable`。`channelInviteStatements`が返す |
| `backend/src/db/channel.repository.ts` | `findInvitee`（相手の有効性と参加済みを1回で読む。存在しなければ`null`）・`isUserActive`（招待者が有効か）・`invite`（3文を1つの`db.batch`で確定し、参加日時か`null`を返す） |
| `backend/src/services/channel.service.ts` | `createChannelService`の`invite`。判定の順と、0行の後の読み直しを持つ。判定の共通部分は内部の`assertCanInvite`・`assertInvitee` |
| `backend/src/routes/channels.ts` | `POST /:channelId/invitations`。パス・本文（`userId`のみ。`strict`・ULID）を`validate`で確かめ、再認証の時刻を`actorOf`で渡す |
| `backend/src/lib/audit-actions.ts`、`shared/notification-kinds.ts` | `channel.invite`、通知の種類`channel.invited`（`containsRoomContent: true`）を足した |
| `frontend/src/features/channels/api/channel-api.ts`、`hooks/useInviteToChannel.ts` | `inviteToChannel`（応答はzodで検証）。フックは、再認証だけを済ませる`confirmReauth`と、招待を送る`invite`に分ける。成功したら`channelKeys.all`を無効にする |
| `frontend/src/features/channels/components/ChannelInviteDialog.tsx`、`ChannelDetailView.tsx` | S-12。`ChannelDetailView`は、参加中で`readOnly`が偽のときだけ「招待」を出す（表示の制御。認可はサーバー）。社員の検索は`features/members`の部品を使う |
| `frontend/src/features/notifications/notification-views.ts` | `channel.invited`の固定の文言「チャンネルに追加されました」と移動先（チャンネルの詳細） |

### 判定の順（Service。この順を変えない）

`createChannelService`の`invite`は、次の順で判定する。入力の確認（422）は、これより前に`validate`で済んでいる。

1. **閲覧可否**：参加していない非公開・アーカイブ済み・存在しないチャンネルは、区別せず同じ404
2. **招待者の参加**：公開チャンネルで招待者が参加していなければ403 FORBIDDEN。拒否は`audit`に記録する
3. **権限**：`perm.channel.invite`を、参加の確認の後に`authorize`（対象は`{ type: "company" }`）で確かめる。拒否は403で、`authorize`が監査に残す。見えないチャンネル・未参加では確かめない。権限はSQLの条件には入れない。`createChannelService`の`deps.authorizer`で差し替えられる（省略時は`roles`から組む）
4. **再認証**：`assertRecentReauth`。なければ403 REAUTH_REQUIRED（参加していない非公開では、再認証の前に404になる）
5. **チャンネルの状態**：案件専用は409。チャンネルの部署が無効（読み取り専用）も409「部署が無効になっているため、招待できません」。会社直属は招待できる
6. **相手の有効性**：相手が存在しない・無効は、区別せず同じ404
7. **参加済み**：相手が参加済み（自分自身を含む）は409
8. 書き込み（Repositoryの`invite`）

### 書き込み（`db.batch`）

- 監査（`channel.invite`。`detail`は`invitedUserId`だけ）→ 通知（`channel.invited`）→ 参加の挿入の順の3文を、同じ`db.batch`で確定する。監査と通知を挿入より前に置くのは、挿入の後だと「相手が未参加」の条件が偽になるため（`join`と同じ）
- 3文とも同じ条件（`invitable`）を付ける。条件は、(a) 未アーカイブ (b) 案件でない (c) 部署がない、または部署が有効 (d) **招待者の参加の行がある（公開・非公開とも）** (e) 招待者が有効 (f) 相手が有効 (g) 相手が未参加。最初の判定で確かめることは、すべてこの条件にも入っている（再認証は、時刻がセッションの値でDBの行の状態ではないため入れない）
- 通知の行にはチャンネル名・氏名を保存しない。受け取った人がのちにチャンネルを見られなくなれば、既存の仕組み（`containsRoomContent`）で通知一覧・未読数から除かれる
- 条件が成り立たなければ3文とも0行になり、成功の監査・通知・参加のどれも残らない

### 0行の後の読み直し

確認から書き込みまでの間に状態が変わると、`invite`は`null`を返す。Serviceは次の順で読み直し、最初に当たった理由を返す（再認証はやり直さない）。どれにも当たらなければ、成功にせず例外を再送出する（500）。

1. **招待者が有効か**：無効なら401 UNAUTHENTICATED（「ログインしてください」。セッションの層と同じ`AppError`。チャンネルの状態は何も伝えない）
2. 閲覧可否（404）→ 招待者の参加（403）→ 権限`perm.channel.invite`（403。確かめ直す）→ チャンネルの状態（409）→ 相手の有効性（404）→ 参加済み（409）

参加済みの判定を最後にするのは、招待者が見えなくなった場合に、相手の参加状態を漏らさないため。

### 画面の流れ（S-12）

社員を検索して選ぶ → **再認証**（`confirmReauth`。成功しても招待のAPIは呼ばず、確定画面を開くだけ）→ **確定画面**（相手の表示名・チャンネル名）→ 利用者が「確定」を押したときだけ`invite`を呼ぶ。確定前に閉じればAPIを呼ばない。失敗は`ApiError`の`code`で分け、404は「見つかりません」、409はサーバーの文言（「参加済み」・部署が無効）をそのまま出し、`REAUTH_REQUIRED`は再認証のやり直しを案内する。

### 作らないもの

メッセージ検索（#155）、案件専用チャンネルの招待（参加者の追加で入る）、CSV一括登録での全社連絡への参加（再有効化での全社連絡・部署の専用チャンネルへの参加は、#128で[accounts.md](accounts.md)に実装した）、リンク・コードでの招待、招待の表、レート制限（X-8が未決定）。

## チャンネルの管理（Issue #143の最初の子・143-a。EP-2-36〜38・S-05の「⋯」。C-181）

担当部署のオーナーと全体管理者が、チャンネルの名前・説明を変え、アーカイブ・復元できるようにする。アーカイブ・復元は参加者に通知する。コードは書き写さず、ファイル名・関数名で指す。親 #143 は3つの子に分ける：**143-a（このPR）**＝名前・説明の変更、アーカイブ・復元のAPIと通知、S-05の「⋯」メニューと3つのダイアログ／143-b＝S-39（チャンネル管理）・S-38（アーカイブしたチャンネル）・セッションの`permissions`への入口の権限／143-c＝物理削除（EP-2-39）。

### 範囲

| 区分 | 内容 |
| --- | --- |
| 143-aで作ったもの | 名前・説明の変更（EP-2-36）、アーカイブ（EP-2-37）、復元（EP-2-38）／新しい表`channel_archive_events`（migration 0028）／通知の2種類（`channel.archived`・`channel.restored`）と、通知の一覧への`reason`・`roomArchived`（[notifications.md](notifications.md)）／チャンネルの詳細への`version`・`manage`／監査の3操作／S-05の「⋯」メニュー・編集・アーカイブ・復元の3つのダイアログ（復元は部品と画面のテストだけ。入口は143-b） |
| 後の子に回したもの | S-39・S-38・サイドバーの「アーカイブ」・セッションの`permissions`（143-b）、物理削除（143-c）。検索からアーカイブ済みを除くこと（#155）、案件専用チャンネルの連動（#151）、整理スペース・共通フォルダ（2-7・2-8）は範囲外 |

### ファイルと役割

| ファイル | 役割 |
| --- | --- |
| `backend/db/schema.ts`、`backend/db/migrations/0028_add_channel_archive_events.sql` | 新しい表`channel_archive_events`（下の「新しい表」）。既存の表の列は足していない。`drizzle-kit generate`の生成物 |
| `backend/db/seeds/cleanup.sql` | `channel_archive_events`の削除と残数の確認を足した（外部キーのため、チャンネル・利用者より先に消す） |
| `shared/channel-name-rules.ts` | `ARCHIVE_REASON_MAX_LENGTH`（500）、`archiveReasonSchema`（任意・前後の空白を除く・空なら理由なし・最大500文字。V-48）、`CHANNEL_NAME_TAKEN_MESSAGE`（名前の重複の409の文。画面がこの文で名前の欄に出す）を足した。名前・説明の規則は既存の`channelRequestNameSchema`・`channelRequestDescriptionSchema`をそのまま使う（定義を増やさない） |
| `shared/notification-kinds.ts` | `channel.archived`・`channel.restored`（どちらも`containsRoomContent: false`） |
| `backend/src/lib/channel-rules.ts` | `channelManageActions`（種類と状態から「種類として」できる操作を返す純粋関数。権限は含めない）、`channelScopeOf`（部署があれば部署の範囲、なければ会社の範囲） |
| `backend/src/lib/audit-actions.ts` | `channel.update`・`channel.archive`・`channel.restore`を足した |
| `backend/src/db/channel-manage.sql.ts`（新規） | 書き込みの文。`channelManagerSql`（操作者が有効で管理できる人の条件。権限の規則のSQL版）、前提の確認`assertStatement`、`channelUpdateStatements`・`channelArchiveStatements`・`channelRestoreStatements` |
| `backend/src/db/channel.repository.ts` | `findForManage`（管理の判定に使う行）・`listNotifyRecipients`（通知の宛先）・`update`・`archive`・`restore`（batchの実行とエラーの変換）。専用エラー`ChannelManageConflictError`・`ChannelNameTakenError` |
| `backend/src/db/notification.repository.ts` | `notificationInserts`に任意の`onlyWhen`を足した。通知の一覧用に`archiveStatesFor`を足した（[notifications.md](notifications.md)） |
| `backend/src/services/channel-manage.service.ts`（新規） | `createChannelManageService`・`withChannelManageService`。`update`・`archive`・`restore`と、判定の順・0行の後の読み直し・宛先のやり直し |
| `backend/src/services/channel.service.ts` | 詳細（`get`）の応答に`version`・`manage`を足した（`manageOf`。表示用） |
| `backend/src/services/notification.service.ts`、`backend/src/routes/notifications.ts` | 一覧に`listWithArchiveStates`を足し、routeがそれを呼ぶ |
| `backend/src/routes/channels.ts` | `PATCH /:channelId`・`POST /:channelId/delete`・`POST /:channelId/restore`。本文は`strict`で、`version`は必須の整数。`validate`で形を確かめる |
| `docs/api/openapi.json`、`backend/src/openapi.test.ts` | 3操作と、詳細・通知の一覧の項目の追加 |
| `frontend/src/features/channels/` | `api/channel-api.ts`（`updateChannel`・`archiveChannel`・`restoreChannel`。詳細のスキーマに`version`・`manage`を必須で足した）、`hooks/useManageChannel.ts`（3つの操作のフックと、再認証が完了しなかったときの`ReauthNotCompletedError`、409の後に詳細を取り直す`useRefetchChannelDetail`）、`components/ChannelManageMenu.tsx`（「⋯」）・`ChannelEditDialog.tsx`・`ChannelArchiveDialog.tsx`・`ChannelRestoreDialog.tsx`、`describe-error.ts`の`describeManageError`、`index.ts`（143-bが使う3つの部品と`CHANNEL_ARCHIVED_STATE`を公開） |
| `frontend/src/features/notifications/` | `notification-views.ts`（`channel.archived`・`channel.restored`の文言・`suffix`・移動先）、`NotificationList.tsx`（アーカイブ中の通知の表示）、`api/notification-api.ts`（`reason`・`roomArchived`） |
| `frontend/src/features/audit-logs/action-labels.ts` | 監査の3操作の日本語の名前を足した |
| `frontend/src/pages/ChannelsPage.tsx` | アーカイブから移ってきたとき、完了の表示（「アーカイブしました」）を出す |

### 新しい表`channel_archive_events`（migration 0028）

アーカイブ1回ごとに1行。列は`id`・`channel_id`（`channels.room_id`を参照）・`archived_by`（`users.id`を参照）・`archived_at`・`reason`（NULL可）・`restored_by`（`users.id`を参照）・`restored_at`。

- **今アーカイブ中かは`channels.deleted_at`を正とする**（`channels.status`は増やさない。2-6 AC-8）。この表は「その回の理由・した人・日時」を持つためのもの。今の理由・した人は、`restored_at`がNULLの行（開いている記録）から読む
- **既存の表に列を足さず、表を足した理由**：`notifications`に列を足すと、全列を並べて挿入している既存の`INSERT ... SELECT`（招待・指名の通知など）が列数の不一致で失敗する。`channels`に列を足すと、通知の後に再アーカイブ・復元されたとき、古い通知に新しい理由が出てしまう。アーカイブ1回ごとの行にし、通知の`target_id`をその行のIDにすれば、その時の理由を正確に引ける
- 制約：`reason`は`NULL`か1〜500文字（CHECK）。**開いている記録はチャンネルごとに1つ**（`restored_at`がNULLの行の部分一意索引`channel_archive_events_open_unique`）。**復元した人と日時は両方そろうか、両方NULL**（CHECK）。索引は`(channel_id, archived_at)`。後の2つは計画になく足した制約（C-181 (5)）
- 復元では行を消さず、`restored_by`・`restored_at`を入れて閉じる（古い通知がその回の理由を引き続けるため）

### 誰が何をできるか

権限IDは既存の`perm.channel.edit`（R-80。名前・説明）と`perm.channel.delete`（R-81。アーカイブ・復元）で、新しい権限は作らない。範囲は`channelScopeOf`で決まり、オーナーは自部署、全体管理者は全部署と会社直属。オーナーの任命のない部署でも、全体管理者は持つ。作成者・一般メンバーには管理の権限がない（2-6 AC-4）。種類による可否は`channelManageActions`が返す。

| チャンネルの種類 | 名前の変更 | 説明の変更 | アーカイブ | 復元 |
| --- | --- | --- | --- | --- |
| 通常（部署あり） | 自部署のオーナー・全体管理者 | 同左 | 同左 | 同左（誰がアーカイブしたものでも。C-132） |
| 通常（会社直属） | 全体管理者だけ | 全体管理者だけ | 全体管理者だけ | 全体管理者だけ |
| 部署の専用・お知らせ専用 | 不可（409） | 自部署のオーナー・全体管理者 | 不可（409） | 対象なし |
| 全社連絡 | 不可（409） | 全体管理者だけ | 不可（409） | 対象なし |
| 案件専用 | このAPIでは不可（409。案件の側のIssueで扱う） | 不可（409） | 不可（409） | 不可（409） |

- 部署が無効（読み取り専用）のチャンネルでも、名前・説明の変更・アーカイブ・復元を許す（D-3）。部署の有効性は判定にも書き込みの条件にも入れない
- 参加していない非公開チャンネルも、範囲内の管理者は、メッセージの中身を見ずに管理できる（2-6 AC-5⑥）。管理のAPIの応答は、名前・説明・版・日時だけで、メッセージの中身を含まない
- アーカイブ中は、通常のチャンネルのメッセージを全体管理者も見られない（C-135は案件だけ）

### 判定の順（Service。この順を変えない）

`createChannelManageService`の`update`・`archive`・`restore`は、共通の内部関数`assertCanManage`で次の順に判定する。形の確認（422）は、これより前にrouteの`validate`で済んでいる。

1. **行がない**、または名前・説明の変更でアーカイブ済み → 404（管理者にも404）
2. **見えない（`canViewChannel`が偽）かつ、管理の権限がない（`can`が偽）** → 404。範囲外の人に、参加していない非公開・アーカイブ済みの存在を漏らさない。拒否の監査も残さない
3. **`authorize`** → 403（拒否は`authorize`が`logger.audit`（運用ログ）に記録する。D1の`audit_logs`には入らない（[audit-logs.md](audit-logs.md)）。見える公開チャンネル・参加中の非公開で、管理できない人が当たる）
4. **再認証**（アーカイブ・復元だけ。`assertRecentReauth`）→ 403 REAUTH_REQUIRED。権限のない人に再認証を求めないため、権限の後に置く
5. **種類・状態の409**（`assertState`）：案件専用はどれも409／名前の変更で通常のチャンネルでない → 409／アーカイブ・復元で通常のチャンネルでない → 409／すでにアーカイブ済み・アーカイブされていない → 409「この項目はすでに処理されています」。範囲外の人に種類・状態を漏らさないため、権限と再認証の後に置く
6. **版の不一致** → 409「ほかの人が先に変更しました。読み込み直してください」
7. 書き込み

### 書き込み（`db.batch`）

1つの`db.batch`に、次の順で入れる。順を変えない。

| 操作 | 文の順 |
| --- | --- |
| 名前・説明の変更 | 前提の確認 → 監査（`channel.update`） → チャンネルのUPDATE（変えた行を返す） |
| アーカイブ | 前提の確認 → 監査（`channel.archive`） → 通知（宛先の人数分） → アーカイブの記録のINSERT → チャンネルのUPDATE（`deleted_at`・`deleted_by`・版+1） |
| 復元 | 前提の確認 → 監査（`channel.restore`） → 通知 → 開いている記録を閉じるUPDATE → チャンネルのUPDATE（`deleted_at`・`deleted_by`をNULLに、版+1） |

- **前提の確認**は、`channels.version`を「条件が成り立てばそのまま、崩れていればNULL」にするUPDATE（`project-rules.md`の`assertStatement`と同じ方式）。NOT NULL違反でbatch全体が取り消される。条件は、判定のうちDBの行で決まるもの：チャンネルがある・版が送られた版と同じ・状態と種類（名前の変更は通常、説明だけなら案件以外。アーカイブ・復元は通常で、未アーカイブ／アーカイブ済み）・**操作者が有効で管理できる人（`channelManagerSql`）**。アーカイブ・復元は、さらに**通知の宛先の集合が読んだものと同じこと**（人数と、読んだ宛先に含まれる人数の両方）、復元は**読んだ記録が開いていること**。再認証は時刻がセッションの値でDBの行でないため入れない
- 監査・通知・記録の文にも、同じ条件を付ける（`onlyWhen`）。チャンネルが物理削除と同時に消えた場合、先頭のUPDATEは0行で失敗しないため、それらだけが残るのを防ぐ
- 監査と通知を、チャンネルのUPDATEより**前**に置く。後ろだと、UPDATE済みで状態の条件が常に偽になり、1件も残らない（`join`と同じ理由）
- 監査の`detail`：変更は変えた項目の名前（`fields`。値は入れない）、アーカイブは理由の有無（`hasReason`。理由の文は入れない）、復元は`detail`なし
- `channelManagerSql`は、`resolvePermissions`の規則（全体管理者＝会社の範囲、オーナー＝チャンネルの部署の範囲、会社直属は全体管理者だけ）をSQLで書いた**二重定義**。全組（全体管理者・自部署のオーナー・他部署のオーナー・一般・無効・会社直属）で、権限表のとおりの結果になることを`channel-manage.db.test.ts`で固定している（`resolvePermissions`を直接呼んで突き合わせるテストではなく、期待値を表で持つ）
- Repositoryは、`channels.version`のNOT NULL違反を`ChannelManageConflictError`、`channels.name_normalized`の一意索引の違反を`ChannelNameTakenError`に変える（原因の連鎖をたどって判別）。未知のDBエラーは変えずに投げる

### 0行・前提の確認の失敗の後

- **名前・説明の変更**：書き込みが0行、または`ChannelManageConflictError`のとき、操作者が有効か（無効なら401）→ 判定の順を読み直し、最初に当たった理由の応答を返す。どれにも当たらなければ、成功にせず例外（500）。`ChannelNameTakenError`は409「同じ名前のチャンネルがあります」にする（アーカイブ済みの名前との衝突も含む）。再認証はやり直さない
- **アーカイブ・復元**：書き込みの前に、通知の宛先（有効な参加者で、操作した本人以外。ID昇順）を読む（`listNotifyRecipients`）。前提の確認が失敗したら、同じ読み直しをして、理由に当たればその応答（版が変わっていれば409で、やり直さない）。**どれにも当たらない（版は同じで、宛先だけが変わった）ときだけ、宛先を読み直して同じ版で1回だけやり直す**。2回目も失敗したら409「ほかの操作と重なりました。もう一度お試しください」（成功にしない）。0行の後にどれにも当たらなければ例外

### 同時の操作

| 競合 | 結果 |
| --- | --- |
| 同じチャンネルのアーカイブが2つ | 後のほうは前提の確認で取り消され、読み直しで409。監査・通知は二重に出ない |
| アーカイブと復元 | 先に確定したほうだけ成功し、後は409 |
| 同じ版からの2人の編集 | 後のほうは409で、先の変更が残る。アーカイブ→復元で状態が戻っても、古い版の要求は409 |
| アーカイブと参加・招待（通知の宛先） | 宛先の集合を前提の確認で比べるので、確定済みの参加者は必ず宛先に入る。変わっていれば取り消してやり直す |
| アーカイブと投稿・返信・リアクションなど | 各書き込みの文の`deleted_at IS NULL`で、アーカイブの確定後のものは0行（下の表） |
| 名前の変更とチャンネル作成の承認（同じ名前） | 一意索引で後のほうが失敗する（変更は409。承認は#131の既存の扱い） |
| 操作者のオーナー交代・無効化と同時 | 条件に管理できる人・有効が入っているので、権限を失った後の書き込みは0行になり、読み直しで401／404／403 |

### アーカイブの効果（既存の経路の確認）

アーカイブは`channels.deleted_at`で表す。既存の各経路は、すでに次の条件を持っており、143-aでは足していない。

| 経路 | 止まる条件 |
| --- | --- |
| 詳細・一覧・メッセージの一覧 | `canViewChannel`が偽（アーカイブ済み）→ 404／一覧の`deleted_at IS NULL`。存在しない・見えない・アーカイブ済みを区別しない |
| 投稿・返信・編集・本人の削除・リアクション | Serviceの閲覧の判定（404）と、書き込みの文の`c.deleted_at IS NULL` |
| 参加・招待 | `canJoinChannel`・`canInviteToChannel`と、書き込みの文の`deleted_at IS NULL` |
| 指名・メンションの通知 | 宛先の条件（`eligibleMentionRecipient`）の`deleted_at IS NULL` |
| 添付の配信・既読（部屋・スレッド）・未読数・未読の印・スレッド一覧 | それぞれの文の`deleted_at IS NULL`。アーカイブで未読の印から消える |
| 通知の一覧・未読数 | 部屋の内容を含む種類（指名・招待）は`viewableRoom`で除かれ、復元で再び出る（D-R1）。アーカイブ・復元・承認の通知は残る |
| 添付のアップロード | 止めない。結び付けは投稿の条件で拒否され、未結び付けの行は24時間でCronが消す |
| 全社連絡・部署の専用への自動参加 | アーカイブできない種類なので影響なし |

メッセージ・添付・参加者・監査はアーカイブしても残り、復元で元のまま見える。

### 通知と監査

- アーカイブ・復元の通知は、そのチャンネルの**有効な参加者のうち、操作した本人を除く**全員（D-5）。種類は`channel.archived`・`channel.restored`、`room_id`はチャンネル、`target_id`はその回のアーカイブの記録のID。業務のUPDATEと同じbatchで確定する。名前・説明の変更は通知しない（2-6 AC-5③）。通知の一覧の`reason`・`roomArchived`の作り方、過去の通知を開いたときの動きは[notifications.md](notifications.md)
- `notificationInserts`の`onlyWhen`：指定したときだけ`INSERT ... SELECT`（`WHERE onlyWhen`）にする。指定しない既存の呼び出し（申請・招待・指名など）は変わらない（回帰をテストで固定）
- 監査の3操作は`audit-actions.ts`の一覧に足した。管理の拒否（403）は`authorize`が運用ログに記録する（見えないチャンネルの404は記録しない）。D1の`audit_logs`に残るのは、成功した3操作だけ

### 画面（S-05の「⋯」メニュー）

- `ChannelDetailView`のヘッダーに`ChannelManageMenu`を置く。詳細の`manage`のどれかが真のときだけ出し、「（チャンネル名）の操作」という名前のボタンで開く。キーボードで開閉でき、矢印キーで項目を移り、Escで閉じてフォーカスをボタンに戻す。S-39と共有する部品として`features/channels/index.ts`から公開する。表示の制御で、認可はサーバー
- メニューの項目：「名前・説明を編集」（`canRename`か`canEditDescription`）、「アーカイブ」（`canArchive`）。アーカイブ済みのチャンネルはS-05で開けない（404）ので、復元はS-05に出さない（入口は143-b）
- **編集のダイアログ**：名前（`canRename`が真のときだけ）・説明。画面の検査は`shared/`の規則（サーバーの検査は省略しない）。422の`fields`は該当の欄、名前の重複の409は`CHANNEL_NAME_TAKEN_MESSAGE`の文で見分けて名前の欄に出す。入力を変えて閉じるときは、離れる前の確認（`features/leave-guard`）。再認証なし。成功で閉じ、ヘッダーに「チャンネルの名前・説明を変更しました」を出し、`channelKeys.all`を取り直す
- **アーカイブのダイアログ**：理由（任意。500文字まで。残りの文字数を表示）→「アーカイブ」→ 再認証（S-26。`useReauth`）→ 送信。409はAPIの文を出し、詳細を取り直す。**成功したら、そのチャンネルの詳細は取り直さず**（もう見られず404になるため）、`/channels`へ移って「アーカイブしました」を出す（`pages/ChannelsPage.tsx`が`CHANNEL_ARCHIVED_STATE`の印を読む）。取り直すのは`channelKeys`の詳細以外のキーだけ。未読・スレッド・通知は、定期の取り直しで反映する（機能をまたぐ公開が要るため、後の子で見直す。C-181 (9)）
- **復元のダイアログ**：確認 →「復元」→ 再認証 → 送信。143-aでは部品と画面のテストだけで、143-bのS-39・S-38が使う
- 再認証が中止・失敗したときは要求を送らず、決まった文を出す（`ReauthNotCompletedError`）。再認証の有効期間切れ（REAUTH_REQUIRED）も決まった文にする
- 画面の文言（テストに定めがなかったため、実装のとおり。契約は`frontend/src/channel-manage.test.tsx`）：

| 場所 | 文言 |
| --- | --- |
| 「⋯」ボタン・メニューの名前 | 「（チャンネル名）の操作」 |
| メニューの項目 | 「名前・説明を編集」「アーカイブ」 |
| 編集の完了 | 「チャンネルの名前・説明を変更しました」 |
| 編集のダイアログ | 見出し「チャンネルの編集」、欄「名前」「説明」、ボタン「保存」「キャンセル」。入力の誤りは「名前は1〜50文字の、ひらがな・カタカナ・漢字・英数字・「-」「_」で入力してください」「説明は500文字以内で入力してください」 |
| アーカイブのダイアログ | 見出し「チャンネル「（名前）」をアーカイブしますか」、欄「理由（任意）」、ボタン「アーカイブ」「キャンセル」。理由の誤りは「理由は500文字以内で入力してください」 |
| 復元のダイアログ | 見出し「チャンネル「（名前）」を復元しますか」、ボタン「復元」「キャンセル」 |
| 再認証が完了しなかった | 「再認証が完了しなかったため、操作は実行していません」 |
| 再認証の期限切れ | 「再認証の有効期間が切れました。もう一度操作してください」 |
| アーカイブの後の一覧 | 「アーカイブしました」 |

### 主な入出力（143-a）

| 処理 | 入力 | 出力 |
| --- | --- | --- |
| `createChannelManageService().update` | 操作者、ルームID、`version`、`name?`・`description?` | `ChannelUpdated`（`id`・`name`・`description`・`version`・`updatedAt`）。404・403・409・401は上の順 |
| `.archive` | 操作者（再認証の時刻を含む）、ルームID、`version`、`reason`（なければ`null`） | `ChannelArchived`（`id`・`version`・`deletedAt`） |
| `.restore` | 操作者（再認証の時刻を含む）、ルームID、`version` | `ChannelRestored`（`id`・`version`・`restoredAt`） |
| `createChannelRepository().findForManage` | ルームID、操作者のID | `ChannelManageRow`（種類・公開／非公開・部署・状態・版・操作者の参加・開いている記録のID）。行がなければ`null`。メッセージの中身は持たない |
| `.listNotifyRecipients` | ルームID、操作者のID | 宛先の利用者ID（有効な参加者で本人以外。昇順） |
| `.update`・`.archive`・`.restore` | 上の入力に、通知の宛先・記録のIDなど | 更新後の行。行がなければ`null`。前提の確認の失敗は`ChannelManageConflictError`、名前の重複は`ChannelNameTakenError` |
| `channelManageActions(channel)` | 種類・`deletedAt` | `rename`・`editDescription`・`archive`・`restore`の真偽（種類として可能か） |
| `createChannelService().get`の`manage` | 操作者、チャンネル | `canRename`・`canEditDescription`・`canArchive`（`can`で判定。拒否を監査に記録しない） |

### 143-aのテストの場所

- 純粋関数：`backend/src/lib/channel-rules.manage.test.ts`（種類×状態の全行）、`backend/src/lib/channel-name-rules.archive-reason.test.ts`、`backend/src/lib/notification-kinds.channel-archive.test.ts`、`backend/src/lib/audit-actions.channel-manage.test.ts`
- DB結合：`backend/src/db/channel-manage.db.test.ts`（`channelManagerSql`と権限の全組の一致、各batchの条件が崩れたら0行で監査・通知も0件、名前の一意、版、宛先の集合の変化、通知の理由・`roomArchived`、既存の通知の回帰）。部品は`backend/test/channel-manage-fixtures.ts`
- Service：`backend/src/services/channel-manage.service.test.ts`（判定の順、0行の後の読み直し、宛先のやり直し）
- route：`backend/src/routes/channels.manage.test.ts`（HTTPの形・判定の順・存在の非開示・再認証・422・Origin）、`channels.archive-effects.test.ts`（アーカイブ後の各経路の404と、復元で元に戻ること）、`backend/src/routes/notifications.test.ts`、API仕様との契約`backend/src/openapi.test.ts`
- フロントエンド：`frontend/src/channel-manage.test.tsx`（メニュー・ダイアログ・アーカイブ後の一覧。ページを描画するため、機能のフォルダーでなく`frontend/src/`に置く。`pages`を参照するテストを機能のフォルダーに置くと層の依存の決まりに違反する）、`frontend/src/features/notifications/notification-views.channel-archive.test.ts`・`notifications.channel-archive.test.tsx`、既存の詳細のテスト（`channel-detail.*.test.tsx`）のMSWの応答に`version`・`manage`を足した
- E2E：`e2e/channel-archive.spec.ts`（[e2e.md](../testing/e2e.md)）。シードは`e2e/seeds/channel-archive.sql`、後始末は`channel-archive-cleanup.sql`

## API契約

詳細な形はOpenAPI（`docs/api/openapi.json`）と[api-draft.md](../requirements/api-draft.md)のEP-2-04〜06に従う。

| 操作 | 契約 |
| --- | --- |
| 一覧（EP-2-04） | `GET /api/channels`。`departmentId?`・`joined?`・`limit`・`cursor`。200で`items`（`id`・`roomId`・`name`・`visibility`・`departmentId`・`departmentName`・`joined`）と`nextCursor`。401／404（存在しない部署）／422 |
| 詳細（EP-2-06） | `GET /api/channels/{channelId}`。200で`id`・`roomId`・`name`・`description`・`visibility`・`departmentId`・`joined`・`canPost`・`isCaseChannel`。参加者にだけ`memberCount`・`members`（`id`・`displayName`）を足す。**#201で`canPost`を足した**（既存の項目は変えていない）。401／404【Issue #134で、`readOnly`（チャンネルの部署が無効で読み取り専用。部署のない会社直属は偽）を足した。画面の編集・削除のボタンの表示に使う。投稿の権限`canPost`とは別。元の記述は残す】 |
| 詳細への追記（#143） | 詳細（EP-2-06）の応答に、必須の項目として`version`（管理の操作が送る版）と`manage`（`canRename`・`canEditDescription`・`canArchive`。表示用）を足した（C-181 (3)）。既存の項目は変えていない |
| 変更・アーカイブ・復元（EP-2-36〜38。#143） | `PATCH /api/channels/{channelId}`（本文`version`必須、`name?`・`description?`は少なくとも1つ）→ 200で`id`・`name`・`description`・`version`・`updatedAt`。`POST …/delete`（本文`version`・`reason?`）→ 200で`id`・`version`・`deletedAt`。`POST …/restore`（本文`version`）→ 200で`id`・`version`・`restoredAt`。401／403（FORBIDDEN・REAUTH_REQUIRED（delete・restore）・Origin）／404／409／422。判定の順は上の「チャンネルの管理」 |
| 参加（EP-2-05） | `POST /api/channels/{channelId}/join`。200で`channelId`・`roomId`・`joinedAt`。参加済みでも200（べき等）。401／403（Origin）／404 |
| 招待（EP-2-12。#135） | `POST /api/channels/{channelId}/invitations`。本文は`userId`だけ。201で`channelId`・`userId`・`joinedAt`（要件の案の`invitationId`・`status`は返さない。C-175）。401／403（FORBIDDEN・REAUTH_REQUIRED・Origin）／404／409／422。判定の順は上の「チャンネルへの招待」 |

## 権限

新しい権限IDは作らない。認証済みの有効な社員であれば、一覧・詳細・参加を呼べる。見てよい範囲はチャンネルごとに`channel-rules.ts`で判定し、画面で隠すことを認可の代わりにしない（ADR-0012）。

## 主な入出力

| 処理 | 入力 | 出力 |
| --- | --- | --- |
| `createChannelService().list` | 操作者、`limit`・`cursor`・`departmentId?`・`joined?` | カーソル方式のページ。存在しない部署は404 |
| `createChannelService().get` | 操作者、ルームID | `ChannelDetail`。見えなければ404 |
| `createChannelService().join` | 操作者、ルームID | `ChannelJoined`（`channelId`・`roomId`・`joinedAt`）。見えない・参加できない・確認後に変わったときは404 |
| `createChannelRepository().join` | ルームID、利用者ID、trace ID | 参加日時。参加の行が作られず既存の行もなければ`null` |
| `createChannelService(repository, roles?, deps)().invite`（#135） | 操作者（再認証の時刻を含む）、ルームID、相手の利用者ID。権限の判定は`deps.authorizer`（省略時は`roles`） | `ChannelInvited`（`channelId`・`userId`・`joinedAt`）。404・403・409・401は上の判定の順と0行の後の読み直しのとおり |
| `createChannelRepository().invite`・`findInvitee`・`isUserActive`（#135） | ルームID、招待者・相手の利用者ID、trace ID | 参加日時か`null`／相手の`isActive`・`joined`か`null`／招待者が有効か |
| `canInviteToChannel(channel, inviterIsMember)`（#135） | チャンネルの状態（`purpose`・部署が有効か）、招待者が参加中か | `allowed`・`not_found`・`not_member`・`case_channel`・`department_inactive` |
| `canViewChannel(channel, isMember)` / `canJoinChannel(channel)` | `visibility`・`deletedAt`（と参加中か） | 真偽 |

## テストの場所

- 純粋関数：`backend/src/lib/channel-rules.test.ts`（全組み合わせ）
- DB結合：`backend/src/db/channel.repository.db.test.ts`（一覧・参加・監査の順序）、`backend/src/db/company-general-backfill.db.test.ts`（0010・0011の補完・冪等・名前衝突・新規DB・固定IDの突き合わせ）、`backend/src/db/channels.schema.db.test.ts`（表の制約と一意インデックス）、`backend/src/db/account.repository.db.test.ts`・`account.repository.errors.db.test.ts`（アカウント発行での参加・失敗時に何も残らない）、`backend/src/db/setup.repository.db.test.ts`
- Service・route：`backend/src/services/channel.service.test.ts`、`backend/src/routes/channels.test.ts`・`channels.unit.test.ts`、`backend/src/routes/accounts.channels.test.ts`、`backend/src/services/account.service.test.ts`・`account.service.logging.test.ts`（503とログ）、`backend/src/openapi.test.ts`
- テスト部品：`backend/test/company-general-fixtures.ts`、`backend/test/role-fixtures.ts`、`frontend/src/test/channel-handlers.ts`
- フロントエンド：`frontend/src/features/channels/channels.components.test.tsx`、`frontend/src/pages/ChannelsPage.test.tsx`、`frontend/src/channels-route.test.tsx`、`frontend/src/features/app-shell/navigation.channels.test.ts`
- #201で足したテスト：`backend/src/routes/channels.can-post.test.ts`（`canPost`）、`frontend/src/features/channels/channel-detail.messages.test.tsx`（S-05の統合）
- E2E：`e2e/channels.spec.ts`（[e2e.md](../testing/e2e.md)）。シードは`e2e/seeds/channels.sql`・`channels-cleanup.sql`
- #135で足したテスト：`backend/src/lib/channel-rules.test.ts`（`canInviteToChannel`）、`backend/src/services/channel.service.invite.test.ts`（判定の順と0行の後の読み直し）、`backend/src/routes/channels.invite.test.ts`（HTTPの形・同じ404・再認証・監査）、`backend/src/db/channel.repository.invite.db.test.ts`（書き込みの条件・原子性・0行）、`backend/src/lib/notification-kinds.channel-invite.test.ts`、`frontend/src/features/channels/channel-invite.test.tsx`・`frontend/src/features/notifications/notification-views.channel-invite.test.ts`、`e2e/channel-invite.spec.ts`（シードは`e2e/seeds/channel-invite.sql`・`channel-invite-cleanup.sql`）

## 未実施・未決定として記録するもの

| 項目 | 状態 |
| --- | --- |
| 親#132の未実施の受け入れ条件（検索、申請で作るチャンネル、非公開の招待、未読など） | 親に残す。このIssueでは作っていない（**招待は後から#135で実装した**。**未読は後から#237で実装した**。[unread.md](unread.md)。お知らせ専用の投稿制限とメッセージは#201で実装。申請で作るチャンネルは#131で実装） |
| Q-9：0009で名前が衝突して専用チャンネルが作られなかった部署の扱い | 未決。このIssueでは何も作らない。デモの前に、`audit_logs`の`department.channel_backfill`と`channel.company_general_backfill`の`failure`の有無を確かめる |
| 全社連絡の退出 | APIを作っていない。全社連絡から外れる経路はない |
| レート制限（EP-2-04〜06） | 入れていない。上限がX-8で決まっていないため、別Issueで扱う（[project-rules.md](../project-rules.md)） |
| 本番のD1での0010・0011の適用 | **未実施**。ローカルの使い捨てD1でのリハーサル（0009まで適用 → 部署・有効2名・無効1名を投入 → 0010・0011を適用 → 再適用／名前衝突／新規DB）は実施済み。本番への適用は、利用者の承認が別途必要（[ADR-0022](../adr/0022-company-general-channel-seed-migration-exception.md)） |
| `DepartmentFilter`の選択肢 | 読み込み済みの一覧にある部署だけが選べる（上記） |

## 関係するIssue・ADR

- Issue #200：本Issue。親Issue #132。#201（メッセージ。`channel.repository`・EP-2-06・S-05が重なる）が後続。#201で実装済み（[messages.md](messages.md)）
- [department-management.md](department-management.md)（#196。`rooms`・`channels`・`channel_members`の約束）、[accounts.md](accounts.md)（#199）
- [channel-requests.md](channel-requests.md)（#131）：通常のチャンネルは、申請の承認の時に初めて作られる（`rooms`→`channels`→`channel_members`を承認の`db.batch`で作る。承認待ちの間は`channels`に行がないため、このIssueの一覧・詳細・参加には出ない）。申請の名前の重複は、`channels.name_normalized`（アーカイブ済みを含む）と、承認待ちの申請が対象
- ADR-0006：ID・カーソル／ADR-0012：サーバー側で毎回認可する／ADR-0020：ミューテーション・E2Eの実行範囲
- [ADR-0022](../adr/0022-company-general-channel-seed-migration-exception.md)：全社連絡を補う手作成migrationの例外
- Issue #135（親 #132 の残りを含む。2-4 AC-2・AC-3、2-5 AC-1〜7。招待）：決定記録C-175
- Issue #143（チャンネルの管理とアーカイブ。最初の子・143-a。PR #287）：決定記録C-181。要件：2-6 AC-1・4・5・6、3-4 AC-5、EP-2-36〜38、S-05。ADR-0024（列の追加で作り直しが生成されたとき。今回は新しい表のため該当しない）
- 要件：2-1 AC-16・17、0-1 AC-15、2-3 AC-1・2、S-09。決定記録C-94・C-95・C-163
