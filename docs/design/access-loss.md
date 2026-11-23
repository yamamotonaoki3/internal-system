# 設計書：資格を失ったときの、ページの読み込み直し（Issue #338。#323 の1つ目）

案件の画面（S-17）で資格を失ったと確定したら、いまの片付けの後に、ページの文書ごと読み込み直す。片付けが数え上げで消せないもの（部品の状態・進行中の処理の続き・メモリの中のすべて）を、実行環境ごと消すため。決定は C-206、判断の理由は[ADR-0033](../adr/0033-reload-page-after-access-loss.md)。API・DB は変えない（フロントエンドだけ）。

## 目的と範囲

- 目的：資格を失ったと確定した画面で、参加者だけの中身を、メモリに残さない。読み込み直した後に、理由の知らせを1回出す
- 範囲：S-17 の表示中に確定する場合（下の「呼ぶ場所と条件」）。呼ぶ場所は`frontend/src/features/cases/`にあり、この機能（`features/access-loss/`）は、待ち方・隠し方・知らせを持つ
- 範囲の外：S-17 の外での検出（#339）・bfcache（#342）・数え上げの方式の削除（#339〜#342 の後の別の Issue）。【#341（C-208）で、別のタブを範囲に加えた：下の「別のタブへの伝え方」。ただし、別のタブの全部を解消したわけではない（同じ節の「既知の限界」）】
- 【#340（C-207）で、下書きを範囲に加えた】資格を失った案件の部屋のメッセージの下書きを、端末から消す。消す処理そのものは`features/cases/`と`features/drafts/`にあり（[drafts.md](drafts.md)・[cases.md](cases.md)）、この機能は、**消せなかったときの、読み込み直した後の知らせ**（`noteDraftsRemain`・知らせの2つの種類）だけを持つ

## ファイルと役割

置き場所は`frontend/src/features/access-loss/`（以下、ファイル名だけ書く）。

| ファイル | 役割 |
| --- | --- |
| `reload-after-access-loss.ts` | 入口`requestAccessLossReload`と、状態（`idle`／`waiting`／`reloading`）の購読（`getAccessLossReloadState`・`subscribeAccessLossReloadState`）。待機の持ち主・合流・待ち方・取りやめ・読み込み先の決め方を持つ。状態は文書ごとに1つ。【#340】`noteDraftsRemain(ownerId)`：下書きを消せなかったことを、同じ持ち主の待機に印として付ける。入口の引数の理由（`AccessLossReloadRequest.reason`）は`lost`・`left`の2つに絞った（下書きの印を付けた種類は、読み込み直す直前に入口が決める） |
| `browser-location.ts` | `reloadPage`・`replacePage`。`window.location`を触るのは**ここだけ**（テストで差し替える点を1か所にするため） |
| `access-loss-notice.ts` | 読み込み直した後の知らせ。保存先（`sessionStorage`）の読み書き、出す・捨てる判定、購読。知らせの種類は`lost`・`left`・`lostDraftsRemain`・`leftDraftsRemain`の4つ（#340で後の2つを足した） |
| `components/AccessLossBoundary.tsx` | 境界。子（ルーター全体）を`hidden`と`inert`の包みで包み、`idle`以外で全画面の覆いを出す |
| `components/AccessLossNotice.tsx` | 知らせの表示（`Alert`と「閉じる」）。表示の判定は持たない |
| `access-loss-broadcast.ts` | 【#341。C-208】別のタブへの合図。チャンネルの名前・合図の形（Zod）・送る`announceCaseAccessLoss`・受ける`subscribeCaseAccessLoss`・チャンネルを遅れて作る処理・使えない環境の扱いを持つ。合図を**送るのはここだけ**（`BroadcastChannel`を触るのもここだけ）。保存先には何も書かない |
| `index.ts` | 公開部分。ほかの機能はここだけを通して使う。【#341】`announceCaseAccessLoss`・`subscribeCaseAccessLoss`・型`CaseAccessLossHint`を足した |
| `frontend/src/features/cases/case-access-loss-relay.ts` | 【#341】合図を受けたタブの処理`installCaseAccessLossRelay`。`features/cases/`にあり、`features/cases/index.ts`が公開する。入口・合図の受信は`access-loss`の公開部分を通して使う |
| `frontend/src/features/leave-guard/before-unload-suppression.ts` | 離脱の確認（`beforeunload`）を止めない印（`suppressBeforeUnload`・`restoreBeforeUnload`・`isBeforeUnloadSuppressed`）。`leave-guard/index.ts`から前の2つを公開し、`hooks/useLeaveGuard.ts`の`beforeunload`の処理が印を読む。立てる・外すのは入口だけ |
| `frontend/src/services/api-client.ts` | 進行中の**書き込みの要求**（GET・HEAD・OPTIONS 以外）の数を数える口（`getPendingWriteCount`・`subscribePendingWrites`）。リクエストのインターセプターで、実際の送信（アダプター）を包み、増減は`try`/`finally`で必ず戻す。持つのは**数だけ**（本文・URL・応答を覚えない）。`useMutation`を使わない送信（パスワードの変更・ログイン・再認証・アカウントの作成・初期設定など。`MutationCache`に載らない）も、入口の待つ対象になる。入口だけが使う口で、通常の機能は直接使わない |
| `frontend/src/main.tsx` | `QueryClientProvider`の中で、`RouterProvider`を`AccessLossBoundary`で包む（`LeaveGuardProvider`は、ルーターの要素として`App`を包んでいるので、境界はその外側になり、離脱の確認も隠れる）。描画の前に`takeAccessLossNotice`を1回呼ぶ。【#341】`takeAccessLossNotice`の後に、`installCaseAccessLossRelay(queryClient)`を1回だけ呼ぶ（解除しない）。登録の想定外の失敗は、`main.tsx`で受け止めて`reportError`に渡し、アプリの描画は止めない |
| `frontend/src/features/app-shell/AppShell.tsx` | `LogoutFailureNotice`の直後に`AccessLossNotice`を置く |

## 呼ぶ場所と条件

呼び出し側の詳細は[cases.md](cases.md)の「資格を失ったときの画面の切り替え（#308）」の「読み込み直し（#338）」にある。入口は、いずれも**片付けの後**（退出だけは前。下の「本人の退出」）に呼ぶ。

## 入口の流れ（`requestAccessLossReload(queryClient, { ownerId, reason, leftCasePath? })`）

持ち主は、確定を始めた時点の利用者（画面の`userId`。退出は押した時点の`actorId`）。理由は`lost`か`left`。

1. いまのセッションの利用者が分かっていて持ち主と違えば、何もしない。セッションが無いときは続ける
2. 状態が`reloading`なら何もしない。`waiting`で持ち主が同じなら**合流**する（同じ文書の同じ持ち主は1回にまとめる）。合流では、理由は`left`を優先し、`left`のときは退出した案件の場所（`leftCasePath`）を持つ。持ち主が違えば、古い待機を取りやめてから続ける
3. `waiting`にし、離脱の確認の抑止を立てる。セッションのキャッシュを購読し、いまの利用者が持ち主と**別の利用者**になった時点で取りやめる（`idle`に戻し、抑止を外し、購読とタイマーを外す）。セッションが無くなるだけでは取りやめない（401・ログアウトの後も続ける）
4. 進行中の操作を待つ（判定は`mustWait()`）。
   - 上限なし：状態が`pending`の、ログアウトの操作のうち、押した時点の利用者（`useLogout`が操作の文脈に持つ）が持ち主と同じもの。その操作が`pending`でなくなる（成功・失敗の後処理が済む）まで待つ。セッションの消失は待ちの終わりの合図にしない
   - 上限5秒（定数`WAIT_LIMIT_MS`）：それ以外の、`MutationCache`の`pending`の操作すべて（ほかの利用者のログアウトを含む）と、`services/api-client.ts`が数える進行中の書き込みの要求（`MutationCache`に載らない直接の送信）。上限は**最初の要求から数え、延ばさない**。上限の後は、持ち主のログアウトだけを待つ
   - 待ちの終わりは、`MutationCache`・進行中の書き込みの数の購読と、上限のタイマーの知らせで確かめ直す
5. 待つものが無くなったら、1つ後のタスクまで待つ（操作の完了の後に続く処理、たとえば`mutateAsync`・`await`の続きの下書きの消去を、先に走らせるため）
6. **実行の直前に、もう一度`mustWait()`で確かめる**。予約の後に始まった操作（離脱の確認の解除で始まるログアウトなど）があれば、待機に戻る（読み込み直しを予約した後も、待機は終わっていない）。そのうえで、利用者を比べる（別の利用者なら取りやめ）。セッションがあれば、知らせの種類を書く（【#340】待機に下書きの印があれば、`lost`・`left`の代わりに`lostDraftsRemain`・`leftDraftsRemain`を書く）
7. 状態を`reloading`にし（以後`idle`に戻らない）、読み込み先を決める：理由が`left`で、いまの場所が、退出した案件の S-17 か`/cases`なら、`/cases`へ置き換える（`replacePage`）。それ以外は、いまの場所を読み込み直す（`reloadPage`）。読み込み先は、読み込み直す時点で決める（退出の後の一覧への移動より先に読み込み直しても、`/cases`になるため）

時間による歯止めは持たない。読み込み直した後の文書で同じ喪失を繰り返さないのは、呼ぶ条件（参加者だったことを見た後に限る）による。

## 境界（`AccessLossBoundary`）

- `main.tsx`で`RouterProvider`を包む。状態が`idle`以外（`waiting`・`reloading`の両方）のとき、子を包む`div`に`hidden`と`inert`を付け、全画面の覆い（`dialog`を`showModal()`で開く。見出し「画面を読み込み直しています」）だけを出す
- `hidden`（`display: none`）で、ルーターの下のモーダル・popover（最上位の層）と、後から開くもの（離脱の確認`LeaveConfirmDialog`・再認証`ReauthDialog`）も描画から外す。`inert`だけでは、モーダルは祖先の`inert`を引き継がないため、`hidden`も必要
- 覆いは`cancel`（Esc）を止め、`close`されたら開き直す。`idle`に戻れば外れる
- 持ち主のログアウトを待つ間に`/login`へ移っても、覆いは外さない（後処理の後に読み込み直すため。ログイン画面は操作できない）
- 状態は外部ストア（`useSyncExternalStore`）で読む。境界は、`hidden`・`inert`で隠す仕組みを持つだけで、認可ではない

## 離脱の確認の抑止

`hooks/useLeaveGuard.ts`の`beforeunload`の処理は、印（`isBeforeUnloadSuppressed`）が立っていれば止めない。アプリ内の離脱の確認は、境界が描画から外すので出ない。印は入口が`waiting`にしたときに立て、取りやめたときに外す（`reloading`では外さない）。

## 知らせ（`access-loss-notice.ts`）

- 書く：読み込み直す直前に、入口が`writeAccessLossNotice(kind)`を呼ぶ。保存するのは**種類（`lost`・`left`・`lostDraftsRemain`・`leftDraftsRemain`）だけ**（キーは1つの const。利用者の ID・案件の中身は、値にもキーにも入れない。Skill「security」）。保存先は`sessionStorage`
- 読む：`main.tsx`が、描画の前に`takeAccessLossNotice(queryClient)`を1回呼ぶ。読んで消し、この文書で出す知らせとして持つ。決めた種類以外の値は無視する
- 出す：`AccessLossNotice`が、知らせを1つ出す。退出は「案件から退出しました。」、喪失は「この案件を表示できなくなったため、画面を読み込み直しました。保存していない入力は消えています。」。「閉じる」で消える
- 【#340（C-207）】下書きを消せなかったときの知らせ：片付けの後の、その案件の部屋の下書きの消去が「消せなかった」（保存先を開けない・削除が使えない例外）とき、呼び出し側（`useCaseAccessLoss`・`useRemoveCaseParticipant`）が`noteDraftsRemain(持ち主のID)`を呼ぶ。待機がある・持ち主が同じ・読み込み直しがまだ始まっていないときだけ、待機に印が付く。待機がない・持ち主が違う（前の利用者の知らせを次の利用者に出さない）・`reloading`の後は何もしない。印があれば、知らせの種類が次のようになる。文は、`lost`・`left`の文に、書きかけが残っている可能性の案内を続けたもの。**「ログアウトすると消えます」とは言い切らない**（保存先が使えないままなら、ログアウトでも消せないため。利用者の決定。2026-11-22 の Q3）：

| 種類 | 文の要点 |
| --- | --- |
| `lost` | 「この案件を表示できなくなったため、画面を読み込み直しました。保存していない入力は消えています。」 |
| `left` | 「案件から退出しました。」 |
| `lostDraftsRemain` | `lost`の文に続けて、この案件のメッセージの書きかけが、この端末に残っている可能性があること、共用の端末では、ブラウザの設定から、このサイトのサイトデータを削除すること |
| `leftDraftsRemain` | `left`の文に続けて、上と同じ案内 |

  - 中身（下書きの本文・キー・部屋のID・利用者のID）は、知らせにも保存先にも入れない。ログには残さない（画面の側のログの仕組みは#372）。知らせの保存自体が失敗したときは、これまでどおり知らせなしで読み込み直す（利用者には伝わらない）
- 捨てる：(1) 最初のセッションの確認が成功する前に、未認証（401）が確定した、またはセッションのクエリが消された（次にログインする別の人に出さない） (2) この文書で最初に確定した利用者から、別の利用者に替わった (3) 「閉じる」。セッションが無い間は出さない
- 保存先の失敗の扱い（`draft-storage.ts`と同じ考え方）：受け止めるのは「保存先が使えない」ことを表す例外だけ。保存先の参照（`openNoticeStorage`）・読み・消しは`SecurityError`だけ「保存先なし・知らせなし」とする。書きは`SecurityError`と`QuotaExceededError`だけ、知らせを諦めて（`false`を返す）読み込み直しを続ける。ほかの例外は投げ直す
- 書きの失敗のログ：書きの失敗を受け止めたときも、ログには残さない（利用者の決定。#340 の Q3、2026-11-22。C-207）。フロントエンドには、エラーをログに出す仕組みがないため。画面の側のログの仕組みは #372 で扱う。【以前は「未決定」と書いていたが、#340 の決定で決まった】
- 【#341。C-208】別のタブから届いた知らせの扱い：別のタブの喪失で読み込み直した場合も、知らせの種類は`lost`（本人が別のタブで退出した場合も同じ。利用者の決定の Q2）。入口の呼び出しの`reason`は`lost`で、保存先に書くのは、これまでどおり種類だけ

## 別のタブへの伝え方（Issue #341。C-208。[ADR-0034](../adr/0034-cross-tab-access-loss-hint.md)）

資格を失ったと確定したタブから、同じ保存の区画（同じブラウザ・同じプロファイル）のほかのタブへ、**確かめのきっかけ**を伝える。API・DB は変えない（フロントエンドだけ）。伝える仕組みは表示の側の後片付けで、認可ではない（サーバーの認可は変えない）。

- 使うもの：ブラウザに組み込みの`BroadcastChannel`だけ（利用者の決定の Q1）。**資格の喪失の確かめのきっかけにだけ**使い、ログアウト・利用者の切り替え（#298）には広げない。`storage`イベントは使わない。下書きの設計の「`BroadcastChannel`は入れない」（#239）は、その範囲では、そのまま（[drafts.md](drafts.md)）
- 合図は、受けたタブの**根拠にならない**。同じ Cookie を共有するタブでは、画面の利用者と通信の利用者が食い違いうる（#298・#376）ため、受けたタブは、自分で確かめ直し、消さずに、隠して読み込み直すだけにする

### 合図（`access-loss-broadcast.ts`）

- チャンネルの名前は、1つの定数（`ACCESS_LOSS_CHANNEL_NAME`。値は`internal-system:access-loss:v1`）。送る値は、版（`v`。1）・確定を始めた利用者の ID（`userId`）・案件の ID（`caseId`）の**3つだけ**。理由（`lost`・`left`）・部屋の ID・件名・名前・案件の中身は載せない。保存先に何も書かない
- 受けた値は、外部からの入力として Zod（`hintSchema`）で検証する。形の違う値・知らない版・ほかの名前のチャンネルの値は、購読者に渡さず捨てる（エラーではない入力の選別）
- チャンネルは、文書ごとに1つ。**最初の送受信のときに作る**（読み込んだだけでは作らない）。`BroadcastChannel`が関数でない環境、作るときに`SecurityError`が出た環境では、「使えない」と覚え、送受信を何もしない（作り直さない）。`SecurityError`以外の例外は、もみ消さない
- `announceCaseAccessLoss({ userId, caseId })`：投げない。送るときの想定外の例外（チャンネルを作る・`postMessage`）は、`reportError`に渡す（利用者の決定の Q5）。続く下書きの消去を止めないため
- `subscribeCaseAccessLoss(listener)`：検証を通った合図を`listener`に渡し、解除の関数を返す。使えない環境では何もしない関数を返す。チャンネルを作るときの想定外の例外は、投げる

### 送る場所（確定したときだけ）

呼ぶのは`useCaseAccessLoss.ts`と`useCaseWrites.ts`の`useRemoveCaseParticipant`だけ。順序は**入口（`requestAccessLossReload`）→ 合図 → 下書きの消去**。合図を送った印`lossAnnounced`は、読み込み直しの予約の印`reloadRequested`とは**別**（確かめられない`unverified`で予約した後に確定した場合も、伝えるため）。どちらも部品ごとの印で、`lossAnnounced`は、非参加から参加者に戻ったときだけ外す。送る処理は`announceLossOnce`に分けた（`requestReloadOnce`は変えない）。

| 経路 | 確定か | 合図 |
| --- | --- | --- |
| (a) 拒否の後の確かめ（`settle`）で非参加（`lost`）・404（`notFound`）。表示中も、画面を離れた後も | 確定 | 送る（印が偽のときだけ。1つの確かめで1回） |
| (a) 確かめられない（`unverified`。5xx・通信の失敗）。入口は呼ぶ | 確定でない | **送らない**（印も立てない） |
| (b) 効果の中の、この画面で参加者だったことを見た後に非参加になった枝（`lostHere`） | 確定 | 送る。`reloadRequested`が立っていても、`lossAnnounced`だけで決める |
| `unverified`で予約した後に、待機中・再試行・概要の取り直しで、非参加・404 が確定 | 確定 | 送る（1回）。読み込み直しは入口で1回に合流する |
| 待機中に2回目の確定（`lost`の後に (b) も通る） | 確定（2回目） | 送らない（印が真） |
| (c) 本人の退出の成功（`useRemoveCaseParticipant`の`onSuccess`。ほかの人を外す場合は送らない） | 確定 | 送る（入口の後、`forgetCaseAfterLeave`の前。利用者は押した時点の`actorId`）。表示中なら、退出の片付けが概要を非参加に書き、部品の (b) も通るので、**合わせて1〜2回**送りうる |
| 参加者に戻った後の、再びの喪失 | 確定 | 送る（戻ったときに印を外すため） |
| 退出の失敗・参加者のままの 403・参加者だったことを見ていない非参加（最初から非参加・古い非参加の概要・作り直しの経路） | 確定でない | 送らない |
| 受けたタブ（中継） | — | 送り返さない |

### 受けたタブの処理（`case-access-loss-relay.ts`の`installCaseAccessLossRelay(queryClient)`）

`main.tsx`で1回だけ登録する。合図ごとに、次の順で進める。

1. 入口の状態が`idle`でなければ捨てる（自分が待機・読み込み直しの最中）
2. 合図の利用者が、セッションのキャッシュの利用者と同じでなければ捨てる（無い場合も捨てる。通信しない）
3. `caseKeys.summary(利用者, 案件)`のキャッシュが、参加者（`isParticipant === true`）でなければ捨てる（通信しない）。**その案件を表示していないタブでも、概要を持っていれば確かめる**（利用者の決定の Q3）。画面の部品の`participantSeen`には頼らない（概要が 500 の後に画面を作り直すと、キャッシュは参加者でも部品は見ていないため）
4. 同じ案件の確かめが進行中なら捨てる（案件ごとの印。終わったら外す。確かめが 500 で終わった後に次の合図が届けば、もう一度確かめる）
5. `fetchCaseSummary`を**直接**呼び、概要をキャッシュの**外**で1回取る（キャッシュに書かない。表示中の画面の判定を、この答えで動かさず、表示も変えないため）
6. `judgeHintedSummary`で判定する。成功して非参加、または 404：「非参加」。成功して参加者：「参加者」。API の失敗（`isApiError`の、404 以外：5xx・403・401・通信の失敗・時間切れ）：「分からない」。それ以外（応答の検証の失敗・実装の例外）：投げる
7. 「非参加」のときだけ、もう一度、入口が`idle`で、セッションの利用者が合図の利用者と同じかを確かめ（確かめの間の切り替え・待機への移行を捨てる）、`requestAccessLossReload(queryClient, { ownerId: 合図の利用者, reason: "lost" })`を呼ぶ。表示中の部品が同じ喪失で入口を呼んでも、同じ持ち主の待機に合流する
8. 「参加者」「分からない」のときは何もしない（表示も変わらない）。**片付け（`forgetCaseContent`など）・下書きの消去・合図の送り返しは、しない**（読み込み直しで文書ごと消える。下書きは、確かめた答えの利用者を証明できないため、消さない）
9. 購読の処理の終わりで、投げられたもの（6 の「投げる」・実装の例外）は`reportError`に渡す（もみ消さず、未処理の`Promise`にもしない。利用者の決定の Q5）

同時に検出しても、各タブの入口は文書ごとに1回で、読み込み直しの繰り返しにならない（受けたタブは、入口が`idle`でなければ捨て、読み込み直した後の文書は参加者の概要を持たないので捨てる。中継は送り返さない）。

### 失敗の扱い

- `BroadcastChannel`が使えない・`SecurityError`：送受信しない。これまでどおり、各タブが自分の通信で検出する
- 送る側の想定外の例外：`reportError`（呼び出し元に投げない）。受ける側の登録の想定外の例外：`main.tsx`で`reportError`（描画は止めない）。判定の想定外の例外：`reportError`
- 受けた値の検証の失敗：捨てる（エラーではない）
- 画面の側のログの仕組みは #372。`reportError`は、ブラウザの標準のエラーの報告（`window`の`error`イベントと開発者ツール）で、E2E の`console-guard`が検出する

### 既知の限界

「別のタブの全部を、解消した」とは言えない。

- **参加者の概要を持たないタブ**：一覧・スレッド・検索などに、案件の中身が残りうる（#339）。通信もしない
- **別のタブの下書きの書き戻し**（#340 の限界）：受けたタブは下書きを消さない。受けたタブが、非参加・404 で入口に進んだ場合だけ、入口が待機に入ると入力欄が隠れ、書き戻しの隙間が縮む。入口に進む処理がなく、入力欄が操作できる状態（確かめが 5xx・通信の失敗・参加者のまま、合図を捨てた、`BroadcastChannel`が使えない）では、書き戻しが続く。残った下書きは、保存から7日・ログアウトで消える（[drafts.md](drafts.md)）
- **後から確定した場合**：画面を離れた後に、確かめられないまま終わり、作り直した画面で、後から確定した場合は、合図を送らない（参加者だったことを見ていないため。ADR-0033 の「作り直しの経路」と同じ）
- **`BroadcastChannel`が使えない環境**・別の保存の区画（別のブラウザ・プロファイル・プライベートウィンドウ）：これまでどおり
- **取り違え（画面の利用者と通信の利用者が食い違うタブ。#376 と同じ条件）で読み込み直した場合**：読み込み直した後の文書が、セッションの確認で別の利用者を受けると、種類だけの知らせ（`lost`。案件の中身は含まない）が、その別の利用者に、1回出る（`access-loss-notice.ts`は、最初に確定した利用者が誰かを問わないため。「閉じる」で消える）。その動きを、`access-loss-notice.test.tsx`で、既知の動きとして固定している
- **この Issue の範囲の外**：画面の利用者と通信の利用者が食い違うタブでの取り違え（#376。#341 の次に、優先して直す）、書き込みの取り違え（#298）
- bfcache（#342）

## 関連する既存の機能との関係

- 利用者の切り替え（[ADR-0030](../adr/0030-clear-cache-on-user-switch.md)）：`installUserSwitchGuard`は変えない。待機は、別の利用者に替わったら取りやめる。片付け（キャッシュと完了した操作の記録の消去）は読み込み直しの前に済んでいる
- 401・ログアウト：`useLogout`・未認証の処理（`unauthenticated-handler.ts`）は変えない。セッションが消えるだけでは待機を取りやめない
- 画面のテストでは、入口を`frontend/src/test/setup.ts`で`vi.fn`に差し替えている（待機の状態・購読・タイマーがテストの間に残らないように）。本物を確かめるテストは`vi.unmock`する
- 【#341】画面のテストでは、`BroadcastChannel`も`frontend/src/test/setup.ts`で、テスト専用の`frontend/src/test/fake-broadcast-channel.ts`の`FakeBroadcastChannel`に差し替え、jsdom にない`reportError`を補っている（`window`の`error`イベントにする）。送る関数そのものは差し替えず、送った値を、差し替えのチャンネルの記録で数える。本物の`BroadcastChannel`は、閉じないとテストの間で値が混ざりうるため。実ブラウザでの配信は E2E で確かめる

## 主な関数の入力と出力

| 関数 | 入力 | 出力・効果 |
| --- | --- | --- |
| `requestAccessLossReload` | `QueryClient`・`{ ownerId, reason, leftCasePath? }` | `Promise<void>`（読み込み直したか取りやめたときに解決）。呼んだその場では読み込み直さない |
| `getAccessLossReloadState`・`subscribeAccessLossReloadState` | なし／リスナー | 状態`idle`・`waiting`・`reloading`と、購読の解除関数 |
| `noteDraftsRemain`（#340） | 持ち主の利用者ID | なし。同じ持ち主の待機があれば、下書きの印を付ける。それ以外は何もしない |
| `announceCaseAccessLoss`（#341） | `{ userId, caseId }` | なし。投げない（想定外の例外は`reportError`）。使えない環境では何もしない |
| `subscribeCaseAccessLoss`（#341） | リスナー（検証を通った`{ userId, caseId }`を受ける） | 解除の関数。使えない環境では何もしない関数 |
| `installCaseAccessLossRelay`（#341。`features/cases/`） | `QueryClient` | 解除の関数。受けたタブの確かめと、入口の呼び出し（上の「受けたタブの処理」） |
| `writeAccessLossNotice` | 種類 | 書けたか（`boolean`） |
| `takeAccessLossNotice` | `QueryClient` | 読んだ種類（`null`なら知らせなし）。副作用として、出す知らせを持ち、セッションの変化を購読する |
| `openNoticeStorage` | なし | `Storage`か`null`（`SecurityError`のとき） |
| `reloadPage`・`replacePage` | なし／行き先 | `window.location`の操作 |

## テストの場所

- 入口の単体：`frontend/src/features/access-loss/reload-after-access-loss.test.ts`（偽の時計・`browser-location`の差し替え。持ち主・合流・待ち方・5秒の上限・ログアウト・利用者の切り替え・取りやめ・読み込み先）
- 知らせ：`frontend/src/features/access-loss/access-loss-notice.test.tsx`（種類だけの保存・保存先の失敗・捨てる条件・「閉じる」。#340：新しい2つの種類を読んで出すこと、決めた種類以外は無視すること）。入口の単体の`reload-after-access-loss.test.ts`には、#340で、下書きの印（`noteDraftsRemain`）の確かめを足した（持ち主が同じなら`…DraftsRemain`を書く・持ち主が違う・待機がない・取りやめの後は書かない）
- 境界：`frontend/src/features/access-loss/components/AccessLossBoundary.test.tsx`（`hidden`・`inert`・覆い・Esc・開き直し）
- 離脱の確認の抑止：`frontend/src/features/leave-guard/leave-guard.suppress.test.tsx`
- 進行中の書き込みの数：`frontend/src/services/api-client.pending-writes.test.ts`（書き込みのメソッドだけ数える・読み取りは数えない・失敗・取り消しでも必ず減る）
- 画面：`frontend/src/pages/CaseAccessLossReload.test.tsx`（P-10d を含む。きっかけごとに、片付けの後に入口が呼ばれる・呼ばれない。退出の理由と場所・持ち主）、`CaseAccessLossReload.directWrite.test.tsx`（`MutationCache`に載らない直接の送信を保留している間は読み込み直さない）、`CaseAccessLossReload.waiting.test.tsx`（実際の入力欄で投稿を保留したまま外される・保存先の知らせの表示）、`CaseAccessLossReload.drafts.test.tsx`（#340。保留を403で失敗させても、読み込み直す時点で下書きが無い。消せなかったとき、読み込み直す時点の知らせの種類が`lostDraftsRemain`になる）
- E2E：`e2e/case-access-loss-reload.spec.ts`（実際の読み込み直し・最上位の層が隠れる・Tab・Esc・「戻る」・`beforeunload`。[e2e.md](../testing/e2e.md)）
- 【#341。C-208】別のタブへの伝え方
  - 合図の単体：`frontend/src/features/access-loss/access-loss-broadcast.test.ts`（送る値のキーが`v`・`userId`・`caseId`だけ・保存先に書かない・遅れて作る・形の違う値と知らない版とほかの名前を捨てる・使えない環境〔機能なし・`SecurityError`〕・想定外の例外〔送る側は`reportError`、受ける側は投げる〕）
  - 受けたタブの単体：`frontend/src/features/cases/case-access-loss-relay.test.ts`（利用者が違う・セッションなし・参加者の概要がない・非参加の概要では通信しない／参加者のまま・500・403・通信の失敗では入口を呼ばない・概要のキャッシュを書き換えない・中身と下書きを消さない／非参加・404 で入口を`{ ownerId, reason: "lost" }`で1回呼ぶ／確かめの間の切り替え・ログアウト・入口の状態変化／重なり・解除／応答の検証の失敗は`reportError`）
  - 画面：`frontend/src/pages/CaseAccessLossCrossTab.test.tsx`（表示中の S-17 が受ける・500・画面は A で通信の利用者は B の状態〔入口だけ呼ばれ、下書きとキャッシュは残る〕・参加者を見ていない作り直した画面・書き戻しの限界を固定・退出の合図を受けたタブの読み込み直しは1回）、`CaseAccessLossCrossTab.limit.test.tsx`（本物の入口で、待機に入った後は入力欄に届かない）
  - 送る側：`frontend/src/pages/CaseAccessLossReload.test.tsx`の末尾の`describe`（送る・送らない経路、順序、`unverified`の後の確定、参加者に戻った後の再びの喪失）、`frontend/src/features/cases/hooks/useParticipantWrites.leave.test.tsx`（退出の成功だけ送る・失敗・ほかの人を外す場合は送らない・送信の例外でも退出は成功のまま）、`access-loss-notice.test.tsx`（取り違えた場合の知らせの既知の動きの固定）
  - テスト専用のチャンネル：`frontend/src/test/fake-broadcast-channel.ts`（`FakeBroadcastChannel`・ほかのタブから送る`postFromOtherTab`・`flushTasks`）。`frontend/src/test/setup.ts`が差し替える
  - E2E：`e2e/case-access-loss-cross-tab.spec.ts`（2件。実ブラウザの同じコンテキストの3ページで、合図を受けたタブが、自分の更新を止めた状態でも、概要を1回取り直して読み込み直される。対照は、合図の経路を止めると動かない。[e2e.md](../testing/e2e.md)）
  - 既存のテストの期待は変えていない（既存の2つのテストのファイルには、準備と、末尾の`describe`を足しただけ）

## 関係するIssueとADR

- Issue #338（親 #323）。依存：#363（(b) の判定）。後続：#339（S-17 の外での検出）・#340（下書き。済み）・#341（別のタブ。済み。ただし限界あり）・#342（bfcache）
- Issue #340（親 #323）：消せなかった下書きの知らせ。画面の側のログの仕組みは#372
- Issue #341（親 #323）：別のタブへの合図。関連：#298（別のタブでの利用者の切り替え。未決定）・#376（画面の利用者と通信の利用者が食い違うタブでの取り違え。#341 の次に優先して直す）
- 決定：C-206・C-207・C-208（[decision-register.md](../requirements/decision-register.md)）、C-190
- [ADR-0033](../adr/0033-reload-page-after-access-loss.md)、[ADR-0034](../adr/0034-cross-tab-access-loss-hint.md)、[ADR-0030](../adr/0030-clear-cache-on-user-switch.md)
- 設計書：[cases.md](cases.md)・[app-shell.md](app-shell.md)・[drafts.md](drafts.md)・[auth-session.md](auth-session.md)
