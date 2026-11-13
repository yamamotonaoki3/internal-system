# 全社連絡と、公開チャンネルの一覧・閲覧・参加（Issue #200）

## 目的

社員が、チャンネルを探して（S-09）、公開チャンネルに自分で参加できるようにする。あわせて、申請なしの初期データとして「全社連絡」を用意し、全員を参加させる。サイドバーには、参加中のチャンネルを出す。コードは書き写さず、ファイル名・関数名で指す。

## 範囲

| 区分 | 内容 |
| --- | --- |
| このIssueで作ったもの | EP-2-04（一覧）・EP-2-05（参加）・EP-2-06（詳細）／全社連絡の用意（部分一意インデックスのmigration 0010と、初期データのmigration 0011）／アカウント発行・初回セットアップでの全社連絡と部署の専用チャンネルへの参加／S-09（チャンネルを探す）・詳細画面の入口・サイドバーの「参加中のチャンネル」／監査操作`channel.join`・`channel.company_general_backfill` |
| 親#132に残すもの（未実施） | 検索（2-3 AC-3）、申請で作るチャンネル（**#131で実装した**。[channel-requests.md](channel-requests.md)）、非公開チャンネルの招待（2-4 AC-1〜4。#135）、拠点ラベル（C-119）、未読（#124）、チャンネルのアーカイブ、退出。なお、お知らせ専用チャンネルの投稿制限（2-3 AC-4）とメッセージは**#201で実装した**（[messages.md](messages.md)） |
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

- 見せる範囲：アーカイブされていない、会社直属と全部署の公開チャンネル、および自分が参加している非公開チャンネル。参加していない非公開は出さない
- 各項目に、`departmentId`（会社直属は`null`）、`departmentName`（会社直属は`null`）、`joined`を含める。参加の有無は`channel_members`のLEFT JOINで求めるため、件数が増えてもSQLの数は増えない
- 絞り込み：`departmentId`（存在しない部署は404）、`joined`（`true`／`false`）。並びは名前の比較キー・ルームIDの昇順で、`cursor.ts`のカーソル方式（`PAGE_LIMIT`。既定20、最大100）。壊れたカーソルは422

### 参加（`POST /api/channels/:channelId/join`）

`join`は、参加の行の挿入と監査ログ（`channel.join`）を**同じ`db.batch`**で確定する。

- 監査ログの文を、参加の挿入より**前**に置く。どちらも「今も公開で未アーカイブ」かつ「参加の行がまだない」ときだけ書く。順序が逆だと、挿入済みで条件が常に偽になり、監査が1件も残らない（テストで検出する）。初回は監査が1件、2回目は0件
- 確認から書き込みまでの間にアーカイブ・非公開化された場合は、参加の行が作られず、`join`が`null`を返す。Serviceはこれを404にする
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

## API契約

詳細な形はOpenAPI（`docs/api/openapi.json`）と[api-draft.md](../requirements/api-draft.md)のEP-2-04〜06に従う。

| 操作 | 契約 |
| --- | --- |
| 一覧（EP-2-04） | `GET /api/channels`。`departmentId?`・`joined?`・`limit`・`cursor`。200で`items`（`id`・`roomId`・`name`・`visibility`・`departmentId`・`departmentName`・`joined`）と`nextCursor`。401／404（存在しない部署）／422 |
| 詳細（EP-2-06） | `GET /api/channels/{channelId}`。200で`id`・`roomId`・`name`・`description`・`visibility`・`departmentId`・`joined`・`canPost`・`isCaseChannel`。参加者にだけ`memberCount`・`members`（`id`・`displayName`）を足す。**#201で`canPost`を足した**（既存の項目は変えていない）。401／404 |
| 参加（EP-2-05） | `POST /api/channels/{channelId}/join`。200で`channelId`・`roomId`・`joinedAt`。参加済みでも200（べき等）。401／403（Origin）／404 |

## 権限

新しい権限IDは作らない。認証済みの有効な社員であれば、一覧・詳細・参加を呼べる。見てよい範囲はチャンネルごとに`channel-rules.ts`で判定し、画面で隠すことを認可の代わりにしない（ADR-0012）。

## 主な入出力

| 処理 | 入力 | 出力 |
| --- | --- | --- |
| `createChannelService().list` | 操作者、`limit`・`cursor`・`departmentId?`・`joined?` | カーソル方式のページ。存在しない部署は404 |
| `createChannelService().get` | 操作者、ルームID | `ChannelDetail`。見えなければ404 |
| `createChannelService().join` | 操作者、ルームID | `ChannelJoined`（`channelId`・`roomId`・`joinedAt`）。見えない・参加できない・確認後に変わったときは404 |
| `createChannelRepository().join` | ルームID、利用者ID、trace ID | 参加日時。参加の行が作られず既存の行もなければ`null` |
| `canViewChannel(channel, isMember)` / `canJoinChannel(channel)` | `visibility`・`deletedAt`（と参加中か） | 真偽 |

## テストの場所

- 純粋関数：`backend/src/lib/channel-rules.test.ts`（全組み合わせ）
- DB結合：`backend/src/db/channel.repository.db.test.ts`（一覧・参加・監査の順序）、`backend/src/db/company-general-backfill.db.test.ts`（0010・0011の補完・冪等・名前衝突・新規DB・固定IDの突き合わせ）、`backend/src/db/channels.schema.db.test.ts`（表の制約と一意インデックス）、`backend/src/db/account.repository.db.test.ts`・`account.repository.errors.db.test.ts`（アカウント発行での参加・失敗時に何も残らない）、`backend/src/db/setup.repository.db.test.ts`
- Service・route：`backend/src/services/channel.service.test.ts`、`backend/src/routes/channels.test.ts`・`channels.unit.test.ts`、`backend/src/routes/accounts.channels.test.ts`、`backend/src/services/account.service.test.ts`・`account.service.logging.test.ts`（503とログ）、`backend/src/openapi.test.ts`
- テスト部品：`backend/test/company-general-fixtures.ts`、`backend/test/role-fixtures.ts`、`frontend/src/test/channel-handlers.ts`
- フロントエンド：`frontend/src/features/channels/channels.components.test.tsx`、`frontend/src/pages/ChannelsPage.test.tsx`、`frontend/src/channels-route.test.tsx`、`frontend/src/features/app-shell/navigation.channels.test.ts`
- #201で足したテスト：`backend/src/routes/channels.can-post.test.ts`（`canPost`）、`frontend/src/features/channels/channel-detail.messages.test.tsx`（S-05の統合）
- E2E：`e2e/channels.spec.ts`（[e2e.md](../testing/e2e.md)）。シードは`e2e/seeds/channels.sql`・`channels-cleanup.sql`

## 未実施・未決定として記録するもの

| 項目 | 状態 |
| --- | --- |
| 親#132の未実施の受け入れ条件（検索、申請で作るチャンネル、非公開の招待、未読など） | 親に残す。このIssueでは作っていない（**未読は後から#237で実装した**。[unread.md](unread.md)。お知らせ専用の投稿制限とメッセージは#201で実装。申請で作るチャンネルは#131で実装） |
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
- 要件：2-1 AC-16・17、0-1 AC-15、2-3 AC-1・2、S-09。決定記録C-94・C-95・C-163
