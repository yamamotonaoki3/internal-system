# メッセージ入力欄の下書きの一時保存と、離脱の確認（Issue #239）

コードは書き写さず、ファイル名・関数名で指す。決定は決定記録C-170（[decision-register.md](../requirements/decision-register.md)）。要件は1-1 AC-4、0-2 AC-8（[01-messaging.md](../requirements/01-messaging.md)・[00-foundation.md](../requirements/00-foundation.md)）、C-82・C-117。

## 目的

メッセージ入力欄（チャンネル・DM）の書きかけの本文を、端末のブラウザ（`localStorage`）に下書きとして一時保存し、その部屋に戻ると復元する（1-1 AC-4）。サーバーには送らない。あわせて、入力内容が失われる操作（画面の移動・ログアウト・再読み込み・タブを閉じる）の前に確認を出す。

## 範囲

| 区分 | 内容 |
| --- | --- |
| このIssueで作ったもの | チャンネル・DMの入力欄の下書き（保存・復元・期限・消去）／離脱の確認（画面の移動・ブラウザの戻る・再読み込み・タブを閉じる）／手動ログアウトの前の確認／ログアウトの成功時の下書きの消去／ログアウトの失敗の案内（共通レイアウト）／下書きを消せなかったときのログイン画面の案内 |
| #245に分けたもの | メッセージ入力欄以外の入力画面（個人情報の入力画面など）の離脱の確認。この設計の`LeaveGuardProvider`・`useLeaveGuard`を使い回す |
| 各Issueに残したもの | スレッド返信・案件の申請（S-18）の下書き。キーの`scope`を足すだけで保存できる（今は`room:<部屋ID>`だけ） |
| 作らないもの | 端末をまたぐ継続、保存内容の暗号化、複数タブへの反映（`storage`イベントは購読しない。1-1 AC-4・C-117）、フロントエンドの共通ロガーへの記録（#234） |

## ファイルと役割

依存の向きは、`auth → drafts・leave-guard`、`messages → auth・drafts・leave-guard`、`pages（ログイン画面）→ auth`、`app-shell → auth`。`drafts`と`leave-guard`は`auth`に依存しない（`npm run deps:check`で循環しないことを確かめる）。

### `frontend/src/features/drafts/`（下書きの保存）

| ファイル | 役割 |
| --- | --- |
| `draft-policy.ts` | 規則の定義元。`DRAFT_TTL_MS`（7日）・`DRAFT_CLOCK_SKEW_MS`（5分）・`DRAFT_KEY_PREFIX`・`roomDraftScope`・`draftKey`・`userDraftKeyPrefix`・`isBlankDraft`・`isDraftExpired`。「空」（空白・改行だけ）の判定は下書き一般の規則としてここに持つ。`shared/message-rules.ts`の`messageBodySchema`（送信の可否）とは意味が違う定義（保存の要否）なので統合せず、`shared/`は変えない |
| `draft-storage.ts` | 保存先（`Storage`）と現在時刻を引数で受ける関数。`openDraftStorage`・`readDraft`・`writeDraft`・`removeDraft`・`removeUserDrafts`・`purgeExpiredDrafts`・`purgeExpiredDraftsOnStartup`・`DraftStorageUnavailableError`。値はZodで検証する |
| `hooks/useDraft.ts` | 入力欄用。マウントで復元し、入力のたびに保存する。戻り値は`initialBody`・`unavailable`・`save`・`discard` |
| `index.ts` | 公開部分。ほかの機能はここだけを通して使う |

### `frontend/src/features/leave-guard/`（離脱の確認）

| ファイル | 役割 |
| --- | --- |
| `LeaveGuardProvider.tsx` | 離脱の確認の提供元。`useBlocker`を1つだけ持ち、登録された見張りが1つでもあれば遷移を止める。確認の待ちとダイアログも1つだけ持つ |
| `leave-guard-context.ts` | Context。`register`・`hasChanges`・`confirmLeave`。提供元がないときは`null` |
| `hooks/useLeaveGuard.ts` | 入力欄が「変更あり」の間だけ見張りを登録し、`beforeunload`を購読する。`beforeunload`は提供元がなくても働く |
| `hooks/useLeaveConfirmation.ts` | ログアウトなど、画面の移動以外の「離れる操作」の前に確認を出すための入口。提供元がなければ`null`（確認なしで進む） |
| `components/LeaveConfirmDialog.tsx` | 確認ダイアログ（`<dialog>`・共通の`Button`）。初めのフォーカスは「編集を続ける」、Escも「編集を続ける」と同じ |
| `index.ts` | 公開部分 |

### 変更したファイル

| ファイル | 変更の要点 |
| --- | --- |
| `frontend/src/main.tsx` | 画面の振り分け（`App`）を`LeaveGuardProvider`で包む。描画の前に`purgeExpiredDraftsOnStartup`を呼ぶ |
| `frontend/src/features/messages/components/MessageComposer.tsx` | `useDraft`で復元と保存、`useLeaveGuard`で変更ありの見張り。送信の成功で`reset({ body: "" })`と`discard`。案内（保存できない環境）は入力欄の下 |
| `frontend/src/features/messages/components/RoomMessages.tsx` | `useSignedInUserId`で利用者IDを取り、`MessageComposer`の`key`を`<利用者ID>:<部屋ID>`にする（利用者IDがなければ`anonymous:<部屋ID>`） |
| `frontend/src/features/auth/hooks/useSignedInUserId.ts` | セッションのキャッシュから利用者IDを返す（下の「利用者IDの取り方」） |
| `frontend/src/features/auth/hooks/useLogout.ts` | `mutationKey`（`authKeys.logout`）を付け、押した時点の利用者IDを`onMutate`で確定し、`onSuccess`で下書きを消す |
| `frontend/src/features/auth/components/LogoutButton.tsx` | 変更があるときは、`mutate`の前に`confirmLeave`で確認する |
| `frontend/src/features/auth/components/LogoutFailureNotice.tsx`・`logout-failure-focus.ts`・`logout-failed-message.ts` | ログアウトの失敗の案内（共通レイアウトの、ヘッダーの直下）、フォーカスを移すかの判定、文言の定義元 |
| `frontend/src/features/auth/components/DraftCleanupNotice.tsx` | ログイン画面の「下書きを消せなかった」案内 |
| `frontend/src/features/auth/api/query-keys.ts` | `authKeys.logout`（mutationのキー）を追加 |
| `frontend/src/features/app-shell/AppShell.tsx` | `LogoutFailureNotice`をヘッダーの直下に置く |
| `frontend/src/pages/LoginPage.tsx` | `DraftCleanupNotice`を置くだけ（C-06） |
| `frontend/src/test/setup.ts` | `afterEach`で`localStorage`・`sessionStorage`を空にする（テストの間で下書きを持ち越さない） |
| `stryker.config.json` | `features/drafts`・`features/leave-guard`・`useLogout.ts`・`useSignedInUserId.ts`・`LogoutButton.tsx`・`LogoutFailureNotice.tsx`・`DraftCleanupNotice.tsx`・`logout-failure-focus.ts`を対象に足した（認証・個人情報に近いため検出力を確かめる） |

バックエンド・API・DB・`shared/`・`unauthenticated-handler.ts`・`RequireAuth.tsx`は変えていない。

## キーと値

- キー：`internal-system:draft:v1:<利用者ID>:<scope>`。`scope`は今は`room:<部屋ID>`だけ（チャンネルとDMは部屋のIDで一意）。値の形を変えるときは版（`v1`）を上げる。利用者の分の削除は、利用者IDの後ろの区切りまで含めた接頭辞で絞る（別の利用者のIDの前方一致に巻き込まない）
- 値：`{ body, updatedAt }`のJSON。`updatedAt`は最終編集の時刻（ミリ秒）。読むときにZodで検証し、JSONでない・形の違う値・小数・負の数は壊れた値として、そのキーを消して「下書きなし」にする
- 保存するのはキー（利用者ID・部屋ID）・本文・更新日時だけ。トークンなどの秘密情報は置かない。名前・パスワード・メールなどの個人情報の欄と再認証の入力は保存しない（1-1 AC-4、0-1 AC-21）。保存するのはメッセージ入力欄だけ

## 期限と消す時点

- 期限：`isDraftExpired`。`now - updatedAt >= DRAFT_TTL_MS`（7日ちょうどで期限切れ）、または`updatedAt > now + DRAFT_CLOCK_SKEW_MS`（未来の日時は5分の余裕を超えたら壊れた値）。端末の時計で判定する。ちょうど`now + 5分`は残り、`+5分+1ms`で消える
- 消す時点：

| 時点 | 消すもの |
| --- | --- |
| アプリを開いたとき（`main.tsx`の`purgeExpiredDraftsOnStartup`） | 全利用者の、期限切れ・壊れた値の下書き。期限内と、接頭辞の違うキーには触れない |
| 読むとき（`readDraft`） | そのキーが期限切れ・壊れた値なら消して`null` |
| 送信の成功（`MessageComposer`） | その部屋の下書き。本文は復元値に戻さず空にする。送信の失敗（422・500）では残す |
| 利用者が破棄したとき（離脱の確認の「破棄して離れる」） | 見張りの`onDiscard`（`useDraft`の`discard`） |
| 手動ログアウトのAPIの成功（`useLogout`） | その利用者の下書きすべて（`removeUserDrafts`）。APIの失敗では消さない |
| 入力が空・空白だけになったとき（`writeDraft`） | そのキー |

- 掃除は、先にキーを配列に集めてから消す（消しながら番号で数えると取りこぼすため）
- **自動ログアウトでは消さない**（無操作30分・ログインから1日・パスワードの再発行・アカウントの無効化・他の端末の失効などの401。C-170）。同じ端末の別の社員には、キーが利用者ごとに分かれているため画面上で見えない（論理的な分離）

## 保存の失敗の扱い

- 受け止める例外は、保存先が使えないことを表す`SecurityError`と`QuotaExceededError`（`DOMException`の名前）だけ。`draft-storage.ts`の各関数が`DraftStorageUnavailableError`に変えて投げ、それ以外の例外は変えずに投げ直す（AGENTS.mdの「エラーの扱い」：成功に見える値を返さない）
- `openDraftStorage`は、`window.localStorage`の参照そのものが`SecurityError`のとき（Cookieの拒否など）だけ`null`（保存先なし）を返す
- `useDraft`は`DraftStorageUnavailableError`だけを受け止め、以後の**書き込み**を止めて`unavailable`を真にする。入力欄の下に「この環境では下書きを一時保存できません。」（`Alert`の`info`・`role="status"`）を必ず出す。送信と離脱の確認はそのまま働く。保存できなくなった後も、消す操作（空の本文・送信後の削除）は止めない
- 利用者IDがない（匿名の）ときは読み書きせず、案内も出さない（離脱の確認の見張りは働く）
- アプリを開いたときの掃除（`purgeExpiredDraftsOnStartup`）は`DraftStorageUnavailableError`だけを受け止めて起動を続ける。理由：保存先が使えないなら、入力欄の読み書きでも同じ例外になって案内が出る。期限切れは読むときにも消す。それ以外の例外は投げ直す
- ログアウトの消去の失敗は「ログアウトの流れ」に書く

## 利用者IDの取り方（`useSignedInUserId`）

- セッションのキャッシュ（`authKeys.session`）の`user.id`を返す。取得の通信はしない。キャッシュがなければ`undefined`（読み書きしない側に倒す）
- `useQuery`の`enabled: false`ではなく、`useSyncExternalStore`でクエリのキャッシュを購読する。理由：`useQuery`の通知は次のタスクまで遅れ、遅れる間にログアウト・401の直後でも前の利用者のキーへ書く窓ができる。この購読ならキャッシュの変化に同期して反映できる
- **利用者IDが変わったときだけ通知する**。理由：キャッシュの通知を無条件に受けると、別の部品の描画中に起きたクエリの追加にも反応して再描画を予約し、「描画中に別のコンポーネントを更新した」という警告が出る（E2Eで見つかった）
- 描画したまま利用者が替わっても前の利用者の本文を新しい利用者のキーに書かないよう、二重に守る：①`MessageComposer`の`key`に利用者IDを含めて作り直す ②`useDraft`はマウント時の利用者IDを持ち、今と違えば書き込まない

## 離脱の確認の流れ

- **変更あり**：`MessageComposer`が、本文が空白だけでなく、かつ復元した値（なければ空）と違うときに真とする。復元したまま離れたときは確認を出さず、下書きも残す（C-170）。値はフォームの`useWatch`から導き、State にしない
- **確認の待ちは1つ**：`LeaveGuardProvider`は確認の待ちを `none`／ブロッカーが止めた遷移／ログアウトの確認 のどれか1つだけ持ち、ダイアログも1つだけ描く。ルーター1つにつきブロッカーは1つなので、**#245でほかの入力画面が離脱の確認を使うときも、この`LeaveGuardProvider`と`useLeaveGuard`を使い回す**
- **止める遷移**：見張りが1つでもあり、移動先の`pathname`が現在と違い、移動先が`/login`でないとき。同じ`pathname`への移動（クエリだけの変更など）と`/login`への移動は止めない。`/login`を止めない理由：自動ログアウトの2経路（`unauthenticated-handler.ts`の`router.navigate`、`RequireAuth`の`<Navigate>`）と、確認を済ませた後の手動ログアウトの移動のため。ブラウザの戻る・部屋の切り替え（`/channels/A`→`/channels/B`）も止める
- **ダイアログ**：「入力した内容は失われます」。「編集を続ける」・Escで留まり、本文は残る。「破棄して離れる」は、見張りの`onDiscard`（下書きの削除）を呼んでから遷移を進める
- **再読み込み・タブを閉じる**：`useLeaveGuard`が、変更ありの間だけ`beforeunload`を購読し、`preventDefault`と`returnValue = ""`を設定する。下書きは消さない
- **ログアウトの前の確認**：`LogoutButton`は、変更があるとき（`hasChanges`）だけ`confirmLeave()`（`Promise<boolean>`）を呼び、真が返ったときに`mutate`する。変更がないとき・提供元がないときは、`confirmLeave`を経由せず同期のまま`mutate`を呼ぶ（連打で1回の動きを保つ）。「編集を続ける」ならAPIを呼ばない。「破棄して離れる」は見張りの`onDiscard`を呼ばない（消去はログアウトの成功時の`removeUserDrafts`だけ。APIが失敗したら下書きも本文も残る）
- **競合の扱い**（`LeaveGuardProvider`）：
  - ログアウトの確認の待ち中に場所（`location.key`）が変わった（401の自動ログアウトを含む）ら、待ちを`false`で終える。この判定は「見張りがなくなった」より先に行う。さらに`LogoutButton`は、真を受け取った時点で自分が外れている・セッションのキャッシュがなければ`mutate`しない
  - ログアウトの確認の待ち中に見張りがなくなったら、失う下書きがもうないので`true`で終えてログアウトを進める
  - ログアウトの確認の待ち中にブロッカーが遷移を止めたら（戻る等）、`blocker.reset()`して重ねない（ログアウトの確認を優先する）
  - ブロッカーの確認を表示している間に`confirmLeave()`が呼ばれたら、すぐ`false`を返す。待ち中の連打（2回目以降）も、すぐ`false`を返す
  - ブロッカーの確認の表示中に見張りがなくなったら、確認を閉じて遷移を進める
  - 【後から変更】確認を閉じて遷移を進める処理（`proceed()`）と、ログアウトの確認の待ち中にブロッカーが止めたときの取り消し（`reset()`）は、effect の中で直接呼ばず、次のタスク（`setTimeout` 0）に遅らせる。理由：描画の後に別の遷移（401の`/login`）が済んでブロッカーが`unblocked`に戻っていることがあり、`unblocked`のブロッカーに`proceed()`・`reset()`を呼ぶと React Router が`Invalid blocker state transition`を投げるため（品質チェックで検出）
  - 【後から変更】`proceed()`・`reset()`は`settleBlocker`に集約し、呼ぶ前に ①最新の描画のブロッカーが`blocked` ②処理中でない ③`window.history.state.key`が描画中の`location.key`と同じ、を確かめる。理由：React Router 8.5.1 は状態の更新を`startTransition`で反映するため、ルーターの本当の状態と描画がずれることがあり、ブラウザの履歴はルーターの状態より先に更新される（POPでは`history.go(-delta)`が非同期で、止めている間の履歴は描画中の場所に戻る）。memory router（jsdom）には履歴のキーがないため ①②だけで判断する（実ブラウザの分岐はE2Eで確かめる）
  - 【後から変更】「破棄して離れる」の素早い2回押しは、1回目で処理中の印を立て、2回目は何もしない
- **フォーカスの戻し先**：確認を閉じたら、遷移を始めた要素（`shouldBlock`の時点の`document.activeElement`）へ戻す。その要素が文書から外れた・見えない（スマホ幅のドロワーが閉じたなど。`checkVisibility`）ときは、入力欄へ戻す（入力欄がなければ`body`に落ちるのを避けるため、見張りの`focus`）。ログアウトの確認を閉じたときは入力欄へ戻す。`confirmLeave()`が`false`を受けた呼び出し側は、フォーカスを戻さない（戻すのはProviderがダイアログを閉じたときだけ）【後から変更】戻し先は、遷移を始めた要素が文書にあり表示されていればそこ。そうでなければ（`checkVisibility`が偽、文書から外れた、`HTMLElement`でない＝SVGなど）入力欄
- **提供元がないとき**（既存のテストの`MemoryRouter`・ルーターなし）は、アプリ内の離脱の確認とログアウトの確認だけが働かない。`beforeunload`は働く
- スマホ幅のドロワーのリンクから移ったときは、ドロワーが閉じて確認ダイアログだけが出て、フォーカスは「編集を続ける」に移る
- `showModal()`は、開いている`popover="auto"`（アバターメニュー）を閉じる。そのためログアウトの確認の後に出る「ログアウト中」と失敗の表示は、メニューの中では隠れる。これに対処するのが、下の`LogoutFailureNotice`

## ログアウトの流れ（0-2 AC-8）

1. `LogoutButton`：変更があれば確認。真なら`useLogout`の`mutate`
2. `useLogout`の`onMutate`：押した時点のセッションから利用者IDを確定する（応答を待つ間にキャッシュが替わっても、消す対象は変わらない）。セッションのキャッシュがなければ消す対象を決められないので消去を飛ばす（ログアウトは進める）
3. APIが成功：`onSuccess`で`removeDraftsOf`が下書きを消す（保存先が開けない端末には、このアプリが保存したものもないので成功扱い）。その後`queryClient.clear()`、`navigate("/login", { replace: true })`。`replace`は消去の失敗のときも保つ（0-2 AC-8を退行させない）
4. APIが失敗：何も消さず、画面に留まる。失敗はアバターメニューの中（`LogoutButton`）と、`LogoutFailureNotice`の両方に出る
5. **消去に失敗したとき**（想定外の例外を含む）：投げ直さず、ログアウトは進める（`clear()`で`mutationCache`も消え、ボタンも外れるため、エラーを見せる場所がない。失敗を投げ直すと「ログアウトできませんでした」という事実と違う表示になる）。`navigate`の`state`に`draftCleanupFailed: true`を付け、ログイン画面（S-02）の`DraftCleanupNotice`が「この端末の下書きを消せませんでした。共用の端末では、ブラウザのサイトデータを削除してください。」を出す。`DraftCleanupNotice`は`location.state`を`unknown`で受け、Zodで判定する
   - **ログに残せない理由**：後始末の失敗なので、本来は主の処理の結果を変えずにログへ残す（AGENTS.mdの例外）。しかしフロントエンドに共通のロガーがなく（#234）、`console.*`は禁止のため残せない。代わりに画面の案内で知らせる。#234に「下書きの消去の失敗もログに残す」と追記する

### `LogoutFailureNotice`（ログアウトの失敗の案内）

- `useMutationState`（`mutationKey`が`authKeys.logout`）の**直近**の状態が`error`のときだけ、共通レイアウトのヘッダーの直下に`role="alert"`の`Alert`を出す。次のログアウトを始めると消える（実行中・成功・初期では出さない）
- 新しく`error`になったとき（直近の`submittedAt`が前回処理したものと違うとき）だけ、案内へフォーカスを移す（再マウントでは移さない）。ただし、利用者が見えている要素を触っているときは奪わない：`shouldFocusLogoutFailure`が、`document.activeElement`が`body`・`null`、または`checkVisibility`が偽の要素の中（閉じた`popover`・`dialog`）のときだけ移す。`checkVisibility`がない環境（jsdom）では、失敗を見えなくしない側に倒して移す。移さないときも`scrollIntoView({ block: "nearest" })`で表示域に入れる
- 案内は、直近が`error`の間、別の画面へ移っても再読み込みか次のログアウトまで出続ける（共用の端末での安全の点で問題がないため、そのままにしている）

## 既知の限界

- **開発者ツールで読める**：`localStorage`の下書きは、同じ端末で開発者ツールを使えば読める。暗号化はしない（C-170）。同じ端末の別の社員には画面上で見えない（論理的な分離）
- **別のタブのログアウト後の書き戻し**：タブ1でログアウトしても、タブ2はセッションのキャッシュが残り、次の401までは入力のたびに元の利用者のキーへ書き込む。`BroadcastChannel`は入れない。次のポーリングの401で入力欄が閉じ、書かれた下書きは7日で消え、次のログアウトでも消える
- **ログイン画面の案内が残る**：「下書きを消せなかった」案内は履歴の`state`に残るため、ログイン画面を再読み込みするとまた出る
- **失敗の案内が出続ける**：上の`LogoutFailureNotice`の項のとおり
- **読み上げの重複**：確認を出さない経路でログアウトが失敗したとき、アバターメニューが開いていれば、メニューの中と`LogoutFailureNotice`の両方に同じ文言が出うる（読み上げが重なる）。E2Eは、隠れた要素を除く`getByRole("alert")`か、案内の領域に絞ったlocatorを使う
- **DMの相手が無効になったとき**：入力欄が閉じ、下書きは7日かログアウトまで端末に残る（画面には出ない）

## 主な入出力

| 関数 | 入力 | 出力・副作用 |
| --- | --- | --- |
| `readDraft(storage, userId, scope, now)` | 保存先・利用者ID・scope・現在時刻 | 本文または`null`。期限切れ・壊れた値はキーを消して`null` |
| `writeDraft(storage, userId, scope, body, now)` | 同上＋本文 | 空白だけなら消す。そうでなければ`{ body, updatedAt: now }`を保存 |
| `removeDraft(storage, userId, scope)`・`removeUserDrafts(storage, userId)` | 保存先・利用者ID（・scope） | 1件／その利用者の全件を消す |
| `purgeExpiredDrafts(storage, now)` | 保存先・現在時刻 | 全利用者の期限切れ・壊れた値を消す |
| `purgeExpiredDraftsOnStartup(storage \| null, now)` | 保存先（なければ何もしない）・現在時刻 | 保存先が使えない例外だけ受け止める |
| `useDraft(userId, scope)` | 利用者ID（なければ読み書きしない）・scope | `initialBody`・`unavailable`・`save(body)`・`discard()` |
| `useLeaveGuard({ isDirty, onDiscard, focus })` | 変更の有無・破棄時の処理・フォーカスを戻す処理 | 見張りの登録と`beforeunload`の購読 |
| `confirmLeave()` | なし | 離れてよいか（`Promise<boolean>`） |

## テストの場所

- 単体：`frontend/src/features/drafts/draft-storage.test.ts`（保存・復元・空白・7日−1ms／ちょうど・未来の日時の境界・壊れた値・他の利用者・掃除の連続・fast-check・保存できない環境）
- 離脱の確認：`frontend/src/features/leave-guard/leave-guard.test.tsx`（`createMemoryRouter`。ダイアログ・戻る・`/login`・確認の待ちの競合・`beforeunload`）
- 入力欄：`frontend/src/features/messages/messages.drafts.test.tsx`（復元・送信での消去・利用者の分離・複数のタブ・保存できない環境）
- 追加のテスト：`frontend/src/features/drafts/hooks/useDraft.test.ts`、`frontend/src/features/leave-guard/LeaveGuardProvider.test.tsx`、`frontend/src/features/leave-guard/components/LeaveConfirmDialog.test.tsx`。`leave-guard.test.tsx`は全テストで`console.error`に`Invalid blocker state transition`がないことも確かめる
- ログアウト：`frontend/src/features/auth/hooks/useLogout.drafts.test.tsx`、`auth/components/LogoutFailureNotice.test.tsx`（既存の`LogoutButton.test.tsx`は変えず、連打で1回の動きを保つ）、`auth/hooks/useSignedInUserId.test.tsx`、`auth/unauthenticated-handler.drafts.test.ts`（401では残る）、`frontend/src/features/app-shell/AppShell.logout-failure.test.tsx`、`frontend/src/pages/LoginPage.drafts.test.tsx`
- 保存しない画面：`frontend/src/drafts.no-pii.test.tsx`（ログイン・パスワード変更・再認証・プロフィール・チャンネルの作成申請・取引先・部署の入力で`localStorage`が空のまま）
- E2E：`e2e/message-drafts.spec.ts`（13件。「離脱の確認の表示中に401」「ブラウザの戻る（POP）」を追加。[e2e.md](../testing/e2e.md)）。シードは`e2e/seeds/message-drafts.sql`・`message-drafts-cleanup.sql`
- ミューテーション：[mutation.md](../testing/mutation.md)
- テストの期待値は`DRAFT_TTL_MS`などの本番の定義を読まず、`7 * 24 * 60 * 60 * 1000`・`5 * 60 * 1000`を独立に書く

## 関係するIssue・ADR

- Issue #239：本Issue。親は#133（メッセージ）。#234（フロントエンドの共通ロガー。消去の失敗を記録する）、#245（ほかの入力画面の離脱の確認。この設計の提供元を使い回す）
- 決定：C-170（C-82・C-117を具体化）。ADR-0020 (c)（ルーティングの枠・認証・テスト基盤の変更）に当たるため、ミューテーションとE2Eを全体で実行する
- 関連：[messages.md](messages.md)（入力欄）、[auth-session.md](auth-session.md)（ログアウト・401）、[app-shell.md](app-shell.md)（共通レイアウト）、[dms.md](dms.md)
