# 案件の一覧・概要・詳細・参加者・納期と、無効化・オーナー交代との連携、案件のやり取り、案件の TODO、案件の終了・再開（Issue #147 の 147-A・147-B・147-C-1・147-C-2、Issue #148 の 148-A、Issue #149 の 149-A、Issue #150 の 150-A）

## 目的

社員が案件の一覧（S-16）を開き、参加している案件は説明・参加者まで見られ、参加していない案件は概要（件名・状態・取引先・担当部署・納期など）だけを見られるようにする。サイドバーの「案件」の見出しの下に、参加している進行中の案件を出す。案件の作成の承認（[case-requests.md](case-requests.md)）でできた案件への入口である。コードは書き写さず、ファイル名・関数名で指す。

Issue #147 は「影響大」で、4つの子に分けた（C-182）。この設計書は 147-A（読み取りだけ）と 147-B（参加者の追加・削除・退出と、納期の変更。書き込み）の範囲を書く（147-B は「147-B の設計」の節）。147-C-1 は経路の資格の変更、147-C-2 は無効化・再有効化・オーナー交代・既存の案件の補完で、それぞれ「147-C-1 が広げた経路」「147-C-2 の設計」の節に書く。

Issue #148（案件のやり取り）も「影響大」で、3つの子に分けた（C-184）。最初の子 148-A（案件の画面 S-17 に、案件専用チャンネルのやり取りを出す。既存のメッセージ・スレッド・添付・未読の経路に、案件の条件を足す）の設計は「148-A の設計」の節に書く。

Issue #149（案件の TODO）は「影響大」で、4つの子に分けた（149-A 追加・完了・取り消しと一覧・進捗、149-B 編集・削除、149-C 履歴・削除済みの一覧・復元、149-D 担当者が外れたときの処理）。最初の子 149-A の設計は「149-A の設計」の節に書く。

Issue #150（案件の終了・再開・再編集）も「影響大」で、3つの子に分けた（150-A：終了・再開〔参加者の選び直しなし〕・通知・監査・S-17 のボタン／150-B：再開時の参加者の選び直し〔5-1 AC-16〕／150-C：再編集〔EP-5-20〕）。最初の子 150-A の設計は「150-A の設計」の節に書く。決定は[C-189](../requirements/decision-register.md)。

## 範囲

| 区分 | 内容 |
| --- | --- |
| 147-Aで作ったもの | API3つ（EP-5-06 一覧・EP-5-07 概要・EP-5-08 詳細）／「有効な参加者」の共通の SQL の部品`activeChannelMember`／管理の資格（参加者数と`canManage`）を読み取りの SQL の中で決める仕組み／S-16（案件一覧）・S-17（詳細の骨格）／メニュー「案件」とサイドバーの「案件」の見出しの下の参加中の案件／承認の通知の移動先の変更（C-179(3)の約束）／自分の申請の案件番号のリンク／承認の後の案件のキャッシュの取り直し |
| 147-C-1で作ったもの | チャンネルの参加の行を資格に使う経路（書き込み6・読み取り7＋`findForManage`の`isMember`）を「有効な参加者」に変えた（実装では、書き込み6・読み取り6＋`findForManage`の`isMember`と、中身の読み取り〔メッセージ5・参加者2・メンションの候補1〕を`roomViewableBy`で判定する形に変えた）。APIも画面も追加しない（下の「147-C-1 が広げた経路」） |
| 147-Bで作ったもの | API3つ（EP-5-09 参加者の追加・EP-5-10 参加者の削除と本人の退出・納期の変更）／自動参加の人は外せないこと（役割の名前の表示を含む）と最後の有効な参加者の規則／監査操作3つと対象の種類`case`／S-17 の「参加者を管理」・退出・「納期を変更」（下の「147-B の設計」） |
| 147-C-2で作ったもの | 無効化で案件専用チャンネルの参加の行を残すこと／AC-15 の守り（409 `case_handover_required`）／再有効化・異動の確認（テストだけ）／オーナー交代・後任のある部署の作成による担当の案件への自動参加と監査の`caseJoinCount`／既存の案件を補う SQL（下の「147-C-2 の設計」）。migration・APIの追加はない（`docs/api/openapi.json`は 409 の説明文だけ） |
| 148-Aで作ったもの | S-17 の「やり取り」（案件専用チャンネルのメッセージ・スレッド・添付。進行中の案件だけ書き込める。終了した案件は閲覧・既読・ダウンロードだけ）／書き込みの SQL の条件`caseRoomOpen`／案件の権限（`perm.case.view`・`perm.case.post`）を確かめる経路／混ざる一覧（S-35・未読）の`includeCase`／添付のアップロードの保存の時点の資格（`insertPending`の条件つきの登録。部屋の種類によらない）／チャンネルの詳細の`caseId`と、`/channels/:id`から案件の画面への置き換え／返信できない理由`case_closed`（下の「148-A の設計」）。新しい API・migration はない |
| 149-Aで作ったもの | 案件の TODO。表`case_todos`・`case_todo_events`（migration 0029。後の子で使う列まで含めて作った）／API4つ（EP-5-13 一覧と進捗・EP-5-14 追加・EP-5-17 完了・EP-5-18 完了の取り消し）／概要・案件の一覧の`progress`（非参加者にも出る）／S-17 の TODO の区画（一覧・進捗・追加・完了・取り消し・終了中の読み取り専用）と 2 秒のポーリング／S-16 の行とヘッダーの進捗（下の「149-A の設計」） |
| 150-Aで作ったもの | API2つ（EP-5-11 終了・EP-5-12 再開。参加者は選び直さず、いまの参加者のまま）／通知の2種類（`case.closed`・`case.reopened`）／監査操作2つ（`case.close`・`case.reopen`）／案件の版（`cases.version`）の一致による競合の検知（409 `stale`）／宛先の一致の確認`recipientsUnchanged`を`channel-manage.sql.ts`から`channel-member.sql.ts`へ移したこと／S-17 の「案件を終了」「案件を再開」と確認のダイアログ（下の「150-A の設計」）。migration はない |
| 後の子 | 147：なし（#147 の4つの子は、すべて実装済み）。148：148-B（添付の公開範囲の選択・変更と、案件の添付の一覧。migration を伴う）、148-C（S-16 の最終更新・未読の列と、サイドバーの案件の未読の印）。149：149-B（TODO の編集・削除）、149-C（履歴・削除済みの一覧・復元）、149-D（担当者が外れたときの処理）。150：150-B（再開時の参加者の選び直しと確認の表示。5-1 AC-16）、150-C（再編集。EP-5-20。件名・説明・取引先・担当部署） |
| 他の Issue に回すもの | 添付の一覧・最終更新・未読（#148 の148-B・148-C）、TODO の編集・削除・履歴・復元・担当者が外れたときの処理（#149 の149-B・C・D）、再開時の参加者の選び直し・再編集（#150 の150-B・150-C）、アーカイブ・物理削除（#151）、名前・番号での絞り込みと検索（#155）、全体管理者の任命・引き継ぎによる自動参加（#157） |
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
- 147-C-1 では、無効化はまだ参加の行を消していた。147-C-1 は、記録を残す前に、資格の判定を記録から切り離すための変更で（次の節）、記録を残す変更は 147-C-2 で実装した（「147-C-2 の設計」）。検索（#155）もこの部品を使う

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
| 付随の情報の読み取り（#297） | `message-mentions.sql.ts`（`loadMessageMentions`）、`message-reactions.sql.ts`（`loadMessageReactions`）、`attachment.repository.ts`（`loadMessageAttachments`） | メッセージ5経路とスレッドの一覧の後段。`messageViewableBy`を条件に入れ、閲覧者を必須の引数にした |
| 未読の数（#297） | `unread-counts.sql.ts`、`thread-unread-counts.sql.ts` | 部屋・スレッドの未読を数える文。資格を失った部屋・スレッドは 0（部屋は戻りから除く。スレッドは 0 の行） |
| スレッドの一覧の DM（#297） | `thread-list.sql.ts`（`directVisible`） | 閲覧者が有効であることを条件に足した |
| 規則の寄せ直し | `attachment-visibility.sql.ts`の`attachmentVisible`、`notification.repository.ts`の`viewableRoom` | `roomViewableBy`を使う形に寄せた |

- チャンネルの詳細は、資格の確認の後に、参加者数の読み取りが 0 を返したら（その間に資格を失った）、名前・説明を返さずに 404 にする（`backend/src/services/channel.service.ts`）
- DM の「当事者に無効な社員がいれば読めない」は、既存の規則（読めなくするのは送信だけ）のまま変えていない
- 経路の数：計画は「書き込み6・読み取り7」だったが、実装で変えたのは、書き込み6・読み取り6＋`findForManage`の`isMember`と、中身の読み取り（メッセージ5・参加者2・メンションの候補1）。招待の相手の判定（`findInvitee`）は変えていない
- テストの場所：`backend/src/db/channel-member.active-writes.db.test.ts`（書き込み6経路。参加の行を残したまま操作者を無効にすると何も残らない）、`backend/src/db/channel-member.active-reads.db.test.ts`（読み取りの各経路）、`backend/src/services/channel-member.active-race.test.ts`（認証の後・取得の前に無効化が確定する競合）。#297 の分：`backend/src/db/room-visibility.related-reads.db.test.ts`（DB の層。付随の3つと未読の2つ、スレッドの一覧の DM の条件）、`backend/src/services/room-visibility.related-reads.interleave.test.ts`（文の間に割り込む層。DB を包み、k 回目の文の直後に資格を失わせる。各回の前に初期のデータに戻し、割り込めたことを確かめる）、共通のデータは`backend/test/related-reads-fixtures.ts`

## 設計の方針：中身を読む SQL の条件に、その時点の資格を入れる

- 資格（有効な参加者・管理の資格）を先に確かめてから、別の読み取りで中身（説明・参加者・参加者数）を読む書き方はしない。確かめた後、読むまでの間に無効化・交代が確定した処理中の要求に、中身が返ってしまうため（コードレビュー1回目の重大2件。C-182）
- 詳細（`findDetailExtras`）：案件の行（説明・チャンネルの ID・作成者）と参加者の一覧を、**1つの`db.batch`で読み**、どちらの文にも「操作者が有効な参加者である」条件（`activeChannelMember`）を入れる。案件の行の側は、資格の判定結果（`visible`）と一緒に読み、資格がなければ中身を捨てて`not_visible`を返す。参加者の一覧の側は、条件を満たさなければ0行になる。案件がなければ`not_found`。Service は、`not_found`を 404、`not_visible`を 403 に分ける
- 参加者数・`canManage`：`list`・`findSummary`が、操作者の ID だけを受け取り、行を読む SQL の中で決める（`participantCount`は、同じ文の中で、有効な参加者か管理の資格のある行にだけ数える）
- 後の子（147-C-1・147-B）も同じ方針にする：書き込みは前提を batch の先頭の条件にし、読み取りは中身を読む SQL に資格を入れる。資格を確かめる読み取りと、中身の読み取りが別の文になっている既存の経路にも、同じ方針を通した（147-C-1。`roomViewableBy`）。**後の変更で、部屋の中身を読む SQL を足すときは、`roomViewableBy`を条件に入れる。**Service の事前の判定は、エラーの分類（403・404）のためのもので、最後の砦ではない
- **付随の情報と未読の数にも通した（Issue #297。C-186）**：本文を読んだ後に、別の文でメンション・リアクション・添付と、部屋・スレッドの未読の数を読む経路では、その間に資格を失うと、失った後の情報が返りえた。「絞った後の ID だけを読む」文でも、その行のいまの内容を読むなら、資格の条件が要る。直し方は、後段の文の WHERE（未読は `CASE WHEN`）に、`room-visibility.sql.ts`の`messageViewableBy(messageId, viewerId)`（メッセージの部屋を、閲覧者がいま見てよいか。`roomViewableBy`を使う）を入れること。1つの`db.batch`には、まとめない（文の数と、既存の読み取りの形を変えないため）。メンション・リアクション・添付の読み取り3つの閲覧者の引数は必須で、付け忘れは型で止まる（`loadMessageReactions`の`null`も許さない）。未読は行を消さず 0 にする：部屋の未読は 0 の部屋が戻りから除かれるので一覧から消え、スレッドの未読は 0 の行になる。文の数は変えていない
- 区別：資格を持ったままの部屋で、2本の文の間に返信・投稿が付く・既読になって未読の数が一時的にずれるのは、これまでどおり許容する（次の取得で直る）。資格を失った部屋は 0 になる
- スレッドの一覧（S-35）の DM の条件に、閲覧者が有効であること（`users`を主キーで1行）を足した（`thread-list.sql.ts`の`directVisible`。利用者の決定。C-182(18) との食い違いの解消）
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
| S-17 案件詳細（骨格。`/cases/:caseId`） | `pages/CaseDetailPage.tsx`、`CaseDetailView.tsx`・`CaseHeader.tsx`・`CaseParticipantList.tsx` | まず概要を取り、`isParticipant`のときだけ詳細を取る。参加者には、ヘッダー（件名・案件番号・状態・取引先・担当部署・納期・参加者数）・説明・参加者の一覧（表示名・部署名・「作成者」・退職者は「退職者」）。非参加者には概要の項目と「参加者だけが見られます（非公開）」だけを出し、説明・参加者を出さない（AC-14）。詳細が 403（外された）のときも同じ表示にする。存在しない案件は「案件が見つかりません」。TODO・添付の一覧の項目は置かない（動かない仮の項目を置かない。#148 の148-B・#149）。やり取りは 148-A で足した（下の「148-A の設計」の「画面」） |
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
| 操作と、案件の終了（#150。150-A で実装。以前のテストは`status`を直接変えていた） | 409 `closed` |
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

## 147-C-2 の設計（無効化・再有効化・異動・オーナー交代・既存の案件の補完）

決定は[C-182](../requirements/decision-register.md)（Q1・Q3・Q4・Q5と、147-C-2 の統括の決定）。API・画面・migration は足していない。コードは書き写さず、ファイル名・関数名で指す。

### ファイルと役割（147-C-2 で変えたもの）

| ファイル | 役割 |
| --- | --- |
| `backend/src/db/account.repository.ts` | `deactivate`：チャンネルの参加の削除から、案件専用チャンネル（`channels.purpose = 'case'`）を除いた。`soleActiveCaseParticipantSql`：AC-15 の条件の SQL の部品。`findAccountState`の`isSoleActiveCaseParticipant`と、`deactivate`の batch の先頭の前提（`NOT`）の両方が使う |
| `backend/src/services/account.service.ts` | `decideDeactivation`に`case_handover_required`の判定を足した（文言と 409 の`reason`） |
| `backend/src/db/department.repository.ts` | `caseJoinStatements`：新しいオーナー（と元部署の後任）を、その部署が担当部署の案件に入れる文。`caseJoinCountSql`・`auditWithCaseJoinCount`：入る行の数を数えて監査の`detail`の`caseJoinCount`に入れる。`changeOwner`と、後任のある`create`が使う |
| `backend/db/scripts/backfill-case-auto-participants.sql` | 既存の案件に自動参加の人を補う、べき等な SQL（運用の手順。migration ではない） |

### 無効化（AC-15。Q1）

- 案件専用チャンネルの参加の行は残す（進行中・終了とも。参加した時刻も変えない）。ほかのチャンネル（全社連絡・部署・個別）の行は、これまでどおり消す。DM には触れない
- 行が残っても、無効な人は「有効な参加者」ではない（147-C-1）。案件の中身を読めず、書き込めず、参加者数の「有効な」側には数えない。退職者として、参加者の一覧には残る（C-142(1)）
- AC-15：対象が、進行中の案件の唯一の有効な参加者なら、無効化を止める。409 `case_handover_required`、文言は「この社員が唯一の有効な参加者になっている進行中の案件があるため、無効化できません」。自動参加の全体管理者・オーナーも、有効なら「ほかの有効な参加者」に数える。終了した案件は対象にしない。引き継ぎの画面は作らない
- 判定の順：404 → 403 → 422（本人）→ 再認証 → 409 `already_inactive` → `global_admin` → `department_owner` → `case_handover_required`
- 同じ判定を、`deactivate`の batch の先頭の条件にも入れる（#196 の方式。`soleActiveCaseParticipantSql`を共用）。判定の後にほかの参加者が外された場合も、有効な参加者0人の進行中の案件が残らない。前提が崩れると batch 全体が取り消され、既存どおり読み直して分類する
- 監査`account.deactivate`の`detail`は変えない。画面（`DeactivateDialog`）は、409 の文言を応答から出す（専用の画面の変更はない）

### 再有効化・異動

- 再有効化（Q4）：コードは変えない。「チャンネルの参加を全部消してから初期チャンネルに入れる」ので、無効化で残った案件の参加の行も外れる。自動では復元しない。テストで固定した
- 異動（0-1 AC-19）：コードは変えない。異動の前後で案件の参加の行は同じで、旧部署の専用チャンネルからだけ外れる。テストで固定した

### オーナーの交代・後任のある部署の作成による自動参加（Q3。C-133(4)）

- 新しいオーナーを、その部署が担当部署の**すべての案件（進行中・終了とも）**の参加者に入れる。別部署の現オーナーを指名して元部署の後任がオーナーになる場合は、後任を元部署の案件に入れる（`department.create`でも同じ）。入れるのは、`cases`と`case_departments`から選ぶ`INSERT … SELECT`で、すでに参加している行は`NOT EXISTS`で除く（重複させない）。担当部署でない案件には入れない
- 前のオーナーの行は消さない（一般の参加者として残り、外せるようになる）。新しいオーナーが有効なことは、既存の事実の確認（`factAssertions`）が前提にしている
- 案件の側の監査・通知は出さない。個別の監査も増やさない
- 監査：`department.owner_change`の`detail`には常に`caseJoinCount`（新しく入った行の合計。0 でも）。`department.create`は、後任があるときだけ入れる（**後任のない部署の作成では、`detail`に`caseJoinCount`を入れない**。統括の決定）。件数は、同じ batch の`INSERT … SELECT`で数えて入れる（監査ログを書き換えない。[audit-logs.md](audit-logs.md)）
- **batch の中の文の順**：監査の文を、案件に入れる文より前に置く。件数は「入る前の不足」の数で、先に監査が数えないと、入れた後は不足が0になるため。順を入れ替えると件数が常に0になる
- 同時の操作：承認とオーナー交代が同時でも、どちらが先でも新しいオーナーが参加者になる（D1 は書き込みを直列に実行する）。交代と、その人の参加者の削除が同時のとき、交代が先なら削除は 409 `auto_participant`、削除が先なら交代で再び入る。案件の担当部署の変更は#150 の範囲

### 既存の案件の補完 SQL（Q5）

- `backend/db/scripts/backfill-case-auto-participants.sql`：有効な全体管理者を全案件に、各案件の担当部署の有効なオーナーをその案件に入れる。足りない行だけを足し、何回流しても同じ（参加済みの行と`joined_at`は変わらない）。案件専用チャンネル以外には触れない。方針は[project-rules.md](../project-rules.md)の「べき等な SQL を `backend/db/scripts/` に置く」に従う
- 実行手順：①入るべき行の数を数える`SELECT`を`wrangler d1 execute`で流す（適用前）、②本ファイルを`--file`で流す、③①と同じ`SELECT`を流して**0件**になったことを確かめる
- **まだ、どの環境にも実行していない**。ローカルの開発 DB を含め、実行は利用者の承認の後に行う。本番への実行は、機能の完了条件に含めず、別に利用者の承認を得る（運用の手順は[env-deploy](../../.claude/skills/env-deploy/SKILL.md)）

### テストの場所（147-C-2）

- DB：`backend/src/db/account.repository.case-participation.db.test.ts`（無効化の後も案件の行が残ること・ほかのチャンネルの行は消えること・無効な社員の名前での書き込みが何も残さないこと・AC-15 の batch 全体の取り消しと同時の操作・再有効化）、`backend/src/db/account.repository.transfer.case-participation.db.test.ts`（異動で案件の行が変わらないこと）、`backend/src/db/department.repository.case-auto-join.db.test.ts`（交代・後任の経路・重複しないこと・前のオーナーが残ること・`caseJoinCount`・承認との同時の操作）、`backend/src/db/backfill-case-auto-participants.db.test.ts`（補完 SQL を読み込んで、足りない行だけが入ること・2回流しても増えないこと・無効な社員が入らないこと）
- 既存のテストへの足し込み：`backend/src/db/department.repository.db.test.ts`（監査の`detail`に`caseJoinCount: 0`の期待を3件）、`backend/src/db/account.repository.lifecycle.db.test.ts`（`findAccountState`の`isSoleActiveCaseParticipant: false`の期待を1件）、`frontend/src/features/accounts/account-lifecycle.test.tsx`（409 `case_handover_required`の文言）
- Service・結合：`backend/src/services/account.case-handover.test.ts`（判定の順と`case_handover_required`）
- E2E：足さない（DB と結合の層で検出できるため）

### 設計の判断（知見）

- `findAccountState`は`isSoleActiveCaseParticipant`を常に真偽値で返す（統括の決定）。既存のテストが状態の完全一致を期待しているため、返り値の形を不自然にして合わせることはせず、期待に項目を足した（`department.repository.db.test.ts`の3件・`account.repository.lifecycle.db.test.ts`の1件）
- 補完 SQL のテストなど、新しいテストの置き場所も、層の依存の決まりに従う（DB の層のテストは`backend/src/db/`）

## 148-A の設計（案件のやり取り）

決定は[C-184](../requirements/decision-register.md)。要件は 5-2 AC-1〜AC-6・5-1 AC-11（AC-7〜AC-9 は148-B）。**新しい API も migration もない**。案件のやり取りは、案件専用チャンネル（`channels.purpose = 'case'`。非公開。有効な参加者だけが見える）の部屋に、既存のメッセージ・スレッド・添付・未読の経路（部屋の ID で呼ぶ API）をそのまま通す（5-2 AC-4）。差は次の4つだけ：①終了した案件には書き込めない、②案件の権限（`perm.case.view`・`perm.case.post`）を確かめる、③チャンネルの詳細が案件の ID を返し、画面が案件の画面へ移る、④添付の登録を保存の時点の資格で条件にする。コードは書き写さず、ファイル名・関数名で指す。

### ファイルと役割

バックエンド：

| ファイル | 役割 |
| --- | --- |
| `backend/src/db/case-room.sql.ts` | 新規。`caseRoomOpen(roomId)`：その部屋が案件専用チャンネルなら案件が進行中、案件でない部屋は常に真（`NOT EXISTS`）。書き込みの SQL の条件に入れる。`caseRoomListable(roomId, includeCase)`：混ざる一覧（スレッドの一覧・未読の対象）に案件の部屋を含めてよいか。`includeCase`が偽なら、案件の部屋だけを除く |
| `backend/src/db/message.repository.ts`（`insertIfOrdered`の`postable`）・`reply-insert.sql.ts`・`message-modify.sql.ts`（`modifiable`）・`message-reactions.sql.ts`（`reactable`） | 投稿・返信・編集・削除・リアクションの追加と取り消しの SQL の条件に`caseRoomOpen`を足した。最後の砦：Service の確認の後に案件が終了しても、終了した案件の部屋には行を書かない |
| `backend/src/db/attachment.repository.ts` | `insertPending`を条件つきの登録（`INSERT … SELECT … WHERE`。条件は内部の`pendingInsertable`）にし、登録した行数（1 か 0）を返す。`findVisible`が案件専用チャンネルの添付か（`isCase`）も返す |
| `backend/src/db/channel.repository.ts`（`findForViewer`） | `cases`を外部結合し、`caseId`・`caseStatus`（案件でなければ`null`）を返す。1文のまま |
| `backend/src/db/thread-list.sql.ts`・`thread.repository.ts`、`unread-targets.sql.ts`・`read-position.repository.ts` | 混ざる一覧。`includeCase`を**必須の引数**で受け取り、`caseRoomListable`で SQL の条件にする（取得の後に除くと、ページの件数とカーソルがずれるため。DM の`includeDirect`と同じ作り。付け忘れは型で止まる） |
| `backend/src/services/message.service.ts` | 案件の権限の判定（`authorizeCase`）と、終了中の 409（`requireCaseOpen`。文言は操作ごと〔C-184(5)〕、拒否は`logger.audit`に reason `case_closed`で残し本文は入れない）。`requirePostable`・`requireReplyable`は操作の種類（`RoomWriteKind`＝投稿・アップロード）を受け取り、添付の入口も同じ関数を通る。返信できない理由の`case_closed`は`roomReplyState`が決める |
| `backend/src/services/attachment.service.ts` | アップロードの前の部屋の判定（`requireRoom`）、登録が 0 行のときの後始末（R2 の保存物を消す）と読み直し、配信の`perm.case.view`（案件専用チャンネルの添付のとき） |
| `backend/src/services/channel.service.ts` | チャンネルの詳細で、案件専用チャンネルなら`perm.case.view`（403）。`isCaseChannel`を実値に、`caseId`を足した |
| `backend/src/services/thread.service.ts`・`unread.service.ts` | 表示の判定（`authorizer.can`。拒否を監査に溜めない）で`includeCase`を求めて Repository へ渡す。既読（部屋・スレッド）は`authorize`で`perm.case.view`（403） |
| `shared/message-rules.ts` | `REPLY_BLOCKED_REASONS.caseClosed`（`case_closed`）。並びが優先順を表す（定義元。OpenAPI の enum と、`backend/src/openapi.test.ts`が一致を確かめる） |
| `docs/api/openapi.json` | チャンネルの詳細の`caseId`（必須・`null`あり）、`isCaseChannel`の説明、`replyBlockedReason`の`case_closed`、書き込み系の 409 の説明に案件の終了を追記 |

フロントエンド：

| ファイル | 役割 |
| --- | --- |
| `frontend/src/features/cases/components/CaseConversation.tsx` | 新規。S-17 の「やり取り」。`features/threads`の`ThreadLayout`・`features/messages`の`RoomMessages`・`features/unread`の`useMarkRoomRead`を、各機能の`index.ts`経由で組み合わせる（`features/channels`には依存しない）。終了した案件では帯と投稿できない案内を出し、投稿・編集・リアクションの操作を出さない（閲覧と既読はできる）。投稿が 409 のとき、理由を出し続け、概要と詳細を取り直して読み取り専用に切り替える。添付つきの送信では、アップロードの 409（案件の終了）が添付の失敗（`cause`に元のエラー）として届くので、これも同じに扱う |
| `components/CaseDetailView.tsx`・`labels.ts` | 参加者の本文の、説明・参加者の下に`CaseConversation`を置く（縦に並べる。C-184(3)）。帯・案内・0件の文言は`labels.ts` |
| `frontend/src/features/channels/api/channel-api.ts`・`components/ChannelDetailView.tsx` | 詳細の応答の`caseId`を検証して受け取る。`caseId`があれば、チャンネルの見出し等を出さずに`/cases/:caseId`へ置き換えて移る（`?thread=`を引き継ぐ。案件の ID は応答の値で受け取り、`features/cases`を参照しない） |
| `frontend/src/features/messages/components/ThreadReplies.tsx` | 返信できない理由`case_closed`の案内文（C-184(6)） |

### 案件の権限を確かめる経路

案件の部屋かどうかは、`findForViewer`の`caseId`で決める（案件でない部屋・DM では何もしない）。非参加者は、権限の前に部屋が見えず 404 になる（案件の存在を明かさない）。

| 経路 | 権限 | 確かめる場所 |
| --- | --- | --- |
| メッセージの一覧・1件・返信の一覧・メンションの候補 | `perm.case.view` | `message.service.ts`（`requireVisible`・返信の取得・候補の取得） |
| 投稿・返信・編集・削除・リアクションの追加と取り消し・添付のアップロード | `perm.case.post` | `message.service.ts`（`requirePostable`・`requireReplyable`・編集削除・リアクション）。アップロードは`attachment.service.ts`が同じ関数を通る（C-184(7)でリアクションを含めた） |
| 既読（部屋・スレッド） | `perm.case.view` | `unread.service.ts`（`markRead`・`markThreadRead`） |
| 添付の配信 | `perm.case.view`（R-64） | `attachment.service.ts`の`download`（`findVisible`の`isCase`が真のとき） |
| スレッドの一覧（S-35） | `perm.case.view` | `thread.service.ts`が`can`で判定し、権限がなければ`thread-list.sql.ts`が SQL の側で案件の部屋を除く |
| チャンネルの詳細 | `perm.case.view` | `channel.service.ts`の`get`（拒否は 403） |
| 未読の数・対象 | `perm.case.view` | `unread.service.ts`が`can`で判定し、権限がなければ`unread-targets.sql.ts`が SQL の側で案件の部屋を除く |

現在の固定ロールは全員が両方の権限を持つので、実際の挙動は変わらない。権限だけを外した経路ごとの確認は Service の層で行う（C-184(8)）。

### 終了した案件への書き込み（5-1 AC-11）

- 進行中だけ書き込める：投稿・返信・編集・削除・リアクションの追加と取り消し・添付のアップロード。終了した案件は、閲覧・既読・添付のダウンロードだけ
- **判定の順**：既存の判定（404・403）の後、`perm.case.post`（403）→ 案件が終了中（409）→ 部署の判定など既存の続き。非参加者には、資格の確認の後でなければ 409 を返さないので、案件の状態は漏れない。返信・編集・削除・リアクションでは、既存の「削除済みの親・投稿は 409」の後に置く
- 409 の文言（C-184(5)）：投稿・返信「終了した案件には投稿できません」、編集・削除「終了した案件のメッセージは変更できません」、リアクション「終了した案件にはリアクションできません」、添付のアップロード「終了した案件には添付できません」
- **SQL が最後の砦**：書き込みの条件に`caseRoomOpen`を入れた（上の表）。Service の確認の後に案件が終了すると、書き込みは 0 行になり、既存の読み直し（最初と同じ順の判定）が 409 にする。どの理由にも当たらなければ、これまでどおり成功にしない（再試行・上限の後は 503）。「部署が有効」の条件が投稿の SQL にない既存の差は、案件専用チャンネルが部署を持たないため影響せず、変えていない
- 権限（`perm.case.post`）は DB の行ではなくロールの割り当てなので、SQL の条件には入れない（既存の権限と同じ）
- 返信できない理由（EP-1-07。`replyBlockedReason`）の優先は、削除された親 → 未参加 → `case_closed` → 部署が無効 → DM の相手が無効。スレッドの画面は`case_closed`で入力欄を出さず「終了した案件のため、返信できません」を出す
- 終了した案件の実際の状態：終了・再開の操作は #150 で作るため、いまの終了した案件は、テストのデータ・シードにしか存在しない【150-A で終了・再開の操作を実装した。本物の終了で、ここに書いた守りが効き、再開で解けることを結合のテストで確かめている。下の「150-A の設計」】

### 添付のアップロード：保存の時点の資格

- 計画レビュー1回目の指摘への対応。アップロードの事前の確認（Service）を通った後、ファイルの受信中に案件が終了したり、操作者が参加から外れたり無効になったりしても、未投稿の添付の行を残さない。**事前の確認ではなく、保存の時点（登録の SQL）で条件にする**
- `attachment.repository.ts`の`insertPending`は、次の条件を満たすときだけ 1 行を登録する（部屋の種類によらない 1 つの条件。通常のチャンネル・DM も同じ）：チャンネルは未アーカイブで、アップロードした人が有効な参加者、案件専用チャンネルなら案件が進行中。部屋への添付なら、お知らせ専用で部署のあるチャンネルは、その部署のオーナーか全体管理者だけ（投稿と同じ。`channel-member.sql.ts`の`announcementPostable`）。DM は当事者で、当事者に無効な社員がいない。返信への添付なら、親が同じ部屋のトップレベルの投稿で、削除されていないこと、部屋の部署が有効なこと（部署なしは有効。返信と同じ）
- **最初の判定（Service）が見る、DB の行で決まる条件と、保存の時点の条件を一致させる**（コードレビュー1回目の重大への対応）：部屋の存在と可視・未アーカイブ・閲覧者が有効・参加中・案件が進行中・DM の相手が有効・お知らせ専用の投稿の資格・返信の親（存在・同じ部屋・トップレベル・未削除）・返信先の部署の有効性。ロールで決まる権限（`perm.*`）は DB の行にないので、最初の判定だけで確かめる
- 0 行のとき、`attachment.service.ts`は保存した実体を消し、事前の確認と同じ順で部屋の判定を読み直して 404／403／409 にする。どれにも当たらなければ成功にせず 409（「状態が変わったため、添付できませんでした。読み込み直してからお試しください」。統括の決定。C-184(10)）にする
- 結び付け（投稿・返信と同じ batch）の条件は変えていない。残った未投稿の行は、既存の掃除の処理が消す

### 画面（S-17）

- 参加者の S-17 に、説明 → 参加者 → やり取りの順で、見出し「やり取り」を縦に並べる（C-184(3)。タブは作らない）。非参加者・詳細が 403 の人には、やり取りの領域を出さず、要求も送らない
- 0 件は「まだやり取りがありません」。終了した案件は、帯「終了した案件・アーカイブ（読み取り専用）」と案内「終了した案件のため、投稿・編集・リアクションはできません（読み取り専用）」を出し、入力欄・編集・リアクションの操作を出さない
- スレッドは`?thread=<親ID>`（S-07。既存）。案件・利用者が替われば、ページごと作り直す（`CaseDetailPage`の`key`）。メッセージ・返信・スレッドのキャッシュは、#284（C-187）の枠で利用者が替わったときに捨てる
- `/channels/:id`で案件専用チャンネルを開くと、案件の画面へ置き換えて移る（通知・スレッドの一覧・未読のリンクなど、`/channels/<部屋>`を作るどの入口からでも案件の画面で開く）。`message.mentioned`の通知は S-35 のまま（C-184(2)）
- サイドバーの「案件」の項目は変えない（未読の印は 148-C）

### 同時の操作

- 資格を確かめる読み取りの直後に案件が終了：投稿・返信・編集・削除・リアクションの 5 経路で、書き込みが 0 行になり 409。行が残らない・変わらない
- 資格の確認の直後に参加から外れる：既存の 147-C-1 の条件が案件の部屋でも効く（投稿 1 件で固定）
- 添付の受信中に案件の終了・参加の解除・無効化：部屋への添付・返信への添付の両方で、行が残らず、R2 の実体が消え、案件の部屋は終了で 409・参加の解除と無効化で 404。通常のチャンネル（アーカイブ 404・参加の解除 403）と DM（相手の無効化 409）でも、同じ形で行が残らない

### テストの場所（148-A）

- DB：`backend/src/db/case-room.db.test.ts`（`caseRoomOpen`の真偽、書き込み 5 経路の 0 行／1 行、通常のチャンネル・DM の退行なし、相関の確認〔#294。ほかの部屋の参加者・ほかの案件の状態で結果が変わらない〕）、`backend/src/db/attachment.repository.pending.db.test.ts`（添付の条件つきの登録）、`backend/src/db/channel.repository.case-channel.db.test.ts`（`findForViewer`の`caseId`・`caseStatus`）
- Service：`backend/src/services/message.case-room.test.ts`（判定の順・0 行の読み直し）、`message.case-room.interleave.test.ts`（資格の確認の直後に案件が終了する割り込み）、`attachment.upload-race.test.ts`（受信中の状態変化）、`case-room.permissions.test.ts`（案件の権限だけを外した経路ごとの確認。C-184(8)）
- 結合：`backend/src/routes/messages.case-room.test.ts`（参加者の流れ・終了中の 409・存在の非開示）、`attachments.case-room.test.ts`（終了中のダウンロードは 200 を含む。C-184(9)）、`channels.case-channel.test.ts`（詳細の`caseId`）、契約は`backend/src/openapi.test.ts`・`backend/src/lib/reply-blocked-reasons.test.ts`。テスト部品は`backend/test/case-room-fixtures.ts`
- 画面：`frontend/src/pages/CaseDetailPage.conversation.test.tsx`（やり取りの表示・終了中の読み取り専用・409 の切り替え・利用者の切り替え）、`frontend/src/pages/ChannelDetailPage.case-redirect.test.tsx`（`/channels/:id`から案件の画面への置き換え）、`frontend/src/features/threads/threads.pane.test.tsx`（`case_closed`の案内）
- E2E：`e2e/cases-conversation.spec.ts`（4 件。投稿・添付・返信・リアクション・終了した案件の読み取り専用・非参加者。[e2e.md](../testing/e2e.md)）
- 既存のテスト・見本に期待を足したもの：チャンネルの詳細の応答に必須の`caseId`、返信できない理由の`case_closed`、混ざる一覧の`includeCase`の引数（一覧は PR に書く）

## 149-A の設計（案件の TODO：一覧・進捗・追加・完了・完了の取り消し）

決定は[C-188](../requirements/decision-register.md)。要件は 5-4 AC-1〜AC-5、AC-6（選べるのは有効な参加者だけ、の部分）、AC-7（追加・完了・取り消しと進捗）、AC-9（追加・完了・取り消し）、AC-11（記録を残す。見せるのは 149-C）、1-9 AC-2、5-1 AC-2 の進捗。コードは書き写さず、ファイル名・関数名で指す。

### 表（migration 0029）

- `case_todos`（TODO 1件1行）と`case_todo_events`（TODO の変更の記録。書き換えない・消さない。監査ログとは別の業務のデータ）。定義は`backend/db/schema.ts`の`caseTodos`・`caseTodoEvents`、SQL は`backend/db/migrations/0029_add_case_todos.sql`。**後の子（編集・削除・履歴・復元・担当者が外れたとき）で使う列まで含めて作った**。既存の表は変えておらず、破壊的な変更はない
- `case_todos`：題名・現在の担当（`assignee_id`）・担当した時点の人と表示名（`recorded_assignee_*`。現在の担当が外れても残す）・完了した時の担当と表示名（`completed_assignee_*`）・完了か（`is_done`）・版（`version`）・作成者・日時・論理削除（`deleted_at`・`deleted_by`）。CHECK は、完了の値、現在の担当は「担当した時点の人」と同じ、担当した時点の人と名前が対、完了した時の担当と名前が対（かつ未完了では持たない）、削除の日時と削除者が対。索引は`(case_id, id)`
- `case_todo_events`：`kind`は`create`・`title_change`・`assignee_change`・`complete`・`uncomplete`・`delete`・`restore`・`auto_unassign`（CHECK）。題名・担当（ID と表示名）の変更前後の列を持つ。索引は`(todo_id, id)`。149-A が書くのは`create`・`complete`・`uncomplete`・`auto_unassign`
- 削除は論理削除（5-4 AC-12・AC-13 が削除後の閲覧と復元を求めるため）。**migration 0029 は本番に未適用**（適用は利用者の承認の後）

### ファイルと役割

| 区分 | ファイル | 役割 |
| --- | --- | --- |
| 共有 | `shared/case-todo-rules.ts` | 題名の規則の定義元（`caseTodoTitleSchema`・`CASE_TODO_TITLE_MAX_LENGTH`＝100）。整形は件名と同じ（`formatCaseTitle`）。上限は C-90 の定めで、件名とは変更理由が別のため別の定数。バックエンドの検証と画面の入力チェックが参照する |
| バックエンド | `backend/src/routes/case-todos.ts` | Controller。`GET`・`POST /api/cases/:caseId/todos`、`POST …/:todoId/complete`・`uncomplete`。入力の形の確認（ID は ULID の形、`limit`・`cursor`）と応答だけ。追加の本文は JSON として読めることだけを確かめ、形は Service が 403 までの判定の後に確かめる。`backend/src/index.ts`で`/api/cases`に`caseRoutes`とは別に登録 |
| バックエンド | `backend/src/services/case-todo.service.ts` | Service。判定の順・存在の非開示・ID の作り直し（`writeWithRetry`）。TODO の操作は監査ログに残さない（TODO の記録の表に残す）。404・403 の拒否だけ`logger.audit` |
| バックエンド | `backend/src/db/case-todo.repository.ts` | Repository。`listTodos`・`findTodoWriteFacts`（判定の材料を 1 つの batch で読む）・`addTodo`・`completeTodo`・`uncompleteTodo`・最大 ID の取得（`maxTodoId`・`maxEventId`）。`case.repository.ts`から`activeCaseWith`・`assertStatement`・`runWriteBatch`・`K_ROOM`を公開して使う |
| バックエンド | `backend/src/db/case.repository.ts` | 概要・一覧の`progress`（`todoTotal`・`todoDone`の副問い合わせ。外側の案件の ID は表の名前つきで渡す〔C-185〕）。削除済みを除き、0 件は`null` |
| 契約 | `docs/api/openapi.json` | 4 つの API と`progress`（`backend/src/openapi.case-todos.test.ts`・`openapi.test.ts`が実装と照合） |
| フロントエンド | `features/cases/api/case-todo-api.ts`・`hooks/useCaseTodos.ts`・`hooks/useCaseTodoWrites.ts` | `apiClient`で 4 つの API を呼び、Zod で検証する。一覧は無限スクロール式の取得で 2 秒ごとに取り直す。書き込みは成功・失敗とも`caseKeys.all`を取り直す。キーは`caseKeys.todos`（利用者の ID と案件の ID を含む） |
| フロントエンド | `components/CaseTodoSection.tsx`・`CaseTodoItem.tsx`・`CaseTodoAddForm.tsx`・`CaseTodoProgress.tsx` | S-17 の TODO の区画（見出し・進捗・追加・一覧・「さらに表示」・4 つの状態）。進捗の表示は`CaseTodoProgress`を S-16 の行・S-17 のヘッダー・区画で共用 |
| フロントエンド | `frontend/src/components/ProgressBar.tsx` | 共通の進捗バー。素の`progress`要素を包む。`className`・`style`は受け取らない |
| フロントエンド | `components/CaseDetailView.tsx`・`CaseHeader.tsx`・`CaseSummaryFacts.tsx`・`CaseList.tsx`・`labels.ts` | 区画の配置と取得、進捗の出どころの切り替え、一覧の行の進捗、文言 |

### API と判定の順

| API | 判定の順 |
| --- | --- |
| 一覧（EP-5-13） | 認証 → クエリの形（422）→ 案件がない（404）→ **有効な参加者でない**（403「参加者だけが見られます（非公開）」）→ `perm.case.view` → 読み取り（資格を SQL に入れる。1 つの batch で案件・項目・進捗を読み、資格がなければ中身を捨てて 403） |
| 追加（EP-5-14） | 404 → 403（「参加者だけが操作できます」）→ `perm.case.todo.edit` → 本文の形・題名（422）→ 担当者が有効な参加者でない（422。いない・無効・非参加で同じ文）→ 終了中（409 `closed`）→ batch |
| 完了・取り消し（EP-5-17・18） | 404 → 403 → `perm.case.todo.edit` → TODO がない・ほかの案件の TODO（404）→ 削除済み（409 `todo_deleted`）→ 終了中（409 `closed`）→ すでにその状態なら**何も書かずに 200**（決定）→ batch |

- **非参加者**（全体管理者・担当部署のオーナーを含む。R-76）には、TODO の有無・本文の誤り・案件の状態を区別させない。TODO の ID の有無は、403 の後にしか判定しない。案件の存在は概要で公開されているので、404 と 403 の違いで漏れるのは存在だけ
- 中身（題名・担当）は、有効な参加者だけが読める。**進捗（件数）は概要・案件の一覧に出て、非参加者にも見える**（5-1 AC-2・R-78）
- 一覧は、追加した順（ID の昇順）で固定し、1 回 100 件（決定）。応答は`items`（`id`・`title`・`completed`・`version`・`assignee`・`previousAssignee`・`completedAssignee`）・`nextCursor`・`progress`
- 担当の名前の出し分け：有効な人は現在の表示名、無効な人は担当した時点に保存した名前（画面は「（退職者）」を付ける）。現在の担当がなく、担当した時点の人が残っているときは`previousAssignee`に入れ、画面は「担当なし（以前の担当：{名前}）」と出す。以前の担当も、現在の担当・完了した時の担当と同じ出し分けで、無効な人なら「{名前}（退職者）」と出す
- 書き込みの応答：追加は 201 で項目と`progress`、完了・取り消しは`id`・`completed`・`version`・`progress`。再認証は求めない
- 完了の取り消しのとき、担当者がいまも有効な参加者かを確かめ、違えば現在の担当を NULL にして、記録`auto_unassign`を先に残す（外れた担当は、記録の`assignee_id`・`assignee_name`に入れる）。担当した時点の人と名前は表に残す

### 書き込みの batch と件数の確認

- 1 回の操作は 1 回の`db.batch`。先頭で前提（案件が進行中・操作者が有効な参加者・対象の TODO の状態・担当者が有効な参加者）を、`cases.version`を「そのままか NULL」にする UPDATE で確かめる（`assertStatement`。#196 の方式）。崩れていれば NOT NULL 違反で batch 全体が取り消され、`CaseStateChangedError`になる。業務の文・記録の文にも同じ条件を付けている
- **条件つきの INSERT・UPDATE は、条件が偽で 0 行でも SQL のエラーにならない**。必須の行を書く文の直後に、`changes()`が期待どおりかを確かめる文（`guardChanges`）を置き、合わなければ同じく batch 全体を取り消す。これで「TODO だけ残って記録がない」などの中途半端な成功を作らない
- 追加の順：前提 → TODO の挿入 → 確認 → 記録`create` → 確認 → 項目と進捗の読み取り。完了の順：前提 → 記録`complete` → 確認 → TODO の更新 → 確認 → 進捗（記録を先にするのは、「未完了」の条件が更新の後には偽になるため）。取り消しの順：前提 → 記録`auto_unassign`（担当者が外れているときだけ）→ 確認 → 記録`uncomplete` → 確認 → TODO の更新 → 確認 → 進捗
- 取り消された後は、Service が最初と同じ判定で読み直す：理由（404・409・422）に当たればそれを返し、すでに求める状態なら 200 にする。どれにも当たらなければ、次の ID の順の逆転とみなす

### ID の確定の順（追加した順として ID を使うため）

- 一覧の順と`cursor`は ID の昇順に頼るので、**ID の順を追加の順として使うには、確定の順の保証が要る**。書く文に、同じ案件の TODO（記録は同じ TODO の記録）に、渡した ID 以上がすでにあれば書かない条件を付けた
- 条件で書けなかったとき（時計の逆転・同時の追加）は、Service が確定済みの最大の ID（`maxTodoId`・`maxEventId`）より大きい ID を作り直して、batch 全体をやり直す（`ulidAfter`）。上限（`MAX_ID_RETRIES`＝3 回）を超えたら 503（成功にしない。API 仕様の追加・完了・取り消しに 503 を書いてある）。取り消しの記録は 2 件になりうるので、ID を 2 つ昇順で用意する

### 進捗

- 完了数÷全体の数。削除済みを数えない。0 件は`null`で、画面は「項目なし」（「0/0」「0%」は出さない）。表示は「{done}/{total}」と進捗バー
- 概要・案件の一覧の`progress`は、`case.repository.ts`の読み取りの SQL の副問い合わせ（N+1 にしない）。非参加者にも返す（数だけ）
- 参加者の S-17 のヘッダーの進捗は、概要ではなく**TODO の一覧の取得の結果**から出す（`CaseDetailView.tsx`の`headerProgressOf`）。区画と同じ取得なので、2 秒ごとに両方が一致する。取れていないときは出さない。非参加者は概要の値

### 画面（S-17）

- 参加者の本文を、説明 → 参加者 → **TODO** → やり取りの順で、見出しつきの区画として縦に並べる（タブにしない。147 Q7・C-184(3)）
- 区画：見出し「TODO」、進捗、追加の欄（題名「題名」・担当者「担当者」〔選べるのは有効な参加者だけ。選ばなければ「担当なし」〕・「追加する」）、一覧。追加に成功すると「TODOを追加しました」。完了の操作は「{題名}を完了にする」、取り消しは「{題名}を未完了に戻す」
- 4 つの状態：読み込み中、失敗（「TODOを読み込めませんでした」と「再試行」）、0 件（「項目なし」）、あり。「さらに表示」のあとの 2 秒ごとの取り直しは、**取得済みの全ページを取り直す**（完了・題名・担当の変化を反映するため）
- 完了・取り消しの送信中は、全部の行のボタンを無効にする（応答の順と結果の表示を 1 つに保つ）。先の操作の失敗の表示は、後の操作を始めても消さず、区画の状態で持つ（`useCaseTodoWrites.ts`が失敗を区画に渡す）
- 終了した案件は「閲覧のみ」を示し、追加・完了・取り消しを出さない（表示の制御。認可はサーバー）
- 取得が 401・403・404 になったら取り直しを止める。403（外された）のときの概要・詳細の取り直しと非公開の表示への切り替えは、#308 で`useCaseAccessLoss`に一本化した（この区画では取り直さない。下の「資格を失ったときの画面の切り替え（#308）」）。退出に成功したら、その案件の TODO のキャッシュを残さない。利用者が替わったら、前の利用者のキャッシュを出さない（#284・C-187 の枠）

### 同時の操作

- 資格の確認の直後に参加から外れる・案件が終了する・TODO が完了済みになる・担当者が外れる：前提の確認で batch 全体が取り消され、行が残らない・変わらない。読み直しで、理由（403・409）か、すでにその状態（200）になる
- 同じ TODO の二重の完了：割り込んだ相手の分だけが書かれ、記録`complete`は 1 件（後の操作は読み直して、すでに完了なので何も書かない）
- ID の順が逆転する書き込み（同じ案件への同時の追加など）：ID の順の保証の条件で 0 行になり、ID を作り直してやり直す

### テストの場所（149-A）

- DB：`backend/src/db/case-todos.schema.db.test.ts`（表の制約）、`backend/src/db/case-todo.repository.db.test.ts`（一覧・進捗・追加・完了・取り消しの条件、件数の確認、ID の順）、`backend/src/db/case.repository.db.test.ts`（概要・一覧の`progress`）
- Service・route：`backend/src/services/case-todo.service.db.test.ts`、`case-todo.interleave.test.ts`（確認の直後に状態が変わる割り込み）、`backend/src/routes/case-todos.test.ts`（状態コード・判定の順・存在の非開示）、`backend/src/lib/case-todo-rules.test.ts`（題名の規則）、契約は`backend/src/openapi.case-todos.test.ts`・`openapi.test.ts`。テスト部品は`backend/test/case-todo-fixtures.ts`
- 画面：`frontend/src/pages/CaseTodos.test.tsx`（区画の表示・追加・完了・取り消し・エラー・終了中）、`CaseTodos.polling.test.tsx`（2 秒の取り直し・全ページの取り直し・止める条件）、`CaseTodos.session-switch.test.tsx`（利用者の切り替え）、`CasesPage.test.tsx`（行の進捗）、`CaseParticipantManager.test.tsx`（退出の後のキャッシュ）。MSW は`frontend/src/test/case-todo-handlers.ts`
- E2E：`e2e/case-todos.spec.ts`（3 件。追加 → 別の参加者の画面に 3 秒以内に出る、完了 → 進捗が再読み込みなしで変わる、非参加者には TODO が出ず進捗だけ出る。[e2e.md](../testing/e2e.md)）

### 設計の判断（知見）

- **番人のテストが自前の一覧を持つと、本物との食い違いに気づけない**：API 仕様の照合のテスト（`backend/src/openapi.test.ts`）は、`index.ts`とは別に、ルートを組み込む一覧を自前で持っている。149-A では、新しいルートをその一覧に足した（`index.ts`と同じ順で）が、足し忘れても本物との食い違いに気づけない。この仕組み自体の見直しは別の Issue
- **条件つきの INSERT が 0 行でも、SQL のエラーにはならない**：必須の行の直後に件数を確かめ、batch 全体を取り消す
- **ID の順を追加の順として使うには、確定の順の保証が要る**：条件つきの挿入と、ID の作り直しで保証する
- **テストの道具（user-event）は、入力する文字列の`[`をキーの指定として読む**：`[E2E_TEST]`・`[UNIT_TEST]`のようなタグつきのデータを入力するテストでは、`[`をエスケープする

## 150-A の設計（案件の終了・再開）

決定は[C-189](../requirements/decision-register.md)。要件は 5-1 AC-8・AC-9・AC-10（直接再開）・AC-11（終了の操作）・AC-13（終了・再開の監査と通知。再選定の結果は 150-B）、3-3 AC-1〜AC-3（再選定なしの宛先）、C-142(2)。**migration はない**（終了の日時の列は足さない。「いつ」は監査ログの記録の日時が満たす）。再開は**いまの参加者のまま**進行中に戻す（利用者の決定。参加者の選び直しは 150-B）。コードは書き写さず、ファイル名・関数名で指す。

### ファイルと役割

バックエンド：

| ファイル | 役割 |
| --- | --- |
| `backend/src/routes/cases.ts` | `POST /:caseId/close`・`POST /:caseId/reopen`。パスの形（ULID）の確認と応答だけ。本文は持たない（送られても読まない）。全応答に`noStore` |
| `backend/src/services/case.service.ts` | `close`・`reopen`（共通の内部関数`changeStatus`）。判定の関数`decideClose`・`decideReopen`で、最初の判定と読み直しを同じ順で行う。`CaseConflictReason`に`already_closed`・`already_active`・`stale`・`retry`を足した。`retry`の文言は、チャンネルの管理の既存の定数（`channel-manage.service.ts`の`RETRY_CONFLICT_MESSAGE`）を export して使う（2か所に同じ文を書かない） |
| `backend/src/db/case.repository.ts` | `closeCase`・`reopenCase`（内部の`changeStatus`。1回の`db.batch`）、通知の宛先を読む`listCaseNotifyRecipients`（案件のチャンネルの有効な参加者から操作者を除く）。`findWriteFacts`が`version`も返す |
| `backend/src/db/channel-member.sql.ts` | `recipientsUnchanged`（宛先＝有効な参加者で操作者以外が、読んだ集合と同じであること）を、`channel-manage.sql.ts`から**移した**。アーカイブ・復元と、案件の終了・再開の両方がこれを使う（規則を2か所に書かない）。条件は変えていない。部屋は値でも SQL の式でも渡せる |
| `backend/src/db/channel-manage.sql.ts` | `recipientsUnchanged`の定義をやめ、`channel-member.sql.ts`から使う形にした |
| `shared/notification-kinds.ts` | `case.closed`・`case.reopened`（どちらも`containsRoomContent: false`） |
| `backend/src/lib/audit-actions.ts` | 操作`case.close`・`case.reopen`を足した（対象の種類`case`は 147-B で足した） |
| `docs/api/openapi.json` | 2つの API の契約。409 の`reason`の列挙（`already_closed`・`already_active`・`stale`・`retry`）、監査の操作・通知の種類の列挙。409 の説明は既存の書き方（説明の文）に合わせた（`backend/src/openapi.case-close.test.ts`が定義元との一致を確かめる） |

フロントエンド：

| ファイル | 役割 |
| --- | --- |
| `frontend/src/features/cases/api/case-api.ts` | `closeCase`・`reopenCase`（応答を Zod で検証） |
| `frontend/src/features/cases/hooks/useCaseWrites.ts` | `useCaseStatusChange`（終了・再開を1つのフックにまとめた）。成功しても失敗しても、案件（`caseKeys.all`）・その案件の部屋のメッセージ・開いているスレッドの返信を取り直す（下の「画面」） |
| `frontend/src/features/cases/components/CaseDetailView.tsx`・`labels.ts` | ボタン・確認のダイアログ（既存の`CaseConfirmDialog`）・結果の表示。文言は`labels.ts`の`CASE_STATUS_CHANGE_TEXTS` |
| `frontend/src/features/messages/index.ts` | `messageKeys`を公開した（案件の側が、部屋のメッセージのキャッシュを取り直すため。各機能の`index.ts`経由で使う決まり） |
| `frontend/src/features/notifications/notification-views.ts` | 2種類の文言と移動先 |
| `frontend/src/features/audit-logs/action-labels.ts` | 「案件の終了」「案件の再開」 |

### API と判定の順

| 操作 | 判定の順 |
| --- | --- |
| 終了（EP-5-11）`POST /api/cases/:caseId/close` | 認証・送信元（`app.ts`）→ パスの形（422）→ 案件がない（404「案件が見つかりません」。`logger.audit`）→ **有効な参加者でない**（403「参加者だけが操作できます」。`logger.audit`）→ `authorize(perm.case.close, company)`（403）→ すでに終了（409 `already_closed`「この案件はすでに終了しています」）→ batch。200で`{ caseId, status: "closed" }` |
| 再開（EP-5-12）`POST /api/cases/:caseId/reopen` | 同じ順。状態は、すでに進行中なら 409 `already_active`「この案件はすでに進行中です」。200で`{ caseId, status: "active" }` |

- 147-B の操作と同じく**再認証を求めない**（C-81）。`closedAt`・`reopenedAt`は返さない（記録の有無が未決定。#37）
- 非参加の判定を状態の判定より先に置く：外された人・無効になった人・参加していない管理者に、終了か進行中かを漏らさない。全体管理者・オーナーでも、参加の行がなければ 403（R-77）
- `retry`・`stale`の 409 は、下の「書き込みと前提」で返す
- 参加の判定の関数（`decideParticipantGate`）は 147-B のものをそのまま使い、状態の判定だけを足した。最初の判定と、前提が崩れた後の読み直しで、同じ関数を使う

### 書き込みと前提（1回の`db.batch`。#196 の方式）

文の順は **前提の確認 → 監査 → 通知 → 案件の行の更新（版 +1）**。前提の条件は1つの SQL にまとめ、前提の確認・監査・通知・更新のすべてに同じものを渡す。

| 項目 | 内容 |
| --- | --- |
| 案件・状態 | 案件があり、状態が操作の前（終了なら進行中、再開なら終了中） |
| 版 | `cases.version`が、最初の判定で読んだ値のまま |
| 操作者 | 有効な参加者（`activeChannelMember`） |
| 宛先 | 有効な参加者で操作者以外が、読んだ集合のまま（`recipientsUnchanged`） |
| 監査 | `case.close`・`case.reopen`。対象の種類`case`、対象の ID は案件。`detail`は平坦で`caseId`・`notifiedCount`（宛先の数）だけ。氏名・本文を入れない。前提が崩れたら残らない |
| 通知 | `case.closed`・`case.reopened`。宛先は**有効な参加者から操作した本人を除く**全員（自動参加の全体管理者・オーナーを含む。無効な参加者・非参加の管理者には送らない）。部屋・メッセージは NULL、対象（`target_id`）は案件。宛先の ID と通知の ID の組を JSON の値1つで渡す`INSERT … SELECT … FROM json_each`なので、人数に比例して値の数が増えない（D1 の1文の上限。120人の案件で DB のテストが確かめる）。宛先が0人なら通知の文を入れない |
| 更新 | 状態と更新日時を書き、版に1を足す。0行なら`CaseStateChangedError` |
| 触れないもの | チャンネル（`channels.deleted_at`）・参加の行・`channel_archive_events`（5-1 AC-8。案件の終了はチャンネルのアーカイブとは別の操作で、アーカイブの記録を作らない） |

- 通知の種類を`containsRoomContent: false`にした理由：案件の概要は全員に見えるので、参加から外された後も「終了した・再開された」事実を一覧に残してよい。部屋の内容は含まない（アーカイブ・復元の通知と同じ扱い）。本文に件名などを入れず、固定の文言にする
- Service の流れ：判定の材料（版を含む）を読む → 404・403 → 権限 → 状態の 409 → 宛先を読む → 書く。`CaseStateChangedError`なら材料を**読み直して**同じ判定を行い、404・403・409 のどれかに当たればそれを返す。**版だけが変わっていれば**、やり直さず 409 `stale`（「ほかの人が先にこの案件を変更しました。画面を確かめてから、もう一度操作してください」）。どれにも当たらなければ、宛先が変わったとみて宛先を読み直し、**1回だけ**やり直す。それでも崩れたら 409 `retry`（成功にしない）。やり直しでも、最初に読んだ版を使い続ける（新しい版に差し替えない）
- 画面は版を送らない。版は、1つの要求の中で「判定の読み取り → batch」の間の変化を見るためのもの。画面に出した後に誰かが終了・再開した場合は、状態の 409 で足りる

### 状態が戻る競合と、版を進める操作（計画レビュー1回目の重大への対応）

「A・B が進行中を読む → B が終了 → 別の要求が再開 → A の終了の batch」のように、状態が一度変わって元に戻ると、状態・参加者・宛先の前提だけでは古い要求を止められない。そこで`cases.version`の一致を前提に入れた。版が2つ進んでいるので A の batch の前提が崩れ、読み直しでは状態が進行中のまま版だけが違う → 409 `stale`。案件は進行中のまま、A の分の通知・監査は残らない（再開側も同じ）。

| 操作 | 版 | 終了・再開の前提での扱い |
| --- | --- | --- |
| 終了・再開 | 進める | 版の一致で検出 |
| 納期の変更（147-B） | 進める | 版の一致で検出（終了の直前に納期が変わっていれば 409 `stale`） |
| 再編集（150-C） | 進める（予定） | 同上 |
| 参加者の追加・削除・退出（147-B）、無効化・再有効化、オーナー交代による自動参加 | 進めない | 宛先の一致（`recipientsUnchanged`）で検出。変わったら宛先を読み直して1回だけやり直す |
| 投稿・返信・リアクション（148-A） | 進めない | 関係しない（宛先・状態を変えない） |

### 終了・再開と既存の守りの関係

- 終了の後：参加者の追加・削除・退出・納期の変更は 409 `closed`（147-B の`activeCaseWith`）。投稿・返信・編集・削除・リアクション・添付は 409 `case_closed`（148-A の`caseRoomOpen`）。閲覧・既読・添付の取得はできる。再開で解ける。どちらも`status`だけを見ているので、コードの変更は要らず、結合のテスト（`cases.close-effects.test.ts`）で確かめた
- AC-15（147-C-2）：`soleActiveCaseParticipantSql`は進行中の案件だけを数える。終了すると、無効化を止めていた案件が対象から外れ（終了案件は引き継ぎ不要）、再開すると再び対象になる。再開した本人は有効な参加者なので、再開の直後に有効な参加者0人の進行中の案件はできない
- 概要の`canEditDueDate`は進行中だけ真（既存）。一覧（S-16）の「進行中／終了した案件」は`status`で絞るので、終了で一覧の側が移る。サイドバーは参加中の進行中だけ（既存）なので、終了で消え、再開で戻る

### 画面（S-17）

| 場所 | 内容 |
| --- | --- |
| ボタン | ヘッダーの下（「納期を変更」と並べる）に、**有効な参加者（概要の`isParticipant`）だけ**に出す：進行中なら「案件を終了」、終了中なら「案件を再開」。非参加の管理者には出さない（R-77）。表示の制御で、認可はサーバー |
| 確認のダイアログ | 既存の`CaseConfirmDialog`。終了：見出し「案件の終了」、本文「終了すると、メッセージ・参加者・納期は読み取り専用になります。参加者は、いつでも再開できます。」、確定「終了する」。再開：見出し「案件の再開」、本文「再開すると、いまの参加者のまま進行中に戻ります。」、確定「再開する」。送信中は確定もキャンセルも押せない（二重送信しない）。開閉は`CaseDetailView`（ページの側）で持つ |
| 結果の表示 | 成功は「案件を終了しました」「案件を再開しました」、失敗（403・404・409）はサーバーの文言。**ダイアログの外**に出す（取り直しでボタンが入れ替わっても残る） |
| 409 のとき | ダイアログを閉じる（状態が変わっているので、同じ確認を出し続けない）。送った後は結果によらず閉じ、案件を取り直して、いまの状態のボタンに替わる |
| 取り直し | `useCaseStatusChange`が、成功・失敗とも、案件（`caseKeys.all`）、その案件の部屋のメッセージ（`messageKeys.room`）、開いているスレッドの返信（前方一致のキー`["messages", "thread"]`。スレッドのキーは親メッセージごとで部屋を含まないため、表示中のものをまとめて取り直す）を取り直す。スレッドを開いたまま終了・再開しても、ポーリングを待たずに返信の入力欄・編集・リアクションの可否が切り替わる |

- 利用者・案件が替わったときは、`CaseDetailPage`の`key`で作り直すので、ダイアログ・結果の表示を持ち越さない（#284 の枠）
- 通知（S-14）の文言は「参加している案件が終了しました」「参加している案件が再開されました」。移動先は S-17（`/cases/:id`。`targetId`がなければ移動先なし）。件名を入れない（通知の応答に件名がない）。案件の終了は「アーカイブ」と呼ばないので、`channel.archived`の「（アーカイブされました）」の扱いは変えていない（[notifications.md](notifications.md)）
- 監査ログの一覧（[audit-logs.md](audit-logs.md)）の操作名は「案件の終了」「案件の再開」

### 同時の操作

| 組み合わせ | 結果 |
| --- | --- |
| 同じ案件の同時の終了（再開） | 片方だけ成り立つ。後のほうは前提が崩れ、読み直しで 409 `already_closed`（`already_active`）。通知・監査は1回分 |
| 状態が戻る競合（上の節） | 409 `stale`。通知・監査は別の要求の分だけ |
| 終了と、参加者の追加・無効化など宛先を変える操作 | 宛先の一致が崩れ、宛先を読み直して1回だけやり直す（追加された人にも通知が届き、無効になった人には届かない）。2回続けて変われば 409 `retry` |
| 終了と、操作者自身が外される・無効になる | 前提が崩れ、読み直しで 403（状態を漏らさない） |
| 終了と、投稿・参加者の変更（148-A・147-B） | 終了が先なら 409 `case_closed`／`closed`。投稿が先ならメッセージは残り、終了後は読み取り専用で見える |
| 終了と、AC-15 の無効化 | 無効化が先なら 409 `case_handover_required`。終了が先なら無効化できる（D1 は書き込みを直列に実行する） |
| 再開と、再開した本人の無効化 | 無効化が先なら再開は 403。再開が先なら、本人が唯一の有効な参加者であれば無効化は 409 `case_handover_required` |

### テストの場所（150-A）

- 単体：`backend/src/services/case-close.decide.test.ts`（判定の関数の表）、`backend/src/lib/notification-kinds.case-close.test.ts`・`audit-actions.case-close.test.ts`（種類・操作の定義）
- DB：`backend/src/db/case-close.repository.db.test.ts`（終了・再開の書き込みと通知の宛先・監査・版、チャンネル・参加の行に触れないこと、前提が崩れたとき何も残らないこと、120人の案件、同時の終了・再開）、`backend/src/db/account.repository.case-participation.db.test.ts`（AC-15 が終了・再開で切り替わること。既存への追加）
- 割り込み：`backend/src/services/case-close.interleave.test.ts`（材料の読み取りの直後に状態・参加者・宛先が変わる順を固定する。状態が戻る競合の両方向、宛先の再試行、`retry`）
- 結合：`backend/src/routes/cases.close.test.ts`（判定の順・存在の非開示・再認証なし・200の形・`noStore`）、`cases.close-effects.test.ts`（本物の終了で既存の守りが効き、再開で解けること）、`notifications.case-close.test.ts`（通知の一覧・参加から外された後も残ること）、契約は`backend/src/openapi.case-close.test.ts`。テスト部品は`backend/test/case-close-fixtures.ts`
- フロントエンド：`frontend/src/pages/CaseCloseReopen.test.tsx`（ボタンの出し分け・ダイアログの文言・二重送信の防止・完了の表示・409／403の文言）、`CaseCloseThread.test.tsx`（スレッドを開いたままの切り替え）、`CaseCloseSessionSwitch.test.tsx`（利用者の切り替え）、`frontend/src/features/notifications/notification-views.case-close.test.ts`（文言と移動先）
- E2E：`e2e/case-close.spec.ts`（1件。参加者 A が終了 → B の通知から S-17 → B が再開 → A の通知。[e2e.md](../testing/e2e.md)）。シードは`e2e/seeds/case-close.sql`、後始末は`e2e/seeds/case-close-cleanup.sql`

### 設計の判断（知見）

- フックは終了・再開を`useCaseStatusChange`の1つにまとめた（取り直しの対象が同じため）
- `retry`の文言は既存の定数を使い、新しい文を作らない。送信元の 403 に`no-store`が付かないのは、全 API に共通の既存の動き（`app.ts`の一括の処理）で、この Issue では変えない
- 版の一致は、「状態の前提だけでは、状態が一度変わって戻る競合を止められない」ことから入れた（計画レビュー1回目で見つかった）

## 資格を失ったときの画面の切り替え（#308）

S-17 を開いたまま、ほかの参加者に外された人の画面が、開き直すまで、既に読み込んだ説明・参加者の一覧を出し続けていた（概要・詳細に自動の更新がなく、やり取りの自動の更新が拒否されても、詳細を取り直す経路がなかった。新しい中身は取得されない）。既存の参加者の削除（#147-B）からあった穴で、#150-B の計画レビューで見つかり、先に直した。決定は C-190。API・DB は変えない（フロントエンドだけ）。

### ファイルと役割

| ファイル | 役割 |
| --- | --- |
| `frontend/src/features/cases/hooks/useCaseAccessLoss.ts` | 新規。資格を失ったことの検出と判定を1か所に持つ部品。部屋のメッセージ（`messageKeys.room`）と TODO の取得のエラーを、クエリのキャッシュの購読で見る。`unverified`（確かめられない状態）と`retry`を返す |
| `frontend/src/features/cases/hooks/useCaseWrites.ts` | `forgetCaseContent`（中身〔詳細・TODO・部屋のメッセージ・スレッド〕の取り消しと取り除き）を足し、`forgetCaseAfterLeave`（概要を非参加に書き換えてから中身を取り除く）を、本人の退出と、この部品の両方から使う |
| `frontend/src/features/cases/components/CaseDetailView.tsx` | 部品を呼び、`isParticipantOf`で概要から参加者かを決める。確かめられないときは`UnverifiedAlert`（「案件の情報を確かめられませんでした」と「再試行」）を出し、中身を描かない。ダイアログは部品の`onLost`で閉じる |
| `frontend/src/features/cases/components/CaseTodoSection.tsx` | TODO が 403 のときに概要・詳細を取り直す処理（#149-A）を消した（部品に一本化） |
| `frontend/src/features/cases/labels.ts` | 確かめられない表示の文言 |

### 処理の流れ

1. 契機：部屋のメッセージと TODO の自動の更新が、403 または 404 で失敗する。401（セッション切れ。共通の処理）・5xx・通信の失敗では何もしない（既存の表示とポーリングの続き）
2. 403・404 は、参加者のままでも起こりうる（権限がない等）ので、それだけでは決めず、**概要を取り直した結果**で決める
3. 判定：
   - 概要が非参加、または 404：`forgetCaseAfterLeave`／`forgetCaseContent`で中身のキャッシュを取り除き、開いているダイアログを閉じ、非公開の表示にする
   - 概要が参加者のまま：何もしない（取り直さない。要求が増え続けないように）
   - 概要の取り直しが失敗：中身を隠して「再試行」を出す（安全な側に倒す）。部屋・TODO のポーリングは 403・404 で止まるので、「次のポーリングでまた検出する」は成り立たないため、利用者が押す再試行が次の契機になる
4. 重ねない印：同じ参加の期間の中で、確かめと後片付けを重ねない。印を外すのは、非参加から参加者に戻ったとき、再試行で参加者が返ったときだけ（詳細の取得の成功では外さない。参加者のままの 403 で循環するため）
5. 本人の退出の後片付けで既に非参加になっているときは、確かめ直さない（退出の既存の動きのまま）
6. 端末に保存した下書きは消さない。切り替わるまでの時間は、自動の更新の1回（2秒）と概要の取り直しの1往復

### テストの場所（#308）

- 画面：`frontend/src/pages/CaseAccessLoss.test.tsx`（403・404・通信の失敗・5xx、再試行、ダイアログ、キャッシュの取り除き）、`CaseAccessLoss.userSwitch.test.tsx`（利用者の切り替え）
- E2E：`e2e/case-access-loss.spec.ts`（1件。実ブラウザ2つで、外された人の画面が開き直さずに非公開の表示になる。[e2e.md](../testing/e2e.md)）

## 既知の差・未実施・未決定として記録するもの

| 項目 | 状態 |
| --- | --- |
| 表示中に、ロールの権限（`perm.case.view`）だけが外れた場合 | 既に読み込んだ説明・参加者は、次に開き直すまで残る（TODO・やり取りは欄ごとに 403 の表示）。権限の変更が、開いている画面にすぐ反映されないのは、ほかの画面と同じ既存の動き（ロール・権限を変えても、セッションは切れない）。#308 の範囲の外（C-190） |
| 進捗（5-1 AC-2。S-16・S-17 の進捗） | 149-A で実装済み（下の「149-A の設計」）。147-A の時点では出していなかった（Q7） |
| 最終更新・未読（S-16 の列）、サイドバーの案件の未読の印 | 出さない。#148 の148-C（C-184(1)）。148-A では作らない |
| 名前・番号での絞り込み（S-16・5-1 AC-19） | 作らない。方式が未決定（#155） |
| S-16 の「自分の申請」の状況 | 出さない。S-18 の「自分の申請」に置いたまま |
| 参加者の追加・削除・退出、納期の変更、参加者の管理（S-17 のダイアログ）、参加者の役割の名前の表示（Q8）、`canEditDueDate` | 147-B で実装済み（下の「147-B の設計」） |
| 参加者の追加・削除の通知（参加した・外された） | 出さない（計画に含めない。参加の通知は未決定）。追加・削除は監査だけに残る |
| 外された人の TODO の担当を「なし」に戻すこと（5-4 AC-6） | 147-B では扱わない。#149 の149-D で扱う。149-A の時点では、参加者の削除・退出・無効化で TODO の担当は書き換わらない（完了の取り消しのときだけ、担当者がいまも有効な参加者かを確かめる。下の「149-A の設計」） |
| 監査の一覧での案件の名前の解決 | しない。対象の種類「案件」の名前だけを出す（[audit-logs.md](audit-logs.md)） |
| 追加の対象の社員がいない・無効のときの応答 | 422（`fields.userId`。ない・無効を同じ文にする）。`api-draft.md`の EP-5-09 の 404 の案は採らなかった（C-182(19)） |
| 参加者の追加・削除のレート制限 | 作らない（X-8 が未決定） |
| 参加の行を使うチャンネルの経路を「有効な参加者」に変えること | 147-C-1 で実装済み（147-C-2 の前提） |
| 無効化で案件の参加の記録を残すこと・AC-15 の守り・オーナー交代による自動参加 | 147-C-2 で実装済み（解消。以前の無効化は案件の参加の行も消していて、C-142(1)と食い違っていた）。下の「147-C-2 の設計」 |
| 既存の案件への自動参加の補完 SQL（`backfill-case-auto-participants.sql`） | 作成済み・**どの環境にも未実行**。本番への実行は、利用者の承認が別に必要 |
| 異動・再有効化で案件の参加の行が変わらないこと／外れること | コードは変えず、テストで固定した（147-C-2） |
| 一覧の「進行中・終了」以外の状態（アーカイブ） | #151 |
| 本番の D1 への適用 | 147 の時点では migration がないため該当しない。149-A の migration 0029 は**本番に未適用**（適用は、利用者の承認の後） |
| API 仕様（`docs/api/openapi.json`）の ULID の`pattern` | 案件の経路だけ、実装の ULID の形と一致させた。ほかの経路を含む全体は Issue #289 |
| 案件のやり取り（S-17）、終了した案件の読み取り専用、案件の権限の確認 | 148-A で実装済み（下の「148-A の設計」） |
| 添付の公開範囲の選択・変更、案件の添付の一覧と元の投稿への移動 | 作らない。#148 の148-B（migration を伴う。C-184(4)） |
| 終了した案件の実際の状態 | 150-A で終了・再開の操作を実装した（解消。下の「150-A の設計」）。以前は、終了した案件はテストのデータ・シードにしか存在せず、書き込みの 409 は DB に直接`status`を書いて確かめていた |
| 審査中の公開申請・再開申請の自動取消・取り下げ（5-1 AC-10 の原文、C-142 の案） | 作らない。申請の仕組み（5-5・5-6）が未実装。#153（後回し）・5-5 の Issue で扱う |
| 再開時の参加者の選び直し（5-1 AC-16）と、確定前の確認の表示 | 150-A では作らない（いまの参加者のまま再開する。利用者の決定）。150-B。画面の確認の本文は「いまの参加者のまま進行中に戻ります」。再開の確定のボタンは、既存の部品のまま「危険な操作」の見た目になっている（150-B で確認の表示を置き換えるときに見直す） |
| 再編集（EP-5-20。件名・説明・取引先・担当部署）、5-1 AC-20 | 作らない。150-C。参加していない担当部署のオーナー・全体管理者は、概要の項目（件名・取引先・担当部署・納期）だけ編集でき、説明は参加者だけ。監査は件名を前後の値で、説明は変えたことだけ残す。類似の件名の警告は案件の申請（146-A）と同じ（利用者・統括の決定。[C-189](../requirements/decision-register.md)） |
| 案件の操作履歴の画面（C-140(3)） | 未定義。操作の履歴は監査ログだけで満たし、参加者向けの履歴の画面は作らない（利用者の決定） |
| 終了のときの未完了の TODO の扱い | 未定義。計画・要件に定めがない（TODO は #149。150-A は TODO に触れない。#150 と合わせて決める） |
| 終了・再開の日時の列 | 作らない（migration なし）。「いつ」は監査ログの記録の日時で分かる。記録の有無は未決定（#37） |
| 終了・再開のレート制限 | 作らない（X-8 が未決定。147-B と同じ） |
| 参加者0人の終了した案件の再開 | #153（再開申請）。150-A の直接再開は、有効な参加者が操作する |
| 自動参加の補完 SQL が未実行の既存の案件 | 全体管理者・オーナーに参加の行がないため、R-77 のとおり終了・再開できない（403）。補完の実行（利用者の承認が要る）の有無で、手元の DB での見え方が変わる |
| 審査中の一時閲覧・承認済み全社員公開アーカイブでの非参加者の閲覧（5-2 AC-3 の一部） | 作らない。5-5・5-6 の Issue |
| 進行中の操作（投稿・添付の送信など）の途中で利用者が替わったときの扱い | 148-A でも直していない。Issue #300 |
| 既に画面に出ている行の返信の件数・リアクションの、ほかの人の変更の反映 | 部屋のポーリング（`features/messages/hooks/message-polling.ts`の`catchUpMessages`）は最後の ID より後の新着だけを取り足し、既存の行は取り直さない。開き直すと出る（チャンネルと同じ既存の動き。`e2e/reactions.spec.ts`も開き直して確かめる）。リアルタイムの更新は #117 |
| 投稿（トップレベル）の SQL に「部署が有効」の条件がない既存の差 | 案件専用チャンネルは部署を持たないので影響しない。148-A では変えていない |
| TODO の編集・削除（149-B）、履歴・削除済みの一覧・復元（149-C）、担当者が外れたときの処理（149-D） | 149-A では作らない（表の列は先に作ってある）。149-D までは、参加者の削除・退出・無効化で TODO の担当は書き換わらない |
| 有効な担当者の名前のプロフィールへのリンク | 149-A では付けない（5-4 AC-6 の一部は後の子）。「以前の担当」の「（退職者）」の併記は 149-A で実装済み |
| ID の作り直しの上限（`MAX_ID_RETRIES`）の定数 | `case-todo.service.ts`と`message.service.ts`が同じ値を別に持っている（意味と変更理由が別のため統合していない） |
| 実行計画（EXPLAIN）の確認 | 品質チェックで行う |
| API 仕様の番人のテストの、ルートの一覧の件 | 別の Issue |

## テストの場所

- DB（隔離した D1）：`backend/src/db/case.repository.db.test.ts`（`joined`の範囲・ページ送り・`status`・非参加の行の項目・参加者数・管理の資格〔全体管理者・担当部署のオーナー・他部署のオーナー・一般・無効の社員。観点は SQL の結果で確かめる〕・詳細の読み取りが`not_visible`・`not_found`を返すこと）、`backend/src/db/channel-member.sql.db.test.ts`（`activeChannelMember`：有効な参加者は真、無効な参加者・参加していない人は偽）
- route・Service：`backend/src/routes/cases.test.ts`（状態コード・判定の順・存在の非開示・「認証 → 操作者の無効化 → 取得」の順・退職者の残り方・自動参加が未適用の案件の管理者）、`backend/src/openapi.test.ts`（契約）。テスト部品は`backend/test/case-fixtures.ts`
- フロントエンド：`frontend/src/pages/CasesPage.test.tsx`・`CaseDetailPage.test.tsx`・`CaseRoutes.test.tsx`・`CaseSessionSwitch.test.tsx`（利用者を切り替えても前の利用者の案件が一瞬も出ないこと・ID が確かめられる前は要求を送らないこと）、`frontend/src/features/app-shell/navigation.case-requests.test.ts`（メニュー「案件」）、`frontend/src/features/notifications/notification-views.case-request.test.ts`（移動先）。MSW は`frontend/src/test/case-handlers.tsx`
- E2E：`e2e/cases.spec.ts`（参加者の流れと、非参加者が非公開の表示になる流れ）。シードは`e2e/seeds/cases.sql`、後始末は`e2e/seeds/cases-cleanup.sql`（[e2e.md](../testing/e2e.md)）。既存の`e2e/case-requests.spec.ts`・`case-approvals.spec.ts`は、入口が「案件」→「案件の作成を申請」に変わったため修正した

## 関係するIssue・ADR

- Issue #147：本Issue（4つの子に分ける。147-A が最初）。依存は#146（[case-requests.md](case-requests.md)）。参加の行を使う経路の変更は147-C-1、参加者・納期は147-B（実装済み）、無効化・異動・オーナー交代は147-C-2
- [ADR-0006](../adr/0006-id-cursor-unread.md)：IDとカーソル／[ADR-0012](../adr/0012-zero-trust-principle.md)：サーバー側で毎回認可する／[ADR-0020](../adr/0020-test-scope-mutation-e2e.md)・[ADR-0028](../adr/0028-lighter-process-and-narrowed-scope.md)：ミューテーション・E2Eの実行範囲
- Issue #148：案件のやり取り（3つの子に分ける。148-A が最初。依存は #147・#284・#297・#294）。要件：5-2 AC-1〜AC-6（AC-3 は参加者の閲覧・取得の部分）・5-1 AC-11、R-62〜R-64、S-17・S-07・S-35。決定記録[C-184](../requirements/decision-register.md)。関連する設計：[messages.md](messages.md)・[threads.md](threads.md)・[attachments.md](attachments.md)・[unread.md](unread.md)・[channels.md](channels.md)
- Issue #149：案件の TODO（4つの子に分ける。149-A が最初。依存は #148）。要件：5-4 AC-1〜AC-5・AC-6（選べる人の部分）・AC-7・AC-9・AC-11（記録）、1-9 AC-2、5-1 AC-2 の進捗、R-76・R-78、S-16・S-17、EP-5-13・14・17・18。決定記録[C-188](../requirements/decision-register.md)。関連：[ADR-0020](../adr/0020-test-scope-mutation-e2e.md)・[ADR-0028](../adr/0028-lighter-process-and-narrowed-scope.md)
- 要件：5-1 AC-2（進捗を除く）・AC-4・AC-5・AC-12・AC-14・AC-17（表示）・AC-19（表示）・AC-21（管理の情報の表示）、S-16・S-17。147-B：5-1 AC-3・AC-7（外せない部分）・AC-11（終了中は不可）・AC-17（変更）・AC-21（納期の変更）、EP-5-09・EP-5-10。決定記録[C-182](../requirements/decision-register.md)
- Issue #150：案件の終了・再開・再編集（3つの子に分ける。150-A が最初。依存は #148 の148-A）。要件：5-1 AC-8〜AC-11・AC-13、3-3 AC-1〜AC-3、R-77、S-17、EP-5-11・EP-5-12。決定記録[C-189](../requirements/decision-register.md)
- 関連する設計：[case-requests.md](case-requests.md)、[app-shell.md](app-shell.md)、[notifications.md](notifications.md)、[channels.md](channels.md)、[audit-logs.md](audit-logs.md)
