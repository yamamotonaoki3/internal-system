# E2E の手順書

起動したアプリを、ブラウザ（Playwright）で操作して確かめる。

## 1. 必要なもの

| もの | 版 | 入れ方 |
| --- | --- | --- |
| Node.js | `.node-version` の版 | PC に直接入れる |
| @playwright/test | `docs/tech-stack.md` の版 | `npm install` |
| Playwright のブラウザ | @playwright/test に合う版 | `npx playwright install --with-deps chromium` |

## 2. 構築の手順

1. `npm install`
1. `npx playwright install --with-deps chromium`
1. `.env.example` を `.env.test` にコピーし、`APP_ENV=test` と検証用の値を入れる（手順は `docs/secrets.md`）。初回セットアップの E2E（`e2e/setup.spec.ts`）のために、`SETUP_TOKEN` と `PII_ENCRYPTION_KEY` も入れる（作り方は `docs/secrets.md` の「初回セットアップ用の項目」。値は利用者が入れる）。ログインの E2E（`e2e/login.spec.ts`）と、ログインと初回セットアップの試行制限のために、`LOGIN_THROTTLE_KEY` も入れる（`docs/secrets.md` の「ログインの試行制限用の項目」。開発と別の値）

## 3. 確認の方法

- `npx playwright --version` が `docs/tech-stack.md` の版と同じ
- ポート 5173 が使われていない。**`localhost` だけでなく `127.0.0.1:5173` も確かめる**（Playwright は `http://localhost:5173` に向けて起動を確認するため、別のプロジェクトのサーバーが `127.0.0.1:5173` を占有していると、起動の確認が失敗する、または別のサーバーに向かう）。Windows では `netstat -ano | findstr :5173`、macOS・Linux では `lsof -i :5173` で確かめる。自分が起動したものでなければ、止めずに利用者に確認する

## 4. テストの実行方法

`npm run test:e2e`

- 検証用の開発サーバー（`npm run dev:test`）を Playwright が起動し、終わると止める。すでに動いているサーバーには向けない（ポートが使われていると失敗する）
- 実行の前（`pretest:e2e`）に、`.env.test` の確認をする。DB があるプロジェクトでは、検証用の DB を初期化し（`npm run db:reset:test`）、E2E 用のシード（`e2e/seeds/`）を入れる。初期化の対象は検証用の DB だけで、開発用の DB には触れない
- `npm run check` には入れない（ブラウザの導入が要り、時間がかかるため）。マージの前などに、`npm run test:e2e` を別に実行する
- 開発中は、新規・変更したspec、変更した画面・APIのspec、スモーク（`e2e/health.spec.ts`・`e2e/login.spec.ts`）を手で選んで実行する。全件（開発用・本番形）は、リリース前の検証（#160）と#189の最終確認の前、および範囲を広げる条件に当たる変更で実行する（[ADR0020](../adr/0020-test-scope-mutation-e2e.md)）

### シナリオの一覧

| シナリオ | ファイル | 確かめること |
| --- | --- | --- |
| 画面を開いてサーバーと通信する | `e2e/health.spec.ts` | 画面にサーバーの状態が表示され、コンソールのエラーがなく、`/api/health` が 200 を返す |
| シードしたデータを読む（DB があるときだけ） | `e2e/sample-users.spec.ts` | シードした `e2euser_health_001` を、API から読める（シードの保存先と、検証用サーバーの読み先が同じ） |

| ログイン・ログアウト（S-02） | `e2e/login.spec.ts` | ログイン→「ようこそ、{表示名}さん」→ログアウト→戻る・進む・直接アクセスで `/login`、誤ったパスワードの文言、初回パスワードの利用者の案内と `403 PASSWORD_CHANGE_REQUIRED`、**`http://localhost` で `__Host-session` の Cookie が保存され（`HttpOnly`・`Secure`・`SameSite=Lax`・`Path=/`）、次の要求で送られる**。シードは `e2e/seeds/login.sql`（架空の `e2euser_login_001`・`e2euser_login_002`）。後始末は `e2e/seeds/login-cleanup.sql`。ログアウトは、共通レイアウトのアバターメニューを開いてから押す（#121） |
| アカウントの個別発行（S-22・S-23。Issue #199） | `e2e/accounts.spec.ts` | 全体管理者が、メニュー（アカウント→アカウント管理）から一覧と登録画面へ進み、1人を発行する。応答が201で`Cache-Control: no-store`を含み、初期パスワードが画面に一度だけ出て、`localStorage`・`sessionStorage`に残らない。「一覧へ戻る」で「登録しました」が出て、初期パスワードが消え、一覧に発行した行（メール・所属部署）が出る。発行したアカウントでログインすると、パスワードの変更を求められ（`mustChangePassword`）、変更するとホームへ進む。一般社員には管理メニューが出ず、`/accounts`は見つからない画面になり、`/api/admin/accounts`は403。シードは`e2e/seeds/accounts.sql`（架空の部署1件と、全体管理者`e2euser_account_admin`・一般社員`e2euser_account_member`。パスワードのハッシュは`e2euser_login_001`のものをDB内で参照するため、`pretest:e2e`が`login.sql`を先に流す前提）。後始末は`e2e/seeds/accounts-cleanup.sql`で、specの`beforeAll`と`afterAll`が流す（`e2euser_account_`で始まる利用者と`[E2E_TEST]アカウント発行部`だけを消す）。**全体管理者は一意制約で1人だけなので、他のspec（`clients.sql`など）の全体管理者のシードと同時には存在させない**（`workers: 1`で、各specが自分のシードを入れて消す） |
| 共通レイアウト（S-01） | `e2e/app-shell.spec.ts` | 下の「共通レイアウトのシナリオ」を参照 |
| チャンネルを探す・参加（S-09。Issue #200） | `e2e/channels.spec.ts` | 下の「チャンネルのシナリオ」を参照 |
| チャンネルのメッセージ（S-05。Issue #201） | `e2e/messages.spec.ts` | 下の「メッセージのシナリオ」を参照 |
| チャンネルの退職者の併記（S-05。Issue #238） | `e2e/messages-retired.spec.ts` | 下の「退職者の併記のシナリオ」を参照 |
| メッセージの編集・削除（S-05・S-06。Issue #134） | `e2e/messages-edit-delete.spec.ts` | 下の「編集・削除のシナリオ」を参照 |
| メッセージのマークダウンの表示（S-05。Issue #134） | `e2e/messages-markdown.spec.ts` | 下の「マークダウンの表示のシナリオ」を参照 |
| ダイレクトメッセージ（S-06・S-20・S-27・S-05・サイドバー。Issue #136） | `e2e/dms.spec.ts` | 下の「ダイレクトメッセージのシナリオ」を参照 |
| 部署の管理（S-24・S-08。Issue #196） | `e2e/departments.spec.ts` | 下の「部署の管理のシナリオ」を参照 |
| プロフィール・社員一覧・ステータス（S-19・S-20・S-27・ヘッダー。Issue #130） | `e2e/profile.spec.ts` | 5件を直列（`serial`）で実行する。S-19で表示名を変えると、再読み込みせずにヘッダーのアバターと社員一覧が変わる／ヘッダーで「外出」と戻り予定を選ぶと、再読み込みせずに社員一覧とカードが変わり、別の利用者の一覧にも反映される／一覧の表示名を押すとカードに本名が出て、Esc で閉じるとフォーカスが表示名に戻る／ヘッダーのステータスとアバターメニューは同時に1つだけ開く／スマホ幅（375px）でもヘッダーにステータスの丸が出て、文字は隠れて読み上げの名前に残る。シードは`e2e/seeds/profile.sql`（架空の部署と、`e2euser_profile_`で始まる全体管理者・一般社員。本名は平文の`INSERT`で書き、`seed-file`が暗号化する）。後始末は`e2e/seeds/profile-cleanup.sql`（`e2euser_profile_`と`[E2E_TEST]部署130`の識別子だけ）。**全体管理者は一意制約で1人だけなので、他のspecの全体管理者のシードと同時には存在させない**（各specが自分のシードを入れて消す） |
| チャンネルの作成申請と承認（S-10・S-11・ヘッダーの通知。Issue #131） | `e2e/channel-requests.spec.ts` | 1件（`serial`）。メンバー・オーナー・全体管理者の3つのブラウザ（**ログインは3人で1回ずつ、計3回**。ログインの試行制限に当たらないよう）。メンバーがS-09の「チャンネルを申請」からS-10を開き、非公開をすすめる案内を確かめ、部署（非公開）と会社直属（公開）を申請する（承認待ちの間はチャンネルの一覧に出ない。承認のメニューは出ず、審査一覧のAPIは403）→ オーナーのベルに1件、S-11で再認証して部署の申請を承認する（会社直属の申請は出ない）→ 全体管理者のベルに1件、再認証して理由つきで会社直属の申請を却下する（空の理由では確定できない）→ メンバーのベルに2件（承認・却下）、S-10に承認済みと却下・理由が出て、承認したチャンネルに参加済み → メンバーが3件目を申請してS-10で取り下げると、S-11の承認待ちから消え、通知は増えない。シードは`e2e/seeds/channel-requests.sql`（架空の部署と、`e2euser_chreq_`で始める全体管理者・オーナー・一般社員。パスワードのハッシュは`e2euser_login_001`から参照するため`login.sql`が前提）。チャンネル名は`[ ]`が使えないため`E2E_TEST_chreq_`で始め、説明に`[E2E_TEST]`を付ける。後始末は`e2e/seeds/channel-requests-cleanup.sql`（社員ID`e2euser_chreq_`・部署名`[E2E_TEST]部署131`・チャンネル名`E2E_TEST_chreq_`の識別子だけ。残数0を確かめる）。spec自身が`beforeAll`で後始末とシードを流し、`afterAll`で後始末する。**全体管理者は一意制約で1人だけ**のため、同じく全体管理者を入れる他のspecのシードと同時に存在できない（後始末を必ず流す） |
| 通知の土台（S-14・ヘッダーの通知・下部メニュー。Issue #124） | `e2e/notifications.spec.ts` | 2件を直列（`serial`）で実行する。`e2euser_notif_01`でログインし、ヘッダーの未読の件数（既読と他人宛ては数えない）→押すとS-14へ移る→本人の通知の4件だけが出て（API の応答にも他人宛ては出ない）→1件を既読にすると再読み込みなしで件数が減る→「すべて既読にする」で件数の印が消える→スマホ幅（375px）の下部メニューの「ホーム」「通知」から S-14 を開ける／`e2euser_notif_02`でログインすると自分宛ての1件だけが出て、他人宛ての通知のIDの既読は404になる。**ログインは2回だけ**（01と02で1回ずつ。ログインの試行制限に当たらないよう）。通知の種類は0件のため、シードは対応表に無い種類の文字列（`e2e_sample`）で作り、画面は汎用の「通知」表示になる。シードは`e2e/seeds/notifications.sql`（架空の部署と、`e2euser_notif_`で始める一般社員2人・通知5件。パスワードのハッシュは既存のログインのシードの利用者から参照するため、`login.sql`が前提）。後始末は`e2e/seeds/notifications-cleanup.sql`（`e2euser_notif_`と`[E2E_TEST]部署124`の識別子だけ。残数0を確かめる文つき）。spec自身が`beforeAll`で後始末とシードを流し、`afterAll`で後始末する |
| チャンネル・DMの未読の件数と既読（サイドバー・DM一覧。Issue #237） | `e2e/unread.spec.ts` | 下の「未読の件数と既読のシナリオ」を参照 |

- `/api/sample-users` はログインが必要になったため、`e2e/sample-users.spec.ts` はログインしてから読む（未ログインは 401）
- 未ログインのときのセッションの確認（`GET /api/auth/session`）は、仕様どおり 401 を返し、ブラウザがコンソールのエラーとして出す。`e2e/session-console.ts` の `allowSessionCheck401` で、この 401 だけを許す（許可は1か所にまとめる）
- シナリオは、`e2e/` に `<名前>.spec.ts` として足す。`e2e/console-guard.ts` の `test` を使い、コンソールのエラーを失敗にする
- シナリオ用のシードは、`e2e/seeds/<名前>.sql` に足す。架空のデータだけを使い、ユーザー名は `e2euser_` で始める。何回流しても同じ結果になるようにする（`ON CONFLICT DO NOTHING`）。流すには、`pretest:e2e` に `node scripts/db-local.ts test seed-file e2e/seeds/<名前>.sql` を足す（`e2e/seeds/` の下の SQL だけを指定できる）。test 環境の `seed-file` は、シードの適用後に、`login_id` が `e2euser_` で始まり、本名（`legal_name`）が暗号化済みの形式（`v1:`）でない行を、その利用者のIDを追加認証データにして暗号化する（`backend/src/lib/pii-crypto.ts`。件数だけを表示し、値は出さない）。アプリは暗号化した本名しか読めないため、SQLのシードには本名を平文で書いてよい。development・本番には影響しない

### 部署の管理のシナリオ（開発サーバー。Issue #196）

`e2e/departments.spec.ts`。設計は [department-management.md](../design/department-management.md)。2件を直列（`serial`）で実行する。

- 全体管理者で、メニューの「部署」→「部署管理」→ 一覧 → 「部署を作成」→ 作成（再認証のダイアログを挟む）→ 一覧に戻る（作成者がオーナー）→ 名前の変更（再認証の有効期間内のため、ダイアログは出ない）→ オーナーの変更（別部署の現オーナーを選び、元部署の後任を選ぶ）の流れを確かめる。削除・無効化の操作が出ないことも確かめる
- 一般社員には、メニューに部署管理が出ず、`/departments`・`/departments/new`を直接開いても「ページが見つかりません」になる
- シード：`e2e/seeds/departments.sql`（架空の全体管理者`e2euser_dept_admin`、既存の部署「[E2E_TEST]部署196営業」とそのオーナー`e2euser_dept_owner`、一般社員`e2euser_dept_member`、専用チャンネル2つと参加）。後始末：`e2e/seeds/departments-cleanup.sql`（社員ID`e2euser_dept_`と部署名`[E2E_TEST]部署196`の識別子だけ。画面から作った部署とそのチャンネルを含み、残数を表示する）。spec自身が`beforeAll`で流し、`afterAll`で後始末する
- **全体管理者は一意制約で1人だけ**（`user_role_assignments_global_admin_unique`）。このシードは全体管理者を入れるため、同じく全体管理者を入れる他のspecのシード（`e2e/seeds/clients.sql`）と同時に存在できない。後始末を必ず流し、他のspecのシードが残っていないことを前提にする。残っていると、シードの挿入が一意制約の違反で失敗する
- 部署の管理のAPIには試行制限（`429`）がないため、ログイン回数の制限以外には配慮しなくてよい

### チャンネルのシナリオ（開発サーバー。Issue #200）

`e2e/channels.spec.ts`。設計は [channels.md](../design/channels.md)。

- 全体管理者が、画面（`/accounts/new`）から架空の社員（`e2euser_chan_new01`）を発行する。応答が201で初期パスワードを受け取る → 発行した社員で別のブラウザコンテキストからログインし、初回のパスワード変更を済ませる → サイドバーに「全社連絡」と自部署の専用チャンネル2つが出て、他部署（開発）のチャンネルは出ない → 「チャンネルを探す」（S-09）を開き、他部署のお知らせ専用チャンネルの「参加する」を押す → 参加済みになり、サイドバーに出る、までを確かめる
- シード：`e2e/seeds/channels.sql`（架空の全体管理者`e2euser_chan_admin`、部署「[E2E_TEST]部署200営業」「[E2E_TEST]部署200開発」と、それぞれの専用チャンネル2つ）。後始末：`e2e/seeds/channels-cleanup.sql`（社員ID`e2euser_chan_`と部署名`[E2E_TEST]部署200`の識別子だけ。画面から発行した社員とその参加・セッション・監査を含む。**全社連絡（migrationが作る初期データ）は消さない**。残数を表示し、spec自身が`afterAll`で0であることを確かめる）。spec自身が`beforeAll`で流す
- 全体管理者は一意制約で1人だけのため、同じく全体管理者を入れる他のspecのシード（`departments.sql`・`clients.sql`・`accounts.sql`など）と同時に存在できない。後始末を必ず流す（部署の管理のシナリオと同じ）
- ログインの試行制限に当たらないよう、各利用者のログインは1回だけにする
- 既存の後始末SQL（`e2e/seeds/accounts-cleanup.sql`・`login-cleanup.sql`）に、`channel_members`の削除を足した。発行・セットアップされた社員が全社連絡に参加するため、参加の行を先に消さないと外部キーで社員を消せない
- 本番形（CSP）のスモーク（`e2e-prod/csp-style.spec.ts`）は、サイドバーが`GET /api/channels`を呼ぶようになったため、この一覧を空の応答でモックする

### メッセージのシナリオ（開発サーバー。Issue #201）

`e2e/messages.spec.ts`。設計は [messages.md](../design/messages.md)。1件。

- 利用者A・Bが、**別々のブラウザコンテキスト**で同じチャンネル（S-05）を開く。Aが「送信」ボタンで投稿すると、Aの画面にもBの画面にも、**再読み込みなし**（`page.reload`を呼ばない）で表示される。入力欄は投稿後に空になる
- Bが、Enterだけでは送られず改行になること（入力欄の値が改行を含む）と、Ctrl+Enterで送られることを確かめ、Aの画面にも出る。2つの投稿が、投稿の順（古い→新しい）に並ぶ
- 新着の表示は2秒ポーリングで、`expect`の既定の待ちで足りる。待ち時間は延ばさない
- シード：`e2e/seeds/messages.sql`（架空の利用者`e2euser_msg_a`・`e2euser_msg_b`〔`@example.com`〕、部署「[E2E_TEST]部署201…」とそのチャンネル、固定のルームID）。後始末：`e2e/seeds/messages-cleanup.sql`（社員ID`e2euser_msg_`と部署名`[E2E_TEST]部署201`の識別子だけ。メッセージ・参加・セッション・監査を含む。**全社連絡は消さない**）。spec自身が`beforeAll`で後始末とシードを流し、`afterAll`で後始末して、残数がすべて0であることを確かめる
- このシードは全体管理者を入れない（全体管理者の一意制約に当たらない）
- ログインの試行制限に当たらないよう、各利用者のログインは1回だけにする
- 開発中は、このspecに加えて、画面が変わる`e2e/channels.spec.ts`とスモーク（`health.spec.ts`・`login.spec.ts`）を選んで実行する（ADR-0020）。共通部品`TextAreaField`を足したため、必要に応じて`style-foundation.spec.ts`も対象にする

### 退職者の併記のシナリオ（開発サーバー。Issue #238）

`e2e/messages-retired.spec.ts`。設計は [messages.md](../design/messages.md)。1件。

- 利用者が S-05 を開くと、無効な投稿者の行に、投稿時点の表示名と「（退職者）」が出て、今の表示名（`users.display_name`）は画面のどこにも出ない。その行には、ボタン・リンク・「DMを送る」がない。有効な投稿者の行には「退職者」が出ない
- シード：`e2e/seeds/messages-retired.sql`（部署「[E2E_TEST]部署238」とその公開チャンネル、社員`e2euser_ret238_a`〔閲覧者〕・`_b`〔有効な投稿者〕・`_retired`〔無効な投稿者。投稿時点と今の表示名は別の名前〕。`@example.com`。本文は`[E2E_TEST]`で始める）。後始末：`e2e/seeds/messages-retired-cleanup.sql`（社員ID`e2euser_ret238_`と部署名`[E2E_TEST]部署238`の識別子だけ）。spec自身が`beforeAll`で後始末とシードを流し、`afterAll`で後始末して、残数が0であることを確かめる
- このシードは全体管理者を入れない（全体管理者の一意制約に当たらない）。ログインは1回だけにする（ログインの試行制限）
- 開いている間に投稿者が無効になった場合の追従は、既知の制限（再読み込みで反映。[messages.md](../design/messages.md)の「未実施・未決定」）で、このspecでは確かめない

### 編集・削除のシナリオ（開発サーバー。Issue #134）

`e2e/messages-edit-delete.spec.ts`。設計は [message-edit-markdown.md](../design/message-edit-markdown.md)。4件。

- A がチャンネルで自分の投稿を編集すると、再読み込みなしで新しい本文と「（編集済み）」が出る。削除は確認のダイアログ → 再認証を経て、再読み込みなしで「このメッセージは削除されました」が出る
- B の投稿には「編集」「削除」がなく、API を直接呼んでも403で、内容は変わらない
- DM（S-06）でも同じ
- B がチャンネルを開いた後に A が編集・削除し、B が画面の中の移動で部屋を開き直すと、最新の一覧から取り直して反映される（U-8）。開いたままの画面への即時の反映は#117で、このspecでは確かめない
- シード：`e2e/seeds/messages-edit.sql`（部署「[E2E_TEST]部署134」、社員`e2euser_edit134_a`・`_b`・`_c`〔`@example.com`〕、公開チャンネル2つ、A と B の DM 1つ。本文は`[E2E_TEST]`で始める）。後始末：`e2e/seeds/messages-edit-cleanup.sql`（識別子だけを条件に削除し、残数0を確かめる）
- ログインの試行制限に当たらないよう、ログインは A・B の2人で1回ずつにし、ブラウザはテストの間で使い回す（順に実行する）

### マークダウンの表示のシナリオ（開発サーバー。Issue #134）

`e2e/messages-markdown.spec.ts`。1件。

- C がチャンネルを開くと、記法（太字・斜体・取り消し線・箇条書き・番号・引用・コード・リンク）が整形され、整形しない記法（見出し・表・画像・タスクリスト・区切り線・`~1つ~`）は書いたままの文字で出る。HTML・スクリプト・`javascript:`のリンクは実行されず（`dialog`が起きない）、文字で出る。リンクは別のタブで開き、`rel`に`noopener`・`noreferrer`が付く。画面から投稿したHTMLも、再読み込みなしで文字で出る
- シードと後始末は上の編集・削除のシナリオと同じ（チャンネルC02と`e2euser_edit134_c`を使う）。外部のサイトは開かない（リンクを押さない）

### ダイレクトメッセージのシナリオ（開発サーバー。Issue #136）

`e2e/dms.spec.ts`。設計は [dms.md](../design/dms.md)。5件を直列（`serial`）で実行する。

- 利用者A・B・C（第三者）の3つのブラウザ（**ログインは3人で1回ずつ、計3回**。ログインの試行制限に当たらないよう、Aのブラウザはテストの間で使い回す）
- Aがサイドバーの「新しいDM」から、表示名で検索して（部署・ステータスが文字で出る）Bを選び、送る → Bが後からログインして読め、開いたまま2秒ごとの取得で再読み込みなしに新着が出る → 第三者Cは、URLで直接開いても見つからず、APIでも一覧・詳細・メッセージ・投稿のどれも他人のDMに届かない（404）→ S-20の行・S-27のカード・S-05の参加者の「DMを送る」から同じDMに入れる（自分には出ない）→ 無効な相手とのDMは、サイドバー・上部・過去の投稿に「退職者」と出て、入力欄がなく送れない
- 操作した本人の画面は、再読み込みなしで、サイドバーのDMの欄・一覧が変わることを確かめる
- シード：`e2e/seeds/dms.sql`（部署「[E2E_TEST]部署136」とその専用チャンネル、社員`e2euser_dm_a`・`_b`・`_c`・`_retired`〔`@example.com`。`_b`は外出中で戻り予定を過ぎている、`_retired`は無効〕、無効な社員との`kind='direct'`のDMと投稿1件）。AとBのDMは、specの中で画面から作る。DMは、このシードの利用者どうしだけで作る（既存の利用者を当事者にしない）
- 後始末：`e2e/seeds/dms-cleanup.sql`（社員ID`e2euser_dm_`と部署名`[E2E_TEST]部署136`の識別子だけ。その利用者が当事者の会話・当事者・メッセージ・部屋・セッション・監査を、外部キーの順に消し、会話・当事者・メッセージ・部屋・利用者の残数を返す）。specは`beforeAll`で後始末とシードを流し、`afterAll`で後始末を流して残数がすべて0であることを確かめる。`backend/db/seeds/cleanup.sql`（`npm run db:cleanup:test`）も、テストの利用者が当事者の会話を同じ順で消し、`remaining_conversations`・`remaining_direct_rooms`を返す
- このシードは全体管理者を入れない（全体管理者の一意制約に当たらない）
- **全件を1回で流さず、spec ごとに実行する**（ログインの試行制限に当たるため。#225）：`npm run test:e2e -- e2e/dms.spec.ts`。本番形も同じ（`npm run test:e2e:prod -- e2e/<spec>`）。**E2E の実行中に、テストのファイル（spec・シード）を変えない**（実行中に差し替わると、結果が乱れて失敗の原因を読み違える）
- 開発中は、このspecに加えて、画面が変わる`e2e/messages.spec.ts`・`e2e/channels.spec.ts`・`e2e/profile.spec.ts`・`e2e/app-shell.spec.ts`（下部メニューの順が変わった）とスモーク（`health.spec.ts`・`login.spec.ts`）を選んで実行する（ADR-0020）
- 本番形（CSP）のスモーク（`e2e-prod/csp-style.spec.ts`）は、サイドバーが`GET /api/dms`を呼ぶようになったため、この一覧を空の応答（`items`が空で`nextCursor`が`null`）でモックする（`/api/channels`のモックと同じ扱い。DMの詳細`/api/dms/:roomId`にはモックを当てない）

### 未読の件数と既読のシナリオ（開発サーバー。Issue #237）

`e2e/unread.spec.ts`。設計は [unread.md](../design/unread.md)。5件を直列（`serial`）で実行する。

- 利用者A・Bの2つのブラウザ（**ログインはAとBで1回ずつ、計2回**。ログインの試行制限（#225）に当たらないよう、ブラウザはテストの間で使い回す）。再読み込みなしで表示が変わることを確かめる
- Aでログイン → サイドバーの参加中のチャンネル（Aが参加した後のBの投稿101件）に「99+」と、リンクの名前「… 未読 99件以上」が出る。Aが参加する前の投稿は数えない。DM（Bの投稿2件とAの投稿1件）には「2」（自分の投稿は数えない）。未参加の公開チャンネル（投稿あり）は`GET /api/me/unread`に出ない
- DMを開くと、再読み込みなしでサイドバーのDMの件数が消える → Aがホームにいる間にBがDMに投稿すると、Aのサイドバーに再読み込みなしで「1」が出る → Aがチャンネルを開くと件数が消え、再読み込みしても戻らない（既読がサーバーに残る）→ 未参加の公開チャンネルを開いても、読めるが既読の要求（`PUT /api/rooms/:roomId/read-position`）は出ず、コンソールのエラーもない
- シード：`e2e/seeds/unread.sql`（部署「[E2E_TEST]部署237」、社員`e2euser_unread_a`・`_b`〔`@example.com`。パスワードのハッシュは既存の行から参照し、値を書かない〕、参加中・未参加・参加の前の投稿のあるチャンネル、AとBのDM。参加の時刻と投稿のIDの時刻は固定値で、「参加の後」「参加の前」を決める）
- 後始末：`e2e/seeds/unread-cleanup.sql`（社員ID`e2euser_unread_`と部署名`[E2E_TEST]部署237`の識別子だけ。`read_positions`を先頭に、外部キーの順に消す）。`beforeAll`・`afterAll`で流し、残数が0になることを確かめる
- 部屋を開くと`read_positions`の行ができ、外部キーで利用者・部屋を消せなくなるため、利用者・部屋を消す既存の`e2e/seeds/*-cleanup.sql`（`accounts`・`channel-requests`・`channels`・`clients`・`departments`・`dms`・`login`・`messages`・`notifications`・`password-change`・`profile`）の先頭にも、`read_positions`の削除を足した
- サイドバーの部屋のリンクを名前で探す既存のE2E（`e2e/channels.spec.ts`・`e2e/dms.spec.ts`）は、未読があるとリンクの名前に「未読 n件」が付くため、`e2e/room-link.ts`の`roomLinkName`で探す（名前の完全一致を保ち、未読の読み上げ名だけを許す）
- 本番形（CSP）のスモーク（`e2e-prod/csp-style.spec.ts`）は、サイドバーが`GET /api/me/unread`を呼ぶようになったため、この一覧を空の応答（`items`が空で`nextCursor`がnull）でモックする
- 全件を1回で流さず、spec ごとに実行する：`npm run test:e2e -- e2e/unread.spec.ts`。本番形も同じ

### メッセージ入力欄の下書きのシナリオ（開発サーバー。Issue #239）

`e2e/message-drafts.spec.ts`。設計は [drafts.md](../design/drafts.md)。13件を直列（後から「離脱の確認の表示中に401」「ブラウザの戻る（POP）」を追加）（`serial`）で実行する。

- 利用者A・Bの2つのログイン（**ログインはAとBで1回ずつ、計2回**。ログインの試行制限（#225）に当たらないよう、利用者の切り替えは Cookie の差し替えで行う）。同じブラウザのコンテキスト（同じ `localStorage`）を使い回す
- 確かめること：①入力 → 再読み込みで復元し、サーバーへ送る要求に本文が含まれない ②Cookie を消して自動ログアウト → 同じ社員の Cookie に戻すと復元（下書きが残る） ③Bに替えると同じチャンネルの入力欄は空で、Aに戻すと復元 ④アプリを開いたとき、開かない部屋・他の社員の分も含めて8日前の下書きだけが消え、期限内は残って復元（`page.evaluate` で置いてから `reload`） ⑤サイドバーのリンクで移ろうとすると確認ダイアログ。「編集を続ける」で留まり、「破棄して離れる」で下書きを消して移る ⑥スマホ幅のドロワーのリンクから移ろうとすると、ドロワーが閉じて確認ダイアログだけが出て、フォーカスが「編集を続ける」に移る ⑦2つのタブで同じ下書きを編集すると、後に書いた方が保存され先のタブは変わらない。変更があるタブを閉じるとブラウザの確認（`beforeunload`）が出る ⑧離脱の確認の表示中に Cookie が消えて 401 になっても `/login` へ移り、確認は残らず、未処理の例外もなく、下書きは残る ⑨ブラウザの戻る（POP）で確認を出し、「編集を続ける」で留まり、「破棄して離れる」で前の画面へ移って下書きが消える ⑩〜⑫変更があるままログアウト →「破棄して離れる」→ API を 500 にする（`page.route`）と、失敗の案内が表示域に入り（スマホ幅で下までスクロールした場合、デスクトップ幅、失敗の前に入力欄へフォーカスを置いた場合）、下書きと本文が残る ⑬最後に、ログアウトの成功で `/login` へ移り、`localStorage` に下書きのキーが0件
- 前提の確認：失敗の案内の位置を見るため、ウィンドウを `window.scrollTo` でスクロールし、`window.scrollY > 0` と、失敗の前は案内の位置が `not.toBeInViewport()` であることを確かめる（ビューポートは 375×667）。`MessageList` の内側のスクロールではない
- Cookie の差し替え：`__Host-session` の Cookie は `Domain` 属性なし・`Path=/`・`Secure` が必要なため、`addCookies` には `url: http://…` ではなく `domain`・`path`・`secure: true` で渡す（`url` 指定だと `Invalid cookie fields` で拒否される）
- シード：`e2e/seeds/message-drafts.sql`（部署「[E2E_TEST]部署239」、社員`e2euser_draft_a`・`_b`〔`@example.com`。パスワードのハッシュは既存の行から参照し、値を書かない〕、公開チャンネル2つ。一方に、ページが縦にスクロールする高さにするための投稿20件）。本文は `[E2E_TEST]` で始める
- 後始末：`e2e/seeds/message-drafts-cleanup.sql`（社員ID`e2euser_draft_`と部署名`[E2E_TEST]部署239`の識別子だけ。`read_positions`を先頭に、外部キーの順に消す）。残数が0になることを確かめる。端末の下書きは `localStorage` にあり、ブラウザのコンテキストを閉じると消える（DB には残らない）
- 全件を1回で流さず、spec ごとに実行する：`npm run test:e2e -- e2e/message-drafts.spec.ts`
- 既存の spec は、文字を入力したまま別の画面へ移るものがないため、離脱の確認や `beforeunload` で止まらず、変更していない

### 共通レイアウトのシナリオ（開発サーバー。Issue #121）

`e2e/app-shell.spec.ts`。jsdom（単体テスト）では確かめられない、実ブラウザ（Chromium）の動きを受け持つ。設計は [app-shell.md](../design/app-shell.md)。

- 画面幅は`page.setViewportSize`で指定する：1280px（パソコン）、768px（パソコン表示の境界）、767px、360px（スマホ）
- 確かめること
  - 1280px・768px：サイドバー・ヘッダー・アバターが出て、メニューボタンと下部メニューは出ない。360px：サイドバーが出ず、下部メニューとメニューボタンが出る。360・767・768・1280pxで横スクロールがない（ドロワー・アバターメニューを開いても）
  - 案内文が画面幅で出し分けられる（見えるのは片方だけ）
  - アバターメニュー（パソコン幅のアバター、スマホ幅の「自分」）：Enterで開く → Tabでログアウトへ → Escで閉じて、開いたボタンにフォーカスが戻る／外側クリックで閉じる／ヘッダー・サイドバー・本文より手前に出る（最前面）／開いたまま768pxの境界を越えると閉じ、フォーカスは`#main-content`に移る（768→767と767→768）
  - ドロワー：開くと閉じるボタンにフォーカスが移る／Tab・Shift+Tabが`dialog`の中を循環する／背面の要素は押せない・Tabで到達できない／Escと閉じるボタンで閉じて、メニューボタンに戻る／backdropのクリックで閉じ、内側の余白のクリックでは閉じない／項目の選択で閉じる／767pxで開いたまま768pxにすると閉じてフォーカスが`#main-content`に移り、767pxに戻しても閉じたまま
  - キーボード：最初のTabでスキップリンクが見え、Enterで本文にフォーカスが移る／Tabで進む操作部品の輪郭がすべて見える
  - 未ログインで`/`を開くと`/login`へ移り、ヘッダー・メニューは出ない／パスワード変更待ちの利用者には枠が出ず、見出し・ログアウトが直接出る／アバターメニュー（「自分」）からログアウトすると`/login`へ移る
- **ログイン回数の制限に配慮する**：ログインは接続元ごとに15分に30回までの制限がある。ログイン後の画面を見るテストは、ワーカーごとに1回だけログインし、その Cookie（`storageState`）を使い回す。ログアウトまで確かめるテストは、使い回す Cookie のセッションを失効させないよう、別にログインする
- シードは`e2e/seeds/login.sql`（架空の`e2euser_login_001`「テスト一郎」・`002`）を共用する
- ドロワーの表示中は背面が`inert`になりロールでの検索から外れるため、背面の要素は`includeHidden`で探す
- popover・dialogの**実ブラウザでの確認の範囲**はここまで。本番形（CSP）で`style`属性・`<style>`が0件であることは`e2e-prod/csp-style.spec.ts`で確かめる

### 表示・アクセシビリティのシナリオ（開発サーバー。Issue #171）

- `e2e/style-foundation.spec.ts`：ログイン・初回セットアップの画面で、Tabの順、フォーカスの輪郭が見えること、エラー時のフォーカスの移動、画面幅 360・767・768・1280px での横スクロールの有無・主操作の高さ・パネルの幅、360pxで文字が切れないことを確かめる。`npm run test:e2e` に含まれる
- 開発サーバーは CSS を `<style>` で注入し、CSP（`public/_headers`）もかからないため、**CSP のもとで外部 CSS だけが使われること**はここでは確かめられない。次の本番形で確かめる

### 本番形の E2E（Issue #171）

`npm run test:e2e:prod`

- `playwright.prod.config.ts` を使う。Playwright が `npm run build` の後に `npm run preview:test`（`vite preview`。ビルド済みの成果物を、`public/_headers` の CSP をかけて配信する）を起動し、終わると止める。すでに動いているサーバーには向けない
- 実行の前（`pretest:e2e:prod`）に、`npm run test:e2e` と同じく `.env.test` の確認、検証用 DB の初期化、E2E 用のシードの投入を行う
- シナリオ（`e2e-prod/csp-style.spec.ts`）：画面の応答に `style-src 'self'` を含み `'unsafe-inline'` を含まない CSP があること、CSS が同一オリジンの `/assets/*.css`（200・`text/css`）として読み込まれること、画面を開いた後・ログインに失敗した後・初回セットアップの各状態で `<style>` 要素と `style` 属性が 0 件であること、CSP 違反がないこと、主ボタンの背景色がトークンの `primary` と同じであること
- #121 で、ログイン後の画面（パソコン幅のアバターメニューを開いた後、スマホ幅のドロワーを開いた後）も同じく `style` 要素・`style` 属性が 0 件で CSP 違反がないことを確かめるシナリオを足した。本番形ではログインが 503 になるため、セッションの確認の応答だけをテストの中で差し替える（架空の利用者。DB は使わない）
- #134 で、`e2e-prod/markdown-csp.spec.ts`を足した。本番の CSP の下で、メッセージの本文のマークダウンの表示と、動的に読み込む塊（`MarkdownBody-*.js`）が CSP 違反を起こさず、`style` 要素・`style` 属性が出ないこと、箇条書きの印・番号が外部の CSS で戻っている（`list-style-type`が`none`でない）ことを確かめる。本番形ではログインが503になるため、このテストの中だけで API の応答を差し替える（架空の利用者・本文。DB は使わない）
- **開発サーバー用の `npm run test:e2e` と同時に実行しない**。配信のポートは、許可するオリジン（`.env.test` の `ALLOWED_ORIGINS`）に合わせて 5173 で、開発サーバー用と同じため、順に実行する
- `npm run check` には入れない（ブラウザとビルドが要り、時間がかかるため）。マージの前などに、別に実行する

## 5. 後始末

- テストが終わったら、Playwright が起動した開発サーバーとブラウザが止まり、ポート 5173 が解放されたことを確かめる（`npm run test:e2e:prod` の場合は、起動した `vite preview` のサーバー）
- 動作確認などで手動で `npm run dev`・`npm run dev:test` を起動した場合は、`npm run dev:stop` で止める。この作業ツリーの開発サーバー（`.dev-server.pid` に記録した PID のプロセスツリー）だけを止め、5173・8787 に待ち受けがないことを表示する（ほかの作業ツリー・プロジェクトのプロセスは止めない）
- テストが作ったデータ（`e2euser_` で始まるもの。単体のテストの `testuser_` も）を消す。DB があるプロジェクトでは、`npm run db:cleanup:test` で、識別子のデータだけを消し、残りが 0 件になったことを確かめる

## 6. よくある失敗と対処

| 失敗 | 確かめ方・対処 |
| --- | --- |
| ブラウザがないと言われる | `npx playwright install --with-deps chromium` を実行する |
| ポートが使われていて起動しない | 何が使っているかを確かめる。自分が起動したものでなければ、止めずに利用者に確認する |
| `.env.test` がないと言われる | `docs/secrets.md` の手順で作る |
| 初回セットアップの E2E が「SETUP_TOKEN が設定されていません」で失敗する | `.env.test` に `SETUP_TOKEN` と `PII_ENCRYPTION_KEY` を利用者が入れる（`docs/secrets.md`）。環境の不備であり、テストの不具合ではない。値は表示せず、`npm run env:check -- test` で項目の名前だけを確かめる |
| ログインの E2E が `__Host-session` の Cookie を見つけられずに失敗する | Cookie の名前の `__Host-` は `Secure` を必須にする。E2E は `http://localhost` で `Secure` の Cookie が保存されることを前提にしている（Chromium は `localhost` を安全な送信元として扱う想定）。保存されない場合は、ブラウザの版・`APP_ENV`・`ALLOWED_ORIGINS`（`http://localhost:5173`）を確かめる。**Cookie 名を `session` に戻す前に、利用者に相談する**（セキュリティの設計に関わる） |
| ログインが 503 になる | `.env.test` に `LOGIN_THROTTLE_KEY` がない、または43文字の形式でない。`npm run env:check -- test` で項目の名前だけを確かめる（値は表示しない）。環境の不備であり、テストの不具合ではない |
| ログインが 429 になる | E2E は接続元（開発・テストでは固定のキー）ごとの受付が15分に30回までのため、短い間に何度も実行すると上限に当たる。`npm run db:reset:test`（`pretest:e2e` が実行する）で、検証用 DB の `login_attempts` を空にしてから再実行する |
| `npm run db:reset:test` が失敗する（E2E の前処理） | 前回のテストのサーバー（開発サーバー、または `vite preview`）が残っていて、検証用 DB のファイルを掴んでいる可能性がある。何が動いているかを確かめ、**自分が起動したものだけ**を止めてから再実行する。自分が起動したか分からないものは、止めずに利用者に確認する |
| 本番形の E2E が起動しない、または別のサーバーに向かう | ポート 5173 を別のプロジェクトのサーバーが占有している（`localhost` だけでなく `127.0.0.1:5173` も確かめる。第3章）。開発サーバー用の E2E と同時に実行していないかも確かめる。環境の不備であり、テストの不具合ではない |
| 利用者の切り替え（`__Host-session` の Cookie の差し替え）で `Invalid cookie fields` になる | `__Host-` の Cookie は `url: http://…` を指定すると拒否される。`domain`・`path`（`/`）・`secure: true` で渡す（`e2e/message-drafts.spec.ts`）。環境の不備ではなく、渡し方の問題 |
| 失敗の原因が分からない | `playwright-report/` とトレース（`npx playwright show-trace <trace.zip>`）を確かめる |
