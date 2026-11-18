# 案件の一覧・概要・詳細・参加者・納期（Issue #147 の 147-A・147-B）

## 目的

社員が案件の一覧（S-16）を開き、参加している案件は説明・参加者まで見られ、参加していない案件は概要（件名・状態・取引先・担当部署・納期など）だけを見られるようにする。サイドバーの「案件」の見出しの下に、参加している進行中の案件を出す。案件の作成の承認（[case-requests.md](case-requests.md)）でできた案件への入口である。コードは書き写さず、ファイル名・関数名で指す。

Issue #147 は「影響大」で、4つの子に分けた（C-182）。この設計書は 147-A（読み取りだけ）と 147-B（参加者の追加・削除・退出と、納期の変更。書き込み）の範囲を書く（147-B は「147-B の設計」の節）。147-C-2 は、この設計書に節を足していく。

## 範囲

| 区分 | 内容 |
| --- | --- |
| 147-Aで作ったもの | API3つ（EP-5-06 一覧・EP-5-07 概要・EP-5-08 詳細）／「有効な参加者」の共通の SQL の部品`activeChannelMember`／管理の資格（参加者数と`canManage`）を読み取りの SQL の中で決める仕組み／S-16（案件一覧）・S-17（詳細の骨格）／メニュー「案件」とサイドバーの「案件」の見出しの下の参加中の案件／承認の通知の移動先の変更（C-179(3)の約束）／自分の申請の案件番号のリンク／承認の後の案件のキャッシュの取り直し |
| 147-C-1で作ったもの | チャンネルの参加の行を資格に使う経路（書き込み6・読み取り7＋`findForManage`の`isMember`）を「有効な参加者」に変えた（実装では、書き込み6・読み取り6＋`findForManage`の`isMember`と、中身の読み取り〔メッセージ5・参加者2・メンションの候補1〕を`roomViewableBy`で判定する形に変えた）。APIも画面も追加しない（下の「147-C-1 が広げた経路」） |
| 147-Bで作ったもの | API3つ（EP-5-09 参加者の追加・EP-5-10 参加者の削除と本人の退出・納期の変更）／自動参加の人は外せないこと（役割の名前の表示を含む）と最後の有効な参加者の規則／監査操作3つと対象の種類`case`／S-17 の「参加者を管理」・退出・「納期を変更」（下の「147-B の設計」） |
| 後の子（着手の順） | **147-C-2** 無効化で案件の参加の記録を残すこと、AC-15 の守り、再有効化・異動の確認、オーナー交代による自動参加、既存の案件の補完 |
| 他の Issue に回すもの | やり取り・未読・最終更新（#148）、TODO・進捗（#149）、終了・再開・再編集（#150）、アーカイブ・物理削除（#151）、名前・番号での絞り込みと検索（#155）、全体管理者の任命・引き継ぎによる自動参加（#157） |
| 作らないもの | migration（表は146-Bで作った`cases`・`case_departments`・`channel_members`をそのまま使う）、`case_participants`表、`cases(status,id)`の索引（デモの規模では要らない。要るようになったら利用者に戻す）、一覧の既定値（`scope`・`status`は必須。画面が「参加中・進行中」から始める） |
| 本Issueで確定した決定 | [C-182](../requirements/decision-register.md) |

## ファイルと役割

### バックエンド

| ファイル | 役割 |
| --- | --- |
| `backend/src/routes/cases.ts` | Controller。`GET /api/cases`・`/:caseId`・`/:caseId/detail`。入力の形の確認（`scope`・`status`は必須、`limit`・`cursor`。`caseId`は ULID の形。いずれも`strict`）と応答だけ。全応答に`noStore`。認証と送信元の確認は`app.ts`が`/api/*`に一括で適用する。`backend/src/index.ts`で`/api/cases`に登録 |
| `backend/src/services/case.service.ts` | Service。認可・判定の順・存在の非開示・監査用のログ（`logger.audit`）。Repository が返した結果（詳細は`not_found`・`not_visible`）を 404・403 に分ける。管理の資格は、Service では判定しない（Repository が読み取りの SQL の中で決める）。HTTP を知らない |
| `backend/src/db/case.repository.ts` | Repository。`list`（一覧）・`findSummary`（概要1件）・`findDetailExtras`（詳細だけの項目。操作者の ID を受け取り、戻り値は詳細の項目か`not_visible`か`not_found`）。`list`・`findSummary`は操作者の ID だけを受け取る。見える範囲と資格は SQL で決める。読み取りだけで、監査・通知は書かない |
| `backend/src/db/channel-member.sql.ts` | 「有効な参加者」の共通の部品`activeChannelMember`（下の節） |
| `docs/api/openapi.json` | 3つの API の契約（`backend/src/openapi.test.ts`が実装と照合する） |

### フロントエンド

| ファイル | 役割 |
| --- | --- |
| `frontend/src/features/cases/index.ts` | 公開の入口。`caseKeys`・`CaseDetailView`・`CaseList`・`CaseSidebarSection`だけを公開する。ほかの層（pages・app-shell・case-requests）はここだけを通して使う |
| `features/cases/api/case-api.ts` | `apiClient`で3つの API を呼ぶ。応答は Zod で検証する。一覧の範囲・状態の定数と型もここ |
| `features/cases/api/query-keys.ts` | `caseKeys`（`all`・`list`・`summary`・`detail`）。キーに利用者の ID を入れる |
| `features/cases/hooks/useCases.ts` | `useCases`（無限スクロール式の一覧）・`useCaseSummary`・`useCaseDetail`（概要で参加者と分かったときだけ取る）。利用者の ID が確かめられる前は取得しない |
| `features/cases/components/` | `CaseList`（切り替え・4つの状態・次のページ）、`CaseSummaryFacts`（一覧の行と詳細のヘッダーで共用する概要の項目）、`CaseHeader`、`CaseDetailView`（S-17 の骨格）、`CaseParticipantList`、`CaseSidebarSection`（サイドバー） |
| `features/cases/labels.ts`・`describe-error.ts` | 表示名（状態・「（無効）」・「参加者 N人」・非公開の文）と、失敗の文の組み立て |
| `frontend/src/pages/CasesPage.tsx`・`CaseDetailPage.tsx` | 構成だけ。`App.tsx`に`/cases`・`/cases/:caseId`を足した。`CaseDetailPage`は`caseId`を`key`にして、案件が替わったら状態を持ち越さない |
| `frontend/src/features/app-shell/navigation.ts`・`SidebarNav.tsx` | メニュー「案件の申請」を「案件」（`/cases`。全員に出す。権限の条件は付けない）に置き換えた。`SidebarNav.tsx`の決まった位置（DM のセクションの次）に`CaseSidebarSection`を足した（[app-shell.md](app-shell.md)） |
| `frontend/src/features/notifications/notification-views.ts` | `case_request.approved`の移動先を`/cases`に変えた |
| `frontend/src/features/case-requests/` | `MyCaseRequestList.tsx`：承認済みの行の案件番号を`/cases/:caseId`へのリンクにした（案件の ID がないときは文字のまま）。`hooks/useDecideCaseRequest.ts`：承認の成功で`caseKeys.all`も取り直す |
| `frontend/src/test/case-handlers.tsx`・`server.ts` | MSW。枠を描画する全テストで`/api/cases`の既定の応答を空にする（サイドバーが取るため）。個別のテストは`respondCases`で上書きする |

## 判定の順と存在の非開示

| API | 判定の順 |
| --- | --- |
| 一覧（EP-5-06） | 認証（401）→ クエリの形（422）→ `authorize(perm.case.summary.view, company)`（403。拒否は`authorize`が記録する） |
| 概要（EP-5-07） | 認証 → `authorize(perm.case.summary.view)` → 案件がない（404「案件が見つかりません」。`logger.audit`） |
| 詳細（EP-5-08） | 認証 → 案件がない（404）→ **有効な参加者でない**（403「参加者だけが見られます（非公開）」。`logger.audit`）→ `authorize(perm.case.view, company)`（403）→ 詳細の項目の読み込み（`findDetailExtras`。1つの batch で資格と中身を同じ時点に読み、`not_found`なら 404、`not_visible`なら 403。物理削除は#151） |

- 概要は全員に見えるので、案件があるかどうかは秘密ではない（5-1 AC-2）。詳細の 403 と 404 の違いで漏れるのは存在だけで、説明・参加者・チャンネル ID は、有効な参加者でなければ一覧・概要・エラーのどこにも出ない
- **全体管理者・担当部署のオーナーでも、参加していなければ詳細は 403**（AC-2・AC-21。参加していれば 200）
- 読み取りだけなので、通知と監査ログ（DB）は書かない。拒否だけを`logger.audit`に残す
- 詳細の 403 の後に参加から外された人が詳細を取り直しても 403 になる。画面は「参加者だけが見られます（非公開）」に切り替え、前の詳細を残さない

## 「有効な参加者」の判定（`activeChannelMember`）

- 参加の行（`channel_members`）があり、**かつ利用者が有効（`users.is_active = 1`）**であること。一覧の`joined`・`isParticipant`・詳細の 403 の判定は、この部品だけを使う
- 一覧の`joined`・`isParticipant`と、詳細の中身を読む SQL（案件の行・参加者の一覧）は、この部品を条件に入れる。引数は、部屋（案件の`channel_id`）と利用者。どちらも値でも外側の表の列（SQL の式）でも渡せるので、一覧の1行ごとの判定（`CASE WHEN`）にも使える
- **「記録として残す参加の行」と「いまの閲覧・操作の資格」を分ける**。参加の行は、退職者を参加者の一覧に残す・参加者数に数えるための記録で（C-142(1)）、資格ではない。資格の判定に`channel_members`を直接結合する書き方は、この子の後は作らない
- この時点では、無効化は、まだ参加の行を消す（147-C-2 で、記録を残す形に変える）。147-C-1 は、その前に、資格の判定を記録から切り離すための変更で、実装した（次の節）。検索（#155）もこの部品を使う

### 147-C-1 が広げた経路（実装済み）

条件は`activeChannelMember`と同じ規則（参加の行があり、本人が有効）に揃えた。ほかの条件（部屋が未アーカイブ、部署が有効、お知らせ専用の役割、公開・非公開）は変えていない。書き込みが0行・見えないときの Service の扱い（原因を読み分け、見えないものは 404）も変えていない。

| 区分 | ファイル（関数） | 経路 |
| --- | --- | --- |
| 書き込み | `message.repository.ts`（`insertIfOrdered`の`postable`） | 投稿（添付の結び付けを含む） |
| 書き込み | `reply-insert.sql.ts` | 返信 |
| 書き込み | `message-modify.sql.ts`（`modifiable`） | 投稿の編集・削除 |
| 書き込み | `message-reactions.sql.ts`（`reactable`） | リアクションの追加・取り消し |
| 書き込み | `read-position-advance.sql.ts` | 既読位置の前進 |
| 書き込み | `thread-read-advance.sql.ts` | スレッドの既読位置の前進 |
| 読み取り | `channel.repository.ts`（`list`の`joined`） | チャンネル一覧の参加中の判定・非公開の表示 |
| 読み取り | `channel.repository.ts`（`findForViewer`の`joinedAt`） | チャンネルの詳細・メンバーの一覧、メッセージの一覧・返信・スレッド・メンションの候補・未読の呼び出し元の判定 |
| 読み取り | `thread-list.sql.ts` | スレッドの一覧 |
| 読み取り | `attachment-visibility.sql.ts`（`attachmentVisible`） | 添付の配信 |
| 読み取り | `unread-targets.sql.ts` | 未読の対象・未読の数 |
| 読み取り | `notification.repository.ts`（`viewableRoom`） | 通知の一覧・未読数・既読（部屋の内容を含む種類の閲覧の可否） |
| 読み取り | `channel.repository.ts`（`findForManage`の`isMember`） | チャンネルの管理の操作の資格。計画の洗い出しにはなかったが、資格の判定に使われていたので足した |

- 共通の部品：`room-visibility.sql.ts`の`roomViewableBy(roomId, viewerId)`（下の「中身の読み取り」）、`channel-member.sql.ts`の`activeChannelMember`（`EXISTS`の条件。書き込み・スレッド・添付・通知）と、`activeMembershipJoin`（drizzle の`channel_members`の外部結合の条件。`list`・`findForViewer`・`findForManage`。閲覧者の有効性は主キーで1行を引く）。`unread-targets.sql.ts`は、既存の結合に`users`の有効性の結合を足した
- 変えなかったもの：①招待の相手が参加済みかの判定（`channel.repository.ts`の`findInvitee`の`joined`。相手が無効なら、先に 404 になる）、②公開チャンネルの閲覧・公開チャンネルへの参加、③DM（`conversation_members`。当事者に無効な社員がいれば読めない・書けない既存の条件がある）、④参加者数・参加者の一覧（もともと`users.is_active = 1`で数える）、⑤通知・メンションの宛先（`eligibleMentionRecipient`など。もともと有効な利用者だけに絞っている）
- 有効な参加者から見える動きは変えていない。変わるのは、参加の行だけが残った無効な利用者と、認証の後に無効化が確定した処理中の要求の扱い。管理の権限のない無効な利用者の、チャンネルの管理の操作は、403 ではなく 404（見えない）になる
- **中身の読み取り（コードレビュー1回目の重大への対応）**：`findForViewer`が「参加中」を返した後、本文・返信・参加者を読む別の SQL の前に無効化が確定すると、後ろの SQL が資格を確かめ直さず、非公開の中身が返る。そこで、見える・見えないの規則（閲覧者が有効で、チャンネルなら、未アーカイブで、公開か閲覧者が参加している非公開。DM なら当事者）を、`room-visibility.sql.ts`の`roomViewableBy`にまとめ、中身を読む SQL の条件に入れた。閲覧者が無効なら、公開チャンネル・DM も返さない（有効な閲覧者に返す結果は変えていない）

| 区分 | ファイル（関数） | 経路 |
| --- | --- | --- |
| 中身の読み取り（メッセージ5） | `message.repository.ts`（`listLatest`・`listAfter`・`findItem`・`listRepliesLatest`・`listRepliesAfter`） | メッセージの一覧・1件・返信の一覧。SQL に`roomViewableBy`を入れた |
| 中身の読み取り（参加者2） | `channel.repository.ts`（`countMembers`・`listMembers`） | 閲覧者を必須で受け取り、有効な参加者でなければ 0・空。チャンネルの詳細は、非公開で 0 なら 404。公開チャンネルの非参加者は、これまでどおり、参加者の情報なしで 200 |
| 中身の読み取り（メンションの候補1） | `listMentionCandidates`の`visibleTo`（必須） | 部屋を見てよい閲覧者にだけ名簿を返す |
| 規則の寄せ直し | `attachment-visibility.sql.ts`の`attachmentVisible`、`notification.repository.ts`の`viewableRoom` | `roomViewableBy`を使う形に寄せた |

- チャンネルの詳細は、資格の確認の後に、参加者数の読み取りが 0 を返したら（その間に資格を失った）、名前・説明を返さずに 404 にする（`backend/src/services/channel.service.ts`）
- DM の「当事者に無効な社員がいれば読めない」は、既存の規則（読めなくするのは送信だけ）のまま変えていない
- 経路の数：計画は「書き込み6・読み取り7」だったが、実装で変えたのは、書き込み6・読み取り6＋`findForManage`の`isMember`と、中身の読み取り（メッセージ5・参加者2・メンションの候補1）。招待の相手の判定（`findInvitee`）は変えていない
- テストの場所：`backend/src/db/channel-member.active-writes.db.test.ts`（書き込み6経路。参加の行を残したまま操作者を無効にすると何も残らない）、`backend/src/db/channel-member.active-reads.db.test.ts`（読み取りの各経路）、`backend/src/services/channel-member.active-race.test.ts`（認証の後・取得の前に無効化が確定する競合）

## 設計の方針：中身を読む SQL の条件に、その時点の資格を入れる

- 資格（有効な参加者・管理の資格）を先に確かめてから、別の読み取りで中身（説明・参加者・参加者数）を読む書き方はしない。確かめた後、読むまでの間に無効化・交代が確定した処理中の要求に、中身が返ってしまうため（コードレビュー1回目の重大2件。C-182）
- 詳細（`findDetailExtras`）：案件の行（説明・チャンネルの ID・作成者）と参加者の一覧を、**1つの`db.batch`で読み**、どちらの文にも「操作者が有効な参加者である」条件（`activeChannelMember`）を入れる。案件の行の側は、資格の判定結果（`visible`）と一緒に読み、資格がなければ中身を捨てて`not_visible`を返す。参加者の一覧の側は、条件を満たさなければ0行になる。案件がなければ`not_found`。Service は、`not_found`を 404、`not_visible`を 403 に分ける
- 参加者数・`canManage`：`list`・`findSummary`が、操作者の ID だけを受け取り、行を読む SQL の中で決める（`participantCount`は、同じ文の中で、有効な参加者か管理の資格のある行にだけ数える）
- 後の子（147-C-1・147-B）も同じ方針にする：書き込みは前提を batch の先頭の条件にし、読み取りは中身を読む SQL に資格を入れる。資格を確かめる読み取りと、中身の読み取りが別の文になっている既存の経路にも、同じ方針を通した（147-C-1。`roomViewableBy`）。**後の変更で、部屋の中身を読む SQL を足すときは、`roomViewableBy`を条件に入れる。**Service の事前の判定は、エラーの分類（403・404）のためのもので、最後の砦ではない
- 選択項目の`sql`の副問い合わせに外側の表の列を書くときの書き方は、`docs/project-rules.md`の「選択項目の`sql`の副問い合わせ（Issue #294）」に従う（`readDecisionFacts`の担当部署の数も同じ書き方）。

## 管理の資格と参加者数

- 5-1 AC-21（Q6）のうち、#147 で満たすのは「管理に必要な情報の表示」と、後の子の納期の変更だけ。「⋯」メニューの編集・アーカイブは#150・#151
- 管理の資格は、操作者が**有効**で、(a) 有効な全体管理者（会社範囲）、または (b) その案件の担当部署のどれかの有効なオーナーであること。一覧・概要の`canManage`と`participantCount`に使う。後の子（納期の変更）も、同じ条件の SQL を使う
- `case.repository.ts`が、行を読む SQL の中で、その時点の有効性・参加・ロールの割り当てから行ごとに決める（Service が先に割り当てを読む処理はない。純粋関数`canManageCase`は、使われなくなったので削除した。観点は DB のテストで確かめる）。N+1 にならない
- **`participantCount`を返す相手**：その案件の有効な参加者か、管理の資格のある人。それ以外（一般の非参加者）は`null`。自動参加が未適用の既存の案件でも、担当部署のオーナー・全体管理者は参加者数を見られる（非参加でも。説明・参加者の一覧・チャンネル ID は見られない）
- `participantCount`は、参加の行の数で、退職者を含む（S-17 の「参加者 N人」と、詳細の参加者の一覧の行数を合わせるため）

## API契約と主な入出力

| 操作 | 入力 | 出力 |
| --- | --- | --- |
| 一覧（EP-5-06） | `scope`（`joined`・`all`。必須）、`status`（`active`・`closed`。必須）、`limit`（既定20・最大100）、`cursor` | 200：`items`・`nextCursor`。項目は概要の項目（下） |
| 概要（EP-5-07） | パスの`caseId` | 200：概要の項目 |
| 詳細（EP-5-08） | パスの`caseId` | 200：概要の項目に、`description`・`channelId`・`createdBy`・`participants`を足したもの |

- 概要の項目：`id`・`caseNumber`・`title`・`status`・`client`（`id`・`name`・`isActive`）・`departments`（`id`・`name`・`isActive`）・`dueDate`（`YYYY-MM-DD`または`null`）・`isParticipant`・`canManage`・`participantCount`（上の節のとおり`null`になることがある）・`canEditDueDate`（147-B で足した。進行中で、有効な参加者か管理の資格のある人なら真）。進捗は含めない（#149）
- 詳細の`createdBy`は**作成者の利用者の ID**。`participants`は、`userId`・`displayName`・`departmentName`・`isActive`・`isCreator`・`autoRole`・`removable`（後の2つは147-B で足した）。並びは参加した日時、同じなら利用者 ID の順。退職者（無効）も残し、`isActive`を偽にする
- エラー：401（未認証）、403（権限がない・詳細で参加者でない）、404（案件がない）、422（クエリ・パスの形。`fields`）。応答は`noStore`
- 具体的な項目の型は`docs/api/openapi.json`を正とする

## 一覧の SQL

- 範囲は SQL の`WHERE`で絞る：`status`の一致、`joined`のときだけ`activeChannelMember`（操作者の ID）、続きはカーソル。並びは案件 ID の降順（`cursor.ts`の`afterCursor`・`toPage`。OFFSET は使わない。`limit + 1`件を読んで次のページの有無を決める）。ページを送っても、参加していない案件は`joined`に混ざらない
- `all`は全件を返すが、非参加の行は概要の項目だけで、`participantCount`は参加者か管理の資格のある行にしか入らない。説明・チャンネル ID・参加者は、一覧では読まない
- **N+1 にしない**：本体の行（案件・取引先・`isParticipant`・`canManage`・`participantCount`を同じ文の中で決める）を1回、そのページの担当部署を1回の、2回の読み込みで組み立てる。担当部署は、そのページの ID を`json_each`の1つの値で渡して`IN`で読む（D1 の束縛できる値の数の上限に、件数が掛からないようにするため）
- 担当部署の並びは、部署名・ID の順（自分の申請の一覧と同じ。「選んだ順」は列がないため再現しない）

## 画面

| 画面 | ファイル | 内容 |
| --- | --- | --- |
| S-16 案件一覧（`/cases`） | `pages/CasesPage.tsx`、`features/cases/components/CaseList.tsx` | 「自分が参加する案件／すべての案件」と「進行中／終了した案件」の切り替え（共通の部品`frontend/src/components/RadioGroup.tsx`を使う。props は、見出し`label`・`options`（`value`と`label`の組）・`value`・`onChange`・`disabled`。素のラジオで矢印キーで移せる。`className`は受け取らない。[ADR-0015](../adr/0015-style-foundation.md)。初期は「自分が参加する案件・進行中」）。行は件名（S-17 へのリンク）と、案件番号・状態・取引先（無効なら「（無効）」）・担当部署（「・」でつなぐ）・納期（`YYYY-MM-DD`。過ぎていても強調しない）・参加者数（返されたときだけ）。読み込み中・エラー・0件・ありの4つを分ける。0件の文言は「参加している案件はありません」「案件はありません」「終了した案件はありません」。続きは「次のページ」のボタン。「案件の作成を申請」のリンクで`/case-requests`（S-18）へ移る（自分の申請は S-18 に置いたまま） |
| S-17 案件詳細（骨格。`/cases/:caseId`） | `pages/CaseDetailPage.tsx`、`CaseDetailView.tsx`・`CaseHeader.tsx`・`CaseParticipantList.tsx` | まず概要を取り、`isParticipant`のときだけ詳細を取る。参加者には、ヘッダー（件名・案件番号・状態・取引先・担当部署・納期・参加者数）・説明・参加者の一覧（表示名・部署名・「作成者」・退職者は「退職者」）。非参加者には概要の項目と「参加者だけが見られます（非公開）」だけを出し、説明・参加者を出さない（AC-14）。詳細が 403（外された）のときも同じ表示にする。存在しない案件は「案件が見つかりません」。やり取り・TODO・添付の項目は置かない（動かない仮の項目を置かない。#148・#149） |
| サイドバーの「案件」 | `CaseSidebarSection.tsx`（`SidebarNav.tsx`から1か所で呼ぶ） | 見出し「案件」の下に、参加している進行中の案件（最初の1ページ）。件名を押すと S-17 へ移る。読み込み中・エラー・0件（「参加中の案件はありません」）を、この部品の中に出し、枠全体は壊さない。どの立場の人も、メニュー「案件」→ S-16 → S-17 の経路でも行ける。サイドバーの取得は、再試行なし・利用者の ID があるときだけ行い、セッション切れの後は止まる（`features/cases/hooks/useCases.ts`） |
| メニュー | `navigation.ts` | 「案件」（`/cases`）。146-A の仮の入口「案件の申請」を置き換えた |
| 通知 | `notification-views.ts` | `case_request.approved`の移動先は`/cases`（[notifications.md](notifications.md)） |
| 自分の申請（S-18） | `MyCaseRequestList.tsx` | 承認済みの行の案件番号が、`/cases/:caseId`へのリンクになる |

- **キャッシュ**：キーは`caseKeys`の1か所で定義し、`list`・`summary`・`detail`のキーに**利用者の ID**を含める（ログインし直した別の利用者に、前の利用者の案件を見せないため）。利用者の ID がセッションで確かめられる前は取得しない（`enabled`）。一覧の切り替えのときに前の一覧を残すのは同じ利用者のときだけ（`placeholderData`で判定。146-B と同じ）。詳細は、概要で参加者と分かったときだけ取る。サーバーのデータを`useState`にコピーしない
- **承認の後の取り直し**：S-29 で承認に成功すると、`caseKeys.all`を取り直す（却下では取り直さない）。再読み込みなしで、サイドバーの参加中の案件に新しい案件が出る

## 個人情報・権限

- 参加者の一覧には、**表示名と部署名だけ**を返す。本名・メールアドレスは読まない・返さない
- 利用者の ID はセッションから取る。見える範囲は毎回サーバーで認可する（画面で隠すことを認可の代わりにしない。ADR-0012）
- 権限は`perm.case.summary.view`（R-78。全員）と`perm.case.view`（R-62。参加者）。権限の一覧は変えていない。一般メンバーのロールにも付いている

## 同時の操作

147-A は読み取りだけで、書き込みの競合はない（147-B の書き込みの競合は「147-B の設計」の「同時の操作」）。一覧と詳細を読む間に参加から外れたときは、次に詳細を取ると 403 になり、画面が非公開の表示に切り替わる。

## 147-B の設計（参加者の追加・削除・退出と、納期の変更）

決定は C-182 の Q1・Q2・Q6・Q8 と、147-B の統括の決定（(19)〜(25)）。migration はない（`channel_members`・`cases`を使う）。

### 用語（`backend/src/lib/case-participant-rules.ts`。純粋関数）

- **参加者**：`channel_members`に、案件の`channel_id`と社員の行があること。**有効な参加者**：参加者で、`users.is_active = 1`（`activeChannelMember`）。自動参加の全体管理者・オーナーも数える（Q1）
- **自動参加の人**：有効で、会社範囲の全体管理者、または案件の担当部署のどれかのオーナー。印の列は持たず、いまの割り当てから導く（`autoRoleOf`。両方なら`global_admin`）
- `canRemoveParticipant`：自動参加の人は外せない（本人の退出も。Q2）。外すと有効な参加者が0人になるなら外せない（Q1）
- 書き込みの前提の SQL（`case.repository.ts`）も、これと同じ意味の条件を持つ。**片方だけを変えない**

### ファイルと役割（147-B で足したもの）

| ファイル | 役割 |
| --- | --- |
| `backend/src/routes/cases.ts` | `POST /:caseId/participants`・`DELETE /:caseId/participants/:userId`・`PATCH /:caseId/due-date`。パスの形（ULID）と、本文が JSON のオブジェクトであることだけを確かめる。**本文の項目の形（422）は Service が 403 までの判定の後に確かめる**（非参加者に、本文の誤りと他の理由を区別させない。存在の非開示）。全応答に`noStore` |
| `backend/src/services/case.service.ts` | `addParticipant`・`removeParticipant`・`changeDueDate`。判定の関数（`decideParticipantGate`・`decideAdd`・`decideRemove`・`decideDueDateGate`・`decideDueDate`）で、最初の判定と、前提が崩れた後の読み直しを同じ順で行う。404・403 は`logger.audit`に残す |
| `backend/src/db/case.repository.ts` | `findWriteFacts`（判定の材料を1つの batch で読む）・`addParticipant`・`removeParticipant`・`changeDueDate`（1操作＝1回の`db.batch`）と`CaseStateChangedError`。概要の`canEditDueDate`と、詳細の参加者の`autoRole`・`removable`も、ここで決める |
| `backend/src/lib/audit-actions.ts` | 操作`case.participant.add`・`case.participant.remove`・`case.due_date.change`と、対象の種類`case`を足した |
| `docs/api/openapi.json` | 3つの API の契約と、概要の`canEditDueDate`・詳細の参加者の`autoRole`・`removable`（`backend/src/openapi.case-participants.test.ts`が照合する） |

フロントエンド：

| ファイル | 役割 |
| --- | --- |
| `frontend/src/features/cases/components/CaseParticipantManager.tsx` | 「参加者を管理」のダイアログ。社員の検索・追加、参加者の一覧（役割の名前・「削除」・本人の「退出する」）。確認の対象・完了の表示・エラーは、行の外（この部品）で持つ（取り直しで行が消えても、完了の表示が残る） |
| `components/CaseConfirmDialog.tsx` | 削除・退出の確認。送信中は確定もキャンセルも押せない |
| `components/CaseDueDateDialog.tsx` | 「納期を変更」のダイアログ（日付の入力・「未定に戻す」） |
| `hooks/useCaseWrites.ts` | `useAddCaseParticipant`・`useRemoveCaseParticipant`・`useChangeCaseDueDate`。成功しても失敗しても`caseKeys.all`を取り直す（失敗はほかの人の操作で状態が変わった場合があるため）。本人の退出に成功したときだけは、見えなくなった案件を取り直さず印だけを付ける |
| `components/CaseDetailView.tsx`・`CaseParticipantList.tsx`・`labels.ts`・`api/case-api.ts` | 「参加者を管理」「納期を変更」の入口、役割の名前の表示、文言、3つの API の呼び出し |
| `frontend/src/pages/CaseDetailPage.tsx` | 利用者の ID と案件の ID を`key`にして、ページごと作り直す（ダイアログ・入力・完了の表示を、利用者や案件が替わったときに持ち越さない）。ID が確かめられる前は描画しない |
| `frontend/src/features/members/`（`api/user-search-api.ts`・`hooks/useUserSearch.ts`・`query-keys.ts`）、`frontend/src/lib/useSettledValue.ts` | 社員の検索の API 呼び出しとフック、入力が止まってから値を返すフック。**もとは`features/case-requests`にあったものを移した**（下の「共有の部品を移した理由」） |
| `frontend/src/features/audit-logs/action-labels.ts` | 3つの操作と、対象の種類「案件」の名前 |

### API と判定の順（変えない）

| 操作 | 判定の順 |
| --- | --- |
| 追加（EP-5-09）`POST /api/cases/:caseId/participants`、本文`{ userId }`（`strict`） | 案件がない（404「案件が見つかりません」）→ 操作者が有効な参加者でない（403「参加者だけが操作できます」。担当部署のオーナー・全体管理者でも、参加していなければ追加できない）→ `authorize(perm.case.participant.edit, company)`（403）→ 本文の形（422）→ 対象の社員がいない・無効（422、`fields.userId`。**どちらも同じ文**「追加できる社員を選んでください」。社員の有無・状態を明かさない）→ 終了中（409 `closed`）→ すでに参加者（409 `already_participant`）→ batch。201で`{ caseId, userId }` |
| 削除・退出（EP-5-10）`DELETE /api/cases/:caseId/participants/:userId`（`userId`が本人なら退出） | 404 → 403（参加者でない）→ `authorize(perm.case.participant.edit)` → 対象が参加者でない（404「参加者が見つかりません」）→ 409 `closed` → 対象が自動参加の人（409 `auto_participant`。本人の退出でも同じ）→ 外すと有効な参加者が0人（409 `last_active_participant`）→ batch。204 |
| 納期の変更 `PATCH /api/cases/:caseId/due-date`、本文`{ dueDate: "YYYY-MM-DD" または null }`（`strict`） | 404 → 編集できない（403。有効な参加者か管理の資格。参加していなくてよい）→ `authorize(perm.case.edit, company)`（403）→ 形・日本時間の今日より前（422、`fields.dueDate`。`shared/case-rules.ts`の`caseDueDateSchema`・`isDueDateBeforeToday`）→ 409 `closed` → 今と同じ値なら何も書かず 200（版・監査を変えない）→ batch。200で`{ caseId, dueDate }`。`null`は未定に戻す |

- 3つとも**再認証を求めない**（5-1 AC-3、C-122）。401・403`FORBIDDEN_ORIGIN`は`app.ts`の一括の処理
- 409の`reason`は`closed`・`already_participant`・`auto_participant`・`last_active_participant`。画面は、サーバーの文言をそのまま出す（文言の一覧は下の「画面」）
- 外された人・無効になった人に、終了などの案件の状態を漏らさない：403 を、案件の状態の判定より先に返す
- 概要・一覧の項目に`canEditDueDate`を足した。**進行中の案件で、有効な参加者か管理の資格のある人なら真**（終了した案件は偽）。表示の制御で、認可はサーバーが毎回行う。詳細の参加者の項目に`autoRole`（`global_admin`・`department_owner`・`null`）と`removable`（自動参加でなく、外しても有効な参加者が1人以上残る）を足した

### 判定と書き込みの条件の突き合わせ

3つの書き込みはどれも、1回の`db.batch`で、**先頭の前提の確認（#196 の方式）→ 監査 → 業務の文 →（削除だけ）末尾の不変条件**の順に行う。前提は`cases.version`を「そのままか NULL」にする UPDATE で、崩れていれば NOT NULL 違反で batch 全体を取り消し、`CaseStateChangedError`にする（未知の DB エラーは変えずに再送出する）。監査・業務の文にも同じ条件を付け、業務の文が0行なら`CaseStateChangedError`にする。

| 項目 | 追加 | 削除・退出 | 納期の変更 |
| --- | --- | --- | --- |
| 案件がある・進行中 | 同じ | 同じ | 同じ |
| 操作者が有効で資格がある | 有効な参加者（`activeChannelMember`） | 同じ | 有効な参加者、または管理の資格（`canManageSql`と同じ条件） |
| 対象 | 対象が有効で、参加の行がない | 対象に参加の行があり、自動参加の人でない（いまの割り当て） | なし |
| 読んだ値 | なし | なし | `cases.due_date`が判定で読んだ値のまま |
| 末尾の不変条件 | なし | 有効な参加者が1人以上 | なし |

- 「参加の行がある」だけでは、最初の判定の後に無効化された操作者を止められない（行を残す設計。C-142(1)）ので、操作者の有効性を前提に入れる
- 業務の文と同じ batch に、監査（`case.participant.add`・`case.participant.remove`・`case.due_date.change`）を入れる。条件が崩れたときは何も残らない（行・版・監査とも）
- Service は、`CaseStateChangedError`を受けたら、最初と同じ判定の関数で材料を**読み直す**。404・403・409・422 のどれかの理由に当たればそれを返す。どれにも当たらなければ、成功にせず`CaseStateChangedError`のまま投げる。納期の変更だけは、ほかの人が同じ値にしていたら 200（求めた結果になっている）
- 自動参加の人の判定は、最初の判定・詳細の読み取り（`autoRoleOf`）と、batch の前提（SQL）の2か所にある

### 同時の操作

| 組み合わせ | 結果 |
| --- | --- |
| 同じ人を同時に2回追加 | 片方が成り立ち、もう片方は前提が崩れる（読み直しで 409 `already_participant`）。行は1つ、監査も1件 |
| 最後の2人の一般の参加者を同時に削除（自動参加の人がいないデータ） | 後のほうは末尾の不変条件で取り消され、有効な参加者が1人残る（409 `last_active_participant`） |
| 削除と、対象のオーナー就任 | 削除の前提が崩れ、読み直しで 409 `auto_participant` |
| 追加と、対象の無効化 | 前提が崩れ、読み直しで 422 |
| 操作と、操作者自身が外される・無効になる | 前提が崩れ、読み直しで 403 |
| 操作と、案件の終了（#150。テストでは`status`を直接変える） | 409 `closed` |
| 納期の同時の変更 | 後のほうは読んだ値の前提が崩れ、読み直しで、値が同じなら 200、それ以外で理由がなければ`CaseStateChangedError` |
| 納期の変更と、操作者が管理の資格を失う | 前提が崩れ、何も書かない |

### 自動参加の人と、最後の有効な参加者（Q1・Q2）

- 担当部署の有効なオーナー・有効な全体管理者は、自動参加の人。参加者の一覧に役割の名前（「全体管理者」「担当部署のオーナー」）を出し、「削除」も本人の「退出する」も出さない。サーバーも 409 `auto_participant`で拒否する
- 担当部署から外れたオーナー（案件の担当部署を直接変えたデータ）・前のオーナーは、一般の参加者として外せる
- 自動参加の人も有効な参加者に数えるので、自動参加の人がいる案件では、一般の参加者の最後の1人も外せる。`last_active_participant`は、自動参加の人がいない案件の守り
- 外された人が詳細を取ると 403（147-A のとおり）。通知は出さない（下の「既知の差」）

### 監査

- 操作：`case.participant.add`（`detail`：`caseId`・`userId`）、`case.participant.remove`（`caseId`・`userId`・`self`＝本人の退出か）、`case.due_date.change`（`caseId`・`before`・`after`）。対象の種類は`case`、対象の ID は案件の ID。結果は成功。`detail`は入れ子にせず、氏名・本文を入れない
- 同じ値への変更・前提が崩れた操作は、監査を残さない
- 監査の一覧（[audit-logs.md](audit-logs.md)）は、対象の種類「案件」の名前を解決せず、種類の名前だけを出す

### 画面

| 場所 | 内容 |
| --- | --- |
| S-17「参加者を管理」 | 有効な参加者で、案件が進行中のときだけ出すボタン（非参加者には、管理の資格があっても出さない）。ダイアログは**ページの側（`CaseDetailView`）で開閉を持つ**（取り直しで一覧の行が消えても、ダイアログと完了の表示が残る） |
| 参加者の管理のダイアログ | 社員の検索（入力が止まって300ミリ秒後に検索。`features/members`の`useUserSearch`。すでに参加している人は候補から除く）と「（名前）を追加」。参加者の一覧の各行：表示名・部署・「作成者」・役割の名前・「退職者」。`removable`が真の行だけに「削除」（ボタン名に対象の表示名を含める）。本人の行は「退出する」（外せる人にだけ出す。自動参加の人・最後の有効な参加者には出さない）。削除・退出は確認のダイアログを経る |
| 結果の表示 | 成功は「参加者を更新しました」。422 は「社員の検索」の欄に、409・403 などは欄の外に出す。変更中は、追加・削除・退出のボタンを押せない |
| 退出の後 | 成功したら S-16（`/cases`）へ移る。見えなくなった案件は取り直さず、印だけを付ける（移った先で新しく取る）。それ以外の操作は、成功・失敗のどちらでも`caseKeys.all`を取り直す |
| S-17「納期を変更」 | ヘッダーの下のボタン。概要の`canEditDueDate`が真のときだけ出す（表示の制御）。日付の入力（下限は日本時間の今日）・「保存する」・「未定に戻す」・「キャンセル」。今日より前・空の日付は、送る前に欄のエラーにする。サーバーの 422 は欄に、それ以外は欄の外に出す。非参加の担当部署のオーナー・全体管理者は、概要の画面からこの操作だけができる（Q6） |

- 画面の文言：確認の見出し「参加者の削除」「案件からの退出」、確認のボタン「削除する」「退出する」。納期の欄のエラー「納期は今日以降の日付にしてください」「日付を選んでください（未定にするときは「未定に戻す」を押してください）」
- サーバーの文言（画面はそのまま出す）：409 `closed`「終了した案件は変更できません」、`already_participant`「この社員はすでに参加者です」、`auto_participant`「担当部署のオーナー・全体管理者は外せません」、`last_active_participant`「最後の参加者は外せません。先にほかの社員を追加してください」。403「参加者だけが操作できます」「納期を変更できるのは、参加者・担当部署のオーナー・全体管理者だけです」。404「案件が見つかりません」「参加者が見つかりません」。422「追加できる社員を選んでください」「入力内容を確かめてください」
- 利用者が替わったときは、`CaseDetailPage`が`key`で作り直すので、前の利用者のダイアログ・検索語・完了の表示が残らない

### 共有の部品を移した理由（循環の依存を避ける）

- 社員の検索（API 呼び出しと`useUserSearch`）は、もと`features/case-requests`にあった。参加者の追加でも使うので、`features/cases`が`features/case-requests`の`index.ts`から取ると、`case-requests`が既に`features/cases`（`caseKeys`）を参照しているため、循環の依存ができる
- そこで、社員の検索の API・フックを、社員の情報を持つ`features/members`（`api/user-search-api.ts`・`hooks/useUserSearch.ts`）に、入力が止まってから値を返す`useSettledValue`を、機能に属さない`frontend/src/lib/`に移した。`features/case-requests`は`features/members`の公開部分を使う（`case-request-api.ts`の`CandidateUser`は`SearchedUser`の別名）。`features/members/index.ts`が`useUserSearch`・`SearchedUser`を公開する
- 共有の部品は、持ち主の機能（API を持つ側）か、機能に属さない場所に置く。片方の機能の`index.ts`から公開しない

### テストの場所（147-B）

- 単体：`backend/src/lib/case-participant-rules.test.ts`（`autoRoleOf`・`canRemoveParticipant`の表）、`backend/src/lib/audit-actions.case-participants.test.ts`・`audit-actions.test.ts`（操作・対象の種類。対象の種類の完全一致の期待値にも`case`を足した）
- DB：`backend/src/db/case-participant.repository.db.test.ts`（追加・削除・納期の書き込みと監査、自動参加の人・前のオーナー・退職者の扱い、前提が崩れたとき何も残らないこと、同じ人の同時の追加・最後の2人の同時の退出・納期の同時の変更）、`backend/src/db/case.repository.db.test.ts`（概要の項目の`canEditDueDate`）
- 割り込み：`backend/src/services/case-participant.interleave.test.ts`（資格を確かめる読み取りの直後に状態が変わる順を固定する。納期の同時の変更で、ほかの人が同じ値なら 200）
- route・契約：`backend/src/routes/cases.participants.test.ts`（判定の順・存在の非開示・再認証を求めないこと）、`backend/src/routes/cases.test.ts`、`backend/src/openapi.case-participants.test.ts`。テスト部品は`backend/test/case-participant-fixtures.ts`
- フロントエンド：`frontend/src/pages/CaseParticipantManager.test.tsx`（役割の名前・「削除」「退出する」の出し分け・成功・422・409・403・二重送信の防止・退出の後の遷移）、`CaseDueDate.test.tsx`（`canEditDueDate`・過去日・未定に戻す・二重送信の防止）、`CaseParticipantSessionSwitch.test.tsx`（利用者の切り替え）。MSW は`frontend/src/test/case-handlers.tsx`
- E2E：`e2e/case-participants.spec.ts`（2件。参加者が社員を追加すると、追加された人が詳細を見られ、削除すると非公開の表示になる。担当部署のオーナーには役割の名前が出て「削除」が出ない／参加者が納期を設定すると、ヘッダーに出る）。シードは`e2e/seeds/case-participants.sql`、後始末は`e2e/seeds/case-participants-cleanup.sql`（[e2e.md](../testing/e2e.md)）

## 既知の差・未実施・未決定として記録するもの

| 項目 | 状態 |
| --- | --- |
| 進捗（5-1 AC-2。S-16・S-17 の進捗） | 出さない。#149 で足す（Q7） |
| 最終更新・未読（S-16 の列） | 出さない。#148 |
| 名前・番号での絞り込み（S-16・5-1 AC-19） | 作らない。方式が未決定（#155） |
| S-16 の「自分の申請」の状況 | 出さない。S-18 の「自分の申請」に置いたまま |
| 参加者の追加・削除・退出、納期の変更、参加者の管理（S-17 のダイアログ）、参加者の役割の名前の表示（Q8）、`canEditDueDate` | 147-B で実装済み（下の「147-B の設計」） |
| 参加者の追加・削除の通知（参加した・外された） | 出さない（計画に含めない。参加の通知は未決定）。追加・削除は監査だけに残る |
| 外された人の TODO の担当を「なし」に戻すこと（5-4 AC-6） | 147-B では扱わない。TODO ができる #149 で扱う |
| 監査の一覧での案件の名前の解決 | しない。対象の種類「案件」の名前だけを出す（[audit-logs.md](audit-logs.md)） |
| 追加の対象の社員がいない・無効のときの応答 | 422（`fields.userId`。ない・無効を同じ文にする）。`api-draft.md`の EP-5-09 の 404 の案は採らなかった（C-182(19)） |
| 参加者の追加・削除のレート制限 | 作らない（X-8 が未決定） |
| 参加の行を使うチャンネルの経路を「有効な参加者」に変えること | 147-C-1 で実装済み（147-C-2 の前提）。記録を残す変更は147-C-2 |
| 無効化で案件の参加の記録を残すこと・AC-15 の守り・オーナー交代による自動参加・既存の案件の補完 | 147-C-2。いまの無効化は、案件の参加の行も消す（C-142(1)と食い違う既存の挙動。147-C-2 で直す） |
| 一覧の「進行中・終了」以外の状態（アーカイブ） | #151 |
| 本番の D1 への適用 | migration がないため該当しない |
| API 仕様（`docs/api/openapi.json`）の ULID の`pattern` | 案件の経路だけ、実装の ULID の形と一致させた。ほかの経路を含む全体は Issue #289 |

## テストの場所

- DB（隔離した D1）：`backend/src/db/case.repository.db.test.ts`（`joined`の範囲・ページ送り・`status`・非参加の行の項目・参加者数・管理の資格〔全体管理者・担当部署のオーナー・他部署のオーナー・一般・無効の社員。観点は SQL の結果で確かめる〕・詳細の読み取りが`not_visible`・`not_found`を返すこと）、`backend/src/db/channel-member.sql.db.test.ts`（`activeChannelMember`：有効な参加者は真、無効な参加者・参加していない人は偽）
- route・Service：`backend/src/routes/cases.test.ts`（状態コード・判定の順・存在の非開示・「認証 → 操作者の無効化 → 取得」の順・退職者の残り方・自動参加が未適用の案件の管理者）、`backend/src/openapi.test.ts`（契約）。テスト部品は`backend/test/case-fixtures.ts`
- フロントエンド：`frontend/src/pages/CasesPage.test.tsx`・`CaseDetailPage.test.tsx`・`CaseRoutes.test.tsx`・`CaseSessionSwitch.test.tsx`（利用者を切り替えても前の利用者の案件が一瞬も出ないこと・ID が確かめられる前は要求を送らないこと）、`frontend/src/features/app-shell/navigation.case-requests.test.ts`（メニュー「案件」）、`frontend/src/features/notifications/notification-views.case-request.test.ts`（移動先）。MSW は`frontend/src/test/case-handlers.tsx`
- E2E：`e2e/cases.spec.ts`（参加者の流れと、非参加者が非公開の表示になる流れ）。シードは`e2e/seeds/cases.sql`、後始末は`e2e/seeds/cases-cleanup.sql`（[e2e.md](../testing/e2e.md)）。既存の`e2e/case-requests.spec.ts`・`case-approvals.spec.ts`は、入口が「案件」→「案件の作成を申請」に変わったため修正した

## 関係するIssue・ADR

- Issue #147：本Issue（4つの子に分ける。147-A が最初）。依存は#146（[case-requests.md](case-requests.md)）。参加の行を使う経路の変更は147-C-1、参加者・納期は147-B（実装済み）、無効化・異動・オーナー交代は147-C-2
- [ADR-0006](../adr/0006-id-cursor-unread.md)：IDとカーソル／[ADR-0012](../adr/0012-zero-trust-principle.md)：サーバー側で毎回認可する／[ADR-0020](../adr/0020-test-scope-mutation-e2e.md)・[ADR-0028](../adr/0028-lighter-process-and-narrowed-scope.md)：ミューテーション・E2Eの実行範囲
- 要件：5-1 AC-2（進捗を除く）・AC-4・AC-5・AC-12・AC-14・AC-17（表示）・AC-19（表示）・AC-21（管理の情報の表示）、S-16・S-17。147-B：5-1 AC-3・AC-7（外せない部分）・AC-11（終了中は不可）・AC-17（変更）・AC-21（納期の変更）、EP-5-09・EP-5-10。決定記録[C-182](../requirements/decision-register.md)
- 関連する設計：[case-requests.md](case-requests.md)、[app-shell.md](app-shell.md)、[notifications.md](notifications.md)、[channels.md](channels.md)
