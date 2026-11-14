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
- 対象の追加（Issue #239）：`frontend/src/features/drafts/`・`features/leave-guard/`、`features/auth/hooks/useLogout.ts`・`useSignedInUserId.ts`、`features/auth/components/LogoutButton.tsx`・`LogoutFailureNotice.tsx`・`DraftCleanupNotice.tsx`・`logout-failure-focus.ts`を足した。理由：書きかけの本文（個人情報や業務の内容を含みうる）の保存・期限切れ・ユーザーごとの分離・ログアウトでの消去は、取りこぼすと情報漏えいにつながるため、検出力（80%以上）を確かめる。ADR-0020 (c)（ルーティングの枠・認証・テスト基盤の変更）に当たるため、全体のミューテーションとE2Eの全件を実行する。**等価な変異体の受け入れ**：`LeaveConfirmDialog.tsx`は変異体8件のうち3件が等価（effect の中の`?.`を外す2件、依存配列を定数の配列にする1件）で、テストで届く上限が62.5%。80%に届かないが、等価として受け入れた（統括の判断）
- 対象の追加（Issue #134）：`backend/src/db/message-modify.sql.ts`、`frontend/src/features/messages/markdown/*.ts`・`*.tsx`を足した。理由：前者は編集・削除してよい条件（本人・未削除・参加中・部署が有効・DMの当事者）を持つ認可の中心、後者は許可リスト・URLのスキーム・許可しない記法を原文に戻す処理で、XSS対策の中心になるため。依存の追加と`stryker.config.json`の変更はADR-0020(c)に当たるため、重要処理の全体のミューテーションとE2Eの全件を実行する

## 5. 後始末

作業用のフォルダ（`.stryker-tmp`）と結果（`reports/`）は Git に入らない。不要なら消す。途中で止まった実行が残す `.stryker-tmp/sandbox-*` は gitignore 済みで、eslint の対象からも外している。手動で削除してよい。

## 6. よくある失敗と対処

| 失敗 | 確かめ方・対処 |
| --- | --- |
| 時間がかかりすぎる | `stryker.config.json` の対象を、変えたファイルに絞る |
| 初期のテスト実行（dry run）が5分を超えてタイムアウトする（対象が大きいとき。全体実行で4分38秒の実績） | `npm run mutation -- --dryRunTimeoutMinutes 40` のように上限を延ばす。恒久的に延ばす場合は `stryker.config.json` の `dryRunTimeoutMinutes` を使う |
| 開発中に範囲を絞りたい | ADR0020の範囲（変更した重要処理と参照元）に、上の方法で絞る。絞った設定はコミットせず、元の対象に戻す。`--mutate` は検証済みで、絞った実行に使う（[ADR0020](../adr/0020-test-scope-mutation-e2e.md)の「`--mutate` の検証結果（2026-11-11）」）。`--incremental` は未検証のため、検証が済むまで使わない。絞った結果を全体の合格として扱わない |
| 絞った実行（ADR0020）のコマンド | `npx stryker run --mutate "<ファイル>" --reporters clear-text,json --dryRunTimeoutMinutes 40` を直接使う（`json` は生存した変異体の一覧をレビュー用に作るため。既定は clear-text,html。`scripts/run-local.ts` は stryker を起動できない） |
| 振る舞いのテストで殺せない変異体（同値変異体）が残り、ファイル別80%に届かない | 本番コードをスコアのために変えない。Strykerの除外設定も足さない。同値であることをコードの根拠つきで証明し、ADRに例外として記録して利用者の承認を得る（[ADR-0023](../adr/0023-mutation-equivalent-mutants-exception.md)） |
