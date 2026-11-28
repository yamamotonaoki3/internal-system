# 設計書：資格を失ったときの、ページの読み込み直し（Issue #338。#323 の1つ目）

案件の画面（S-17）で資格を失ったと確定したら、いまの片付けの後に、ページの文書ごと読み込み直す。片付けが数え上げで消せないもの（部品の状態・進行中の処理の続き・メモリの中のすべて）を、実行環境ごと消すため。決定は C-206、判断の理由は[ADR-0033](../adr/0033-reload-page-after-access-loss.md)。API・DB は変えない（フロントエンドだけ）。

## 目的と範囲

- 目的：資格を失ったと確定した画面で、参加者だけの中身を、メモリに残さない。読み込み直した後に、理由の知らせを1回出す
- 範囲：S-17 の表示中に確定する場合（下の「呼ぶ場所と条件」）。呼ぶ場所は`frontend/src/features/cases/`にあり、この機能（`features/access-loss/`）は、待ち方・隠し方・知らせを持つ
- 範囲の外：S-17 の外での検出（#339）・bfcache（#342）・数え上げの方式の削除（#339〜#342 の後の別の Issue）。【#341（C-208）で、別のタブを範囲に加えた：下の「別のタブへの伝え方」。ただし、別のタブの全部を解消したわけではない（同じ節の「既知の限界」）】【#339（C-210）で、S-17 の外での検出を範囲に加えた：下の「S-17 の外での検出」。検索だけの経路は別の Issue（#388） で、範囲の外のまま。元の記述は残す】【#342 の 342-A（C-212。[ADR-0038](../adr/0038-bfcache-access-check.md)）で、bfcache（「戻る」で文書が丸ごと戻る場合）を範囲に加えた：下の「bfcache の復元の守り」。実際の復元の確かめは、まだ行っていない。元の記述は残す】
- 【#340（C-207）で、下書きを範囲に加えた】資格を失った案件の部屋のメッセージの下書きを、端末から消す。消す処理そのものは`features/cases/`と`features/drafts/`にあり（[drafts.md](drafts.md)・[cases.md](cases.md)）、この機能は、**消せなかったときの、読み込み直した後の知らせ**（`noteDraftsRemain`・知らせの2つの種類）だけを持つ

## ファイルと役割

置き場所は`frontend/src/features/access-loss/`（以下、ファイル名だけ書く）。

| ファイル | 役割 |
| --- | --- |
| `reload-after-access-loss.ts` | 入口`requestAccessLossReload`と、状態（`idle`／`waiting`／`reloading`）の購読（`getAccessLossReloadState`・`subscribeAccessLossReloadState`）。待機の持ち主・合流・待ち方・取りやめ・読み込み先の決め方を持つ。状態は文書ごとに1つ。【#340】`noteDraftsRemain(ownerId)`：下書きを消せなかったことを、同じ持ち主の待機に印として付ける。入口の引数の理由（`AccessLossReloadRequest.reason`）は`lost`・`left`の2つに絞った（下書きの印を付けた種類は、読み込み直す直前に入口が決める） |
| `reload-after-access-loss.ts`（【Issue #298。C-209】追加分） | 別の入口`requestUserSwitchReload(queryClient)`と、`isUserSwitchReloadRequested()`。別の利用者に替わったと分かったときの読み込み直し。#338 の状態・覆い・離脱の確認の抑止・5秒の待ち方を使い回し、持ち主・取りやめ・知らせ・読み込み先の決め方は使わない。#338 の待機は、`Waiting`の`handOver`で引き継ぐ。下の「利用者の切り替えでの読み込み直し」 |
| `browser-location.ts` | `reloadPage`・`replacePage`。`window.location`を触るのは**ここだけ**（テストで差し替える点を1か所にするため） |
| `access-loss-notice.ts` | 読み込み直した後の知らせ。保存先（`sessionStorage`）の読み書き、出す・捨てる判定、購読。知らせの種類は`lost`・`left`・`lostDraftsRemain`・`leftDraftsRemain`の4つ（#340で後の2つを足した）。【#298】`clearAccessLossNotice()`：保存済みの知らせを、読まずに消す（利用者の切り替えで読み込み直す前。保存先が使えない`SecurityError`は、消せなくてよい） |
| `components/AccessLossBoundary.tsx` | 境界。子（ルーター全体）を`hidden`と`inert`の包みで包み、`idle`以外で全画面の覆いを出す |
| `components/AccessLossNotice.tsx` | 知らせの表示（`Alert`と「閉じる」）。表示の判定は持たない |
| `access-loss-broadcast.ts` | 【#341。C-208】別のタブへの合図。チャンネルの名前・合図の形（Zod）・送る`announceCaseAccessLoss`・受ける`subscribeCaseAccessLoss`・チャンネルを遅れて作る処理・使えない環境の扱いを持つ。合図を**送るのはここだけ**（`BroadcastChannel`を触るのもここだけ）。保存先には何も書かない |
| `index.ts` | 公開部分。ほかの機能はここだけを通して使う。【#341】`announceCaseAccessLoss`・`subscribeCaseAccessLoss`・型`CaseAccessLossHint`を足した |
| `frontend/src/features/cases/case-access-loss-relay.ts` | 【#341】合図を受けたタブの処理`installCaseAccessLossRelay`。`features/cases/`にあり、`features/cases/index.ts`が公開する。入口・合図の受信は`access-loss`の公開部分を通して使う |
| `frontend/src/features/cases/case-access-evidence.ts`・`case-access-verification.ts`・`case-access-loss-monitor.ts` | 【#339。C-210】S-17 の外での検出。実績の読み取り・資格の確かめと5種類の判定・画面の外の見張りと確定。`features/cases/`にあり、見張りの登録`installCaseAccessLossMonitor`は`features/cases/index.ts`が公開する。役割の詳細は、下の「S-17 の外での検出」 |
| `frontend/src/features/leave-guard/before-unload-suppression.ts` | 離脱の確認（`beforeunload`）を止めない印（`suppressBeforeUnload`・`restoreBeforeUnload`・`isBeforeUnloadSuppressed`）。`leave-guard/index.ts`から公開し（【#298】`isBeforeUnloadSuppressed`も公開した）、`hooks/useLeaveGuard.ts`の`beforeunload`の処理が印を読む。立てる・外すのは入口だけ |
| `frontend/src/services/api-client.ts` | 進行中の**書き込みの要求**（GET・HEAD・OPTIONS 以外）の数を数える口（`getPendingWriteCount`・`subscribePendingWrites`）。リクエストのインターセプターで、実際の送信（アダプター）を包み、増減は`try`/`finally`で必ず戻す。持つのは**数だけ**（本文・URL・応答を覚えない）。`useMutation`を使わない送信（パスワードの変更・ログイン・再認証・アカウントの作成・初期設定など。`MutationCache`に載らない）も、入口の待つ対象になる。入口だけが使う口で、通常の機能は直接使わない |
| `frontend/src/main.tsx` | `QueryClientProvider`の中で、`RouterProvider`を`AccessLossBoundary`で包む（`LeaveGuardProvider`は、ルーターの要素として`App`を包んでいるので、境界はその外側になり、離脱の確認も隠れる）。描画の前に`takeAccessLossNotice`を1回呼ぶ。【#341】`takeAccessLossNotice`の後に、`installCaseAccessLossRelay(queryClient)`を1回だけ呼ぶ（解除しない）。登録の想定外の失敗は、`main.tsx`で受け止めて`reportError`に渡し、アプリの描画は止めない。【#339】中継の後に、`installCaseAccessLossMonitor(queryClient)`を1回だけ呼ぶ（解除しない）。【#298】文書の利用者・ヘッダー・409 の処理・見張りに、切り替えの入口`requestUserSwitchReload`を、関数として渡す（`features/auth`は`features/access-loss`を取り込まない。[auth-session.md](auth-session.md)）。【#342】見張りの後・描画の前に、`installPageRestoreGuard`を1回だけ呼ぶ（解除しない。下の「bfcache の復元の守り」の「登録の順序」） |
| `frontend/src/features/access-loss/page-restore-guard.ts`・`frontend/src/features/auth/verify-document-session.ts` | 【#342。C-212】bfcache の復元の守りと、セッションの直接の確かめ。役割は、下の「bfcache の復元の守り」の「ファイルと役割」 |
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
- 【#342。C-212】復元の守り（`page-restore-guard.ts`）の状態も、同じ包みを隠す。包みの属性は、毎回の描画の後に、その時点の状態から付け直し、守りが`pagehide`の処理の中で直接付けた属性を、古い描画の値で取り消さない。復元の覆いの種類・失敗のときの子のモーダルの扱いは、下の「bfcache の復元の守り」の「境界の包みと覆い」。読み込み直しの覆い（上の項目）は変えない

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

呼ぶのは`useCaseAccessLoss.ts`と`useCaseWrites.ts`の`useRemoveCaseParticipant`だけ【#339（C-210）：画面の外の確定を行う`case-access-loss-monitor.ts`の`settleOutside`も、同じ`announceCaseAccessLossOnce`（印は利用者・案件・参加の期間ごと）を通して送る。表の「経路」に、下の2行を足した。元の記述は残す】。順序は**入口（`requestAccessLossReload`）→ 合図 → 下書きの消去**。合図を送った印`lossAnnounced`は、読み込み直しの予約の印`reloadRequested`とは**別**（確かめられない`unverified`で予約した後に確定した場合も、伝えるため）。どちらも部品ごとの印で、`lossAnnounced`は、非参加から参加者に戻ったときだけ外す。送る処理は`announceLossOnce`に分けた（`requestReloadOnce`は変えない）。【#339（C-210）：合図の印と`announceLossOnce`は、部品ごとの印から、見張りが持つ、利用者・案件・参加の期間ごとの印（`announceCaseAccessLossOnce`）に移した。部品の`lossAnnounced`・`announceLossOnce`は無い。印を外す時機は、非参加から参加者に戻ったとき（参加の期間を進める）で、変わらない。元の記述は残す】

| 経路 | 確定か | 合図 |
| --- | --- | --- |
| (a) 拒否の後の確かめ（`settle`）で非参加（`lost`）・404（`notFound`）。表示中も、画面を離れた後も | 確定 | 送る（印が偽のときだけ。1つの確かめで1回） |
| (a) 確かめられない（`unverified`。5xx・通信の失敗）。入口は呼ぶ | 確定でない | **送らない**（印も立てない） |
| (b) 効果の中の、この画面で参加者だったことを見た後に非参加になった枝（`lostHere`） | 確定 | 送る。`reloadRequested`が立っていても、`lossAnnounced`だけで決める |
| `unverified`で予約した後に、待機中・再試行・概要の取り直しで、非参加・404 が確定 | 確定 | 送る（1回）。読み込み直しは入口で1回に合流する |
| 待機中に2回目の確定（`lost`の後に (b) も通る） | 確定（2回目） | 送らない（印が真） |
| (c) 本人の退出の成功（`useRemoveCaseParticipant`の`onSuccess`。ほかの人を外す場合は送らない） | 確定 | 送る（入口の後、`forgetCaseAfterLeave`の前。利用者は押した時点の`actorId`）。表示中なら、退出の片付けが概要を非参加に書き、部品の (b) も通るので、**合わせて1〜2回**送りうる |
| 参加者に戻った後の、再びの喪失 | 確定 | 送る（戻ったときに印を外すため） |
| 【#339】画面の外の確定（`settleOutside`）：返信・部屋の拒否、一覧の行の消失からの確かめで、非参加（`lost`）・404（`notFound`） | 確定 | 送る（入口の後・下書きの消去の前。同じ参加の期間の中で1回） |
| 【#339】画面の外の確かめが`unverified`・`participant`・`switched` | 確定でない | 送らない（`participant`は参加の期間を進め、次の喪失で、また送れるようにする） |
| 【#339】実績がある初回の非参加・404（取得で届いた新しい概要の答えで確定） | 確定 | 送る（`confirmFirstOutsider`。同じ参加の期間の中で1回） |
| 退出の失敗・参加者のままの 403・参加者だったことを見ていない非参加（最初から非参加・古い非参加の概要・作り直しの経路） | 確定でない | 送らない |
| 受けたタブ（中継） | — | 送り返さない |

### 受けたタブの処理（`case-access-loss-relay.ts`の`installCaseAccessLossRelay(queryClient)`）

`main.tsx`で1回だけ登録する。合図ごとに、次の順で進める。

1. 入口の状態が`idle`でなければ捨てる（自分が待機・読み込み直しの最中）
2. 合図の利用者が、セッションのキャッシュの利用者と同じでなければ捨てる（無い場合も捨てる。通信しない）
3. `caseKeys.summary(利用者, 案件)`のキャッシュが、参加者（`isParticipant === true`）でなければ捨てる（通信しない）。**その案件を表示していないタブでも、概要を持っていれば確かめる**（利用者の決定の Q3）。画面の部品の`participantSeen`には頼らない（概要が 500 の後に画面を作り直すと、キャッシュは参加者でも部品は見ていないため）。【#339（C-210）：参加者の概要を持たなくても、その案件の部屋・スレッドの取得の**実績**（`caseRoomEvidence`が値を返す）があれば、確かめる（利用者の決定の D3）。参加者の概要も実績も無ければ、これまでどおり捨てる（通信しない）。受信側の 4 以降（確かめ・入口だけを呼ぶ・片付け、下書きの消去、送り返しはしない）は変えない。元の記述は残す】
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

- **参加者の概要を持たないタブ**：一覧・スレッド・検索などに、案件の中身が残りうる（#339）。通信もしない【#339（C-210）：その案件の部屋・スレッドの取得の実績を持つタブは、確かめるようにした（上の 3）。実績も概要も持たないタブ・検索だけの経路は、残る。元の記述は残す】
- **別のタブの下書きの書き戻し**（#340 の限界）：受けたタブは下書きを消さない。受けたタブが、非参加・404 で入口に進んだ場合だけ、入口が待機に入ると入力欄が隠れ、書き戻しの隙間が縮む。入口に進む処理がなく、入力欄が操作できる状態（確かめが 5xx・通信の失敗・参加者のまま、合図を捨てた、`BroadcastChannel`が使えない）では、書き戻しが続く。残った下書きは、保存から7日・ログアウトで消える（[drafts.md](drafts.md)）
- **後から確定した場合**：画面を離れた後に、確かめられないまま終わり、作り直した画面で、後から確定した場合は、合図を送らない（参加者だったことを見ていないため。ADR-0033 の「作り直しの経路」と同じ）
- **`BroadcastChannel`が使えない環境**・別の保存の区画（別のブラウザ・プロファイル・プライベートウィンドウ）：これまでどおり
- **取り違え（画面の利用者と通信の利用者が食い違うタブ。#376 と同じ条件）で読み込み直した場合**：読み込み直した後の文書が、セッションの確認で別の利用者を受けると、種類だけの知らせ（`lost`。案件の中身は含まない）が、その別の利用者に、1回出る（`access-loss-notice.ts`は、最初に確定した利用者が誰かを問わないため。「閉じる」で消える）。その動きを、`access-loss-notice.test.tsx`で、既知の動きとして固定している。【#298（C-209）：別の利用者に替わったと分かって読み込み直す経路では、切り替えの入口が、読み込み直す前に保存済みの知らせを消すので、出ない。受けたタブの確かめも、想定の利用者のヘッダーを付けて送るので、食い違うタブでは 409 になり、入口を呼ばない。元の記述は残す】
- **この Issue の範囲の外**：画面の利用者と通信の利用者が食い違うタブでの取り違え（#376。#341 の次に、優先して直す）、書き込みの取り違え（#298）【この2つは、C-209（#298・#376）で扱った。上の「利用者の切り替えでの読み込み直し」。元の記述は残す】
- bfcache（#342）【#342 の 342-A（C-212）で扱った：下の「bfcache の復元の守り」。元の記述は残す】

## 利用者の切り替えでの読み込み直し（Issue #298・#376。C-209。[ADR-0035](../adr/0035-session-user-mismatch-header.md)）

別の利用者に替わったと分かったら、ページの文書ごと1回だけ読み込み直す。画面は、想定の利用者を要求ヘッダーで伝え、サーバーが食い違いを断る（[auth-session.md](auth-session.md)）。入口は、資格の喪失の入口`requestAccessLossReload`とは**別の入口**で、同じ文書の状態（`idle`・`waiting`・`reloading`）と覆い・離脱の確認の抑止・待ち方を使い回す。持ち主・合流・知らせの種類・退出の読み込み先は使わない（文書の利用者は変わらず、戻っても読み込み直すため。共通化しすぎない）。

### 入口の流れ（`requestUserSwitchReload(queryClient)`）

呼ぶのは、`main.tsx`が渡した関数を通して、文書の間に1回だけ（`document-user.ts`の`reportOtherUser`）。最初に確定した利用者・同じ利用者の再ログインでは呼ばれない。

1. 呼ばれた印（`userSwitchRequested`）が立っていれば何もしない（1回だけ）。立てる
2. 状態が`reloading`（#338 が読み込み直しを始めた後）なら、保存済みの知らせを消して戻る（新しい文書の最初の利用者に、前の利用者の知らせを出さないため。読み込み直しは足さない）
3. #338 の待機があれば**引き継ぐ**（`handOver`：購読とタイマーを外し、抑止を外さず、`idle`に戻さず、知らせを書かずに止める。遅れて呼ばれても何もしない）
4. 抑止を立て、状態を`waiting`にする（覆いが出て、操作が止まり、離脱の確認が出ない）
5. 受理済みの操作を待つ（`MutationCache`の`pending`と、`api-client.ts`が数える進行中の書き込みの要求。最初から最大5秒。ログアウトの持ち主の上限なしの待ちは使わない）。理由：Cookie が替わる前に送られた書き込みは、サーバーで元の利用者として受理されうるので、その成功の後処理（投稿の後の下書きの消去など）を走らせる。Cookie が替わった後に送られる要求は 409 になるので、待ちは長くならない
6. 1つ後のタスクの後、もう一度待つものがないか確かめ、保存済みの知らせを消して（`clearAccessLossNotice`）、`reloading`にし、`reloadPage`でいまの場所を読み込み直す。**知らせは出さない**（利用者の決定の Q7）

取りやめはしない。失うもの：保存していない入力（端末に保存した下書きは残る）、5秒を超えた受理済みの操作の後処理、アップロードの後の投稿のように、続きの要求が 409 になった操作（アップロード済みの添付は、どこにも結び付かないまま残る）。

### 入口どうしの交錯

- 切り替えの入口が動き出した後に、#338 の`requestAccessLossReload`が来たら、持ち主に関わらず**何もしない**（抑止を外さず、`idle`に戻さず、読み込み直しを2回にしない）
- #338 の待機中に切り替えを検知したら、引き継ぐ（上の3）。引き継いだ待機の古い取りやめが遅れて走っても、何もしない
- `reloading`になった後は、どの要求も何もしない（これまでどおり）

### 資格の確かめとの関係（#376）

案件の資格の確かめ（`features/cases/case-access-verification.ts`の`verifyBySummaryRefetch`。【#339で、`useCaseAccessLoss.ts`の`verifyParticipant`から移した。判定は変えない】）は、概要を取り直した答えが 409 `SESSION_USER_MISMATCH`のとき、別の利用者に替わったことを、資格の喪失と取り違えない。`confirmSessionUserAfterMismatch`の結果が`switched`で、`isUserSwitchReloadRequested()`が真のときだけ、喪失として扱わず、何もしない（片付け・読み込み直しの予約・合図・下書きの消去・表示の切り替えをしない。文書ごと替わるため）。それ以外は`unverified`（中身を隠し、再試行と読み込み直しを促す。下書きは消さない）。詳細は[cases.md](cases.md)。

## S-17 の外での検出（Issue #339。C-210。[ADR-0036](../adr/0036-case-access-loss-outside-view.md)）

S-17 を開いていない間（S-35 のスレッド一覧・S-07 の返信など）に外された場合も、資格の喪失に気づいて、片付けて読み込み直す。#338 の入口・待ち方・覆い・知らせは変えない。API は、スレッド一覧と返信の成功応答に`caseId`を足した（[threads.md](threads.md)）。伝える仕組みは表示の側の後片付けで、認可ではない（サーバーの認可は変えない）。

### ファイルと役割（`frontend/src/features/cases/`）

| ファイル | 役割 |
| --- | --- |
| `case-access-evidence.ts` | その場の Query のキャッシュの読み取り。別の台帳は持たない。`caseRoomEvidence(queryClient, userId, caseId)`：その案件の部屋・スレッドを正常に取得した**実績**があるか、あれば実績の部屋の ID（分からなければ`null`）を返す。判定と部屋の ID を、同じ読み方から返す。`caseIdOfRoom`：部屋の ID から案件を引く（返信・スレッド一覧・チャンネルの詳細・概要・詳細の既知の対応だけ）。`threadListRows`・`repliesCaseRoom`：一覧・返信のデータから、比べるのに要る分（親・案件・部屋の ID）だけを取り出す。`sessionUserId` |
| `case-access-verification.ts` | 資格の確かめと、5種類の判定（`participant`・`lost`・`notFound`・`unverified`・`switched`）。`verifyBySummaryRefetch`：S-17 用。概要の Query を取り直し、その取り直しの答えで決める（`refetchAnswerOf`）。`verifyBySummaryFetch`：画面の外用。`fetchCaseSummary`で概要をキャッシュの外で1回取る。応答の検証の失敗・実装の例外は、非参加・通信の失敗に変えず、投げる。409 `SESSION_USER_MISMATCH`の扱いは C-209 のまま（別の利用者が確かで、切り替えの入口が動いているときだけ`switched`。それ以外は`unverified`）。`isCaseNotFound` |
| `case-access-loss-monitor.ts` | 画面の外の見張り。`installCaseAccessLossMonitor(queryClient)`：Query の出来事を受ける購読を、`QueryClient`ごとに1つだけ設ける（何回呼んでも1つ。最後の解除で外れる）。`registerCaseAccessLossHandler`：S-17 の担当の登録。`claimCaseVerification`：進行中の確かめの持ち主になる。`settleOutside`：画面の外の確定。`announceCaseAccessLossOnce`・`forgetCaseRoomDraftsOnce`・`startCaseParticipationPeriod`・`currentLossPeriod`・`currentUserGeneration`：合図・下書きの処理の印と、参加の期間・利用者の世代 |
| `hooks/useCaseAccessLoss.ts` | S-17 の部品。見張りに担当として登録し、渡されたきっかけで、概要を取り直して確かめる（`verifyBySummaryRefetch`）。初回の概要の確定（`confirmFirstOutsider`）を受け持つ。表示（`unverified`・`onLost`）は、これまでどおり |
| `case-access-loss-relay.ts` | 受けたタブの処理。対象の判定に、参加者の概要のほか、`caseRoomEvidence`の実績を使う（受信側の制限は変えない） |
| `index.ts`・`frontend/src/features/channels/index.ts` | 見張りの公開（`installCaseAccessLossMonitor`）と、チャンネルの詳細の型`ChannelDetail`の公開（実績の判定が使う） |
| `frontend/src/features/threads/api/thread-api.ts`・`frontend/src/features/messages/api/message-api.ts`・`messages/hooks/useThreadReplies.ts` | 成功応答の`caseId`の検証（Zod）と保持。返信は、最新・追加のどちらの取得でも保持し、追加が0件でも失わない |
| `frontend/src/main.tsx` | 見張りの登録（下の「登録の順序」） |

### 確かめを始めるきっかけ

きっかけは3つ（見張りが Query の出来事から見つける）。確かめるのは概要で、きっかけだけでは喪失と確定しない。

| きっかけ（経路） | 対象 | 始めない場合 |
| --- | --- | --- |
| 取得済みの返信の 403・404（`content`） | データが残っていて、案件の ID を持つ返信のキー | 初回から失敗していて対応が無い・通常のチャンネル・DM |
| 取得済みの部屋の 403・404（`content`） | 案件との対応が分かる部屋（`caseIdOfRoom`）のキー。成功のデータが残っているもの | 初回から失敗・対応が分からない部屋・通常のチャンネル・DM |
| スレッド一覧の行の消失（`list`） | その取得を始めた時点の一覧にあり、取得の成功後に無い行の案件（案件ごとにまとめる） | 下の「一覧の行の比較」の、比べない場面 |

- 5xx・通信の失敗は、きっかけにしない。401 は共通の処理に任せる
- 同じ利用者・案件の S-17 が担当として登録されていれば、見張りは、確かめ・片付け・入口・合図・下書きの消去をせず、**きっかけをその担当へ渡す**（`handler.onDenied`）。担当がいなければ、見張りが概要を直接1回取り（`verifyBySummaryFetch`）、`settleOutside`で確定する
- 進行中の確かめは、利用者・案件ごとに1つ（`claimCaseVerification`）。確かめの間に届いた中身の拒否は、進行中の確かめの経路を`content`に上げ、始めた側が、上がった経路で最後まで処理する（一覧の行の消失の確かめの間に届いた返信の 404 を、取りこぼさないため）

### 経路 × 判定ごとの副作用

見張りの`settleOutside`の動き。S-17 が担当のとき（`useCaseAccessLoss.ts`の`settle`）は、表示中は片付けのスレッドの範囲が`"all"`、画面を離れた後は`"room"`（これまでどおり）で、判定ごとの違いは下の表と同じ。

| 判定 | 片付け（スレッドの範囲は`"room"`） | 入口 | 合図 | 下書き |
| --- | --- | --- | --- | --- |
| `lost`（成功して非参加） | `forgetCaseAfterLeave`（概要・案件一覧を非参加に書き換えて、中身を取り除く） | 呼ぶ | 1回 | 消す |
| `notFound`（404） | `forgetCaseContent`（概要・案件一覧は非参加に書き換えない） | 呼ぶ | 1回 | 消す |
| `unverified`（`content`） | `forgetCaseContent`（確かめられないまま、拒否を受けた中身を隠す） | 呼ぶ | 送らない | 消さない |
| `unverified`（`list`） | しない。進行中の印を外し、次のきっかけを受ける | 呼ばない | 送らない | 消さない |
| `participant` | しない。**参加の期間を進める**（次の喪失で、合図・下書きを、また処理できるようにする） | 呼ばない | 送らない | 消さない |
| `switched` | しない（利用者の切り替えの入口に任せる） | 呼ばない | 送らない | 消さない |

- 別のタブの合図を受けたタブ（中継）は、この表と別で、`lost`・`notFound`のとき入口だけを呼ぶ（片付け・合図・下書きはしない）
- 実績のない初回の非参加・404 は、これまでどおり`forgetCaseContent`と案件一覧の古い印だけで、入口・合図・下書きは行わない（下の「初回の概要」）

**確定時の順序**（`settleOutside`。S-17 の確定も同じ。C-207(8)・C-208(8)）：①対象の利用者・案件・部屋の ID を決める（片付けで返信・詳細が消える前に） → ②片付け → ③入口`requestAccessLossReload`（理由`lost`。持ち主は確定を始めた利用者） → ④合図`announceCaseAccessLossOnce`（未送信のときだけ） → ⑤下書きの消去`forgetCaseRoomDraftsOnce`（未処理のときだけ）。合図の送信が想定外の例外を投げても、`announceCaseAccessLoss`が`reportError`に渡すので、下書きの消去は続く。下書きの部屋の ID は、返信の親の部屋・一覧の行の部屋・実績・概要の部屋から、片付けの前に得る。得られなければ消さない（ID を求める追加の通信・保存のキーの推測はしない）。消す範囲は C-207(5) のとおり

### 印・参加の期間・利用者の世代

- **合図の印・下書きの処理の印**（`LossMarks`の`announced`・`draftsHandled`）：見張りが、利用者・案件ごとに持つ。読み込み直しの印（`reloadRequested`）とは別。同じ**参加の期間**の中で、それぞれ1回だけ。確かめられない（`unverified`）ときは処理済みにしない（その後に確定した場合も、処理できるように）。見張り・S-17 の両方が、同じ印を使う（二重の消去を防ぐ。消去は呼んだ時点の保存の内容を消すので、1回目の後に書かれた新しい下書きを、遅れて届いた古い確定で消さないため）
- **参加の期間**：`startCaseParticipationPeriod`で進める。進める時機は、画面の外の確かめが`participant`のときと、S-17 で非参加から参加者に戻ったとき。期間が進むと、印が外れ、古い期間の確定は使われない（`period`を照らす）
- **利用者の世代**：セッションの利用者が別の利用者に替わるたびに進める（A → B → A でも、古い確かめを捨てるため）。画面の外の確かめは、始めたときの利用者・世代・参加の期間を控え、答えが届いたとき、副作用の直前に、いまのセッションの利用者・世代・期間と照らす（`stillCurrent`）。違えば、何もしない
- S-17 の担当は、世代を照らさない。S-17 のキーと下書きは、確定を始めた利用者のもので、切り替えの後も、その利用者の分を片付ける（#338 P-11・#340 AC-2 が固定する、前からの決まった動き）

### 初回の概要（S-17 が受け持つ）

概要を一度も取得していない画面が、初回に非参加・404 を受ける場合。部屋・スレッドの取得の**実績**があれば、喪失として確定する（C-206(4)・C-207(6) の置き換え）。見張りは概要を確かめない（同じ処理が二重にならないよう、S-17 のフックだけが扱う）。

1. 非参加・404 の状態に「なったとき」の効果（`useCaseAccessLoss.ts`）で、**片付けより前に**、`caseRoomEvidence`で実績と部屋の ID を読む（片付けで、返信・一覧の行が消えるため）。実績が無ければ、これまでどおり`forgetCaseContent`と案件一覧の古い印だけ（入口・合図・下書きは行わない）
2. 実績があれば、使ってよい答えは、**この画面が開いてから取得で届いた概要の答え**だけ（`watchFreshSummary`・`whenFreshSummary`・`answerOfAction`）。開いた時点でキャッシュにあった状態・手での書き換え（`setQueryData`）・取り消しは、答えにしない。`fetchStatus`だけでは、取得で届いた答えと、開いた時点のキャッシュを分けられない（通信が止まって保留の場合・取り直しが始まらない場合に、古いキャッシュを答えにしてしまう）ため、キャッシュの出来事で見分ける
3. 答えが`lost`・`notFound`なら確定する（`confirmFirstOutsider`）：片付け（`lost`は`forgetCaseAfterLeave`、`notFound`は`forgetCaseContent`と案件一覧の古い印。どちらも`"room"`）→ 入口 → 合図 → 下書き。答えが参加者・確かめられない（5xx・通信の失敗）なら、この契機から確定しない
4. 待ちの寿命：待つ間に、別の利用者に替わった・参加者に戻った（期間が進んだ）場合は、答えが届いても使わない。概要の Query が捨てられた（`removed`）ときは、控えた答えも待ちも捨てる（作り直された Query に、古い実績・部屋の ID の文脈を引き継がない）。非参加から参加者に戻ったときも、待ちを捨てる。購読の解除では、控えた答えだけを捨て、待ちは残す（効果の「登録 → 解除 → 再登録」〔`StrictMode`〕をまたいで、再登録した購読が受ける。待ちを失わないため）。画面を本当に離れたときは、購読が無いので、待ちは動かない

### 一覧の行の比較

- 比べるのは、スレッド一覧（`useMyThreads`のキー）だけ。案件一覧は、きっかけにしない
- その**取得を始めた時点**の一覧の行（`{ parentId, caseId, roomId }`だけ。本文は写さない）と、取得が成功した後の一覧を、読み込み済みの全ページをまとめて（親 ID の重複を除いて）比べる。消えた行の案件を、案件ごとにまとめて確かめる
- 比べる元を**捨てる**場面：手での書き換え（片付けによる行の除去を含む。`setQueryData`）・取得の取り消しと失敗・Query の削除・利用者の世代の変化・見張りの購読の解除。したがって、片付けの後に始まる取得は、古い行から確かめを始めない。並び替え・ページの移動・追加の取得だけでは、消失にしない
- 行の消失だけでは、確定しない（入口・合図・下書きを行わない）。`unverified`のときは、何もせず、次のきっかけを受ける

### 登録の順序（`main.tsx`）

利用者の切り替えの見張り（`installUserSwitchGuard`）→ 知らせの読み取り（`takeAccessLossNotice`）→ 中継（`installCaseAccessLossRelay`）→ **見張り（`installCaseAccessLossMonitor`）** → 描画。見張りは、切り替えの見張りより後に置く（別の利用者に替わったときは、切り替えの見張りが先にキャッシュを捨て、見張りは、捨てられた Query の遅れて届いた応答を使わない）。アプリの間ずっと有効なので解除しない。S-17 のフックも、同じ`QueryClient`に対して冪等に設ける（`main.tsx`を通らない、フックだけの画面のテストでも動くように）

### 既知の限界

「画面の外の全部を、解消した」とは言わない。

- **検索だけの経路**：扱わない（利用者の決定。別の Issue（#388））。既存の片付けが検索のキャッシュを取り除く動きは変わらない
- **bfcache**（#342）【#342 の 342-A（C-212）で扱った：下の「bfcache の復元の守り」。元の記述は残す】
- **別のタブ**：`BroadcastChannel`が使えない環境・別の保存の区画には、合図が届かない。実績も概要も持たないタブは、通信しない
- **中継は、利用者が A → B → A と替わった場合を見分けない**：入口を呼ぶだけの経路で、片付け・下書きの消去はしない
- **概要の Query だけが捨てられ、実績は残っている場合**：作り直された Query の答えでは、確定しない（下書きを消さない側。作り直された画面を、あらためて「実績がある初回」として扱う仕組みは、足さない）
- **S-17 の確かめは、切り替えの後も、始めた利用者の分を片付ける**（前からの決まった動き。上の「利用者の世代」）
- 409 の後の確かめが「分からない」なら、切り替えの入口が動いていても、`unverified`（中身を隠し、読み込み直す。C-209）

## bfcache の復元の守り（Issue #342 の 342-A。C-212。[ADR-0038](../adr/0038-bfcache-access-check.md)）

ブラウザの「戻る」で、前の文書が、メモリごと凍って戻ることがある（bfcache）。戻った文書では、`main.tsx` は実行し直されず、離れている間に外された案件の中身が、確かめる前に出てしまう。そこで、離れるとき、その処理の中で中身を隠し、戻ったとき、自分で取り直したセッションと案件の概要の答えだけで、外す・再試行を出す・覆ったまま読み込み直す、を決める。API・DB は変えない（フロントエンドだけ）。守りは表示の側の後片付けで、認可ではない（サーバーの認可は変えない）。

### 目的と範囲

- 目的：資格を失った中身を、戻った直後に出さない。資格が残っていれば、入力・画面の状態（スクロール・フォーカス・選択範囲・開いているモーダル・popover）を保ち、読み込み直さない
- 範囲：342-A。守るのは、離れる（`pagehide`）ときに、案件の中身を持つ文書。持たない文書（対象が 0 件で、読み込み直しが`idle`）は、覆わず、確かめない
- 範囲の外：次の表。残る範囲は、下の「既知の限界」

| Issue | 範囲の外のこと |
| --- | --- |
| #391（342-B。条件つき） | 凍る前に送った要求の遅い答えへの、さらに強い守り（S-17・中継・409 の処理・一覧の比較元への復元の世代、直接の取得の中断、通常の取得の保留） |
| #392（342-C） | 待ちの上限（5秒）を、凍っていた時間を除いて数えること。元の遷移の種類・行き先の保存と、読み込み直しの保留・再開 |
| #388 | 検索だけの経路 |
| #390 | 通常の例外後の印、Refetch 側の例外の契約など |
| #398 | テストの準備の完了待ち（本番の動きではない） |

### ファイルと役割

置き場所は、`frontend/src/features/`の下（以下、機能名から書く）。

| ファイル | 役割 |
| --- | --- |
| `access-loss/page-restore-guard.ts`（新規） | 守りの本体。状態（`idle`・`prepared`・`verifying`・`failed`・`handedOff`）と、試行の番号・登録ごとの識別を、この1ファイルに持つ。`installPageRestoreGuard(options)`：`pagehide`・`pageshow`の登録（解除の関数を返す）。`getPageRestoreState`・`subscribePageRestoreState`：状態の取得と購読。`retryPageRestoreVerification`：失敗の案内の「再試行」。`reloadWhenRetryUnreachable`：失敗の覆いを開けなかったときの読み込み直し。`attachPageRestoreSurface`：境界が、包みの直接の操作（隠す・外す・表示の状態の控えと復帰）を登録する口 |
| `access-loss/components/AccessLossBoundary.tsx` | 境界。包みの`hidden`・`inert`の付け直し、守りの状態に応じた覆い（確かめの間・失敗・引き渡しの後）、表示の状態の控えと復帰。下の「境界の包みと覆い」 |
| `access-loss/reload-after-access-loss.ts` | `retryReloadNavigationAfterPageRestore()`を足した。状態が`reloading`のときだけ、`reloadPage()`を1回呼ぶ。`idle`・`waiting`では何もしない（待機・期限・知らせを作り直さない） |
| `access-loss/index.ts` | `installPageRestoreGuard`を公開 |
| `auth/verify-document-session.ts`（新規） | `verifyDocumentSession()`：セッションを新しく直接取り（`fetchSession`）、文書の利用者と比べる。キャッシュ・進行中の取得に合流せず、答えをキャッシュに書き戻さない。409 の後の取り直しの回数には触れない。`access-loss`には依存しない |
| `auth/index.ts` | `verifyDocumentSession`・型`DocumentSessionOutcome`と、既存の`reportOtherUser`を公開 |
| `cases/case-access-evidence.ts` | `caseAccessTargets(queryClient, userId)`：確かめる対象（案件と部屋の ID だけ）を全件返す。実績の判定と部屋の ID は`caseRoomEvidence`と同じ読み方で、案件の ID で重なりを除く |
| `cases/case-access-verification.ts` | `verifyBySummaryFetch`に、詳しい結果を返す呼び方（`{ withFailureStatus: true }`）を足した。判定と、根拠の HTTP の状態（成功は`null`、通信の失敗・時間切れは 0）を返す。1つの引数の呼び出しの戻り値・投げ方は変えない |
| `cases/case-access-loss-monitor.ts` | `settleVerifiedCaseAccess(queryClient, context, verdict)`：復元用の確定の入口。型`CaseAccessContext`・`VerifiedCaseAccessVerdict`・`VerifiedCaseAccessSettlement`。通常の確定（`settleOutside`）は、中身を取り出して共通の関数に分けただけで、動きは変えない |
| `cases/index.ts` | 上の関数・型と、文脈の取得に要る`currentLossPeriod`・`currentUserGeneration`を公開 |
| `frontend/src/main.tsx` | 守りを登録（下の「登録の順序」） |
| `stryker.config.json` | ミューテーションの対象に、守り・境界・入口など7ファイルを登録しただけ。基準は変えない |

依存の向きは、`main.tsx`が関数として渡す形（`access-loss`は`cases`に依存せず、`auth`・`cases`は`access-loss`の守りに依存しない）。実際の復元の確かめに使う観測の補助`e2e/support/bfcache-observer.js`は、製品の成果物に入れない（[bfcache.md](../testing/bfcache.md)）。

### 状態

| 状態 | 意味 |
| --- | --- |
| `idle` | 通常。覆っていない。退避の準備がない |
| `prepared` | 離れるときに、隠して戻るのを待っている。対象と、隠す前の表示の状態を控えてある |
| `verifying` | 戻って、確かめている（セッション → 対象の全件）。覆いを出し、中身は隠れたまま |
| `failed` | 確かめられなかった。隠したまま、失敗の案内と「再試行」を出す。入力は保つ |
| `handedOff` | 既存の入口（切り替え・資格の喪失・読み込み直し）か、守り自身の読み込み直しへ渡した。覆いを保つ。`idle`には戻らない |

既存の読み込み直しの状態（`idle`・`waiting`・`reloading`）とは別に持つ。覆いは、読み込み直しが`idle`でなければ、そちらを先に出す（表示の優先は「読み込み直し中 → 復元の確かめ中・失敗 → 通常」）。

### 離れるとき（`pagehide`）

`persisted`の値によらず、毎回働く。`installPageRestoreGuard`が登録した処理が、この順で進める。

1. 試行の番号を進める（前の確かめの完了を無効にする）
2. 状態が`idle`なら：セッションのキャッシュの利用者から、確かめる対象を捕まえる（`caseAccessTargets`。利用者が無ければ対象 0 件。文書の利用者で補わない）。対象が 0 件で、読み込み直しが`idle`なら、何もしない（覆わず、確かめの予約も作らない）
3. 対象がある、または読み込み直しが`idle`でないなら、`prepared`にして、隠す前の表示の状態（ウィンドウのスクロール・0 でないスクロールを持つ要素・フォーカス・選択範囲）を控え（`captureView`）、**その処理の中で**、包みに`hidden`・`inert`を直接付ける（`cover`）。控えるのが例外で終わっても、隠す（`finally`）。そのあとで通知し、例外は`reportError`に渡す
4. 捕まえるのが例外で終わったときは、対象 0 件の正常な結果にしない。隠したまま`prepared`にして（捕捉の印は`failed`）、`reportError`に渡す
5. `idle`でない（確かめ・失敗・引き渡しの途中）なら、試行を捨て、捕まえた対象と、最初に控えた表示の状態を保ったまま、隠し続け、`prepared`にする

### 戻ったとき（`pageshow`）

状態が`prepared`のときだけ働く（退避の準備がない文書は何もしない。初回・新しい文書・画面の中の移動を含む）。`persisted`の値は見ない。確かめずに準備だけを解く経路は無い。

1. 読み込み直しの遷移をやり直した印を戻し、新しい試行の番号で`verify`を始める
2. 捕捉が例外で終わっていて、読み込み直しが`idle`なら、確かめず、`failed`にする（再試行が、いまのキャッシュから捕まえ直す）
3. `verifying`にして、`verifyDocumentSession`でセッションを新しく直接取る。例外は`reportError`に渡し、答えが無い扱いにする
4. 試行が古ければ捨てる。読み込み直しが`idle`でなければ、案件は確かめず、既存の読み込み直しに任せる（下の表）
5. セッションの答えで分ける：401 → 守り自身が読み込み直す（`handedOff`）。別の利用者 → 切り替えの入口（`onOtherUser`。`main.tsx`が渡す`reportOtherUser`）→ `handedOff`。答えが無い（5xx・通信の失敗・時間切れ・文書の利用者が決まっていない・例外）→ `failed`。同じ利用者 → 次へ
6. 対象を決める：離れるときに捕まえたもの。捕まえられていなければ、いまのキャッシュから捕まえ直す。それでも捕まえられなければ`failed`
7. 対象の全件を、同時に2件まで確かめる（`verifyBySummaryFetch`の詳しい結果。キャッシュの外で、概要を直接1回）。各件の答えが届いたら、試行・読み込み直しの状態を照らしたうえで、下の表のとおりに分ける
8. 全件が`confirmed`なら、最新の試行で、読み込み直しが`idle`なことを確かめてから、`idle`に戻し、包みを外し（`release(true)`）、表示の状態を戻す（参加の期間は進めない。読み込み直さない）

### 状態 × 出来事

| 状態 | 出来事 | 期待 |
| --- | --- | --- |
| `idle` | `pagehide`。対象 0 件（利用者が無い場合を含む）で、読み込み直しが`idle` | 覆わない。確かめの予約を作らない（`idle`のまま） |
| `idle` | `pagehide`。対象がある、または読み込み直しが`idle`でない | `persisted`によらず、その処理の中で包みを隠す（`prepared`） |
| `idle` | `pagehide`。捕捉が例外で終わった | 隠す。対象 0 件にしない。例外を報告（`prepared`。戻ったとき`failed`） |
| `verifying`・`failed`・`handedOff` | `pagehide` | 試行を捨てる。捕まえた対象と、最初に控えた表示の状態を保ち、隠し続ける（`prepared`） |
| `prepared` | `pageshow`（`persisted`が真でも偽でも） | 新しい試行で、セッションの直接の確かめから始める（`verifying`）。確かめずには解かない |
| `idle`・`verifying`・`failed`・`handedOff` | `pageshow` | 何もしない |
| `verifying` | 読み込み直しが`waiting`・`reloading` | 案件は確かめない。覆いは外さない。セッションの結果が別の利用者なら、先に切り替えの入口。`reloading`なら、その復元について1回だけ`retryReloadNavigationAfterPageRestore`（結果によらない）。`handedOff`にする |
| `verifying` | セッションの確かめが 401 | 案件は確かめない。覆ったまま、離脱の確認を抑止して、`reloadPage`（`handedOff`。喪失の知らせ・合図・下書きの消去はしない） |
| `verifying` | セッションの確かめが別の利用者 | 切り替えの入口へ（`handedOff`）。喪失側の副作用なし |
| `verifying` | セッションの確かめに答えが無い | `failed` |
| `verifying` | 案件の確かめが 401（HTTP の状態で判定。コードによらない） | 覆ったまま読み込み直す（`handedOff`。重なった 401 で遷移を重ねない） |
| `verifying` | 案件の確かめが、通信の失敗・5xx・時間切れ・一般の確かめられない | `failed`。片付け・合図・下書きの消去・読み込み直しはしない |
| `verifying` | 案件の確かめが 403 | `settleVerifiedCaseAccess`へ`forbidden`として渡す。採用されれば、中身を`"room"`で片付けて読み込み直す（`handedOff`）。下書きの消去・合図はしない |
| `verifying` | 案件の確かめが`lost`・`notFound` | `settleVerifiedCaseAccess`へ。採用されれば、既存と同じ順で片付けて入口へ（`handedOff`） |
| `verifying` | 案件の確かめが`switched` | `settleVerifiedCaseAccess`へ。切り替えの入口が動いていれば`handedOff`、動いていなければ`failed` |
| `verifying` | `settleVerifiedCaseAccess`が`unverified`（照合で採用できなかった） | 読み込み直しが`idle`なら`failed`、そうでなければ`handedOff` |
| `verifying` | 一部の件だけが`confirmed` | 解除しない |
| `verifying` | 全件が`confirmed`。最新の試行・読み込み直しが`idle` | `idle`。包みを外し、表示の状態を戻す。参加の期間を進めない。読み込み直さない |
| `verifying` | 応答の検証の失敗・実装の例外 | 確かめの成功にしない。`reportError`に渡し、`failed` |
| `failed` | 「再試行」（`retryPageRestoreVerification`） | 新しい試行で、セッションから全件を確かめ直す（前回の一部の成功は使わない。`verifying`）。確かめの間は、再度押せない |
| `failed` | 失敗の覆いを開けなかった（`reloadWhenRetryUnreachable`） | 覆ったまま読み込み直す（`handedOff`。1回だけ。`failed`のときだけ動く） |
| どれでも | 古い試行・登録を解除した後・`failed`や`handedOff`の後に残った要求の完了 | 解除にも、確定の入口の呼び出しにも使わない |
| どれでも | 捕まえた後の、キャッシュの削除 | 対象を確認済みにしない。不在から喪失も決めない |
| どれでも | `pagehide`の後の、描画への通知の失敗 | 包みは隠れたまま。例外を報告。再試行が成功すれば、直接の操作と描画の後の付け直しで外れる |

### 確定の入口（`settleVerifiedCaseAccess`）と、確かめの詳しい結果

- 各件の確かめの直前に、文脈（利用者の ID・案件の ID・部屋の ID・利用者の世代・参加の期間）を控える（`main.tsx`の`contextOf`）。部屋の ID は、片付けの前に決めた値を使う
- 渡す判定は、`participant`・`lost`・`notFound`・`switched`と、概要の 403 を表す復元専用の`forbidden`。一般の`unverified`は渡さない（守りが`failed`にする）。403 かどうかは、`verifyBySummaryFetch`の詳しい結果の HTTP の状態で決める（判定の文字列だけでは、状態が失われるため）
- 戻り値は`confirmed`（参加者を採用できた）・`handedOff`（片付け・入口への引き渡しが成り立った）・`unverified`（既存の照合で採用できなかった、または切り替えの入口が動いていなかった）
- 既存の照合（`stillCurrent`：セッションの利用者・利用者の世代・参加の期間）が成り立たなければ、副作用なしで`unverified`を返す。`switched`は、セッションの利用者がもう違うので、照合せず、切り替えの入口が動いているか（`isUserSwitchReloadRequested`）だけを見る
- 判定ごとの扱い：

| 判定 | 採用できたときの処理 |
| --- | --- |
| `participant` | 確かめの成功だけを返す（`confirmed`）。**参加の期間を進めない**。合図・下書きの印も変えない（通常の経路の`participant`の動きは変えない） |
| `lost` | `forgetCaseAfterLeave` → 入口`requestAccessLossReload` → 合図 → 下書きの消去（通常の確定と同じ順・同じ印）。`handedOff` |
| `notFound` | `forgetCaseContent` → 同じ入口・合図・下書き。概要・案件一覧を非参加に書き換えない。`handedOff` |
| `forbidden`（概要の 403） | `forgetCaseContent`（スレッドは`"room"`）→ 入口。合図・下書きの消去はしない。`handedOff`。保存していない入力は、読み込み直しで失われる |
| `switched` | 喪失側の副作用はしない。切り替えの入口が動いていれば`handedOff`、そうでなければ`unverified` |

- `verifyBySummaryFetch`の詳しい結果：`{ verdict, failureStatus }`。404 は`notFound`と状態 404。特定の 409（`SESSION_USER_MISMATCH`）は既存の確かめ（`confirmSessionUserAfterMismatch`）を使い、その結果が 401 なら状態 401、それ以外は 409 の状態。403 は判定が`unverified`のまま、状態 403 を渡す。通信の失敗・時間切れは状態 0。API の失敗でないもの（応答の検証の失敗・実装の例外）は、従来どおり投げる。概要の取得の 409 は、既存の決まりどおり「同じ利用者が続いた回数」に数える（セッションの直接の確かめは数えない）
- 確かめの対象（`caseAccessTargets`）：案件の ID つきの返信・スレッド一覧の読み込み済みの全ページの案件の行・案件との対応が分かる部屋の取得済みのメッセージ（空の配列を含む）・その利用者の参加者の概要を、案件の ID で重なりを除いて返す。案件一覧の行・案件の詳細だけでは、新しい部屋・スレッドの実績にしない。検索だけの結果は加えない。保持するのは、案件の ID・部屋の ID だけ

### 境界の包みと覆い（`AccessLossBoundary`）

- 包み（ルーター全体）の`hidden`・`inert`は、2つの道で付く。(1) 守りが、`attachPageRestoreSurface`で登録された`cover`で、`pagehide`の処理の中に、DOM へ直接付ける。(2) 境界が、**毎回の描画の後**（レイアウトの効果）に、その時点の読み込み直しの状態と守りの状態から、両方向へ付け直す（描画したときの古い値で、直接付けた属性を取り消さない・残さない）
- 解除（`release`）のときも、DOM から直接外す（描画が同じ値と判断して、属性が残ることを防ぐ）。外す直前にも、読み込み直しが`idle`かを確かめ、`idle`でなければ外さない
- 表示の状態の復帰：隠す前に控えた、フォーカス・選択範囲・要素のスクロール・ウィンドウのスクロールを、全件の確認に成功して外した後の描画の後に、この順で戻す。フォーカスはスクロールさせずに戻す。覆った状態で再び離れても、最初に控えた記録は上書きしない
- 覆い（包みの外）：確かめの間（`prepared`・`verifying`）は見出し「画面を確認しています」、引き渡しの後（`handedOff`）は見出し「画面を読み込み直しています」の、モーダルでない全画面の要素。失敗（`failed`）は、案内「画面を確認できませんでした。再試行してください」と、共通の`Button`「再試行」
- **失敗の覆いは、原則、モーダルでない通常の全画面の要素**にする。`showModal()`で開くと、開いている auto の popover が閉じ、戻ったときに画面の状態が変わるため。中身は`inert`で操作を止める。覆いの間は、Esc の既定の動きを止める（隠した中身のモーダル・popover は最上位の層に残り、Esc の閉じる要求を受けるため）
- **子のモーダル（`showModal()`のダイアログ）が開いたまま失敗したときだけ、失敗の覆いを`showModal()`のダイアログにする**（`FailedModal`）。文書の仕様で、モーダルのダイアログが開いていると、その外は、祖先を`hidden`にしても、操作できず、通常の覆いの再試行に届かないため。後から開いたモーダルが一番上になるので、再試行を押せる。覆いが外れたら閉じ、子のモーダルが再び一番上になる。このとき、開いている auto の popover は、開くときに閉じる。失敗になったときに1回だけ、子のモーダルの有無を見る
- その覆いの`showModal()`が例外になったら、`reportError`に渡し、`reloadWhenRetryUnreachable`で、覆ったまま読み込み直す（守りが`failed`のときだけ。1回だけ。離脱の確認を抑止。下書きの消去・喪失の知らせはしない）
- jsdom では、`:modal`が何にも当てはまらず、隠した要素の`blur()`も効かない。子のモーダルがある道筋の確かめは、E2E と、守りの入口の単体のテストで行う

### 登録の順序（`main.tsx`）

利用者の切り替えの見張り（`installUserSwitchGuard`）→ 知らせの読み取り（`takeAccessLossNotice`）→ 中継（`installCaseAccessLossRelay`）→ 見張り（`installCaseAccessLossMonitor`）→ **守り（`installPageRestoreGuard`）** → 描画。守りは、見張りの後・描画の前に、1回だけ登録する（アプリの間ずっと有効なので解除しない）。`verifySession`（`verifyDocumentSession`）・`onOtherUser`（`reportOtherUser`に`requestUserSwitchReload`を渡したもの）・`listTargets`（`caseAccessTargets`）・`contextOf`（利用者の世代と参加の期間を取る）・`verifyCase`（`verifyBySummaryFetch`の詳しい結果）・`settleCase`（`settleVerifiedCaseAccess`）を、関数として渡す。既存の 401 の共通の処理の登録は、1か所のまま変えない（守りは、自分の確かめの結果だけで 401 を扱う）。

### 既知の限界

「戻ったときの全部を解消した」とは言わない。

- **凍る前に送った要求の遅い答え**：その副作用は、C-210 の既存の照合（利用者の世代・参加の期間）の範囲でだけ防ぐ。強い守りは #391
- **待ちの上限（5秒）**：読み込み直しの待ちの上限は、ページが凍っていた時間の分だけ延びうる（#392）
- **401 で読み込み直す**：メモリのキャッシュ（ログインし直した後、すぐ表示に使えるもの）を失う
- **403 で読み込み直す**：保存していない入力を失う（利用者の決定。保存済みの下書きは消えない）
- **セッションのキャッシュが無い文書**：離れるとき対象 0 件になるので、戻ったときに確かめない。画面は、認証の枠（`RequireAuth`）が止めるので、案件の中身は出ない。メモリの案件のキャッシュは残るので、同じ利用者がログインし直すと、取り直すまでの間、喪失した案件のキャッシュが表示されうる（既存のセッション切れと同じ動き）
- **概要の 409 の後の 401**：`main.tsx`と同じ組み立てでは、401 の共通の処理が、取り直しの途中でセッションの Query を消し、取り直しの結果が「確かめられない」になるので、隠したまま`failed`になる。再試行を押すと、直接のセッションの確かめの 401 で、覆ったまま読み込み直す。中身は出ない（#382 と同じ経路）
- **子のモーダルを開いたまま失敗したとき**：失敗の覆いを`showModal()`で開くので、開いている auto の popover が閉じる
- **その覆いを開けなかったとき**：覆ったまま読み込み直すので、保存していない入力を失う。この例外は、テストが差し替えて起こしただけで、実際のブラウザで起きる場面は確かめていない
- **子のモーダルが無いときの覆い**：クリックすると、開いている popover が閉じうる（未検証）
- **合成のイベントの E2E は、実際の復元の証拠ではない**：実際の復元は、通常のブラウザでの確かめ（[bfcache.md](../testing/bfcache.md)の M0〜M3）で行う。**まだ行っていない**。行うまで、実際の復元で中身が出ないことと、最初の描画の保護は、確かめていない
- **Safari・iOS**：確かめる環境がなく、未確認。退避の準備のある文書で`persisted`が偽の`pageshow`も確かめるが、それは実機での確認の代わりにならない
- **検索だけの経路**：#388

## 関連する既存の機能との関係

- 利用者の切り替え（[ADR-0030](../adr/0030-clear-cache-on-user-switch.md)）：`installUserSwitchGuard`は、キャッシュを捨てる動きを変えない。待機は、別の利用者に替わったら取りやめる。片付け（キャッシュと完了した操作の記録の消去）は読み込み直しの前に済んでいる。【#298（C-209）：見張りは、別の利用者を見つけたとき、キャッシュを捨てる前に、切り替えの読み込み直しの入口（`onOtherUser`）も呼ぶ。この入口が動き出した後は、#338 の待機を引き継ぎ、#338 の入口は何もしない。元の記述は残す】
- 401・ログアウト：`useLogout`・未認証の処理（`unauthenticated-handler.ts`）は変えない。セッションが消えるだけでは待機を取りやめない
- 画面のテストでは、入口を`frontend/src/test/setup.ts`で`vi.fn`に差し替えている（待機の状態・購読・タイマーがテストの間に残らないように）。本物を確かめるテストは`vi.unmock`する
- 【#341】画面のテストでは、`BroadcastChannel`も`frontend/src/test/setup.ts`で、テスト専用の`frontend/src/test/fake-broadcast-channel.ts`の`FakeBroadcastChannel`に差し替え、jsdom にない`reportError`を補っている（`window`の`error`イベントにする）。送る関数そのものは差し替えず、送った値を、差し替えのチャンネルの記録で数える。本物の`BroadcastChannel`は、閉じないとテストの間で値が混ざりうるため。実ブラウザでの配信は E2E で確かめる

## 主な関数の入力と出力

| 関数 | 入力 | 出力・効果 |
| --- | --- | --- |
| `requestAccessLossReload` | `QueryClient`・`{ ownerId, reason, leftCasePath? }` | `Promise<void>`（読み込み直したか取りやめたときに解決）。呼んだその場では読み込み直さない |
| `getAccessLossReloadState`・`subscribeAccessLossReloadState` | なし／リスナー | 状態`idle`・`waiting`・`reloading`と、購読の解除関数 |
| `requestUserSwitchReload`（#298） | `QueryClient` | なし。文書の間に何回呼ばれても1回だけ働く。呼んだその場では読み込み直さない（上の「入口の流れ」） |
| `isUserSwitchReloadRequested`（#298） | なし | 呼ばれたか（`boolean`。呼ばれた後、この文書の間ずっと真） |
| `clearAccessLossNotice`（#298） | なし | なし。保存済みの知らせを、読まずに消す |
| `noteDraftsRemain`（#340） | 持ち主の利用者ID | なし。同じ持ち主の待機があれば、下書きの印を付ける。それ以外は何もしない |
| `announceCaseAccessLoss`（#341） | `{ userId, caseId }` | なし。投げない（想定外の例外は`reportError`）。使えない環境では何もしない |
| `subscribeCaseAccessLoss`（#341） | リスナー（検証を通った`{ userId, caseId }`を受ける） | 解除の関数。使えない環境では何もしない関数 |
| `installCaseAccessLossRelay`（#341。`features/cases/`） | `QueryClient` | 解除の関数。受けたタブの確かめと、入口の呼び出し（上の「受けたタブの処理」） |
| `installCaseAccessLossMonitor`（#339。`features/cases/`） | `QueryClient` | 解除の関数。同じ`QueryClient`に何回呼んでも購読は1つ（最後の解除で外れる） |
| `registerCaseAccessLossHandler`（#339） | `QueryClient`・担当（`userId`・`caseId`・`roomId`・`onDenied(route)`） | 解除の関数。登録された担当には、見張りがきっかけ（`content`・`list`）を渡す |
| `claimCaseVerification`（#339） | `QueryClient`・利用者・案件・経路 | 確かめの持ち主（`route`・`release`）。進行中なら`null`（中身の拒否なら、進行中の経路を`content`に上げる） |
| `caseRoomEvidence`（#339） | `QueryClient`・利用者・案件 | 実績があれば`{ roomId }`（部屋が分からなければ`roomId`は`null`）、無ければ`undefined` |
| `verifyBySummaryRefetch`・`verifyBySummaryFetch`（#339） | `QueryClient`・概要のキー／案件の ID | 5種類の判定（`participant`・`lost`・`notFound`・`unverified`・`switched`）。応答の検証の失敗・実装の例外は投げる |
| `announceCaseAccessLossOnce`・`forgetCaseRoomDraftsOnce`（#339） | `QueryClient`・利用者・案件（・部屋の ID）・参加の期間 | なし。同じ参加の期間の中で1回だけ働く。期間が違えば何もしない。部屋の ID が`null`なら、下書きは消さない（処理済みにもしない） |
| `writeAccessLossNotice` | 種類 | 書けたか（`boolean`） |
| `takeAccessLossNotice` | `QueryClient` | 読んだ種類（`null`なら知らせなし）。副作用として、出す知らせを持ち、セッションの変化を購読する |
| `openNoticeStorage` | なし | `Storage`か`null`（`SecurityError`のとき） |
| `reloadPage`・`replacePage` | なし／行き先 | `window.location`の操作 |
| `installPageRestoreGuard`（#342。C-212） | オプション（`queryClient`・`verifySession`・`onOtherUser`・`listTargets`・`contextOf`・`verifyCase`・`settleCase`） | 解除の関数（状態を`idle`・試行の番号を初期に戻し、包みを外す）。`pagehide`・`pageshow`を受ける |
| `getPageRestoreState`・`subscribePageRestoreState`（#342） | なし／リスナー | 状態`idle`・`prepared`・`verifying`・`failed`・`handedOff`と、購読の解除関数 |
| `retryPageRestoreVerification`（#342） | なし | なし。`failed`のときだけ、新しい試行でセッションから全件を確かめ直す |
| `reloadWhenRetryUnreachable`（#342） | なし | なし。`failed`のときだけ、覆ったまま読み込み直す（`handedOff`）。解除の後・再試行の後・2回目は何もしない |
| `attachPageRestoreSurface`（#342） | 包みの直接の操作（`captureView`・`cover`・`release`） | 解除の関数。境界が登録する |
| `retryReloadNavigationAfterPageRestore`（#342） | なし | なし。`reloading`のときだけ、いまの場所を`reloadPage`で読み込み直す |
| `verifyDocumentSession`（#342。`features/auth/`） | なし | `same`・`otherUser`・`unauthenticated`（HTTP の状態 401）・`unknown`。API の失敗でない例外は投げる |
| `caseAccessTargets`（#342。`features/cases/`） | `QueryClient`・利用者の ID | 案件と部屋の ID の組の配列（案件の ID で重なりなし）。部屋が分からなければ`roomId`は`null` |
| `verifyBySummaryFetch`（詳しい結果。#342） | 案件の ID・`{ withFailureStatus: true }` | `{ verdict, failureStatus }`（成功は`null`、通信の失敗・時間切れは 0）。1つの引数の呼び出しは、これまでどおり判定だけ |
| `settleVerifiedCaseAccess`（#342。`features/cases/`） | `QueryClient`・文脈（利用者・案件・部屋・利用者の世代・参加の期間）・判定（`participant`・`lost`・`notFound`・`switched`・`forbidden`） | `confirmed`・`handedOff`・`unverified`。照合が成り立たなければ、副作用なしで`unverified` |

## テストの場所

- 入口の単体：`frontend/src/features/access-loss/reload-after-access-loss.test.ts`（偽の時計・`browser-location`の差し替え。持ち主・合流・待ち方・5秒の上限・ログアウト・利用者の切り替え・取りやめ・読み込み先）
- 知らせ：`frontend/src/features/access-loss/access-loss-notice.test.tsx`（種類だけの保存・保存先の失敗・捨てる条件・「閉じる」。#340：新しい2つの種類を読んで出すこと、決めた種類以外は無視すること）。入口の単体の`reload-after-access-loss.test.ts`には、#340で、下書きの印（`noteDraftsRemain`）の確かめを足した（持ち主が同じなら`…DraftsRemain`を書く・持ち主が違う・待機がない・取りやめの後は書かない）
- 境界：`frontend/src/features/access-loss/components/AccessLossBoundary.test.tsx`（`hidden`・`inert`・覆い・Esc・開き直し）
- 離脱の確認の抑止：`frontend/src/features/leave-guard/leave-guard.suppress.test.tsx`
- 進行中の書き込みの数：`frontend/src/services/api-client.pending-writes.test.ts`（書き込みのメソッドだけ数える・読み取りは数えない・失敗・取り消しでも必ず減る）
- 画面：`frontend/src/pages/CaseAccessLossReload.test.tsx`（P-10d を含む。きっかけごとに、片付けの後に入口が呼ばれる・呼ばれない。退出の理由と場所・持ち主）、`CaseAccessLossReload.directWrite.test.tsx`（`MutationCache`に載らない直接の送信を保留している間は読み込み直さない）、`CaseAccessLossReload.waiting.test.tsx`（実際の入力欄で投稿を保留したまま外される・保存先の知らせの表示）、`CaseAccessLossReload.drafts.test.tsx`（#340。保留を403で失敗させても、読み込み直す時点で下書きが無い。消せなかったとき、読み込み直す時点の知らせの種類が`lostDraftsRemain`になる）
- E2E：`e2e/case-access-loss-reload.spec.ts`（実際の読み込み直し・最上位の層が隠れる・Tab・Esc・「戻る」・`beforeunload`。[e2e.md](../testing/e2e.md)）
- 【#298。C-209】利用者の切り替えでの読み込み直し：入口の単体は`frontend/src/features/access-loss/reload-after-access-loss.user-switch.test.ts`（1回だけ・#338 の待機の引き継ぎ・入口どうしの交錯・5秒の上限・1つ後のタスク・知らせの消去・`reloading`の後）。見張りが入口を呼ぶ条件は`frontend/src/features/auth/user-switch-guard.reload.test.ts`。覆いと`beforeunload`・読み込み直しの流れ・アップロードの保留中の切り替えは、`frontend/src/user-switch.reload-overlay.test.tsx`・`user-switch.reload-flows.test.tsx`・`user-switch.upload-mismatch.test.tsx`（App 全体）。案件の画面の資格の確かめは`frontend/src/pages/CaseAccessLoss.userMismatch.test.tsx`・`frontend/src/features/cases/hooks/useCaseAccessLoss.switch.test.tsx`。受けたタブの確かめが 409 のとき入口を呼ばないことは`frontend/src/features/cases/case-access-loss-relay.test.ts`の末尾。既存の`CaseAccessLoss.userSwitch.test.tsx`には、読み込み直しが1回求められることを足した（期待は変えていない）。E2E：`e2e/session-user-mismatch.spec.ts`（[e2e.md](../testing/e2e.md)）
- 【#341。C-208】別のタブへの伝え方
  - 合図の単体：`frontend/src/features/access-loss/access-loss-broadcast.test.ts`（送る値のキーが`v`・`userId`・`caseId`だけ・保存先に書かない・遅れて作る・形の違う値と知らない版とほかの名前を捨てる・使えない環境〔機能なし・`SecurityError`〕・想定外の例外〔送る側は`reportError`、受ける側は投げる〕）
  - 受けたタブの単体：`frontend/src/features/cases/case-access-loss-relay.test.ts`（利用者が違う・セッションなし・参加者の概要がない・非参加の概要では通信しない／参加者のまま・500・403・通信の失敗では入口を呼ばない・概要のキャッシュを書き換えない・中身と下書きを消さない／非参加・404 で入口を`{ ownerId, reason: "lost" }`で1回呼ぶ／確かめの間の切り替え・ログアウト・入口の状態変化／重なり・解除／応答の検証の失敗は`reportError`）
  - 画面：`frontend/src/pages/CaseAccessLossCrossTab.test.tsx`（表示中の S-17 が受ける・500・画面は A で通信の利用者は B の状態〔入口だけ呼ばれ、下書きとキャッシュは残る〕・参加者を見ていない作り直した画面・書き戻しの限界を固定・退出の合図を受けたタブの読み込み直しは1回）、`CaseAccessLossCrossTab.limit.test.tsx`（本物の入口で、待機に入った後は入力欄に届かない）
  - 送る側：`frontend/src/pages/CaseAccessLossReload.test.tsx`の末尾の`describe`（送る・送らない経路、順序、`unverified`の後の確定、参加者に戻った後の再びの喪失）、`frontend/src/features/cases/hooks/useParticipantWrites.leave.test.tsx`（退出の成功だけ送る・失敗・ほかの人を外す場合は送らない・送信の例外でも退出は成功のまま）、`access-loss-notice.test.tsx`（取り違えた場合の知らせの既知の動きの固定）
  - テスト専用のチャンネル：`frontend/src/test/fake-broadcast-channel.ts`（`FakeBroadcastChannel`・ほかのタブから送る`postFromOtherTab`・`flushTasks`）。`frontend/src/test/setup.ts`が差し替える
  - E2E：`e2e/case-access-loss-cross-tab.spec.ts`（2件。実ブラウザの同じコンテキストの3ページで、合図を受けたタブが、自分の更新を止めた状態でも、概要を1回取り直して読み込み直される。対照は、合図の経路を止めると動かない。[e2e.md](../testing/e2e.md)）
  - 既存のテストの期待は変えていない（既存の2つのテストのファイルには、準備と、末尾の`describe`を足しただけ）
- 【#339。C-210】S-17 の外での検出
  - 見張り・判定・実績の単体：`frontend/src/features/cases/case-access-loss-monitor.test.ts`（経路 × 判定の表のパラメータ化・返信の 404 は直前の`caseId`で確かめる・`switched`・下書きは持ち主の当該部屋だけ・`unverified`の後に確定しても合図と下書きを処理・同じ参加の期間で1回・行の消失だけでは副作用なし・並び替え／ページ移動／追加の取得／手での書き換え／削除を行消失にしない・片付けと本人の退出の後は古い行から始めない・確かめの途中の利用者の切り替え）、`frontend/src/features/cases/case-access-evidence.test.ts`（Query を削除した後は、消えた実績で中継が確かめない。対照として、実績が残っていれば GET 1回、比べる元の情報が生きていれば行の消失で GET 1回）。比べる元を捨てる場面の確かめは、`case-access-loss-monitor.test.ts`にある。チャンネルの詳細で分かる対応は、`case-access-loss-monitor.test.ts`の末尾の`describe`と、中継・初回の概要の各テストに分けて確かめる
  - S-17 との分担：`frontend/src/features/cases/hooks/useCaseAccessLoss.monitor.test.tsx`（S-17 の表示中は確かめと確定が二重にならない・確かめの途中の離脱と再表示・初回の概要と確かめが重なっても確定の副作用は1回・`StrictMode`〔ルートの側の`reactStrictMode: true`〕・Query の破棄で古い待ちが無効になる・実績の判定に使った部屋の ID が確定へ渡る）
  - 中継：`frontend/src/features/cases/case-access-loss-relay.test.ts`（概要を持たず、スレッドの実績があるタブは合図から確かめて入口だけを呼ぶ／概要も実績も無いタブは通信しない／切り替えの後は前の利用者の実績を使わない。既存の`#341 AC-4 T-R2`の2件は、名前に「部屋・スレッドの実績もない」を補っただけで、期待は変えていない）
  - 画面：`frontend/src/pages/CaseAccessLoss.initial-summary.test.tsx`（実績がある初回の非参加・404 は、片付け・入口・合図・下書きの消去を1回ずつ。実績が無ければ、片付けだけ。非参加と 404 を分ける）、`frontend/src/pages/ThreadsPage.access-loss.test.tsx`（S-17 を開かず、S-35 の返信の拒否から覆いまで進む）。成功応答の`caseId`の検証：`frontend/src/features/threads/api/thread-api.test.ts`・`frontend/src/features/messages/api/message-api.thread.test.ts`・`frontend/src/features/messages/hooks/useThreadReplies.test.tsx`（追加が0件でも`caseId`を保持し、その後の 404 から確かめられる）
  - サーバー：[threads.md](threads.md)の「テストの場所」
  - E2E：`e2e/case-access-loss-outside-view.spec.ts`（2件。[e2e.md](../testing/e2e.md)）
  - 期待を変えた既存のテスト（`caseId`の追加・決定 D2 の置き換え）は、PR の本文に、ファイルとテストの名前で列挙する
- 【#342。C-212】bfcache の復元の守り（受け入れ条件の番号は Issue #342 のもの。テストの名前に `#342 AC-n` を付けてある）
  - 守りの単体：`frontend/src/features/access-loss/page-restore-guard.test.tsx`（`pagehide`・`pageshow`の`persisted`の真偽の組み合わせ、捕まえた後のキャッシュの削除、全件の確かめと同時2件の上限・一部だけの成功、再試行で全件を取り直す、古い試行・解除の後・`failed`や`handedOff`の後に残った要求の完了、401・403・通信の失敗・5xx・時間切れの分け方、`waiting`・`reloading`のときの扱い、別の利用者、概要の 409 の後の 401〔#382 による既知の限界〕、`reloadWhenRetryUnreachable`の入口〔失敗の覆いを開けられなかったとき〕。通信は MSW、確定の入口・概要の取得・セッションの確かめは本物）
  - 境界：`frontend/src/features/access-loss/components/AccessLossBoundary.restore.test.tsx`（`pagehide`の同じ処理の中での`hidden`・`inert`、描画への同期が失敗した後の再試行と解除、子を外さずに入力・ダイアログを保つこと、外した後のフォーカス・選択範囲・スクロールの復帰、失敗の覆い）。jsdom では`:modal`が何にも当てはまらず、隠した要素の`blur()`も効かないので、ブラウザで起きるこの2つは、テストの中で手で起こす
  - 再遷移の口：`frontend/src/features/access-loss/reload-after-access-loss.restore.test.ts`（`reloading`のときだけ`reloadPage`を1回。`idle`・`waiting`では何もしない。知らせの消去との前後）
  - セッションの確かめ：`frontend/src/features/auth/verify-document-session.test.ts`
  - 対象・詳しい結果・確定の入口：`frontend/src/features/cases/case-access-evidence.restore.test.ts`（`caseAccessTargets`。`caseRoomEvidence`との一致）、`case-access-verification.restore.test.ts`（詳しい結果の状態、1つの引数の呼び出しが変わらないこと、409 の数え方）、`case-access-loss-monitor.restore.test.ts`（`settleVerifiedCaseAccess`の判定ごとの副作用と戻り値、照合が成り立たないときの`unverified`）
  - 画面：`frontend/src/pages/CaseAccessLossRestore.test.tsx`（守り・境界・S-17・S-35・確定の入口・切り替えの入口・離脱の確認の接続と、入力の保持）
  - テストの共通の準備：`frontend/src/test/page-restore-harness.tsx`（`main.tsx`と同じ組み立てで守りを登録し、`pagehide`・`pageshow`を合成し、確かめの通信を答えの列と保留つきで返す。後始末で、登録の解除により、守りの状態と試行の番号を初期に戻す）
  - E2E：`e2e/bfcache-access-loss.spec.ts`（開発用。12件）・`e2e-prod/bfcache-access-loss.spec.ts`（本番形。1件）。合成のイベントで、実際の復元の証拠ではない。[e2e.md](../testing/e2e.md)
  - 通常のブラウザでの確かめ（M0〜M3）：[bfcache.md](../testing/bfcache.md)。**まだ行っていない**

## 関係するIssueとADR

- Issue #338（親 #323）。依存：#363（(b) の判定）。後続：#339（S-17 の外での検出）・#340（下書き。済み）・#341（別のタブ。済み。ただし限界あり）・#342（bfcache。342-A を実装。上の Issue #342 の行）
- Issue #340（親 #323）：消せなかった下書きの知らせ。画面の側のログの仕組みは#372
- Issue #341（親 #323）：別のタブへの合図。関連：#298（別のタブでの利用者の切り替え。C-209・ADR-0035 で実装済み）・#376（画面の利用者と通信の利用者が食い違うタブでの取り違え。#298 とまとめて直した）
- Issue #298（#376 を含む）：利用者の切り替えでの読み込み直し。後追い：#380・#382・#383
- Issue #339（親 #323）：S-17 の外での検出。検索だけの経路は別の Issue（#388）
- Issue #342（親 #323）：bfcache の復元の守り（342-A）。分けた後続：#391（342-B。条件つき）・#392（342-C）。範囲の外：#388・#390・#398。後追い：#382（概要の 409 の後の 401）
- 決定：C-206・C-207・C-208・C-209・C-210・C-212（[decision-register.md](../requirements/decision-register.md)）、C-190
- [ADR-0033](../adr/0033-reload-page-after-access-loss.md)、[ADR-0034](../adr/0034-cross-tab-access-loss-hint.md)、[ADR-0030](../adr/0030-clear-cache-on-user-switch.md)、[ADR-0035](../adr/0035-session-user-mismatch-header.md)、[ADR-0036](../adr/0036-case-access-loss-outside-view.md)、[ADR-0038](../adr/0038-bfcache-access-check.md)
- 設計書：[cases.md](cases.md)・[app-shell.md](app-shell.md)・[drafts.md](drafts.md)・[auth-session.md](auth-session.md)
- テストの手順：[e2e.md](../testing/e2e.md)・[bfcache.md](../testing/bfcache.md)
