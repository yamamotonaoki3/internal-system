# 設計書：資格を失ったときの、ページの読み込み直し（Issue #338。#323 の1つ目）

案件の画面（S-17）で資格を失ったと確定したら、いまの片付けの後に、ページの文書ごと読み込み直す。片付けが数え上げで消せないもの（部品の状態・進行中の処理の続き・メモリの中のすべて）を、実行環境ごと消すため。決定は C-206、判断の理由は[ADR-0033](../adr/0033-reload-page-after-access-loss.md)。API・DB は変えない（フロントエンドだけ）。

## 目的と範囲

- 目的：資格を失ったと確定した画面で、参加者だけの中身を、メモリに残さない。読み込み直した後に、理由の知らせを1回出す
- 範囲：S-17 の表示中に確定する場合（下の「呼ぶ場所と条件」）。呼ぶ場所は`frontend/src/features/cases/`にあり、この機能（`features/access-loss/`）は、待ち方・隠し方・知らせを持つ
- 範囲の外：S-17 の外での検出（#339）・下書き（#340）・別のタブ（#341）・bfcache（#342）・数え上げの方式の削除（#339〜#342 の後の別の Issue）

## ファイルと役割

置き場所は`frontend/src/features/access-loss/`（以下、ファイル名だけ書く）。

| ファイル | 役割 |
| --- | --- |
| `reload-after-access-loss.ts` | 入口`requestAccessLossReload`と、状態（`idle`／`waiting`／`reloading`）の購読（`getAccessLossReloadState`・`subscribeAccessLossReloadState`）。待機の持ち主・合流・待ち方・取りやめ・読み込み先の決め方を持つ。状態は文書ごとに1つ |
| `browser-location.ts` | `reloadPage`・`replacePage`。`window.location`を触るのは**ここだけ**（テストで差し替える点を1か所にするため） |
| `access-loss-notice.ts` | 読み込み直した後の知らせ。保存先（`sessionStorage`）の読み書き、出す・捨てる判定、購読 |
| `components/AccessLossBoundary.tsx` | 境界。子（ルーター全体）を`hidden`と`inert`の包みで包み、`idle`以外で全画面の覆いを出す |
| `components/AccessLossNotice.tsx` | 知らせの表示（`Alert`と「閉じる」）。表示の判定は持たない |
| `index.ts` | 公開部分。ほかの機能はここだけを通して使う |
| `frontend/src/features/leave-guard/before-unload-suppression.ts` | 離脱の確認（`beforeunload`）を止めない印（`suppressBeforeUnload`・`restoreBeforeUnload`・`isBeforeUnloadSuppressed`）。`leave-guard/index.ts`から前の2つを公開し、`hooks/useLeaveGuard.ts`の`beforeunload`の処理が印を読む。立てる・外すのは入口だけ |
| `frontend/src/main.tsx` | `QueryClientProvider`の中で、`RouterProvider`を`AccessLossBoundary`で包む（`LeaveGuardProvider`は、ルーターの要素として`App`を包んでいるので、境界はその外側になり、離脱の確認も隠れる）。描画の前に`takeAccessLossNotice`を1回呼ぶ |
| `frontend/src/features/app-shell/AppShell.tsx` | `LogoutFailureNotice`の直後に`AccessLossNotice`を置く |

## 呼ぶ場所と条件

呼び出し側の詳細は[cases.md](cases.md)の「資格を失ったときの画面の切り替え（#308）」の「読み込み直し（#338）」にある。入口は、いずれも**片付けの後**（退出だけは前。下の「本人の退出」）に呼ぶ。

## 入口の流れ（`requestAccessLossReload(queryClient, { ownerId, reason, leftCasePath? })`）

持ち主は、確定を始めた時点の利用者（画面の`userId`。退出は押した時点の`actorId`）。理由は`lost`か`left`。

1. いまのセッションの利用者が分かっていて持ち主と違えば、何もしない。セッションが無いときは続ける
2. 状態が`reloading`なら何もしない。`waiting`で持ち主が同じなら**合流**する（同じ文書の同じ持ち主は1回にまとめる）。合流では、理由は`left`を優先し、`left`のときは退出した案件の場所（`leftCasePath`）を持つ。持ち主が違えば、古い待機を取りやめてから続ける
3. `waiting`にし、離脱の確認の抑止を立てる。セッションのキャッシュを購読し、いまの利用者が持ち主と**別の利用者**になった時点で取りやめる（`idle`に戻し、抑止を外し、購読とタイマーを外す）。セッションが無くなるだけでは取りやめない（401・ログアウトの後も続ける）
4. 進行中の操作を待つ。
   - 上限なし：状態が`pending`の、ログアウトの操作のうち、押した時点の利用者（`useLogout`が操作の文脈に持つ）が持ち主と同じもの。その操作が`pending`でなくなる（成功・失敗の後処理が済む）まで待つ。セッションの消失は待ちの終わりの合図にしない
   - 上限5秒（定数`WAIT_LIMIT_MS`）：それ以外の`pending`の操作すべて（ほかの利用者のログアウトを含む）
5. 待ちが終わったら、1つ後のタスクまで待つ（操作の完了の後に続く処理、たとえば`mutateAsync`の続きの下書きの消去を、先に走らせるため）
6. もう一度、利用者を比べる（別の利用者なら取りやめ）。セッションがあれば、知らせの種類を書く
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

- 書く：読み込み直す直前に、入口が`writeAccessLossNotice(kind)`を呼ぶ。保存するのは**種類（`lost`・`left`）だけ**（キーは1つの const。利用者の ID・案件の中身は、値にもキーにも入れない。Skill「security」）。保存先は`sessionStorage`
- 読む：`main.tsx`が、描画の前に`takeAccessLossNotice(queryClient)`を1回呼ぶ。読んで消し、この文書で出す知らせとして持つ。決めた種類以外の値は無視する
- 出す：`AccessLossNotice`が、知らせを1つ出す。退出は「案件から退出しました。」、喪失は「この案件を表示できなくなったため、画面を読み込み直しました。保存していない入力は消えています。」。「閉じる」で消える
- 捨てる：(1) 最初のセッションの確認が成功する前に、未認証（401）が確定した、またはセッションのクエリが消された（次にログインする別の人に出さない） (2) この文書で最初に確定した利用者から、別の利用者に替わった (3) 「閉じる」。セッションが無い間は出さない
- 保存先の失敗の扱い（`draft-storage.ts`と同じ考え方）：受け止めるのは「保存先が使えない」ことを表す例外だけ。保存先の参照（`openNoticeStorage`）・読み・消しは`SecurityError`だけ「保存先なし・知らせなし」とする。書きは`SecurityError`と`QuotaExceededError`だけ、知らせを諦めて（`false`を返す）読み込み直しを続ける。ほかの例外は投げ直す
- 未決定：書きの失敗を受け止めたとき、ログに残していない（フロントエンドには、エラーをログに出す仕組みがないため）。`AGENTS.md`の「付随する後始末の失敗は、必ずログに残す」との関係は、利用者の判断を待つ（PR の「未実施・未決定」に記録）

## 関連する既存の機能との関係

- 利用者の切り替え（[ADR-0030](../adr/0030-clear-cache-on-user-switch.md)）：`installUserSwitchGuard`は変えない。待機は、別の利用者に替わったら取りやめる。片付け（キャッシュと完了した操作の記録の消去）は読み込み直しの前に済んでいる
- 401・ログアウト：`useLogout`・未認証の処理（`unauthenticated-handler.ts`）は変えない。セッションが消えるだけでは待機を取りやめない
- 画面のテストでは、入口を`frontend/src/test/setup.ts`で`vi.fn`に差し替えている（待機の状態・購読・タイマーがテストの間に残らないように）。本物を確かめるテストは`vi.unmock`する

## 主な関数の入力と出力

| 関数 | 入力 | 出力・効果 |
| --- | --- | --- |
| `requestAccessLossReload` | `QueryClient`・`{ ownerId, reason, leftCasePath? }` | `Promise<void>`（読み込み直したか取りやめたときに解決）。呼んだその場では読み込み直さない |
| `getAccessLossReloadState`・`subscribeAccessLossReloadState` | なし／リスナー | 状態`idle`・`waiting`・`reloading`と、購読の解除関数 |
| `writeAccessLossNotice` | 種類 | 書けたか（`boolean`） |
| `takeAccessLossNotice` | `QueryClient` | 読んだ種類（`null`なら知らせなし）。副作用として、出す知らせを持ち、セッションの変化を購読する |
| `openNoticeStorage` | なし | `Storage`か`null`（`SecurityError`のとき） |
| `reloadPage`・`replacePage` | なし／行き先 | `window.location`の操作 |

## テストの場所

- 入口の単体：`frontend/src/features/access-loss/reload-after-access-loss.test.ts`（偽の時計・`browser-location`の差し替え。持ち主・合流・待ち方・5秒の上限・ログアウト・利用者の切り替え・取りやめ・読み込み先）
- 知らせ：`frontend/src/features/access-loss/access-loss-notice.test.tsx`（種類だけの保存・保存先の失敗・捨てる条件・「閉じる」）
- 境界：`frontend/src/features/access-loss/components/AccessLossBoundary.test.tsx`（`hidden`・`inert`・覆い・Esc・開き直し）
- 離脱の確認の抑止：`frontend/src/features/leave-guard/leave-guard.suppress.test.tsx`
- 画面：`frontend/src/pages/CaseAccessLossReload.test.tsx`（きっかけごとに、片付けの後に入口が呼ばれる・呼ばれない。退出の理由と場所・持ち主）、`CaseAccessLossReload.waiting.test.tsx`（実際の入力欄で投稿を保留したまま外される・保存先の知らせの表示）
- E2E：`e2e/case-access-loss-reload.spec.ts`（実際の読み込み直し・最上位の層が隠れる・Tab・Esc・「戻る」・`beforeunload`。[e2e.md](../testing/e2e.md)）

## 関係するIssueとADR

- Issue #338（親 #323）。依存：#363（(b) の判定）。後続：#339（S-17 の外での検出）・#340（下書き）・#341（別のタブ）・#342（bfcache）
- 決定：C-206（[decision-register.md](../requirements/decision-register.md)）、C-190
- [ADR-0033](../adr/0033-reload-page-after-access-loss.md)、[ADR-0030](../adr/0030-clear-cache-on-user-switch.md)
- 設計書：[cases.md](cases.md)・[app-shell.md](app-shell.md)・[drafts.md](drafts.md)・[auth-session.md](auth-session.md)
