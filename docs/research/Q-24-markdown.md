# Q-24 ライブラリの選定：マークダウンの整形表示

## 1. 目的と範囲

- Issue #92 の調査範囲「1. マークダウンの整形表示」のライブラリ候補を調べ、比較する。決定はしない。選定は、利用者との質問（「8. 次に利用者が決めること」）で行う
- 対象の要件：C-58・C-60、1-5 AC-1〜AC-3、V-19、S-05（要件定義書 `docs/requirements/` の該当箇所）
  - 太字・斜体・取り消し線・箇条書き・引用・インラインコード・コードブロック・リンクに対応する
  - HTML・スクリプトは実行しない（1-5 AC-3）
  - 入力中のプレビューは設けず、投稿後に整形表示する
  - メッセージ本文は 1〜4,000 文字（V-18）。メンション（@表示名。1-8）・Unicode 絵文字と共存する
- 前提：主にブラウザ（React 19.3.0・Vite 8・TypeScript 6）で整形表示する。サーバー（Workers）は本文を保存・配信する
- 範囲外：インストール、コードの変更、`docs/tech-stack.md` の更新、絵文字・スタンプの調査（別ファイル `Q-24-emoji-sticker.md`）
- 守る規則：Skill「security」の「入力チェック・XSS」（画面への出力は自動エスケープに任せ `dangerouslySetInnerHTML` を原則使わない／利用者が入力した URL は `http:`・`https:` など許可したスキームだけ／CSP を設定する）。AGENTS.md（バージョンは固定。`^`・`~`・`latest` を使わない。新ライブラリは承認なしに追加しない）

## 2. 調べた日

2026-10-29（`date +%F` で確認）。npm は `npm view`、ダウンロード数は npm の API、脆弱性は GitHub の Security Advisories（`gh api repos/<repo>/security-advisories`）、サイズは bundlephobia の API で取得した。

## 3. 結論（要点）

決定ではなく、推奨案である。

1. **推奨案（第1候補）：`react-markdown` 10.1.0 ＋ `remark-gfm` 4.0.1**。理由は次のとおり
   - 公式の README が「secure by default」「`dangerouslySetInnerHTML` を使わない」と説明している。生 HTML は既定でエスケープされ、`rehype-raw` を足さない限り実行されない（出典 R1）。Skill「security」の「`dangerouslySetInnerHTML` を原則使わない」にそのまま合う
   - 出力が React 要素なので、リンクの属性（`rel`・`target`）の付与、メンション（@表示名）の表示部品への差し替えを、`components` で書ける
   - 取り消し線は `remark-gfm` が要る（CommonMark には無い）。箇条書き・引用・インラインコード・コードブロック・リンク・太字・斜体は CommonMark の標準で足りる
   - 利用数が多い（react-markdown：週 43,222,430 件、remark-gfm：週 52,369,391 件。2026-10-21〜27）。GitHub の公開済みの脆弱性情報は、react-markdown・remark-gfm・rehype-sanitize には 0 件。依存の `mdast-util-to-hast` には 2025-12-01 公開の advisory が 1 件あり、13.2.1 で修正済み（9 章の ⑥参照）
   - 弱点：依存が多い（react-markdown の直接の依存 11 個）。バンドルが大きめ（目安の gzip 後 約 34KB と約 10KB。未確認の点あり）。react-markdown 10.1.0 の公開は 2025-03-07 で、最新版から約 1 年 7 か月が経つ（ただし 2026-10-03 にリポジトリへのコミットがある）
2. **有力な代替案：自前の最小実装**（必要な書式が 8 種類と少ない。React 要素を直接作るので HTML 文字列を扱わない）。依存が増えず軽い反面、入れ子・エスケープ・コードブロック内の扱いなどの網羅とテストの負担が大きく、仕様の細部（CommonMark との違い）を自分で持つ。ライブラリを入れたくない場合の選択肢
3. **次点：`micromark` ＋ `mdast-util-from-markdown` ＋ `mdast-util-gfm-strikethrough`（自前で React にする）**。react-markdown の中身と同じ部品を直接使う。軽量化できる可能性があるが、サイズ・性能は未測定。安全性は自前の変換と URL の検査に依存する。mdast から React への変換は自前になる
4. **推奨しない**：
   - `marked`（＋DOMPurify）：marked は出力 HTML をサニタイズしない（公式が明記。出典 R6）。HTML 文字列を `dangerouslySetInnerHTML` で入れる形になり、Skill「security」に反する。DOMPurify は 2026 年だけで多数の advisory が出ている（ほとんど low〜medium。9 章の ③参照）
   - `markdown-it`：HTML を有効にしない既定なら安全（公式。出典 R8）だが、出力が HTML 文字列で、`dangerouslySetInnerHTML` が要る。2026-05〜10 に DoS 系の advisory が 5 件続いている（うち 2 件は high）
5. どの案でも、**投稿時にサーバーで本文の長さ（V-18：4,000 文字）を検査し、画面側でも極端に長い・入れ子の深い本文で重くならないことをテストする**。サーバー側で整形・サニタイズはしない（保存は元の本文のまま。理由は 7 章）

## 4. 候補ごとの調査結果

### 4-1. react-markdown ＋ remark-gfm（＋ rehype-sanitize）

| 項目 | 内容 |
| --- | --- |
| 最新の安定版 | react-markdown 10.1.0（2025-03-07 公開）、remark-gfm 4.0.1（2025-02-10 公開）、rehype-sanitize 6.0.0（2023-08-26 公開。`time.modified` は 2023-11-20） |
| ライセンス | MIT（3 つとも） |
| 依存（直接） | react-markdown：11 個（`@types/hast`・`@types/mdast`・`devlop`・`hast-util-to-jsx-runtime`・`html-url-attributes`・`mdast-util-to-hast`・`remark-parse`・`remark-rehype`・`unified`・`unist-util-visit`・`vfile`）。remark-gfm：6 個。rehype-sanitize：2 個（`@types/hast`・`hast-util-sanitize`） |
| インストールサイズ（`dist.unpackedSize`） | react-markdown 52,637 B、remark-gfm 21,993 B、rehype-sanitize 20,789 B（自身だけ。依存は含まない） |
| バンドルの目安（bundlephobia） | react-markdown 10.1.0：minify 113,614 B／gzip 34,090 B（依存込み）。remark-gfm：30,414 B／gzip 9,811 B。rehype-sanitize：8,009 B／gzip 3,281 B。いずれも bundlephobia の算出値で、実際のバンドルの測定ではない |
| 利用数 | 週 43,222,430（react-markdown）／52,369,391（remark-gfm）／15,210,309（rehype-sanitize）。2026-10-21〜27 |
| 保守 | メンテナは unified の組織（remarkjs）。react-markdown のリポジトリの最新コミット 2026-10-03。GitHub の Releases 機能での最新リリースは 2025-03-07。rehype-sanitize の最新コミット 2023-11-20、remark-gfm は 2025-02-10（出典 R9）。更新が少ないのは、部品が小さく安定しているためとも読めるが、理由は未確認 |
| 必要な書式 | 太字・斜体・箇条書き・引用・インラインコード・コードブロック・リンクは標準（CommonMark）。**取り消し線は `remark-gfm` が必要**。`remark-gfm` は表・タスクリスト・自動リンク（URL をそのままリンクにする）・脚注も有効にする。要件にない表・脚注は `allowedElements` などで描画しない設計にできる（細部は実装時に確認） |
| HTML・スクリプト | README の記載：「Use of `react-markdown` is secure by default」「no `dangerouslySetInnerHTML` or XSS attacks」。生 HTML は既定でエスケープされる（Appendix A）。`rehype-raw`（約 60KB minzipped）を足したときだけ生 HTML を解釈する。`skipHtml` で HTML を完全に無視もできる。`urlTransform` の既定は許可するスキームだけ（`http`・`https`・`irc`・`ircs`・`mailto`・`xmpp`、相対 URL）で、`javascript:` は通らない。`urlTransform` を危険な関数に置き換えると XSS になる、と明記されている（出典 R1） |
| rehype-sanitize の要否 | 生 HTML を有効にしない限り、既定のままで要件を満たす。`rehype-sanitize`（既定は GitHub のサニタイズに倣う）は、プラグインやカスタム部品で危険な出力が混じる場合の**二重の防御**。生 HTML を使わない設計なら必須ではない。入れる場合は、スキーマの許可リストを自分で絞れる（出典 R1・R10） |
| 画像 | 要件に画像のマークダウン（`![]()`）はない。既定では `<img>` を描画しうる（外部 URL を読み込むと、閲覧者の IP が外部に送られる）。要否の判断が必要（8 章） |
| リンクの属性 | README に `rel`・`target` の記載はない（出典 R1 の取得結果）。`components={{ a: ... }}` で `<a>` を差し替え、`rel="noopener noreferrer"`・`target="_blank"` を付ける形になる |
| メンション・絵文字 | 絵文字（Unicode の文字）は本文のテキストなのでそのまま表示される。メンションは `remarkPlugins` に自前のプラグインを足す（テキストの `@表示名` を独自のノードに変える）か、`components` で描画する形。表示名の重複を認める（1-8 AC-1）ため、本文の `@表示名` だけでなく API の `mentionUserIds` との突き合わせが必要で、これはどの候補でも同じ |
| 既知の脆弱性 | react-markdown・remark-gfm・rehype-sanitize・hast-util-sanitize・remark の本体（`remark-parse` の元の micromark）のリポジトリに、公開済みの Security Advisory はない（出典 R11）。依存の `mdast-util-to-hast` に GHSA-4fh9-h7wg-q85m（CVE-2025-66400、medium、2025-12-01、13.0.0〜13.2.0 が影響、13.2.1 で修正：クラス属性の未処理）がある。react-markdown 10.1.0 は `^13.0.0` を依存に指定するので、最新の 13.2.1 に解決される（`npm view mdast-util-to-hast version` が 13.2.1）。ロックファイルで 13.2.1 以上を確かめる |
| React 19・TypeScript・Vite | peerDependencies は `react >=18`・`@types/react >=18`。型は同梱（`index.d.ts`）。ESM のみで、Vite で扱える（動作は実装時に確認。未確認） |
| 描画の軽さ | 内部で解析→構文木の変換→React 要素の生成を行う。一覧に大量のメッセージを出すとき、メッセージごとに実行される。測定はしていない（未確認）。`React.memo`・仮想化（画面外を描画しない）・長い本文の折りたたみで抑える設計が必要 |
| 推奨する固定バージョンの案 | `react-markdown` **10.1.0**、`remark-gfm` **4.0.1**、（入れる場合）`rehype-sanitize` **6.0.0**。いずれも 2026-10-29 時点の最新の安定版（`npm view`）。固定する際は `^`・`~` を付けない |

### 4-2. marked ＋ DOMPurify

| 項目 | 内容 |
| --- | --- |
| 最新の安定版 | marked 18.1.2（`time.modified` 2026-10-26。GitHub の最新リリース公開 2026-10-26）、dompurify 3.4.17（`time.modified` 2026-10-12） |
| ライセンス | marked：MIT。dompurify：(MPL-2.0 OR Apache-2.0)（選べる二重ライセンス） |
| 依存 | marked：なし。dompurify：`@types/trusted-types` のみ |
| インストールサイズ | marked 533,908 B、dompurify 1,615,512 B（`dist.unpackedSize`。配布物全体） |
| バンドルの目安（bundlephobia） | marked：47,234 B／gzip 14,171 B。dompurify：29,221 B／gzip 11,494 B。合計の gzip 約 25.7KB（単純な足し算） |
| 利用数 | marked 週 97,324,297、dompurify 週 79,415,103（2026-10-21〜27） |
| 必要な書式 | 取り消し線・箇条書き・引用・コードブロック等は、既定で GFM（`gfm: true`）に対応するとみられるが、既定値は一次情報で確認できていない（未確認） |
| HTML・スクリプト | **marked は出力 HTML をサニタイズしない**。README の警告：「Marked does not sanitize the output HTML. Please use a sanitize library, like DOMPurify (recommended)…on the *output* HTML!」（出典 R6）。生 HTML は出力に残るため、DOMPurify 等が必須。出力が HTML 文字列なので、React では `dangerouslySetInnerHTML` を使うことになり、Skill「security」の原則（使わない）に反する。例外として運用する場合は、ルールの扱いを利用者が決める必要がある（8 章） |
| DOMPurify の挙動 | 要素・属性の許可リストで HTML を浄化する。`javascript:` URL や `on*` 属性の除去は DOMPurify の役割だが、その既定の挙動を一次情報で確認していない（未確認）。ブラウザの DOM に依存する（Workers など DOM のない環境では別途 jsdom 等が要る） |
| 既知の脆弱性 | marked：4 件（GHSA-6v9c-7cg6-27q7＝CVE-2026-41680 high、2026-04-23、18.0.0・18.0.1 が影響、18.0.2 で修正：不正な入力でメモリ枯渇／過去の ReDoS 3 件 2021・2022 年、いずれも修正済み）。DOMPurify：2026 年 3〜10 月だけで 25 件以上（大半が low〜medium。XSS につながる回避が複数含まれる。例：GHSA-87xg-pxx2-7hvx＝CVE-2026-47423 high、2026-05-19、3.4.4 が影響、3.4.5 で修正）。最新の 3.4.17 は、公開済みの最新の advisory（2026-10-12）の修正版。2024 年には critical 2 件（CVE-2024-48910・CVE-2024-47875。修正済み）（出典 R12・R13） |
| React・TypeScript・Vite | 型は同梱。ESM（`"type": "module"`）。Node 20 以上（`engines`）。React との連携は HTML 文字列を入れる形のみ |
| リンクの属性 | `renderer` のフックで `rel`・`target` を付ける、または DOMPurify の hook で付ける。後処理が必要 |
| メンション | marked の拡張（`marked.use({ extensions })`）で書ける（公式ドキュメントに拡張の仕組みがある）。出力が HTML 文字列なので、メンションを React の部品で描画するのは難しい |
| 推奨する固定バージョンの案（採用する場合） | marked **18.1.2**、dompurify **3.4.17**。DOMPurify は更新が頻繁なので、依存の更新の運用が要る |

### 4-3. markdown-it（＋サニタイズの方法）

| 項目 | 内容 |
| --- | --- |
| 最新の安定版 | 15.0.3（`time.modified` 2026-10-16） |
| ライセンス | MIT |
| 依存 | 6 個（`mdurl`・`argparse`・`entities`・`uc.micro`・`linkify-it`・`punycode.js`） |
| インストールサイズ | 2,064,760 B（`dist.unpackedSize`） |
| バンドルの目安（bundlephobia） | 98,152 B／gzip 40,794 B（依存込み） |
| 利用数 | 週 31,937,927（2026-10-21〜27） |
| 必要な書式 | プリセットごとに有効な規則が違う。既定のプリセットで取り消し線（`~~`）が有効かは、一次情報で確認できていない（未確認）。コアの CommonMark の書式（太字・斜体・箇条書き・引用・コード・リンク）は標準 |
| HTML・スクリプト | 公式の Safety の文書：HTML を有効にしない（既定）なら、サニタイザなしでも出力は安全。さらに既定で `javascript:`・`vbscript:`・`file:`・`data:`（gif/png/jpeg/webp の画像を除く）のリンクを禁止する。HTML を有効にする場合は外部のサニタイザが要る（出典 R8）。ただし出力が HTML 文字列のため、React では `dangerouslySetInnerHTML` が要る。React 要素に直接変換するには、トークン列（`md.parse()`）を自前で React に変換する必要がある |
| 既知の脆弱性 | 6 件。2026-05〜10 に 5 件（すべて DoS 系：smartquotes・linkify・リンク参照定義・インライン HTML。うち GHSA-gfr2-rv44-r23c＝CVE-2026-111758 high、2026-10-16、15.0.0〜15.0.2 が影響、15.0.3 で修正。GHSA-r7fv-28h4-cvq7＝CVE-2026-111759 high、2026-09-12、15.0.2 で修正）。XSS の advisory は一覧になかった。公開から日が浅い DoS の修正が続いており、2026-10-16 の修正以降の動向は未確認（出典 R14） |
| React・TypeScript・Vite | 型は同梱（`dist/markdown-it.d.cts`）。React 向けの公式部品はない |
| リンクの属性 | `renderer.rules.link_open` を書き換える（公式ドキュメントに例がある。細部は未確認） |
| メンション | プラグインで書ける。HTML 文字列に出力するため、React の部品との統合は難しい |
| 推奨する固定バージョンの案（採用する場合） | **15.0.3**（2026-10-16 の high の修正を含む最低の版） |

### 4-4. micromark（＋mdast／自前のレンダリング）

| 項目 | 内容 |
| --- | --- |
| 最新の安定版 | micromark 4.0.3（`time.modified` 2026-09-26）、`mdast-util-from-markdown` 2.1.0（2026-10-03）。取り消し線は `micromark-extension-gfm-strikethrough` 2.1.0（2024-07-05）と `mdast-util-gfm-strikethrough`（バージョン未確認）、または `micromark-extension-gfm`・`mdast-util-gfm` |
| ライセンス | MIT |
| 依存 | micromark：18 個（小さい部品の集まり）。`mdast-util-from-markdown`：11 個 |
| インストールサイズ | micromark 209,945 B、`mdast-util-from-markdown` 105,775 B（`dist.unpackedSize`） |
| バンドルの目安（bundlephobia） | micromark：53,354 B／gzip 15,168 B（依存込み） |
| 利用数 | micromark 週 73,068,999（2026-10-21〜27） |
| 必要な書式 | CommonMark の書式は標準。取り消し線は GFM の拡張が必要 |
| HTML・スクリプト | README：「micromark makes any markdown safe by default」。`allowDangerousHtml`・`allowDangerousProtocol` を有効にすると XSS の恐れがある（既定値の数値は README の取得結果に明記なし）。`javascript:`・`data:` のリンクは「エンコードまたは削除」される。「入力の大きさに上限を設けるのが賢明」と DoS への注意が書かれている（出典 R15）。HTML 出力を使えば `dangerouslySetInnerHTML` が要る。mdast（構文木）を取り、React 要素に自前で変換すれば不要だが、その変換（URL の許可リストを含む）の安全性は自前の責任 |
| 既知の脆弱性 | micromark・`mdast-util-from-markdown` のリポジトリに公開済みの Security Advisory はない（出典 R11） |
| React・TypeScript・Vite | 型は同梱。ESM。React の部品はなく、自前 |
| リンクの属性・メンション | 構文木を自前で React にするので自由に書ける |
| 位置づけ | react-markdown の下の部品を直接使う形。react-markdown との違いは、構文木→React の変換と URL の変換を自前で持つ点 |
| 推奨する固定バージョンの案（採用する場合） | micromark **4.0.3**、`mdast-util-from-markdown` **2.1.0**、取り消し線の拡張は採用時に `npm view` で最新を確認する |

### 4-5. 自前の最小実装

| 項目 | 内容 |
| --- | --- |
| 内容 | 対応する書式（太字 `**`、斜体 `*`、取り消し線 `~~`、箇条書き `-`、引用 `>`、インラインコード、コードブロック、リンク）だけを、自前の解析関数で React 要素（`<strong>`・`<em>`・`<del>`・`<ul>`・`<blockquote>`・`<code>`・`<pre>`・`<a>`）に変換する。HTML 文字列を作らず、すべて React の自動エスケープに任せる |
| 良い点 | 依存が増えない。バンドルが小さい。安全性の範囲を自分で閉じられる（許可する要素が 8 種類に限られ、URL は `http:`・`https:`（・`mailto:` が要るか）の許可リストで検査できる）。メンション・絵文字との統合が自由。ライブラリの advisory に追従する運用が要らない |
| 悪い点 | CommonMark の細部（入れ子の強調、コードブロックの囲み、箇条書きの入れ子、エスケープ `\*`、行頭・行末の扱い）の網羅とテストが必要。利用者が他のツール（Slack・GitHub）の記法に慣れていると、細部の違いで不満が出うる。ReDoS・計算量の爆発を自分で作り込むおそれがある。Skill「実装の進め方」の方針（要求を満たす一番単純な方法）では、自前の実装の量と、ライブラリを入れる量のどちらが単純かの判断が要る |
| 参考になるもの | `snarkdown` 2.0.0（MIT、依存なし、`dist.unpackedSize` 39,999 B。最終の公開 2022-06-26）のような極小のライブラリは、HTML 文字列を出力し、メンテナンスも止まっているため、推奨しない（保守状況の根拠は `npm view` の公開日のみで、安全性は未確認） |
| 推奨する固定バージョンの案 | 該当なし（ライブラリを追加しない） |

### 4-6. ほかの候補（理由つき）

- **`markdown-to-jsx` 9.10.4**（MIT、`time.modified` 2026-10-28、週 5,243,253 件、`dist.unpackedSize` 5,027,507 B）：React 向けで、HTML 文字列を使わない。ただし `peerDependencies` に `vue`・`solid-js` が並ぶ（複数のフレームワーク対応）、配布物のサイズが大きく、GitHub の advisory は 0 件だが、一次情報（安全性の説明）を確認していない。react-markdown より利用数が約 1/8 で、既に確立した react-markdown を差し置く理由が見つからなかったため、参考にとどめる（未確認事項あり）
- **`commonmark`（commonmark.js）0.31.2**（BSD-2-Clause、最終の公開 2024-09-19）、**`remarkable` 2.0.1**（MIT、最終の公開 2022-06-26）：更新が古い、または止まっている。調査の対象外とした（理由は更新状況のみ。個別の脆弱性は未確認）
- **`@lezer/markdown` 1.8.1**：エディタ向けの構文解析で、HTML・React への変換は含まない。用途が違うため対象外

## 5. 比較表

| 観点 | react-markdown＋remark-gfm | marked＋DOMPurify | markdown-it | micromark＋自前の React 化 | 自前の最小実装 |
| --- | --- | --- | --- | --- | --- |
| 必要な書式の充足 | ○（取り消し線は remark-gfm が必要） | ○（GFM の既定値は未確認） | ○（取り消し線の既定は未確認） | ○（取り消し線は GFM の拡張が必要） | ○（自前で網羅が必要） |
| 出力の形 | React 要素 | HTML 文字列 | HTML 文字列（トークン列から自前で React 化も可） | mdast→自前で React 要素 | React 要素 |
| `dangerouslySetInnerHTML` | 不要 | 必要 | 必要（既定の使い方） | 不要（自前の変換なら） | 不要 |
| 生 HTML の既定 | 実行しない（エスケープ） | **そのまま出力。サニタイズが必須** | 無効（既定） | 無効（既定） | 解釈しない |
| `javascript:` 等の URL | 既定で許可リスト | DOMPurify に依存（既定は未確認） | 既定で禁止（`javascript:`・`vbscript:`・`file:`・`data:` の一部） | 「エンコードまたは削除」（README） | 自前の許可リスト |
| 最新版の公開日（`npm view <pkg> time` の版ごとの日付） | react-markdown 2025-03-07／remark-gfm 2025-02-10 | marked 2026-10-26／dompurify 2026-10-12 | 2026-10-16 | micromark 2026-09-26 | - |
| 公開済みの脆弱性（GitHub） | 本体 0 件。依存 `mdast-util-to-hast` に 1 件（13.2.1 で修正） | marked 4 件、DOMPurify 25 件以上（2026 年が大半） | 6 件（2026 年に 5 件、DoS 系） | 0 件 | 自前 |
| ライセンス | MIT | MIT／(MPL-2.0 OR Apache-2.0) | MIT | MIT | - |
| 依存の数（直接） | 11＋6＋2 | 0＋1 | 6 | 18（micromark）＋11 | 0 |
| bundlephobia の gzip の目安 | 34.1KB＋9.8KB（＋3.3KB） | 14.2KB＋11.5KB | 40.8KB | 15.2KB（＋mdast・変換） | 自前の量による |
| 利用数（週） | 4,322 万／5,237 万 | 9,732 万／7,942 万 | 3,194 万 | 7,307 万 | - |
| React 19・TS・Vite | 問題なしと読める（peer `react >=18`、型同梱。動作は未確認） | 型同梱。React は HTML 文字列 | 型同梱。React は HTML 文字列 | 型同梱。React 化は自前 | 問題なし |
| リンクの `rel`・`target` | `components` の `a` で付与 | renderer／DOMPurify の hook | `link_open` を書き換え | 自前 | 自前 |
| メンション・絵文字 | remark プラグイン／`components`。絵文字はそのまま | 拡張（HTML 文字列） | プラグイン（HTML 文字列） | 構文木で自由 | 自由 |
| 描画の軽さ（一覧） | 未測定。メモ化・仮想化が要る | 解析は速いとされる（marked の説明文。測定は未確認）。DOMPurify の分が加わる | 未測定 | 未測定 | 自前の実装次第 |
| Skill「security」との整合 | ○ | △（`dangerouslySetInnerHTML` が必要） | △（同上） | ○ | ○ |

## 6. セキュリティの整理（C-58「HTML・スクリプトは実行しない」の満たし方）

### 6-1. 守るべき要件・規則

- C-58・1-5 AC-3：HTML・スクリプトを書いても実行されない
- Skill「security」：画面への出力は React の自動エスケープに任せる。`dangerouslySetInnerHTML` を原則使わない。利用者が入力した URL は許可したスキームだけ。CSP を設定する
- 入力チェックはバックエンドで行う（V-18 の長さ）。表示のサニタイズは画面側で行う

### 6-2. サニタイズの方式の選択肢

| 方式 | 内容 | 長所 | 短所 |
| --- | --- | --- | --- |
| A. 生 HTML を解釈しない（既定）＋要素の許可リスト | react-markdown の既定（HTML はエスケープ）。`allowedElements` で許可する要素（`p`・`strong`・`em`・`del`・`ul`・`ol`・`li`・`blockquote`・`code`・`pre`・`a`・`br` 程度）に絞る。`urlTransform` は既定のまま、または `http:`・`https:`・`mailto:` に絞る | 追加のライブラリが要らない。Skill に合う | 生 HTML を使わせない設計の前提。プラグインや `components` を足すときの確認が必要 |
| B. A ＋ `rehype-sanitize` | A に二重の防御として、構文木の段階で許可リストを適用する | プラグイン経由の混入に強い | 依存が 2 つ増える（gzip 約 3KB＋α）。スキーマの維持が要る |
| C. HTML 文字列を作り DOMPurify で浄化 | marked・markdown-it の出力を DOMPurify に通し、`dangerouslySetInnerHTML` で入れる | ライブラリの組み合わせが豊富 | `dangerouslySetInnerHTML` が必要（Skill の例外承認が要る）。DOMPurify は 2026 年に advisory が多く、更新の追従が必須 |
| D. 自前の構文木→React の変換 | micromark の構文木、または自前の解析を、React 要素の許可リストで描画する | 許可する要素・URL を自分で閉じられる | 変換と URL の検査の作り込み・テストが要る |

### 6-3. 共通で必要な対策

1. **リンク**：`http:`・`https:`（・`mailto:` の要否は未決定）以外は描画しない。外部リンクには `rel="noopener noreferrer"` を付ける（`target="_blank"` を使う場合）。要件にはリンク先の扱い（別タブで開くか等）が書かれていないため、決定が要る（8 章）。`rel` に `nofollow` が要るかも、社内システムでは不要の可能性があり、決定が要る
2. **画像**：要件にないので、マークダウンの画像記法は描画しない（許可リストから外す）案が自然。外部画像の読み込みは、閲覧者の IP の送信・追跡に使われうる。添付の画像は別機能（1-6）
3. **CSP**：Skill「security」のとおり設定する。`script-src 'self'`・`img-src` を絞ることで、整形処理の不具合があっても二重の防御になる。具体的な設定は実装時
4. **本文の長さの上限**：V-18（1〜4,000 文字）をサーバーで強制する。markdown-it・marked では、入力の大きさに依存して重くなる DoS 系の advisory が続いている（9 章参照）。micromark の README も入力の上限を推奨している（出典 R15）。これは、画面側（ブラウザ）でも、悪意のある本文が閲覧者全員のタブを固まらせる可能性があるため、サーバー側の上限が重要
5. **サーバー側での整形・検査**：本文は元の文字列のまま保存し、ブラウザで整形するのが前提。サーバーで HTML に整形して保存すると、ライブラリの更新後も古い出力が残り、修正が反映されない。サーバーで行う検査は「長さ」と「文字種（制御文字）」程度にとどめる案。サーバー側でのサニタイズは、通知やメール本文など、HTML として別の場所に出す機能を作るときに再検討する（現行の要件は、アプリ内通知のみ。C-39）
6. **ロックファイルと更新の運用**：依存の `mdast-util-to-hast` が 13.2.1 以上であることをロックファイルで確かめる（CVE-2025-66400）。`npm audit`（本番の依存。Skill「quality-tools」）で継続的に確かめる
7. **テスト**：`<script>`・`<img onerror>`・`javascript:`・`data:`・`vbscript:` のリンク・大文字小文字や空白を混ぜた `jAva script:`・入れ子の巨大な入力・メンション表示名に HTML を含む場合などを、単体テスト（Vitest＋Testing Library）で確かめる（Skill「testing」のセキュリティのテスト）

## 7. 未確認・不確かなこと

1. **バンドルサイズ**：bundlephobia の算出値で、Vite（Rollup）でのツリーシェイク・実際のバンドルの測定ではない。react-markdown の gzip 34,090 B は、依存込みのとみられる（rehype-sanitize の `dependencySizes` に hast-util-sanitize が別行にあり、合計の扱いは未確認）。実装前に、Vite の実際のビルドで測る必要がある（インストールは範囲外のため、ここでは測っていない）
2. **描画の軽さ（性能）**：どの候補も、大量のメッセージの一覧での描画時間は測っていない。「marked は速い」といった一般的な評判は、一次情報で確かめていない。性能の比較には、実測（プロトタイプ）が要る
3. **React 19.3.0・TypeScript 6・Vite 8 での動作**：peerDependencies の範囲（`react >=18`）の確認にとどまり、実際の組み合わせでの動作確認はしていない
4. **取り消し線の既定**：marked（`gfm` の既定値）・markdown-it（プリセットごとの `~~` の有効）について、一次情報で確認できなかった。`remark-gfm` の `singleTilde`（`~text~` を取り消し線にするか）の既定の挙動も未確認（要件は `~~` の記法を指定していない）
5. **`allowedElements` で要素を絞ったときの描画**（許可しない要素の子の扱い）、GFM の自動リンク（URL がそのままリンクになる）・表の扱い：react-markdown の README の取得結果から細部を確認できなかった。実装時に確認が要る
6. **DOMPurify の既定の挙動**（`javascript:` URL・`on*` 属性の除去）：個別の advisory の一覧で状況は分かるが、既定の動作の説明（公式 README）は取得していない
7. **react-markdown の `rel`・`target`**：README の取得結果に記載がなかった。`components` で差し替える前提の記述（公式の例）は確認していない
8. **GitHub の advisory の「版」の詳細**：GitHub の API（`gh api repos/<repo>/security-advisories`）の公開済みの一覧にあるものだけを数えた。npm の脆弱性データベース・Snyk・OSV など、別の情報源は調べていない。CVE 番号は GitHub の表示のままで、NVD などでの確認はしていない
9. **メンテナの人数・体制**：react-markdown の更新が 2025-03 以降ない理由（安定しているのか、人手が足りないのか）は未確認。unified の組織は、`mdast-util-to-hast` の advisory（2025-12）に 13.2.1 を出しており、依存の修正は続いている
10. **markdown-it の README・ソースの記載**（取り消し線・`validateLink`）の細部、`renderer.rules.link_open` の例：docs/safety.md 以外は確認していない
11. **メンション**：本文の `@表示名` と `mentionUserIds` の突き合わせは、どの候補でも自前になる。表示名の重複（#25）の決定に依存する
12. **自前の最小実装の工数・網羅の程度**：見積もっていない。テストケースの量は、要件の 8 書式の入れ子の組み合わせを洗い出してから判断する
13. **`markdown-to-jsx` の安全性の一次情報**：npm の情報と GitHub の advisory の件数（0 件）だけで、README の記載を確認していない
14. **インストールサイズ**：`npm view` の `dist.unpackedSize` は配布物の展開後の大きさ（devlop など依存の分は含まない）で、実際のインストールの合計サイズは未計測
15. このファイルの、ライブラリの利用数（週のダウンロード数）は、GitHub の Dependents の数・採用事例とは別の指標で、品質の保証ではない
16. 比較表の「最新版の公開日」は、`npm view <pkg> time` の版ごとの日付で確認した（marked 18.1.2・dompurify 3.4.17・markdown-it 15.0.3・micromark 4.0.3・react-markdown 10.1.0・remark-gfm 4.0.1 は `time.modified` と一致。rehype-sanitize 6.0.0 だけ公開 2023-08-26 で `time.modified` 2023-11-20 とずれる）。4 章の記述のうち「`time.modified`」と書いたものは、パッケージ全体の更新日で、版の公開日とは区別する

## 8. 次に利用者が決めること（質問の素案）

1. **ライブラリを入れるか、自前の最小実装にするか**。入れる場合は、react-markdown 10.1.0＋remark-gfm 4.0.1 でよいか（本書の推奨）。バンドルが増えること（gzip の目安 約 44KB。実測が要る）と依存が多いことを許容するか
2. **`rehype-sanitize` 6.0.0 を二重の防御として入れるか**（gzip 約 3KB＋依存 2 つ）。入れない場合は、生 HTML を使わせない設計（`rehype-raw` を入れない）をルールとして残す
3. **`dangerouslySetInnerHTML` を使う方式（marked・markdown-it）を選ぶ余地を認めるか**。Skill「security」は「原則使わない」。認めない場合は、候補は react-markdown・micromark・自前に絞られる
4. **リンクの扱い**：外部リンクは別タブで開くか（`target="_blank"`）。許可するスキーム（`http:`・`https:`のみか、`mailto:` も許可か）。URL をそのままリンクにする自動リンクを有効にするか
5. **画像のマークダウン記法（`![]()`）を許可するか**。許可しない場合は描画しない（添付は 1-6 の機能で扱う）
6. **取り消し線の記法**：`~~text~~` のみか、`~text~` も許可するか。表・タスクリスト・脚注などの GFM の追加の記法を描画するか（要件にない書式は描画しない案）
7. **メンションの表示**：本文の `@表示名` をどう描画するか（強調表示のみか、プロフィール S-27 へのリンクか）。表示名の重複（#25）との関係
8. **本文の長さ**：V-18（4,000 文字）で、整形の負荷の面から十分か（サーバーで強制する）。一覧の描画（仮想化・長文の折りたたみ）をどの段階で決めるか
9. **選定の後の手続き**：採用するバージョンの固定と、`docs/tech-stack.md` への追記、ADR（設計判断の記録）に残すか（別の Issue）。依存の脆弱性の継続監視（`npm audit`）の運用

## 9. 出典の一覧

取得日はすべて 2026-10-29。

### npm（`npm view`、読み取りのみ）

- `npm view react-markdown|remark-gfm|rehype-sanitize|marked|dompurify|markdown-it|micromark|mdast-util-from-markdown|mdast-util-to-hast|hast-util-sanitize|markdown-to-jsx|snarkdown|remarkable|commonmark|@lezer/markdown version time.modified license dist.unpackedSize dependencies peerDependencies`
- https://www.npmjs.com/package/react-markdown
- https://www.npmjs.com/package/remark-gfm
- https://www.npmjs.com/package/rehype-sanitize
- https://www.npmjs.com/package/marked
- https://www.npmjs.com/package/dompurify
- https://www.npmjs.com/package/markdown-it
- https://www.npmjs.com/package/micromark

### ダウンロード数・サイズ

- npm のダウンロード数 API：`https://api.npmjs.org/downloads/point/last-week/<パッケージ名>`（2026-10-21〜2026-10-27）
- bundlephobia の API：`https://bundlephobia.com/api/size?package=<パッケージ名>@<版>`

### 公式ドキュメント・リポジトリ

- R1：react-markdown の README（セキュリティ、Appendix A、`urlTransform`、`allowedElements`、`skipHtml`）https://github.com/remarkjs/react-markdown
- R2：remark-gfm https://github.com/remarkjs/remark-gfm
- R3：rehype-sanitize https://github.com/rehypejs/rehype-sanitize
- R4：unified の organization（remarkjs）https://github.com/remarkjs
- R5：marked https://github.com/markedjs/marked ／ https://marked.js.org/using_advanced
- R6：marked の README の警告（出力 HTML をサニタイズしない）：https://github.com/markedjs/marked#readme
- R7：DOMPurify https://github.com/cure53/DOMPurify
- R8：markdown-it の Safety の文書 https://github.com/markdown-it/markdown-it/blob/master/docs/safety.md
- R9：各リポジトリの最新コミットの日付（GitHub API：`repos/<repo>/commits`）
- R10：hast-util-sanitize（既定のスキーマは GitHub のサニタイズに倣う）https://github.com/syntax-tree/hast-util-sanitize
- R15：micromark の README（セキュリティ・サイズ）https://github.com/micromark/micromark

### セキュリティ情報（GitHub Security Advisories。`gh api repos/<repo>/security-advisories`）

- R11：リポジトリに公開済みの advisory がないことの確認：https://github.com/remarkjs/react-markdown/security/advisories ほか（remarkjs/remark-gfm、rehypejs/rehype-sanitize、syntax-tree/hast-util-sanitize、micromark/micromark、syntax-tree/mdast-util-from-markdown、quantizor/markdown-to-jsx）
- `mdast-util-to-hast`：GHSA-4fh9-h7wg-q85m（CVE-2025-66400）https://github.com/syntax-tree/mdast-util-to-hast/security/advisories/GHSA-4fh9-h7wg-q85m
- R12：marked：https://github.com/markedjs/marked/security/advisories ／ GHSA-6v9c-7cg6-27q7（CVE-2026-41680）https://github.com/markedjs/marked/security/advisories/GHSA-6v9c-7cg6-27q7
- R13：DOMPurify：https://github.com/cure53/DOMPurify/security/advisories
- R14：markdown-it：https://github.com/markdown-it/markdown-it/security/advisories ／ GHSA-gfr2-rv44-r23c（CVE-2026-111758）https://github.com/markdown-it/markdown-it/security/advisories/GHSA-gfr2-rv44-r23c

### このプロジェクトの文書

- Issue #92（GitHub）
- `docs/requirements/decision-register.md`（C-58・C-60・Q-24）、`docs/requirements/01-messaging.md`（1-5・1-7・1-8）、`docs/requirements/api-draft.md`（V-18・V-19・V-23）、`docs/requirements/screens.md`（S-05）
- `.claude/skills/security/SKILL.md`（入力チェック・XSS）、`docs/tech-stack.md`、`AGENTS.md`
