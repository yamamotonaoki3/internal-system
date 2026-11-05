# 設計書：デザインの土台（スタイルの方針・共通の部品）

Issue #171（親 #108）で実装した、フロントエンドのスタイルの仕組みの設計。後続のIssue（共通レイアウト #121、各機能の画面）が、**部品を足す・使う場所と書き方**を迷わないようにするための文書。コードは書き写さず、ファイル名・部品の名前で指す。

## 目的

- 色・文字・余白などの基準値を1か所に集め、画面が増えても見た目と読みやすさをそろえる
- よく使う部品（ボタン・入力欄・通知・画面の枠）を共通にし、各画面で素の要素に直接スタイルを書かない
- 本番のCSP（`style-src 'self'`）を変えずに、スタイルを使う
- 初回に読み込むJavaScriptを増やさない（すでに目標を超えているため）
- 範囲外：共通レイアウト（サイドバー・ヘッダー。#121で実装。[app-shell.md](app-shell.md)）、個別の機能画面の作り込み、ダークモード、アイコン、UI部品のライブラリ

## 方針と判断

- 方針：Tailwind CSS 4＋CSS変数のデザイントークン＋自前の小さな共通部品。理由・選択肢・見直す条件は [ADR-0015](../adr/0015-style-foundation.md)、調査は [T-07](../research/T-07-style-foundation.md)
- 新しく入れたライブラリは `tailwindcss` と `@tailwindcss/vite`（どちらも4.3.3固定。`docs/tech-stack.md`）
- 色はWCAG 2.x AAを満たすよう、プロトタイプ（`prototype/`）の色相を保ったまま濃さを調整した。プロトタイプは本番のコードに流用しない
- 端末のフォントだけを使う（Webフォントは入れない）。ダークモードは作らない

## CSPを変えない理由と、開発・本番の違い

- 画面を配信する `public/_headers` のCSPは `style-src 'self'`。インラインの `<style>` と `style` 属性は許可されない
- そのため、**`style` 属性と `<style>` 要素を使わない**。見た目はクラスだけで決める。実行時にスタイルを注入するライブラリ（CSS-in-JS系）は使わない
- CSSの配信のしかたが、開発と本番で違う
  - 開発サーバー（`npm run dev`・`npm run dev:test`）：ViteがCSSを `<style>` として注入する。開発サーバーにはCSPがかからないため動く
  - 本番ビルド（`npm run build`）：CSSは外部ファイル（`assets/*.css`）になり、`<link rel="stylesheet">` で読み込まれる。CSPのもとで動く
- 開発サーバーだけの確認では、CSPのもとで動くことは分からない。**本番形の確認**（ビルド済みの成果物をCSPをかけて配信して確かめる E2E。`e2e-prod/csp-style.spec.ts`）で確かめる。手順は [E2Eの手順書](../testing/e2e.md)

## ファイルと役割

| 場所 | 役割 |
| --- | --- |
| `frontend/src/styles/index.css` | Tailwindの読み込み、デザイントークン（`@theme`）、全体の基本のスタイル（`@layer base`：本文・フォーカスの輪郭）。`frontend/src/main.tsx` が読み込む |
| `frontend/src/styles/tokens.test.ts` | 色の組み合わせのコントラスト比を、`index.css` の値から自動で確かめる |
| `frontend/src/components/Button.tsx` | ボタン（`variant`：primary・secondary・danger・ghost） |
| `frontend/src/components/TextField.tsx` | ラベル・ヒント・エラーつきのテキスト入力欄 |
| `frontend/src/components/SecretField.tsx` | 秘密の値（トークン・パスワード）の入力欄。表示・非表示のボタンつき |
| `frontend/src/components/Alert.tsx` | 通知（`tone`：error・info・warning） |
| `frontend/src/components/PageLayout.tsx` | 画面の枠（`main`＋`h1`。`width`：narrow・default） |
| `frontend/src/components/FieldMessages.tsx` | 入力欄の下のヒント・エラーと、`aria-describedby` 用のid（`useFieldIds`）。`TextField` と `SecretField` が共用する**内部用**の部品で、画面からは使わない |
| `vite.config.ts` | `@tailwindcss/vite` のプラグインを登録している |
| `scripts/size-report.mjs` | 初回に読み込むJS・CSSの大きさを表示する（`npm run size:report`） |
| `playwright.prod.config.ts`、`e2e-prod/csp-style.spec.ts` | 本番形のE2E（`npm run test:e2e:prod`） |
| `e2e/style-foundation.spec.ts` | 開発サーバーでの表示・アクセシビリティのE2E（Tabの順・フォーカスの輪郭・画面幅） |

## トークン（基準値）

- 色・文字・角丸・影の基準値は、`frontend/src/styles/index.css` の `@theme` の**1か所だけ**で定義する。画面や部品に色の値を直接書かない
- 色は **`--color-*: initial` で Tailwind の既定の色をすべて外し**、`@theme` に書いたものだけを使う。`bg-red-500` のような既定の色のクラスは存在しない
- 名前は**用途で付ける**（`primary`・`danger`・`text-muted`・`border-strong` など）。見た目の名前（`teal`・`light-gray`）は付けない。値を変えても名前が意味を保つため
- 余白は4px刻みで、使うのは4・8・12・16・24・32・48pxの**7段階**だけ（Tailwindのクラスでは `1`・`2`・`3`・`4`・`6`・`8`・`12`）
- 文字は本文14px、補足の最小12px、入力欄16px、画面の見出し（h1）24px。行間は本文1.6、見出し1.35
- 角丸は `sm` 4px・`md` 8px・`lg` 12px、影は `panel`・`float` の2段階

### 色の組み合わせとコントラスト比

実際に接する組み合わせを `tokens.test.ts` で確かめている（文字は4.5以上、枠・フォーカスの輪郭は3以上）。比は `index.css` の値から計算した。

| 前景（用途） | 背景 | 比 | 基準 |
| --- | --- | --- | --- |
| `text`（本文） | `bg` / `surface` | 13.37 / 14.40 | 4.5 |
| `text-muted`（補足の文字） | `bg` / `surface` | 5.16 / 5.56 | 4.5 |
| `on-primary`（主ボタンの文字） | `primary` / `primary-hover` | 5.20 / 6.11 | 4.5 |
| `primary`（リンク） | `bg` / `surface` | 4.83 / 5.20 | 4.5 |
| `danger`（エラーの文字） | `bg` / `surface` / `danger-bg` | 5.72 / 6.16 / 5.23 | 4.5 |
| `warning-text` | `warning-bg` | 5.29 | 4.5 |
| `info-text` | `info-bg` | 6.25 | 4.5 |
| `disabled-text`（無効なボタンの文字） | `disabled-bg` | 4.53 | 4.5 |
| `border-strong`（入力欄の枠） | `bg` / `surface` | 3.38 / 3.64 | 3 |
| `focus`（フォーカスの輪郭） | `bg` / `surface` | 4.65 / 5.01 | 3 |

- `border`（パネルや区切りの飾りの線）は、情報を伝えない飾りなので基準の対象外。入力欄の枠は `border-strong` を使う
- 無効な状態は `opacity` で薄くせず、専用の色（`disabled-bg`・`disabled-text`）を使う
- フォーカスの輪郭は要素の外側（2pxのすき間の外）に出るため、隣り合うのはすき間の背景（`bg` または `surface`）。主色の地と同じ色相に近い輪郭を重ねる配置は作らない
- **色を足す・変えるときは、`index.css` の `@theme` と、`tokens.test.ts` の組み合わせの一覧の両方に足す**。`tokens.test.ts` は、トークンが見つからない・6桁の16進でない（8桁・rgbaなど）場合に失敗する

## クラスの規約

### Tailwindの技術としての決まり（どのアプリでも同じ）

- トークン（`@theme`）は1か所に集める
- クラス名を**動的に作らない**（`` `bg-${tone}` `` のような文字列連結をしない）。Tailwindはソースの文字列を読んでクラスを見つけるため、連結で作ったクラスは出力されない。条件で変えるクラスは、**完全なクラス名の文字列を固定の表に書き、キーで引く**（`Button.tsx` の `VARIANT_CLASSES`、`Alert.tsx` の `TONE_CLASSES`、`PageLayout.tsx` の `WIDTH_CLASSES` が例）
- クラスを探す範囲は `@import "tailwindcss" source(none)` と `@source "../"` で `frontend/src/` に絞る（意図しないファイルを読まない）
- 任意の値（`w-[123px]`・`text-[#abc]` のような `[...]`）は使わない。値は必ずトークンから選ぶ。足りなければトークンを足す

### このプロジェクトでの使い方

- 色は `--color-*: initial` で既定を外してあるため、トークンにある色の名前のクラスだけを使う
- 余白は上の7段階だけ
- 画面で素の `button`・`input` に直接クラスを書かない。`Button`・`TextField`・`SecretField` を使う（フォーカス・最小の高さ・無効の見た目をそろえるため）
- 共通部品は `className` を**受け取らない**（型でも除いてある）。呼び出し側が見た目を上書きできないようにし、見た目の変更は部品の中で行う。部品にない見た目が要るときは、部品に `variant` などを足す
- フォーカスの輪郭は `index.css` の `@layer base` の `:focus-visible` の**1か所だけ**（3px・色 `focus`・offset 2px）で決める。部品や画面で `outline`・`outline-offset` を上書きしたり、`outline-none` を使ったりしない
- ボタンと入力欄の高さは、768px未満で44px以上、768px以上で40px以上
- テストは**クラス名で要素を探さない**。ロール・名前・ラベル（`getByRole`・`getByLabelText`）で探す。クラスを変えてもテストが壊れないようにするため

## 部品の一覧と使い分け

| 部品 | 使うとき | 主な入力 |
| --- | --- | --- |
| `PageLayout` | 画面の一番外側。`main` と画面の `h1` を作る。1画面に1つ | `title`、`width`（`narrow`：入力中心の狭い画面、`default`：既定） |
| `Button` | 操作のボタン。`type` の既定は `"button"`（フォームを意図せず送信しない）。送信ボタンだけ `type="submit"` を渡す | `variant`（`primary`：主な操作、`secondary`：補助、`danger`：取り消せない操作、`ghost`：枠も背景もない控えめな操作。メニューを開くボタンなど。#121）、`button` の標準の属性 |
| `TextField` | ラベルつきのテキスト入力。ヒントとエラーを `aria-describedby` で結ぶ。`ref` が `input` に渡る（react-hook-form の `register` が使える） | `label`、`hint`、`error`、`input` の標準の属性 |
| `SecretField` | パスワード・トークンなど、伏せて入力する欄。表示・非表示のボタンが付く | `TextField` に加えて `toggleLabels`（ボタンの読み上げ名） |
| `Alert` | 画面内の通知。`role` は呼び出し側が渡したものだけ付く（勝手に読み上げさせない） | `tone`（`error`・`info`・`warning`）、`role` |
| `FieldMessages` | 内部用。`TextField`・`SecretField` の中だけで使う | — |

### 部品を足す手順

1. 置く条件：2つ以上の画面・機能で同じ見た目を使う、または使う見込みがあるときに `frontend/src/components/` に置く。1つの機能だけで使うものは、その機能のフォルダ（`frontend/src/features/<機能>/components/`）に置く
2. 素の要素（`button`・`input`・`label`・`dialog` など）で作る。入力欄には必ず `label` を結び付ける（`htmlFor` と `id`）。エラー・ヒントは `aria-invalid`・`aria-describedby` で結ぶ
3. `className` を受け取らない型にする（`Omit<ComponentProps<"...">, "className">`）。見た目の違いは `variant` などで選ばせ、クラスは**完全な文字列の固定の表**から引く
4. 色・余白はトークンにあるものだけを使う。足りない色は `@theme` と `tokens.test.ts` に足す
5. フォーカスの輪郭は上書きしない
6. 隣に `<部品名>.test.tsx` を置き、ロール・名前・ラベルで検証する。クラス名では検証しない
7. この文書の「部品の一覧」に足す

## Preflightへの対処

Tailwindは、素のHTML要素のブラウザ標準の見た目をリセットする（Preflight）。そのため、次の要素は**自分でクラスを付けないと**見た目が失われる。実装した対処は次のとおり。

| 要素 | リセットされるもの | 対処 |
| --- | --- | --- |
| `h1` | 大きさ・太さ | `PageLayout` が付ける（24px・太字） |
| `h2` | 大きさ・太さ | 18px・太字（`text-lg font-bold`）。画面の移動後にフォーカスを移す `h2[tabindex="-1"]` には、マウス操作でも輪郭が出るよう `index.css` に専用の指定がある |
| `p` | 段落の間隔 | 下に余白（`mb-3`） |
| `ol` | 番号 | `list-decimal pl-6 space-y-2`（番号が消えるため） |
| `fieldset` / `legend` | 枠・余白 | `fieldset` は枠・角丸・余白（`rounded-md border border-border p-4`）、`legend` は太字14px |
| `dl` / `dt` / `dd` / `code` | 余白・等幅 | `dt` は補足の色・12px、`dd` は下に余白、`code` は等幅・折り返し可（`font-mono break-all`） |
| `a`（`Link`） | 色・下線 | `text-primary underline` |
| `button` | 背景・枠・文字 | `Button` 部品だけで見た目を作る。素の `button` は使わない |

## 画面幅の決まり

- 境界は **768px**（Tailwindの `md`）。768px未満をスマートフォン表示、以上をパソコン表示の2段階とする（要件の対応ブラウザ・画面幅の方針）
- 768px未満：パネルは画面の幅いっぱい（左右に余白）、ボタンと入力欄の高さは44px以上
- 768px以上：パネルは `width` の最大幅（`narrow` は28rem、`default` は48rem）、ボタンと入力欄の高さは40px以上
- 360px幅でも、横スクロールが出ず、文字が切れないこと（`e2e/style-foundation.spec.ts` で確かめる）

## 複雑な部品（ダイアログ・メニューなど）

- ネイティブで足りるかを、まず確かめる。#121の共通レイアウトでは、次の3つをブラウザ標準のネイティブで作り、ライブラリは足していない（詳しくは [app-shell.md](app-shell.md)）
  - `<dialog>`（`showModal()`）：スマホのメニューのドロワー（`Drawer.tsx`）
  - `popover="auto"`＋`popoverTarget`：アバターメニュー（`AvatarMenu.tsx`）
  - `<details>`：管理メニューのまとまりの開閉（`AdminMenu.tsx`）
- 3つとも `style` 属性や `<style>` を使わず、外部CSSのクラスだけで動く（本番形のE2Eで確かめる）。jsdomでは再現できない動き（フォーカスの閉じ込め・Esc・外側クリック・メディアクエリ）はE2Eが受け持つ
- 上の3つで足りないとき（以下は従来の方針）
- 足りなければ、UI部品のライブラリを、**CSPを有効にしたまま動くことを検証して**、利用者の承認を得てから追加する。インラインの `<style>` を注入し、止める手段のない部品は使わない（ADR-0015）

## 初回のJS・CSSの大きさ（AC-5）

測り方：`npm run build` の後に `npm run size:report`（`scripts/size-report.mjs`）。`dist/client/index.html` が読み込むJS・CSS（静的importを含む）の、圧縮前とgzip（level 9）のバイト数を表示する。表示だけで、大きさによって失敗にはしない。CIの品質チェックでも、`npm run check` の後にビルドして表示する。

| | JS 圧縮前 | JS gzip | CSS 圧縮前 | CSS gzip |
| --- | --- | --- | --- | --- |
| 導入前（コミット 1f39d4f） | 755,222 B | 230,392 B | 0 B | 0 B |
| 導入後 | 759,072 B | 231,570 B | 10,513 B | 3,005 B |

- JSの増加は、共通部品とクラス名の文字列の分（圧縮前＋3,850 B、gzip＋1,178 B）。CSSは約10.5 KB（gzip約3.0 KB）が増えた
- 初回のJSは、導入前から目標（圧縮後200KB以下）を超えている。この対処（画面ごとの遅延読み込み）は、このIssueの範囲外で、別のIssueで行う

## テストの場所

| 内容 | 場所 |
| --- | --- |
| 共通部品の単体テスト | `frontend/src/components/*.test.tsx`（`Button`・`TextField`・`SecretField`・`Alert`・`PageLayout`） |
| 色のコントラスト比 | `frontend/src/styles/tokens.test.ts` |
| 表示・アクセシビリティのE2E（開発サーバー） | `e2e/style-foundation.spec.ts` |
| 本番形のE2E（CSP下で外部CSSだけが使われること） | `e2e-prod/csp-style.spec.ts`（`npm run test:e2e:prod`）。#121で、ログイン後の画面（アバターメニュー・ドロワーを開いた状態を含む）の確認を足した |

## 関係するIssueとADR

- Issue #171（親 #108）。後続：共通レイアウト #121（実装済み。[app-shell.md](app-shell.md)）
- [ADR-0015](../adr/0015-style-foundation.md)（スタイルの方針）、[ADR-0012](../adr/0012-zero-trust-principle.md)（CSPを理由なく緩めない）
- 調査：[T-07-style-foundation.md](../research/T-07-style-foundation.md)
