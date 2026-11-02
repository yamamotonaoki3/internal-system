# 0005：DBはD1のみとする（本番・ローカル・テストとも）

- 状態：採用
- 日付：2026-11-02（利用者の承認は2026-11-02〜03）
- 関係：Issue #105、決定記録 C-146、`docs/requirements.md`の6章、決定C-127、調査T-05、調査メモ[D1のみ と PostgreSQLに一本化の総合比較](../research/db-d1-vs-postgres.md)・[全体設計の方針の下調べ](../research/design-foundation.md)・[D1のみ構成でのスパイク](../research/spike-d1-hash.md)

## 背景

アプリのDBは、要件定義書の6章で「D1を使う」としている。一方、ハーネスのひな形には、PostgreSQL（`pg`・Hyperdrive）の経路が、使われないまま残っている（`scripts/local-env.ts`・`scripts/db-local.ts`、`docs/tech-stack.md`の注記）。アプリのコードは、本番・ローカル・テストとも実質D1（SQLite）だけを向いている。現在のスキーマは例の1テーブルだけで、DBの方針を決めるなら今が最も変更が小さい。

D1には、次の制約がある。

- 対話型トランザクションがない（`db.batch()`だけ。Skill「データアクセス（Drizzle）」の規則）
- 1文あたりの束縛値は100個まで
- FTS5の仮想テーブルを含むDBは`wrangler d1 export`で書き出せない

## 選択肢

1. D1のみ（本番・ローカル・テストとも）
   - 良い点：現状のひな形と一致。追加の費用・契約先がない。テスト基盤（`@cloudflare/vitest-pool-workers`）がそのまま使える。Time Travelで復旧目標（C-127：7日以内）を満たせる。
   - 悪い点：上の3つの制約。SQLiteの機能の範囲に制約される
2. PostgreSQLに一本化（Hyperdrive経由）
   - 良い点：通常のトランザクションが使える。日本語検索の選択肢（`pg_trgm`など）が広い
   - 悪い点：追加費用（Neonで月約10ドル前後、Supabase Proで月25ドル。時点指定の復旧を足すとさらに増える）と契約先が増える。`pg`が`vitest-pool-workers`の中で読み込めず、テストが二重になりCIにDBコンテナが要る。決定C-127・調査T-05・`requirements.md`6章・`nonfunctional.md`・`infra/`の変更が広い範囲に及ぶ
3. D1とDurable Objects（SQLite）の併用
   - 強い一貫性が要る部分だけをDurable Objectsに置く。構成が増える。必要になった部分だけを足す選択肢として残す（ADR-0004のリアルタイム更新と同時に判断する）

## 決定

**DBはD1のみとする**。本番・ローカル・テストとも、D1（Drizzleの方言はSQLite、ドライバは`drizzle-orm/d1`）を使う。

PostgreSQLに一本化する案は**採用しない**。理由は、追加費用、契約先の増加、テスト基盤の二重化、既存の決定C-127（復旧はTime Travel）と調査T-05（前提がD1）への影響である。

### D1の制約への対処の型（設計書に書く）

対処の型の詳細は`docs/design/overview.md`の「DBの設計の型」に書く。要点は次のとおり。

- **複数の文を1つの塊にする**：`db.batch()`を使う（途中で失敗すれば全体が取り消される）。`db.transaction()`は使わない
- **「読む→判断→書く」**：条件つきの1文（`UPDATE ... WHERE status = ...`の更新件数を見る、`INSERT ... SELECT ... WHERE NOT EXISTS`）と、楽観的ロック（更新件数0なら`409`）で表す
- **`batch`の中で前の文の結果を使えない**：IDはアプリ側で先に生成する（ADR-0006）
- **束縛値100個**：JSONを1つの束縛値で渡し、`json_each`で展開して1文で複数行を入れる。または`batch`に1行ずつの文を並べる（束縛値の上限は文ごとの判定）
- **連番の採番**：1文の`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`で行う（ローカルのD1で20件の同時発行が重複しないことを確認した）
- **FTS5を含むDBのエクスポート不可**：ADR-0010に従う。C-127で定期エクスポートを設けないと決めているため、バックアップ方針とは衝突しない

### PostgreSQLへ切り替える条件（目安）

次のいずれかが、D1で解決できないと確認されたときに、PostgreSQLへの切り替えを再検討する。

- D1でFTS5のtrigramが使えず、1文字区切りでも、検索の性能（p95で2秒以下。C-88）か検索語100文字の要件を満たせない
- 同時承認や採番などで、条件つき1文では表せない処理が多数出て、`batch`の組み立てが複雑になりすぎる
- 将来、運用先が決まり、時点指定の復旧や外部ツール連携などでPostgreSQLの機能が必要になった

切り替えるときは、新しいADRを追加し、このADRの状態を「置き換え」にする。

## 理由

1. 追加の費用と契約先が不要で、既に決めた事項（C-127、T-05、`requirements.md`、ADR-0003）を変えずに済む
2. テスト基盤がそのまま使える。学習用で、実装・保守の手間を抑えたい方針に合う
3. D1の弱点には、対処の型がある（上記）。社内規模（同時50人程度）で足りる見込み
4. Repository層にDB処理を閉じ込める設計（Skill「バックエンド」の層構成の規則）なので、将来PostgreSQLに移す場合も、変更の範囲は主にスキーマ・テスト基盤・データ移行に限られる。テキストのID（ADR-0006）なら、移行時にIDを変えずに済む

## 影響

- 次の事項は**実装の前または最初のIssueで確かめる**（本番のD1ではなく、テスト専用のD1と架空データで。調査メモ[db-d1-vs-postgres.md](../research/db-d1-vs-postgres.md)の10章）：本番D1でのFTS5 trigramの動作、FTS5を含むDBでのTime Travel復元、30万件規模の検索性能、案件番号の採番の同時実行、CSV100人の一括登録の取り消し、Workerと本番D1の往復時間
- D1の書き込みは1つのDBへ直列になる。50人程度の同時利用で足りる見込みだが、実測していない。負荷テスト（k6）で確かめる
- **後続の作業（別Issue）**：ひな形に残るpg（PostgreSQL・Hyperdrive）の経路の整理。`scripts/local-env.ts`・`scripts/db-local.ts`の`DATABASE_URL`・`HYPERDRIVE`の経路、`docs/tech-stack.md`のpgの注記、Skill・`infra/hyperdrive.tf`などが対象（`infra/hyperdrive.tf`の記述は実態と異なる。下の「訂正」を参照）。ハーネスが管理するファイルを含むため、別のIssue（またはハーネスの改善の提案）にする。このIssueでは変更しない

## 訂正（2026-11-02、Issue #114）

「後続の作業」にある`infra/hyperdrive.tf`は、現在の`infra/`に存在しない（あるのは`d1.tf`・`outputs.tf`・`providers.tf`・`variables.tf`・`versions.tf`・`README.md`）。`infra/README.md`が、回答で決まるファイルの例として`hyperdrive.tf`（PostgreSQL）を挙げているだけである。このアプリは`infra/hyperdrive.tf`を作らない。ひな形の`infra/README.md`・`scripts/`・Skillに残るpgの記述は、ハーネス由来のため直さず、ハーネスの改善の提案で扱う。決定と状態（採用）は変えない。
