# internal-system

このプロジェクトは、`harness create` で作りました。AIと開発するためのルール（`AGENTS.md`・`CLAUDE.md`・`.claude/`・`.agents/`）と、動くアプリの土台が入っています。

- 画面：React（Vite・React Router・TanStack Query）
- API：Hono（Cloudflare Workers）。画面と API は、1つの Workers にまとめて、同じドメインから配信します
- DB：Cloudflare D1（標準）
- 認証：未定

## 最初の手順

1. 必要なものを入れる：Node.js（`.node-version` の版）と **Docker**。品質チェック（`npm run check`）のセキュリティのテスト（Semgrep・gitleaks・OSV-Scanner）が、Docker のイメージで動くため、D1・DB なしでも Docker が要ります。Windows・macOS は Docker Desktop、Linux は Docker Engine を入れて、起動しておきます（`docker info` で確かめる）。**Docker Desktop は、従業員250人以上または年間売上1000万ドル以上の会社が業務で使うときは有料です**（個人・小規模・教育・非営利は無料。条件は公式で確かめる）。導入と注意は `docs/testing/security.md`
1. 依存を入れる：`npm install`
1. 開発用の環境変数を用意する：`.env.example` を `.env.development` にコピーして、`APP_ENV=development` と手元の値を入れる（Gitには入りません。項目の説明は `docs/secrets.md`）。不足は `npm run env:check` で確かめられます
1. DB（手元の D1）を用意する：`.env.example`を`.env.development`へコピーして`APP_ENV=development`を設定し、`npm run db:migrate:local`でテーブルを作り、`npm run db:seed:local`で開発用の架空のデータを入れる
1. 開発サーバーを起動する：`npm run dev`（画面は http://localhost:5173/ 、API は http://localhost:5173/api/health ）
1. 品質チェックとテストを実行する：`npm run check`（Docker が要る。初回は、セキュリティのテストのイメージを取得するため、通信と時間がかかります）

## リポジトリの用意

GitHub のアカウントとの紐付け（`gh auth login`）は、利用者が自分で行います。

1. GitHub にログインする：`gh auth login`
1. Git を用意して、最初のコミットをする：`git init -b main` のあと `git add -A`、`git commit -m "chore: 生成した初期状態"`
1. リポジトリを作って push する：`gh repo create internal-system --public --source=. --push`
1. 品質チェックの検証用の環境変数を登録する：GitHub のリポジトリの Secrets に `ENV_TEST`（`.env.test` の中身）を登録する。手順は `docs/secrets.md` の CI の章。`gh secret set` は値を入力するコマンドのため、利用者が自分で実行します（AI には実行させません）
1. `main` を保護する：下の「`main` ブランチの保護」の手順で設定する
1. 仮のアイコンの Issue を作る：下の「仮のアイコン」の手順で作る

## Docker で動かす

バックエンド（と、PostgreSQL のときは DB）を、Docker のコンテナで動かせます。コンテナ名は `internal-system-<役割>` です。

```
npm run docker:up:local
```

- 開発サーバーは、コンテナの中の `npm run dev` です（http://localhost:5173/ ）
- 依存（`node_modules`）は、コンテナの中のボリュームに置きます。手元の `node_modules` とは別です
- コンテナの中では、Docker を使えないため、品質チェックは `npm run check:app`（セキュリティのテストを除く）を実行します。セキュリティのテストを含む `npm run check` は、手元（ホスト）で実行します
- 開発と検証のローカルデータは環境別の保存先に残ります。`docker:down:*`でComposeを停止してもボリュームは削除されません
- Dockerで使うD1は、手元のD1と別のデータです。`npm run docker:up:local`で起動し、コンテナの初回は`docker compose exec -T backend npm run db:migrate:local`、続けて`docker compose exec -T backend npm run db:seed:local`を実行します

## よく使うコマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバーを起動する（画面と API） |
| `npm run build` | 本番用に組み立てる |
| `npm run preview` | 組み立てた結果を、手元で確かめる |
| `npm run check` | 品質チェック・テスト・セキュリティのテスト（`check:app` と `security`）。**ホストで実行する**（Docker が要る） |
| `npm run check:app` | 品質チェック・テスト（lint・型・書式・依存の向き・重複・テスト・`npm audit`）。Docker を使わない（コンテナの中でも動く） |
| `npm run security` | セキュリティのテスト（Semgrep・gitleaks・OSV-Scanner）。1つだけなら `security:semgrep`・`security:secrets`・`security:osv`（`docs/testing/security.md`） |
| `npm run types` | `wrangler.jsonc` から型（`worker-configuration.d.ts`）を作る（`dev`・`test`・`typecheck` の前に自動で実行） |
| `npm run env:check` | `.env.development` に足りない項目がないか確かめる |
| `npm run test` | `.env.test` を使ってテストする |
| `npm run dev:test` | `.env.test` を使って開発サーバーを起動する |
| `npm run docker:up:test`・`npm run docker:down:test` | テスト用の Docker 環境を起動・停止する |
| `git switch -c <種類>/<番号>-<内容>` | 作業のブランチを作る（`AGENTS.md` の「作業の流れ」） |
| `npm run db:generate -- --name <内容>` | スキーマ（`backend/db/schema.ts`）の変更から、マイグレーションを作る |
| `npm run db:migrate:test`・`npm run db:seed:test`・`npm run db:reset:test` | 検証用D1（環境別保存先）にマイグレーション・シード・再作成を行う |
| `npm run db:migrate:local` | 手元の D1 に、マイグレーションを適用する |
| `npm run db:seed:local` | 開発用の架空のデータを入れる |
| `npm run db:reset:local` | 手元の D1 を作り直す（マイグレーションとシードを、もう一度適用する） |
| `npm run db:cleanup` | テストデータ（`testuser_` で始まるもの）だけを消す |

## ディレクトリ

| パス | 内容 |
| --- | --- |
| `backend/src/` | API（Hono）。`routes/`（受け付け）→ `services/`（業務の処理）→ `db/`（DB へのアクセス） |
| `backend/db/` | DB のスキーマ・マイグレーション・シード |
| `frontend/src/` | 画面（React）。`pages/`（部品を組み合わせる）・`features/`（機能ごとの部品と API 層） |
| `wrangler.jsonc` | Cloudflare Workers の設定（ハーネスが、選んだ技術に合わせて作ったもの） |
| `docs/` | 設計・ルール・記録（`docs/project-rules.md` を最初に読む） |
| `public/` | そのまま配信するファイル（アイコン・ファビコン・`manifest.webmanifest`） |
| `prototype/` | 画面の動きを確かめるプロトタイプ（HTML・CSS・JavaScript だけ。本番のコードに流用しない） |

## 文書

| 文書 | 内容 |
| --- | --- |
| `docs/requirements.md` | 要件定義書。生成したときの判定の結果（ASVS のレベル・ペネトレーションテストの要否・未定の項目）が入っています |
| `docs/adr/` | 設計判断の記録。`0000-template.md` を写して書きます |
| `docs/testing/` | テストの種類ごとの環境構築の手順書（セキュリティのテストは `security.md`、API の異常な入力のテストは `schemathesis.md`） |
| `docs/api/openapi.json` | API の仕様書（OpenAPI）。API を足す・変えるときは、同じ変更の中で直します |

## 仮のアイコン

`public/` のアイコン・ファビコン（`favicon.ico`・`favicon.svg`・`apple-touch-icon.png`・`icons/icon-192.png`・`icons/icon-512.png`）は、頭文字と枠だけの**仮の画像**です。本番へ公開する前に、同じファイル名・同じ大きさの正式な画像に差し替えてください。

差し替えの作業は、Issue のテンプレート「仮のアイコンの差し替え」（`.github/ISSUE_TEMPLATE/replace-icons.md`）で Issue にして管理します。リポジトリを GitHub に作ったら、最初に次のどちらかで Issue を作ってください。

- GitHub の画面：「Issues」→「New issue」→「仮のアイコンの差し替え」
- コマンド：`gh issue create --template "仮のアイコンの差し替え"`

差し替えたら、この章を消します。

## `main` ブランチの保護

`main` への直接の push と強制 push（force push）を禁止します。リポジトリを GitHub に作ったら、次の設定をしてください。

1. GitHub のリポジトリの「Settings」→「Rules」→「Rulesets」→「New ruleset」→「New branch ruleset」を開く
1. 「Ruleset Name」に `main の保護` と入れ、「Enforcement status」を「Active」にする
1. 「Target branches」で「Add target」→「Include default branch」を選ぶ
1. 「Restrict deletions」「Require a pull request before merging」「Block force pushes」に印を付ける
1. 品質チェックを GitHub Actions で実行する場合は、「Require status checks to pass」に印を付け、`check` を追加する
1. 「Create」で保存する
