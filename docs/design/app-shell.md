# 設計書：共通レイアウトの骨格（S-01）

Issue #121（親 #108）で実装した、ログイン後の全画面が使う枠（ヘッダー・サイドバー・本文・下部メニュー・ドロワー・アバターメニュー）の設計。後続のIssueが、**サイドバーの項目・ヘッダーの部品などを足す場所と書き方**を迷わないようにするための文書。コードは書き写さず、ファイル名・関数名・部品の名前で指す。

## 目的と範囲

- ログイン後の全画面が同じ枠（ヘッダー・サイドバー・本文）を使えるようにし、各機能の画面は本文（`<Outlet />`）の中身だけを作ればよい形にする
- 未ログインの利用者はログイン画面（S-02）へ移す（既存の`RequireAuth`が行う）
- 画面の見た目の基準（トークン・部品・768pxの境目）は [style-foundation.md](style-foundation.md) に従う。ライブラリは追加していない（ドロワーはネイティブの`<dialog>`、アバターメニューはネイティブの`popover`）
- S-01の実装ではバックエンドを変更していない。後続の#123では認証応答に`SessionInfo`が加わった（[auth-session.md](auth-session.md)）

### 要件（S-01）との対応表

要件は `docs/requirements/screens.md` の S-01（表の50行目と「S-01」の節、3.1・3.2）。「担当 Issue なし」は、今のIssue一覧に担当が無いもの。

| S-01の要件 | このIssueでの扱い | 後続の担当 |
| --- | --- | --- |
| 枠（ヘッダー・サイドバー・本文・下部メニュー）、ランドマーク、スキップリンク | **作った** | — |
| ログイン後の最初の本文：「ようこそ、{表示名}さん」と短い案内（画面幅で文言が違う） | **作った**（`HomePage`・`WelcomeMessage`） | — |
| ロゴ（ホームへのリンク） | **作った** | — |
| スマホのドロワー | **作った** | — |
| アバターメニュー | **作った**。ヘッダーのアバターと下部メニューの「自分」が同じメニューを開き、パスワード変更とログアウトを行う | プロフィール（S-19）とステータスは #130、アバター画像は #141 |
| 管理メニュー（4つのまとまり・まとまりごとの開閉・権限のある項目だけ・項目0なら見出しごと出さない） | **仕組みだけ作った**（権限は空で、今は誰にも出ない）。まとまりの見出しの定義と、出し分けの関数と、開閉（`<details>`）まで | 項目の追加は、最初の管理画面のIssue（#126・#131・#125のうち最初）。`account`のまとまりには、Issue #199で「アカウント管理」（`perm.account.create`を要求。`/accounts`）を足した。`department`のまとまりには、Issue #196で「部署管理」を足した。ほかのまとまりは、取引先管理を除き項目0件のまま（[accounts.md](accounts.md)） |
| 下部メニュー | **ホームと「自分」だけ** | DM #136、案件 #147、通知 #124 |
| チャンネル（会社・自部署・他部署のセクション） | 作らない | #132・#133・#144・#142・#125 |
| ダイレクトメッセージ・「新しいDM」 | 作らない | #136 |
| 案件のセクション | 作らない | #147 |
| スレッド一覧 | 作らない | #137 |
| 自分専用の整理スペース | 作らない | #144 |
| アーカイブの項目（全体管理者・担当部署のオーナーだけ） | 作らない | #151 または #143（どちらが担当かは未確定） |
| ヘッダーの検索 | 作らない | #155 |
| ヘッダーの通知 | 作らない | #124 |
| ヘッダーのステータスボタン | 作らない | #130 |
| 他部署の拠点ラベルの印 | 作らない | 担当 Issue なし（C-119 の細部が未決定） |
| 再接続の表示 | 作らない | 担当 Issue なし |

- 動かない仮の項目（押しても何も起きないボタン・準備中のリンク）は置かない。足す場所と書き方だけを、この文書の「後続のIssueが足す場所と書き方」に書く
- 要件の食い違いとして、`screens.md` は下部ナビを5項目と書くが、今は2項目（残りは上の表の後続Issueが足す）

## 構成（ファイルと役割）

置き場所は `frontend/src/features/app-shell/`（以下、ファイル名だけ書く）。

| ファイル | 役割 |
| --- | --- |
| `AppShell.tsx` | レイアウトルートの要素。スキップリンク・`Header`・`Sidebar`・`<main id="main-content" tabIndex={-1}>`（`<Outlet />`）・`MobileNav`・`Drawer`を並べ、`AvatarMenuProvider`で包む。ドロワーの開閉は`useState`で持つ。`body`の左右の余白（ログイン前の画面用）を打ち消して画面いっぱいに広げる |
| `Header.tsx` | `<header>`。左にメニューボタン（768px未満だけ）とロゴ、右にアバターのボタン（768px以上だけ） |
| `Sidebar.tsx` | `<nav aria-label="メインメニュー">`。768px以上だけ表示。中身は`SidebarNav` |
| `SidebarNav.tsx` | サイドバーとドロワーが共用するメニューの中身。`primaryNavItems`のリンクと、下部の`AdminMenu` |
| `AdminMenu.tsx` | 管理メニュー。`visibleAdminGroups`の結果が0件なら何も描画しない。まとまりごとの開閉は`<details>`と`<summary>` |
| `MobileNav.tsx` | `<nav aria-label="下部メニュー">`。768px未満だけ表示。今は「ホーム」のリンクと「自分」（アバターメニューを開くボタン） |
| `Drawer.tsx` | スマホのメニュー。ネイティブ`<dialog>`を`showModal()`で開く。中身は`SidebarNav` |
| `AvatarMenu.tsx` | `AvatarMenuProvider`（popover本体と開閉状態）と`AvatarMenuTrigger`（開くボタン。`variant`が`avatar`ならヘッダー用、`self`なら下部メニューの「自分」）。中身は`/password`へのリンクと`LogoutButton` |
| `navigation.ts` | 固定リンクの定義の**唯一の登録場所**。型`NavItem`・`AdminNavItem`・`AdminNavGroup`・`Permission`、`homeNavItem`・`primaryNavItems`・`adminNavGroups`、純粋関数`visibleAdminGroups` |
| `nav-link-classes.ts` | リンクの見た目のクラスの固定の表`NAV_LINK_CLASSES`（現在のページは色だけでなく太字でも示す） |
| `main-content.ts` | `MAIN_CONTENT_ID`（本文のid）・`DESKTOP_QUERY`（768px以上のメディアクエリ）・`focusMainContent`（幅の変更でメニューを閉じたときのフォーカスの移し先） |

関連する既存のファイルの変更：

| ファイル | 変更 |
| --- | --- |
| `frontend/src/App.tsx` | `RequireAuth`の中に`ReauthProvider`と`AppShell`を置いたレイアウトルートを作り、`HomePage`・`PasswordChangePage`・`NotFoundPage`を子にする。`/login`・`/setup`は枠の外 |
| `frontend/src/pages/HomePage.tsx` | `PageLayout`と`RequireAuth`を外した。`h1`「ホーム」と`WelcomeMessage`だけ（`main`は`AppShell`が持つため二重にしない） |
| `frontend/src/features/auth/components/WelcomeMessage.tsx` | `LogoutButton`を外し（アバターメニューへ移動）、案内文を画面幅で出し分けて2つ出す（768px以上は「サイドバーから…」、未満は「メニューから…」。両方がDOMにあり、CSSで出し分ける） |
| `frontend/src/features/auth/components/RequireAuth.tsx` | 確認中・確認できない・初回パスワード変更を`PageLayout`（`narrow`）で包む（下の「認証ガード」） |
| `frontend/src/pages/PasswordChangePage.tsx` | S-04。`safeReturnPath`で安全なアプリ内戻り先を選び、成功・キャンセル後に戻る |
| `frontend/src/components/Button.tsx` | `variant`に`ghost`（枠も背景もない見た目）を追加 |
| `frontend/src/test/setup.ts` | jsdomにないブラウザ機能の最小のスタブ（`matchMedia`・`<dialog>`・popover） |

## 画面の構造

- ランドマーク：`header`（banner）、`nav`（名前「メインメニュー」と「下部メニュー」）、`main`（1つだけ）
- スキップリンク「本文へ移動」：最初のTabで見え（`sr-only`を`focus:not-sr-only`で解除）、Enterで`#main-content`にフォーカスを移す
- 768px以上（パソコン表示）：左にサイドバー、ヘッダー右にアバターのボタン。メニューボタンと下部メニューは出ない
- 768px未満（スマホ表示）：サイドバーは出ず、ヘッダー左に「メニューを開く」ボタン、下に下部メニュー（ホーム・自分）。ヘッダーにアバターは出さず、「自分」から同じアバターメニューを開く
- 表示の切り替えは、メディアクエリではなくTailwindの`md:`のクラスで行う（`hidden md:block`など）。そのため、jsdomでは両方がDOMに描画される（単体テストはロールと名前で絞る）。実際の出し分けはE2Eで確かめる
- 現在のページのリンクは`aria-current="page"`と、太字・背景色で示す

## 後続のIssueが足す場所と書き方

**書き方は、データを取るかどうかで分ける。**

### サイドバーの項目

| 足すもの | 足す場所と書き方 |
| --- | --- |
| データを取らない固定のリンク | `navigation.ts`の`primaryNavItems`に`NavItem`（`id`・`label`・`to`）を1つ足す。`SidebarNav`・ドロワーに同時に出る |
| 管理項目 | `navigation.ts`の`adminNavGroups`の該当するまとまり（`approval`・`account`・`department`・`master-log`）の`items`に`requires`（必要な権限ID）つきで足す。`AdminMenu`が権限で出し分ける |
| データを取るセクション（会社・自部署・他部署のチャンネル、DM、案件） | その機能のフォルダ（`features/<機能>/components/`）に部品を作り、`SidebarNav.tsx`の「ここに差し込む」のコメントの位置に**1行で**差し込む。並び順は、会社 → 自部署 → 他部署 → DM → 案件 |
| スレッド一覧（S-35）・整理スペース（S-33） | 固定のリンクなので、`primaryNavItems`に足す |
| アーカイブ | 管理の外の独立した項目（全体管理者と担当部署のオーナーだけ）。区切りを置いて、管理メニューの上に出す。権限による出し分けは、アーカイブを担当するIssueで決める（細部は未決定） |

- 並び順の全体：データのセクション（会社・自部署・他部署 → DM → 案件）→ スレッド一覧 → 整理スペース → （区切り）→ アーカイブ → 管理
- ルートは`frontend/src/App.tsx`のレイアウトルートの子（`<Route index ... />`の隣）に足す。画面は`frontend/src/pages/`に置く。`/login`・`/setup`のような枠なしの画面は、レイアウトルートの外に置く
- 項目の`id`は安定した文字列にする（`key`に使う）。クラスは`nav-link-classes.ts`の表を使い、新しいクラスを文字列連結で作らない

### ヘッダー右の部品

- `Header.tsx`の右側に、**検索 → 通知 → ステータス → アバター**の順で、1行ずつ足す（今はアバターだけ）
- スマホ幅での扱い：検索・通知はアイコン、ステータスは色つきの丸だけ。アバターはヘッダーに出さず、下部メニューの「自分」から開く（今の作りと同じ）

### アバターメニューの項目

- `AvatarMenu.tsx`の`AvatarMenuProvider`の中の、popoverの中身に足す。順は **プロフィール（S-19）→ ステータス → パスワード変更（S-04）→ ログアウト（最後）**
- 項目が増えても、ヘッダーと「自分」は同じ1つのpopoverを開く。popoverを2つ作らない

### 下部メニュー

- `MobileNav.tsx`に、**ホーム → DM → 案件 → 通知**の順で足す。「自分」は常に最後に固定する

## 管理メニューの仕組みと権限の扱い

- `visibleAdminGroups(groups, permissions)`は、持っている権限の項目だけを残し、項目が0件のまとまりを除く。定義は書き換えない。`AdminMenu`は結果が0件なら「管理」の見出しも描画しない（一般メンバーには「管理」自体を出さない）
- 【この行は#121時点の記述。#192・#199でセッションの`permissions`が実装され、`perm.client.manage`と`perm.account.create`を持つ利用者にだけ該当項目が出る。詳細は[client-management.md](client-management.md)・[accounts.md](accounts.md)】**今は権限が空の`Set`を渡している**（`SidebarNav.tsx`の定数）。管理項目も0件のため、誰にも「管理」は出ない
- **これは表示の制御であり、認可ではない**。操作の可否は、サーバー側が毎回確かめる。サーバー側の認可は、各機能のIssueで行う
- セッションの応答（`GET /api/auth/session`）は`SessionInfo`（`user`・`mustChangePassword`・`reauthenticatedAt`）を返すが、ロール・権限はまだ返さない。次の2つは、**最初の管理項目を足す後続Issue（#126・#131・#125のうち最初に着手するもの）**で行う
  - セッションの応答に権限を追加し、`SidebarNav`が空の`Set`の代わりにそれを渡す
  - まとまりごとの開閉状態の保存（社員ごと）。今の`<details>`は保存せず、閉じた状態で始まる

### C-118（管理メニューのまとまり）の確定と未決定

| 区分 | 内容 |
| --- | --- |
| 確定（実装した） | 4つのまとまり（承認・アカウント・部署・マスタ・記録）／まとまりごとに開閉できる／権限のある項目だけを出す／項目が0個のまとまりは見出しごと出さない／一般メンバーには「管理」自体を出さない |
| 確定（Issue #196で実装した） | 「部署」のまとまりに「部署管理」（`/departments`。`perm.workspace.create`がある人にだけ出す）を足した。メニューの項目はS-24（一覧）の1つで、S-08（作成）は一覧の「部署を作成」から開く（下の未決定「1項目にまとめるか」は、この実装を暫定として残す）。設計は[department-management.md](department-management.md) |
| 確定（後続が実装） | 開閉状態を社員ごとに保存する（サイドバーのセクションの開閉と同じ仕組み）／各まとまりに入る項目（承認はS-11・S-29・S-37、アカウントはS-22・S-23・S-28、部署のS-13、マスタ・記録はS-36・S-25） |
| 未決定（決まるまで推測で作らない） | S-24とS-08を管理メニュー内で1項目にまとめるか／アーカイブの位置の細部／第2段階の画面（S-30・S-31）の置き場／全体管理者が任命された部署の扱い／サイドバーのセクションの折りたたみの細部 |

## 認証ガードの各状態

`RequireAuth`は`AppShell`を包む**外側のガード**で、枠（サイドバー・ヘッダー）の外にいる状態は、自分で`PageLayout`（`narrow`）の`main`と`h1`を持つ。1画面に`main`と`h1`が1つずつになるようにするため。

| 状態 | 表示 |
| --- | --- |
| セッションの確認中 | `h1`「ログイン状態の確認」と「確認中です」。枠なし |
| 確認できない（401以外のエラー） | `h1`「ログイン状態の確認」と、エラーの通知・再試行ボタン。枠なし |
| 未ログイン（401） | `/login`へ置き換えて移る（AC-2） |
| パスワードの変更が必要（`mustChangePassword`） | `h1`「パスワードの変更が必要です」とS-03の`PasswordChangeForm`・ログアウト。枠なし。`/`・`/password`・未知のURLで強制し、変更成功後はホームへ移る |
| ログイン済み | `children`（`AppShell`）を出す |

### パスワード画面のルーティング（Issue #123）

通常の`/password`は共通レイアウト内のS-04として`PasswordChangePage`を表示する。アバターメニューは遷移元のパス・検索文字列・hashをstateに渡し、`safeReturnPath`は安全なアプリ内の戻り先だけを許可する。直接訪問、`/password`自身、外部URLはホームに戻す。キャンセルと成功は履歴を置き換えて戻る。

初回変更が必要な場合は`RequireAuth`が内側のルートを描画せず、枠なしのS-03を表示する。そのため未知のURLも強制変更画面になり、通常利用者の未知URLは`NotFoundPage`になる。`/login`はログイン済みなら`/`へ移り、`/setup`はレイアウトルートの外にあり変更しない。

## アバターメニュー

- ネイティブの`popover="auto"`と、ボタンの`popoverTarget`で作る。外側クリックで閉じる・Escで閉じる・最前面に出る・閉じたときに開いたボタンへフォーカスが戻る、をブラウザ標準に任せる（JavaScriptもライブラリも足さず、CSPを緩めない）。`<details>`は外側クリック・Escに対応しないため採らない
- `role="menu"`と`aria-haspopup`は**使わない**。`role="menu"`にすると矢印キーで項目を移る約束を作る必要があるが、中身はTabで操作するボタンだけのため。付けるのは`aria-expanded`・`aria-controls`・ボタンの名前（ヘッダーは「アカウントメニュー（{表示名}）」、下部メニューは「自分」）
- ヘッダーのアバターと下部メニューの「自分」は、`AvatarMenuProvider`が持つ**同じ1つのpopover**を開く。開閉状態（`aria-expanded`）は、popoverの`toggle`イベントで更新する
- 開いたまま768pxの境界を越えたとき（どちらの向きでも）、起動したボタンが非表示になる。popoverを閉じ（`hidePopover`）、フォーカスがメニューの中・起動ボタン・`body`にあれば`#main-content`に移す。他の有効な要素にフォーカスがあるときは奪わない。「閉じたら必ず起動ボタンへ戻る」とは書かない（ネイティブの復帰動作に任せ、外側クリックで閉じたときはクリックした先を尊重する）

## ドロワー

- ネイティブの`<dialog>`を`showModal()`で開く。フォーカスの閉じ込め・背面の無効化（`inert`）・Escは`<dialog>`に任せる。`Drawer.tsx`が受け持つのは、開閉の状態との同期・backdropクリック・フォーカスの戻し先・幅の変更で閉じること
- 開くと「メニューを閉じる」ボタンにフォーカスを移す
- 閉じる操作：Esc、閉じるボタン、backdropのクリック、項目の選択。backdropのクリックは`event.target`が`dialog`自身のときだけ閉じる（中身をラッパーで覆っているため、内側の余白のクリックでは閉じない）
- フォーカスの戻り先は、閉じた理由で決め、**一度だけ**戻す。通常の終了は開いたボタン（`drawerOpenerRef`）へ。幅の変更による終了は`#main-content`へ（`close`イベント側で、非表示になる開いたボタンへ戻そうとしない）
- Tabの循環：実ブラウザ（Chromium）のモーダル`dialog`は背面を`inert`にするだけで、端の部品でTabを押すとフォーカスがブラウザ側へ抜けるため、`handleKeyDown`で端から反対の端へ回す
- 開いたまま768px以上になると、`matchMedia`の`change`で閉じ、フォーカスを`#main-content`へ移す。767pxに戻しても閉じたまま
- ドロワーの中にログアウトは置かない（アバターメニューの「ログアウト」と重ならないようにするため）

## 実機で見つかった不具合の記録（toggleイベントは非同期で届く）

アバターメニューの開閉は`toggle`イベントの`newState`で追っている（`:popover-open`の疑似クラスだけには頼らない。起動ボタンが非表示になったとき、ブラウザが先にフォーカスを`body`へ外すため、フォーカスの位置では開閉を判定できない）。ただし`toggle`イベントは**非同期**で届く。開いた直後に画面幅が変わると、追跡が遅れて「閉じている」と判定され、メニューが開いたまま残る不具合が、E2Eの実ブラウザで見つかった。

- 対処：幅の変更を受けたとき、`toggle`で追った状態が「閉じている」でも、パネルが`:popover-open`に一致するかを併せて見る（`AvatarMenu.tsx`の幅の変更のハンドラ）。どちらかが開いていれば閉じる
- この不具合はjsdomの単体テストでは再現できない。E2Eの「アバターメニューを開いたまま768pxの境界を越える」「『自分』のメニューを開いたまま…」の2つが保証する

## 本番形（CSP）での動き

- popover・dialog・`<details>`は、すべて外部CSSのクラスと、ブラウザ標準の属性だけで動く。`style`属性も`<style>`要素も使わない（開いた状態でも）。ドロワーの背景（`backdrop:`）、popoverの位置（`inset-auto bottom-16 right-2 md:bottom-auto md:top-12`）もクラスで指定している
- 本番形のE2E（`e2e-prod/csp-style.spec.ts`の「#121 AC-1」の2件）で、パソコン幅（アバターメニューを開いた後）とスマホ幅（ドロワーを開いた後）の`style`要素・`style`属性が0件で、CSP違反がないことを確かめる。本番形ではログインが503になるため、セッションの確認の応答だけをテストの中で差し替える（架空の利用者。DBは使わない）

## テストの場所と、jsdomの制約

jsdomは、メディアクエリを適用せず、`<dialog>`の`showModal`・`close`、popoverの`showPopover`・`hidePopover`・`togglePopover`を実装していない。そのため、役割を分ける。

| 内容 | 場所 |
| --- | --- |
| 属性とイベントへの反応（単体） | `frontend/src/features/app-shell/`の`*.test.tsx`（`AppShell`・`AdminMenu`・`AvatarMenu`・`Drawer`・`MobileNav`）、`navigation.test.ts`、`frontend/src/features/auth/components/RequireAuth.states.test.tsx`、`frontend/src/pages/HomePage.test.tsx` |
| スタブ | 全テスト共通の最小のスタブは`frontend/src/test/setup.ts`。幅の切り替えや開閉の呼び出しを確かめるテスト用の差し込みは`frontend/src/test/app-shell-harness.tsx`（`installDomStubs`・`pressEscapeOn`・`fireToggle`・`renderApp`・`respondShellUser`）。本番のコードにテスト都合の開閉処理は足さない |
| 実ブラウザの動き（E2E） | `e2e/app-shell.spec.ts`。メディアクエリによる出し分け、Tab循環、背面が押せないこと、Esc、backdrop、popoverの外側クリックと最前面、幅の変更 |
| 本番形（CSP） | `e2e-prod/csp-style.spec.ts` |

- 単体テストで確かめるのは、対象のid・属性（`popover`・`popovertarget`・`aria-controls`・`aria-expanded`）、`toggle`イベント（`newState`を持つもの）による状態の反映、`cancel`・`close`イベントへの反応、パネル内に「ログアウト」があること、まで
- 実際のボタン操作による開閉・Tab順・Esc・外側クリック・最前面は、**E2Eで保証する**。スタブを通ったからといって実ブラウザで動くとは限らない
- 単体テストは、クラス名ではなくロールと名前で探す。表示の出し分けで両方のナビが描画されるため、`within(getByRole("navigation", { name }))`で絞る
- 既存テストの変更（利用者の承認済み）：`HomePage.test.tsx`と`e2e/login.spec.ts`のログアウトの手順を、「アバターメニューを開いてから押す」に変えた。確かめる内容は変えていない

## 関係するIssueとADR

- Issue #121（親 #108）、#123（S-03・S-04の認証画面接続）。依存：#120（ログイン）、#171（デザインの土台）
- 後続：S-01の対応表の各Issue
- [ADR-0015](../adr/0015-style-foundation.md)（スタイルの方針。複雑な部品はまずネイティブで足りるかを確かめる）、[ADR-0012](../adr/0012-zero-trust-principle.md)（権限は毎回サーバー側で確認する。表示の制御は認可ではない）
- 設計書：[style-foundation.md](style-foundation.md)、[auth-session.md](auth-session.md)
