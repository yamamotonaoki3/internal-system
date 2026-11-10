# ミューテーションテストの手順書

テストが、業務ロジックの誤りを見つけられるかを確かめる（対象：`stryker.config.json` の `mutate` に挙げた重要処理。`backend/src/services/**/*.ts` に加え、認証・認可・個人情報・重要な業務ルールに関わる `backend/src/lib/`・`backend/src/db/`・`backend/src/routes/`・`shared/`・`frontend/src/features/` の一部のファイル）。

## 1. 必要なもの

| もの | 版 | 入れ方 |
| --- | --- | --- |
| Node.js | `.node-version` の版 | PC に直接入れる |
| Stryker | `docs/tech-stack.md` の版 | `npm install` |

## 2. 構築の手順

1. `npm install`
1. 単体テストの手順書の構築を済ませる（`npm test` が通る状態にする）

## 3. 確認の方法

- `npm test` が通る

## 4. テストの実行方法

`npm run mutation`（時間がかかるため、`npm run check` には含めない。影響の大きい処理を変えたときに実行する）

- 開発中は、変更した重要処理と、その参照元の重要処理に絞って80%以上を確かめる。全体（`stryker.config.json` の対象すべて）は、リリース前の検証（#160）と#189の最終確認の前、および範囲を広げる条件に当たる変更で実行する（[ADR0020](../adr/0020-test-scope-mutation-e2e.md)）
- 所要時間の目安（2026-11-10の実測）：全体（約3,900変異体）で約34分、絞った実行（約220〜1,000変異体）で4〜10分

## 5. 後始末

作業用のフォルダ（`.stryker-tmp`）と結果（`reports/`）は Git に入らない。不要なら消す。

## 6. よくある失敗と対処

| 失敗 | 確かめ方・対処 |
| --- | --- |
| 時間がかかりすぎる | `stryker.config.json` の対象を、変えたファイルに絞る |
| 初期のテスト実行（dry run）が5分を超えてタイムアウトする（対象が大きいとき。全体実行で4分38秒の実績） | `npm run mutation -- --dryRunTimeoutMinutes 40` のように上限を延ばす。恒久的に延ばす場合は `stryker.config.json` の `dryRunTimeoutMinutes` を使う |
| 開発中に範囲を絞りたい | ADR0020の範囲（変更した重要処理と参照元）に、上の方法で絞る。絞った設定はコミットせず、元の対象に戻す。`--mutate`・`--incremental` は未検証のため、検証が済むまで使わない。絞った結果を全体の合格として扱わない |
