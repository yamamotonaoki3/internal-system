# 結合テストの手順書

API と DB・Workers の実行環境（wrangler）を組み合わせて確かめる。

## 1. 必要なもの

| もの | 版 | 入れ方 |
| --- | --- | --- |
| Node.js | `.node-version` の版 | PC に直接入れる |
| wrangler・@cloudflare/vitest-pool-workers | `docs/tech-stack.md` の版 | `npm install` |
| ローカルの D1 | wrangler に含まれる | `npm install`（コンテナは使わない） |

## 2. 構築の手順

1. `npm install`
1. `.env.example` を `.env.test` にコピーし、`APP_ENV=test` と検証用の値を入れる
1. テスト用の D1 は、`npm test` のときに一時的に作られ、マイグレーションが適用される（準備は不要）
   - 別に、migration の更新の試験だけで使う空の D1（バインディング`MIGRATION_UPGRADE_DB`。`vitest.config.ts`で足してある）も、同じく一時的に作られる。準備は不要で、`DB`とは別の識別子。使い方は`docs/project-rules.md`の migration の決まり

## 3. 確認の方法

- `npm run env:check -- test` が、足りない項目なしで終わる
- `npm test` の最初に、マイグレーションの適用が失敗していない

## 4. テストの実行方法

`npm test`（検証用の環境だけを使う。開発用のデータには触れない）

## 5. 後始末

- テスト用の D1 は、テストの終わりに消える。開発用の D1（`npm run dev`）には触れない

## 6. よくある失敗と対処

| 失敗 | 確かめ方・対処 |
| --- | --- |
| 開発用のデータが変わった | `.env.test` を使っているかを確かめる。検証用の保存先は開発用と分かれている |
