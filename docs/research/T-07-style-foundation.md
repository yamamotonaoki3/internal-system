# T-07 デザインの土台（スタイルの方針・共通の部品）の調査

## 1. 目的と範囲

- 目的：Issue #171（親Issue #108）で、本番のフロントエンドに入れる「スタイルの仕組み（CSSの方針・基準値・共通の部品）」を利用者が決めるための材料をそろえる（AC-1）。プロトタイプの見た目を整理し、スタイルの方法の選択肢を比べ、新しく入れるライブラリの安全性を公開情報で確認する。
- 範囲：リポジトリ内の文書とプロトタイプの読み取り、公式文書・npmレジストリ・公開データベースの確認。**ライブラリのインストール・`npx`の実行・コードの変更はしていない**。`npm view`（レジストリへの読み取りの問い合わせ）と、公開APIへの問い合わせだけを使った。
- 比較する選択肢：素のCSS（グローバル＋CSS変数）／CSS Modules／Tailwind CSS／UI部品のライブラリ（Radix UI・shadcn/ui・Base UI・React Aria Components・Mantine・MUI・Chakra UI）／CSS-in-JS。
- 決定はしない。「推奨案」は理由つきの参考にとどめる。
- プロトタイプは本番のコードに流用しない決まり（`AGENTS.md`）のため、プロトタイプは「見た目の参考」としてだけ整理する。

## 2. 調べた日と前提

- 調べた日：2026-11-04。バージョン・公開日・ダウンロード数・星の数は、この日に取得した値で、変わりうる。入れる直前に再確認する。
- 現状（`package.json`、`frontend/src`）：React 19.3.1、Vite 8.3.5、TypeScript 6.0.3、React Router 8.5.0、TanStack Query、React Hook Form。**CSSファイルはまだ無い**。Cloudflare Workers（静的アセット）へビルドして配信する。テストは Vitest（jsdom）＋ Testing Library ＋ Playwright。
- 初回のJavaScript：既存のビルド成果物 `dist/client/assets/index-BsGKaTwH.js` は 755,222 バイト（圧縮前。Issueの「約755 kB」と同じ）で、gzip後は約230,587 バイト（約225 KB。この調査で `gzip` により確認した値は約230,368 バイトで、圧縮の設定により数百バイトの差が出る）。要件は「圧縮後200KB以下」（`docs/requirements/nonfunctional.md`の1章）で、**圧縮後の指標でもすでに超えている**（500 kB超の警告は圧縮前の値）。この成果物が現在のソースと一致するかは未確認。AC-5では指標（圧縮前／gzip後）をそろえて比べる。
- 制約（4章で詳しく整理）：バージョンは固定する（`^`・`~`・`latest`を使わない）。新しいライブラリは利用者の承認が要る。CSPは `style-src 'self'`（`backend/src/lib/security.ts`）。WCAG 2.1 AA相当。

## 3. 結論（要点）

- **プロトタイプの色は、そのままではWCAG 2.1 AAを満たさない箇所がある**。計算した範囲で、主ボタンの白文字（#0d8f85上、3.97:1）、補足文字（#698092上、約4.1:1）、案件番号（#93a5ae、2.55:1）、フォーカスの輪郭（#f2ab42が白地で1.97:1）が基準未満。基準値（トークン）を作るとき、色を調整する前提にする（2-2・2-3）。
- プロトタイプの色は215色（6桁の16進数の種類）、文字サイズは約20種類、角丸は10種類以上と、基準値がなく場当たりに増えている。トークンは、色・文字サイズ・余白・角丸・影を5〜8段階に絞る案を示す（5章）。
- **本番のCSPが `style-src 'self'`（インラインの `<style>` を許可しない）であることが、選択に大きく効く**。MUIの公式文書は、EmotionがインラインのCSSを注入するためnonce（リクエストごとの使い捨て値）が要ると書く。本システムのHTMLは静的アセットで、リクエストごとのnonceを入れる構成になっていない。したがって、**実行時にCSSを注入するCSS-in-JS（Emotion・styled-components、それに依存するMUI・Chakra）は、現状のCSPと相性が悪い**。（出典14・15）
- Base UIの公式文書は、一部の部品（`ScrollArea`・`Select`の一部の設定）がインラインの `<style>` を注入し、厳しいCSPではnonceが要ると書く。**ただし代替策として、`CSPProvider` の `disableStyleElements` で注入を止め、必要なルールを外部のCSSへ置く方法も公式に書かれている**（出典16。`#disable-inline-style-elements`）。**Radix UIで同じ問題があるか（`react-remove-scroll`の挙動）は、今回の調査では確認できなかった（未確認）**。入れるなら小さな検証（CSPを有効にしたままダイアログを開く。Base UIなら `disableStyleElements` を使った構成での動作も含める）が先に要る。（出典16）
- 初回の大きさ：Tailwind CSS・CSS Modules・素のCSSは、JavaScriptをほとんど増やさず、CSSだけが増える（大きさは未計測）。UI部品のライブラリは、Bundlephobiaが示すパッケージ全体の圧縮後の大きさが、Radix全体74 kB、Mantine 175 kB、MUI 157 kB、Chakra 314 kB、React Aria Components 279 kB、Base UI 166 kB（取得日2026-11-04。木構造の削減前の上限で、使う部品だけなら小さい）。個別の部品だけを入れる形（`@radix-ui/react-dialog` 13 kB）が最小。（出典20）
- **導入前の確認（公開情報のみ）では、候補のどれにも「導入時に自動実行されるスクリプト（preinstall・install・postinstall）」はなく、既知の脆弱性の登録もなかった**（ただし、この確認は調査担当の公開情報の確認で、第三者の再照合は未了。採否に使う前に別の経路で確かめる）（OSVとnpmの公開アドバイザリ、固定する版で確認。3-3章）。ただし、`tailwindcss`は最新の4.3.4が公開から2日、`chakra-ui`の3.38.0は1日、`lucide-react`はほぼ毎日更新で、**公開から日が浅い版は避け、十分に日数が経った版を固定する**。
- 推奨案（参考。採否は利用者が決める）：**Tailwind CSS（4.3.3に固定）＋ CSS変数のトークン ＋ 自前の小さな共通部品（ボタン・入力欄など、`button`・`label`の素の要素）。ダイアログ・メニューのような複雑な部品が必要になった時点で、無装飾の部品（Radix UIの個別パッケージまたはBase UI）を、CSPの検証をしてから追加する**。詳細は7章。

## 4. 本システムの制約との整合

| 出典の文書 | 制約 | スタイルの選択への影響 |
| --- | --- | --- |
| `docs/tech-stack.md`・`AGENTS.md` | ライブラリのバージョンは固定する（`^`・`~`・`latest`不可）。新しいライブラリは利用者の承認が要る。採用したら `docs/tech-stack.md` の表に足す | 候補ごとに「固定する版」を決める。ライブラリを増やすほど承認と表の更新が増える |
| `docs/tech-stack.md`（Vite＋React Router） | Vite 8＋`@cloudflare/vite-plugin`で、画面とAPIを1つのWorkersにまとめて配信する | Viteのプラグインとして動くもの（Tailwindの`@tailwindcss/vite`は peer が `vite ^8` を含む）が合う |
| `docs/requirements/nonfunctional.md` 1章 | 初回JavaScriptは圧縮後200KB以下（仮説）。現状は超過 | ランタイムが大きい選択肢（Chakra・MUI・React Aria Components 全体）は不利。CSS中心の方法は有利 |
| 同 5章 | 対応ブラウザ：Chrome・Edge・Firefox・Safariの最新版、AndroidとiOSのブラウザ。幅768px未満をスマートフォン表示、以上をパソコン表示の2段階 | Tailwind 4 の最低ライン（Chrome 111・Safari 16.4・Firefox 128。出典3）は、最新版の方針と矛盾しない。2段階のレイアウトは `md`（768px）に一致させられる |
| 同 6章 | WCAG 2.1 AA相当。文字のコントラスト比4.5:1以上。ステータスや未読は色だけに頼らない。S-27のカードはEnter・Space・Escで操作でき、フォーカスを移して戻す | 色の基準値でコントラストを担保する（2-3）。複雑な部品（カード・メニュー・ダイアログ）は、アクセシビリティを持つ無装飾の部品の価値が高い |
| `.claude/skills/frontend` | 共通UIは `components/`、機能固有は `features/<機能>/`。`button`・`label`・`alt`を付ける。`aria`は必要な場合に限る。アプリアイコン・ファビコンは必須 | 共通の部品の置き場は `frontend/src/components/`（既存の `SecretField.tsx` と同じ） |
| `.claude/skills/frontend-build` | 初回JSは200KB以下を目安に、超えるなら `lazy` を検討。CIで大きさを記録 | AC-5の測定（ビルド出力）と同じ方法で比較する |
| `backend/src/lib/security.ts` | CSP：`style-src 'self'`、`script-src 'self'`、`img-src 'self' data:`、`font-src` の指定なし（`default-src 'self'`が適用される） | 同一オリジンから配信するフォントは `default-src 'self'` で許可される。**外部配信（Google Fonts等のCDN）のフォントは、`font-src` と `style-src` の追加などCSPの変更（ADRが要る）が必要になりうる**。インラインの `<style>` を注入するライブラリは、nonceの仕組み、注入を止める設定、またはCSPの変更が必要 |
| `index.html`（ルート） | `<html lang="ja">`、ファビコン・マニフェストあり | 日本語の既定フォントは、端末のフォント（Yu Gothic・Meiryoなど、プロトタイプと同じ）で足りる。Webフォントは入れない案が最も軽い（入れる場合は、同一オリジンで配信すればCSPの変更は不要。外部配信なら8章の確認事項） |
| Testing Library・Playwright（`docs/tech-stack.md`） | ラベルや役割で要素を探す（アクセシビリティに沿った書き方） | クラス名がハッシュ化される方式でも、役割・ラベルで探すため問題ない。CSSがjsdomで評価されない点に注意（表示の確認はE2Eで行う） |

## 5. プロトタイプの見た目の整理（見た目の参考）

対象：`prototype/style.css`（1,225行）・`shell.css`（1,084行）・`organize.css`（478行）、`index.html`、`README.md`、`screens.js`ほか。CSS変数は使われていない（`var(--`は `shell.css` に2か所）。プロトタイプの画面は、`docs/requirements/screens.md` のS-01〜S-40に対応する（下の「画面との対応」）。

### 5-1. 配色（6桁の16進数で215種類。主なもの）

| 用途 | 色（プロトタイプの値） | 備考 |
| --- | --- | --- |
| 文字（本文） | #182b40 | 背景#f4f7f8に対し13.4:1 |
| 背景（ページ） | #f4f7f8 | パネルは#fff |
| サイドバーの背景・文字 | #10283b・#d6e4eb | 11.6:1。見出しのキャプション#829aacは5.2:1 |
| 主色（ブランド・主ボタン） | #0d8f85（hover #08776f）、ロゴ#22b7a8 | **主ボタンの白文字は3.97:1で4.5:1に満たない** |
| 補助の文字 | #698092（subtle）、#7d919c（ヒント）、#8295a0・#93a5ae・#8aa0aa | 白地で4.11・3.28・3.11・2.55・2.73:1。**4.5:1に満たないものが多い** |
| 罫線・パネルの枠 | #dce5e9・#e0e8eb・#d4e1e5 など | 近い色が多数あり、まとめられる |
| エラー | #ab3b36（`form-error`）、#b3261e（`shell.css`の `aria-invalid`） | 同じ意味で2色。白地で6.2〜6.5:1（合格） |
| 危険（ボタンの枠・文字） | #aa3a39・枠#edc4c2 | 6.2:1 |
| 警告（alert） | 背景#fff5e4・枠#f4dfb6・文字#816127 | |
| 情報（banner） | 背景#e7f6f3・枠#b7ded8・文字#17645e | |
| バッジ（状態） | 進行中#dff4ef/#087669、公開#e9ecfa/#505fab、申請中#fff2d9/#94621b、却下#fde8e5/#9b3f35、取り下げ#eef1f3/#5b6c7a、アーカイブ#ecf0f5/#556779、棚上げ#f1e8f6/#5a2f77 | 7種類。文字を必ず添える作りで、色だけに頼らない方針に合う。進行中・既定は4.6〜4.8:1で合格 |
| フォーカス | #f2ab42 の3pxの輪郭（`:focus-visible`、offset 2px） | **白地で1.97:1、サイドバー（暗い地）では7.7:1**。白地では非テキストの3:1に満たない |
| ダイアログの幕・影 | #0b2332a6、影 0 30px 70px #0f293c4d | |

### 5-2. 文字

| 項目 | 内容 |
| --- | --- |
| フォント | `Inter, "Yu Gothic", Meiryo, sans-serif`（Webフォントの読み込みなし。Interが無い端末では游ゴシック等）。等幅は `ui-monospace, Consolas, monospace` |
| サイズ | 頻度順に 12px（44回）・11px（40回）・13px（24回）・15px・14px・18px・10px・24px・19px ほか約20種類（9〜28px） |
| 見出し | h1は28px（スマートフォンで23px、390px以下で21px）、パネルの見出しは15px、モーダルは18px |
| 行間 | 1.6（主）、1.55〜1.8。見出しは1.35 |
| 課題 | 11〜12pxの文字が非常に多い。スマートフォンでの読みやすさ・拡大時の表示に影響する。本番の基準値は、最小12px、本文14px前後に寄せる案を検討する |

### 5-3. 余白・角丸・影

| 項目 | プロトタイプの実態 | トークン案（参考） |
| --- | --- | --- |
| 余白 | 4・5・6・7・8・9・10・12・14・18px などが混在（8px、6px、4px、12pxの順に多い） | 4・8・12・16・24・32・48px の7段階（4pxの倍数） |
| 角丸 | 4・5・6・7・8・9・10・12・13px、円（20px・50%）。8pxが最多（15回） | 小4px・中8px・大12px・丸（9999px）の4段階 |
| 影 | パネル `0 4px 18px rgba(…,0.035)`、トースト・メニュー・ダイアログなど6種類 | 2段階（パネル・浮かぶもの）に絞る |
| 幅 | サイドバー244〜246px、メインの最大1,360〜1,400px、スレッドパネル340px | 共通レイアウト（#121）で決める |
| 部品の高さ | ボタン39px（小32px）、入力欄39px、スマートフォンの操作領域は44px以上のものもある | ボタン・入力欄は最低40px、スマートフォンの操作領域は44pxをそろえる案 |

### 5-4. レイアウトと画面との対応

| 領域 | 内容 | 対応する画面 |
| --- | --- | --- |
| 全体の枠 | `.app-shell`：左にサイドバー（244px、暗い色）、右に主領域。上部にヘッダー（68px、固定）。スキップリンクあり | S-01（#121で実装。この Issue の対象外） |
| ヘッダー | ロゴ、全体検索、通知、アバター | S-01、S-14、S-15 |
| 主領域 | `main`（最大1,400px、余白34px 36px）。見出し行（`eyebrow`・h1・補足・右に操作ボタン）、ツールバー、パネル、一覧 | S-05、S-16〜S-17 ほか |
| ログイン前の画面 | 本番は装飾なしの最小の見た目。プロトタイプは `auth-panel`・`auth-view` | S-02、S-34（この Issue の対象） |
| ホーム | 「ようこそ、{表示名}さん」と短い案内（`welcome`・`home-grid`） | S-01 のホーム |
| 一覧 | `case-row`（グリッド：件名・状態・日付など）。スマートフォンでは項目を畳む | S-16、S-09、S-20 |
| 詳細 | 2列（主＋295pxの側列）。1,050px以下で1列 | S-17 |
| チャット | `chat-layout`・`chat-message`・`composer`・`thread-panel`（340px） | S-05、S-06、S-07 |
| スマートフォン | 幅767px以下：サイドバーを下部ナビ5項目＋ドロワーに変更 | 全画面 |

### 5-5. 部品の数と使われ方（`index.html`と各 `*.js` の出現回数、おおよそ）

| 部品 | 出現 | 主なクラス | 状態・備考 |
| --- | --- | --- | --- |
| パネル（カード） | 約63 | `panel`・`panel-header`・`panel-body` | 白地・枠1px・角丸12px・薄い影 |
| ボタン | 約48 | `button`（既定）・`primary`・`danger`・`small`・`ghost`・`text-button`・`top-icon` | hoverで枠と文字を主色に。`:disabled` は opacity 0.5＋`not-allowed`。高さ39px |
| 入力欄・テキストエリア・選択 | 約45（`form-field`）、select 18、textarea 16 | `form-field`・`form-hint`・`form-error`・`field-note` | 枠1px・角丸7px・高さ39px。エラーは `[aria-invalid="true"]` で赤い枠と輪郭 |
| バッジ | 約35 | `badge`＋状態（7種類） | 角丸が丸い、11px、太字 |
| 表 | 約34（`table`を含む語） | `ann-table`・`client-table`・`audit-row` | スマートフォンでは行をカード状に変形（`data-label`） |
| アバター | 約24 | `avatar`・`message-avatar`・`person-card` | 円形または角丸9px |
| 注意書き | alert 16、banner 5 | `alert`（警告色）・`banner`（情報色）・`muted-box`・`join-notice` | `role` の付け方は画面ごと。本番では意味ごとに統一したい |
| トースト | 約10 | `toast` | 画面右下、2秒ほど表示。`aria-live` の扱いは本番で要確認 |
| ダイアログ | 4（`<dialog>`）ほか | `modal-header`・`modal-body`・`modal-footer`・`confirm-dialog`・`drawer`・`avatar-dialog` | ネイティブの `<dialog>` を使う。幅560px、角丸13px |
| メニュー | `role="menu"` 8 | `kebab-menu`・`status-menu`・`announce-menu`（`details`） | キーボードのフォーカス表示あり |
| タブ | 2 | `tabs`・`tab`（`.active`で下線） | 選択中は下線の主色 |
| 選択肢 | checkbox 12、radio 5 | `checkbox-option`・`radio-label` | |
| 空の状態・読み込み | empty-screen 5、skeleton 2 | `empty-screen`・`state-card`・`skeleton` | loading・error・emptyの状態は本番の完了の定義にある |
| ページ送り・進捗 | | `pagination`・`progress-wrap` | |
| スキップリンク | 1 | `skip-link` | 本番でも必須 |

### 5-6. 状態・レスポンシブ・ダークモード

| 項目 | プロトタイプの実態 | 本番への示唆 |
| --- | --- | --- |
| hover | ボタン・行・ナビで色の変化 | `:hover` はタッチでは効かない前提で、色以外の手がかりを併用 |
| focus | `:focus-visible` に3pxの琥珀色の輪郭（全体）。一部は個別に上書き（2px） | 白地でも3:1以上になる色（例：濃い青系）に変える。サイドバー上は明るい色が必要なので、領域ごとに変える |
| disabled | opacity 0.5＋`not-allowed` | opacity だけではコントラストの規定に触れる可能性（無効な部品は規定の対象外だが、意図が伝わる文字を添える） |
| エラー | 文字の赤＋`aria-invalid` の赤い枠 | 色だけにしない（文字のメッセージを必ず添える。既に添えている） |
| レスポンシブ | `@media` は 1050px・767px・390px の3段階（`shell.css`では1100px・767px・390px）。要件は768px未満／以上の2段階 | 本番は767px/768pxの境目に合わせ、390pxは必要なものだけ |
| ダークモード | なし（`prefers-color-scheme` なし） | 要件にもない。要否は決める前に確認（8章） |
| アニメーション | トーストの0.2sの遷移のみ。`prefers-reduced-motion` なし | 本番で動きを足すなら配慮を付ける |

### 5-7. デザイントークンの案（参考。採否は利用者が決める）

CSS変数（`:root`）で持ち、どの方法でも共通に使える形にする。名前は意味で付ける（色名ではなく用途）。

- 色（用途）：`--color-bg`（#f4f7f8）、`--color-surface`（#fff）、`--color-text`（#182b40）、`--color-text-muted`（4.5:1以上になるよう、#698092より濃くする。例の候補：#566b7a程度。要計算）、`--color-border`（#d4e1e5）、`--color-primary`（白文字で4.5:1以上になるよう#0d8f85より濃くする。#0b7a71程度が候補。要計算）、`--color-primary-hover`、`--color-danger`（#aa3a39）、`--color-danger-bg`、`--color-warning-bg/-text`、`--color-info-bg/-text`、`--color-focus`（白地で3:1以上）、サイドバー用の色（`--color-nav-bg`・`--color-nav-text`）
- 文字：`--font-sans`、サイズ 12・14・16・18・22・28px の6段階、行間 1.6（本文）・1.35（見出し）
- 余白：`--space-1〜7`（4〜48px）
- 角丸：`--radius-sm/md/lg/full`
- 影：`--shadow-panel`・`--shadow-overlay`
- 最小の操作領域：40px（スマートフォンは44px）

注意：上の「例の候補」の色は、方向を示すだけで、コントラストを計算して確定したものではない。実装の段階で、背景との組み合わせごとに計算して決める。

## 6. 本番でのスタイルの方法の選択肢

### 6-1. 候補の比較（取得日2026-11-04）

| 比較軸 | A：素のCSS（グローバル＋CSS変数） | B：CSS Modules | C：Tailwind CSS（4.3系） | D：無装飾の部品（Radix UI・Base UI・React Aria）＋A/B/C | E：装飾つきの部品（Mantine・MUI・Chakra） | F：CSS-in-JS（Emotion・styled-components） |
| --- | --- | --- | --- | --- | --- | --- |
| 実装・学習の手間 | 小。クラス名の衝突に注意が要る | 小。Viteが標準でサポート（追加なし） | 中。ユーティリティクラスの学習が要る。公式のViteプラグインあり | 中。部品の組み立て方の学習が要る | 小〜中。部品がそろっているが、独自のテーマ設定の学習が要る | 中。実行時の仕組みの理解が要る |
| 保守 | 大きくなると名前の管理が難しい | ファイル単位で閉じる。保守しやすい | クラスの並びが長くなる。設定が一か所。AIの生成との相性が良いかは推測（根拠は未確認） | 部品の更新に追随する | ライブラリの大きな更新（例：MUI 9、Mantine 9）への追随が要る | 実行時の費用と、メンテナンスの状況に左右される |
| 初回JS・CSSの大きさ | JS：増えない。CSS：書いた分だけ | 同左 | JS：増えない。CSS：使ったクラス分だけ（未計測） | JS：個別パッケージなら小（Dialog 13 kB gzip）、全体だと74 kB（Bundlephobia） | JS：全体で157〜314 kB gzip（上限）。使う部品の分だけになるが、実際に使う部品のサイズは未確認 | JS：Emotion 8 kB、styled-components 13 kB（gzip）。ほかに実行時の費用 |
| アクセシビリティ | 自分で守る（`button`・`label`、フォーカス）。複雑な部品は自作が必要 | 同左 | 同左（クラスでフォーカス表示を統一しやすい） | 高い。WAI-ARIAに沿ったキーボード・フォーカス管理を提供（出典10・11） | 高い（部品の範囲で） | ライブラリによらない |
| 一貫性 | 規律が要る（トークンで補う） | 同左 | トークンを使いやすい。ただし任意の値（`w-[123px]` など）も書けるため、逸脱の防止には運用・レビューが要る（出典22） | 見た目は自前。トークンで統一 | 高い（既定のテーマ）が、独自のデザインに寄せる手間が要る | 規律が要る |
| テストのしやすさ | 良い。役割・ラベルで探すため影響なし | 良い。クラス名はハッシュ化されるため、クラス名で探さない前提 | 良い | 良い。ただしポータル・アニメーションの待ちに注意 | 良い（公式にTesting Libraryの例あり、未確認） | 良い。ただしスタイルの検証はjsdomでは難しい |
| Vite 8との相性 | 良い | 良い（標準） | 良い。`@tailwindcss/vite` の peer に `vite ^8` が含まれる | 良い | 良い | 一部のライブラリは追加設定が要る（未確認） |
| ライセンス | 不要 | 不要 | MIT | MIT（Radix・Base UI）、Apache-2.0（React Aria） | MIT | MIT |
| プロトタイプを再現しやすいか | 高い（プロトタイプ自身が素のCSS。ただし流用は不可、値の参考にする） | 高い | 高い（値をトークンに入れて再現できる） | 部品の振る舞いを再現できる。見た目はA/B/Cで作る | 低〜中。既定のデザインが違い、上書きの手間が大きい | 高い |
| 日本語の表示 | 端末のフォント。問題なし | 同左 | 同左（既定のフォント指定を日本語に差し替える） | 同左 | 既定の英語フォントを差し替える | 同左 |
| ダークモード・テーマ | CSS変数と `prefers-color-scheme` で可能 | 同左 | `dark:` 変形とCSS変数で可能 | 見た目は自前 | テーマ機能あり（実行時の切り替え。CSPに注意） | 可能 |
| 現状のCSP（`style-src 'self'`）との関係 | 問題なし | 問題なし（ビルドで外部のCSSファイルになる） | 問題なし（ビルドで外部のCSSファイルになる。出典1） | **Radix：未確認。Base UI：一部の部品がインラインの `<style>` を注入する。nonceを使うか、`disableStyleElements` で止めて外部CSSに置く代替策がある（出典16）。いずれもCSP有効下での動作確認が要る** | MUI・Chakraは Emotion のため nonce が要る（出典15）。Mantineは静的なCSSファイル中心（出典17）だが、`MantineProvider` の挙動は未確認 | **相性が悪い**（nonce または `unsafe-inline` が要る。出典14） |

### 6-2. 各候補の補足

- A・B（Viteの標準機能）：新しいライブラリが要らない。承認が不要で、`docs/tech-stack.md` の更新も不要。トークンはCSS変数で持つ。部品の数が増えたときの名前の管理が課題。
- C：Tailwind CSS 4 は、設定が主にCSSの中（`@import "tailwindcss"`、`@theme`）に移った。公式のVite手順は `tailwindcss` と `@tailwindcss/vite` の2つを入れ、プラグインを追加し、CSSに1行を足す（出典2）。最低のブラウザはChrome 111・Safari 16.4・Firefox 128（出典3）。新しいライブラリは2つ（承認が要る）。ユーティリティクラスは `className` に長く並ぶため、共通の部品（`Button` など）に閉じ込める運用が前提。
- D：Radixは `radix-ui`（まとめたパッケージ）と個別の `@radix-ui/react-*` の2つの入れ方がある。個別なら必要な部品だけが入る。Base UIは、MUIの組織が2025-12に公開した新しい名前（`@base-ui/react`）で、1.x系。React Aria Componentsは Adobe 製で、アクセシビリティと国際化（日本語の日付など）に力を入れている。shadcn/ui は、Tailwind と Radix（または Base UI）の上に作った部品の**ソースを `shadcn add` でプロジェクトに写す**方式（出典4）。CLI（`shadcn`）は手元のツールで、コマンド実行で他のパッケージが追加されるため、`npx` で自動的に入れる運用は、バージョン固定とサプライチェーン確認の観点から**本システムの決まり（承認・固定）と衝突しやすい**。
- E：Mantine 9 は CSS Modulesで書かれた静的なCSSを同梱し、実行時のCSS-in-JSではない（出典17）。ただし peer が React 19.2 以上。npmの公開権限者は1人（登録上）だが、公式リポジトリは組織配下で、開発体制全体は今回確認していない（公開権限者の数と、開発・保守の体制は区別して扱う）。MUI 9 は Emotion に依存し（peer）、CSPにはnonceが要る（出典15）。Chakra UI 3 は Emotion を使い、npm上でprovenance（出所の証明）がない。プロトタイプの見た目を再現するには、既定のデザインの上書きが多くなる見込み（推測）。パッケージ全体の大きさ（Bundlephobiaの上限値）は大きいが、実際に使う部品のサイズは未確認。
- F：実行時に `<style>` を注入するため、現状のCSPでは動かない。styled-componentsのnonce設定は「簡単ではない」とMUIの文書も書く（出典15）。本システムでは現時点では推奨しない（採否は利用者が決める）。

## 7. 推奨案（参考。決定ではない）

1. **スタイルの方法：Tailwind CSS 4（`tailwindcss` と `@tailwindcss/vite`、どちらも 4.3.3 に固定）＋ CSS変数のトークン（`@theme` と `:root`）を推奨する**。理由：(a) JavaScriptを増やさず、初回のJavaScriptが超過している現状を悪化させない（AC-5）。(b) 外部のCSSファイルとしてビルドされるため、現状のCSP（`style-src 'self'`）を変えずに済む。(c) 公式のVite手順があり、Vite 8に対応する（peer に `^8` を含む）。(d) 色・文字・余白のトークンを一か所に集められ、後続のIssue（#121ほか）が同じ値で書ける。(e) 入れるライブラリが2つで、導入前の確認の結果にも問題が見つからなかった（3-3章）。
   - 代替：新しいライブラリを入れない方針なら、**B：CSS Modules＋CSS変数**。承認が不要で、CSPにも影響せず、最も安全。ユーティリティクラスの学習が不要。名前の管理と、トークンの運用を自分たちで守る負担がある。Tailwindの利点（トークンを使いやすい。ただし任意の値も書けるため、逸脱を防ぐには運用とレビューが要る。AI生成との相性は推測）を重視しないなら、これでも足りる。
2. **共通の部品は、まず自前で小さく作る**：`frontend/src/components/` に `Button`・`TextField`（`label`・ヒント・エラーを含む）・`Alert`・`Heading` などの最小の部品を、素の `button`・`label`・`input` で作る。既存の `SecretField.tsx` が先例。S-34・S-02・ホームに必要な範囲に絞る。
3. **ダイアログ・メニュー・タブなどの複雑な部品は、必要になった機能のIssueで、無装飾の部品を追加する**（今回は入れない）。第一候補は個別パッケージの Radix UI（`@radix-ui/react-dialog` など）または Base UI。**追加する前に、CSPを有効にしたままダイアログとスクロールの固定が動くかを検証する**（Radixは未確認。Base UIは `disableStyleElements` で注入を止め、必要なルールを外部CSSへ置く方法が公式にあるが、採用するなら、CSPを有効にしたまま対象の部品〔`ScrollArea`・`Select`など使うもの〕の見た目と動作を確認する）。ネイティブの `<dialog>` で足りるなら、ライブラリ自体が要らない（プロトタイプも `<dialog>` を使っている）。
4. **装飾つきの部品ライブラリ（Mantine・MUI・Chakra）と、CSS-in-JSは、現時点では推奨しない（採否は利用者が決める）**。理由：MUI・Chakra・CSS-in-JSは、現状のCSPと衝突する（nonceまたはCSPの変更が要る）。Mantineは、CSPとは衝突しにくい見込みだが（静的なCSS中心。`MantineProvider` は未確認）、既定のデザインがプロトタイプと違い、上書きの手間が見込まれる。Mantineを外す決定的な理由はなく、実際に使う部品のサイズ測定の結果次第で候補に戻せる。
5. **色は、基準値にする段階でコントラストを計算し直す**（主ボタン・補足の文字・フォーカスの輪郭）。AC-3の検証に、色の組み合わせの表を設計書に残す。
6. **フォントは端末のフォントのまま**とする案（Webフォントは入れない。初回の大きさのため。同一オリジンで配信するフォントなら現行のCSPで許可されるが、外部配信はCSPの変更が要る）。プロトタイプの `Inter` は、端末にない場合は代替になるため、日本語を優先した並びにする案（`"Yu Gothic UI", "Hiragino Sans", Meiryo, sans-serif` のような。要確認）。
7. 後続のIssueのために、設計書（`docs/design/`）に、トークンの置き場所、部品の置き場所、新しい部品の追加手順、クラスの書き方を書く（AC-4）。

## 8. 決める前に確認すること

1. **ダークモードの要否**：要件にない。要るなら最初からトークンを2組にする。要らないなら今回は作らない（推奨：作らない）。
2. **新しいライブラリを入れてよいか**：入れるなら Tailwind CSS（2パッケージ）。入れないなら CSS Modules。入れるライブラリは `docs/tech-stack.md` に足し、バージョンを固定する。
3. **デザインの再現度の優先順位**：プロトタイプの見た目をどこまで再現するか。色の調整（コントラストのため）で、プロトタイプと見た目が変わることの了承。
4. **無装飾の部品ライブラリを、今回入れるか、必要になった時点で入れるか**（推奨：必要になった時点）。
5. **CSPを変えてよいか**：変える場合はADRが要る（例：Base UIのnonce対応のため、HTMLを動的に返す）。変えない前提なら、インラインの `<style>` を注入する部品は、Base UIの `disableStyleElements`（出典16）のように注入を止める手段があり、CSP有効下で動作を確認できたものだけを使う。止める手段がない部品は使わない。
6. **フォント**：端末のフォントのみでよいか。Webフォントを使うなら、同一オリジンで配信する（現行CSPの `default-src 'self'` で許可される）か、外部配信（CDN）にするか。外部配信ならCSPの `font-src`（と、フォントのCSSを読むための `style-src`）を足すADRが要る。
7. **画面幅の境目**：要件は768px（2段階）。プロトタイプの1050px・390pxの段階は、本番に持ち込むか。
8. **アイコン**：プロトタイプは文字・記号のアイコンを使っている。アイコンのライブラリ（例：`lucide-react`）を入れるか。入れるなら、ほぼ毎日更新されるため版の選び方に注意（3-3章）。入れない案（SVGを自前で置く）もある。
9. **AC-5の測定方法**：初回のJavaScript・CSSの増加を、ビルド出力（gzip後）で測る。比較する基準（導入前の755,222バイト〔圧縮前〕／gzip後約230 KB。既存成果物が現在のソースと一致するかは未確認）を、現在のソースでビルドし直して記録するか。指標（圧縮前／gzip後）はそろえる。

## 9. 導入前の確認（サプライチェーンの安全性。公開情報のみ、2026-11-04）

方法：`npm view <パッケージ>[@版] --json`（レジストリの読み取りの問い合わせ。コードは実行しない）、npmの公開アドバイザリ（`/-/npm/v1/security/advisories/bulk`）、OSVの公開API（`api.osv.dev`）、npmのダウンロード数API、GitHubの公開情報（`gh api`）。`npm install`・`npx`は実行していない。**間接の依存の総数は、インストールしないと確定できないため未確認**（直接の依存の数だけ記載）。アドバイザリのAPIが動作することは、既知の脆弱な版（lodash 4.17.20）で確認した。

### 9-1. 名前の確認・公開者・履歴

| パッケージ | 正式な出どころ（レジストリの `repository` と公式文書の一致） | 公開者（npmのメンテナー数）と履歴 | 注意点 |
| --- | --- | --- | --- |
| `tailwindcss`、`@tailwindcss/vite` | `github.com/tailwindlabs/tailwindcss`（公式文書 tailwindcss.com の手順と同じ名前。出典2） | 3人。2017年から2,688版。2026年に4.2.4〜4.3.4を継続して公開 | 名前が似た偽物（1文字違い）の有無は網羅できていない。公式文書に書かれた名前そのものを使うことで防ぐ |
| `radix-ui`、`@radix-ui/react-*` | `github.com/radix-ui/primitives`（公式 radix-ui.com） | 2〜4人（WorkOSのアカウントを含む）。2026-07〜10に更新。リポジトリの最終更新は2026-10-14 | 2つの入れ方（まとめ／個別）があるため、どちらかに統一する。まとめは55の直接の依存（すべて同じ組織の部品） |
| `@base-ui/react` | `github.com/mui/base-ui`（公式 base-ui.com） | 8人（MUIの関係者）。2025-12-11に公開され、13版。以前は別の名前だった（旧名の偽物と混同しない） | 新しい名前のため、名前の確認を特に慎重にする |
| `react-aria-components` | `github.com/adobe/react-spectrum` | 2人。2018年から932版 | |
| `@mantine/core` | `github.com/mantinedev/mantine`（公式 mantine.dev） | npmの公開権限者は**1人**。2021年から484版。直近は1〜2週間ごとに更新 | 公開権限者が1人であることと、開発・保守の体制全体は別。リポジトリは組織配下で、体制は今回未確認 |
| `@mui/material` | `github.com/mui/material-ui` | 10人 | 周辺に `@emotion/react`・`@emotion/styled` が要る |
| `@chakra-ui/react` | `github.com/chakra-ui/chakra-ui` | 2人 | 最新の3.38.0は2026-11-03公開（1日前） |
| `lucide-react` | `github.com/lucide-icons/lucide`（公式 lucide.dev） | 1人。**ほぼ毎日公開**（10月に14版） | 更新が速く、固定した版がすぐ古くなる。GitHubのライセンス表示が `NOASSERTION`（npmはISC） |
| `tailwind-merge`、`class-variance-authority`、`clsx` | それぞれ `dcastil/tailwind-merge`、`joe-bell/cva`、`lukeed/clsx` | 各1人。**`clsx` は2024-06以降リポジトリの更新なし、`cva` の最新版は2024-11** | shadcn/uiの標準の部品が使う補助ライブラリ。Tailwindだけなら不要 |
| `@emotion/react`、`styled-components` | `emotion-js/emotion`、`styled-components/styled-components` | 4人、3人 | 現時点では推奨しない（CSP）。参考として確認 |
| `shadcn`（CLI） | `github.com/shadcn-ui/ui`（公式 ui.shadcn.com） | 2人。直接の依存が32 | CLIとして実行するもの。32の直接の依存を持つ。`npx` で実行する前にバージョンを固定する必要がある |

**この表は調査担当（AI）による公開情報の確認で、第三者による再照合は未了である**（レビュー側の環境ではnpmレジストリに接続できなかった）。**採否に使う前に、別の経路（別の担当者・別の環境での `npm view` と公開アドバイザリの再実行）で確かめる**。

### 9-2. 版・導入時のスクリプト・脆弱性・出所の証明・利用状況

「固定案の版」は、公開から日数が十分に経ち、かつ最新に近い版（取得日の2026-11-04から数えて）。**最新版が公開から2週間未満のものは、一つ前の版を案にした**（2週間は当方の目安で、規定ではない）。例外：最新版がすでに2週間以上経っている `radix-ui`・`@radix-ui/react-dialog`・`react-aria-components` は最新版を案にする（旧版を選ぶ理由がない。変更した版についても導入時のスクリプト・脆弱性を再確認し、いずれもなしだった）。`lucide-react` と `shadcn`（CLI）の「固定案」は**暫定候補で未選定**（最新版も案も公開から2週間未満または近い。選ぶ時点で、2週間以上経った版を選び直し、同じ確認を行う）。

| パッケージ | 最新版（公開日） | 固定案の版（公開日、経過日数） | 導入時に自動実行されるスクリプト | 直接の依存数 | 既知の脆弱性（固定案の版。OSV・npm） | provenance（出所の証明） | 週間ダウンロード（2026-11-04取得） | GitHubの星／最終更新／ライセンス |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `tailwindcss` | 4.3.4（2026-11-02） | **4.3.3（2026-07-16、111日）** | なし | 0 | なし | あり（SLSA v1） | 約1.69億 | 98,061／2026-11-02／MIT |
| `@tailwindcss/vite` | 4.3.4（2026-11-02） | **4.3.3（2026-07-16）** | なし | 3（`tailwindcss`・`@tailwindcss/node`・`@tailwindcss/oxide`） | なし（`oxide`・`node` も確認） | あり | 約5,605万 | 同上 |
| `@tailwindcss/oxide` | （同じ版にそろう） | 4.3.3 | なし（`build` 等のスクリプトは公開者用で、導入時には実行されない）。プラットフォーム別のネイティブのバイナリを `optionalDependencies` で入れる（12種類） | 0（任意の依存12） | なし | あり（プラットフォーム別の1つを確認） | — | 同上 |
| `radix-ui` | 1.8.1（2026-10-12） | 1.8.1（2026-10-12、23日） | なし | 55 | なし | あり | 約2,599万 | 19,466／2026-10-14／MIT |
| `@radix-ui/react-dialog` | 1.3.1（2026-10-12） | 1.3.1（2026-10-12、23日） | なし | 15（`react-remove-scroll`・`aria-hidden`など） | なし | あり | 約9,029万 | 同上 |
| `@base-ui/react` | 1.9.0（2026-10-09） | 1.9.0（26日） | なし | 5 | なし | あり | 約2,711万 | 11,295／2026-11-04／MIT |
| `react-aria-components` | 1.22.1（2026-10-09） | 1.22.1（2026-10-09、26日） | なし | 8 | なし | **なし** | 約834万 | 16,011／2026-11-03／Apache-2.0 |
| `@mantine/core` | 9.7.4（2026-10-25） | 9.7.3（2026-10-17、18日） | なし | 5 | なし | あり | 約355万 | 31,907／2026-11-04／MIT |
| `@mui/material` | 9.5.0（2026-10-09） | 9.5.0（26日） | なし | 12 | なし | あり | 約1,361万 | 99,297／2026-11-04／MIT |
| `@chakra-ui/react` | 3.38.0（2026-11-03） | 3.37.0（2026-08-28、68日） | なし | 7 | なし | **なし** | 約208万 | 40,710／2026-11-04／MIT |
| `lucide-react` | 1.68.0（2026-11-04） | 【暫定・未選定】1.62.0（2026-10-27、8日）。2週間以上経った版の目安：1.59以前（2026-10-17） | なし | 0 | なし | あり | 約1.27億 | 25,552／2026-11-04／ISC（GitHubは NOASSERTION） |
| `tailwind-merge` | 3.7.0（2026-09-12） | 3.7.0（53日） | なし | 0 | なし | あり | 約1.04億 | 5,700／2026-11-03／MIT |
| `class-variance-authority` | 0.7.1（2024-11-26） | 0.7.1 | なし | 1（`clsx`） | なし | なし | 約7,886万 | 6,907／2026-11-02／Apache-2.0 |
| `clsx` | 2.1.1（2024-04-23） | 2.1.1 | なし | 0 | なし | なし | 約1.61億 | 9,845／2024-06-10／MIT |
| `@emotion/react` | 11.14.0（2024-12-09） | 11.14.0 | なし | 8 | なし | なし | 約2,731万 | 18,023／2026-10-23／MIT |
| `styled-components` | 6.6.0（2026-10-12） | 6.6.0（23日） | なし | 5 | なし | あり | 約1,459万 | 41,049／2026-11-04／MIT |
| `shadcn`（CLI） | 4.23.0（2026-10-27） | 【暫定・未選定】4.22.2（2026-10-27、8日）。2週間以上経った版は要選定 | なし | 32 | なし | あり | 約1,725万 | 127,322／2026-11-04／MIT |

読み取りと注意：

- **「導入時に自動実行されるスクリプトなし」**は、`npm view <名前>@<版> scripts` の `preinstall`・`install`・`postinstall` が空であることを意味する。npm 11 は、`allowScripts` で許可していないパッケージの導入時のスクリプトを実行しないため（`docs/tech-stack.md`）、仮にあっても既定では実行されない。
- **既知の脆弱性「なし」**は、取得日時点の公開データベースに登録がないという意味で、安全の保証ではない。導入後に `npm run audit:prod` で再確認する。
- 公開から2週間未満の版：`tailwindcss`/`@tailwindcss/vite` 4.3.4（2日）、`chakra-ui` 3.38.0（1日）、`lucide-react` 1.67以降。Tailwindは4.3.3（111日前）を固定する案。
- `react-aria-components`・`@chakra-ui/react`・`class-variance-authority`・`clsx`・Emotionの各パッケージには、npmのprovenance（出所の証明）がない。これだけで危険とは言えないが、公開の経路を第三者が検証しにくい。
- 偽物（名前の1文字違い）の網羅的な確認は、レジストリの検索を使わなかったため**未確認**。代わりに「公式文書に書かれた名前を使う」「レジストリの `repository` が公式のリポジトリと一致する」ことを確かめた。入れる直前に、名前の綴りと `repository` を再確認する。

### 9-3. 結論：注意が必要と判断した候補

- `lucide-react`：ほぼ毎日公開され、固定した版がすぐ古くなる。npm上はISCだが、GitHubのライセンス表示が `NOASSERTION`。入れるなら公開から十分に経った版を固定し、必要なアイコンだけを個別に import する（全体は圧縮後約199 kB、Bundlephobiaの上限値）。
- `@mantine/core`：npmの公開権限者が1人（開発体制全体は未確認）。peerが React 19.2 以上。
- `@chakra-ui/react`：最新版が公開1日。provenanceなし。Emotion依存でCSPと衝突しやすい。
- `@mui/material`・`@emotion/*`・`styled-components`：CSP（`style-src 'self'`）と衝突する。
- `shadcn`（CLI）：直接の依存32。`npx` で実行すると、版が固定されないまま追加のパッケージが入る。使うなら版を固定し、導入前に同じ確認を行う。
- `@base-ui/react`：名前が新しく（2025-12公開）、旧名との混同に注意。一部の部品でインラインの `<style>` を注入する。
- `radix-ui`（まとめ）：直接の依存が55。個別のパッケージにすると減らせる。CSPとの相性は未確認。
- `tailwindcss` 系：問題は見つからなかった。ただし最新の4.3.4は公開2日のため避ける。

## 10. 未確認

- 各候補を実際に組み込んだときの初回のJavaScript・CSSの増加（Tailwindの出力CSSの大きさを含む）。Bundlephobiaの値は、パッケージ全体の上限で、実際の使い方での測定ではない。
- Radix UI（特に `react-remove-scroll`）が、`style-src 'self'` のCSPで動くか。Mantineの `MantineProvider` が注入するスタイルの扱い。
- Tailwind CSS 4.3.3 と Vite 8.3.5、`@cloudflare/vite-plugin` 1.64.0 の組み合わせの動作（peer は `vite ^8` を含むが、実機では未検証）。
- 間接の依存の総数、npmの`audit`相当を実際の依存の木で行った結果（インストールしていないため）。
- 名前が似た偽物のパッケージの有無（網羅的な検索は未実施）。
- 現時点の最新のプロトタイプ（`shell.css` の後半、`organize.css` の細部）の個別のクラスの出現回数の厳密な集計。5-5章の数はおおよその値。
- プロトタイプの個別の色の組み合わせのコントラスト比のうち、5-1章に載せていないもの。
- 各ライブラリの日本語の入力（IME）・長文の表示の挙動。
- MUI・Mantine・Chakra の Testing Library との相性の公式の記述。
- 5-7章の色の候補（#566b7a、#0b7a71）のコントラスト比（方向を示すだけで、計算していない）。

## 11. 出典

取得日はすべて2026-11-04。

1. Tailwind CSS：Vite でのインストール https://tailwindcss.com/docs/installation/using-vite
2. 同（`tailwindcss` と `@tailwindcss/vite` を入れる手順の根拠は出典1と同じページ）
3. Tailwind CSS：互換性（Chrome 111・Safari 16.4・Firefox 128） https://tailwindcss.com/docs/compatibility
4. shadcn/ui：Viteでのインストール https://ui.shadcn.com/docs/installation/vite
5. npmレジストリ（`npm view` の結果。パッケージの版・公開日・メンテナー数・依存・スクリプト・provenance）：https://registry.npmjs.org/ （各パッケージの名前で問い合わせ）
6. npm 公開アドバイザリ（一括の問い合わせ） https://registry.npmjs.org/-/npm/v1/security/advisories/bulk
7. OSV（Open Source Vulnerabilities） https://api.osv.dev/v1/query
8. npm ダウンロード数API https://api.npmjs.org/downloads/point/last-week/
9. GitHub のリポジトリの公開情報（星・最終更新・ライセンス）：`gh api repos/<組織>/<名前>`
10. Radix Primitives：アクセシビリティ https://www.radix-ui.com/primitives/docs/overview/accessibility
11. Radix UI の公式 https://radix-ui.com/primitives
12. Base UI の公式 https://base-ui.com
13. React Aria Components（Adobe） https://github.com/adobe/react-spectrum
14. styled-components のnonceに関する議論 https://github.com/orgs/styled-components/discussions/3942
15. MUI：Content Security Policy https://mui.com/material-ui/guides/content-security-policy/
16. Base UI：CSP Provider（nonceと `disableStyleElements`：https://base-ui.com/react/utils/csp-provider#disable-inline-style-elements） https://base-ui.com/react/utils/csp-provider
17. Mantine：スタイルの提供方法 https://mantine.dev/styles/mantine-styles/
18. Mantine の公式 https://mantine.dev/
19. MUI の公式 https://mui.com/material-ui/
20. Bundlephobia（パッケージ全体の大きさ） https://bundlephobia.com/api/size?package=<名前>@<版>
21. 本リポジトリ：`prototype/style.css`・`shell.css`・`organize.css`、`docs/requirements/nonfunctional.md`、`docs/requirements/screens.md`、`docs/tech-stack.md`、`.claude/skills/frontend`・`frontend-build`、`backend/src/lib/security.ts`、`package.json`、`vite.config.ts`
22. Tailwind CSS：任意の値の使用 https://tailwindcss.com/docs/adding-custom-styles#using-arbitrary-values

## 注記（2026-11-04、Issue #171の実装後に追記。上の記述は調査時点のまま残している）

- 3章・9章で「間接の依存の総数は未確認」としていた点は、導入後に確定した。ロックファイルに増えた依存は**29件**（既存の版の変更・削除なし）。内訳は、`tailwindcss`・`@tailwindcss/*`（`@tailwindcss/oxide` とOS別のバイナリ）17件、`lightningcss` とOS別のバイナリ12件、`jiti` 1件。導入時に実行されるスクリプトはなかった（結果は Issue #171 のコメントと `docs/tech-stack.md` の「Tailwind CSS」）
- 9-2章の表で `@tailwindcss/oxide` のOS別のバイナリを「12種類」としているが、導入後の照合では `@tailwindcss/oxide-*` は13種（`tailwindcss` 系の17件の内訳）だった
- 3章の「大きさは未計測」は、導入後に測った。初回のJS・CSSの大きさは `docs/design/style-foundation.md` の「初回のJS・CSSの大きさ」
