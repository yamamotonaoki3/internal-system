# 技術スタック

採用したバージョンと、その選定理由の記録です。バージョンは、npm と Node.js の登録情報を調べて決めています。

| 技術 | 採用したバージョン | 選定理由 | 調べた日 | 確認した最新の安定版 | 検証済み |
| --- | --- | --- | --- | --- | --- |
| node | 24.22.1 | 最新の安定版（LTS）、セキュリティ修正版 | 2026-10-25 | 24.22.1 | 24.19.0 |
| hono | 4.13.16 | 最新の安定版 | 2026-10-10 | 4.13.13 | 4.13.12 |
| @hono/zod-validator | 0.9.1 | 最新の安定版 | 2026-10-10 | 0.9.1 | 0.9.1 |
| zod | 4.6.7 | 最新の安定版 | 2026-10-10 | 4.6.5 | 4.6.5 |
| wrangler | 4.151.3 | 最新の安定版 | 2026-10-10 | 4.149.0 | 4.144.0 |
| vite | 8.3.5 | 最新の安定版 | 2026-10-10 | 8.3.4 | 8.3.1 |
| @vitejs/plugin-react | 6.1.2 | 最新の安定版 | 2026-10-10 | 6.1.2 | 6.1.1 |
| tailwindcss | 4.3.3 | 公開から日数が経った版（Issue #171。最新の4.3.4は公開から2日のため避けた） | 2026-11-04 | 4.3.4 | ひな形の対象外 |
| @tailwindcss/vite | 4.3.3 | 同上（tailwindcss と同じ版にそろえる） | 2026-11-04 | 4.3.4 | ひな形の対象外 |
| @cloudflare/vite-plugin | 1.64.0 | 最新の安定版 | 2026-10-10 | 1.63.1 | 1.62.2 |
| react | 19.3.1 | 最新の安定版 | 2026-10-10 | 19.3.0 | 19.3.0 |
| react-dom | 19.3.1 | 最新の安定版 | 2026-10-10 | 19.3.0 | 19.3.0 |
| react-router | 8.5.1 | 最新の安定版 | 2026-10-10 | 8.4.0 | 8.4.0 |
| @types/react | 19.3.0 | 最新の安定版 | 2026-10-10 | 19.3.0 | 19.3.0 |
| @types/react-dom | 19.3.0 | 最新の安定版 | 2026-10-10 | 19.3.0 | 19.3.0 |
| axios | 1.21.0 | 最新の安定版 | 2026-10-10 | 1.20.0 | 1.20.0 |
| @tanstack/react-query | 5.105.3 | 最新の安定版 | 2026-10-10 | 5.104.1 | 5.104.0 |
| react-hook-form | 7.91.0 | 最新の安定版 | 2026-10-10 | 7.89.0 | 7.89.0 |
| @hookform/resolvers | 7.0.2 | 最新の安定版 | 2026-10-10 | 5.9.1 | 5.9.1 |
| vitest | 4.1.12 | 範囲内の最新の安定版（範囲 ^4） | 2026-10-10 | 4.1.11 | 4.1.11 |
| @cloudflare/vitest-pool-workers | 0.23.0 | 最新の安定版 | 2026-10-10 | 0.23.0 | 0.22.0 |
| @testing-library/react | 16.3.3 | 最新の安定版 | 2026-10-10 | 16.3.3 | 16.3.3 |
| @testing-library/dom | 10.4.2 | 最新の安定版 | 2026-10-10 | 10.4.2 | 10.4.2 |
| @testing-library/user-event | 14.6.8 | 最新の安定版 | 2026-10-10 | 14.6.7 | 14.6.7 |
| jsdom | 30.1.3 | 最新の安定版 | 2026-10-10 | 30.1.2 | 30.1.1 |
| msw | 3.0.3 | 最新の安定版 | 2026-10-10 | 3.0.2 | 3.0.1 |
| fast-check | 4.10.2 | 最新の安定版 | 2026-10-10 | 4.10.2 | 4.10.2 |
| @playwright/test | 1.64.1 | 最新の安定版 | 2026-10-10 | 1.64.0 | 1.63.0 |
| eslint | 10.13.0 | 最新の安定版 | 2026-10-10 | 10.12.0 | 10.11.0 |
| typescript | 6.0.3 | 範囲内の最新の安定版（範囲 >=6.0.0 <6.1.0） | 2026-10-10 | 6.0.3 | 6.0.3 |
| typescript-eslint | 8.72.0 | 最新の安定版 | 2026-10-10 | 8.71.1 | 8.71.0 |
| eslint-plugin-react-hooks | 7.1.1 | 最新の安定版 | 2026-10-10 | 7.1.1 | 7.1.1 |
| prettier | 3.9.10 | 最新の安定版 | 2026-10-10 | 3.9.9 | 3.9.9 |
| @stryker-mutator/core | 10.1.1 | 公式修正版を採用（Issue #192） | 2026-11-08 | 10.1.1 | 10.0.0 |
| @stryker-mutator/vitest-runner | 10.1.1 | 公式修正版を採用（Issue #192） | 2026-11-08 | 10.1.1 | 10.0.0 |
| dependency-cruiser | 18.7.0 | 最新の安定版 | 2026-10-10 | 18.5.0 | 18.4.0 |
| jscpd | 5.4.2 | 最新の安定版 | 2026-10-10 | 5.4.1 | 5.3.3 |
| @types/node | 26.6.5 | 最新の安定版 | 2026-10-10 | 26.6.4 | 24.19.0 |
| drizzle-orm | 0.45.4 | 最新の安定版 | 2026-10-10 | 0.45.4 | 0.45.3 |
| drizzle-kit | 0.31.11 | 最新の安定版 | 2026-10-10 | 0.31.11 | 0.31.11 |

- 検証済み：ハーネスのひな形で、動作を確かめたバージョン
- 確認した最新の安定版：調べた日に、登録情報にあった最新の安定版（試験版を除く。範囲の条件があるものは、その範囲の中）
- 未確認：登録情報を取得できず、最新の安定版を調べられなかったもの
- 「採用したバージョン」の列は、`package.json`の実値にそろえてある（Issue #115。2026-11-02に突き合わせ、差のあった21パッケージ（reactとreact-domを別々に数えた数）を更新した）。「調べた日」「確認した最新の安定版」「検証済み」の列は、各行の調べた日の記録のまま残している（node は 2026-10-25、それ以外は 2026-10-10）。差の一覧は[調査メモ](research/design-foundation.md)の8-3

## 全体に関わる方式（ADRで決定。2026-11-02、Issue #105）

この表の時点（Issue #105）では、新しいライブラリは追加しない方針だった（バージョンの固定が要るものは、追加するときにこの表に足す）。その後、Issue #171で `tailwindcss`・`@tailwindcss/vite` を追加した（「スタイル」の行）。

| 項目 | 方式 | 追加するライブラリ | ADR |
| --- | --- | --- | --- |
| DB | D1のみ（本番・ローカル・テストとも）。DrizzleもD1（方言 sqlite、ドライバ drizzle-orm/d1）。pg（PostgreSQL・Hyperdrive）は使わない（ADR-0005）。ハーネスのひな形に残るpg経路の扱いは、Issue #114 とハーネスへの改善の提案で整理した | なし | [0005](adr/0005-database-d1-only.md) |
| リアルタイム更新 | 最初は2秒間隔のポーリング（Workers Paid前提）。あとでWebSocket（Durable Objects＋Hibernation）に置き換える（別のIssue） | なし（Workersの標準機能） | [0004](adr/0004-realtime-polling-then-websocket.md) |
| ID | 時刻順のULID相当のテキスト。自前で生成する | なし（Web Crypto） | [0006](adr/0006-id-cursor-unread.md) |
| パスワードのハッシュ | `node:crypto`のscrypt（N=2^16, r=8, p=2）。本番（Workers Paid）での確認により確定（2026-11-03。`maxmem`の指定が必須）。`argon2id`（1.0.1）は更新が止まっているため使わない。互換性日付2026-08-04以降または`nodejs_compat`が要る | なし | [0007](adr/0007-password-hash-scrypt.md) |
| セッション・試行制限 | D1の`sessions`・`login_attempts`。期限切れの掃除はCron Triggers | なし | [0008](adr/0008-session-and-login-throttle.md) |
| 管理者のMFA | 全体管理者だけTOTP（RFC 6238）。WebCryptoで自作 | なし | [0009](adr/0009-admin-mfa-totp.md) |
| 日本語の全文検索 | D1のFTS5 trigram（1〜2文字は`LIKE`） | なし | [0010](adr/0010-japanese-search-fts5-trigram.md) |
| 添付の検査 | Office新形式のzip構造を自前で確認 | なし | [0011](adr/0011-attachment-inspection-and-virus-scan.md) |
| スタイル | Tailwind CSS 4＋CSS変数のデザイントークン＋自前の共通部品。CSPは変えない（`style-src 'self'`）。UI部品のライブラリ・アイコン・Webフォントは入れない | `tailwindcss`・`@tailwindcss/vite`（2026-11-04、Issue #171で追加。下の「Tailwind CSS」） | [0015](adr/0015-style-foundation.md) |

- 追加予定で、まだ表にないもの：react-markdown 10.1.0・remark-gfm 4.0.1（C-128。追加するIssueで、バージョンを固定して表に足す）、emoji-picker-react 5.1.4（C-128。条件つき）
- `wrangler.jsonc`にまだないもの：R2のバインディング、Cron Triggers、Durable Objects（WebSocketへの置き換えのとき）、秘密情報（接続元のHMACの鍵など。値は利用者が`docs/secrets.md`の手順で入れる）

## Tailwind CSS（Issue #171、ADR-0015）

| 項目 | 内容 |
| --- | --- |
| 追加したもの | `tailwindcss` と `@tailwindcss/vite`（どちらも devDependencies。4.3.3 を固定。`^`・`~` なし） |
| 確認日 | 2026-11-04 |
| 版の選び方 | 公開から日数が経った版。4.3.3（2026-07-16公開、111日前）。最新の4.3.4（公開から2日）は避けた。公式のリリースノートに、4.3.3・4.3.4ともセキュリティ修正の記載はない |
| 導入の条件（ADR-0015） | 公式の導入手順（tailwindcss.com の Vite 向け）のパッケージ名との完全な一致、npm の公開者・リポジトリが公式と一致、バージョン固定、`--ignore-scripts` で導入、導入後に**増えたすべての依存**（ネイティブバイナリ・間接依存を含む）を公式情報と照合し、ロックファイルの差分・integrity・`npm audit`・`npm audit signatures`・OSV を確認、結果を Issue #171 に記録 |
| 増えた依存 | 29件（既存の版の変更・削除はなし）。`tailwindcss`・`@tailwindcss/*`（`@tailwindcss/oxide` とOS別のバイナリを含む）17件、`lightningcss` とOS別のバイナリ12件、`jiti` 1件。導入時に実行されるスクリプトはなし。OS別のバイナリは、手元の Windows 用と CI の Linux 用を含む全OS分がロックファイルに入っている |
| 出所の証明 | `tailwindcss` 系はあり。`lightningcss` 系と `jiti` はなし（公式のリポジトリ・公開元が一致することを確認し、受け入れた） |
| `source(none)` | `frontend/src/styles/index.css` で `@import "tailwindcss" source(none)` とし、クラスを探す範囲を `@source "../"`（`frontend/src/`）に限る。既定ではプロジェクトの全体を自動で探すため、意図しないファイルを読まないようにするため |
| 初回のJS・CSSの大きさ | 導入前：JS 755,222 B（gzip 230,392 B）、CSS 0。導入後：JS 759,072 B（gzip 231,570 B）、CSS 10,513 B（gzip 3,005 B）。測り方と詳細は `docs/design/style-foundation.md` |

## インフラ（Terraform、infra/）

| 技術 | 版 | 固定する場所 |
| --- | --- | --- |
| Terraform | 1.15.5 以上 2.0.0 未満 | infra/versions.tf の required_version |
| Cloudflare プロバイダー（cloudflare/cloudflare、v5 系） | 5.26.0 | infra/versions.tf の required_providers（= で固定）。lock ファイルは README の手順で作ってコミットする |

- Terraform は npm では入れない。PC に直接入れる（infra/README.md）
- プロバイダーの版は、ハーネスが、生成した infra/ で terraform init（-backend=false）と terraform validate を実行して確かめた版

## 注意：大きな版が違うバージョン

- @types/node：検証済み 24.19.0 に対して 26.6.5 を採用しています。大きな版が違い、ハーネスで動作を確認していません

## 組み合わせの条件

### Hono（backend-framework/hono）

- Hono の csrf ミドルウェアはフォームの送信だけを確かめる。状態を変える要求の送信元の確認は files/security.ts の originCheck を使う
- @hono/zod-validator は既定でZodの詳しいエラーを返す。files/validation.ts の validate を通して使う
- compatibility_date は、テストの道具（@cloudflare/vitest-pool-workers）が対応する日付以下にする

### Vite＋React Router（frontend-build/vite-react-router）

- @cloudflare/vite-plugin で、画面とAPI（Hono）を1つのWorkersにまとめ、同じドメインから配信する
- wrangler.jsonc の assets に run_worker_first（/api/*）と not_found_handling（single-page-application）を設定する
- Viteの起点（root）とローカルのD1の保存先をそろえる。マイグレーションの適用時は --persist-to で同じ保存先を指定する
- 2026-09-30 の確認で、初回に読み込むJavaScriptは圧縮後161KB（React・React Router・TanStack Query・React Hook Form・Zod・Axios）
- 2026-11-04（Issue #171）の測定では、このアプリの初回に読み込むJavaScriptは圧縮後（gzip）約231KBで、目標の200KBを超えている。CSSは約3.0KB（gzip）。詳しくは `docs/design/style-foundation.md`

### TanStack Query＋React Hook Form＋Zod（frontend-state/tanstack-query-rhf-zod）

- @hookform/resolvers は任意の部品を通して Zod 3系を求め、Zod 4系とぶつかる。package.json の overrides で @typeschema/zod の zod に $zod を使わせる

### Vitest・Playwright ほか（test-framework/vitest-playwright）

- @cloudflare/vitest-pool-workers は Vitest 4系にだけ対応する（5系は不可）
- このアプリはD1のみ（ADR-0005）のため、Workers の結合テストも `@cloudflare/vitest-pool-workers` の中でD1に対して行う。pg（PostgreSQLのドライバ）はこのアプリでは使わない（ひな形の注意書きは Drizzle ORM の節の末尾を参照）
- msw はバージョンを明示する（指定しないと古い版が入ることがある）
- jsdom の画面の場所と、テストで呼ぶAPIのドメインをそろえる（別のドメインだと通信の制限で失敗する）
- k6 と OWASP ZAP は npm ではなく、手順書（docs/testing/）に沿って導入する

### ESLint・Prettier・tsc・Stryker・dependency-cruiser・jscpd（quality/typescript-standard）

- typescript-eslint は TypeScript 6.1 未満にだけ対応する（7系は不可）
- npm 11 では esbuild・workerd のインストール時の処理が既定で実行されないため、package.json に allowScripts を設定する
- npm audit の合否は本番の依存（--omit=dev）で判定する。開発用の道具の脆弱性は記録して更新の判断に使う

### Strykerの誤分類診断と再検証（2026-11-08、Issue #192）

`@stryker-mutator/core` と `@stryker-mutator/vitest-runner` を10.1.1に固定した。公式 [PR #6269](https://github.com/stryker-mutator/stryker-js/pull/6269) の修正により、importまたはsuite収集中に失敗してテストが0件になった場合に、Survivedと誤分類する問題をRuntimeErrorとして報告する。10.1.1はこの修正を含む10.1.0の再リリースである。依存更新後の `npm ci` は成功した。Node 24・TypeScript 6・Vitest 4の版は変更していない。

別の制限として、Stryker側で`testFiles`を明示すると静的変異もruntime activationになり、モジュール初期化前に変異が適用されない場合がある。このため限定計測ではStrykerの`testFiles`を使わず、同じテスト集合をVitestの`include`で選択し、`related=false`にする。共有ルールの12変異はこの小診断で12件検出した。通常の`npm run mutation`に`testFiles`の注入はなく、Vitestのsetup順序を変更する恒久設定も追加していない。`stryker.config.json`には今回の重要7pathを追加した。

途中の65.81%と78.93%は基準80%未満の経過として保持する。Stryker 10.1.1での最終計測は重要15source・658変異、23関連testfiles・214実行ケース。Killed 534・Survived 108・NoCoverage 13・RuntimeError 3・Timeout 0で、公式の有効分母655に対し81.53%となり、終了0・基準80%以上を確認した。既知RuntimeError 3件は変異によるHono/Zod初期化失敗で、手動Killed補正や対象除外はしていない。元658署名の欠落・追加は0、追加8ケース後の製品・依存・設定ハッシュも不変。全体チェックは106ファイル1179件成功、build・開発形式E2E55件・ローカル本番形式CSP E2E9件・重要19pathの補足Semgrep・desktop/mobile画面確認も合格した。小診断だけを全体合格へ読み替えたものではない。

2026-11-08に`npm view @stryker-mutator/core dist-tags --json`と`npm view @stryker-mutator/vitest-runner dist-tags --json`を再確認し、どちらも`latest`は10.1.1だった。表の採用版・確認した安定版はこの登録情報と一致する。「検証済み」列の10.0.0はハーネスひな形の履歴であり、本アプリでの今回の検証結果とは分ける。

### Drizzle ORM（data-access/drizzle）

- **このアプリはDBがD1のみ**（ADR-0005）。Drizzle は方言 sqlite、ドライバ `drizzle-orm/d1` で使う。本番・ローカル・テストとも同じ
- D1では db.transaction() を使わず db.batch() を使う（詳しい型は設計書 `docs/design/overview.md` の「DBの設計の型」）
- **pg（PostgreSQL・Hyperdrive）は、このアプリでは使わない**。ADR-0005 で PostgreSQL に一本化する案を採らないと決めたため。ハーネスのひな形（`scripts/`・Skill・`infra/README.md`）にはpg向けの記述が残るが、ハーネス由来のため直さない（参照箇所の一覧は Issue #114）。PostgreSQL へ切り替える条件は ADR-0005 に書いてある

## 依存セキュリティ対応（2026-11-07、Issue #185）

上の表の「調べた日」「確認した最新の安定版」「検証済み」は前回の記録を保っている。今回の採用版・理由・確認先はこの節に分けて記録する。依存を更新しただけで、アプリからの実際の攻撃到達を実証したことにはならない。

### 直接依存6件

| パッケージ | 変更前 → 採用版 | 今回の理由・確認した事実 | 公式資料 |
| --- | --- | --- | --- |
| `@hookform/resolvers` | 6.0.0 → 7.0.2 | 7系へ更新。v7.0.0の変更のうちTypeBox対応は本アプリで使っていない。Zod連携は実行検証で確かめる | [v7.0.0 リリース](https://github.com/react-hook-form/resolvers/releases/tag/v7.0.0) |
| `@tanstack/react-query` | 5.104.5 → 5.105.3 | 既存の5系のまま更新。公式changelogの5.105.3変更を参照し、既存利用との互換性は実行検証で確かめる | [公式changelog](https://github.com/TanStack/query/blob/main/packages/query-core/CHANGELOG.md) |
| `axios` | 1.20.0 → 1.21.0 | 公式releaseのヘッダー既定値変更は、本アプリで使っていない独自クラスに関する。通常のオブジェクトと`AxiosHeaders`の使用を確認し、互換性は実行検証で確かめる | [v1.21.0 リリース](https://github.com/axios/axios/releases/tag/v1.21.0) |
| `hono` | 4.13.13 → 4.13.16 | GHSA-h7mg-cq63-vhpqの影響範囲と修正版を確認。既定Routerと`/api/*`の認証・Origin middlewareを使うため関連性がある。公開先への攻撃は行っていない | [v4.13.16 リリース](https://github.com/honojs/hono/releases/tag/v4.13.16)、[GHSA-h7mg-cq63-vhpq](https://github.com/honojs/hono/security/advisories/GHSA-h7mg-cq63-vhpq) |
| `react-hook-form` | 7.90.0 → 7.91.0 | 既存の7系のまま更新。フォーム実装との互換性は実行検証で確かめる | [v7.91.0 リリース](https://github.com/react-hook-form/react-hook-form/releases/tag/v7.91.0) |
| `react-router` | 8.5.0 → 8.5.1 | 既存の8系のまま更新。ルーティング実装との互換性は実行検証で確かめる | [公式release一覧](https://github.com/remix-run/react-router/releases) |

### 一時的なtransitive override

`package.json`では、既存の`@typeschema/zod`配下のZodを直依存`$zod`へ合わせる設定を保ち、脆弱な範囲にだけ次のoverrideを置く。親パッケージのsemver範囲との交差に適用される設定で、将来の更新時にも新しい版へ自動追随する保証にはならない。更新時に各overrideを撤去または更新するか再評価し、ロックファイルで修正済みの版を意図せず下げていないことを確認する。上流の親依存が脆弱でない版を要求するようになり、overrideなしで修正済み版へ解決される場合は削除する。

| 親・対象 | override条件 → 版 | 状態・根拠 |
| --- | --- | --- |
| 全依存のUndici 7系 | `undici@>=7.0.0 <7.30.2` → `7.30.2` | security修正版に限る |
| 全依存のUndici 8系 | `undici@>=8.0.0 <8.12.4` → `8.12.4` | security修正版に限る。親の要求範囲が許す間も、この一時指定に固定され得る |
| `@cloudflare/vitest-pool-workers@0.23.0`配下のZod | `zod@>=4.0.0 <4.6.6` → `$zod`（直依存`4.6.7`） | 既存の直依存版に合わせる |
| `typed-rest-client@2.3.1`配下の`qs` | `qs@>=6.0.0 <6.16.1` → `6.16.1` | security修正版に限る |

`sharp`は利用者承認によりこのPRの修正対象から分離し、overrideを撤去した。`sharp@0.35.2`のhigh脆弱性は残るためIssue #186で追跡する。全依存auditは19件（moderate 15、high 4、critical 0）。全体の`npm ls`では、今回未変更でHEAD・`origin/main`・現行lockに共通する`msw@3.0.3`と`@vitest/mocker@4.1.12`のoptional peer range（`^2.4.9`）不整合が報告される。全体の`npm ls`成功とは扱わない。最終checkはexit 0（92ファイル・1023テスト、Prettier全件、依存違反0、本番audit 0件、gitleaks・Semgrep・OSV全項目成功）、devE2E 54/54、prodE2E 9/9とbuild、mutation score 91.47%（基準80%）を確認した。buildの500kB超chunk警告は既存Issue #160で追跡する。隔離解決候補は既存lockに170エントリ（追加41、削除39、版変更90）と`lightningcss`関連12件のdowngradeを含むため採用しなかった。初回checkの経過はIssue #185に記録する。

Undiciの追加修正6件にはcache・redirect・SRIなどの条件があり、本アプリからの直接利用は確認していない。ツール内部の到達性とアプリからの攻撃成立は未検証である。`minimatch` 10→11と`esbuild` 0.18→0.25は互換性を壊すmajor境界を越えるためoverrideしない。前者は`optimizationLevel` 2以上で攻撃者が制御するパターンを処理する条件、後者は開発サーバー利用の条件が報告されているが、ツール内の実到達性は未検証のため開発依存の残存リスクとして扱う。

本変更は新しいライブラリ追加や認証仕様変更を含まない。Node 24.22.1、TypeScript 6.0.3、Vitest 4.1.12、`@cloudflare/vitest-pool-workers` 0.23.0を維持する。PR #183のDocker向けNode 26移行は別のmajor更新で、現行Nodeに同時期のsecurity修正があるため保留。PR #184のVitest 5移行はWorkers poolとのpeer不整合でCIに失敗し、TypeScript 7も既存compiler APIと`typescript-eslint`の対応条件に合わないため保留する。

bundle計測はJS 792140B（gzip 240040B）でJS gzip 200KB目安を超過。CSSは13382B（gzip 3670B）、gzip合計243710Bで、dynamic importはない。目安は緩和せず、分割・性能判断を既存Issue #160で追跡する。

正式な合否範囲は既存設定のまま維持する。本番依存は`npm audit --omit=dev --audit-level=high`、OSVは`devOnlyPackages`を除外してCVSS 7以上を確認する。全依存auditの開発用脆弱性は件数と条件を別途記録し、正式checkの成功と取り違えない。Dependabot alerts APIは機能無効または権限不足のHTTP 403で取得できず、0件とは扱わない。権限拡張も行わない。

## 動作確認

このプロジェクトで動作確認済み（2026-10-10、npm install・npm run check）
