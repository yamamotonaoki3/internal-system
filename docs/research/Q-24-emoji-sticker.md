# Q-24 絵文字の選択画面・スタンプのライブラリ調査

## ① 目的と範囲

- 目的：要判断 Q-24（メッセージ書式・絵文字・スタンプ）の残件「ライブラリ選定・承認」のうち、**絵文字の選択画面**と**スタンプ**について、候補を調べて比較し、利用者が選べる状態にする（Issue #92 の調査範囲の 2・3）。決定はしない。新しいライブラリは、利用者の承認なしに追加しない（AGENTS.md）。
- 対象の要件（現行）：
  - 絵文字は Unicode 標準、スタンプは固定一覧とし、外部APIに依存しない（C-58。1-7 補足、API V-23）。
  - 絵文字とスタンプは同じ選択画面にまとめる（C-60）。リアクション（メッセージへの絵文字・スタンプ。1-7、EP-1-12）にも使う。1つのメッセージに付けられるリアクションは20種類まで（1-7 AC-4、C-90）。リアクションの値は、絵文字は Unicode 文字、スタンプは固定一覧の識別子（EP-1-12）。
  - 日本語の利用者。スマートフォン表示は画面幅768px未満（C-80）。アクセシビリティは WCAG 2.1 AA 相当を目標にする（C-80、`docs/requirements/nonfunctional.md`）。
  - 技術スタックは React 19.3.0・Vite 8.3.4・TypeScript 6.0.3 ほか（`docs/tech-stack.md`）。CSP は Skill「security」で設定する（細部は⑦）。
- 範囲外：ライブラリのインストール・`package.json` の変更・コードの変更・`docs/tech-stack.md` の更新・スタンプ素材（画像）の選定。マークダウンの調査は別ファイル（`docs/research/Q-24-markdown.md`）。
- 調査の方法：`npm view`・npm レジストリ・GitHub API（読み取りのみ）、各リポジトリの README・ドキュメント、`npm pack` で取得したパッケージの tarball（一時フォルダで展開して中身を見ただけで、プロジェクトには入れていない）、jsDelivr 上のデータファイルの取得（サイズ計測）。

## ② 調べた日

2026-10-29（`date +%F` で確認）

## ③ 結論（要点）

決定ではなく、推奨案と理由。

1. **第一候補：`emoji-picker-react`（5.1.4、MIT）**。理由：
   - 絵文字データがパッケージに同梱され、日本語（検索のキーワード・カテゴリ名）のデータもある。絵文字データの取得で外部 CDN に接続しない（README の記載）。ただし README は、**画像形式の絵文字（Apple・Google・Facebook・Twitter）は、`getEmojiUrl` で自サイトを指さない限り jsDelivr から読み込む**とも説明している。既定の native（OS の絵文字フォント）表示なら外部通信は出ない。「外部通信なし」は要件（C-58・V-23 は「外部APIに依存しない」まで）ではなく、この推奨案の条件（native 表示、または画像を自サイトに置く）として扱う。
   - **独自画像の項目（カスタム絵文字）とそのグループ**を持てるため、スタンプ（固定一覧の画像）を絵文字と同じ選択画面に置ける（`customEmojis`・`group`）。
   - React 16.8〜19 に対応（README）。CSP の `nonce` に対応する旨が README にある。
   - **ただし注意**：v5 は 2026-10-10 に出た作り直し版で、5.0.0 → 5.1.4 が約2週間で6回出ている（npm の公開日）。安定性・保守の実績が短い。アクセシビリティの主張は作者自身の README によるもので、第三者の確認ではない。実装前に、プロトタイプ（捨てる前提）で日本語検索・キーボード操作・スマートフォン表示・CSP を確かめることを推奨する。
2. **第二候補：`emoji-picker-element`（1.29.1、Apache-2.0）**。実績が長く（2026-03 まで更新）、日本語の画面文言（i18n の `ja`）が同梱され、独自画像の項目（`customEmoji`）もある。ただし、(a) 絵文字データは既定では外部 CDN（jsDelivr）から取得する。外部CDNも使わない方針を採る場合は、自サイトに置いて `dataSource` で指す。(b) Shadow DOM の中で**インラインの style 属性**を使うため、厳しい CSP（`'unsafe-inline'` なし）では崩れると報告されている（GitHub Issue #505・#544、いずれも未解決）。(c) Web Component のため、React のラッパーは自前になる。
3. **`frimousse`（0.4.0、MIT）は、方式A（ライブラリ本体にスタンプを登録）は未対応だが、方式B（共通の枠にタブを置き、スタンプ側を自作）なら同じ選択画面にできる**。ただし追加実装（スタンプのタブのキーボード操作・読み上げ・検索）の負担と、0.x の不安定さのため、順位は下げた。軽量・React 向け・日本語ロケールあり・アクセシビリティの属性ありだが、独自画像の項目は本体が未対応（Issue #5 が未解決。非公式のフォークが複数ある）。既定のデータ取得先も外部 CDN。0.x のため、小さな版でも API が変わりうる。
4. **`emoji-mart`（5.6.0）は非推奨**。React 用ラッパー（`@emoji-mart/react` 1.1.1）の peer が React 18 まで（19 は公式未対応。Issue #1027・#967・#1000 が未解決）、最終リリースが 2024-04-25、絵文字データが Emoji 14 まで、検索のキーワードが英語のみ（計測）。
5. **自前の最小実装**は可能だが、検索・カテゴリ・仮想スクロール・キーボード操作（グリッド）・スクリーンリーダー対応・肌の色・OS が表示できない絵文字の判定を自分で作って維持する負担が大きい。ライブラリを使えない事情（承認が下りない・CSP が合わない等）がある場合の代替案とする。
6. **スタンプ**：ライブラリは要らない。固定一覧（自前で用意した画像または文字）を、(A) 選択画面ライブラリの「カスタム絵文字」として登録する、または (B) 選択画面の枠（ポップオーバー）に「絵文字」「スタンプ」のタブを置き、スタンプのタブを自前で作る、のどちらかで足りる。素材の選定・ライセンス・用意の方法は、利用者が決める（⑥・⑧）。

## ④ 候補ごとの調査結果

数値は、特に断りがない限り、2026-10-29 に取得した npm レジストリ・GitHub API・tarball の計測による（出典は⑨）。「公開日」は npm の `time.modified`。週間ダウンロード数は npm API の 2026-10-21〜10-27 の値。

### 4-1 emoji-picker-react

| 項目 | 内容 |
| --- | --- |
| 最新の安定版 | 5.1.4（公開 2026-10-25）。ライセンス MIT |
| 版の動き | 4.19.4（2026-09-01）→ 5.0.0（2026-10-10）→ 5.0.1・5.0.2（10-24）→ 5.1.0（10-19）〜5.1.4（10-25）。v5 は作り直し版（README に「v4 からの移行」の案内あり） |
| 依存 | `shipstyles` 1.0.0（1つ）。peer：react >=16.8 |
| サイズ | tarball 展開後 24,365,787 バイト（28言語のデータを含む）。`dist/index.js` は 319,758 バイト（gzip 85,398 バイト。私が計測）。日本語データ `emojis-ja.json` は 239,152 バイト（gzip 約 50,855 バイト。私が計測）。実際に Vite で組み込んだときの配信サイズは未確認（⑦） |
| Unicode の絵文字・データ | 同梱（README「Offline, CSP-safe, no CDN」：28言語のデータをパッケージに含み、外部 CDN に接続しない）。日本語データは 1,906 件、データ内の追加バージョンの最大値は 16（私が計測。Emoji のどの版に当たるかは未確認） |
| 日本語 | `emojiData` に日本語データ（`emoji-picker-react/data/emojis-ja`）を渡す。検索のキーワード（例：😀 に「にっこり笑う」「スマイル」「顔」）とカテゴリ名（「人と体」「動物と自然」等）が日本語であることをデータで確認。画面の文言は `labels` で日本語にする（README） |
| 独自の項目（スタンプ用） | `customEmojis={[{ id, names, imgUrl, group }]}`。`group` で名前付きの区分（例：「スタンプ」）を作れる（CUSTOMIZATION.md） |
| アクセシビリティ | README は「キーボード操作・アクセシブルな意味づけは組み込み」と記載。ブラウザでの a11y テスト（axe）がリポジトリにあると記載。**作者自身の記載であり、第三者の評価ではない。スクリーンリーダーでの実機確認は未実施** |
| スマートフォン | 幅・高さの指定、`unstyled`／`primitives`（部品を組み合わせて自作レイアウト）あり。タッチ操作の実機確認は未実施 |
| リアクション向けの機能 | 「リアクションバー」（よく使う絵文字を並べ、「+」で全体の選択画面に展開）が組み込み |
| React 19・TypeScript・Vite | React 16.8〜19 に対応（README・peer）。型定義を同梱。Vite での組み込みの動作は未確認 |
| CSP | 「スタイルは一度だけ注入し、`nonce` を渡せば `'unsafe-inline'` なしで動く」と README に記載（未確認） |
| 保守 | 最新コミット 2026-10-25。スター 1,464、週間ダウンロード 1,928,693。README に「独立して保守されている」「GitHub Sponsors で支援できる」との記載（メンテナの体制は未確認）。公開済みのセキュリティ勧告（GitHub Security Advisories）なし（API が空配列） |

### 4-2 emoji-picker-element（Web Component）

| 項目 | 内容 |
| --- | --- |
| 最新の安定版 | 1.29.1（公開 2026-03-01）。ライセンス Apache-2.0。依存なし（`dependencies` の項目なし） |
| サイズ | tarball 展開後 436,739 バイト。README は「最小化＋gzip で約 12.5kB」と記載（未検証） |
| Unicode の絵文字・データ | データは本体に含まれない。**既定は外部 CDN から取得**（`dataSource` の既定値は `https://cdn.jsdelivr.net/npm/emoji-picker-element-data@^1/en/emojibase/data.json`）。外部CDNも使わない方針を採る場合は、自サイトに置いて `dataSource` で指す。日本語データ（`emoji-picker-element-data@1.8.0` の `ja/emojibase/data.json`）は 379,959 バイト（gzip 約 63,581 バイト。私が計測）。データの最大バージョンは 17（私が計測）。取得したデータは IndexedDB に保存される |
| 日本語 | 画面の文言は `emoji-picker-element/i18n/ja` が同梱（「検索」「カテゴリー」「読込中…」「よく使う」等）。絵文字の検索語・名前の日本語は、日本語データ（`ja`）を `dataSource` で指す。注記：README は「画面の翻訳（i18n）と絵文字データの翻訳（dataSource）は別で、両方の指定が必要」と説明 |
| 独自の項目（スタンプ用） | `customEmoji: [{ name, shortcodes, url, category }]`。`category` で区分を作れる。メモリ上に保持（IndexedDB には入れない） |
| アクセシビリティ | 「既定でアクセシブル」と README に記載。作者のブログ記事（出典⑨）あり。フォーカスリングは `:focus-visible`。i18n に、スクリーンリーダー向けの説明文（`searchDescription` 等）がある。**スクリーンリーダーでの実機確認は未実施** |
| スマートフォン | README に「小さい画面向けの CSS は付属しない。自分で CSS 変数（`--emoji-size` 等）を調整する」とある |
| React 19・TypeScript・Vite | 独自要素（`<emoji-picker>`）。React 19 は Custom Elements に完全対応した（React 公式ブログ。props は、要素にその名前のプロパティがあればプロパティとして渡される）。`emoji-click` イベントは `ref` に `addEventListener` で受ける形になる。React 用の公式ラッパーはない（README に React のデモはある）。`i18n`・`customEmoji` のような複雑な値は属性で渡せずプロパティで渡す |
| CSP | Shadow DOM 内の `<style>` と、実行時に計算した値の**インライン style 属性**を使う。厳しい CSP では崩れる旨の Issue #505・#544（いずれも未解決）。作者の回答は「Shadow DOM のため、静的な外部 CSS では対応できない。ハッシュの許可リストで対応する」との趣旨で、#544 では、その方法では足りないという指摘もある（出典⑨） |
| 保守 | 最新コミット 2026-03-05、最終リリース 2026-03-01。スター 1,762、週間ダウンロード 245,034。主なメンテナは Nolan Lawson（リポジトリの所有者）。公開済みのセキュリティ勧告なし |

### 4-3 frimousse

| 項目 | 内容 |
| --- | --- |
| 最新の安定版 | 0.4.0（公開 2026-09-21）。ライセンス MIT。依存なし（peer：react ^18 \|\| ^19、typescript >=5.1.0）。1.0 前 |
| サイズ | tarball 展開後 296,254 バイト。`dist/index.js` は 27,068 バイト（gzip 9,817 バイト。私が計測）。`"sideEffects": false`（ツリーシェイク可） |
| Unicode の絵文字・データ | データは Emojibase。**既定は外部 CDN（`https://cdn.jsdelivr.net/npm/emojibase-data`）から取得**し、localStorage（と sessionStorage）にキャッシュする。`emojibaseUrl` で自サイトの場所に変えられる（その言語のフォルダだけ置けばよい）。日本語データ `emojibase-data@18.0.0/ja/data.json` は 785,075 バイト（gzip 約 100,872 バイト。私が計測）、データの最大バージョンは 18（私が計測） |
| 日本語 | ロケールに `ja` を含む（型定義）。日本語の絵文字名・検索語（「にっこり笑う」「スマイル」等）をデータで確認。カテゴリ名は `messages.json`（6,647 バイト）。画面の文言（検索欄の文言等）は自分で付ける（部品はスタイルなし） |
| 独自の項目（スタンプ用） | **本体は未対応**。Issue #5「Support custom emojis」が未解決。README・ドキュメントは「標準の Unicode 絵文字をテキストとして描く。画像・スプライトの絵文字は未対応」。部品の差し替え（`components`：`CategoryHeader`・`Row`・`Emoji`）と `resolveEmojiData`（データを自前で用意）で、スタンプを足す余地はあるが、画像の表示は自前。非公式のフォークがある（出典⑨）が、採用しない前提で記録する |
| アクセシビリティ | README は「キーボード操作・スクリーンリーダー対応」と記載。ビルド済みの `index.js` に `aria-label`・`aria-live`・`aria-selected`・`aria-rowindex` 等の属性があることを確認。**スクリーンリーダーでの実機確認は未実施** |
| スマートフォン | 列数（`columns`）・仮想スクロール。スタイルは自前 |
| React 19・TypeScript・Vite | React 18・19 に対応（peer）。TypeScript の型を同梱 |
| CSP | 外部取得は `emojibaseUrl` を自サイトにすれば無くなる。インライン style の使い方は未確認（⑦） |
| 保守 | 最新コミット 2026-09-21（リリース作業）、コントリビューター 6人（GitHub API）、スター 1,807、週間ダウンロード 1,424,606。開発元は Liveblocks（会社）。公開済みのセキュリティ勧告なし |

### 4-4 emoji-mart（`emoji-mart`＋`@emoji-mart/react`＋`@emoji-mart/data`）

| 項目 | 内容 |
| --- | --- |
| 最新の安定版 | `emoji-mart` 5.6.0（公開 2024-04-25）、`@emoji-mart/react` 1.1.1（公開 2023-01-02）、`@emoji-mart/data` 1.2.1（公開 2024-04-25）。すべて MIT |
| 依存・peer | `@emoji-mart/react` の peer：`react` が `^16.8 \|\| ^17 \|\| ^18`、`emoji-mart` が `^5.2`。**React 19 は peer の範囲外**（npm の登録情報）。React 19 対応の Issue #1027・#967・#1000 が未解決で、コメントに非公式のフォーク（`emoji-mart-ace`、5.6.1、公開 2025-11-20）の案内がある（公式ではない。採用しない前提で記録する） |
| サイズ | `emoji-mart` 展開後 1,630,702 バイト、`@emoji-mart/react` 7,108 バイト、`@emoji-mart/data` 27,937,216 バイト。データ（`sets/14/native.json`）は 428,805 バイト（gzip 約 82,245 バイト。私が計測） |
| Unicode の絵文字・データ | データは別パッケージ（本体に同梱するか、実行時に取得するかを選べる。README）。**Emoji 14 まで**（README「emojiVersion の最新は 14」）。新しい絵文字は出ない |
| 日本語 | `locale: 'ja'` と `@emoji-mart/data/i18n/ja.json`（画面の文言とカテゴリ名）あり。**検索のキーワードは英語のみ**（データの `keywords` が英語であることを確認。日本語での検索は未対応の可能性が高い。実機の確認は未実施） |
| 独自の項目（スタンプ用） | `custom`：カテゴリと絵文字の配列。GIF・SVG も可（README） |
| アクセシビリティ・スマートフォン | 未確認（ドキュメントに記載を確認できなかった） |
| 保守 | 最新コミット 2024-08-12、最終リリース 2024-04-25。スター 9,403、未解決 Issue 221、週間ダウンロード 3,250,901（`@emoji-mart/react` は 1,760,160）。公開済みのセキュリティ勧告なし |

### 4-5 自前の最小実装

| 項目 | 内容 |
| --- | --- |
| 構成案 | 絵文字データ（名前・検索語・カテゴリ・肌の色の差）を、日本語データ（Emojibase の `ja`、MIT。785,075 バイト／gzip 約 100,872 バイト。私が計測）から、ビルド時に必要な項目だけ取り出して自サイトに同梱し、React で一覧・カテゴリ・検索を作る。外部の通信は無い |
| 利点 | 外部の通信を出さない構成にしやすい・CSP を自分で決められる・スタンプを同じ一覧に自然に足せる・依存が増えない（データは `emojibase-data`（MIT、公開 2026-10-16、18.0.0）か、その JSON のコピー）。新しいライブラリの承認はデータ分だけで済む可能性がある（承認の要否は利用者が判断） |
| 負担・リスク | 次を自分で作り、WCAG 2.1 AA 相当（C-80）に合わせて試験・維持する必要がある：①多数の項目のグリッドのキーボード操作（矢印キー・Tab の位置の管理）、②スクリーンリーダー向けの名前・検索結果数の通知、③検索（日本語の読み・部分一致）、④仮想スクロール（約1,900件。emoji-picker-react の日本語データで計測した値）、⑤肌の色の選択、⑥OS が表示できない絵文字の除外（豆腐文字の防止）、⑦スマートフォンの画面幅（768px 未満）でのレイアウト。**実装量の見積もりは、根拠がないので書かない** |
| 判断の目安 | ライブラリの承認が得られない・CSP に合わない場合の代替案。まず上の候補をプロトタイプで試してから判断するのが安全 |

### 4-6 そのほかの候補（理由つき）

- `@ferrucc-io/emoji-picker`（0.1.2、公開 2026-08-17）：依存が多く（`jotai`・`tailwind-merge`・`@tanstack/react-virtual` 等。Tailwind CSS が前提の peer）、1.0 前で新しい。当プロジェクトのスタック（Tailwind 前提でない）に合わないため、比較から外す。
- `emojibase` / `emojibase-data`（18.0.0、公開 2026-10-16、MIT）：選択画面ではなく**データ**。自前実装・frimousse の自サイト配信で使う。`emojibase-data` は展開後 52,399,288 バイト（全言語を含む）で、必要な言語のファイルだけを使う想定。
- `unicode-emoji-json`（0.9.0）：英語名のみのデータで日本語に不向きのため、外す（日本語のデータを含むかは未確認）。

## ⑤ 比較表

| 観点 | emoji-picker-react 5.1.4 | emoji-picker-element 1.29.1 | frimousse 0.4.0 | emoji-mart 5.6.0 系 | 自前の最小実装 |
| --- | --- | --- | --- | --- | --- |
| ライセンス | MIT | Apache-2.0 | MIT | MIT | （自作＋データ MIT） |
| 最終リリース（公開日） | 2026-10-25（v5 は 2026-10-10 から） | 2026-03-01 | 2026-09-21 | 2024-04-25（react ラッパーは 2023-01-02） | — |
| 週間ダウンロード | 1,928,693 | 245,034 | 1,424,606 | 3,250,901 | — |
| 依存 | 1（`shipstyles`） | 0 | 0 | 0（react ラッパー・データは別パッケージ） | データ（`emojibase-data` 等） |
| データの出どころ | **同梱**（28言語） | **既定は外部 CDN**。自サイトに置ける | **既定は外部 CDN**。自サイトに置ける | 同梱または実行時に取得を選べる | 同梱（自作） |
| データの絵文字の版 | 追加バージョンの最大 16（計測） | 17（`-data` 1.8.0。計測） | 18（`emojibase-data` 18.0.0。計測） | Emoji 14 まで | 選んだデータによる |
| 日本語の検索・カテゴリ | あり（データで確認） | 画面：あり（`i18n/ja`）。検索語：`ja` データを指定 | データあり。画面の文言は自作 | 画面：あり。**検索語は英語のみ（計測）** | データ次第 |
| 日本語データのサイズ（gzip、計測） | 約 50,855 バイト（絵文字データ）。全体は未確認 | 約 63,581 バイト | 約 100,872 バイト | 検索語が英語の版で約 82,245 バイト | 約 100,872 バイト（Emojibase の場合） |
| スタンプ（独自画像）を同じ画面に | 方式A：あり（`customEmojis`＋`group`） | 方式A：あり（`customEmoji`＋`category`） | 方式A：**本体は未対応**（Issue #5）。方式B（共通の枠のタブで自作）なら可能で、その分の実装の負担がある | あり（`custom`） | 自然に足せる |
| アクセシビリティ | 組み込みと記載（自己申告）。実機未確認 | 組み込みと記載（自己申告）。実機未確認 | 属性あり（コードで確認）。実機未確認 | 未確認 | 自分で作って確かめる |
| スマートフォン | レイアウト調整可。実機未確認 | CSS で調整（README） | 列数・自作スタイル | 未確認 | 自分で作る |
| React 19・TS・Vite | React 16.8〜19、型あり | 独自要素（React 19 の Custom Elements 対応で使える） | React 18・19、型あり | **react ラッパーは React 19 が peer 外** | 問題なし |
| CSP（外部通信なし／インライン style） | データは外部通信なし。画像形式の絵文字（Apple 等）は既定で jsDelivr から取得（native 表示なら出ない）。`nonce` 対応と記載（未確認） | データは外部CDNも使わない方針を採って自サイトに置けば、外部通信なし。**インライン style 属性の問題あり（#505・#544）** | `emojibaseUrl` を自サイトにすれば外部通信なし。インライン style は未確認 | データを同梱すれば外部通信なし。未確認 | 自分で決められる |
| 既知の脆弱性（公開済みの勧告） | なし（API 空配列） | なし | なし | なし | — |
| リアクション向けの機能 | リアクションバーあり | なし（自作） | なし（自作） | なし（自作） | 自作 |

## ⑥ スタンプの方式の整理

スタンプは「固定一覧（自社で用意する画像または文字。外部APIに依存しない）」で、リアクションの値は固定一覧の識別子（EP-1-12、V-23）。ライブラリは必須ではない。

| 方式 | 内容 | 長所 | 短所・確認が要ること |
| --- | --- | --- | --- |
| A. ライブラリのカスタム絵文字に登録 | emoji-picker-react の `customEmojis`、emoji-picker-element の `customEmoji` に、スタンプの画像（自サイトの URL）と識別子を渡す。「スタンプ」の区分（グループ）にまとめる | 1つの選択画面で、検索・キーボード操作・区分の移動が絵文字と同じになる。実装が少ない | 画像のみ（文字だけのスタンプ「了解」は、文字を画像（SVG 等）にするか、ライブラリが対応しているかを確かめる必要がある。未確認）。ライブラリごとに ID の持ち方が違い、V-23 の識別子との対応を決める必要がある |
| B. 枠（ポップオーバー）に「絵文字」「スタンプ」のタブを置き、スタンプのタブを自前で作る | 絵文字はライブラリ（または自前）、スタンプは固定一覧を `<button>` のグリッドで表示。選択画面の枠は1つ（「同じ選択画面にまとめる」C-60 を、同じ画面内のタブとして満たす） | 文字・画像どちらのスタンプも自由に表示できる。ライブラリの制約（画像のみ等）を受けない。frimousse のようにカスタム非対応のライブラリでも使える | スタンプのタブの検索・キーボード操作・読み上げ名を自分で作り、WCAG 2.1 AA 相当（C-80）に合わせる必要がある。「同じ選択画面」が「タブ切り替え」でよいか、1つの一覧に並べたいかは利用者の判断（⑧） |
| C. スタンプも Unicode の絵文字・文字で構成 | 「了解」等を絵文字（👍 等）や文字列で表す（画像を使わない） | 素材のライセンス・用意が不要 | 「スタンプ」と「絵文字」の差が無くなる。要件（スタンプは自社で用意する画像または文字）の範囲内かの確認が要る |

利用者が決めること（素材そのものの選定は、この調査の範囲外）：

- 素材の出どころ（自社の制作・外注・ライセンスのある素材集など）と、そのライセンス（商用利用・改変・再配布）。
- 画像の形式（SVG／PNG／GIF）・大きさ・数（固定一覧の件数）。1メッセージに付けられるリアクションは20種類まで（C-90）であることとの関係。
- 画像の置き場所（案：自サイトの静的ファイル。外部CDNも使わない方針を採る場合はこの形になる）。その場合、画像は `img-src 'self'` で足りる想定。
- 代替テキスト（画像のスタンプの読み上げ名。アクセシビリティ）。
- 文字だけのスタンプを認めるか。

## ⑦ 未確認・不確かなこと

確認できなかったことは、記憶で埋めず、ここに書く。

1. **各ライブラリの実機での動作**：この調査ではインストールしていないため、Vite 8・React 19.3.0・TypeScript 6.0.3 での組み込み、ビルド後の実際の配信サイズ（特に emoji-picker-react は tarball が 24MB で、日本語だけを組み込めるか、ツリーシェイクが効くか）は未確認。
2. **アクセシビリティ**：どの候補も、キーボード操作・スクリーンリーダーの対応は、作者の記載（と属性の有無）に基づく。WCAG 2.1 AA 相当（C-80）を満たすかは、実際に読み上げソフトで確かめていない。emoji-picker-react の README の比較表は作者自身（同ライブラリの作者）が書いたものである。
3. **スマートフォン（768px 未満）のタッチ操作・レイアウト**：実機・エミュレータで未確認。
4. **CSP との関係**：このプロジェクトの CSP の具体的な設定（`style-src` で `'unsafe-inline'` を許すか、`nonce` を使うか）は、Skill「security」には「CSPヘッダーを設定する」「`frame-ancestors 'none'`」とあるだけで、`style-src` の方針は確認できなかった。emoji-picker-react の `nonce` 対応（README の記載）、frimousse・emoji-picker-react のインライン style の使い方は、実際の CSP で未確認。emoji-picker-element は Issue #505・#544 の報告を根拠に、厳しい CSP では要注意とした（このプロジェクトの CSP で再現するかは未確認）。
5. **emoji-picker-react の安定性**：v5 は 2026-10-10 公開で、2週間で6回の更新がある。今後も API が動く可能性がある。保守の継続性（メンテナの体制は未確認）は、GitHub Sponsors の記載以外に確認できていない。
6. **emoji-picker-react のデータの Emoji の版**：データの追加バージョンの最大値は 16 だが、Emoji のどの版（15.1・16.0 など）に当たるかは未確認。emoji-picker-element のデータは `-data` 1.8.0（2025-11-19）で、最大 17（計測）。
7. **emoji-mart の日本語検索**：データの `keywords` が英語であることは確認したが、`ja` ロケールで日本語の検索語が使えるかを実機で試していない。
8. **frimousse の CSP・インライン style**、`localStorage`／`sessionStorage` の使い方（キャッシュ）は、ビルド済みのコードで使用を確認しただけで、保存する内容は未確認。
9. **脆弱性**：GitHub Security Advisories（公開済みのもの）の API で、5つのリポジトリすべてが空だった。これは「公開された勧告がない」ことの確認であり、「脆弱性がない」ことの確認ではない。`npm audit` は、インストールしていないため未実施。Snyk 等の別のデータベースは未確認。
10. **週間ダウンロード数**は npm API の1週間の値で、ほかのライブラリからの再利用（react ラッパー等）を含む。
11. **スタンプを文字（テキスト）で表すとき**の、各ライブラリの対応（カスタム絵文字が画像のみか）は、ドキュメントで確認できなかった。
12. **リアクションの表示側**（メッセージの下に並べるチップの表示）は選択画面と別の部品で、ライブラリの対象外。Unicode の絵文字は OS・ブラウザによって見た目が違い、古い環境で表示できない絵文字がありうる（各ライブラリの「表示できない絵文字を隠す機能」は作者によれば推測に基づく判定で、完全ではない。emoji-picker-react の README に「検出の限界」の記載あり。詳細は未確認）。

## ⑧ 次に利用者が決めること（質問の素案）

1. **方針**：絵文字の選択画面は、(a) emoji-picker-react を第一候補にしてプロトタイプで確かめる、(b) emoji-picker-element を第一候補にする、(c) 自前の最小実装にする、のどれにするか。承認は2段階に分ける（質問7）。
2. **同じ選択画面の形**：「絵文字」と「スタンプ」を、(1) 1つの一覧に区分（カテゴリ）として並べる（方式A）、(2) 同じ枠の中のタブで切り替える（方式B）のどちらにするか。
3. **スタンプの内容**：画像だけか、文字だけのスタンプも認めるか。件数の目安は。素材の出どころ・ライセンス・用意の担当は（⑥）。
4. **データの置き場所**：絵文字データは、アプリに同梱する（emoji-picker-react・自前）か、自サイトの静的ファイルとして配信する（emoji-picker-element・frimousse）か。外部 CDN も使わない（外部通信なし）ことを、要件として決めるか（現行の C-58・V-23 は「外部APIに依存しない」まで）。画像形式の絵文字を使う場合の画像の置き場所も合わせて決める。
5. **CSP の方針**：`style-src` に `'unsafe-inline'` を許さず `nonce` を使うか（C-58・V-23 は「外部APIに依存しない」まで。外部CDNも使わない（外部通信なし）かどうかは、質問4で決める。Skill「security」・`security.ts` の設定として別の Issue で決める）。
6. **バージョンの固定**（承認後に `docs/tech-stack.md` に記録。`^`・`~` は使わない）の案：
   - `emoji-picker-react` 5.1.4（第一候補。v5 は新しいため、実装を始める日に、最新の安定版を再確認する）
   - `emoji-picker-element` 1.29.1（＋日本語データを自サイトに置く場合は `emoji-picker-element-data` 1.8.0）
   - `frimousse` 0.4.0（採用する場合。0.x のため固定が必須）
   - `emoji-mart` 5.6.0・`@emoji-mart/react` 1.1.1・`@emoji-mart/data` 1.2.1（非推奨。React 19 の peer の範囲外のため、採用する場合は peer の扱いも要確認）
7. **導入の承認（2段階）**：(1) **検証用の導入の承認**：指定した固定バージョン（⑧-6の案。第一候補 `emoji-picker-react` 5.1.4 など）を、使い捨てのプロトタイプ（`prototype/` とは別の場所）に入れて、日本語検索・キーボード操作・スマートフォン表示・CSP・リアクション（20種類の上限）を確かめることを承認するか。(2) **検証後の本採用の承認**：結果を見て、本番のコードに追加（`docs/tech-stack.md` に記録）することを、改めて承認するか。AGENTS.md・C-60 のとおり、どちらも追加の前に利用者の承認を得る。

## ⑨ 出典の一覧

取得日はすべて 2026-10-29。

### npm レジストリ（`npm view`・npm API）

- emoji-picker-react：https://www.npmjs.com/package/emoji-picker-react （`npm view emoji-picker-react@5.1.4 version time.modified license dependencies peerDependencies dist.unpackedSize`。`time` の版ごとの公開日）
- emoji-picker-element：https://www.npmjs.com/package/emoji-picker-element
- emoji-picker-element-data：https://www.npmjs.com/package/emoji-picker-element-data
- frimousse：https://www.npmjs.com/package/frimousse
- emoji-mart：https://www.npmjs.com/package/emoji-mart
- @emoji-mart/react：https://www.npmjs.com/package/@emoji-mart/react
- @emoji-mart/data：https://www.npmjs.com/package/@emoji-mart/data
- emoji-mart-ace（非公式のフォーク）：https://www.npmjs.com/package/emoji-mart-ace
- emojibase・emojibase-data：https://www.npmjs.com/package/emojibase-data
- unicode-emoji-json：https://www.npmjs.com/package/unicode-emoji-json
- @ferrucc-io/emoji-picker：https://www.npmjs.com/package/@ferrucc-io/emoji-picker
- 週間ダウンロード数：https://api.npmjs.org/downloads/point/last-week/<パッケージ名>（期間 2026-10-21〜10-27）
- 絵文字データの計測：https://cdn.jsdelivr.net/npm/emojibase-data@18.0.0/ja/data.json 、https://cdn.jsdelivr.net/npm/emojibase-data@18.0.0/ja/messages.json 、https://cdn.jsdelivr.net/npm/emoji-picker-element-data@1.8.0/ja/emojibase/data.json 、https://cdn.jsdelivr.net/npm/@emoji-mart/data@1.2.1/sets/14/native.json 、https://cdn.jsdelivr.net/npm/@emoji-mart/data@1.2.1/i18n/ja.json
- tarball の中身（`npm pack` で一時フォルダに取得して確認。プロジェクトには入れていない）：emoji-picker-react@5.1.4（`dist/data/emojis-ja.json`・`dist/index.js`）、frimousse@0.4.0（`dist/index.js`・`dist/index.d.ts`）、emoji-picker-element@1.29.1（`i18n/ja.js`・`picker.js`）

### GitHub（リポジトリ・README・Issue）

- https://github.com/ealush/emoji-picker-react （README、CUSTOMIZATION.md：https://github.com/ealush/emoji-picker-react/blob/master/CUSTOMIZATION.md 、docs/v5/COMPARISON.md）
- https://github.com/nolanlawson/emoji-picker-element （README）／Issue #505・#544・#401：https://github.com/nolanlawson/emoji-picker-element/issues/505 、…/issues/544 、…/issues/401
- https://github.com/liveblocks/frimousse （README）／Issue #5「Support custom emojis」：https://github.com/liveblocks/frimousse/issues/5
- https://github.com/missive/emoji-mart （README）／Issue #1027・#967・#1000：https://github.com/missive/emoji-mart/issues/1027 、…/issues/967 、…/issues/1000
- https://github.com/milesj/emojibase
- リポジトリの状況・勧告：`gh api repos/<owner>/<repo>`、`…/security-advisories`、`…/releases`、`…/commits`（5つのリポジトリ）

### 公式ドキュメント・そのほか

- frimousse のドキュメント：https://frimousse.liveblocks.io/
- emoji-picker-element の作者の記事（アクセシビリティ）：https://nolanlawson.com/2020/07/01/building-an-accessible-emoji-picker/
- React 19 の Custom Elements 対応：https://react.dev/blog/2024/12/05/react-19
- Emojibase：https://emojibase.dev/

### このプロジェクトの文書

- `docs/requirements/decision-register.md`（C-58・C-60・C-80・C-90・Q-24）
- `docs/requirements/01-messaging.md`（1-5・1-7）
- `docs/requirements/api-draft.md`（V-19・V-23・EP-1-12）
- `docs/requirements/screens.md`（S-05）
- `docs/requirements/nonfunctional.md`（XSS・アクセシビリティ）
- `docs/tech-stack.md`、`.claude/skills/security/SKILL.md`
- GitHub Issue #92
