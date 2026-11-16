# 設計書：リアクション・スタンプ

Issue #138（親：#133）。メッセージ（親の投稿と返信）に、絵文字のリアクションと文字のスタンプを付け、取り消す（S-05・S-06・S-07）。要件は[1-7](../requirements/01-messaging.md)と1-4 AC-6、決定は[decision-register.md](../requirements/decision-register.md)のC-174。コードは書き写さず、ファイル名・関数名で指す。

## 目的と範囲

- 1-7 AC-1〜AC-5と1-4 AC-6を実装する。投稿・返信に絵文字（固定の一覧）とスタンプ（文字6つ）を付け、件数と付けた人を見て、自分が付けたものを取り消せる。
- 絵文字を選ぶ部品（ピッカー）は自前で作る。emoji-picker-react は入れない（本番のCSP `style-src 'self'` と衝突するため。[ADR-0027](../adr/0027-self-made-emoji-picker.md)）。C-128の(2)絵文字ライブラリの本採用と(3)スタンプは画像だけ、を置き換えた。
- 絵文字とスタンプを合わせて、1つの投稿・返信ごとに20種類まで。同じ人が同じものを2回付けても行は1つで、エラーにせず成功にする（冪等）。
- 付ける・取り消すの応答は、その投稿の最新の集計。画面は応答の集計でその投稿の`reactions`だけを書き換え、取り直さない。
- 通知しない。未読・スレッド一覧の並びに関係させない。
- 作らないもの：他の人のリアクションの即時反映（#117）、レート制限、絵文字の検索、肌の色の選択、スタンプの画像、本番DBへのmigration 0022の適用（利用者の承認が別途必要）。

## データ

| 対象 | 内容 |
| --- | --- |
| `message_reactions`（`backend/db/schema.ts`、migration `0022_add_message_reactions.sql`） | 列は`message_id`・`user_id`・`kind`・`value`・`created_at`。主キーは（`message_id`, `kind`, `value`, `user_id`）で、重複は主キーで1行になる。`kind`は`emoji`・`stamp`のCHECK、`value`は長さ1〜64のCHECK。索引`message_reactions_user_id_idx`。`db:generate`の生成物のまま（新しい表のため、ADR-0024の書き換えは起きない） |
| 行の残し方 | 取り消し以外で行を消さない。投稿が削除済み（論理削除）になっても行は残し、一覧は`reactions: []`を返す。退職者（`users.is_active = 0`）の行も消さずに数える |
| `MessageItem.reactions` | `{ kind, value, count, reactedByMe, users: { id, displayName, isActive }[] }`の配列。`count`は全数で、`users`は付けた時刻の順に最大50人。親・返信・スレッドの親・スレッド一覧のすべての項目に含める。削除済みは`[]` |

## 受け付ける値（唯一の定義元）

`shared/reaction-rules.ts`が、画面とサーバーで同じ意味の定義を1か所に持つ。

- `REACTION_KINDS`、`MAX_REACTION_TYPES`（20）、`MAX_REACTION_USERS_SHOWN`（50）、`STAMPS`（スタンプのidと日本語の名前。6つ）、`EMOJI_CATEGORIES`（4分類・80個。`char`と読み上げ用の日本語の`name`）、`isValidReaction(kind, value)`。
- 受け付けるのは一覧にあるものだけ。絵文字は完全一致で比べ、異体字セレクタなどの正規化はしない。肌の色の違いは持たない（`"👍🏻"`は拒否）。サーバーは画面の検査に頼らず、同じ一覧で必ず検査する（一覧にない値は422）。
- 変更の理由が同じものだけをここに置く。テストの期待値は一覧から作らず、リテラルで書く（`backend/src/lib/reaction-rules.test.ts`。`vitest.config.ts`の対象に入る置き方は`message-rules.ts`のテストと同じ）。

## ファイルと役割

### バックエンド

| ファイル | 役割 |
| --- | --- |
| `backend/src/db/message-reactions.sql.ts` | 部屋の条件`reactable`、集計`loadMessageReactions`、0行の後の読み直し`loadReactionsIfReactable`、書き込み`addReactionIfReactable`・`removeReactionIfReactable`。SQLの条件を持つものをここに閉じ込める。配列はJSONの1パラメータで渡す。未知のDBエラーは変換せず再送出する |
| `backend/src/db/message.repository.ts`、`thread.repository.ts` | 各一覧・`findItem`・スレッド一覧の`toItem`が、`loadMessageReactions`の結果を`reactions`として付ける。`listLatest`・`listAfter`の`viewerId`は必須（付け忘れで`reactedByMe`が常に偽になるのを型で防ぐ）。書き込みと読み直しをRepositoryの関数として公開する |
| `backend/src/services/message.service.ts` | `requireReactable`（判定の順）、`addReaction`・`removeReaction`（共通の流れ`writeReaction`）。0行の後の分類を持つ |
| `backend/src/routes/messages.ts` | `POST /:messageId/reactions`（EP-1-12）、`DELETE /:messageId/reactions/:kind/:value`（EP-1-13）。本文・パスをzodで検査し、`isValidReaction`が偽なら422。422の応答に入力値を含めない |
| `backend/db/seeds/cleanup.sql` | `messages`・`users`を消す前に`message_reactions`を消し、残数`remaining_message_reactions`を返す |
| `docs/api/openapi.json`、`backend/src/openapi.test.ts` | 2つのエンドポイント（成功は200だけ）、`Reaction`、`MessageItem.reactions`。実装との一致を確かめる |

### フロントエンド（`frontend/src/features/messages/`）

| ファイル | 役割 |
| --- | --- |
| `api/message-api.ts` | `reactionSchema`（zod。`reactions`は必須）、`addReaction`・`removeReaction`（`value`はURLエンコードする） |
| `reaction-label.ts` | `reactionLabel`（表示する文字）・`describeReaction`（`title`と`aria-label`の文言。「<表示> <件数>人：<付けた人>」。退職者に「（退職者）」、50人を超えたら「ほか n 人」）。純粋な関数 |
| `hooks/useToggleReaction.ts` | 付ける・取り消す。同じ投稿への操作は投稿のIDごとに直列に送る（`mutation`の`scope`）。`useIsReactionPending`は、その投稿の送信中・待機中を、同じ投稿を出しているすべての表示（部屋とスレッド）で共有する |
| `hooks/replace-message-reactions.ts` | 応答の集計で、キャッシュの該当する1件の`reactions`だけを書き換える。`captureSession`が操作を始めたときのセッションを覚え、書き込む直前に同じか確かめる |
| `components/ReactionBar.tsx` | 1件の投稿のチップ、「リアクションを付ける」ボタン、スマートフォン用の「付けた人」ボタン。拒否のときの文言（`describeError`）を出す |
| `components/ReactionChip.tsx` | 1種類のチップ。`Button`（`aria-pressed`）。書き込めないとき・送信中は`disabled`にせず`aria-disabled`にする（フォーカスを残し、付けた人を読み上げで聞ける） |
| `components/ReactionPicker.tsx` | ポップオーバーの枠。分類のタブ（WAI-ARIAのTabs）と、中身（`EmojiGrid`か`StampList`）。Esc・枠の外のクリックで閉じる。20種類に達したときの案内を出す |
| `components/EmojiGrid.tsx` | 1分類の絵文字の`role="grid"`。1行の個数は、このファイルの定数`COLUMNS`の1か所（行の区切り・上下キーの幅・`aria-colcount`がすべて使う）。数は枠に収まる寸法で決め、設計書には書かない |
| `components/StampList.tsx` | 6つのスタンプの`Button`の並び |
| `components/ReactorsDialog.tsx` | スマートフォン用の「付けた人」の一覧（`<dialog>`。`DeleteMessageDialog`と同じ書き方） |
| `components/MessageItem.tsx`、`MessageList.tsx`、`RoomMessages.tsx`、`ThreadReplies.tsx` | `canReact`を渡し、本文の下に`ReactionBar`を置く。開いているピッカーは、`MessageList`（部屋）・`ThreadReplies`（スレッド）が投稿のIDで1つだけ持つ |
| `hooks/useDeleteMessage.ts` | 削除の結果の組み立てに`reactions: []`を足した |
| `frontend/src/features/auth/index.ts` | `SessionInfo`の型を公開した（書き戻しでの利用者の確認のため。`auth`は`messages`を読まないため循環しない） |

### テスト・seed

| 場所 | 内容 |
| --- | --- |
| `backend/src/lib/reaction-rules.test.ts` | 受け付ける・拒否する値、上限（リテラルの期待） |
| `backend/src/db/message-reactions.db.test.ts`、`cleanup-sql.reactions.db.test.ts` | SQL：付与・重複・21種類目・削除済み・本人の行だけの取り消し・部屋の条件が崩れたときの0行・集計（件数・並び・51人目の打ち切り・退職者）・cleanupの残数 |
| `backend/src/services/message.service.reactions.test.ts`、`routes/messages.reactions.test.ts` | 判定の順と応答、冪等、0行の後の競合、返信・お知らせ専用チャンネル、通知・未読が変わらないこと |
| `backend/test/reaction-fixtures.ts` | 上のテストの補助 |
| `frontend/src/features/messages/`の`messages.reactions*.test.tsx`、`components/Reaction*.test.tsx`・`EmojiGrid.columns.test.tsx`、`hooks/useToggleReaction*.test.tsx`・`replace-message-reactions.test.ts`・`useDeleteMessage.reactions.test.tsx`、`api/message-api.reactions.test.ts`、`reaction-label.test.ts` | 部品・キーボード・書き戻し・直列化・利用者の切り替え・`canReact`の出し分け・API |
| `frontend/src/test/reaction-handlers.ts` | 画面のテストのモック |
| `e2e/reactions.spec.ts`、`e2e/reaction-button.ts`、`e2e/seeds/reactions.sql`・`reactions-cleanup.sql` | 実ブラウザの確認（9件、直列）。一覧は[e2e.md](../testing/e2e.md) |

## 判定の順

`requireReactable`（付ける・取り消すで共通。この順を変えない）。

1. メッセージがあり、部屋が見える（DMは`perm.dm.message.view`、チャンネルは閲覧できるか）。違えば404。
2. 参加していない公開チャンネルは403（読めるが付けられない。C-94）。
3. `perm.reaction.manage.own`の認可（拒否は監査に残る）。
4. 削除済みの投稿は409。
5. 部署が無効、またはDMの相手が無効なら409。
6. 書き込み。SQLの`reactable`で、もう一度同じ条件を確かめる。

- 親の投稿にも返信にも同じ判定を使う。返信の場合は親が削除済みかを問わない。お知らせ専用チャンネルの投稿権限は問わない。
- `reactable`は`message-modify.sql.ts`の`modifiable`と同じ形で、「本人の投稿か」の条件だけがない。**部屋の条件を変えるときは、両方を直す**（両方のファイルの先頭のコメントで互いを参照する。共通化しないのは、本人の条件の有無で意味が違うため）。

## 書き込みと0行のときの扱い

- 追加は、`reactable`と「同じ種類がすでにある、または20種類未満」の条件付きの`INSERT … SELECT`。取り消しは、`user_id`が本人の行だけを`reactable`の条件付きで`DELETE`する（他人の行には触れない。R-36）。
- 書き込みと同じ`db.batch`の後ろで、同じ`reactable`の条件を付けて集計を読む。書き込みの`changes`と集計の2つを返す。条件が崩れていれば集計は0行になる。
- **0行のとき**（`writeReaction`）：
  1. `requireReactable`をやり直す。拒否の理由（404・403・409）があれば、その応答を返す。
  2. `loadReactionsIfReactable`で今の集計を読む。読み直しも`reactable`の条件付きで、条件が崩れていれば集計を返さず、`requireReactable`のやり直しで拒否するか、409「状態が変わりました。もう一度お試しください」にする（崩れた状態の集計を返さない）。
  3. すでに要求された状態なら成功にする：追加でもう付いている、取り消しですでに外れている。このときは最新の集計を200で返す（冪等）。
  4. 追加で、まだ付いていない種類が20種類に達していれば、409「リアクションは20種類までです」。
  5. どれでもない（別のタブなどで状態が変わった）ときは、書き込みを**1回だけ**やり直す。それでも0行で決まらなければ、409「状態が変わりました。もう一度お試しください」。繰り返さない。
- 拒否を成功扱いにしない。成功にするのは「すでに要求された状態」のときだけ。
- D1は書き込みを直列に実行するため、20種類の境界で同時に操作しても21種類目は入らない。

## 処理の流れ（画面）

1. 一覧・返信・スレッドの親の取得（EP-1-01・EP-1-07など）で、項目に`reactions`が含まれる。`MessageItem`の下の`ReactionBar`がチップを並べる。
2. チップを押す、またはピッカーで選ぶと、`useToggleReaction`が`addReaction`か`removeReaction`を呼ぶ（押した時点の`reactedByMe`で付ける・取り消すを決める）。同じ投稿の操作は投稿のIDごとに直列に送られる。
3. 成功（冪等の成功を含む）したら、`replaceMessageReactions`が応答の集計で、その投稿の`reactions`だけを書き換える。部屋の投稿は`messageKeys.room`、返信とスレッドの親は`messageKeys.thread`に書く。親の投稿は部屋とスレッドの両方に出るため、両方に書く。
4. 拒否（上限・削除済み・書き込めない部屋・見えない）と通信の失敗は、文言だけを`ReactionBar`に出す。取り直さない。成功扱いにもしない。
5. スレッド一覧（S-35）はリアクションを表示しないため、書き換えない（`messages`から`threads`を読まない。循環参照を作らない）。

## 書き戻しの安全

- 書き込む直前（`setQueryData`の更新の関数の中）で、操作を始めたときと今のセッションが同じかを確かめる。セッションのQuery本体と利用者IDの両方が同じでなければ、書かない。ログアウトを挟んだ同じ利用者の再ログインも、Queryが作り直されるため区別できる（`usePasswordChange`と同じ確かめ方）。
- キャッシュがなければ作らない（更新の関数が`undefined`を返す）。`clear()`の後に遅れて届いた応答でも、キャッシュは作られない。
- セッションの記録（`captureSession`）は、すべての待機より前（`mutate`を呼んだとき）に行う。外側の`useMutation`は`networkMode: "always"`でオフラインでも待たずに入り、オフラインの待機と順番待ちは内側（投稿のIDごとの`scope`の`mutation`）に集める。待っている間も`useIsReactionPending`は真。
- 直列に送るため、順番待ち・オフラインの待機の間に利用者が替わることがある。送信の直前にも`isSameSession`（`replace-message-reactions.ts`）でセッションの同一性を確かめ、替わっていたら送信を取りやめる（エラーにせず、キャッシュも変えない）。取りやめたときはエラーの表示を出さない（利用者が替わったので書かないのは正しい動作）。操作ごとの`mutation`の記録は、成功・失敗・取りやめのどれで終わっても、`MutationObserver`を`reset`して回収する（`gcTime: 0`）。
- 書かなかったときのログは出さない（正しい動作で、エラーではない。共通のロガーは#234）。
- 既存の編集・削除・投稿の書き戻しが利用者の切り替えを確かめていない件は、別のIssue（#265）で扱う。

## 画面の部品とキーボードの操作

- 「リアクションを付ける」は`aria-haspopup="dialog"`・`aria-expanded`の`Button`。開くとピッカー（`role="dialog"`）が開き、選ばれたタブにフォーカスが移る。Esc・枠の外のクリック・1つ選んだ後のどれでも閉じ、フォーカスを開いたボタンに戻す。開けるのは1つの投稿につき1つで、同時に1つだけ。
- **タブ**（WAI-ARIAのTabs）：順は「よく使う」「顔」「ハート・気持ち」「もの・その他」「スタンプ」。Tabで止まるのは選ばれたタブだけ（ローヴィングtabindex）。←→で移動と同時に選び、端では反対側につながる。Home・Endで最初・最後。
- **絵文字のグリッド**：Tabで止まるのは1セルだけ。←→は次・前のセルへ、行の端では次・前の行につながり、止まるのは一覧全体の最初と最後だけ。↑↓は行をまたいで移動し、端では動かない。Home・Endは行の最初・最後、Ctrl+Home・Ctrl+Endは最初・最後のセル。Enter・Spaceの両方で選ぶ（`Button`の既定の動き）。分類のタブを替えたら、フォーカスの位置は先頭に戻る。
- 1行のセルの個数は`EmojiGrid.tsx`の定数`COLUMNS`の1か所。枠に収まる寸法で決める。自分が付けたセルも`Button`のvariantは`ghost`のままで寸法が変わらない（variantを替えると幅が変わるため）。付けた印は、外側の`gridcell`の固定のクラス（背景と`ring`。レイアウトに影響しない）と`aria-pressed`で示す。**いちばん幅の広い状態**（同じ行のすべてのセルを自分で付けた状態）でスマートフォンの幅に収まることを、E2Eで確かめている。
- **20種類に達したとき**：まだ付いていない種類のセルは`aria-disabled="true"`にし、パネルの上に「リアクションは20種類までです」を`role="status"`で出す。すでに付いている種類は選べる（取り消す）。自分が付けた種類のセルは`aria-pressed`が真。
- **チップ**：`aria-pressed`が自分が付けたか。パソコンは`title`と`aria-label`で付けた人を示す。スマートフォン（`md`未満）は「付けた人」ボタン（`ReactorsDialog`）で一覧を出す。無効な社員には「（退職者）」を付ける。
- **`canReact`**：部屋（S-05・S-06）は`RoomMessages`の「今その部屋に書き込めるか」と同じ材料、スレッド（S-07）は`ThreadReplies`の`data.joined && data.roomWritable`から求め、親と返信に渡す。削除済みの行には出さない。偽のときはチップは読み取り専用で、ボタンは出ない。表示の制御だけで、認可はサーバーが毎回行う。
- `<dialog>`（`ReactorsDialog`）は、モーダルのままでは外の要素にフォーカスを戻せない。閉じる前に`<dialog>`自身を`close()`してから、呼び出し側がフォーカスを戻す（jsdomでは再現せず、E2Eで検出した）。
- スタイルはADR-0015に従う。クリックできる要素はすべて`Button`、並べ方は固定のユーティリティ、`style`属性・任意の値・新しい色を使わない。絵文字は端末のフォントで描く。

## 最初に読み込むJSの大きさ

ピッカーの動的な読み込みは行っていない（データは約80個の文字と日本語の名前で小さいため）。最初に読み込むJSはgzipで283,321B。目標の200KBは#138より前から超えており（ADR-0026の記録は273,411B）、#138で約9.9KB増えた。追跡は#160。

## 既知の制限

- **他の人のリアクションは、部屋・スレッドを開き直すと反映する**（U-10）。ポーリング（`after`）は新着の投稿だけを取り、既存の投稿のリアクションの変化を取らない。即時の反映は#117。
- 拒否（上限・削除済みなど）のあとの画面は、開き直すまで古いことがある。20種類の上限の表示が古いときは、操作すると409の文言が出る。
- スレッド一覧（S-35）にはリアクションを表示しない。
- 付けた人は1種類あたり最大50人まで届く（`count`は全数）。それを超える分は「ほか n 人」と示す。
- 本番DBへのmigration 0022の適用は未実施。物理削除（EP-2-39）を作るときは、この表の行も消す必要がある（外部キー）。
- 既存の編集・削除・投稿の書き戻しは、利用者の切り替えを確かめていない（#265）。

## 関係するIssue・ADR

- Issue #138（親：#133）。#137（返信。`reactions`はスレッド一覧の`toItem`にも含める）・#139（メンション。`reactions`も削除済みで隠す）・#117（リアルタイム化）・#160（初回JSの大きさ）・#234（フロントエンドのロガー）・#265（書き戻しの利用者の確認）。
- 決定：C-174（C-128の(2)(3)、C-144の1-7 AC-6、Q-93・Q-97）。C-94・C-138・C-90・C-81に従う。
- [ADR-0027](../adr/0027-self-made-emoji-picker.md)（自前のピッカー）、[ADR-0015](../adr/0015-style-foundation.md)（スタイル）、[ADR-0020](../adr/0020-test-scope-mutation-e2e.md)（ミューテーションとE2Eの範囲。共有定義・DB・`e2e/`の変更に当たる）。
- 関連する設計書：[messages.md](messages.md)・[threads.md](threads.md)・[message-edit-markdown.md](message-edit-markdown.md)・[mentions.md](mentions.md)。
