# 案件の一覧・概要・詳細・参加者・納期と、無効化・オーナー交代との連携、案件のやり取り、案件の TODO、案件の終了・再開（Issue #147 の 147-A・147-B・147-C-1・147-C-2、Issue #148 の 148-A・148-B-1・148-C、Issue #149 の 149-A・149-B・149-C・149-D、Issue #150 の 150-A・150-B・150-C）

## 目的

社員が案件の一覧（S-16）を開き、参加している案件は説明・参加者まで見られ、参加していない案件は概要（件名・状態・取引先・担当部署・納期など）だけを見られるようにする。サイドバーの「案件」の見出しの下に、参加している進行中の案件を出す。案件の作成の承認（[case-requests.md](case-requests.md)）でできた案件への入口である。コードは書き写さず、ファイル名・関数名で指す。

Issue #147 は「影響大」で、4つの子に分けた（C-182）。この設計書は 147-A（読み取りだけ）と 147-B（参加者の追加・削除・退出と、納期の変更。書き込み）の範囲を書く（147-B は「147-B の設計」の節）。147-C-1 は経路の資格の変更、147-C-2 は無効化・再有効化・オーナー交代・既存の案件の補完で、それぞれ「147-C-1 が広げた経路」「147-C-2 の設計」の節に書く。

Issue #148（案件のやり取り）も「影響大」で、3つの子に分けた（C-184）。最初の子 148-A（案件の画面 S-17 に、案件専用チャンネルのやり取りを出す。既存のメッセージ・スレッド・添付・未読の経路に、案件の条件を足す）の設計は「148-A の設計」の節に書く。計画の段階で、148-B（添付の公開範囲と一覧）を 148-B-1（読み取りだけの添付の一覧。migration なし）と 148-B-2（公開範囲。migration あり）に分けた。148-B-1 の設計は「148-B-1 の設計」の節に書く（決定は[C-191](../requirements/decision-register.md)）。148-C（S-16 の「最終更新」「未読」と、サイドバーの案件の未読の印）は 148-B-1 の後、148-B-2 の前に別の PR で実装した。設計は「148-C の設計」の節に書く（決定は[C-191](../requirements/decision-register.md)(4)と[C-192](../requirements/decision-register.md)）。148-B-2（添付の公開範囲の選択・変更。migration あり）は 148-C の後に実装した。設計は「148-B-2 の設計」の節に書く（決定は[C-191](../requirements/decision-register.md)(1)〜(3)と[C-195](../requirements/decision-register.md)）。

Issue #149（案件の TODO）は「影響大」で、4つの子に分けた（149-A 追加・完了・取り消しと一覧・進捗、149-B 編集・削除、149-C 履歴・削除済みの一覧・復元、149-D 担当者が外れたときの処理）。最初の子 149-A の設計は「149-A の設計」の節に、149-B（編集・削除）の設計は「149-B の設計」の節に、149-D（担当者が外れたときの処理）の設計は「149-D の設計」の節に、149-C（履歴・削除済みの一覧・復元）の設計は「149-C の設計」の節に書く。149-C で、#149 の4つの子はすべて実装済みになった（決定は[C-198](../requirements/decision-register.md)）。

Issue #150（案件の終了・再開・再編集）も「影響大」で、3つの子に分けた（150-A：終了・再開〔参加者の選び直しなし〕・通知・監査・S-17 のボタン／150-B：再開時の参加者の選び直し〔5-1 AC-16〕／150-C：再編集〔EP-5-20〕）。最初の子 150-A の設計は「150-A の設計」の節に書く。決定は[C-189](../requirements/decision-register.md)。2つ目の子 150-B（再開のときの参加者の選び直し）の設計は「150-B の設計」の節に書く（決定は[C-194](../requirements/decision-register.md)）。3つ目の子 150-C（案件の内容の再編集）の設計は「150-C の設計」の節に書く（決定は[C-199](../requirements/decision-register.md)）。これで #150 の子はすべて実装済みである。

## 範囲

| 区分 | 内容 |
| --- | --- |
| 147-Aで作ったもの | API3つ（EP-5-06 一覧・EP-5-07 概要・EP-5-08 詳細）／「有効な参加者」の共通の SQL の部品`activeChannelMember`／管理の資格（参加者数と`canManage`）を読み取りの SQL の中で決める仕組み／S-16（案件一覧）・S-17（詳細の骨格）／メニュー「案件」とサイドバーの「案件」の見出しの下の参加中の案件／承認の通知の移動先の変更（C-179(3)の約束）／自分の申請の案件番号のリンク／承認の後の案件のキャッシュの取り直し |
| 147-C-1で作ったもの | チャンネルの参加の行を資格に使う経路（書き込み6・読み取り7＋`findForManage`の`isMember`）を「有効な参加者」に変えた（実装では、書き込み6・読み取り6＋`findForManage`の`isMember`と、中身の読み取り〔メッセージ5・参加者2・メンションの候補1〕を`roomViewableBy`で判定する形に変えた）。APIも画面も追加しない（下の「147-C-1 が広げた経路」） |
| 147-Bで作ったもの | API3つ（EP-5-09 参加者の追加・EP-5-10 参加者の削除と本人の退出・納期の変更）／自動参加の人は外せないこと（役割の名前の表示を含む）と最後の有効な参加者の規則／監査操作3つと対象の種類`case`／S-17 の「参加者を管理」・退出・「納期を変更」（下の「147-B の設計」） |
| 147-C-2で作ったもの | 無効化で案件専用チャンネルの参加の行を残すこと／AC-15 の守り（409 `case_handover_required`）／再有効化・異動の確認（テストだけ）／オーナー交代・後任のある部署の作成による担当の案件への自動参加と監査の`caseJoinCount`／既存の案件を補う SQL（下の「147-C-2 の設計」）。migration・APIの追加はない（`docs/api/openapi.json`は 409 の説明文だけ） |
| 148-Aで作ったもの | S-17 の「やり取り」（案件専用チャンネルのメッセージ・スレッド・添付。進行中の案件だけ書き込める。終了した案件は閲覧・既読・ダウンロードだけ）／書き込みの SQL の条件`caseRoomOpen`／案件の権限（`perm.case.view`・`perm.case.post`）を確かめる経路／混ざる一覧（S-35・未読）の`includeCase`／添付のアップロードの保存の時点の資格（`insertPending`の条件つきの登録。部屋の種類によらない）／チャンネルの詳細の`caseId`と、`/channels/:id`から案件の画面への置き換え／返信できない理由`case_closed`（下の「148-A の設計」）。新しい API・migration はない |
| 149-Aで作ったもの | 案件の TODO。表`case_todos`・`case_todo_events`（migration 0029。後の子で使う列まで含めて作った）／API4つ（EP-5-13 一覧と進捗・EP-5-14 追加・EP-5-17 完了・EP-5-18 完了の取り消し）／概要・案件の一覧の`progress`（非参加者にも出る）／S-17 の TODO の区画（一覧・進捗・追加・完了・取り消し・終了中の読み取り専用）と 2 秒のポーリング／S-16 の行とヘッダーの進捗（下の「149-A の設計」） |
| 149-Bで作ったもの | TODO の編集（EP-5-15 `PATCH`。題名・担当。版を送り、違えば 409 `todo_changed`）と削除（EP-5-16 `DELETE`。論理削除。版は送らない。204）／409 の理由`todo_changed`・`todo_completed`／記録の ID を記録の表の全体で新しい順にそろえる（149-A の完了・取り消しも同じ方式に直した）／S-17 の「編集」「削除」・編集のダイアログ・担当の名前からプロフィールカード（S-27）と DM を開く導線。migration はない（下の「149-B の設計」） |
| 149-Dで作ったもの | 担当者が案件から外れたら、外す操作と同じ batch で、未完了・未削除の TODO の担当を「なし」にし、記録`auto_unassign`を残し、版を進める（参加者の削除・本人の退出・無効化・再開の除外の4つの経路）／規則の定義元`backend/src/db/case-todo-unassign.sql.ts`（`eventIdsFreshSql`もここへ移した）／参加者の削除（本人の退出を含む）・無効化のやり直し（合計4回。超えたら 503。再開は 150-B のまま合計2回で 409 `retry`）／索引`case_todos_assignee_id_id_idx`（migration 0031。**本番に未適用**）。API・画面の追加はない（下の「149-D の設計」） |
| 149-Cで作ったもの | TODO の履歴（EP-5-24 `GET …/todos/:todoId/events`。古い順）・削除済みの一覧（EP-5-25 `GET …/deleted-todos`。追加した順）・復元（EP-5-26 `POST …/todos/:todoId/restore`。版は送らない）。履歴・削除済みの一覧は 100 件ずつのカーソル送りで、資格（有効な参加者）を読み取りの SQL に入れ、終了中でも読める。復元は、終了中なら 409 `closed`、すでに復元済みなら何も書かずに 200、復元の時点で未完了かつ担当が有効な参加者でなければ「担当なし」にして記録`auto_unassign`を残す／共通化：`assigneeGoneSql`（完了の取り消しと共用）・`caseVisibleRow`・`viewGate`・`CaseTodoPerson.tsx`／S-17 の行の「履歴」と「削除済みのTODO」の区画（一覧・履歴・「復元」）、削除の確認の案内、資格を失ったときの後片付けの追加。migration はない。**これで #149 の受け入れ条件がすべて満たされた**（下の「149-C の設計」） |
| 150-Aで作ったもの | API2つ（EP-5-11 終了・EP-5-12 再開。参加者は選び直さず、いまの参加者のまま）／通知の2種類（`case.closed`・`case.reopened`）／監査操作2つ（`case.close`・`case.reopen`）／案件の版（`cases.version`）の一致による競合の検知（409 `stale`）／宛先の一致の確認`recipientsUnchanged`を`channel-manage.sql.ts`から`channel-member.sql.ts`へ移したこと／S-17 の「案件を終了」「案件を再開」と確認のダイアログ（下の「150-A の設計」）。migration はない |
| 150-Bで作ったもの | 再開（EP-5-12）の本文（`participantIds`・`addUserIds`・`removeUserIds`。必須）と、参加者の選び直し（外す・追加。本人と自動参加の人は外せない）／409 `participants_changed`・`auto_participant`・`already_participant`／監査の`case.reopen`への`addedCount`・`removedCount`と、人ごとの`case.participant.add`・`remove`（`viaReopen`）／再開の通知の宛先を選び直しの後の参加者にしたこと／batch の件数の確認`guardChanges`を、案件の書き込みの共通の場所へ移したこと／S-17 の再開の2段階のダイアログ`CaseReopenDialog`（下の「150-B の設計」）。migration はない |
| 150-Cで作ったもの | API1つ（EP-5-20 `PATCH /api/cases/:caseId`。件名・説明・取引先・担当部署の再編集。納期は変えない）／衝突の検知（有効な参加者は詳細の`version`、参加していない管理者は概要で見た値`expected`）／監査`case.edit`／足した部署の有効なオーナーの自動参加／詳細（EP-5-08）に`version`を足し、概要の項目も説明・参加者と同じ1回の読み取りで返すこと（**概要・一覧には版を足さない**）／類似件名の確認（`GET /api/case-requests/similar-title`）の任意のクエリ`excludeCaseId`／S-17 の「内容を編集」と`CaseEditDialog`／申請の画面の部品（`DepartmentCheckboxes`・`SimilarTitleNotice`）を共用のために移したこと（下の「150-C の設計」）。migration はない |
| 148-B-1で作ったもの | 案件の添付の一覧（EP-5-19 `GET /api/cases/:caseId/attachments`。有効な参加者だけ。終了した案件でも読める）／S-17 の「添付ファイル」の区画（ファイル名のリンク・大きさ・投稿者・日時・「元のメッセージへ」・「次のページ」）と、添付つきの投稿・返信の成功の後の取り直し／大きさの整形を`features/messages/format-size.ts`に移して共通にしたこと／`ThreadLayout`・`ThreadPane`の省略できる props `onReplied`（下の「148-B-1 の設計」）。migration はない |
| 148-Cで作ったもの | 案件の一覧（EP-5-06）・概要（EP-5-07）の応答（詳細 EP-5-08 も、概要の項目として同じ値を含む。詳細の`channelId`は以前からの項目）に`lastActivityAt`（案件の部屋の、削除されていない最新のメッセージ〔返信を含む〕の投稿の時刻。なければ`null`）と`channelId`（案件の部屋の ID）を足したこと（**どちらも有効な参加者にだけ値を返す**。`participantCount`とは条件が別）／S-16 の参加の行の「最終更新」と未読の数／サイドバーの案件の項目の未読の印（下の「148-C の設計」）。新しい API・migration・索引はない |
| 148-B-2で作ったもの | 案件の添付の公開範囲。`message_attachments.publication_visibility`（migration 0030。2値・既定は`participants_only`）／アップロードのクエリ`publicationVisibility`（案件の部屋だけ）／変更の API（EP-1-23 `PATCH /api/attachments/:attachmentId`。判定の順・書き込みの条件・監査`case.attachment.visibility.change`・対象の種類`attachment`）／EP-5-19 の各項目の`publicationVisibility`・`canChangeVisibility`／返信の取得の応答の`caseRoom`／アップロードの応答の定義の分離（`UploadedAttachmentItem`）／添付の入力欄のファイルごとの選択（S-17 の部屋・スレッド、S-35 の案件のスレッド）／S-17 の一覧の公開範囲の表示と「公開範囲を変更」のダイアログ／`insertPending`を列の名前を明示した INSERT に直したこと／`canManageSql`の`case-access.sql.ts`への移動（下の「148-B-2 の設計」）。**公開範囲の値は、いまは、どの読み取りの資格にも使わない**。migration 0030 は**本番に未適用** |
| 後の子 | 147：なし（#147 の4つの子は、すべて実装済み）。148：なし（148-A・148-B-1・148-C・148-B-2 が実装済み。承認済み公開アーカイブでの非参加者への表示などは 5-5・5-6 の Issue）。149：なし（149-A・149-B・149-C・149-D が実装済み。#149 の4つの子はすべて実装済み）。150：なし（150-A・150-B・150-C が実装済み。#150 の子はすべてそろった） |
| 他の Issue に回すもの | 公開範囲の値による読み取りの資格（承認済み公開アーカイブでの非参加者の閲覧・審査中の一時閲覧・審査中／承認済みの変更の 409。5-5・5-6）、アーカイブ・物理削除（#151）、再編集の「⋯」メニューへの統合と審査中の禁止（#151・5-5・5-6。150-C の「既知の差」）、名前・番号での絞り込みと検索（#155）、全体管理者の任命・引き継ぎによる自動参加（#157） |
| 作らないもの | migration（表は146-Bで作った`cases`・`case_departments`・`channel_members`をそのまま使う）、`case_participants`表、`cases(status,id)`の索引（デモの規模では要らない。要るようになったら利用者に戻す）、一覧の既定値（`scope`・`status`は必須。画面が「参加中・進行中」から始める） |
| 本Issueで確定した決定 | [C-182](../requirements/decision-register.md) |

## ファイルと役割

### バックエンド

| ファイル | 役割 |
| --- | --- |
| `backend/src/routes/cases.ts` | Controller。`GET /api/cases`・`/:caseId`・`/:caseId/detail`。入力の形の確認（`scope`・`status`は必須、`limit`・`cursor`。`caseId`は ULID の形。いずれも`strict`）と応答だけ。全応答に`noStore`。認証と送信元の確認は`app.ts`が`/api/*`に一括で適用する。`backend/src/index.ts`で`/api/cases`に登録 |
| `backend/src/services/case.service.ts` | Service。認可・判定の順・存在の非開示・監査用のログ（`logger.audit`）。Repository が返した結果（詳細は`not_found`・`not_visible`）を 404・403 に分ける。管理の資格は、Service では判定しない（Repository が読み取りの SQL の中で決める）。HTTP を知らない |
| `backend/src/db/case.repository.ts` | Repository。`list`（一覧）・`findSummary`（概要1件）・`findDetailExtras`（詳細だけの項目。操作者の ID を受け取り、戻り値は詳細の項目か`not_visible`か`not_found`。【150-C で変更：概要の項目・担当部署・`version`も同じ`db.batch`で読み、詳細の応答全体を返す】）。`list`・`findSummary`は操作者の ID だけを受け取る。見える範囲と資格は SQL で決める。読み取りだけで、監査・通知は書かない。管理の資格の SQL の条件`canManageSql`は、148-B-2 で`backend/src/db/case-access.sql.ts`に移した（中身は同じ。案件の添付の Repository と共用） |
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
| 詳細（EP-5-08） | パスの`caseId` | 200：概要の項目に、`description`・`channelId`・`createdBy`・`participants`を足したもの。【150-C で、`version`（案件の版）を足した。詳細だけにあり、概要・一覧にはない】 |

- 概要の項目：`id`・`caseNumber`・`title`・`status`・`client`（`id`・`name`・`isActive`）・`departments`（`id`・`name`・`isActive`）・`dueDate`（`YYYY-MM-DD`または`null`）・`isParticipant`・`canManage`・`participantCount`（上の節のとおり`null`になることがある）・`canEditDueDate`（147-B で足した。進行中で、有効な参加者か管理の資格のある人なら真）。進捗は含めない（#149）
- 詳細の`createdBy`は**作成者の利用者の ID**。`participants`は、`userId`・`displayName`・`departmentName`・`isActive`・`isCreator`・`autoRole`・`removable`（後の2つは147-B で足した）。並びは参加した日時、同じなら利用者 ID の順。退職者（無効）も残し、`isActive`を偽にする
- エラー：401（未認証）、403（権限がない・詳細で参加者でない）、404（案件がない）、422（クエリ・パスの形。`fields`）。応答は`noStore`
- 具体的な項目の型は`docs/api/openapi.json`を正とする

## 一覧の SQL

- 範囲は SQL の`WHERE`で絞る：`status`の一致、`joined`のときだけ`activeChannelMember`（操作者の ID）、続きはカーソル。並びは案件 ID の降順（`cursor.ts`の`afterCursor`・`toPage`。OFFSET は使わない。`limit + 1`件を読んで次のページの有無を決める）。ページを送っても、参加していない案件は`joined`に混ざらない
- `all`は全件を返すが、非参加の行は概要の項目だけで、`participantCount`は参加者か管理の資格のある行にしか入らない。説明・参加者は、一覧では読まない。チャンネル ID と最終更新は、148-C から、有効な参加者の行にだけ入る（「148-C の設計」）
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
- **149-D で、削除・退出の batch の文の並びを変えた**：前提 → 監査 → 件数の確認 → 外れた人の TODO の担当の書き換え（4文）→ 参加の行の DELETE → 件数の確認 → 末尾の不変条件。DELETE の件数は、batch の確定の後ではなく、直後の確認の文で確かめる。先頭の前提に、TODO の対象の件数と記録の ID の新しさが加わり、崩れたときのやり直しと 503 は Service が行う（上の最初の判定の順・文言・監査の`detail`は変えない）。詳細は「149-D の設計」

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
- **149-D で、batch に TODO の担当の書き換え（4文）を足した**：先頭の前提の直後（申請の取り消しの前）。対象が担当の未完了・未削除の TODO を、**終了中の案件を含む全案件**で担当なしにし、記録`auto_unassign`（操作した人＝無効化した全体管理者）を残す。先頭の前提に、対象の件数と記録の ID の新しさが加わり、崩れたときのやり直し（合計4回）と、超えたときの 503 は`account.service.ts`の`deactivate`が行う（ほかの理由の判定の順は変えない）。再有効化では何も戻さない。詳細は「149-D の設計」

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
- サイドバーの「案件」の項目は、148-A の時点では変えなかった（未読の印は 148-C で足した。「148-C の設計」）

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

## 148-B-1 の設計（案件の添付の一覧と、元のメッセージへの移動）

決定は[C-191](../requirements/decision-register.md)。要件は 5-2 AC-7 の参加者の部分、5-1 AC-11（終了した案件でも読める）、R-62・R-64、S-17、EP-5-19。**migration はない**。添付の登録・配信・結び付けの経路（148-A まで）は変えず、案件の部屋の添付を一覧する読み取りの API と、S-17 の区画を足した。コードは書き写さず、ファイル名・関数名で指す。

### ファイルと役割

バックエンド：

| ファイル | 役割 |
| --- | --- |
| `backend/src/routes/cases.ts` | `GET /:caseId/attachments`。`caseId`の形と、クエリ（`limit`・`cursor`。`strict`）の確認だけで、応答は`noStore`。1回の件数の既定は専用の定数`ATTACHMENT_PAGE_DEFAULT_LIMIT`（50。上限 100 は共通のクエリの定義）。メッセージの一覧の件数の定数は流用しない（意味と変更理由が別のため） |
| `backend/src/services/case-attachment.service.ts` | 新規。`list`。判定の順（下の表）と、拒否の記録（`logger.audit`。対象は案件の ID で、ファイル名などの中身は入れない）。HTTP を知らない |
| `backend/src/db/case-attachment.repository.ts` | 新規。`findAttachmentListFacts`（案件があるか・操作者が有効な参加者か。404・403 の材料）と`listCaseAttachments`（資格の確認と一覧を1つの`db.batch`で読む）。読み取りだけで、監査・通知は書かない |
| `backend/src/db/attachment-visibility.sql.ts` | 変更はコメントだけ：配信の規則（`attachmentVisible`）と一覧の規則を、どちらかを変えるときは両方を直す、と互いに参照する |
| `docs/api/openapi.json` | EP-5-19 の契約（200・401・403・404・422）。`backend/src/openapi.test.ts`が実装と照合する |

フロントエンド：

| ファイル | 役割 |
| --- | --- |
| `frontend/src/features/cases/api/case-api.ts` | `fetchCaseAttachments`と応答の Zod（`CaseAttachment`・`CaseAttachmentPage`）。種類（`kind`）は`shared/attachment-rules.ts`の一覧で検証する |
| `features/cases/api/query-keys.ts` | `caseKeys.attachments`（利用者の ID と案件の ID を入れる。`all`の下なので、`caseKeys.all`の取り直しにも含まれる） |
| `features/cases/hooks/useCaseAttachments.ts` | `useInfiniteQuery`。有効な参加者で、詳細が取れたときだけ取る。ポーリングしない。自動の再試行はしない |
| `features/cases/components/CaseAttachments.tsx` | S-17 の「添付ファイル」の区画。4つの状態（読み込み中・エラーと「再試行」・0件・あり）と、行・「次のページ」。「元のメッセージへ」は`features/threads`の`useThreadParam`で`?thread=`を開く |
| `features/cases/components/CaseDetailView.tsx` | 参加者の本文に、`CaseTodoSection`の下・`CaseConversation`の上へ区画を差し込み、取得（`useCaseAttachments`）を持つ |
| `features/cases/components/CaseConversation.tsx` | 自分の投稿・返信が成功したら、`caseKeys.attachments`を取り直す（投稿の`onPosted`と、返信の`onReplied`） |
| `features/cases/hooks/useCaseWrites.ts` | 退出の後片付け（`forgetCaseAfterLeave`）で、添付の一覧のキャッシュも取り除く（詳細・TODO の一覧と同じ）【Issue #155：`forgetCaseContent`は、検索の結果も`forgetSearchResults`で片付ける（取り消し → 表示していない分の取り除き → 表示中の分の`resetQueries`。[search.md](search.md)）。ほかのキーの片付けの方式は変えていない（#323）】 |
| `features/cases/labels.ts` | 区画の文言（`CASE_ATTACHMENTS_TEXTS`） |
| `features/messages/format-size.ts`・`index.ts` | 大きさの整形`formatAttachmentSize`（MB＝10^6 バイト・小数1桁）を、送信前の一覧（`AttachmentList.tsx`）から移して共通にした。`attachmentUrl`・`formatAttachmentSize`を公開の入口に足した |
| `features/threads/components/ThreadLayout.tsx`・`ThreadPane.tsx` | 省略できる props `onReplied`。自分の返信が成功した後に呼ぶ（スレッド一覧の取り直しに加えて）。案件の画面だけが渡す |
| `frontend/src/test/server.ts`・`case-attachment-handlers.ts` | MSW。S-17 を描画する全テストで、添付の一覧の既定の応答を空にする。個別のテストは`respondCaseAttachments`で上書きする |

### API と判定の順

`GET /api/cases/:caseId/attachments?limit=&cursor=`。

| 順 | 判定 | 結果 |
| --- | --- | --- |
| 1 | 認証（`app.ts`が`/api/*`に一括で適用） | 401 |
| 2 | クエリ・パスの形（ルート。ここから先の最初） | 422（`fields`）。非参加者・存在しない案件でも、この 422 が先 |
| 3 | 案件がない | 404「案件が見つかりません」（案件の存在は概要で全員に見えるので、非開示の対象ではない。詳細と同じ） |
| 4 | 有効な参加者でない | 403「参加者だけが見られます（非公開）」。**管理の資格はあるが参加していない人（担当部署のオーナー・全体管理者）も同じ**（詳細と同じ。参加の資格と管理の資格は別） |
| 5 | `perm.case.view`（会社の範囲） | 403（拒否は`authorize`が記録） |
| 6 | 読み取り | 資格を SQL の中で再び確かめ、失っていれば中身を捨てて 403（案件が消えていれば 404） |

- 3・4 の材料は1文で読む（`findAttachmentListFacts`）。拒否は`logger.audit`（`case.attachment.view`。reason は`not_found`・`not_participant`）に残し、DB の監査ログ・通知は書かない
- 終了した案件でも、有効な参加者は一覧を読める（5-1 AC-11）。終了しただけでは非参加者に公開しない（C-62）
- 取得（ダウンロード）は、既存の`GET /api/attachments/:id`が毎回判定する（一覧に出ることは取得の許可ではない）

### 読み取りの SQL（`listCaseAttachments`）

- **資格を、中身を読む文に入れる**（#196 の方式）。1つの`db.batch`の1文目で「案件の行＋閲覧者が有効な参加者で、部屋を見てよいか」を読み、2文目の一覧の WHERE にも同じ資格（`activeChannelMember`・`roomViewableBy`）を入れる。資格がなければ一覧の結果を捨てる。4 の判定の後に参加を外された・無効になった人に、ファイル名・投稿者・件数を返さない。資格の部品は、管理の資格を含まない
- **範囲は配信と同じ規則**：その案件の部屋の、投稿に結び付いた（投稿済みの）添付で、メッセージが削除されていないもの。未投稿の添付（本人のものも）・削除済みのメッセージの添付・ほかの案件・通常のチャンネル・DM の添付は混ざらない。返信の親が削除済みでも、返信が残っていれば、その返信の添付は出る（配信と一致）
- **並びとページ送り**：添付の ID の降順（ULID＝アップロードの新しい順）。カーソルは添付の ID。`limit + 1`件を読んで次のページの有無を決める（`toPage`）。1回の既定は 50 件、最大 100 件
- **索引**：`messages`（`messages_room_id_id_idx`）から辿り、添付は`message_attachments_message_id_idx`で引く。結合の順は`crossJoin`で固定する（SQLite が添付の主キーの逆順の全件走査を選ばないため）。`room_id`の索引は足さない。実行計画は`case-attachment.explain.db.test.ts`が確かめる
- 3つの表に同じ名前の列（`id`など）があるので、選択項目に別名を付けて重ならないようにする
- 値の数は固定で、D1 の1文の値の数の上限に関係しない

### 応答の項目

`{ items, nextCursor }`。項目は`id`・`name`・`kind`・`contentType`・`size`・`uploadedAt`（添付の時刻）・`messageId`・`threadParentId`（元のメッセージが返信なら親の ID、トップレベルなら`null`）・`uploader`（`id`・いまの表示名・`isActive`）。

- **名前は既存の添付の応答（`AttachmentItem`。#140）に合わせた**（統括の決定。`api-draft.md`の草案の`fileName`・`mediaType`と食い違うので、`api-draft.md`に注記した）。投稿者は表示名だけで、本名・メールは返さない。退職者は`isActive`が偽
- 保存先のキー・公開 URL は返さない。公開範囲（`publicationVisibility`）と変更の可否は 148-B-2

### 画面（S-17）

- 参加者の本文を、**説明 → 参加者 → TODO → 添付ファイル → やり取り**の順に、見出しで縦に並べる（C-184(3)。タブにしない。タブの共通の部品は別の Issue。統括の決定）。非参加者・詳細が 403 の人には区画を出さず、要求も送らない
- 行：ファイル名（取得のリンク。`attachmentUrl`）・大きさ・投稿者（無効な人は「（退職者）」の併記）・日時・「元のメッセージへ」。続きがあれば「次のページ」（前のページの行は残る）。0件は「添付ファイルはありません」、読み込み中は「添付ファイルを読み込み中です」、失敗は区画の中に文と「再試行」（0件とは出さない）
- 「元のメッセージへ」は、`threadParentId ?? messageId`を`?thread=`に入れて、スレッドの画面（S-07）を開く（C-184(4)。新しい API は作らない）。トップレベルの添付はその投稿を親にしたスレッド、返信の添付は親のスレッド。**親が削除済みでも開く**（スレッドの返信の取得が削除済みの親を許し、返信は残る）
- **取り直し**：ポーリングしない。自分の添付つきの投稿・返信が成功したら、一覧を取り直す（`CaseConversation`の`onPosted`・`onReplied`）。ほかの人の添付は、開き直すか、自分の投稿の後に出る
- 利用者が替われば、キーに利用者の ID を入れているため、前の利用者の一覧は出ない。退出の後は、一覧のキャッシュも取り除く

### 同時の操作

- 一覧の読み取りの直前に参加を外された・無効になった：資格が同じ batch の1文目と2文目の両方に入っているので、中身を返さず 403
- 読み取りの時点でメッセージが削除されていれば、その添付は一覧から外れる。一覧に出た後に消えた添付は、取得（配信）が毎回判定して拒否する
- 一覧の読み取りの後に案件が終了：一覧は読める（終了後も閲覧できる）

### テストの場所（148-B-1）

- DB（隔離した D1）：`backend/src/db/case-attachment.repository.db.test.ts`（出る範囲と並び・投稿者・未投稿／削除済み／ほかの案件・チャンネル・DM が混ざらないこと・親が削除済みの返信の添付・終了した案件・ページ送り〔150 件を 100 件ずつ〕・読み取りの資格〔非参加者・参加の行が残った無効な人・管理の資格だけの人・ほかの案件の参加者は、`listCaseAttachments`を直接呼んでも`not_visible`で、添付を返さない。相関の確認。参加から外れた後・無効になった後の読み取りも同じ〕・`findAttachmentListFacts`）、`case-attachment.explain.db.test.ts`（実行計画が索引を使い、表を全件走査しないこと）
- Service：`backend/src/services/case-attachment.service.test.ts`（判定の順・拒否の記録）、`case-attachment.interleave.test.ts`（資格の確認と一覧の読み取りの間に参加を外す割り込み）
- 結合：`backend/src/routes/cases.attachments.test.ts`（200 の形〔保存キーを含まない〕・401・存在しない案件の 404・非参加者・管理の資格だけの人の 403・クエリの 422 が先・終了した案件・件数の既定と最大）、契約は`backend/src/openapi.case-attachments.test.ts`と`backend/src/openapi.test.ts`。テスト部品は`backend/test/case-attachment-fixtures.ts`
- 画面：`frontend/src/pages/CaseDetailPage.attachments.test.tsx`（配置・4つの状態・行の項目・退職者・次のページ・元のメッセージへ〔トップレベル・返信・親が削除済み〕・非参加者と詳細 403 で要求が飛ばないこと・投稿・返信の成功での取り直し・利用者の切り替え）。MSW は`frontend/src/test/case-attachment-handlers.ts`
- E2E：`e2e/case-attachments.spec.ts`（4 件。参加者の添付つきの投稿・返信 → 一覧 → 元のメッセージへ → ほかの参加者の取得・非参加者に区画が出ない。[e2e.md](../testing/e2e.md)）

### 設計の判断（知見）

- **管理の資格と、参加の資格は別**。`participantCount`・`canManage`のような「参加者または管理の資格」の条件を、中身（ファイル名・投稿者）を読む条件に写すと、参加していない担当部署のオーナー・全体管理者に漏れる。一覧は`activeChannelMember`（有効な参加者）だけを資格にした。計画レビューで見つかり、参加していない担当部署のオーナー・全体管理者が、DB（`listCaseAttachments`の直接の呼び出し）と結合（403）の両方で拒否されるテストを足した
- **結合で、複数の表の同じ名前の列を選ぶときは、別名を付ける**（`id`など）。付けないと、選択項目の名前が重なり、意図しない表の列の値が返りうる
- **SQLite は、「ID の降順＋`LIMIT`」で、主キーの逆順の全件走査を選ぶことがある**。結合の順を固定し（`crossJoin`）、実行計画のテストで確かめる
- 同じ値（既定 50）でも、意味と変更理由が別の定数は分ける（添付の一覧の件数とメッセージの一覧の件数。統括の決定）。大きさの整形のように、同じ意味の処理は共通にする

## 148-C の設計（S-16 の「最終更新」「未読」と、サイドバーの案件の未読の印）

決定は[C-191](../requirements/decision-register.md)(4)（「最終更新」の定義）と[C-192](../requirements/decision-register.md)。要件は 5-1 AC-4 の残り（最終更新・未読）、5-1 AC-2（チャンネル ID は参加者だけ）、C-184(1)（サイドバーの案件の未読の印）、S-16。**新しい API・migration・索引はない**。既存の API の応答に 2 項目を足し、既存の未読の取得（EP-3-01）を案件の画面から引く。コードは書き写さず、ファイル名・関数名で指す。

### ファイルと役割

| ファイル | 役割 |
| --- | --- |
| `backend/src/db/case.repository.ts` | `selectRows`の選択項目に`lastActivityAt`・`channelId`を足し、`CaseSummary`の型とコメントを「チャンネル ID・最終更新は有効な参加者にだけ返す」に改めた。一覧（`list`）・概要（`findSummary`）が共用するので、2 つの API に同時に入る |
| `docs/api/openapi.json` | `CaseSummary`に`lastActivityAt`（日時または`null`）・`channelId`（ULID の形または`null`）を、必須・`null`可で足した（`backend/src/openapi.case-activity.test.ts`が項目と説明を、`openapi.test.ts`が実装との一致を確かめる） |
| `frontend/src/features/cases/api/case-api.ts` | 概要の Zod（`summarySchema`）に 2 項目を足した（一覧・概要・詳細が共用） |
| `frontend/src/features/cases/components/CaseList.tsx` | S-16 の参加の行に「最終更新：（日時）」（なければ「—」）と未読の数を足した |
| `frontend/src/features/cases/components/CaseSidebarSection.tsx` | 案件の項目の中身を、`features/unread`の`RoomLinkLabel`にした（件名と未読の印） |
| `frontend/src/test/case-handlers.tsx` | MSW の見本。概要に 2 項目を足した（詳細は参加者だけが見るので、`channelId`は必ず部屋の ID にする） |

### 応答の項目と資格（`lastActivityAt`・`channelId`）

- `lastActivityAt`：案件の部屋の、**削除されていない**最新のメッセージ（返信を含む）の投稿の時刻。メッセージがなければ`null`（C-191(4)）。TODO・案件の情報・参加者の変更は含めない
- `channelId`：案件の部屋の ID。未読の対応表（部屋の ID → 件数）を引くために返す
- **どちらも、有効な参加者にだけ値を返す**。非参加者・無効な利用者（参加の行が残っていても）・外された人・**参加していない担当部署のオーナー・参加していない全体管理者**には`null`。項目は省かず`null`で返す（形が変わらない）。終了した案件でも、参加者には返す
- **`participantCount`とは条件が別**：`participantCount`は「有効な参加者、または管理の資格がある人」に返すが、この 2 項目は参加者だけ。管理の資格（`canManage`）の条件を写すと、参加していない担当部署のオーナー・全体管理者に、部屋の ID とやり取りの時刻（内容の一部）が漏れる（計画レビューの指摘。5-1 AC-2「チャンネル ID は参加者だけ」）。`channelId`は、以前の`CaseSummary`の方針「チャンネル ID は持たない」を「参加者にだけ返す」に変えたもので、詳細の`channelId`と同じ範囲になる
- 資格は、値を決める SQL の同じ文の中（`isParticipant`の CASE 式）で決める（#196 の方式）。サービス側で先に参加を調べて SQL に渡す形にしない

### 最終更新の SQL

- `selectRows`の選択項目の副問い合わせ：`CASE WHEN`参加者`THEN`（部屋の最新のメッセージの投稿の時刻を 1 行）`ELSE NULL END`。部屋の条件には、外側の`cases.channel_id`を sql の式で包んで渡し、内側の表（`messages`）には別名を付ける（#294。相関が常に真にならないこと）
- 並びは`messages.id`の降順で 1 行（ID は ULID で投稿の順）。**索引は足さない**：既存の`messages_room_id_id_idx`（`room_id`・`id`）で 1 行を読む。実行計画は`backend/src/db/case-activity.explain.db.test.ts`が確かめる（表を索引なしで全件走査しないこと・副問い合わせが外側の案件の行を指すこと）
- 一覧の表示の 1 ページ分の行ごとに副問い合わせが 1 つ付く。N+1 の追加の問い合わせはなく、既存の「本体の行を 1 回＋担当部署を 1 回」の組み立てのまま

### 画面

- **S-16 の参加の行**（`isParticipant`が真）に、件名のリンクの外へ、未読の数（`UnreadCountBadge`。見える印は 1〜99 か「99+」、読み上げは「未読 n件」「未読 99件以上」）と、「最終更新：」＋日時（`<time>`。表示は`features/messages`の`formatMessageTime`と同じ形式）を出す。最終更新がなければ「最終更新：—」。**非参加の行には、最終更新も未読も出さない**（C-192。メッセージの有無・時刻も内容の一部のため）。印を件名のリンクの外に置くのは、リンクの名前を件名のまま保つため（既存の E2E の名前の一致を壊さない）
- **サイドバーの案件の項目**：`RoomLinkLabel`で、未読があれば、リンクの名前は「{件名} 未読 n件」（100 件以上は「未読 99件以上」）、件名は太字。未読 0 は件名のまま
- **未読の数は新しい集計を作らず**、チャンネル・DM のサイドバーと同じ`features/unread`の`useUnreadCounts`（`GET /api/me/unread`を 2 秒ごと、全ページを読んで部屋の ID → 件数の対応表にする。案件の部屋は`perm.case.view`があれば含まれる）を、`channelId`で引く。案件を開いて既読になると（S-17 のやり取りの既存の既読。`useMarkRoomRead`）、取り直しで S-16・サイドバーの両方から消える
- **未読の取得に失敗している間・読み込み中は、数を出さない**（古い数を出し続けない）。失敗の文は、案件の欄では出さない（参加中のチャンネルの欄が`UnreadCountsError`を出すため、同じ文を重ねない。C-192）。一覧そのもの・サイドバーの項目は出す
- 向きは`features/cases` → `features/unread`・`features/messages`の公開の入口だけ（逆はない。`npm run deps:check`で確かめる）

### 同時の操作・更新の仕組み

- 一覧の「最終更新」は、読み取りの時点の値。一覧の行は**ポーリングしない**（#117 の既存の動き。2 秒ごとに案件の一覧全体を取り直さないため）。画面を開き直したとき・ウィンドウに戻ったときなど、TanStack Query の既定の取り直しで更新される。未読の数だけが 2 秒ごとに変わる
- 一覧を読んだ後に参加を外された場合：一覧の応答に入った値はその時点の資格で決まったもの。外された人が S-17 を開くと詳細は 403 になる（147-A）。外された人は、次に一覧を取り直したときから、その行に最終更新・未読が出なくなる
- 利用者が替わった場合：一覧のキーに利用者の ID が入っている（#284）ため、前の利用者の最終更新・未読の数は次の利用者の画面に出ない（`CaseUnread.app.test.tsx`が確かめる）

### テストの場所（148-C）

- DB（隔離した D1）：`backend/src/db/case.repository.activity.db.test.ts`（最新の時刻〔返信を含む・削除済みを除く・ほかの案件や案件でない部屋を数えない〕・メッセージなしは`null`・終了した案件・非参加者・無効な利用者・外された人・**参加していない担当部署のオーナー・全体管理者が`participantCount`は入るのに 2 項目は`null`**。「すべての案件」・「自分が参加する案件」・概要の 3 つで確かめる。D1 の値の上限を超える件数でも読める）。`case.repository.db.test.ts`は、応答の項目の一覧に 2 項目を足しただけ。実行計画：`backend/src/db/case-activity.explain.db.test.ts`
- 結合：`backend/src/routes/cases.activity.test.ts`（応答に 2 項目が必須で、`null`でも省かない・値の型・非参加者の本文に部屋の ID や時刻が出ないこと）、契約は`backend/src/openapi.case-activity.test.ts`と`backend/src/openapi.test.ts`。`routes/cases.test.ts`は項目の一覧の更新
- 画面：`frontend/src/pages/CasesPage.activity.test.tsx`（S-16 の最終更新・未読の数・99+・非参加の行に出ない・未読の取得の失敗で数なしで一覧は出る・ポーリングで一覧を取り直さずに数が変わる）、`frontend/src/features/cases/case-sidebar.unread.test.tsx`（未読あり・なし・99+・取得の失敗・読み込み中・案件の取得の失敗の既存の表示）、`frontend/src/pages/CaseUnread.app.test.tsx`（枠を通して、案件を開くと両方から消えること・利用者の切り替えで前の利用者の数が出ないこと）
- E2E：`e2e/case-activity.spec.ts`（6 件。参加者 A の投稿で、開いたままの B の S-16 とサイドバーに再読み込みなしで「未読 1件」が出る → 開き直すと最終更新が出る → 案件を開くと両方から消える → 非参加者 C の行には出ない。[e2e.md](../testing/e2e.md)）

### 設計の判断（知見）

- **全員に返す応答に、参加者だけの項目を足すときは、同じ SQL の中で資格を判定し、既存の別の条件（管理の資格を含む`participantCount`の条件）を写さない**。写すと、参加していない担当部署のオーナー・全体管理者に漏れる。計画レビューで見つかり、DB（一覧・概要）と結合の両方で、その人たちに`null`が返るテストにした
- **未読の数は一覧に入れず、既存の未読の取得を部屋の ID で引く**。一覧に`unreadCount`を入れる案は、一覧がポーリングしないため数が古くなり、サイドバーでも使えないので採らなかった。代わりに、参加者にだけ`channelId`を返す
- **最終更新の副問い合わせは、既存の索引（`messages_room_id_id_idx`）で足りる**。実行計画のテストで確かめたうえで、索引を足さない（migration を避ける）
- 利用者の切り替えを見張る本番の組み立て（#284 の枠）と違う枠でテストすると、正しい実装が落ちる。枠を通すテスト（`CaseUnread.app.test.tsx`）は、本番と同じ組み立てを使う

## 148-B-2 の設計（案件の添付の公開範囲：選択・変更・一覧の表示）

決定は[C-195](../requirements/decision-register.md)（細部）と[C-191](../requirements/decision-register.md)(1)〜(3)（利用者の決定）。要件は 5-2 AC-8・AC-9（AC-7 の項目の部分）、R-85、S-17・S-35、EP-1-09・EP-1-23・EP-5-19。**migration あり（0030）**。コードは書き写さず、ファイル名・関数名で指す。

### 範囲の要点

- ファイルごとに、「参加者限定」（`participants_only`。既定）か「全社員公開アーカイブで公開できる」（`public_archive`）を選ぶ。選べるのは案件の部屋（S-17 の部屋・S-17 のスレッド・S-35 の案件のスレッド）への添付だけ。通常のチャンネル・DM の添付の画面・動作は変えない
- **公開範囲の値は、いまは、どの読み取りの資格にも使わない**。配信（`GET /api/attachments/:id`）・EP-5-19・部屋のメッセージ・単体のメッセージ・返信・スレッド一覧（`GET /api/me/threads`）のどれも、値によらず従来の資格のまま（参加者だけ）。「承認されるまでは参加者だけが見られる」（5-2 AC-8・C-64）のとおり。値で非参加者に見せる読み取りは、公開申請の機能（5-5・5-6）で足す。そのため`attachmentVisible`・`loadMessageAttachments`・`bindAttachments`・メッセージの表示の添付の項目（`AttachmentView`）は変えていない（メッセージの表示に公開範囲を出さない）。この「使わない」ことは、非参加者（一般・参加していない担当部署のオーナー・参加していない全体管理者）に対する上の6経路のテストで固定した
- 案件でない部屋の行も、列は`participants_only`を持つ（「案件の部屋だけ」はほかの表の情報なので CHECK に書けない。値の意味があるのは案件の部屋の行だけ）。値の定義元は`shared/attachment-rules.ts`の`PUBLICATION_VISIBILITIES`・`DEFAULT_PUBLICATION_VISIBILITY`で、schema の CHECK・API の検証・画面の選択肢が参照する

### ファイルと役割

バックエンド：

| ファイル | 役割 |
| --- | --- |
| `backend/db/schema.ts`・`backend/db/migrations/0030_add_attachment_publication_visibility.sql` | `message_attachments`に`publication_visibility`（`text`・NOT NULL・既定`participants_only`・2値の CHECK`message_attachments_publication_visibility_check`）を足した。`db:generate`がテーブルの作り直しを生成したため、ADR-0024 に従って`ALTER TABLE … ADD`に書き換えた（先頭にコメント）。既存の行は既定値で埋まる（追加だけで破壊的でない）。索引は足さない（この列で絞る読み取りがない）。**本番に未適用**（適用は、ほかの migration とまとめて、利用者の承認の後） |
| `shared/attachment-rules.ts` | 値の定義元（`PUBLICATION_VISIBILITIES`・型・`DEFAULT_PUBLICATION_VISIBILITY`） |
| `backend/src/db/attachment.repository.ts` | `insertPending`を、列の名前を明示した INSERT に直し（位置合わせをやめた。表に列が足されても値がずれない）、`publication_visibility`を足した。`PendingAttachmentInsert.publicationVisibility`は**必須**（省略で既定値に落とさない）。`pendingInsertable`は、従来の資格（`roomInsertable`に分けた）に、「参加者限定以外は案件専用チャンネルだけ」を足した（Service の 422 と同じ範囲の二重の守り） |
| `backend/src/services/message.service.ts` | `requirePostable`が`{ caseRoom }`を、`requireReplyable`が親に`caseRoom`を足した形を返す（新しい読み取りを増やさない）。返信の取得（`listReplies`）の応答に`caseRoom`（スレッドの部屋が案件専用チャンネルか。DM は偽）を足した。表示の制御だけに使い、認可には使わない |
| `backend/src/services/attachment.service.ts` | アップロードの判定の順に「公開範囲の指定（422）」を、ヘッダーの確認の後・本文を読む前に足した（`checkPublication`）。`UploadedAttachment`に`publicationVisibility`（案件の部屋なら値、ほかの部屋は`null`） |
| `backend/src/routes/attachments.ts` | アップロードのクエリ`publicationVisibility`を任意の文字列として受けて Service に渡す（値の確かめは、部屋と権限の判定の後に Service が行う。部屋に入れない人に入力の正しさを教えない）。`attachmentRoutes()`に`PATCH /:attachmentId`を足した（`noStore`・`validate("param")`〔ULID の形。誤りは配信と同じ 422〕・`validate("json")`〔封筒だけ。値の確かめは Service〕） |
| `backend/src/db/case-access.sql.ts` | 新規。`canManageSql`（管理の資格＝有効な全体管理者、または担当部署のどれかの有効なオーナー）を`case.repository.ts`から移した。中身は変えていない。`case.repository.ts`と`case-attachment.repository.ts`が使う |
| `backend/src/db/case-attachment.repository.ts` | `findVisibilityFacts`（変更の判定の材料を1文で読む）・`visibilityChangeCondition`（書き込みの条件。下の節）・`changeVisibility`（監査と更新を1つの`db.batch`で）・`AttachmentStateChangedError`。一覧の各項目に`publicationVisibility`・`canChangeVisibility`を足した |
| `backend/src/services/case-attachment.service.ts` | `changeVisibility`。判定の順は下の表。先頭のコメントにも同じ順を書いてある |
| `backend/src/lib/audit-actions.ts` | `AUDIT_ACTIONS`に`case.attachment.visibility.change`、`AUDIT_TARGET_TYPES`に`attachment`を足した。`AUDIT_TARGET_TYPES`は監査の検索の入力の検証の定義元なので、足さないと、記録された行を「この対象で絞り込む」が 422 になる |
| `docs/api/openapi.json` | EP-1-23（`PATCH`）の追加／アップロードの 2 つの入口のクエリ`publicationVisibility`／アップロードの 201 を新しい定義`UploadedAttachmentItem`（`AttachmentItem`の項目＋`publicationVisibility`〔2値か`null`〕）に替えた（`AttachmentItem`はメッセージの表示と共用なので変えない）／`CaseAttachmentItem`に 2 項目／`ReplyLatestPage`・`ReplyAfterPage`に`caseRoom`／監査の`action`・`targetType`の列挙値 |
| `vitest.config.ts` | テストだけで使う空の D1`MIGRATION_UPGRADE_DB`を足した（migration の更新の試験。`DB`とは別の識別子。`wrangler.jsonc`は変えない） |

フロントエンド：

| ファイル | 役割 |
| --- | --- |
| `features/messages/components/AttachmentList.tsx` | 送信前の一覧に、任意の props`publication`（業務を知らない設定の型`AttachmentPublicationConfig`＝選択肢・既定値・案内の文）を足した。渡したときだけ、各行に選択欄（共通部品`SelectField`。名前「{ファイル名} の公開範囲」。送信中は無効）と、案内を 1 つ出す |
| `features/messages/components/MessageComposer.tsx` | 任意の props`publication`。選んだファイルと選んだ値を、1 つの配列（`{ file, visibility }`）で持つ（並列の配列にしない。取り消しで一緒に消える）。送るときは値を`usePostMessage`に渡す |
| `features/messages/hooks/usePostMessage.ts`・`api/message-api.ts` | `publicationVisibilities`（`files`と同じ順）を足した。`uploadAttachment`は値があるときだけクエリに付ける。アップロードの応答は新しい`uploadedAttachmentSchema`で検証する（メッセージの表示の`attachmentSchema`は変えない）。返信の取得の zod に`caseRoom` |
| `features/messages/components/ThreadReplies.tsx`・`RoomMessages.tsx`、`features/threads/components/ThreadLayout.tsx`・`ThreadPane.tsx` | `publication`を通す。`ThreadReplies`は、応答の`caseRoom`が真のときだけ入力欄に渡す（S-35 は、どの部屋のスレッドも同じ部品で開くため） |
| `frontend/src/pages/ThreadsPage.tsx`・`features/cases/components/CaseConversation.tsx` | 案件の設定`CASE_ATTACHMENT_PUBLICATION`（`features/cases/labels.ts`）を渡す。`features/messages`・`features/threads`から`features/cases`は参照しない（組み合わせは`pages/`と`features/cases`で行う）。チャンネル・DM の画面は何も渡さない |
| `features/cases/labels.ts` | 選択肢の名前（`PUBLICATION_VISIBILITY_LABELS`。「参加者限定」「全社員公開アーカイブで公開できる」）・案内（`PUBLICATION_VISIBILITY_HINT`）・設定・ダイアログと完了の文言 |
| `features/cases/api/case-api.ts` | 一覧の zod に 2 項目、`changeAttachmentVisibility`（`PATCH /attachments/:id`。応答を検証） |
| `features/cases/components/CaseAttachments.tsx`・`CaseAttachmentVisibilityDialog.tsx` | 各行に公開範囲の名前。`canChangeVisibility`の行だけに「{ファイル名} の公開範囲を変更」。ダイアログは、いまの値を選んだ状態の 2 択（`RadioGroup`）と案内・「変更」「キャンセル」。二重の確認は作らない。結果の表示は下の「画面」 |
| `features/cases/components/CaseDetailView.tsx` | 開いている変更の対象を持ち、資格を失ったときにほかのダイアログと一緒に閉じる |
| `features/cases/hooks/useCaseWrites.ts`・`useCaseAccessLoss.ts` | `useChangeAttachmentVisibility`（成功しても失敗しても`caseKeys.all`を取り直す。1 行を書き換えず、ページと続きの位置を崩さない）。資格を失ったことの検出の対象（#308）に添付の一覧の取得（`caseKeys.attachments`）を足した |
| `features/audit-logs/action-labels.ts` | 操作の名前「案件の添付の公開範囲の変更」と対象の名前「添付ファイル」。`AuditLogsPage.tsx`の名前を解決する対象には足さない（ファイル名を監査の画面に出さない） |

### アップロード（EP-1-09 の拡張）

- クエリ`?publicationVisibility=participants_only|public_archive`（任意。本文がバイト列のため）。判定の順：部屋（`requireRoom`。404・409）→ `perm.attachment.upload`（403）→ ヘッダー（422）→ **公開範囲（422）**→ 本文の検査（422）→ 保存 → `insertPending`
- 公開範囲：指定なしは`participants_only`。一覧にない値は 422（`fields: ["publicationVisibility"]`）。**案件の部屋でない部屋での指定は、値によらず（`participants_only`でも）同じ 422**。部屋に入れない人には、値が不正でも 404 が先
- 応答は`{ id, name, kind, contentType, size, publicationVisibility }`。案件の部屋なら値、ほかの部屋は`null`（通常のチャンネル・DM の応答は、項目が増えるだけで、画面・動作は変わらない）
- `insertPending`の 0 行（受信中の状態変化）は従来どおり：実体を消し、部屋の判定を読み直して 404・403・409。公開範囲による 0 行は、Service の 422 に先に当たるため通常は起きない

### 公開範囲の変更（EP-1-23 `PATCH /api/attachments/:attachmentId`）

本文`{ publicationVisibility }`、応答`200 { id, publicationVisibility }`（`Cache-Control: no-store`）。

| 順 | 判定 | 結果 |
| --- | --- | --- |
| 1 | 認証・送信元の確認（`app.ts`）、ID の形（ルート） | 401・403・422（形の誤りは存在を漏らさない） |
| 2 | 材料の読み取り（`findVisibilityFacts`）：添付が存在し、`attachmentVisible`（配信と同じ規則）を満たす | 見えない・存在しない：404「添付が見つかりません」（配信と同じ本文） |
| 3 | 投稿済み | 未投稿（自分のものも）：2 と同じ 404 |
| 4 | 案件の部屋の添付 | 通常のチャンネル・DM の添付：422（`fields: ["attachmentId"]`）。見える添付なので存在は漏れない |
| 5 | 有効な参加者 | 参加者でない（参加の行が残っても無効・外された人を含む）：2 と同じ 404 |
| 6 | `perm.case.view` → `perm.case.attachment.visibility.change`（会社の範囲） | 403（拒否は`authorize`が記録） |
| 7 | 添付した本人、または管理の資格（`canManageSql`）。**参加の資格（5）とは別に、両方を求める** | どちらでもない：403「この添付の公開範囲は変更できません」 |
| 8 | 本文（必須・2 値） | 422（`fields: ["publicationVisibility"]`） |
| 9 | 案件が進行中 | 終了：409「終了した案件の添付の公開範囲は変更できません」 |
| 10 | 今と同じ値 | 書かずに 200（監査も書かない） |
| 11 | 書き込み | 0 行なら 2 から読み直して 3〜9 と同じ順・同じ応答。読み直した値が求めた値なら 200（書かない）。どれにも当たらなければ 409「状態が変わったため、変更できませんでした。読み込み直してからお試しください」（成功にしない） |

- 404・403（7）・409 の拒否は`logger.audit`（`case.attachment.visibility.change`。対象は添付の ID。reason を持つ。**ファイル名を入れない**）に残す。DB の監査ログには成功だけを書く
- 審査中・承認済みの公開申請での 409 は、公開申請の機能（5-5）が未実装のため、まだ判定にない（「既知の差」）
- **再認証は求めない**（利用者の決定。C-191(1)）

### 書き込みの条件と監査（`visibilityChangeCondition`・`changeVisibility`）

- 書き込みの条件は、最初の判定（上の 2〜9 のうち行で決まるもの）を、**外側の行に依存しない独立した`EXISTS`**にしたもの：添付の ID・投稿済み・`attachmentVisible`（配信と同じ関数）・案件専用チャンネルの案件が進行中・`activeChannelMember`（有効な参加者）・（本人か`canManageSql`）・いまの値が読んだ値のまま（`publication_visibility = before`。版の列の代わり）。外側の行に依存しないので、監査の`INSERT … SELECT`（FROM なし。`auditLogInsert`の`onlyWhen`）と、`UPDATE`の WHERE の両方に同じ条件をそのまま入れられる。`perm.*`はロールで決まり DB の行にないので入れない（ロールの変更は次の要求から。`changeDueDate`と同じ方針）
- `changeVisibility`：1 つの`db.batch`に、監査（先）→ `UPDATE … RETURNING`を入れる。監査が先なので、両方が同じ「更新前」の時点の条件を見る（片方だけ書かれない）。`RETURNING`が 0 件なら`AttachmentStateChangedError`を投げ、Service が上の 11 へ進む。案件の`version`は上げない（同時の終了は条件の「進行中」で守る）
- 監査：action`case.attachment.visibility.change`・`targetType: "attachment"`・`targetId`は添付の ID・`detail`は平らな`{ caseId, before, after }`（ファイル名・投稿者名を入れない）
- `findVisibilityFacts`の副問い合わせは、#294 に従い、外側の列を入れ子の SQL で渡し、内側の表に別名を付ける（相関が常に真にならない）。相関の誤り（別の添付・別の案件の行で条件が真になる）は、DB のテストで確かめる

### 一覧（EP-5-19）の項目

各項目に`publicationVisibility`と`canChangeVisibility`を足した（どちらも必須）。`canChangeVisibility`は、一覧を読む同じ文の中で決める（案件が進行中、かつ添付した本人か管理の資格）。参加の資格は、一覧の WHERE の既存の資格が求めている。終了した案件では全員が偽。**表示の制御だけで、認可は変更の API が毎回行う**。非参加者には、いままでどおり一覧を返さない（403）

### 画面

- **入力欄（S-17 の部屋・S-17 のスレッド・S-35 の案件のスレッド）**：添付を選ぶと、ファイルごとに選択欄（初期値は参加者限定）が出て、選択肢の近くに案内「全社員公開が承認されるまでは、参加者だけが見られます」を 1 つ出す。選んだ値はファイルごとにクエリに乗る。ファイルを取り消すと選んだ値も消える。S-35 は、案件の部屋かどうかを返信の取得の応答の`caseRoom`で見分ける（通常のチャンネル・DM のスレッドには出ない）
- **S-17 の「添付ファイル」**：各行に公開範囲の名前を出す。`canChangeVisibility`の行だけに「公開範囲を変更」（名前にファイル名を含む）。ダイアログで選んで「変更」。送信中は「変更」「キャンセル」と、ほかの行の「公開範囲を変更」を押せない
- **結果の表示（区画の側）**：成功はダイアログを閉じて「公開範囲を変更しました」（`role="status"`）。409・404・403 はダイアログを閉じて、区画に文（`role="alert"`。サーバーの文言）。422 はダイアログの中。**成功の文は次の操作の開始で、失敗の文は次の結果で消す**。変更の後は一覧を取り直す（ポーリングはしない）
- **資格を失ったとき**：変更の後の取り直しや一覧の取り直しが 403・404 になれば、概要を確かめ、非参加なら添付の一覧のキャッシュを取り除き、ダイアログを閉じる（#308 の仕組み）

### 同時の操作

| 起きること | 守り方 |
| --- | --- |
| 同じ前の値を読んだ 2 人が、同じ変更先に変更する | 2 値で、同じ値なら書かないため、同じ前の値からの実の変更は同じ変更先になる。後の人は 0 行になり、読み直した値が求めた値なので 200。監査は先の 1 件だけ |
| 判定の後に、案件が終了する | 0 行 → 読み直して 409（終了の文）。行・監査は変わらない。変更が先なら、終了は影響を受けない |
| 判定の後に、参加の削除・無効化・メッセージの削除 | 0 行 → 読み直して 404（見えなくなった人に 403・409 を出さない） |
| 判定の後に、オーナーの交代（本人でない人が、担当部署のオーナーでなくなる） | 0 行 → 読み直して 403 |
| 判定の後に、`perm.case.attachment.visibility.change`がロールから外れる | この要求は通る（次の要求から 403） |
| アップロード（`public_archive`）の受信中に、案件の終了・参加の解除 | 148-A のとおり 0 行 → 実体を消し、読み直して 409・404 |
| 未投稿の添付の変更 | 3 の 404。結び付けと競合しない |

### テストの場所（148-B-2）

- DB（隔離した D1）：`backend/src/db/attachment-publication.schema.db.test.ts`（列・既定値・CHECK が 2 値以外と NULL を拒否）、`attachment-publication.upgrade.db.test.ts`（既存の行がある DB への migration の更新。テスト専用の空の D1`MIGRATION_UPGRADE_DB`で、0030 の直前まで適用 → 通常のチャンネル・DM・案件の部屋の添付〔投稿済み・未投稿〕を入れる → 0030 だけを適用 → 件数・既存の列・結び付きが保たれ、新しい列がすべて`participants_only`）、`attachment.repository.pending.db.test.ts`（登録：`public_archive`は案件の部屋だけ 1 行、ほかは 0 行。列の名前を明示した INSERT への書き換えの退行も同じファイル）、`case-attachment.visibility.db.test.ts`（書き込みの条件を 1 つずつ崩すと 0 行・監査 0 件、満たせば 1 行・監査 1 件。同じ案件の別の添付・別の案件の行が条件を満たしていても対象が条件を崩せば 0 行〔相関〕）、`case-attachment.list-visibility.db.test.ts`・`case-attachment.repository.db.test.ts`（一覧の 2 項目）
- Service・割り込み：`backend/src/services/case-attachment.visibility.test.ts`（判定の順・拒否の記録にファイル名がないこと）、`case-attachment.visibility-race.test.ts`（判定の後・書き込みの前の割り込み 6 件）、`attachment.service.test.ts`・`attachment.service.upload.test.ts`
- 結合：`backend/src/routes/attachments.visibility.test.ts`（EP-1-23 の応答・エラー・非参加者の 404 が存在しない添付と同じ本文）、`attachments.visibility-reads.test.ts`（**公開範囲が`public_archive`でも、非参加者に 6 つの読み取りの経路で返さないこと**。参加者は対照）、`attachments.case-room.test.ts`（アップロードの指定・422・R2 に残らない）、`messages.replies.case-room.test.ts`（返信の取得の`caseRoom`）、`audit-logs.attachment.test.ts`（記録された行を`targetType=attachment`で絞り込める）、`cases.attachments.test.ts`・`attachments.test.ts`・`messages.replies.authz.test.ts`
- 契約：`backend/src/openapi.attachment-visibility.test.ts`（EP-1-23・クエリ・`UploadedAttachmentItem`・`AttachmentItem`が変わっていないこと・`caseRoom`・監査の列挙値）、`openapi.case-attachments.test.ts`・`openapi.test.ts`・`lib/audit-actions.test.ts`・`audit-actions.case-attachment.test.ts`
- 画面：`frontend/src/features/messages/components/MessageComposer.publication.test.tsx`、`api/message-api.publication.test.ts`、`frontend/src/pages/CaseDetailPage.publication.test.tsx`（S-17）、`ThreadsPage.publication.test.tsx`（S-35）、`CaseDetailPage.attachment-visibility.test.tsx`（一覧・ダイアログ・結果の表示）、`CaseAccessLoss.test.tsx`（添付の一覧の取り直しが 403 のとき）、`features/audit-logs/action-labels.attachment.test.ts`。MSW は`frontend/src/test/case-attachment-handlers.ts`・`attachment-handlers.ts`・`message-handlers.ts`
- E2E：`e2e/case-attachment-visibility.spec.ts`（6 件。本人が全社員公開アーカイブで公開できるを選んで添付 → 一覧に表示 → 参加者限定に変更 → S-35 から案件のスレッドへ返信すると選択が出る → ほかの参加者にはボタンが出ない → 担当部署のオーナー〔参加者〕は変更できる → 非参加者の配信は 404。[e2e.md](../testing/e2e.md)）。シードは`e2e/seeds/case-attachment-visibility.sql`、後始末は`case-attachment-visibility-cleanup.sql`（実体は手元の R2 から先に消す）

### 設計の判断（知見）

- **既存の表に列を足すとき、位置合わせの`INSERT … SELECT`は壊れる**。列の名前を明示した INSERT に先に直し、退行のテストが通ることを確かめてから列を足した
- **書き込みの条件は、外側の行に依存しない独立した`EXISTS`にする**。監査の`INSERT … SELECT`は FROM がなく、外側の添付の行の列を書けない。独立させれば、同じ条件を監査と更新の両方に入れられる。ただし、内側の表の解釈を誤ると別の添付の行で条件が真になるため、相関を DB のテストで確かめる
- **管理の資格と、参加の資格は別**（148-B-1 と同じ）。変更は「有効な参加者」かつ「本人か管理の資格」の両方を求める（R-85）
- **値を持つだけで、使わない**。公開範囲は、読み取りの資格に使う機能（5-5・5-6）の前に、値だけを先に持つ。使っていないことを、全部の読み取りの経路のテストで固定した
- **既存のテスト・契約の期待を足したもの**：`openapi.case-attachments.test.ts`（一覧の項目の完全一致）、`lib/audit-actions.test.ts`（一覧の完全一致）、返信の取得の応答を見る既存のテスト・見本（`caseRoom`）、アップロードの応答を見る既存のテスト（`publicationVisibility`）

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
| バックエンド | `backend/src/db/case-todo.repository.ts` | Repository。`listTodos`・`findTodoWriteFacts`（判定の材料を 1 つの batch で読む）・`addTodo`・`completeTodo`・`uncompleteTodo`・最大 ID の取得（`maxTodoId`・`maxEventIdOverall`。149-B で、TODO ごとの`maxEventId`から記録の表の全体の最大に変えた）。`case.repository.ts`から`activeCaseWith`・`assertStatement`・`runWriteBatch`・`K_ROOM`を公開して使う |
| バックエンド | `backend/src/db/case.repository.ts` | 概要・一覧の`progress`（`todoTotal`・`todoDone`の副問い合わせ。外側の案件の ID は表の名前つきで渡す〔C-185〕）。削除済みを除き、0 件は`null` |
| 契約 | `docs/api/openapi.json` | 4 つの API と`progress`（`backend/src/openapi.case-todos.test.ts`・`openapi.test.ts`が実装と照合） |
| フロントエンド | `features/cases/api/case-todo-api.ts`・`hooks/useCaseTodos.ts`・`hooks/useCaseTodoWrites.ts` | `apiClient`で 4 つの API を呼び、Zod で検証する。一覧は無限スクロール式の取得で 2 秒ごとに取り直す。書き込みは成功・失敗とも`caseKeys.all`を取り直す。キーは`caseKeys.todos`（利用者の ID と案件の ID を含む） |
| フロントエンド | `components/CaseTodoSection.tsx`・`CaseTodoItem.tsx`・`CaseTodoAddForm.tsx`・`CaseTodoProgress.tsx` | S-17 の TODO の区画（見出し・進捗・追加・一覧・「さらに表示」・4 つの状態）。進捗の表示は`CaseTodoProgress`を S-16 の行・S-17 のヘッダー・区画で共用。担当の名前の出し分け（`PersonName`・`Assignee`）は、149-C で`CaseTodoPerson.tsx`に移した（行・履歴・削除済みの一覧で共用） |
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
- 完了の取り消しのとき、担当者がいまも有効な参加者かを確かめ、違えば現在の担当を NULL にして、記録`auto_unassign`を先に残す（外れた担当は、記録の`assignee_id`・`assignee_name`に入れる）。担当した時点の人と名前は表に残す。この「担当がいて、いま有効な参加者でない」の判定は、149-C で`assigneeGoneSql`（`case-todo.repository.ts`のモジュールの関数）に切り出し、復元と共用している（定義は1か所。動きは変えていない）

### 書き込みの batch と件数の確認

- 1 回の操作は 1 回の`db.batch`。先頭で前提（案件が進行中・操作者が有効な参加者・対象の TODO の状態・担当者が有効な参加者）を、`cases.version`を「そのままか NULL」にする UPDATE で確かめる（`assertStatement`。#196 の方式）。崩れていれば NOT NULL 違反で batch 全体が取り消され、`CaseStateChangedError`になる。業務の文・記録の文にも同じ条件を付けている
- **条件つきの INSERT・UPDATE は、条件が偽で 0 行でも SQL のエラーにならない**。必須の行を書く文の直後に、`changes()`が期待どおりかを確かめる文（`guardChanges`）を置き、合わなければ同じく batch 全体を取り消す。これで「TODO だけ残って記録がない」などの中途半端な成功を作らない
- 追加の順：前提 → TODO の挿入 → 確認 → 記録`create` → 確認 → 項目と進捗の読み取り。完了の順：前提 → 記録`complete` → 確認 → TODO の更新 → 確認 → 進捗（記録を先にするのは、「未完了」の条件が更新の後には偽になるため）。取り消しの順：前提 → 記録`auto_unassign`（担当者が外れているときだけ）→ 確認 → 記録`uncomplete` → 確認 → TODO の更新 → 確認 → 進捗
- 取り消された後は、Service が最初と同じ判定で読み直す：理由（404・409・422）に当たればそれを返し、すでに求める状態なら 200 にする。どれにも当たらなければ、次の ID の順の逆転とみなす

### ID の確定の順（追加した順として ID を使うため）

- 一覧の順と`cursor`は ID の昇順に頼るので、**ID の順を追加の順として使うには、確定の順の保証が要る**。書く文に、同じ案件の TODO（記録は、149-B で改めて**記録の表の全体**）に、渡した ID 以上がすでにあれば書かない条件を付けた（記録の方の経緯は「149-B の設計」の「記録の ID」）
- 条件で書けなかったとき（時計の逆転・同時の追加）は、Service が確定済みの最大の ID（`maxTodoId`・`maxEventIdOverall`）より大きい ID を作り直して、batch 全体をやり直す（`ulidAfter`）。上限（`MAX_ID_RETRIES`＝3 回）を超えたら 503（成功にしない。API 仕様の追加・完了・取り消しに 503 を書いてある）。取り消しの記録は 2 件になりうるので、ID を 2 つ昇順で用意する

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

## 149-B の設計（案件の TODO：編集・削除）

決定は[C-196](../requirements/decision-register.md)。要件は 5-4 AC-6（編集で選べる担当・担当の名前の導線）、AC-7（編集・削除の反映）、AC-8、AC-9（編集・削除の 409）、AC-10（担当変更の記録。見せるのは 149-C）、AC-12（削除したものを一覧・進捗から除く部分）。**migration はない**（表は 0029 で作ってある）。コードは書き写さず、ファイル名・関数名で指す。

### ファイルと役割（149-B で足した・変えたもの）

| 区分 | ファイル | 役割 |
| --- | --- | --- |
| バックエンド | `backend/src/routes/case-todos.ts` | `PATCH /api/cases/:caseId/todos/:todoId`（EP-5-15。本文は JSON として読めることだけを確かめ、形は Service が 403 の後に確かめる）と`DELETE …/:todoId`（EP-5-16。本文なし、204）を足した |
| バックエンド | `backend/src/services/case-todo.service.ts` | `editTodo`・`deleteTodo`、判定の純粋関数`decideEdit`・`decideDelete`、編集の本文の形`editBodySchema`。409 の理由`todo_changed`・`todo_completed`を足した。操作名`case.todo.edit`・`case.todo.delete`は、404・403 の拒否の`logger.audit`だけに使う（TODO の操作は監査ログの表に残さない決まりは変えない） |
| バックエンド | `backend/src/db/case-todo.repository.ts` | `editTodo`・`deleteTodo`、`findTodoWriteFacts`の拡張（TODO の題名・担当の ID・項目の応答の形を返す）、`maxEventIdOverall`。`eventIdsFreshSql`（記録の ID の新しさの確認）は 149-D で`case-todo-unassign.sql.ts`に移した（ここから import する）。TODO ごとの`maxEventId`は削除した |
| 契約 | `docs/api/openapi.json` | 2 操作と本文・応答、409 の理由の追加（`backend/src/openapi.case-todos.test.ts`・`openapi.test.ts`が実装と照合する） |
| フロントエンド | `features/cases/api/case-todo-api.ts`・`hooks/useCaseTodoWrites.ts` | `editCaseTodo`・`deleteCaseTodo`（応答は Zod）、`useEditCaseTodo`・`useDeleteCaseTodo`（`onError`は定義の側、`onSettled`で`caseKeys.all`）、`useCaseTodoBusy`（案件ごとの mutation のキーで、書き込みの送信中を1つにまとめる） |
| フロントエンド | `components/CaseTodoItem.tsx` | 進行中だけ「編集」「削除」を出す。担当の名前（現在・完了時・「以前の担当」）は、有効な社員なら`ProfileCardTrigger`でプロフィールカード（S-27）を開く形にし、カードに`StartDmButton`を差す（自分には出さない。セッションが届くまでも出さない）。無効な社員は「（退職者）」つきの文字だけ。この名前の出し分け（`PersonName`・`Assignee`）は、149-C で`CaseTodoPerson.tsx`に移した（履歴・削除済みの一覧と共用） |
| フロントエンド | `components/CaseTodoEditDialog.tsx`（新） | 題名と担当の編集のダイアログ（完了済みは題名だけ） |
| フロントエンド | `components/CaseTodoAssigneeOptions.tsx`（新。計画にはなかった） | 追加と編集で共用する担当の選択肢（「担当なし」と有効な参加者）。編集では、いまの担当が選べない人（外れた・無効）でも、変えていないことが分かるよう選択肢に残す |
| フロントエンド | `components/CaseTodoSection.tsx`・`CaseTodoAddForm.tsx`・`labels.ts` | 編集・削除のダイアログの開閉と結果の表示を区画で持つ（行の外）。送信中は追加・完了・取り消し・編集・削除をすべて止める。文言`CASE_TODO_EDIT_TEXTS`。追加の欄は選択肢の部品を使う |
| フロントエンド | `features/profile/ProfileCard.tsx` | カードの ID に`useId`を足し、同じ人のカードを同じ画面に複数置いても重ならないようにした（TODO の各行の担当）。「閉じる」は開いている間だけ置く |

### API と判定の順

| API | 判定の順 |
| --- | --- |
| 編集（EP-5-15） | 404（案件）→ 403（有効な参加者でない）→ `perm.case.todo.edit` → 本文の形・題名・版（422）→ TODO がない・ほかの案件（404）→ 削除済み（409 `todo_deleted`）→ 完了済みで担当を指定（409 `todo_completed`）→ 担当を変えるときだけ、新しい担当が有効な参加者でない（422 `assigneeUserId`）→ 終了中（409 `closed`）→ 版が違う（409 `todo_changed`）→ 求めた値がいまと同じなら**何も書かずに 200** → batch |
| 削除（EP-5-16） | 404 → 403 → `perm.case.todo.edit` → TODO がない・ほかの案件（404）→ 終了中（409 `closed`）→ すでに削除済みなら**何も書かずに 204** → batch |

- 編集の本文は`version`（必須。1 以上）と、`title`・`assigneeUserId`（どちらも任意。ただし少なくとも1つ。`assigneeUserId`は`null`で「担当なし」）。余分な項目は 422。応答は追加と同じ形の項目と`progress`
- 題名の「同じ」は整形の後の値で、担当の「同じ」は ID で比べる。いまの担当と同じ ID を送れば、その人がいま参加者でなくても 422 にしない（担当者が外れたときの書き換えは 149-D で実装済み）
- **完了済みの TODO は題名だけ編集できる**（利用者の決定）。担当を指定すると、いまと同じ担当でも 409 `todo_completed`。題名の変更では、担当と完了時の担当・完了の記録を変えない
- 「手で担当なしにした」ときは、担当した時点の人と名前（`recorded_assignee_*`）も空にし、「以前の担当」を残さない（利用者の決定。担当者が外れて自動で担当なしになる場合は、以前の担当を残す〔149-A の完了の取り消し・149-D（実装済み）〕）
- 削除は論理削除（`deleted_at`・`deleted_by`）。担当・完了の列は変えない（復元で引き継ぐため）。完了済みも削除できる。版は送らない（利用者の決定）。編集と削除が重なったときは、削除が先なら編集が 409 `todo_deleted`、編集が先なら削除は成功する
- 409 `todo_changed` を 409 `closed` より後にする：終了は TODO の版を変えないので、終了中に古い版で送ったときは「終了」を伝える。TODO の 404 は本文の 422 より後：非参加者には 403 が先なので、TODO の有無・本文の誤りは漏れない
- `decideEdit`・`decideDelete`は、判定の材料（`TodoWriteFacts`）だけを見る純粋関数。「すでにその状態」のときは、いまの項目と進捗を結果として返す。Service は最初の判定を通れば、変える項目を読んだ値から決める（版が一致する間は、batch の時点でも同じ値）

### 書き込みの batch と件数の確認

149-A の型（前提の確認 → 記録 → 件数の確認 → 業務の更新 → 件数の確認 → 読み取り。「書き込みの batch と件数の確認」）に合わせる。

- 編集（`editTodo`）：前提（進行中・操作者が有効な参加者・TODO がその案件の未削除で**版が読んだとおり**・担当を変えるときは未完了と新しい担当が有効な参加者・記録の ID の新しさ）→ 記録`title_change`（題名を変えるとき）→ 確認 → 記録`assignee_change`（担当を変えるとき）→ 確認 → TODO の更新（版を 1 足す）→ 確認 → 項目と進捗。**変えない項目の記録の文は、条件を偽にして置き、確認の件数を 0 にする**（文の位置を固定し、結果の読み取りの位置を変えないため）。記録を更新より先にするのは、版の条件が更新の後には偽になるため。担当の記録には、新旧の担当の ID と、記録の時点の表示名を入れる（前が担当なしなら空）
- 削除（`deleteTodo`）：前提（進行中・操作者が有効な参加者・未削除）→ 記録`delete`（その時点の題名）→ 確認 → TODO の更新（削除の日時と削除者・版を 1 足す）→ 確認
- 前提が崩れて batch が取り消されたら、Service が最初と同じ判定で読み直す（149-A と同じ）：理由（404・409・422）に当たればそれを返し、すでにその状態なら 200・204。どれにも当たらなければ記録の ID の逆転とみなし、記録の ID を作り直してやり直す（`writeWithRetry`）

### 記録の ID（149-A の方式を 149-B で改めた）

149-A は、記録の ID の新しさを「同じ TODO に渡した ID 以上がない」で確かめ、作り直しの基準は TODO ごとの最大だった。この方式は、時計が戻って`ulidAfter`が「前の ID ＋ 1」を返すと、**別の TODO の記録**と主キーが衝突しうる。149-B で次のように改めた（149-A の完了・取り消しも同じに直した）。

- 先頭の前提に、`eventIdsFreshSql`（記録の表の**全体**に、最初の ID 以上の ID がないこと。主キーの索引で1回）を入れる。崩れたら、Service が`maxEventIdOverall`（全体の最大）より大きい ID を作り直して、batch 全体をやり直す（上限・503 は 149-A と同じ）。同じ TODO の中の順も保たれる
- 代わりに、読み取りと batch の間に別の TODO の記録が確定しただけでも、やり直しになる（社内の規模では頻度は小さい）
- 追加の TODO の ID（`maxTodoId`。案件ごと）にも同じ型の穴がありうるが、今回の範囲外（利用者に確認する点）

### 同時の操作

- 同じ TODO を同じ版で2人が同時に編集：先が確定して版が進み、後は前提が崩れて読み直しで 409 `todo_changed`。記録は先の分だけ
- 完了 → 取り消しで状態が元に戻った後の、古い版の編集：版が 2 進んでいるので 409 `todo_changed`（状態が戻る競合を版で止める）
- 編集と案件の終了・参加者の削除・担当にした人の削除：前提が崩れ、読み直しで 409 `closed`・403・422 になる。何も残らない

### 画面（S-17）

- TODO の各行（進行中の案件のみ）に「編集」「削除」（`aria-label`は「{題名}を編集」「{題名}を削除」）。送信中は全部の操作を止める
- 削除は既存の`CaseConfirmDialog`（見出し「TODOの削除」・本文「「{題名}」を削除します。」・「削除する」）。成功すると「TODOを削除しました」。確認の本文の後ろに、「削除したTODOは、削除済みの一覧から復元できます。」の案内を 149-C で足した（`CaseConfirmDialog`の`notice`。文言は`labels.ts`の`CASE_TODO_EDIT_TEXTS.deleteRestoreHint`）
- 編集のダイアログ（`CaseTodoEditDialog`）：開いた時点の`version`を持つ。送るのは変わった項目だけで、何も変わらなければ送らずに閉じる。題名は送る前に`shared/case-todo-rules.ts`の規則で確かめる。422 は欄に、409・403 は欄の外（`role="alert"`）に出し、**入力は残す**。成功すると「TODOを更新しました」
- 409 の理由は、**サーバーの文言で見分ける**（共通の`ApiError`が理由を持たないため。先例はチャンネルの編集のダイアログ。計画からの変更点）。サーバーと画面の文言は`labels.ts`の`CASE_TODO_EDIT_TEXTS`で合わせてあり、文言を変えるときは両方を直す
  - 削除済み（`todo_deleted`）：「このTODOは削除されています」を出し、保存を押せなくする
  - ほかの人の変更（`todo_changed`）：一覧の取り直しが終わるまで保存を押せなくする。取り直した一覧に項目があれば「最新の内容」（題名・担当）を出し、次の保存は最新の版で送る。取得済みのページに項目がなければ、削除とは言わず「閉じてから、一覧で確かめてください」を出す。取り直しの失敗は「再試行」。取り直しが終わったかは、時刻の比較ではなく、一覧の取得の**成功・失敗の回数**で見分ける（#320）。409 を受けたとき（と「再試行」を押したとき）に、react-query の一覧の状態の成功の回数（`dataUpdateCount`）と失敗の回数（`errorUpdateCount`）を控え、回数はキャッシュの購読（`CaseTodoEditDialog.tsx`の`useFetchCounts`。`useSyncExternalStore`と`queryCache.subscribe`）から読む（データや状態が同じ、つまり同じ内容で成功した取り直しでも、回数が変われば描画が起き、「読み込み中」が終わる。回数が控えより小さくなった場合、つまりキャッシュの作り直しは、守りとして 0 から数え直す。「再試行」は送信中は押せない）。成功の回数が控えより増えたら「届いた」（項目があれば最新の内容、なければ上の「確かめてください」）、失敗の回数が増えたら「失敗」（「再試行」）、どちらでもなければ「読み込み中」とする（状態をコピーしない。同じミリ秒でも正しく動く）。409 より前に始まった取得は数えない（409 の後の`invalidateQueries`が取得中のものを取り消して取り直し、取り消された取得はどちらの回数にも入らない）。409 の後の 2 秒ごとの自動の取り直しの成功も「届いた」になる。409 を受けていない間は、ふだんの自動の取り直しの最中・失敗でも、ダイアログの表示は変わらない
- ダイアログを開いている間に、ほかの人の操作で項目が完了・削除されても閉じない（入力を失わせない）。送ったときに 409 で伝える。利用者が替わったときと資格を失ったとき（一覧がなくなったとき）は、開いているダイアログを出さない（#284）
- 担当の選択肢は`CaseTodoAssigneeOptions`（「担当なし」と有効な参加者。編集ではいまの担当も残す）。終了中は「編集」「削除」を出さない

### テストの場所（149-B）

- DB：`backend/src/db/case-todo.repository.edit.db.test.ts`（編集・削除の書き込みの結果、前提を1つずつ崩す、記録の ID の逆転、監査ログが増えないこと）、`backend/src/db/case-todo.explain.db.test.ts`・`case-todo.repository.db.test.ts`（記録の ID の新しさの確認への変更に追随）
- Service・route：`backend/src/routes/case-todos.edit.test.ts`（判定の順・存在の非開示）、`backend/src/services/case-todo.edit.decide.test.ts`（`decideEdit`・`decideDelete`）、`case-todo.edit.event-id.db.test.ts`（記録の ID の作り直し）、`case-todo.edit.interleave.test.ts`（確認の直後に状態が変わる割り込み）。契約は`backend/src/openapi.case-todos.test.ts`
- 画面：`frontend/src/pages/CaseTodos.edit.test.tsx`（編集・削除・409 の理由ごとの表示。末尾に #320 のテスト：409 の後の取り直しの失敗・最中・再試行を、時刻が進む場合と同じミリ秒の場合の 2 通りで、送信中の自動の取り直し、ふだんの自動の取り直しで表示が変わらないこと。続けて、コードレビュー1回目の指摘の 3 件：通信が切れて戻った後に同じ中身を取得しても読み込み中が終わる／409 の前からキャッシュが最新の場合／もう一度送っている間は「再試行」が無効）、`CaseTodos.session-switch.test.tsx`（利用者の切り替え）、`CaseCloseTodoWarning.test.tsx`、`frontend/src/features/profile/profile-card.unique-id.test.tsx`（カードの ID）。MSW は`frontend/src/test/case-todo-handlers.ts`
- E2E：`e2e/case-todos-edit.spec.ts`（1 件。題名の変更が別の参加者の画面に 3 秒以内に出る → 古い版での保存は 409 で入力が残る → 削除で両方の一覧と進捗から消える。[e2e.md](../testing/e2e.md)）

### 設計の判断（知見）

- **記録の ID の新しさは、同じ TODO の中ではなく、記録の表の全体で確かめる**：時計が戻ったときに、別の TODO の記録と主キーが衝突しないため（149-A の方式の穴を、149-B で直した）
- **条件つきの文を「変えないとき」にも置く**：変えない項目の記録の文を、条件を偽にして置き、確認の件数を 0 にする。変える項目によって文の数が変わらないので、結果の位置に頼る読み取りが崩れない
- **共通の`ApiError`が理由を持たないとき、画面は文言で理由を見分ける**：サーバーと画面で文言を合わせて持つ。理由を持つ形への共通化は、別の Issue

## 149-D の設計（案件の TODO：担当者が外れたときの担当の書き換え）

決定は[C-197](../requirements/decision-register.md)。要件は 5-4 AC-6（担当者が外れたとき）、5-1 AC-3（「TODO 担当の記録は 5-4 AC-6 に従う」）、C-24。API・画面は足していない（画面は 149-A の「担当なし（以前の担当：名前）」のまま）。migration は 0031 の1本（索引だけ）。コードは書き写さず、ファイル名・関数名で指す。

### 規則（定義元は1か所）

- 担当者が案件から外れたら、**外す操作と同じ batch の中で**、その人が現在の担当で、**未完了・未削除**の TODO の`assignee_id`を NULL にする（`recorded_assignee_*`は残す。「以前の担当」が出る）。記録`auto_unassign`（`assignee_id`＝外れた人、`assignee_name`＝`recorded_assignee_name`、操作した人＝**外す操作をした人**）を TODO ごとに1件足し、`version`に 1 を足す。版が進むので、外れる前の画面からの編集は 409 `todo_changed`になる
- 削除済みの TODO と完了済みの TODO には当てない（完了済みは完了時の担当名が残る）。外れた人がもう一度参加しても、担当は戻らない（再追加では何も戻さない）。削除済みの TODO の担当は、外れた人を指したままでありうる。149-C の復元は、復元の時点で判定し直す（「149-C の設計」）
- 外れる経路は4つ：参加者の削除、本人の退出、無効化、再開の除外（150-B）。オーナーの交代・異動は参加の行を消さない（案件の参加者から外れない）ので対象外
- 終了中の案件でも、**無効化と再開の除外では書き換える**（終了中の案件の TODO を無効化・再開が変えてよい、という決定）。参加者の削除・退出は進行中の案件だけ（147-B のまま）
- TODO の操作は監査ログの表に残さない（C-188 のまま）。参加者の削除の監査`case.participant.remove`・無効化の監査の`detail`は変えない

### ファイルと役割

| 区分 | ファイル | 役割 |
| --- | --- | --- |
| バックエンド | `backend/src/db/case-todo-unassign.sql.ts`（新） | **規則の定義元**。`unassignTargetSql`（未完了・未削除・担当あり・範囲、の条件）、範囲の3つ（`caseAssigneeScope`＝案件×1人、`assigneeScope`＝全案件×1人、`caseAssigneesScope`＝案件×複数人〔JSON の値1つ〕）、`readUnassignPlan`（batch の前に、対象の件数 n と、記録の ID〔昇順の n 個の JSON〕を読む）、`unassignPreSql`（先頭の前提に入れる式）、`unassignStatements`（4文）。`eventIdsFreshSql`は 149-B で`case-todo.repository.ts`に置いていたが、**ここに移した**（`case-todo.repository.ts`はここから import する。定義は1か所） |
| バックエンド | `backend/src/db/case.repository.ts` | `buildRemoveParticipantStatements`（export。参加者の削除・退出の batch の文を組む）と、それを実行する`removeParticipant`（plan を読んで batch に渡す）。再開は`composeReopen`が plan を受け取り、`buildReopenStatements`が async になった（plan を読んでから文を組む）。`reopenCase`も plan を読む |
| バックエンド | `backend/src/db/account.repository.ts` | `deactivate`に、4文を差し込んだ（申請の取り消し`autoCancelCaseRequests`の**前**）。`guardUsers`（件数の確認。下記） |
| バックエンド | `backend/src/services/case.service.ts`（`removeParticipant`）・`account.service.ts`（`deactivate`） | 前提が崩れたときのやり直し（下の「やり直しと 503」）。既存の理由（409 `closed`・`auto_participant`・`last_active_participant`、無効化の各 409 など）と判定の順・文言は変えない |
| バックエンド | `backend/src/services/case-todo.service.ts` | `MAX_ID_RETRIES`・`BUSY_MESSAGE`を export し、上の2つの Service が使う |
| DB | `backend/db/schema.ts`・`backend/db/migrations/0031_add_case_todos_assignee_index.sql` | 索引`case_todos_assignee_id_id_idx (assignee_id, id)`の追加（`CREATE INDEX`の1文。破壊的な変更はない。ADR-0024 の書き換えは要らなかった）。無効化は案件をまたいで`assignee_id`で探すため（なければ表の全件の走査になる）。**本番に未適用**（適用は、ほかの migration とまとめて、利用者の承認の後） |
| 契約 | `docs/api/openapi.json` | 参加者の削除（EP-5-10）・無効化（EP-0-10）の応答に 503（共通の`ServiceUnavailable`）を足した（`backend/src/openapi.test.ts`が照合する） |

### 書き込みの batch（4つの経路）

どの経路も、**batch の前に読むのは「対象の件数 n」と「記録の表の全体の最大の ID」だけ**（`readUnassignPlan`）。ID は、全体の最大より大きい値を昇順に n 個作る（記録がなければ新しい ID から。149-B の「記録の ID」と同じ考え。時計が戻っても、別の TODO の記録と主キーが衝突しない）。

- **先頭の前提**（既存の`assertStatement`の条件に`unassignPreSql`を足す）で、1回だけ「いまの対象の件数が n」「記録の表の全体に最初の ID 以上の ID がない」を確かめる。n が 0 のときは件数だけ確かめる
- **4文**（`unassignStatements`）：記録の INSERT…SELECT（対象を ID 順に番号付けし、ID の JSON と番号で結ぶ）→ 件数の確認（n 件）→ 担当の UPDATE（`assignee_id`を NULL、版に 1）→ 件数の確認（n 件）。**4文とも条件は規則だけ**で、呼び出し側の前提（`condition`・`stillClosed`）を付けない。担当を NULL にした直後から「読んだときのまま」は偽になるため、それを後ろの文の条件にすると、参加の行の削除などが 0 行になって失敗する。後ろの文が見る条件が、前の文で崩れないことを、経路ごとに確かめてある
- 件数の確認は、表ごとに別の関数：案件の経路は`guardChanges`（`cases.version`を使う）、無効化は`guardUsers`（対象の1行の`users.login_id`を NULL にする。`assertStatement`と同じ列なので`AccountStateChangedError`になる）
- D1 の上限：束縛する値の数は n によらず固定（ID・再開で外す人は JSON の値1つ＋`json_each`）。文は4つで固定。対象150件でも1回で成功することをテストで確かめた

| 経路 | 文の並び（件数の確認を含む） | 範囲 |
| --- | --- | --- |
| 参加者の削除・本人の退出 | 前提（既存の条件＋`unassignPreSql`）→ 監査 → **確認（新）** → 4文 → 参加の行の DELETE → **確認（新）** → 末尾の不変条件（有効な参加者が1人以上） | その案件×対象の人 |
| 再開の除外（150-B） | 前提（＋`unassignPreSql`）→ 再開の監査 → 確認 → 人ごとの監査 → 確認 → **4文（外す人が0人でも置き、n=0 で通す）** → 参加の行の削除 → 追加 → 通知 → 案件の更新 → 不変条件 | その案件×外す人（JSON） |
| 無効化 | 前提（既存の条件＋`unassignPreSql`）→ **4文** → 申請の取り消し → 以降は既存 | 全案件×対象の人（終了中を含む） |

- 参加者の削除・退出：これまで、DELETE の件数は batch の確定の**後**に確かめていた（0 行でも監査が残りうる）。**DELETE の直後の`guardChanges(1)`と、監査の直後の`guardChanges(1)`に置き換え**、結果の配列の位置に依存しなくした
- 再開：文の数が増えても、案件の更新の位置は`statements.length`で取るので、位置はずれない。外す人が 0 人でも 4 文を置くのは、文の数を人数で変えないため
- 無効化：4文は、申請の取り消しより前に置く。申請の取り消しは、前提の`condition`（審査中の申請の件数が読んだとおり）を偽にするが、4文は`condition`を使わないので影響しない

### やり直しと 503（既存の動作の変更）

- 参加者の削除・無効化の batch は、先頭の前提が崩れると全体が取り消される。これまでは、読み直しても既存の理由（404・403・409 など）に当たらなければ元のエラー（500）にしていた。149-D で、**対象の件数の変化・記録の ID の逆転（別の TODO の記録が読み取りと batch の間に確定した場合も含む）**がこの原因に増えるため、Service が Repository を呼び直す（Repository が n と ID を読み直す）
- 試行は、最初の1回＋やり直し`MAX_ID_RETRIES`（3）回の**合計4回**（149-A の`writeWithRetry`と同じ）。毎回の取り消しの後に、既存の判定で読み直し、理由に当たればそれを返す。**上限を超えたら`logger.warn`を残し、503（`SERVICE_UNAVAILABLE`。文言は`BUSY_MESSAGE`）**。何も残らない。成功にはしない
- 再開は、150-B の既存の動き（1回だけやり直し、それでも崩れたら 409 `retry`）のまま

### 同時の操作

| 組み合わせ | 結果 |
| --- | --- |
| 参加者の削除の読み取りと batch の間に、その人を担当にする追加・編集が確定（件数が変わる） | 先頭の前提が崩れて取り消し → やり直しで新しい TODO も外れる。上限で 503（何も残らない） |
| 同じ間に、対象が 1 件完了し、別の 1 件が担当になる（件数は同じ） | 取り消さずに確定する。**batch の時点の対象**が外れる（読んだときの中身の一致は見ない） |
| 同じ間に、別の TODO の記録が確定し、全体の最大が最初の ID 以上になる | 取り消し → ID を作り直してやり直す |
| 参加者の削除と、その人が担当の TODO の完了・削除（論理） | どちらが先でも、完了・削除済みは対象外。外れが先なら、完了の記録の担当は空 |
| 無効化と、その人の別の案件からの削除 | D1 は直列に実行する。`auto_unassign`は TODO ごとに 1 回だけ（`assignee_id IS NOT NULL`の条件） |
| 外した後に、外す前の版で TODO を編集 | 版が 1 進んでいるので 409 `todo_changed` |

### テストの場所（149-D）

- DB：`backend/src/db/case-todo-unassign.db.test.ts`（参加者の削除・退出の書き換え・記録・版・監査が変わらないこと・0 件・戻らないこと・記録の ID の衝突・文の列を差し替えて崩す・前提の件数・中身の入れ替わり・対象 150 件）、`backend/src/db/account.repository.case-participation.db.test.ts`（無効化。終了中の案件を含む）、`backend/src/db/case-reopen-reselect.db.test.ts`（再開の除外）、`backend/src/db/case-todo.explain.db.test.ts`（実行計画。無効化は担当の列の索引を使う。参加者の削除は`case_todos`の全件の走査をしない、かつ`case_todos_case_id_id_idx`か担当の列の索引のどちらかを使う）
- 割り込み・Service：`backend/src/services/case-todo-unassign.interleave.test.ts`（読み取りの後に件数・中身が変わる順、やり直しの上限）、`backend/src/routes/cases.participants.busy.test.ts`（上限を超えた 503）
- 契約：`backend/src/openapi.test.ts`（503 の照合）
- E2E：`e2e/case-todos-unassign.spec.ts`（1件。参加者が TODO の担当者を外すと、再読み込みなしで 3 秒以内に「担当なし（以前の担当：名前）」になる。シードは`e2e/seeds/case-todos-unassign.sql`、後始末は`e2e/seeds/case-todos-unassign-cleanup.sql`。[e2e.md](../testing/e2e.md)）

### 設計の判断（知見）

- **「読んだときのまま」の条件は、先頭の前提で 1 回だけ確かめ、後ろの文には付けない**：担当の書き換えが、その条件の材料（担当の列）を変えるため、後ろの文に付けると自分で偽にしてしまう。後ろの文には、途中で崩れない条件（規則・既存の`stillClosed`）だけを付ける
- **対象の「集合の一致」ではなく、「件数の一致」と、batch の時点の規則で選ぶ**：読み取りと batch の間に中身が入れ替わっても、batch の時点の対象を処理するので正しい。集合を JSON で持つ案は、文を長くし、書き換えの途中で偽になる条件を作るため採らなかった
- **索引は`(assignee_id, id)`の 1 本**：無効化（案件をまたぐ）が、`case_todos`の全件の走査にならないため（知見 db/index-design の項目 1）。`(case_id, id)`の既存の索引と合わせ、参加者の削除はどちらでも走査しない

## 149-C の設計（案件の TODO：履歴・削除済みの一覧・復元）

決定は[C-198](../requirements/decision-register.md)。要件は 5-4 AC-7（復元・履歴の反映）、AC-9（終了中は復元不可。履歴・削除済みの一覧は読める）、AC-10・AC-11（履歴の閲覧・完了の記録）、AC-12（削除済みの一覧）、AC-13（復元）、AC-14（S-17 の中で展開して履歴を見る）。**149-C で、#149 の受け入れ条件がすべて満たされた**。**migration はない**（記録の種類`restore`は migration 0029 の CHECK にある。索引も既存で足りる）。コードは書き写さず、ファイル名・関数名で指す。

### ファイルと役割（149-C で足した・変えたもの）

| 区分 | ファイル | 役割 |
| --- | --- | --- |
| バックエンド | `backend/src/routes/case-todos.ts` | 3経路：`GET /api/cases/:caseId/todos/:todoId/events`（EP-5-24）・`GET /api/cases/:caseId/deleted-todos`（EP-5-25。`/todos/deleted`にすると`/todos/:todoId`と紛れるため別の名前）・`POST /api/cases/:caseId/todos/:todoId/restore`（EP-5-26。本文は受け取らない）。どれも`noStore`。一覧の取得の形（`limit`・`cursor`。既定・上限とも 100）は EP-5-13 の`listQuerySchema`を使い回す |
| バックエンド | `backend/src/services/case-todo.service.ts` | `listTodoEvents`・`listDeletedTodos`・`restoreTodo`、復元の判定の純粋関数`decideRestore`（export）。閲覧の門`viewGate`（404 → 403 → `perm.case.view`。一覧と共用）と、資格つきの読み取りの結果を 404・403 に分ける`visiblePage`（一覧と共用）。操作名`case.todo.history`・`case.todo.deleted_list`・`case.todo.restore`は、404・403 の拒否の`logger.audit`だけに使う（TODO の操作を監査ログの表に残さない決まりは変えない） |
| バックエンド | `backend/src/db/case-todo.repository.ts` | `listTodoEvents`・`listDeletedTodos`・`restoreTodo`、復元の文の列を組む`buildRestoreTodoStatements`（export。件数の確認のテストが文の列を直接使うため）。共通の部品：`assigneeGoneSql`（担当がいて、いま有効な参加者でない。`uncompleteTodo`と共用）・`caseVisibleRow`（案件の行と資格。一覧・履歴・削除済みの一覧で共用）・`itemColumns`（項目の列。通常の一覧と削除済みの一覧で共用）・`todoInCaseWith`（削除の有無を問わない TODO の存在の条件。`liveTodoWith`はこの上に組む） |
| 契約 | `docs/api/openapi.json` | 3 操作と応答の schema（`backend/src/openapi.case-todos.test.ts`・`openapi.test.ts`が実装と照合する） |
| フロントエンド | `features/cases/api/case-todo-api.ts`・`api/query-keys.ts` | `fetchCaseTodoEvents`・`fetchDeletedCaseTodos`・`restoreCaseTodo`（応答は Zod）。キー`todoEvents`（TODO ごと）・`caseTodoEvents`（案件までの前方一致用）・`deletedTodos`。どれも利用者の ID が 2 番目（`CASE_KEY_USER_ID_INDEX`） |
| フロントエンド | `hooks/useCaseTodoEvents.ts`・`useDeletedCaseTodos.ts` | 無限スクロール式の取得。**開いている間だけ取得**し（`enabled`）、2 秒ごとに取り直す。間隔と止める条件（401・403・404）は`useCaseTodos.ts`の`todoRefetchInterval`（149-C で export）を共用する |
| フロントエンド | `hooks/useCaseTodoWrites.ts` | `useRestoreCaseTodo`（案件ごとの mutation のキーを付け、`onError`は定義の側、`onSettled`で`caseKeys.all`を取り直す） |
| フロントエンド | `components/CaseTodoHistory.tsx`（新） | 履歴の部品と「履歴」の開閉のボタン`CaseTodoHistoryButton`。1件ずつ「日時・操作した人・内容」を古い順に出す。内容の文言は種類ごと（追加・題名の変更・担当の変更・完了・完了の取り消し・担当者が外れたため担当なし・削除・復元の8種類）。4つの状態と「さらに表示」（続きの失敗で読み込み済みの行を隠さない） |
| フロントエンド | `components/CaseDeletedTodos.tsx`（新） | 「削除済みのTODO」の開閉の区画。行は読み取り専用（題名・担当・完了の状態・削除した人・日時・「履歴」）。進行中の案件だけ「復元」を出す |
| フロントエンド | `components/CaseTodoPerson.tsx`（新。計画にはなかった） | `PersonName`・`Assignee`（担当の名前の出し分け）。`CaseTodoItem.tsx`にあったものを、履歴・削除済みの一覧と共用するため移した |
| フロントエンド | `components/CaseTodoItem.tsx`・`CaseTodoSection.tsx`・`labels.ts` | 行に「履歴」（終了中・送信中でも押せる。読み取りだけ）。区画の一覧の下に削除済みの区画を置き、復元の送信と結果の表示は区画が持つ（149-B と同じ）。送信中は復元を含む全部の書き込みを止める。削除の確認に案内を足す。文言は`CASE_TODO_HISTORY_TEXTS` |
| フロントエンド | `hooks/useCaseWrites.ts`・`useCaseAccessLoss.ts` | 資格を失ったときの後片付けに、削除済みの一覧と履歴を足した（下の「資格を失ったときの後片付け」） |

### API と判定の順

| API | 判定の順 |
| --- | --- |
| 履歴（EP-5-24） | 404（案件）→ 403（有効な参加者でない。「参加者だけが見られます（非公開）」）→ `perm.case.view` → TODO がない・ほかの案件の TODO（404「TODOが見つかりません」。**削除済みは 404 にしない**）→ 読み取り（資格つき） |
| 削除済みの一覧（EP-5-25） | 404 → 403（同上）→ `perm.case.view` → 読み取り（資格つき） |
| 復元（EP-5-26） | 404 → 403（「参加者だけが操作できます」）→ `perm.case.todo.edit` → TODO がない・ほかの案件（404）→ 終了中（409 `closed`）→ 削除されていない：**何も書かずに 200**（いまの項目と進捗）→ batch |

- 履歴は、最初に`findTodoWriteFacts`で門（404・403）と TODO の有無を判定する。この読み取りは、操作者が有効な参加者のときだけ TODO を読むので、**非参加者（全体管理者・オーナーを含む）には、TODO の有無・題名・担当の名前が漏れない**（403 が先）
- 終了中も履歴・削除済みの一覧は 200（5-4 AC-9 の「終了後の TODO の閲覧は 5-1 AC-2 の範囲で認める」）。復元だけ 409 `closed`
- 並び：履歴は古い順（記録の ID の昇順）、削除済みの一覧は追加した順（TODO の ID の昇順）。どちらも 100 件ずつの「さらに表示」。カーソルの書き方は`listTodos`と同じ
- 応答：履歴の項目は`id`・`kind`・`createdAt`・`actor`・`title`・`previousTitle`・`assignee`・`previousAssignee`、削除済みの一覧の項目は一覧（EP-5-13）の項目に`deletedAt`・`deletedBy`を足した形（進捗は返さない）、復元は編集と同じ形の項目と`progress`
- 名前の出どころ：記録の担当・前の担当は**記録した名前**（C-74）と、本人のいまの`isActive`。操作した人（`actor`）・削除した人（`deletedBy`）は、記録・表に名前の列がないので、**いまの表示名**と`isActive`（画面は`isActive: false`に「（退職者）」を付け、プロフィール・DM の導線を出さない）
- 後から参加した人にも、参加の前の記録を全部見せる（5-4 AC-10。閲覧の資格は一覧と同じ「その案件の有効な参加者」）

### 読み取り（資格を SQL に入れる）

- `listTodoEvents`・`listDeletedTodos`は、`listTodos`と同じ型：1つの`db.batch`で、案件の行と資格（`caseVisibleRow`）と中身を読む。**中身の読み取りの SQL にも資格（`visibleTo`）を入れる**ので、認可の後に参加を外された・無効化された場合も、中身は 0 行になる。Repository は、案件がなければ`"not_found"`、資格がなければ中身を捨てて`"not_visible"`を返し、Service が 404・403 にする（`visiblePage`）
- 履歴は、記録の表を`case_id`と`todo_id`で絞る（計画にあった`case_todos`との結合は省いた。記録の表が`case_id`を持つため）。ほかの TODO・ほかの案件の記録は混ざらない。操作した人・担当・前の担当で`users`を 3 回結合するので、選択項目に別名を付ける
- 削除済みの一覧は、項目の読み取りに`deleted_at IS NOT NULL`と、削除した人の`users`の結合（別名）を足したもの（`itemColumns`を共用）。変換は`toItem`を使い回す
- 取得の 1 ページは`limit + 1`件を読み、余った 1 件で`nextCursor`を決める（`toPage`）。実行計画のテストで、記録の読み取りが`case_todo_events_todo_id_id_idx`を、削除済みの一覧が`case_todos_case_id_id_idx`を使い、全件の走査をしないことを確かめた

### 復元の書き込み（`restoreTodo`・`buildRestoreTodoStatements`）

149-A の型（前提 → 記録 → 件数の確認 → 更新 → 件数の確認）。文の並びは次のとおり（件数の確認を含む）。

1. 前提（`assertStatement`）：案件が進行中・操作者が有効な参加者・TODO がその案件の**削除済み**・記録の ID の新しさ（`eventIdsFreshSql`。最初の ID で確かめる。後の ID はそれより大きい）
2. 記録`auto_unassign`：復元の時点で「未完了で、担当がいま有効な参加者でない」ときだけ（`assignee_id`＝外れた人、`assignee_name`＝`recorded_assignee_name`、操作した人＝復元した人）
3. 件数の確認：2 の条件のとき 1 件、でなければ 0 件
4. 記録`restore`（その時点の題名。操作した人・日時）
5. 件数の確認（1 件）
6. TODO の更新：`deleted_at`・`deleted_by`を NULL に、版に 1 を足し、2 の条件のときだけ`assignee_id`を NULL にする。**担当した時点の人と名前（`recorded_assignee_*`）・完了の列・題名・`is_done`は変えない**（「以前の担当」が出る）
7. 件数の確認（1 件）→ 項目と進捗の読み取り

- 2 の条件は`assigneeGoneSql`（完了の取り消しと同じ定義）に`is_done = 0`を足したもの。**batch の時点の状態で決める**ので、読んだ後に担当者が参加者から外れても、担当なし＋`auto_unassign`になる
- 更新の後は前提（削除済み）が偽になるが、7 の確認・読み取りは前提を見ないので崩れない（149-D の知見と同じ）
- 記録の ID は 2 つ（`auto_unassign` < `restore`）。Service が`ulidAfter`で昇順に用意する
- 復元した TODO は ID で並ぶので、通常の一覧の元の位置に戻る。一覧・進捗・概要の進捗・終了の確認の警告（未完了の件数）に再び入る
- 復元は版を送らない。復元の後は版が 1 進むので、削除の前の画面の版での編集は 409 `todo_changed`

### 復元のときの担当の扱い（5-4 AC-13。決定 U2）

| TODO の状態 | 復元の結果 |
| --- | --- |
| 未完了で、担当がいま有効な参加者 | 担当を残す。`auto_unassign`は残さない |
| 未完了で、担当が参加者から外れている・無効 | 担当なし（`recorded_assignee_*`は残り、「以前の担当」として出る）。記録`auto_unassign`を残す |
| 完了済み | 担当・完了の列は変えない（完了時の担当名・完了の記録を維持）。`auto_unassign`なし |
| 担当なし | 担当なしのまま |

- 削除している間に担当者が一度外れて、もう一度参加していても、**復元の時点で有効な参加者なら担当を残す**（利用者の決定。5-4 AC-13 の原文「現在も有効な参加者の場合だけ戻す」のとおり）。削除していない TODO は「再び参加しても戻らない」（C-197(5)）ので、扱いが分かれる。外れた記録を持たないので、削除済みの TODO には 149-D の書き換えを当てない（`unassignTargetSql`が`deleted_at IS NULL`）

### 判定とやり直し（Service）

- `decideRestore`は、判定の材料（`TodoWriteFacts`）だけを見る純粋関数。順は、TODO なし（404）→ 終了中（409 `closed`）→ 削除されていない（`{ result }`＝いまの項目と進捗）→ 削除済み・進行中（`null`＝書き込みに進む）
- batch が取り消されたら（`CaseStateChangedError`）、`writeWithRetry`が最初と同じ判定（`decideWriteGate ?? decideRestore`）で読み直す：理由（404・403・409）に当たればそれを返し、すでに復元済みなら 200（いまの項目）、どれでもなければ ID の逆転とみなし、記録の表の全体の最大（`maxEventIdOverall`）より大きい ID を 2 つ作り直してやり直す。試行は最初の 1 回＋やり直し`MAX_ID_RETRIES`（3）回の合計 4 回。上限を超えたら`logger.warn`と 503（`BUSY_MESSAGE`。成功にしない）

### 同時の操作

| 組み合わせ | 結果 |
| --- | --- |
| 2人が同時に復元 | 先が確定。後は前提（削除済み）が崩れ、読み直しで「復元済み」→ 何も書かずに 200。記録`restore`は 1 件 |
| 復元の判定の後に案件が終了 | 前提が崩れ、読み直しで 409 `closed`。記録も更新も残らない |
| 復元の判定の後に、担当者が参加者から削除 | batch の時点で判定するので、担当なし＋`auto_unassign` 1 件 |
| 復元の判定の後に、操作者が参加者から削除 | 前提が崩れ、読み直しで 403。何も残らない |
| 判定の後に、別の TODO の記録が確定し、全体の最大が最初の ID 以上になる | 前提が崩れ → 理由なし → ID を作り直してやり直す |
| 復元が確定 → 別の人が削除 → 遅れて届いた復元 | 前提どおり削除済みなので、もう一度復元される（版を送らないことの帰結。記録`restore`は 2 回分） |
| 履歴・削除済みの一覧の読み取りと、閲覧者の削除・無効化 | 資格の条件で 0 行・`not_visible`で 403（認可の後に確定しても漏れない） |

### 画面（S-17）

- 行の「履歴」（`aria-expanded`・`aria-label`「{題名}の履歴」）で、行の中に履歴を開く（詳細画面は作らない。5-4 AC-14）。**開いている間だけ**取得し、2 秒ごとに取り直す（5-4 AC-7）。閉じたら取らない。通常の一覧からその TODO が消えたら（ほかの人が削除）、行の部品の中にあるので、開いていた履歴も一緒に消える（許容。削除済みの一覧からは同じ履歴を開ける）
- 区画の一覧の下の「削除済みのTODO」（`aria-expanded`）を開いたときだけ取得する（2 秒ごとに取り直し）。0 件は「削除済みのTODOはありません」。行は読み取り専用で、編集・削除・完了の操作を出さない。進行中の案件だけ「復元」（`aria-label`「{題名}を復元」）を出す。終了中は出さない（表示の制御。認可はサーバー）
- 復元は、送信中は区画のすべての書き込み（追加・完了・取り消し・編集・削除・復元）を止める（履歴の開閉は止めない）。成功は「TODOを復元しました」、失敗（409 `closed`・404・503 など）は区画の結果の欄（`role="alert"`）に`describeError`の文言を出す。結果の表示は区画が持つ（取り直しで行が消えても残す）
- 削除の確認の本文の後ろに「削除したTODOは、削除済みの一覧から復元できます。」を出す
- 利用者が替わったときは、キーに利用者の ID があるので前の利用者の履歴・削除済みの一覧は出ない。開閉の状態は区画の部品の状態なので、切り替えで区画が描き直されて閉じる（#284）

### 資格を失ったときの後片付け（#308 の延長）

- `useCaseAccessLoss`が見張るキーに、削除済みの一覧（`deletedTodos`）と履歴（`caseTodoEvents`。案件までの前方一致）を足した。これらの取得が 403・404 になると、概要を取り直して決める（既存の流れ）
- `forgetCaseContent`が取り除くキーに、削除済みの一覧（exact）と履歴（案件までの前方一致。ほかの案件の履歴は残す）を足した
- 参加者でなくなった後（履歴・削除済みの一覧の部品が外れた後）に、`forgetCaseContent`で取り除き直す（以前の専用の関数`forgetTodoHistory`は、使う場所がなくなったので消した。#323）。片付けと、概要の更新が画面に届くまでの間に、開いていた部品が描き直されて、取り除いたキーが作り直されることがあるため
- 後追いの確認は Issue #323 で解消した（下の「資格を失ったときの画面の切り替え（#308）」の 3）

### テストの場所（149-C）

- DB：`backend/src/db/case-todo.repository.history.db.test.ts`（履歴・削除済みの一覧の並び・ページ・資格・混ざらないこと・終了中でも読めること、復元の各状態・前提を 1 つずつ崩す・件数の確認・記録の ID・監査ログが増えないこと）、`backend/src/db/case-todo.explain.db.test.ts`（実行計画）
- 判定・Service：`backend/src/services/case-todo.edit.decide.test.ts`（`decideRestore`）、`case-todo.restore.service.test.ts`（拒否のとき書き込みを呼ばないこと・読み直し・やり直しと 503）、`case-todo.restore.interleave.test.ts`（batch の直前に状態が変わる割り込み）
- route・契約：`backend/src/routes/case-todos.history.test.ts`（判定の順・存在の非開示・終了中・`no-store`）、`backend/src/openapi.case-todos.test.ts`（3 操作の契約）
- 画面：`frontend/src/pages/CaseTodos.history.test.tsx`（履歴・削除済みの一覧・復元・終了中・資格の喪失・取り直し・削除の確認）、`CaseCloseTodoWarning.test.tsx`（復元した TODO が終了の警告に入ること）、`CaseTodos.session-switch.test.tsx`（利用者の切り替え）、`frontend/src/features/cases/hooks/useCaseWrites.forget.test.ts`（取り除くキーの exact・前方一致）。MSW は`frontend/src/test/case-todo-handlers.ts`
- E2E：`e2e/case-todos-history.spec.ts`（1 件。担当の変更と完了が履歴に出る → 削除すると通常の一覧と進捗から消え、削除済みの一覧と履歴に出る → 復元すると通常の一覧と進捗に戻り、別の参加者の画面にも再読み込みなしで 3 秒以内に出る。シードは`e2e/seeds/case-todos-history.sql`、後始末は`e2e/seeds/case-todos-history-cleanup.sql`。[e2e.md](../testing/e2e.md)）

### 設計の判断（知見）

- **資格は、読み取りの SQL にも入れる**：門（404・403）の後に参加を外された・無効化された場合でも、履歴・削除済みの題名・担当の名前を漏らさないため（`listTodos`と同じ型。資格の判定と読み取りを同じ batch で行う）
- **復元は版を送らない・すでに復元済みなら 200**：復元は、削除済みの TODO だけが対象で、2 人が同時に押しても結果は同じ。版の不一致を理由に失敗させない（149-B の削除と同じ考え方）。代わりに「復元 → 削除 → 遅れた復元」はもう一度復元される
- **担当は、復元の時点で判定する（U2＝A）**：5-4 AC-13 の原文に合わせ、参加の履歴は読まない。実装が単純で、`assigneeGoneSql`を完了の取り消しと共用できる
- **同じ意味の判定・読み取りは 1 か所にまとめる**：`assigneeGoneSql`（完了の取り消し・復元）、`caseVisibleRow`・`viewGate`・`visiblePage`（一覧・履歴・削除済みの一覧）、`itemColumns`（通常の一覧・削除済みの一覧）、`CaseTodoPerson.tsx`（行・履歴・削除済みの一覧）
- **履歴・削除済みの一覧は、開いている間だけ取り直す**：要求の数を抑えつつ、他の参加者の操作を再読み込みなしで出す（5-4 AC-7）

## 150-A の設計（案件の終了・再開）

決定は[C-189](../requirements/decision-register.md)。要件は 5-1 AC-8・AC-9・AC-10（直接再開）・AC-11（終了の操作）・AC-13（終了・再開の監査と通知。再選定の結果は 150-B）、3-3 AC-1〜AC-3（再選定なしの宛先）、C-142(2)。**migration はない**（終了の日時の列は足さない。「いつ」は監査ログの記録の日時が満たす）。再開は**いまの参加者のまま**進行中に戻す（利用者の決定。参加者の選び直しは 150-B）。【150-B で、再開は本文つきの選び直しに変わった。再開についてここに書いた記述のうち、変わったところには「150-B で変更」と添え、変更後の内容は「150-B の設計」の節に書く】コードは書き写さず、ファイル名・関数名で指す。

### ファイルと役割

バックエンド：

| ファイル | 役割 |
| --- | --- |
| `backend/src/routes/cases.ts` | `POST /:caseId/close`・`POST /:caseId/reopen`。パスの形（ULID）の確認と応答だけ。終了は本文を持たない（送られても読まない）。全応答に`noStore`。【150-B で変更】再開は本文の外枠（オブジェクト）だけを検証して Service に渡す |
| `backend/src/services/case.service.ts` | `close`・`reopen`（共通の内部関数`changeStatus`。【150-B で変更】再開は`changeStatus`から外し、本文つきの`reopen`にした）。判定の関数`decideClose`・`decideReopen`で、最初の判定と読み直しを同じ順で行う（再開の`decideReopen`は、150-B の`decideReopenReselect`の前半〔404 → 403 → 状態〕として使う）。`CaseConflictReason`に`already_closed`・`already_active`・`stale`・`retry`を足した。`retry`の文言は、チャンネルの管理の既存の定数（`channel-manage.service.ts`の`RETRY_CONFLICT_MESSAGE`）を export して使う（2か所に同じ文を書かない） |
| `backend/src/db/case.repository.ts` | `closeCase`・`reopenCase`（終了は内部の`changeStatus`。1回の`db.batch`。【150-B で変更】`reopenCase`は選び直しつきの入力`CaseReopenWriteInput`を受ける別の経路）、通知の宛先を読む`listCaseNotifyRecipients`（案件のチャンネルの有効な参加者から操作者を除く）。`findWriteFacts`が`version`も返す |
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
| 再開（EP-5-12）`POST /api/cases/:caseId/reopen` | 同じ順。状態は、すでに進行中なら 409 `already_active`「この案件はすでに進行中です」。200で`{ caseId, status: "active" }`。【150-B で変更】本文が必須になり、判定が増えた（「150-B の設計」の「API と判定の順」） |

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
| 再編集（150-C） | 進める | 参加者は版の一致で検出。参加していない管理者は版を見ず、件名・取引先・担当部署の集合の一致（`expected`）で検出（下の「150-C の設計」） |
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
| 確認のダイアログ | 既存の`CaseConfirmDialog`。終了：見出し「案件の終了」、本文「終了すると、メッセージ・参加者・納期は読み取り専用になります。参加者は、いつでも再開できます。」、確定「終了する」。再開：見出し「案件の再開」、確定「再開する」（【150-B で変更】再開は`CaseConfirmDialog`ではなく`CaseReopenDialog`。本文は「再開すると、いまの参加者のまま進行中に戻ります。」から、選び直しの共有の文言に変わった。下の「150-B の設計」）。送信中は確定もキャンセルも押せない（二重送信しない）。開閉は`CaseDetailView`（ページの側）で持つ |
| 結果の表示 | 成功は「案件を終了しました」「案件を再開しました」、失敗（403・404・409）はサーバーの文言。**ダイアログの外**に出す（取り直しでボタンが入れ替わっても残る） |
| 409 のとき | ダイアログを閉じる（状態が変わっているので、同じ確認を出し続けない）。送った後は結果によらず閉じ、案件を取り直して、いまの状態のボタンに替わる |
| 未完了の TODO の警告（#309。C-193） | 終了の確認（`CaseConfirmDialog`の任意の`notice`）の本文の後に、`role="status"`で「未完了の TODO が n 件あります」（文言は`labels.ts`の`closeTodoWarning`）を出す。出し分けと件数は`CaseDetailView`の`CloseTodoWarning`が決める。件数は、TODO の一覧の取得の結果の進捗（総数 − 完了）から出し、画面の行は数えない（「さらに表示」で読み込んだ分に左右されない）。未完了が0件・TODO がない・読み込み中・取得の失敗のときは出さない。開いている間に進捗が変われば、最新の件数に変わる。再開の確認には出さない。警告を出しても終了はできる。サーバーの終了の判定・要求は変えていない。テストは`frontend/src/pages/CaseCloseTodoWarning.test.tsx` |
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

## 150-B の設計（再開のときの参加者の選び直し）

決定は[C-194](../requirements/decision-register.md)。要件は 5-1 AC-16・AC-13（再選定の結果の監査）、3-3 AC-2・AC-3（再選定の後の宛先・個別通知なし）、S-17、EP-5-12。**migration はない**（新しい表・列はなく、既存の参加の行〔`channel_members`〕の追加・削除と、`cases`・`audit_logs`・`notifications`への書き込みだけ）。150-A の再開（いまの参加者のまま）は、追加・除外が空の選び直しとして、同じ経路に統合した。コードは書き写さず、ファイル名・関数名で指す。

### 再開の本文

`participantIds`・`addUserIds`・`removeUserIds`の3つの配列（余分な項目は 422。3つとも必須）。

- `participantIds`：確認の画面で見た「いまの有効な参加者」（本人を含む）。サーバーはいまの有効な参加者の集合と比べ、違えば 409 `participants_changed`。**上限は置かない**（上限を置くと、追加で上限を超えた案件が次に再開できなくなる。参加者を追加する既存の経路にも人数の上限はない。SQL へは JSON の値1つで渡すので、1文の束縛値の数は人数に比例しない）
- `addUserIds`・`removeUserIds`：各100人まで（定数`REOPEN_ADD_LIMIT`・`REOPEN_REMOVE_LIMIT`は`case.service.ts`の1か所。OpenAPI の`maxItems`と`backend/src/openapi.case-close.test.ts`で一致を確かめる）
- 形の決まり（`case.service.ts`の`reopenBodySchema`）：各要素は ULID。配列の中の重複は 422。`removeUserIds`は`participantIds`に含まれる人だけ。`addUserIds`は`participantIds`・`removeUserIds`と重ならない

### ファイルと役割（150-B で足した・変えたもの）

| ファイル | 役割 |
| --- | --- |
| `backend/src/routes/cases.ts` | 再開のルートが本文（外枠）を受けて Service に渡す。項目の形の検証は、403 までの判定の後に Service で行う（存在・状態を漏らさないため。147-B の追加と同じ形） |
| `backend/src/services/case.service.ts` | `reopenBodySchema`・上限の定数・`decideReopenReselect`（export。純粋関数。最初の判定と読み直しで同じ順）・本文つきの`reopen`。`CaseConflictReason`に`participants_changed`を足し、文言を定義した。再開は`STATUS_OPERATIONS`から外した（終了だけが残る） |
| `backend/src/db/case.repository.ts` | `findReopenFacts`（判定の材料を1つの`db.batch`で読む）、`CaseReopenWriteInput`（どの項目も省略できない）、`buildReopenStatements`（batch の文の配列を組む。export）、`reopenCase`（それを`db.batch`で実行）、`guardChanges`（`case-todo.repository.ts`から移し、export。149-A のテストが通ることを確かめた）、`atLeastOneActive`（`removeParticipant`と共用） |
| `backend/src/db/channel-member.sql.ts` | `activeMembersEqual`（有効な参加者の集合が、画面で見た集合と同じであること。`recipientsUnchanged`の隣） |
| `backend/src/db/audit-log.repository.ts` | `auditLogInsertRows`（同じ操作者・対象の監査を、複数行、1文で書く。`auditLogInsertWithDetailSql`の隣で、列の順の知識を1か所に保つ） |
| `docs/api/openapi.json` | EP-5-12 の requestBody（`CaseReopenBody`）・422・409 の理由。説明の文は実装の判定の順 |
| `frontend/src/features/cases/api/case-api.ts` | `reopenCase(caseId, body)`・`CaseReopenBody` |
| `frontend/src/features/cases/hooks/useCaseWrites.ts` | `useCaseStatusChange`の引数が、終了か、本文つきの再開か。取り直しは150-A と同じ（案件・部屋のメッセージ・スレッドの前方一致） |
| `frontend/src/features/cases/components/CaseReopenDialog.tsx` | 新規。再開の2段階のダイアログ（下の「画面」）。詳細の取得中・失敗の表示と「再試行」も持つ（#316。`loading`・`loadError`・`onRetry`）。取り直しの間も部品は作り直さず、選びかけた内容を保つ |
| `frontend/src/features/cases/components/CaseDetailView.tsx` | 再開でだけ`CaseReopenDialog`を使う。開閉・結果・422 の振り分けはページの側。終了は`CaseConfirmDialog`のまま。詳細の取得の状態`reopenLoadState`（`loading`・`loadError`）と、詳細の取り直し（`onRetry`）を渡す（#316） |
| `frontend/src/features/cases/labels.ts` | `CASE_REOPEN_TEXTS`（ダイアログの見出し・理由・ボタン・「再試行」の文言）。`CASE_STATUS_CHANGE_TEXTS.reopen.body`を共有の文言に変えた |

### API と判定の順

404（案件がない）→ 403（有効な参加者でない。状態・参加者を漏らさない）→ `authorize(perm.case.close)`（150-A と同じ位置）→ 本文の形（422）→ 409 `already_active` → 409 `participants_changed`（「参加者がほかの操作で変わりました。画面を確かめてから、もう一度操作してください」）→ 422（本人を外す。`fields: ["removeUserIds"]`「再開する本人は外せません」）→ 409 `auto_participant`（外す人に自動参加の人がいる。`autoRoleOf`と同じ規則。既存の文言）→ 422（追加の社員がいない・無効。`fields: ["addUserIds"]`。ない・無効を同じ文にする。147-B と同じ）→ 409 `already_participant`（追加の社員が参加の行を持つ。無効な人の行も含む）→ batch。200で`{ caseId, status: "active" }`（150-A と同じ）。再認証は求めない（C-81）。

- 判定は`decideReopenReselect(facts, body, actorId)`の1つ。最初の判定と、前提が崩れた後の読み直しで同じ関数を使う
- 選び直しなし（追加・除外が空）も同じ経路。有効な参加者がいまと違えば`participants_changed`になる（150-A の「本文なし」の呼び出しは、この形に直した）
- Service の流れは 150-A の終了と同じ：材料を読む（版は最初の値を使い続ける）→ 判定 → 宛先を読む → 書く。`CaseStateChangedError`なら読み直して同じ判定を行い、どれかに当たればそれを返す。版だけが違えば 409 `stale`、どれにも当たらなければ1回だけやり直し、それでも崩れたら 409 `retry`
- 通知の宛先は、読んだ宛先（有効な参加者から本人を除く）から外す人を除き、追加の人を足したもの（3-3 AC-2）

### 書き込みと前提（`buildReopenStatements`が組む1回の`db.batch`）

文の順は次のとおり。文の数は人数に比例しない（150-B の時点で最大15文、149-D の4文を足して最大19文。人ごとの監査を1文にまとめ、ID の集合は JSON の値1つ＋`json_each`で渡すため）。

| 順 | 文 | 件数の確認 |
| --- | --- | --- |
| 1 | 前提の確認`assertStatement`（案件・状態が終了中・版が読んだ値・操作者が有効な参加者・`recipientsUnchanged`・`activeMembersEqual`・追加の全員が有効で参加の行がない・外す全員が行を持ち、本人でなく、自動参加でない） | — |
| 2 | 再開の監査`case.reopen`（`detail`は`caseId`・`notifiedCount`・`addedCount`・`removedCount`。平坦で氏名を入れない） | `guardChanges(1)` |
| 3 | 人ごとの監査を1文（`auditLogInsertRows`。`case.participant.add`・`case.participant.remove`。`detail`は`caseId`・`userId`・`viaReopen: true`、外すときは`self: false`も。真偽値は JSON の真偽値で保存する）。追加・除外が0人なら入れない | `guardChanges(追加の数＋除外の数)` |
| 3.5 | **外す人が担当の TODO の担当の書き換え（149-D。4文）**：記録`auto_unassign` → 確認 → 担当の UPDATE → 確認。外す人が 0 人でも置き、件数 0 で通す。条件は規則だけ（`stillClosed`・`condition`を付けない）。先頭の前提 1 に、対象の件数と記録の ID の新しさが加わる | `guardChanges(対象の件数)`×2 |
| 4 | 参加の行の削除（外す人がいるときだけ） | `guardChanges(外す人数)` |
| 5 | 参加の行の追加（追加の人がいるときだけ） | `guardChanges(追加の人数)` |
| 6 | 通知`case.reopened`（宛先がいるときだけ。ID と宛先の組を JSON の値1つで渡す） | `guardChanges(宛先の人数)`、続けて、今回の ID と宛先の組の行がすべてあることの`assertStatement` |
| 7 | 案件の更新（状態を進行中に、版に1を足す。`RETURNING`） | `guardChanges(1)` |
| 8 | 末尾の不変条件`assertStatement`（有効な参加者が1人以上） | — |

- **取り消しの仕組み**：`assertStatement`・`guardChanges`は、条件が偽なら`cases.version`を NULL にして NOT NULL 制約の違反を起こす。D1 の`db.batch`は1つのトランザクションなので、どの確認が失敗しても全体が取り消され、`runWriteBatch`が`CaseStateChangedError`に変える。条件つきの`DELETE`・`INSERT`・`UPDATE`は0行でもエラーにならないため、必須の文の直後に件数を確かめる
- **4〜7の WHERE は「状態が終了中で、版が読んだ値」だけを見る**：4 の削除の後は「有効な参加者の集合が画面で見たまま」が崩れて後ろの文が0行になるため、全部の前提は 1（と 2・3 の`onlyWhen`）で見る。1 を通れば、同じトランザクションの 4〜7 でも前提は保たれる
- 通知の件数の確認は時刻に頼らない（同じ案件・種類・時刻の過去の通知があっても、今回の分だけを識別するため）。`RETURNING`が0行なら`CaseStateChangedError`を投げる処理は、二重の守りとして残してある
- **外す人の TODO の担当の書き換え（5-4 AC-6）は、149-D で、4 の削除の直前に差した**（上の 3.5。150-B 自体は TODO に触れなかった。C-194(8)）。`buildReopenStatements`は、対象の件数と記録の ID を読む必要があるため async になり、`composeReopen`は読んだ plan を受け取る。終了中の案件の TODO を書き換える（無効化と同じ決定）。詳細は「149-D の設計」
- 触れないもの：チャンネル（`channels.deleted_at`）・`channel_archive_events`・無効な人の参加の行（候補に出ないので除外で消えない。行が残る人を追加しようとすると 409 `already_participant`）
- 追加・除外の個別の通知は作らない。追加した人には、宛先に含まれるので再開の通知が届く

### 同時の操作

| 組み合わせ | 結果 |
| --- | --- |
| 同じ再開の2要求 | 先が成り立ち、後は 409 `already_active` |
| 状態が一度変わって戻る | 版の不一致で 409 `stale` |
| 確認の後に、無効化・再有効化・オーナー交代の自動参加（終了中でも起きる） | `activeMembersEqual`・`recipientsUnchanged`が崩れ、読み直しで 409 `participants_changed`（何も残らない） |
| 外す予定の人が、判定の後に全体管理者・担当部署のオーナーになる | 読み直しで 409 `auto_participant` |
| 追加する人が、判定の後に無効化される | 読み直しで 422 |
| 操作者が、判定の後に無効化・外される | 読み直しで 403 |
| 再開と、再開した本人の無効化 | 150-A と同じ（無効化が先なら 403） |

終了中は参加者の追加・削除が 409 `closed`になる（147-B）ので、この変更は再開の中でだけ起きる。

### 画面（S-17。`CaseReopenDialog`）

- 「案件を再開」で開く2段階のダイアログ。開閉・送信・結果は`CaseDetailView`（ページの側）が持つ
- **段階1（参加者を選ぶ）**：候補は、詳細の`participants`のうち有効な人（無効な人は出さない。C-194(1)）。初期はみな残す側。再開する本人と`autoRole`のある人（全体管理者・担当部署のオーナー）はチェックを外せず、理由を添える。社員の検索（`useUserSearch`＋`useSettledValue`。参加者の管理と同じ遅延）の結果から、いまの参加者と追加予定の人を除いて出し、追加・取り消しができる。外す人は「チェックを外した人」で持つので、取り直しで候補が増えても、増えた人は残す側になる
- **段階2（確かめる）**：「残る人」「追加する人」「外れる人」の3つの一覧（0人は「なし」）と共有の文言。「再開する」「戻る」「キャンセル」
- 送る`participantIds`は、ダイアログが表示している候補の ID。送信中は、確定・戻る・キャンセル・チェック・検索・追加の取り消しをすべて無効にする
- 結果：成功は「案件を再開しました」をダイアログの外に出す。409・403・404 は、ダイアログを閉じてサーバーの文言を外に出す（`participants_changed`の後は、取り直した詳細で開き直せば新しい候補になる）。422 はダイアログを閉じず、段階1に戻して、`fields`が`addUserIds`なら社員の検索の欄に、それ以外はダイアログの全体のエラーに出す
- 外された人が画面を開いていた場合は、#308 の仕組み（`useCaseAccessLoss`・`forgetCaseContent`）で非公開の表示に切り替わる。150-B は画面の後片付けを足していない
- **詳細（参加者）が取れていないときの表示（#316）**：詳細の取得の状態は、`CaseDetailView`の`reopenLoadState(detail)`（`{ loading, loadError }`）がダイアログに渡す。`loading`は、詳細の取得中（取り直しを含む）か 403 のとき。`loadError`は、失敗していて取得中でないときの、共通の`describeError`を通した文言。選ぶ・送る欄（段階1・段階2）は、**参加者があり、取得中でなく、失敗していないときだけ**出す。取得中は、古い詳細がキャッシュに残っていても、`role="status"`の「読み込み中です」を出す。失敗は`role="alert"`で文言と「再試行」（`CASE_REOPEN_TEXTS.retry`。詳細の取り直し＝`onRetry`）を出す。どちらの間も「キャンセル」だけが残る。
  - **取り直しの間も、ダイアログの部品は作り直さない**ので、選びかけた内容（外した人・検索・追加に選んだ人・段階）を保つ。取り直しで有効な参加者の一覧が変わっていたら、確認の段階から選ぶ段階に戻す（見ていない一覧で送らせない）。追加に選んだ人のうち、取り直しですでに参加者になっていた人は、追加から外す
  - 詳細の取り直しが起きる契機：ウィンドウに戻ったとき・ネットワークの復帰（react-query の既定）、ほかの操作の後の`invalidateQueries`、「再試行」
  - 403（参加者でなくなった）は、#308 の仕組み（ダイアログを閉じる）に任せる。それまでは読み込み中の扱いにして、古い一覧で選ばせない
  - 以前は、詳細の取得が失敗すると「読み込み中です」のまま止まっていた（解消）

### テストの場所（150-B）

- 単体：`backend/src/services/case-reopen-reselect.decide.test.ts`（`decideReopenReselect`の順と、各判定）
- 割り込み：`backend/src/services/case-reopen-reselect.interleave.test.ts`（材料の読み取りの後に別の操作が入る順を固定する）
- DB：`backend/src/db/case-reopen-reselect.db.test.ts`（前提を1つずつ崩して何も残らないこと、件数の確認〔`buildReopenStatements`の文を1つ差し替えて余分な削除・追加・更新0行・通知の不足を起こす〕、人ごとの監査の対象と`detail`の型、通知の識別、追加・除外100人ずつと参加者500人）。テスト部品は`backend/test/case-reopen-fixtures.ts`
- 結合：`backend/src/routes/cases.reopen-reselect.test.ts`（本文の形・判定の順と存在の非開示・外れた人は見られず足した人は過去が見えること・通知と監査・501人以上の案件）、契約は`backend/src/openapi.case-close.test.ts`
- フロントエンド：`frontend/src/pages/CaseReopenReselect.test.tsx`（候補・外せない人・検索・確かめる段階・送信中・結果の振り分け・詳細の取得中・失敗・再試行・取り直しの後の扱い〔#316〕）、`CaseReopenRemovedViewer.test.tsx`（外された人の画面が切り替わること）、`CaseReopenSessionSwitch.test.tsx`（利用者の切り替え）
- E2E：`e2e/case-reopen-reselect.spec.ts`（1件。A が B を外し C を足して再開 → C に通知・過去のメッセージが見える → B の画面は非公開の表示）。シードは`e2e/seeds/case-reopen-reselect.sql`、後始末は`e2e/seeds/case-reopen-reselect-cleanup.sql`
- 150-A の既存のテストは、本文必須の形に直した（呼び出しの形と文言）。業務の期待を変えたのは1か所：`backend/src/services/case-close.interleave.test.ts`の「再開と、参加者の追加」が、「宛先を読み直して成功」から 409 `participants_changed`（要求の側の状態・参加の行・監査・通知が増えない）に変わった（C-194(7)）

### 設計の判断（知見）

- 再開の判定と書き込みは、既存の`changeStatus`に条件を足す形にせず、本文つきの別の経路にした（前提・文の数・件数の確認が終了と大きく違うため）。終了の経路は変えていない
- 件数の確認の仕組み（`guardChanges`）は、149-A と2か所に書かず、案件の書き込みの共通の場所（`case.repository.ts`）に移して共用した
- 人ごとの監査を1文にまとめた理由：人数に比例して文・束縛値が増えると、D1 の1文・batch の上限に近づくため（ADR-0005 の JSON を1つの束縛値で渡す方式）。1文にしても、件数の確認だけでは対象の取り違えを検出できないので、DB のテストが、監査の`(action, detail.userId)`の集合を、実際の参加者の差分と突き合わせる
- 真偽値（`viaReopen`・`self`）は、SQL の`json_object`に数値で渡すと JSON の数値になり、既存の監査（`JSON.stringify`で真偽値）と型が食い違う。JSON の真偽値として保存し、テストで型を確かめる
- D1 の1つの batch の文の数・1回の呼び出しの問い合わせの数の上限の値は、`docs/`にも調査にも根拠がなく**未確認**。文の数を人数によらず最大15にしたことで、150-A（最大4文）・147-B と同じ桁に収めた。手元のテスト（Miniflare）が確かめるのは「上限の人数で動くこと」だけで、本番の D1 の上限に収まることの証明ではない

## 150-C の設計（案件の内容の再編集）

決定は[C-199](../requirements/decision-register.md)。要件は 5-1 AC-20、C-122(3)〜(6)・C-124・C-129・C-130・C-133(2)(3)・C-140(3)(4)、S-17、EP-5-20。**migration はない**（`cases`の列と`case_departments`は既にある）。変えられるのは件名・説明・取引先・担当部署で、案件番号と取引先コードは変えない（`case_number`・`number_client_id`に触れない）。**納期は再編集に含めない**（既存の「納期を変更」のまま。送ると 422）。コードは書き写さず、ファイル名・関数名で指す。

### ファイルと役割（150-C で足した・変えたもの）

バックエンド：

| ファイル | 役割 |
| --- | --- |
| `backend/src/routes/cases.ts` | `PATCH /:caseId`。パスの形（ULID）と本文の外枠だけを検証し、Service に渡す。項目の形は、403 までの判定の後に Service で確かめる（存在・状態・説明の有無を漏らさないため。147-B の追加・150-B の再開と同じ形）。応答に`noStore` |
| `backend/src/services/case.service.ts` | `editBodySchema`（`strict`。変える項目と、`version`か`expected`のどちらか1つ）・`decideEdit`（export。最初の判定と読み直しで同じ順。判定の内側を`isStale`・`decideEditTargets`に分けた）・`edit`（判定の順・読み直し・やり直し）・`changedFieldsOf`（いまの値と違う項目だけを選ぶ）。拒否の`logger.audit`の理由は`not_found`・`cannot_edit`・`description_participants_only`（409・422 は、ほかの操作と同じく残さない）。`detail`は、先に読んだ概要を資格の判定にだけ使い、応答は`findDetailExtras`の値をそのまま返す |
| `backend/src/db/case.repository.ts` | `findEditFacts`（判定の材料を1回の`db.batch`で読む）・`buildEditStatements`（export。文の配列と、案件の更新の位置`updateAt`を返す。#155 の155-C で戻り値を`{ statements, updateAt }`に変え、末尾に件名の索引の組を足した）・`editCase`（それを`db.batch`で実行し、`updateAt`の位置の結果を読む）。#155 の155-C で、案件の検索`searchCases`も足した（[search.md](search.md)）。`findDetailExtras`は概要の項目・担当部署・`version`も同じ batch で読む。`selectRows`の取引先の列に別名を付けた（下の「設計の判断」） |
| `backend/src/lib/audit-actions.ts` | 操作`case.edit`を足した（対象の種類`case`は 147-B で足した） |
| `backend/src/routes/case-requests.ts`・`services/case-request.service.ts`・`db/case-request.repository.ts` | 類似件名の確認に任意のクエリ`excludeCaseId`を足した（下の「類似件名」） |
| `docs/api/openapi.json` | EP-5-20 の契約（`CaseEditBody`〔`oneOf`：`version`の枝か`expected`の枝。どちらも`strict`。共通の項目は`CaseEditTitle`・`CaseEditDescription`・`CaseEditClientId`・`CaseEditDepartmentIds`を参照〕・200・403・404・409 の`closed`・`stale`・`retry`・422）、`CaseDetail.version`、監査の操作の列挙、similar-title のクエリ。`CaseSummary`は変えない |

フロントエンド：

| ファイル | 役割 |
| --- | --- |
| `frontend/src/features/cases/components/CaseEditDialog.tsx` | 新規。「内容を編集」のダイアログ。欄は件名（注意の文・類似の警告）・説明（参加者だけ）・取引先・担当部署（チェック）・案件番号（表示だけ）。開いた時点の基準（`CaseEditBasis`）を受け取り、入力の初期値・比べる値・送る衝突の検知の値に使う |
| `frontend/src/features/cases/components/CaseDetailView.tsx` | ボタン「内容を編集」、基準の作成と固定（`editBasisOf`）、開閉・結果の表示（`CaseEditPanel`）。ページの側が持つ |
| `frontend/src/features/cases/schemas/case-edit-form.ts` | 新規。フォームの入力チェック（件名・説明の規則は`shared/case-rules.ts`を参照。担当部署は1件以上） |
| `frontend/src/features/cases/hooks/useCaseWrites.ts`・`api/case-api.ts`・`labels.ts` | `useEditCase`・`editCase`と本文の型`CaseEditBody`・詳細の`version`・文言`CASE_EDIT_TEXTS` |
| `frontend/src/features/case-requests/components/DepartmentCheckboxes.tsx`・`SimilarTitleNotice.tsx` | 新規。申請の画面（`CaseRequestForm.tsx`）にあった部品を、再編集と共用するために別ファイルへ移した（中身は同じ） |
| `frontend/src/features/case-requests/form-parts.ts` | 新規。再編集が使う部品・候補・類似件名の公開の入口。`index.ts`から公開しない理由は「設計の判断」 |
| `frontend/src/features/case-requests/labels.ts` | `TITLE_CAUTION`（件名の欄の注意の文）の定義元をここにした（申請の画面と再編集で共用） |
| `frontend/src/features/case-requests/hooks/useSimilarTitle.ts`・`api/query-keys.ts`・`api/case-request-api.ts` | 任意の`excludeCaseId`・`enabled`を受ける（キャッシュのキーにも含める） |
| `frontend/src/features/audit-logs/action-labels.ts` | 「案件の編集」 |

### 範囲と、使える人

| 項目 | 内容 |
| --- | --- |
| 編集できる人 | 有効な参加者、いずれかの担当部署のオーナー、全体管理者（参加していなくてよい）。権限は`perm.case.edit`（会社の範囲） |
| 説明 | 有効な参加者だけが変えられる。参加していない人が本文に`description`を入れると 403 |
| 状態 | 進行中だけ。終了中は 409 `closed`。**アーカイブ中の禁止（#151）と、審査中の公開申請・再開申請があるときの禁止（C-140(2)。5-5・5-6）は、未実装のため判定にない** |
| 通知 | 出さない（C-124・C-140(3)）。監査ログだけが記録する |
| 再認証・レート制限 | 求めない・作らない（C-81 の趣旨。X-8 が未決定） |

### API と判定の順（EP-5-20）

本文（`strict`）は、変える項目（`title`・`description`・`clientId`・`departmentIds`。送った項目だけ）と、衝突の検知の値を**どちらか1つ**。

- `version`（整数）：有効な参加者が送る。詳細の応答の版
- `expected`：`title`・`clientId`・`departmentIds`（概要で見た値）。参加していない管理者が送る。**有効な参加者が送ると 422**（説明の衝突を版で見るため）

| 順 | 判定 |
| --- | --- |
| 1 | 認証・送信元（`app.ts`）→ パスの形（422） |
| 2 | 案件がない → 404（`logger.audit`） |
| 3 | 有効な参加者でも管理の資格もない → 403「案件を編集できるのは、参加者・担当部署のオーナー・全体管理者だけです」（`logger.audit`） |
| 4 | `authorize(perm.case.edit)` → 403 |
| 5 | 有効な参加者でないのに、本文に`description`か`version`がある → 403「説明を変更できるのは参加者だけです」（`logger.audit`）。本文の形より先に見る。`version`を拒むのは、非参加者に「版が合ったか」を 409 と 200 の違いで答えないため |
| 6 | 本文の形 → 422（件名は整形した後に 1〜100 文字・説明 2000 文字以内・担当部署は 1 件以上で重複なし・`caseNumber`・`dueDate`・未知の項目は`fields`に項目名・`version`と`expected`の両方、またはどちらもない、有効な参加者の`expected`は`fields: ["version"]`） |
| 7 | 終了中 → 409 `closed` |
| 8 | 衝突（`isStale`）：`version`がいまの版と違う、または`expected`がいまの件名・取引先・担当部署の集合と違う → 409 `stale` |
| 9 | 取引先をいまと違う値にするのに、ない・無効 → 422（`fields: ["clientId"]`）。いまと同じ取引先なら、無効でも通す（C-140(4)） |
| 10 | 新しく足す部署に、ない・無効なものがある → 422（`fields: ["departmentIds"]`）。すでに担当の無効な部署は残せる（Q1＝A） |
| 11 | 変える項目がない（いまの値と同じ）→ 何も書かずに 200。版・監査を変えない |
| 12 | batch |

- 取引先・部署の「ない」と「無効」は同じ本文にする（`fields`だけが違う。存在・状態を本文の違いで明かさない）
- 応答は 200 で`{ caseId, titleFormatted }`だけ（説明・版を返さない。画面は取り直す）。`titleFormatted`は、件名を送り、整形で値が変わったときだけ真
- 判定は`decideEdit(facts, body, actorId)`の1つ（材料の資格の値だけで決まる）。最初の判定と、前提が崩れた後の読み直しで同じ関数を使う

### 版の方式と`expected`の方式

| 項目 | 版の方式（有効な参加者） | `expected`の方式（参加していない管理者） |
| --- | --- | --- |
| 送る値 | 詳細の`version` | 概要で見た`title`・`clientId`・`departmentIds` |
| 先頭の前提 | 進行中・版が送った値のまま・有効な参加者・担当部署の集合が読んだまま（変える項目によらず確かめる）・各変更の条件 | 進行中・件名・取引先・担当部署の集合が`expected`のまま・管理の資格・説明を含まない・各変更の条件 |
| 後ろの文 | 案件の ID と進行中だけ | 同じ |
| 版の扱い | 一致を求め、更新で**現在の値から**+1 | 見ない。更新で現在の値から+1 |
| 説明・納期だけの同時の変更 | 版が進むので 409 `stale`（相手の説明を上書きしない） | 衝突にしない。編集は成功し、相手の説明・納期は残る（指定した列だけを書くため） |
| 公開項目（件名・取引先・担当部署）の同時の変更 | 409 `stale` | 409 `stale` |
| 監査の前の値 | 版で、読んだ値のままと確かめ済み | `expected`で、読んだ値のままと確かめ済み |

**概要・一覧に版を返さない理由**：概要・一覧は全社員が読める。版は説明だけの更新でも進むので、返すと、説明を読めない人にも説明が更新されたかどうかが分かる。そこで、版を返すのは**詳細（有効な参加者だけが取れる）**に限り、参加していない管理者は、見えている件名・取引先・担当部署の集合との一致で衝突を見る（利用者の決定。Q3＝C）。この方式の違いは、参加していない管理者どうしで納期だけが変わっても衝突にしないこと（変える項目と関係がない）。

### 詳細の応答を1つの時点にそろえる

以前の`detail`は、概要（`findSummary`）を読み、資格を確かめた後に、説明・参加者（`findDetailExtras`）を別に読んで合わせていた。間に件名が変わると、古い件名と新しい版が1つの応答に混ざり、画面がそれを基準に編集して正しい衝突の検知ができなくなる。そこで、`findDetailExtras`の`db.batch`が、概要の行（`selectRows`）・担当部署・説明・`version`・参加者・役割を**同じ読み取りの時点**で読み、Service は、先に読んだ概要を 404・403 と`authorize`の判定にだけ使い、応答には`findDetailExtras`の値を使う。応答の形は、足した`version`を除いて変わらない。判定の順（404 → 403 → `perm.case.view`）と、非参加者が 403 になることも変えていない。

### 材料の読み取り（`findEditFacts`）

1回の`db.batch`で、案件の行（状態・版・件名・説明・取引先・操作者が有効な参加者か・管理の資格）・いまの取引先と求めた取引先（コード・名前・有効か）・いまの担当部署の集合・求めた部署の有無と有効か・自動参加させる人を読む。求めた部署の ID は JSON の値1つで渡す（部署の数に比例して束縛値を増やさない）。説明はサーバーの中の比較にだけ使い、応答・監査に出さない。

### 書き込み（`buildEditStatements`が組む1回の`db.batch`）

**前提**（`editCondition`。1つの SQL。案件があることも含む）：進行中・衝突の検知（上の表）・操作者の資格（有効な参加者か管理の資格）・説明を変えるなら有効な参加者・取引先を変えるなら新しい取引先が有効・担当部署の集合が読んだまま（版の方式は、変える項目によらず常に確かめる。担当部署の付け替えは版を進めないことがあるため。`expected`の方式は、`expected`の集合で確かめ、担当部署を変えるときは読んだ集合も確かめる）・足す部署が全部あって有効・自動参加させる人の集合が読んだまま。

| 順 | 文 | 件数の確認 |
| --- | --- | --- |
| 1 | 前提の確認`assertStatement` | — |
| 2 | 監査`case.edit`（`auditLogInsert`の`onlyWhen`に前提を渡す。案件がない・前提が崩れていれば0行） | `guardChanges(1)` |
| 3 | 担当部署の削除（外す部署があるときだけ。送った集合にないもの） | `guardChanges(外す数)` |
| 4 | 担当部署の追加（足す部署があるときだけ。ID は JSON の値1つ＋`json_each`） | `guardChanges(足す数)` |
| 5 | 自動参加（`joinUserIds`が1人以上のときだけ。参加の行の挿入） | `guardChanges(人数)` |
| 6 | 案件の更新（**指定した列だけ**＋版を現在の値から+1＋更新日時。`RETURNING`） | `guardChanges(1)` |
| 7 | 末尾の不変条件`assertStatement`（担当部署が1件以上。C-130(1)） | — |
| 8 | 件名の索引の組`syncCaseTitleIndexStatements`（4文。#155 の155-C。件名を変えない再編集でも毎回。[search.md](search.md)の「件名の書き込みの経路」） | — |

- **文の数は最大16**（1＋2＋2＋2＋2＋2＋1＋4。部署・人の数に比例しない。#155 の155-C で、件名の索引の組の4文を足して 12 から改めた。C-202(2) による C-199(9) の置き換え）。D1 の1文の束縛値の上限（100）に収まることは、DB のテストが、生成したすべての文について確かめる
- **後ろの文（3〜6）は、案件の ID と進行中だけを見る**。先頭の前提を通れば、D1 の`db.batch`は1つのトランザクションで、途中に別の要求が割り込まないため前提は保たれる。版の一致を後ろの文で求めないのは、`expected`の方式で、読んだ後に説明・納期だけが変わると後ろの文が0行になり、500 になるため
- **取り消しの仕組みと、案件がないときの扱い**：`assertStatement`・`guardChanges`が偽になると全体が取り消される（150-B と同じ）。案件がないとき、条件つきの更新・削除は0行でエラーにならず、件数の確認も0行で通ってしまうので、`editCase`が、案件の更新の`RETURNING`が0行なら`CaseStateChangedError`にする。読む位置は、`buildEditStatements`が更新の文を積んだ時点で決め、文の配列と一緒に返す（`{ statements, updateAt }`。再開の`composeReopen`と同じ形）。前は末尾からの添字で読んでいたが、155-C で末尾に件名の索引の組を足すと位置がずれ、索引の文の結果を読んで、存在しない案件への再編集を拒否できなくなるため。索引の組は更新の後ろにあり、いまの件名を写すので、拒否された再編集で正しい写しを上書きしない。監査は`onlyWhen`で0行になるので、案件がなくても監査だけが残ることはない
- **触れないもの**：`case_number`・`number_client_id`・チャンネル・通知・外れた部署のオーナーの参加の行（C-133(2)）・`due_date`・`cases.description`（指定しない限り）

### 監査（`case.edit`）

`detail`は平坦で、変えた項目のキーだけを入れる。業務の更新と同じ batch で確定する。

| キー | 入るとき |
| --- | --- |
| `caseId`・`changedFields`（`title`・`description`・`client`・`departments`のうち変えたもの。「,」でつなぐ） | 常に |
| `titleBefore`・`titleAfter` | 件名を変えたとき |
| `descriptionChanged`（真偽値） | 説明を変えたとき。**説明の本文は入れない** |
| `clientIdBefore`・`clientCodeBefore`・`clientNameBefore`・`clientIdAfter`・`clientCodeAfter`・`clientNameAfter` | 取引先を変えたとき（C-129(3)。取引先の名前とコード） |
| `departmentIdsBefore`・`departmentIdsAfter`（ID の昇順を「,」でつなぐ）・`departmentAddedCount`・`departmentRemovedCount`・`caseJoinCount`（自動参加した人数） | 担当部署を変えたとき |

- 自動参加は`case.edit`の1件に含める（人ごとの監査を作らない。147-C-2 の`caseJoinCount`と同じ）
- 前の値は材料で読んだ値。取引先の名前だけは、読んだ後の改名を前提にしないので、読んだ時点の値

### 自動参加（担当部署を足したとき）

足した部署の**有効なオーナー**（担当部署のスコープの役割を持つ有効な社員）で、案件専用チャンネルに参加の行がない人を、同じ batch で参加させる（C-133(3)）。承認のときと同じ規則で、利用者の ID で重複を除く（同じ人が足す2部署を兼任していても1人）。参加させる人の集合は`findEditFacts`が読み、前提で「その集合のまま」を確かめ、挿入の直後に件数を確かめる。外した部署のオーナーは、参加者のまま残る（C-133(2)）。部署を足さなければ、自動参加は起きない。

### 前提が崩れたとき（`edit`の流れ）

1. 材料を読む（本文の`clientId`・`departmentIds`を渡す）→ `decideEdit`の判定 → 変える項目がなければ 200
2. batch。前提が崩れたら（`CaseStateChangedError`）、材料を**読み直して**同じ判定を行い、404・403・409・422 のどれかに当たればそれを返す
3. どれにも当たらず、**読んだ件名・取引先・担当部署の集合が変わっていれば** 409 `stale`（版を進めずに担当部署が付け替えられた場合も含む）
4. それでもなく、自動参加させる人の集合だけが違えば（オーナーの交代など。版は進まない）、読み直した材料で**1回だけ**やり直す。2回目も崩れたら 409 `retry`
5. 上のどれでもなければ、成功にせず元のエラーのまま投げる

### 類似件名（`excludeCaseId`）

`GET /api/case-requests/similar-title`に、任意のクエリ`excludeCaseId`（ULID）を足した。`hasSimilarTitle`の案件の側の文に「その案件自身を除く」条件を足す（審査中の申請の側は変えない）。応答は、これまでどおり真偽と整形後の件名だけ。比べる相手は全社員に見える概要の件名・取引先なので、新しく分かることはない。画面は、件名か取引先が基準と変わったときだけ確かめ、警告は出すが保存は止めない（146-A と同じ）。

### 画面（S-17。`CaseEditDialog`）

| 場所 | 内容 |
| --- | --- |
| ボタン | ヘッダーの下の並び（「納期を変更」「案件を終了／再開」と並べる）に「内容を編集」。出す条件は、進行中で、有効な参加者か`canManage`。表示の制御で、認可はサーバー。参加者は、詳細が取れるまで押せない |
| 開いた時点の固定 | ボタンを押したときに、**1つの応答だけ**から基準を作り、ダイアログに渡す。有効な参加者は**詳細の応答だけ**から（件名・説明・取引先・担当部署・`version`。詳細が1つの時点の値なので混ざらない）、参加していない管理者は**概要の応答だけ**から（件名・取引先・担当部署。これが`expected`。説明の欄は出さない）。ダイアログが開いている間、概要・詳細を取り直しても、入力の初期値・比べる値・送る衝突の検知の値を差し替えない（背景の取り直しで古い入力を新しい版で送らないため。サーバーの値を`useState`に写さない決まりに対する、意図した例外） |
| 送る本文 | 基準と比べて変えた項目と、基準の`version`か`expected`。何も変えていなければ「保存」を押せない |
| 取引先・担当部署の候補 | 有効なものに、基準の無効なもの（取引先・部署）を「（無効）」付きで足す。候補と欄を一度にそろえて出す |
| 結果 | 成功はダイアログを閉じ、外に「案件の内容を保存しました」（件名を整形したら「表記を整えて保存しました」も）。422 は欄（当たる欄がなければダイアログの中）。409・403・404 は、ダイアログを閉じて、サーバーの文言を外に出す（409 `stale`のときは、取り直した画面で開き直してもらう。古い入力を新しい基準で送り直さない） |
| 取り直し | `useEditCase`が、成功しても失敗しても案件（`caseKeys.all`）を取り直し、成功では申請のキャッシュ（`caseRequestKeys.all`。類似件名の確認など）も取り直す |
| 離れる・資格を失う | 入力の途中は`useLeaveGuard`（チャンネルの編集と同じ）。開いたまま外されたときは、#308 の`onLost`でダイアログを閉じ、説明を残さない（概要の取り直しが先に非参加を返す経路でも閉じる。管理の資格が残る人も、いったん閉じる。開き直すと、基準は説明の欄のない`expected`の方式になる）。利用者・案件が替わったときは、`CaseDetailPage`の`key`で作り直し、ダイアログ・入力を持ち越さない（#284） |

### 同時の操作

| 組み合わせ | 結果 |
| --- | --- |
| 読み取りの後に、別の編集・納期の変更・終了して再開（版が進む） | 参加者は 409 `stale` |
| 別の管理者が件名・取引先・担当部署を変える | `expected`の方式は 409 `stale` |
| 納期・説明だけが変わる | `expected`の方式は通る（相手の説明・納期は残り、版は2つ進む）。版の方式は 409 `stale` |
| 版を進めずに担当部署が付け替えられる | 読み直しで、読んだ集合と違うので 409 `stale` |
| 終了 | 読み直しで 409 `closed` |
| 操作者が外される・無効になる・オーナーでなくなる | 読み直しで 403 |
| 取引先・足す部署が無効になる | 読み直しで 422 |
| 足す部署のオーナーが交代する（版は進まない） | 集合を読み直して1回だけやり直し、新しいオーナーが1行だけ参加する。2回続けて変われば 409 `retry` |
| 拒否された要求 | 監査・参加の行・担当部署が残らない |

### テストの場所（150-C）

- 単体：`backend/src/services/case-edit.decide.test.ts`（`decideEdit`の順と各判定）、`case-edit.service.test.ts`（`edit`の本文の形・呼び出し）、`backend/src/lib/audit-actions.case-edit.test.ts`・`frontend/src/features/audit-logs/action-labels.case-edit.test.ts`（操作名・表示名）
- DB：`backend/src/db/case-edit.repository.db.test.ts`（各項目の更新・版+1・番号の不変・監査の`detail`・自動参加〔無効なオーナー・既に参加の人・兼任〕・前提を1つずつ崩して何も残らないこと・`buildEditStatements`の文を差し替えて件数の確認が全体を取り消すこと・存在しない案件で監査が増えないこと・#294 の相関・生成した全文の束縛値が 100 以下で文が12以下・部署120件）。テスト部品は`backend/test/case-edit-fixtures.ts`
- 割り込み：`backend/src/services/case-edit.interleave.test.ts`（材料の読み取りの後に別の操作が入る順を固定する。上の「同時の操作」）、`case-detail.snapshot.test.ts`（詳細の応答が1つの時点にそろうこと）
- 結合：`backend/src/routes/cases.edit.test.ts`（判定の順・存在の非開示・200の形・`noStore`・非参加者の応答が説明の更新の前後で同じこと・通知が増えないこと）、`backend/src/routes/case-requests.similar-exclude.test.ts`（`excludeCaseId`）、契約は`backend/src/openapi.case-edit.test.ts`。既存の`backend/src/routes/cases.test.ts`は、詳細の項目に`version`を足した
- フロントエンド：`frontend/src/pages/CaseEdit.test.tsx`（出し分け・本文・422・409・送信中・離れる前の確認）、`CaseEdit.snapshot.test.tsx`（開いた時点の固定）、`CaseEditAccessLoss.test.tsx`（資格を失ったとき）、`CaseEditSessionSwitch.test.tsx`（利用者の切り替え）。申請の画面の既存のテスト（`CaseRequestPage.test.tsx`）が、部品を移した後も通ることを確かめた
- E2E：`e2e/case-edit.spec.ts`（1件。参加者 A が件名・説明・取引先を変え担当部署 X を足す → 再読み込みなしで見出しが変わる → X のオーナー C のサイドバーに出て詳細が見える〔自動参加〕→ 参加していない担当部署のオーナー B は説明の欄のないダイアログで件名だけ変えられる。[e2e.md](../testing/e2e.md)）。シードは`e2e/seeds/case-edit.sql`、後始末は`e2e/seeds/case-edit-cleanup.sql`

### 設計の判断（知見）

- **版の方式と`expected`の方式を、資格で分けた**：説明の更新が版を進めるので、版を全員に見せると説明の更新の有無が漏れる。参加者には版、参加していない管理者には公開項目の一致で衝突を見せる（migration なしの案。説明を進めない別の版の列を足す案は、migration と「版を進める操作の表」が2つになるため採らなかった）
- **D1 の`db.batch`の中では、同じ名前の列の値が取り違えられることがある**：`findDetailExtras`が、案件の概要の行（取引先の`id`・`name`と、案件の列が同名）を batch に入れたところ、取引先の列の値が取り違えられた。そこで、`selectRows`の取引先の列（`id`・`name`・`isActive`）に**別名**を付けた。決まり：**`db.batch`に入れる読み取りで、結合した表の列が、ほかの表の列と同じ名前になるときは、別名を付ける**。なぜ取り違えが起きるかの原因は未調査（別名で防げることだけをテストで確かめた）。一覧・概要など、`selectRows`を使う既存の読み取りも同じ別名を通る（応答の形は変えない）
- **後ろの文の条件は、案件の ID と進行中だけ**：先頭の前提で版・`expected`・資格・各変更の条件を確かめれば足りる。後ろに版の一致を足すと、`expected`の方式で説明・納期だけが変わった場合に、後ろの文が0行になり 500 になる
- **更新は指定した列だけを書く**：説明・納期など、指定していない列は書かない。`expected`の方式で、相手が読んだ後に変えた説明を上書きしないため
- **監査の`onlyWhen`を使う**：`auditLogInsertWithDetailSql`は条件を付けられないため、案件がないときに監査だけが残る。`detail`は SQL ではなく、読んだ材料から組む
- **`form-parts.ts`を`case-requests/index.ts`と別にした**：`index.ts`は案件の機能（`cases`）を参照する部品を含む。`cases`から`index.ts`を参照すると循環になるため、再編集が使う部品・候補・類似件名だけを`form-parts.ts`から公開した（既存の機能どうしの公開の入口の決まりの範囲で、循環を避ける）
- **`TITLE_CAUTION`の定義元は`case-requests/labels.ts`の1か所**。申請の画面と再編集の両方が参照する
- **D1 の1つの batch の文の数の上限は未確認**（150-B と同じ）。最大12文にして、150-A・150-B と同じ桁に収めた（#155 の155-C で、件名の索引の組を足して最大16文。同じ桁のまま）。手元のテスト（Miniflare）が確かめるのは、120部署・多数のオーナーで動くことと、全文の束縛値が 100 以下であることだけで、本番の D1 の上限の証明ではない

## 資格を失ったときの画面の切り替え（#308）

S-17 を開いたまま、ほかの参加者に外された人の画面が、開き直すまで、既に読み込んだ説明・参加者の一覧を出し続けていた（概要・詳細に自動の更新がなく、やり取りの自動の更新が拒否されても、詳細を取り直す経路がなかった。新しい中身は取得されない）。既存の参加者の削除（#147-B）からあった穴で、#150-B の計画レビューで見つかり、先に直した。決定は C-190。API・DB は変えない（フロントエンドだけ）。

### ファイルと役割

| ファイル | 役割 |
| --- | --- |
| `frontend/src/features/cases/hooks/useCaseAccessLoss.ts` | 新規。資格を失ったことの検出と判定を1か所に持つ部品。部屋のメッセージ（`messageKeys.room`）・TODO の取得・添付の一覧・TODO の履歴と削除済みの一覧（149-C）のエラーを、クエリのキャッシュの購読で見る。概要で参加者でないことが確かめられた状態（`outsider`：成功して非参加、または 404 の失敗）に**なったとき**に、この画面で参加者だったかに関わらず、参加者だけの中身を取り除く（`forgetCaseContent`、一覧は下の2通り。#323・#363）。部品が作られた時点で既に`outsider`の場合も、1回行う（印`previousOutsider`）。案件の一覧は、この画面で参加者だったことを見ていた場合だけ`forgetCaseInLists`で行を直し、見ていない場合は`invalidateCaseLists`で古い印だけを付ける。`onLost`は、この画面で参加者だったことを見た場合（`participantSeen`）だけ呼ぶ。404 の見分け（`isCaseNotFound`）はこのファイルの1か所に置き、確かめの判定とも共有する。確かめの途中に画面を離れた後も、部屋の ID を渡して取り除く。`unverified`（確かめられない状態）と`retry`を返す 【150-C の修正で、概要が参加者から非参加に変わったときも`onLost`を呼ぶようにした。下の「処理の流れ」の 3】 |
| `frontend/src/features/cases/hooks/useCaseWrites.ts` | `forgetCaseContent`（中身〔詳細・TODO・添付の一覧（148-B-1。`caseKeys.attachments`）・TODO の履歴と削除済みの一覧（149-C）・この案件の完了した操作・部屋のメッセージ・スレッド・メンションの候補・チャンネルの詳細・スレッドの一覧と未読の件数のうちこの部屋の分〕の取り消しと取り除き。スレッドは引数`threads`で`"all"`か`"room"`）を足し、`forgetCaseAfterLeave`（概要を非参加に書き換えてから中身を取り除く）を、本人の退出と、この部品の両方から使う。`cachedCaseRoomId`（退出の前に部屋の ID を求める）も足した。添付の一覧のキャッシュも、本人の退出の後片付けと同じ関数を通って取り除かれる。`invalidateCaseLists`（#363）：その利用者の案件の一覧に、行を書き換えず・進行中の取得も取り消さずに、古い印だけを付ける（参加者として見ていない非参加の確かめで使う） |
| `frontend/src/features/cases/hooks/useParticipantWrites.ts` | 退出で、送る前に`cachedCaseRoomId`で部屋の ID を求め、成功したときと、画面を離れるときの`forgetCaseAfterLeave`に渡す（#323） |
| `frontend/src/features/cases/api/query-keys.ts`・`frontend/src/features/messages/api/query-keys.ts` | `caseMutationKeys`（`todoWrite`・`write`）を足した。メンションの候補のキーを`messageKeys.mentionCandidates`・`roomMentionCandidates`に移した（`MentionTextArea.tsx`の直書きをやめた） |
| `frontend/src/features/cases/components/CaseAttachments.tsx` | `caseId`を受け取り、`useChangeAttachmentVisibility(caseId)`を使う（操作の記録を案件で絞るため） |
| `frontend/src/features/cases/components/CaseDetailView.tsx` | 部品を呼び、`isParticipantOf`で概要から参加者かを決め、`isOutsiderOf`（概要が成功して非参加、または 404 で失敗。5xx・通信の失敗は含めない）を引数`outsider`として渡す。確かめられないときは`UnverifiedAlert`（「案件の情報を確かめられませんでした」と「再試行」）を出し、中身を描かない。ダイアログは部品の`onLost`で閉じる |
| `frontend/src/features/cases/components/CaseTodoSection.tsx` | TODO が 403 のときに概要・詳細を取り直す処理（#149-A）を消した（部品に一本化） |
| `frontend/src/features/cases/labels.ts` | 確かめられない表示の文言 |

### 処理の流れ

1. 契機は2種類ある。(a) 拒否を受けて確かめる：部屋のメッセージと TODO の自動の更新が、403 または 404 で失敗する。(b) 概要で参加者でないことが確かめられる：概要が、成功して非参加、または 404 で失敗する状態になる（作られた時点で既にそうでもよい。5xx・通信の失敗は、参加者でない証拠にしないので契機にならない。#363。拒否を契機にする確かめは、概要が既に非参加だと動かないため。150-C の修正で足した。(a) の確かめでも非参加と分かると`onLost`が呼ばれるが、ダイアログを閉じるだけなので、重ねて呼んでも害はない）。(a) では、401（セッション切れ。共通の処理）・5xx・通信の失敗では何もしない（既存の表示とポーリングの続き）
2. 403・404 は、参加者のままでも起こりうる（権限がない等）ので、それだけでは決めず、**概要を取り直した結果**で決める
3. きっかけごとにすること。
   - (b) 概要で参加者でないことが確かめられたとき（#323 で直し、#363 で、5xx・通信の失敗を除き、参加者だったかに依らない契機にした）：`onLost`（ダイアログを閉じ、編集の基準を捨てる。7。この画面で参加者だったことを見た場合だけ）と、`forgetCaseContent(queryClient, userId, caseId, roomId)`による参加者だけの中身のキャッシュの取り除きに加えて、一覧は、この画面で参加者だったことを見ていた場合（`onLost`と同じ条件）だけ、`forgetCaseInLists`で、この案件の行も非参加の形に書き換える（「参加中」の一覧からは行を除く。参加者数の扱いは (a) の`forgetCaseAfterLeave`と同じ）。見ていない場合は、行を書き換えず、`invalidateCaseLists`で、その利用者の案件の一覧に古い印だけを付ける（下の「(b) の判定」）。この効果は、開いていた部品が外れた後に走るので、(a) の片付けの後に部品がキーを作り直した分も、ここで取り除かれる
   - `forgetCaseContent`が取り除くもの（進行中の取得は先に取り消す）：
     - 常に：詳細・TODO の一覧・添付の一覧・TODO の履歴・削除済みの TODO、この案件の**完了した操作**（下の「操作の記録」）
     - 部屋が分かれば、さらに：部屋のメッセージ、メンションの候補（部屋の参加者の名前。キーは`messageKeys.roomMentionCandidates`の前方一致）、チャンネルの詳細（`channelKeys.detail`。参加者の名前を含む）、スレッド（下の「スレッドの取り除き方」）。自分のスレッドの一覧（`threadKeys.list`）は、キーごとは取り除かず、取得を取り消してから**この部屋の行だけ**を除く。未読の件数（`unreadKeys.counts`）も、**この部屋の分だけ**を除く
     - 取り除かないもの：概要・一覧（全員・管理者に見える項目）、ほかの案件・ほかの利用者のキャッシュ（参加者に戻ったら取り直せる）
   - スレッドの取り除き方（5番目の引数`threads`）：スレッドのキー（`["messages","thread",親のID]`）は部屋で絞れない。`"all"`（既定。表示中の後片付け〔(a)・(b)・退出〕）は、前方一致ですべて取り除く（ほかの部屋のスレッドも取り除かれ、開き直すと取り直される）。`"room"`（確かめの途中に画面を離れた後）は、データの`parent.roomId`がこの部屋のものだけを取り除く（移動した先のスレッドを巻き込まない）。データのない、取得の途中のスレッドは残す
   - 操作の記録（MutationCache。「操作の記録」）：案件の操作に、案件で絞れる`mutationKey`を付けた（`caseMutationKeys.todoWrite`＝`["caseTodoWrite", caseId]`、`caseMutationKeys.write`＝`["caseWrite", caseId]`。`api/query-keys.ts`）。操作の応答・変数には TODO の題名・担当者の名前・説明などが残るので、後片付けで、この案件の完了した操作を取り除く。進行中の操作は取り消さない（ADR-0030 と両立）。MutationCache を購読し、完了した時点（成功の後処理の後）で取り除く。ほかの案件の操作は残す
   - 部屋の ID（`roomId`）の求め方：表示中は、呼び出し側（`CaseDetailView.tsx`）が、**詳細**の`channelId`から作る。概要の`channelId`は、非参加者には null なので使わない。非参加に変わった描画でも、詳細のキャッシュ（この効果の前なので残っている）から求まるため、部屋の中身も取り除ける。呼び出し側が概要の`channelId`を使うように変えると、部屋の中身が残る。退出は、送る前に`cachedCaseRoomId`（詳細、なければ概要）で求め、成功したときと、画面を離れるときの後片付けに渡す（後片付けで詳細が先に消えるため）
   - 確かめの途中に画面を離れた場合：非参加・404・確かめられないときも、部屋の ID を渡して、`"room"`で取り除く
   - (a) 拒否を受けて確かめたときの判定：
     - 概要が非参加、または 404：`forgetCaseAfterLeave`／`forgetCaseContent`で中身のキャッシュを取り除き、`onLost`で開いているダイアログを閉じ、非公開の表示にする
     - 概要が参加者のまま：何もしない（取り直さない。要求が増え続けないように）
     - 概要の取り直しが失敗：中身を隠して「再試行」を出す（安全な側に倒す）。部屋・TODO のポーリングは 403・404 で止まるので、「次のポーリングでまた検出する」は成り立たないため、利用者が押す再試行が次の契機になる
   - (b) の判定（#363）：片付け（`forgetCaseContent`・`forgetCaseInLists`）は、引数`outsider`（`CaseDetailView.tsx`の`isOutsiderOf`が決める。概要が成功して非参加、または 404 で失敗のとき真）が、偽から真に**なったとき**に1回行う。部品が作られた時点で既に真なら、それも1回行う（`previousOutsider`は偽から始める）。この画面で参加者だったかには関わらない。理由：「参加者だった記録」を、部品の中やキャッシュの概要から求める形では、離れている間に概要が「成功して非参加」に置き換わった場合や、作り直した時点で既に 404 の場合に取りこぼす（コードレビューの重大な指摘2件）。確かめられた非参加の人のメモリに、参加者だけの中身を残してよい理由はないので、記録に頼らない。概要の取り直しだけが 5xx・通信の失敗になっても、`isParticipant`は偽になるが`outsider`は偽のままなので、片付けず、`participantSeen`も残す（概要の失敗は既存の表示に任せる。入力中の内容も残る）。以前の「参加者から非参加への変化（真 → 偽）」だけを見る判定は、この取り違えを起こしていた。`onLost`は、これまでどおり、`outsider`で、かつこの画面で参加者としての概要を受け取った（`participantSeen`。参加者の概要を受け取ると立ち、`onLost`を呼ぶと下ろす）場合だけ呼ぶ。引数`outsider`を省くと`!isParticipant`と同じ扱いになる（フックを直接呼ぶ既存のテストのため。本番の呼び出しは必ず渡す）
   - 一覧の扱い（#363 のコードレビュー3回目の直し）：`outsider`になったとき、中身（`forgetCaseContent`）は参加者だったかに関わらず消す。案件の一覧は、2通りに分ける。
     - この画面で参加者だったことを見ていた場合（`onLost`と同じ条件）：`forgetCaseInLists`（これまでと同じ。「参加中」の一覧から行を除き、「すべての案件」の行を非参加の形にする。進行中の取得は取り消す）
     - 見ていない場合（画面の作り直しの後・最初から非参加・古い非参加の概要で開いた場合）：行は書き換えず、進行中の取得も取り消さず、`invalidateCaseLists`（`useCaseWrites.ts`）で、その利用者の一覧に、古い（取り直しが要る）印だけを付ける。表示中の一覧は取り直され、表示していない一覧は次に開いたときに取り直される
     - 理由：古い概要（例：参加者に追加された直後の、取り直し前のキャッシュ）を根拠に一覧の行を書き換えると、参加している案件が、一覧から消えたままになる。中身は取り直せば戻るが、一覧の行の書き換えは戻らない
   - 動きが変わった点（#363）：最初から非参加・404 で開いた場合も、その案件・その利用者の、参加者だけの中身のキャッシュを消す（以前は何もしなかった）。案件の一覧は、書き換えず、古い印だけを付ける（表示中の一覧は取り直される）。ほかの案件・ほかの利用者の中身は消さない
   - 既知の限界（#363）：5xx → 画面を離れる → 離れている間に外される → 戻る、の順序では、一覧のキャッシュの行に、参加者だけの値（最終更新・部屋の ID）が、次の一覧の取り直しまで残る。以前は 5xx の時点で誤って片付けていたので、この順序では消えていた（5xx の誤判定を直した裏返し）。メモリに残るものを消しきることは、#339〜#342 の範囲
4. 重ねない印：同じ参加の期間の中で、確かめと後片付けを重ねない。印を外すのは、非参加から参加者に戻ったとき、再試行で参加者が返ったときだけ（詳細の取得の成功では外さない。参加者のままの 403 で循環するため）
5. 本人の退出の後片付けで既に非参加になっているときは、確かめ直さない（退出の既存の動きのまま）
6. 端末に保存した下書きは消さない。切り替わるまでの時間は、自動の更新の1回（2秒）と概要の取り直しの1往復
7. 契機 (b) で`onLost`（`CaseDetailView.tsx`の`closeDialog`）が閉じるもの：開いているダイアログすべて（編集・再開の選び直し・納期の変更・終了の確認・参加者の管理・添付の公開範囲）と、編集の基準（説明・版）。管理の資格が残る人（担当部署のオーナーが参加者から外された場合など）も、いったん閉じる。開き直すと、編集は`expected`の方式（説明の欄なし）になる。本人の退出でも呼ばれる（退出の後は一覧へ移るので、害はない）

### テストの場所（#308）

- 画面：`frontend/src/pages/CaseAccessLoss.test.tsx`（403・404・通信の失敗・5xx、再試行、ダイアログ、キャッシュの取り除き。#363：合わせて 15 件。参加者のまま概要の取り直しだけが 500・通信の失敗なら片付けず、404 なら片付ける〔3件〕。画面を作り直した後の 404・非参加で片付ける（R-1・R-2）、作り直さない場合の 500 の後の 404（R-3）、作り直した後にまた失敗なら片付けない（R-4）、画面を外している間に概要が 404・非参加に置き換わってから戻る（R-6・R-7）、応答が離れてから返る（R-8）、片付いた後の作り直しを重ねても壊れない（R-9）、最初から非参加・404 で開くと、この案件の詳細のキャッシュが消える（R-5・R-5b））、`frontend/src/pages/CaseAccessLoss.lists.test.tsx`（#363 の R-10〜R-14。6件。古い非参加の概要で開いても一覧の行を書き換えず、参加者になれば一覧が正しい／サーバーも非参加なら古い印が付き、ほかの利用者の一覧は印を付けない／この画面で参加者として見た後の喪失では行を直す〔回帰〕／離れている間の 404 でも行は書き換えず印だけ）、`CaseAccessLoss.userSwitch.test.tsx`（利用者の切り替え）
- 取り除きの確認（#323）：`frontend/src/features/cases/hooks/useCaseAccessLoss.forget.test.tsx`（16件。取り除くキー・残すキー、スレッドの2通り、一覧の行）、`useCaseAccessLoss.mutations.test.tsx`（3件。操作の記録の取り除き）、`useCaseAccessLoss.history.test.tsx`（(ii) は #363 で期待を変えた：最初から非参加の描画では、この案件・この利用者の履歴・削除済みの一覧が消え、ほかの案件・ほかの利用者の分は残り、再描画では重ねて消さない）、`frontend/src/features/cases/hooks/useParticipantWrites.leave.test.tsx`（3件。退出の後片付けと部屋の ID）、`frontend/src/pages/CaseCacheAfterAccessLoss.test.tsx`（2件。画面から確かめる。キャッシュの中身を調べる補助が、操作の記録も調べる）
- E2E：`e2e/case-access-loss.spec.ts`（1件。実ブラウザ2つで、外された人の画面が開き直さずに非公開の表示になる。[e2e.md](../testing/e2e.md)）

## 既知の差・未実施・未決定として記録するもの

| 項目 | 状態 |
| --- | --- |
| 概要が先に非参加になる経路で、ダイアログと参加者だけの中身（説明・参加者の一覧など）が残っていたこと | **解消**（150-C の修正）。`useCaseAccessLoss`が、概要の参加者から非参加への変化でも`onLost`を呼ぶ（#363 で、中身の片付けは、参加者でないことが確かめられた状態になったときに広げた。`onLost`は、この画面で参加者だったことを見た場合のまま）（上の「資格を失ったときの画面の切り替え（#308）」の 1・7） |
| 概要が先に非参加になった時点（契機 (b)）では、詳細・やり取り・TODO の一覧・添付の一覧のキャッシュを取り除かないこと | **解消**（#323）。`forgetCaseContent`で、参加者だけの中身（メンションの候補を含む）を取り除く（上の「処理の流れ」の 3）。メンションの候補のキーは`messageKeys`に移した |
| 資格を失った後に、参加者だけの中身が残りうる場所（#323。取り除ききれない） | (1) 画面を離れた後で、取得の途中だったスレッドの応答が、後から届いた場合（データのないスレッドは`"room"`では残すため）。(2) 部品が画面に付いたままの間に、`useMutation`の部品の側が持つ、直前の操作の結果。(3) 表示中の後片付けは、スレッドを全部取り除く（ほかの部屋のスレッドも。開き直すと取り直されるので、残る問題ではなく、余分な取り直し） |
| 5xx の後に画面を離れ、離れている間に外されて戻った場合（#363） | 一覧のキャッシュの行に、参加者だけの値（最終更新・部屋の ID）が、次の一覧の取り直しまで残る（中身は消える）。以前は 5xx の時点で誤って片付けていたので消えていた。メモリに残るものを消しきることは、#339〜#342 の範囲 |
| 表示中に、ロールの権限（`perm.case.view`）だけが外れた場合 | 既に読み込んだ説明・参加者は、次に開き直すまで残る（TODO・やり取りは欄ごとに 403 の表示）。権限の変更が、開いている画面にすぐ反映されないのは、ほかの画面と同じ既存の動き（ロール・権限を変えても、セッションは切れない）。#308 の範囲の外（C-190） |
| 進捗（5-1 AC-2。S-16・S-17 の進捗） | 149-A で実装済み（下の「149-A の設計」）。147-A の時点では出していなかった（Q7） |
| 最終更新・未読（S-16 の列）、サイドバーの案件の未読の印 | 148-C で実装済み（下の「148-C の設計」）。148-A・148-B-1 の時点では出していなかった（C-184(1)） |
| S-16 の「最終更新」の自動の更新 | しない。一覧は未読のようにはポーリングしない（#117 の既存の動き）。一覧は TanStack Query の既定（`staleTime`なし）のため、画面を開き直したとき・ウィンドウに戻ったときなどに取り直されて更新される。未読の数だけが 2 秒ごとに変わる |
| 「最終更新」に含めるもの | メッセージ（返信を含む）の投稿だけ。TODO・案件の情報の変更・参加者の変更は含めない（C-191(4)） |
| S-16 の最終更新の順での並び替え | 作らない。並びは案件 ID の降順のまま（名前での絞り込みは#155） |
| 名前・番号での絞り込み（S-16・5-1 AC-19） | 作らない。方式が未決定（#155） |
| S-16 の「自分の申請」の状況 | 出さない。S-18 の「自分の申請」に置いたまま |
| 参加者の追加・削除・退出、納期の変更、参加者の管理（S-17 のダイアログ）、参加者の役割の名前の表示（Q8）、`canEditDueDate` | 147-B で実装済み（下の「147-B の設計」） |
| 参加者の追加・削除の通知（参加した・外された） | 出さない（計画に含めない。参加の通知は未決定）。追加・削除は監査だけに残る |
| 外された人の TODO の担当を「なし」に戻すこと（5-4 AC-6） | **149-D で実装済み（解消）**（下の「149-D の設計」。C-197）。147-B・149-A・150-B の時点では、参加者の削除・退出・無効化・再開の除外で TODO の担当は書き換わらなかった（完了の取り消しのときだけ、担当者がいまも有効な参加者かを確かめる。下の「149-A の設計」。この確認は残してある） |
| 監査の一覧での案件の名前の解決 | しない。対象の種類「案件」の名前だけを出す（[audit-logs.md](audit-logs.md)） |
| 追加の対象の社員がいない・無効のときの応答 | 422（`fields.userId`。ない・無効を同じ文にする）。`api-draft.md`の EP-5-09 の 404 の案は採らなかった（C-182(19)） |
| 参加者の追加・削除のレート制限 | 作らない（X-8 が未決定） |
| 参加の行を使うチャンネルの経路を「有効な参加者」に変えること | 147-C-1 で実装済み（147-C-2 の前提） |
| 無効化で案件の参加の記録を残すこと・AC-15 の守り・オーナー交代による自動参加 | 147-C-2 で実装済み（解消。以前の無効化は案件の参加の行も消していて、C-142(1)と食い違っていた）。下の「147-C-2 の設計」 |
| 既存の案件への自動参加の補完 SQL（`backfill-case-auto-participants.sql`） | 作成済み・**どの環境にも未実行**。本番への実行は、利用者の承認が別に必要 |
| 異動・再有効化で案件の参加の行が変わらないこと／外れること | コードは変えず、テストで固定した（147-C-2） |
| 一覧の「進行中・終了」以外の状態（アーカイブ） | #151 |
| 本番の D1 への適用 | 147 の時点では migration がないため該当しない。149-A の migration 0029、148-B-2 の migration 0030、149-D の migration 0031（索引だけ）は**本番に未適用**（適用は、ほかの migration とまとめて、利用者の承認の後）【Issue #155（155-A）の migration 0032・0033（検索の表。0033 は手で書いた。ADR-0031）と、既存のメッセージの索引の登録（`reindexMessages`）も要る。155-B の migration 0034（写しを空にする。手で書いた）・0035（`search_documents`の作り直し）と、添付のファイル名を含めた登録も同じ。2026-11-21 から、0013 以降と検索の索引を、利用を止めて1回の作業で一緒に出す（[ADR-0032](../adr/0032-first-production-rollout-stop-and-apply-at-once.md)・[production-first-rollout.md](../operations/production-first-rollout.md)）。#160 で承認を得る。[search.md](search.md)】 |
| API 仕様（`docs/api/openapi.json`）の ULID の`pattern` | 案件の経路だけ、実装の ULID の形と一致させた。ほかの経路を含む全体は Issue #289 |
| 案件のやり取り（S-17）、終了した案件の読み取り専用、案件の権限の確認 | 148-A で実装済み（下の「148-A の設計」） |
| 案件の添付の一覧と元の投稿への移動 | 148-B-1 で実装済み（下の「148-B-1 の設計」）。C-184(4) |
| 添付の公開範囲の選択・変更（5-2 AC-8・AC-9。一覧の`publicationVisibility`の項目と「公開範囲を変更」） | 148-B-2 で実装済み（下の「148-B-2 の設計」。C-195）。148-B-1 の時点では、一覧は公開範囲の項目を持たなかった |
| 公開範囲の値による読み取りの資格（承認済み公開アーカイブでの非参加者の閲覧・一覧・「参加者限定の添付」の表示、審査中の承認権限者の一時閲覧） | 作らない。**公開範囲の値は、いまは、どの読み取りの資格にも使わない**（配信・一覧・メッセージ・返信・スレッド一覧は、値によらず参加者だけ。テストで固定済み）。5-5・5-6 の Issue |
| 公開範囲の変更が、公開申請の審査中・承認済みで 409 になること（5-2 AC-9 の原文） | 作らない。公開申請（5-5）が未実装のため、変更の判定・書き込みの条件にまだない。5-5 の Issue で、`case-attachment.repository.ts`の`visibilityChangeCondition`と`case-attachment.service.ts`の`changeVisibility`に足す。再開後の承認済みの状態の扱いも 5-5 |
| 公開範囲の往復の変更の検出 | しない。2 値で「同じ値なら書かない」ため、ほかの人が P→X→P と戻した後に、古い読み（P）で X を求めると通る（監査には 3 件残り経緯は分かる）。また、読んだ後にほかの人が求めた値に変えていれば、書かずに 200 を返す（応答は読んだ時点の値で、画面は取り直して実際の値を出す）。版の列は足さない（最後の操作が勝つ） |
| 添付の一覧が、公開範囲の変更の後に自動では更新されないこと | ほかの人の変更は、開き直すか、自分の操作の後の取り直しで出る（ポーリングなし。#117 の既存の動き）。自分の変更は`caseKeys.all`の取り直しで出る |
| メッセージの表示（S-05・S-06・S-07）の添付に公開範囲を出すこと | 出さない（要件の指定なし。公開範囲は S-17 の一覧と入力欄だけ） |
| migration 0030（`message_attachments.publication_visibility`） | **本番に未適用**（適用は、ほかの migration とまとめて、利用者の承認の後）。手元の DB には適用して確かめた |
| migration 0031（`case_todos_assignee_id_id_idx`。149-D） | **本番に未適用**（0029・0030 と合わせて、利用者の承認の後に適用する）。索引の追加だけで、破壊的な変更はない。テスト用の DB には適用して確かめた（実行計画のテスト） |
| 添付の一覧の自動の更新 | しない（ポーリングなし。#117 の既存の動き）。ほかの人の添付は、開き直すか、自分の添付つきの投稿・返信の成功の後に出る |
| 添付の一覧の種類（`kind`）の表示 | 出さない（応答には含める）。画面は名前・大きさ・投稿者・日時だけ |
| 添付の削除 | 作らない。#270（一覧の項目にも削除の操作はない） |
| 終了した案件の実際の状態 | 150-A で終了・再開の操作を実装した（解消。下の「150-A の設計」）。以前は、終了した案件はテストのデータ・シードにしか存在せず、書き込みの 409 は DB に直接`status`を書いて確かめていた |
| 審査中の公開申請・再開申請の自動取消・取り下げ（5-1 AC-10 の原文、C-142 の案） | 作らない。申請の仕組み（5-5・5-6）が未実装。#153（後回し）・5-5 の Issue で扱う |
| 再開時の参加者の選び直し（5-1 AC-16）と、確定前の確認の表示 | 150-B で実装済み（解消。下の「150-B の設計」。C-194）。150-A では、いまの参加者のまま再開していた。確定のボタンは「危険な操作」の見た目のまま（外れる人の内容が見えなくなる操作のため） |
| 再開で外した人の TODO の担当（5-4 AC-6。「参加者削除・再開時の除外・無効化で担当者が外れた場合、未完了TODOは現在担当をなしにする」） | 150-B では実装せず、**149-D で実装済み（解消）**。参加者の削除・退出・無効化・再開の除外の経路をまとめて作った（C-188(1)・C-194(8)・C-197）。`buildReopenStatements`の、参加の行の削除の直前に差してある。「149-D の設計」 |
| 再開の「申請者」の必須参加・承認者が同じ情報を確かめること（5-1 AC-16・AC-13 の「申請」の部分） | 作らない。再開申請（5-6、#153。後回し）が未実装のため、外せないのは再開する本人と自動参加の人だけ（C-194(2)） |
| 終了の時点の参加者の記録 | 作らない。候補は「再開の時点で参加していて有効な人」（C-194(1)）。終了の後に無効化された人の参加の行は、再開の除外では消えない（行は残る） |
| 終了中の参加者の追加・削除（権限表 Q-37。未決定） | 150-B は、再開と同時の変更だけ。終了中の通常の追加・削除は 409 `closed`のまま |
| 再編集（EP-5-20。件名・説明・取引先・担当部署）、5-1 AC-20 | **150-C で実装済み（解消）**（下の「150-C の設計」。[C-199](../requirements/decision-register.md)）。参加していない担当部署のオーナー・全体管理者は、件名・取引先・担当部署だけ編集でき、説明は参加者だけ。監査は件名を前後の値で、説明は変えたことだけ残す。類似の件名の警告は案件の申請（146-A）と同じ（利用者・統括の決定。[C-189](../requirements/decision-register.md)）。納期は再編集に含めず、既存の「納期を変更」（147-B）のまま |
| 再編集で、審査中の公開申請・再開申請があるときの禁止（C-140(2)） | 作らない。公開申請・再開申請（5-5・5-6）が未実装のため、判定にまだない。5-5・5-6 の Issue で足す（150-C の既知の差） |
| 再編集で、アーカイブ中の案件の禁止（C-129(4)） | 作らない。案件のアーカイブ（#151）が未実装のため。#151 で足す |
| S-17 の「⋯」メニュー（screens.md の案：「編集」を含む） | 作らない（150-C）。「内容を編集」のボタンを置いた。項目が2つ以上になる #151 で「⋯」にまとめる（利用者の決定。C-199(2)） |
| 再編集のレート制限・非参加の管理者が編集したことの見せ方 | 作らない。レート制限は X-8 が未決定、見せ方は C-122 で未決定のため、監査ログだけが記録する |
| 再編集の監査の取引先の名前 | 読んだ時点の値（読んだ後の取引先の改名は前提に入れない）。取引先の ID と、件名・担当部署の集合は、読んだときのままであることを前提で確かめる |
| 案件の操作履歴の画面（C-140(3)） | 未定義。操作の履歴は監査ログだけで満たし、参加者向けの履歴の画面は作らない（利用者の決定） |
| 終了のときの未完了の TODO の扱い | 解消（#309。C-193）。終了の確認に警告を出し、終了はできる（TODO は未完了のまま残り、終了中は閲覧のみ。再開すれば再び操作できる）。サーバーの終了の判定は変えていない。以前は未定義だった（150-A は TODO に触れなかった） |
| 終了・再開の日時の列 | 作らない（migration なし）。「いつ」は監査ログの記録の日時で分かる。記録の有無は未決定（#37） |
| 終了・再開のレート制限 | 作らない（X-8 が未決定。147-B と同じ） |
| 参加者0人の終了した案件の再開 | #153（再開申請）。150-A の直接再開は、有効な参加者が操作する |
| 自動参加の補完 SQL が未実行の既存の案件 | 全体管理者・オーナーに参加の行がないため、R-77 のとおり終了・再開できない（403）。補完の実行（利用者の承認が要る）の有無で、手元の DB での見え方が変わる |
| 審査中の一時閲覧・承認済み全社員公開アーカイブでの非参加者の閲覧（5-2 AC-3 の一部） | 作らない。5-5・5-6 の Issue |
| 進行中の操作（投稿・添付の送信など）の途中で利用者が替わったときの扱い | 148-A でも直していない。Issue #300 |
| 既に画面に出ている行の返信の件数・リアクションの、ほかの人の変更の反映 | 部屋のポーリング（`features/messages/hooks/message-polling.ts`の`catchUpMessages`）は最後の ID より後の新着だけを取り足し、既存の行は取り直さない。開き直すと出る（チャンネルと同じ既存の動き。`e2e/reactions.spec.ts`も開き直して確かめる）。リアルタイムの更新は #117 |
| 投稿（トップレベル）の SQL に「部署が有効」の条件がない既存の差 | 案件専用チャンネルは部署を持たないので影響しない。148-A では変えていない |
| TODO の編集・削除（149-B）、履歴・削除済みの一覧・復元（149-C）、担当者が外れたときの処理（149-D） | **すべて実装済み（#149 の4つの子は完了）**。149-A では作らなかった（表の列は先に作ってある）。編集・削除は「149-B の設計」、担当者が外れたときの処理は「149-D の設計」、履歴・削除済みの一覧・復元は「149-C の設計」。`auto_unassign`などの記録は、149-C で履歴に出す |
| 資格を失った直後の、TODO の一覧などのキャッシュ（149-C の後追い） | **解消**（#323）。資格を失った後に、参加者だけの中身のキャッシュが残らないようにした（上の「処理の流れ」の 3） |
| 開いている履歴の TODO が、ほかの人に削除されたとき | 通常の一覧から行が消えるので、行の中の履歴も一緒に消える（許容）。削除済みの一覧の行からは同じ履歴を開ける |
| TODO の操作の監査ログの表への記録 | しない（C-188 のまま）。履歴・復元も TODO の記録の表（`case_todo_events`）だけに残す |
| 有効な担当者の名前のプロフィールへのリンク | 149-A では付けない。149-B で実装した（担当の名前から`ProfileCardTrigger`でカードを開き、`StartDmButton`で DM。無効な人は文字だけ）。「以前の担当」の「（退職者）」の併記は 149-A で実装済み |
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
- Issue #148：案件のやり取り（3つの子に分ける。148-A が最初。依存は #147・#284・#297・#294）。要件：5-2 AC-1〜AC-6（AC-3 は参加者の閲覧・取得の部分）・5-1 AC-11、R-62〜R-64、S-17・S-07・S-35。決定記録[C-184](../requirements/decision-register.md)。148-B-1（添付の一覧。5-2 AC-7 の参加者の部分、EP-5-19）の決定は[C-191](../requirements/decision-register.md)。148-C（S-16 の最終更新・未読、サイドバーの未読の印。5-1 AC-4 の残り）の決定は C-191(4)・[C-192](../requirements/decision-register.md)。148-B-2（添付の公開範囲。5-2 AC-8・AC-9、R-85、EP-1-23。migration 0030）の決定は C-191(1)〜(3)・[C-195](../requirements/decision-register.md)、関連：[ADR-0024](../adr/0024-add-column-rewrite-for-table-rebuild.md)（列の追加の migration の書き換え）。関連する設計：[messages.md](messages.md)・[threads.md](threads.md)・[attachments.md](attachments.md)・[unread.md](unread.md)・[channels.md](channels.md)
- Issue #149：案件の TODO（4つの子に分ける。149-A が最初。149-B〔編集・削除。EP-5-15・16。決定[C-196](../requirements/decision-register.md)〕・149-D〔担当者が外れたときの処理。決定[C-197](../requirements/decision-register.md)。migration 0031〕・149-C〔履歴・削除済みの一覧・復元。EP-5-24〜26。決定[C-198](../requirements/decision-register.md)。後追い #323〔資格を失った後のキャッシュの取り除き。解消済み〕も実装済み。依存は #148）。要件：5-4 AC-1〜AC-14、1-9 AC-2、5-1 AC-2 の進捗、R-76・R-78、S-16・S-17、EP-5-13〜18・24〜26。決定記録[C-188](../requirements/decision-register.md)。関連：[ADR-0020](../adr/0020-test-scope-mutation-e2e.md)・[ADR-0028](../adr/0028-lighter-process-and-narrowed-scope.md)
- 要件：5-1 AC-2（進捗を除く）・AC-4・AC-5・AC-12・AC-14・AC-17（表示）・AC-19（表示）・AC-21（管理の情報の表示）、S-16・S-17。147-B：5-1 AC-3・AC-7（外せない部分）・AC-11（終了中は不可）・AC-17（変更）・AC-21（納期の変更）、EP-5-09・EP-5-10。決定記録[C-182](../requirements/decision-register.md)
- Issue #150：案件の終了・再開・再編集（3つの子に分ける。150-A が最初。依存は #148 の148-A）。要件：5-1 AC-8〜AC-11・AC-13、3-3 AC-1〜AC-3、R-77、S-17、EP-5-11・EP-5-12。決定記録[C-189](../requirements/decision-register.md)。150-B（再開のときの参加者の選び直し。5-1 AC-13・AC-16、3-3 AC-2・AC-3）の決定は[C-194](../requirements/decision-register.md)。依存は #149-A・#308。150-C（案件の内容の再編集。5-1 AC-20、EP-5-20）の決定は[C-199](../requirements/decision-register.md)。#150 の子はこれで3つとも実装済み
- 関連する設計：[case-requests.md](case-requests.md)、[app-shell.md](app-shell.md)、[notifications.md](notifications.md)、[channels.md](channels.md)、[audit-logs.md](audit-logs.md)
