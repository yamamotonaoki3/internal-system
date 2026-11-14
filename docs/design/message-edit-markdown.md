# 投稿の編集・削除とマークダウンの表示（Issue #134）

## 目的

メッセージの投稿者が、自分の投稿を編集・削除できるようにし、本文をマークダウンとして整形して表示する（要件 [1-3](../requirements/01-messaging.md)・[1-5](../requirements/01-messaging.md)）。チャンネル（S-05）とDM（S-06）の両方で使う。コードは書き写さず、ファイル名・関数名で指す。マークダウンの採用理由と許可リストは[ADR-0026](../adr/0026-markdown-rendering.md)、決定の記録は[decision-register.md](../requirements/decision-register.md)のC-171。

## 範囲

| 区分 | 内容 |
| --- | --- |
| このIssueで作ったもの | EP-1-03（編集）・EP-1-04（削除）／`messages`への列の追加（migration 0019：`edited_at`・`deleted_at`・`deleted_by`）／EP-1-01の応答の`editedAt`・`deleted`と`body`のnullable化／EP-2-06の`readOnly`／監査`message.delete`／未読で削除済みを数えない／マークダウンの描画／編集・削除の画面 |
| 別のIssueに残すもの | メンションの強調（1-5 AC-7。#139。#134では`@名前`を文字のまま出す）、他人の投稿の削除・依頼・緊急削除（#142）、開いたままの画面への他の人の編集・削除の即時反映（#117）、無効な部署への投稿の側の読み取り専用（#154。下の「既知の限界」）、削除した親への返信を不可にすること（#137）、全文検索で削除済みを対象から外すこと（#139）、本文の編集でメンションが変わったときの通知（#139）、投稿のレート制限（X-8が未決定） |

## ファイルと役割

### バックエンド

| ファイル | 役割 |
| --- | --- |
| `backend/db/schema.ts`、`backend/db/migrations/0019_add_message_edit_delete.sql` | `messages`に`edited_at`・`deleted_at`・`deleted_by`（`users.id`を参照）を足した。すべてNULL可の`ADD COLUMN`だけで、既存データの補完は要らない |
| `backend/src/db/message-modify.sql.ts` | 新しいDAO。「編集・削除してよい」条件（本人の投稿で未削除、かつ、チャンネルなら本人が参加中・未削除・部署が有効〔部署のない会社直属は有効扱い〕、DMなら本人が当事者で当事者に無効な社員がいない）を持つ。`updateBodyIfModifiable`（本文と編集日時の更新）と`deleteIfModifiable`（削除の印と監査を1つの`db.batch`で書く）が、更新した行数を返す |
| `backend/src/db/message.repository.ts` | `findForModification`（部屋・投稿者・削除済みかだけを読む）・`isDepartmentActive`・DAOの呼び出しを足した。一覧の項目に`editedAt`・`deleted`を足し、削除済みの`body`は`null`にする（本文はDBに残し、APIでは返さない）。`insertIfOrdered`のINSERT…SELECTは、スキーマの全列を挿入先に並べるため、末尾に新しい3列分のNULLを足した |
| `backend/src/services/message.service.ts` | `edit`・`remove`を足した。判定の順は下の「判定の順」。`MessageActor`に`reauthenticatedAt`を足した（削除だけが使う）。書き込みが0行だったときの`failWrite` |
| `backend/src/routes/messages.ts` | `messageItemRoutes`（`PATCH /:messageId`・`DELETE /:messageId`）。編集の入力は`{ body }`だけの`strict`で、本文の規則は`shared/message-rules.ts`の`messageBodySchema`を参照する。`backend/src/index.ts`が`/api/messages`へ登録する |
| `backend/src/lib/audit-actions.ts` | 監査の種類`message.delete`を足した |
| `backend/src/db/channel.repository.ts`、`backend/src/services/channel.service.ts` | `findForViewer`が部署の有効・無効（`departmentIsActive`）を外部結合で読み、EP-2-06の応答に`readOnly`を足した。画面の編集・削除のボタンの表示に使う。投稿の権限`canPost`とは別 |
| `backend/src/db/unread-counts.sql.ts` | 未読の数に`deleted_at IS NULL`の条件を足した（削除済みは数えない） |
| `docs/api/openapi.json`、`backend/src/openapi.test.ts` | `updateMessage`・`deleteMessage`と、一覧の項目の変更 |
| `stryker.config.json` | ミューテーションの対象に`backend/src/db/message-modify.sql.ts`と`frontend/src/features/messages/markdown/`を足した（認可の条件・XSS対策の中心） |

### フロントエンド

| ファイル | 役割 |
| --- | --- |
| `frontend/src/features/messages/markdown/markdown-rules.ts` | 許可リストの**定義元**。描画してよい要素（`ALLOWED_ELEMENTS`、12個）と、リンクにしてよいURL（`isAllowedUrl`。`new URL()`で絶対URLとして解釈でき、スキームが`http:`・`https:`・`mailto:`のものだけ） |
| `frontend/src/features/messages/markdown/remark-restrict.ts` | 自前のremarkプラグイン。許可しない記法（画像・表・タスクリスト・脚注・生のHTML・許可しない形式のリンク・見出し・区切り線）の節を、元の文章の同じ位置の文字（原文）に戻す。1回の改行を`br`にする |
| `frontend/src/features/messages/markdown/MarkdownBody.tsx` | `react-markdown`＋`remark-gfm`（取り消し線は`~~`だけ）を使う描画。`allowedElements`・`unwrapDisallowed`、要素ごとの部品で`className`を捨てる、リンクは`target="_blank"`・`rel="noopener noreferrer"`。`dangerouslySetInnerHTML`は使わない |
| `frontend/src/features/messages/components/MessageBody.tsx` | `MarkdownBody`を`React.lazy`で動的に読み込む。読み込むまでは、書いたままの文字（`whitespace-pre-wrap`）を出す |
| `frontend/src/features/messages/components/MessageBodyBoundary.tsx` | 動的な読み込みの失敗を受け止めるエラー境界。その本文だけを原文と案内に替える。例外の詳細は出さず、ログは#234で足す【コードレビュー2回目の指摘で変更：動的読み込みの失敗だけを専用のエラー`MarkdownLoadError`（`MessageBody.tsx`の`lazy`の`import()`の失敗を包んで投げ直す）で識別する。それなら「書式つきの表示を読み込めませんでした。再読み込みしてください。」と原文を出す。読み込みに成功した後の描画中の例外は、原文と「この本文は書式つきで表示できませんでした。」を出す（例外の詳細を出さず、再読み込みを勧めず、その行だけ）。元の記述は残す】 |
| `frontend/src/features/messages/components/MessageItem.tsx` | 1件の行。投稿者・日時・本文・「（編集済み）」・削除済みの文言（「このメッセージは削除されました」）。自分の投稿（`canModify`）に「編集」「削除」を付ける |
| `frontend/src/features/messages/components/MessageEditForm.tsx` | その場の編集欄。保存（Ctrl+Enter・Cmd+Enter）・キャンセル（Esc）。本文が元と同じとき・保存中は保存を押せない。422の`fields`を出す。端末の下書きと離脱の確認の対象にしない（C-170(5)） |
| `frontend/src/features/messages/components/DeleteMessageDialog.tsx` | 削除の確認のダイアログ。確認 → 再認証（`withReauth`）→ 送信。送信中は押せない |
| `frontend/src/features/messages/hooks/useEditMessage.ts`、`useDeleteMessage.ts` | 編集・削除の送信。成功したら`replace-room-message.ts`で一覧の該当の1件を置き換える。削除は再認証が完了しなかったとき、要求を送らない |
| `frontend/src/features/messages/hooks/replace-room-message.ts` | `cancelQueries`で実行中のポーリングを止めてから、`setQueryData`で該当の1件だけを置き換える |
| `frontend/src/features/messages/hooks/useRoomMessages.ts` | クエリに`gcTime: 0`を足した。部屋の画面を外れたらキャッシュを捨て、開き直したときに最新の一覧から取り直す（U-8） |
| `frontend/src/features/messages/api/message-api.ts` | 応答のスキーマに`editedAt`・`deleted`を足し、`body`をnullableにした。`editMessage`・`deleteMessage`を足した |
| `frontend/src/features/messages/components/MessageList.tsx`、`RoomMessages.tsx` | `currentUserId`・`canModifyOwn`を受け、`MessageItem`に渡す |
| `frontend/src/features/channels/components/ChannelDetailView.tsx`、`frontend/src/features/dms/components/DmView.tsx` | `canModifyOwn`を渡す。チャンネルは「参加中で読み取り専用でない」、DMは`canPost` |
| `frontend/src/styles/markdown-body.css`（`index.css`から読み込む） | 固定のクラス`markdown-body`の配下の要素の見た目を外部のCSSで付ける。`style`属性・任意値のクラスは使わない（ADR-0015） |
| `package.json`、`package-lock.json` | `react-markdown` 10.1.0・`remark-gfm` 4.0.1（版を固定）と、`overrides`の8個（[tech-stack.md](../tech-stack.md)） |

## 処理の流れ

### 判定の順（Service。この順を変えない）

編集・削除は、`requireModifiable`で①〜⑤を確かめ、削除はさらに⑥を確かめてから、⑦で書き込む。

1. 部屋が見えるか。メッセージがない・部屋が見えない（非公開で未参加、当事者でないDM、アーカイブ済み）はすべて同じ404（存在を明かさない）
2. 本人の投稿か。違えば403（`logger.audit`に`not_author`で記録）
3. 権限（`perm.message.edit.own`・`perm.message.delete.own`）
4. 削除済みなら409
5. 部屋の状態。未参加は403（監査に`not_member`）、部署が無効なら409（1-3 AC-6）、DMの相手が無効なら409。お知らせ専用の投稿権限は問わない（U-3）
6. （削除だけ）再認証。なければ403`REAUTH_REQUIRED`。断られる操作でパスワードを入力させないよう最後に置く。編集は再認証を求めない
7. 条件付きの書き込み

### 条件付きのUPDATEと、0行のときの読み直し

確認から書き込みまでの間に状態が変わっても条件を破る行を書かないよう、UPDATEのWHEREに同じ条件（`message-modify.sql.ts`の条件）を置く。更新が0行だったときは、`failWrite`が①〜⑤を読み直して、404・403・409のうち原因に合うものを返す。原因が分からなくても成功にせず、409にする（書き込みはやり直さない）。

### 編集（`PATCH /api/messages/:messageId`）

- 入力は`{ body }`だけ（`strict`）。空白だけ・上限超過・余分な項目は422。成功は200で`{ id, body, editedAt }`
- 版の列は足さない。編集どうしは後勝ち（更新できるのは本人だけで、競合は同じ人の複数のタブに限られる）。過去の本文は返さない
- 編集の監査は残さない。同じ内容でも送られた編集は`edited_at`を更新する（画面は、変更がないとき保存を押せなくする）

### 削除（`DELETE /api/messages/:messageId`）

- 成功は204。`reason`は受け付けない（他人の投稿の削除は#142）。本文はDBに残す
- 監査`message.delete`は、`deleteIfModifiable`の`db.batch`の中で、**UPDATEの前に**同じ条件で記録する（UPDATEのあとは条件が偽になるため）。`detail`は`{ roomId }`だけで、本文を入れない。削除できなかった（0行の）ときは監査を残さない
- 他人の投稿の削除は、全ロール403（R-29の付与の経路を作らない）。拒否は`not_author`として監査に残る

### 一覧の応答（EP-1-01）

`items[]`に`editedAt`（文字列かnull）・`deleted`（真偽）を足した。削除済みは`body: null`・`editedAt: null`で、投稿者と日時は残る。`after`の有無にかかわらず同じ。

### 画面のキャッシュの更新

編集・削除が成功したら、`replaceRoomMessage`が`cancelQueries`で実行中の取得を止めてから`setQueryData`で該当の1件を置き換える。ポーリングは`after`だけを取るため、取り直しの要求は増やさず、実行中の取得が反映の前の一覧で上書きしないようにする。失敗したときは表示を変えずにエラーを出す。

### 開き直しで取り直す（U-8）

`useRoomMessages`の`gcTime: 0`により、部屋の画面を外れるとキャッシュを捨てる。開き直すと最新の一覧（`after`なし）から取り直すので、外れていた間の他の人の編集・削除が反映される。投稿の下書きは端末に別に保存されており、消えない（[drafts.md](drafts.md)）。未読の既読位置は部屋を開いたときに決まり、影響を受けない（[unread.md](unread.md)）。

### 未読と一覧

削除したメッセージは未読に数えない（U-7。`unread-counts.sql.ts`）。索引`messages_room_id_id_idx`の範囲検索は変わらない。DMの一覧の順（最後に動きがあった順）は変えない。編集はIDが変わらないので、どちらにも影響しない。

### マークダウンの描画

- 許す要素は12個だけ（`markdown-rules.ts`）。許可しない記法は原文の文字で出す（U-4）。1回の改行は改行（U-5）
- 表を描画しないのは、`react-markdown`が表の`align`を`style`属性に変え、CSP（`style-src 'self'`）に反するため
- `rehype-raw`・`rehype-sanitize`は入れない。テスト`markdown-dependencies.test.ts`で`package.json`にないことを確かめる
- 初回のJSには入れず、動的に読み込む。実測はADR-0026
- 【利用者の追加の決定】参照形式のリンクの定義の行（`[r]: …`）の扱い：本文の参照が**許可した URL のリンクになったときだけ**、その最初の定義の行を隠す（書式の標準どおり）。どこからも使われていない定義、許可しない URL（`javascript:`・`data:`・相対など）の定義、画像の参照だけに使われた定義、同じ名前の2つ目以降の定義の行は、書いたままの文字の段落で出す（U-4：書いた内容を失わない）。画像の参照の扱いは、利用者の決定を当てはめた統括の判断。実装は `remark-restrict.ts` の `revealUnusedDefinitions`（リンクになった識別子を記録し、木の処理の後に、隠す条件に当たらない定義を原文の段落に替える）。テストは `frontend/src/features/messages/markdown/MarkdownBody.restrict.test.tsx` の describe「参照形式のリンクの定義の行の表示」（23件、XSS の5件を含む）

## 主な入出力

| 項目 | 入力 | 出力 |
| --- | --- | --- |
| `edit(actor, messageId, body)` | 操作者、メッセージID、新しい本文 | `{ id, body, editedAt }`。拒否は`AppError`（404・403・409） |
| `remove(actor, messageId)` | 操作者（`reauthenticatedAt`を含む）、メッセージID | なし（204）。再認証が古い・ないときは403`REAUTH_REQUIRED` |
| `updateBodyIfModifiable` / `deleteIfModifiable` | メッセージID・本人のID・値 | 更新した行数（1か0） |
| `isAllowedUrl(url)` | URL文字列 | 許可したスキームの絶対URLだけtrue |
| `replaceRoomMessage(queryClient, roomId, messageId, replace)` | キャッシュ・部屋・対象・置き換える関数 | 該当の1件だけ置き換わったキャッシュ |

## 既知の限界

- **開いたままの画面には、他の人の編集・削除が届かない**。ポーリングが`after`だけを取るため。部屋を開き直すと反映される（U-8）。即時の反映はWebSocket（#117）で行う
- **投稿の側の読み取り専用（部署が無効なとき）は#154で実装する**。#134は編集・削除だけを先に409にしたため（U-9）、#154まで「投稿は通るが編集・削除は409」という食い違いが一時的に残る
- 引用（`>`）の中の複数行の記法を、許可しない記法として原文に戻すとき、2行目以降の`> `が文字として残る
- `npm run size:report`は動的importの塊を拾えない（初回のJSに含まれないため、塊の大きさは別に測った）
- 本番形のレート制限は、投稿と同じくX-8が未決定のため入れていない

## テストの場所

| 区分 | 場所 |
| --- | --- |
| バックエンドの結合 | `backend/src/routes/messages.edit.test.ts`・`messages.delete.test.ts`・`channels.read-only.test.ts`、既存の`messages.test.ts`・`messages.dm.test.ts`・`openapi.test.ts` |
| Service・DB | `backend/src/services/message.modify.test.ts`・`message.modify-race.test.ts`（確認から書き込みの間の変化・同時の2回）、`backend/src/db/message-modify.db.test.ts`・`unread-counts.deleted.db.test.ts`（EXPLAINを含む）、共通のデータ`backend/test/message-modify-fixtures.ts` |
| マークダウン（画面の単体・fast-check） | `frontend/src/features/messages/markdown/`の`MarkdownBody.test.tsx`・`MarkdownBody.xss.test.tsx`・`markdown-rules.test.ts`・`markdown-dependencies.test.ts` |
| 画面（MSW） | `frontend/src/features/messages/messages.edit-delete.test.tsx`・`messages.markdown.test.tsx`・`api/message-api.test.ts`、`features/channels/channel-detail.edit-permission.test.tsx`・`channel-detail.reopen.test.tsx`・`channel-detail.markdown-load-error.test.tsx`・`channel-detail.markdown-render-error.test.tsx`、`features/dms/DmView.edit-permission.test.tsx` |
| E2E | `e2e/messages-edit-delete.spec.ts`・`e2e/messages-markdown.spec.ts`（開発サーバー）、`e2e-prod/markdown-csp.spec.ts`（本番形）。詳細は[e2e.md](../testing/e2e.md) |

## 関係するIssue・ADR

- Issue #134（親：#133）。申し送り：#139・#137・#142・#154・#117・#160・#234
- [ADR-0026](../adr/0026-markdown-rendering.md)、[ADR-0024](../adr/0024-add-column-rewrite-for-table-rebuild.md)（列の追加）、[ADR-0015](../adr/0015-style-foundation.md)（`style`属性を使わない）、[ADR-0020](../adr/0020-test-scope-mutation-e2e.md)（ミューテーション）
- 決定：[C-171](../requirements/decision-register.md)
- 関連する設計書：[messages.md](messages.md)・[dms.md](dms.md)・[unread.md](unread.md)・[channels.md](channels.md)・[drafts.md](drafts.md)
