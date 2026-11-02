# D1のみ と PostgreSQLに一本化 の総合比較（実装のしやすさ・コストパフォーマンス）

## 1. 目的と範囲

- 目的：Issue #105（全体設計の方針）でDBの方針を決める前提として、「D1のみ」と「PostgreSQLに一本化（本番・ローカル・テストともPostgreSQL）」を、実装したときの総合的なコストパフォーマンスで比べる。利用者は「実装のしやすさ・コスパ」で決めたいとしている。
- 範囲：リポジトリ内の文書・コードの読み取りと、公式ドキュメントの確認のみ。環境構築・課金・実機での計測はしていない。実際の `.env` の値は読んでいない。
- 決定はしない。「推奨案」は理由つきの参考にとどめる。
- 比べる2案：
  - 案1「D1のみ」：本番・ローカル・テストとも Cloudflare D1（SQLite）。現状のひな形のとおり。
  - 案2「PostgreSQLに一本化」：Worker から Cloudflare Hyperdrive 経由で PostgreSQL に接続する。ローカル・テストもPostgreSQL。マネージドの候補は Neon・Supabase・PlanetScale Postgres の3つ（公式で確認できたもの）。
- 公式ページの内容は WebFetch（ページ内容の要約）経由で取得しており、逐語の確認ではない。数値は契約・実装前に原文で再確認する。

## 2. 調べた日

2026-11-02（`date +%F` で確認）。料金・制限・リージョンは変わりうる。

## 3. 結論（要点）

- 実装のしやすさ（機能面）は、PostgreSQLが有利。通常のトランザクション、豊富な制約・型、日本語検索の選択肢（`pg_trgm`、Supabase なら PGroonga）が使える。D1は `db.batch()` だけで、束縛値100個の制限があり、FTS5の仮想テーブルはエクスポートできない。
- 一方、プロジェクト全体の実装・運用の手間は、D1のほうが小さい。DB用コンテナも接続情報（秘密情報）も不要で、テスト基盤（`@cloudflare/vitest-pool-workers`）がそのまま使える。PostgreSQLだと、`pg` が vitest-pool-workers の中で読み込めない（`docs/tech-stack.md`）ため、DBを使うテストの組み立てが二重になり、CIにDBコンテナが要る。
- 費用：D1は追加費用がほぼゼロ（Workers Paid の月5ドルは、案1・案2に共通）。PostgreSQLの追加は、Neon で月約10ドル前後（概算）、Supabase Pro で月25ドル（時点指定の復旧を足すと月125ドル）。いずれも社内規模では小さいが、「ゼロ」と「契約先がもう1つ」の差は残る。
- 復旧目標（C-127：7日以内、Time Travel）との整合：D1は追加費用なしで満たす。PostgreSQLでは、Neon は Free で履歴6時間のため不足（Launch 以上で最大7日）。Supabase は Pro の日次バックアップ（7日分）だと「日単位」の復旧になり、分単位に戻すには月100ドルのアドオンが要る。
- 既に決めた事項への変更の大きさ：案1は変更なし。案2は C-127、T-05（調査の前提）、`requirements.md` 6章、`nonfunctional.md` 2・7章、ADR（新規）、`docs/tech-stack.md`、`infra/`（`hyperdrive.tf`）、`docs/secrets.md`、CIとローカルのDocker などの広い範囲に及ぶ。
- 将来の移し替え：Repository層にDB処理を閉じ込める設計（C-03）なので、どちらを選んでも、Service層より上の変更は小さい。ただしDrizzleのスキーマは方言ごとに別（`sqlite-core` と `pg-core`）で、全テーブルの書き換えが要る。実装が進むほど費用が増えるため、**決めるなら今が一番安い**（現在のスキーマは例の1テーブルだけ）。
- 推奨案（参考）：**案1「D1のみ」**。理由は9章。ただし、決める前に10章の検証（特に D1 での trigram の動作確認）を行い、結果が悪ければ案2に切り替える条件を先に決めておく。

## 4. 現状（リポジトリで確認したこと）

| 項目 | 現状 | 根拠 |
| --- | --- | --- |
| 本番のDB | D1（バインディング `DB`、`internal-system-db`） | `wrangler.jsonc`、`docs/requirements.md` 6章 |
| スキーマ・マイグレーション | 例の1テーブル（`sample_users`）と `0000_init.sql` だけ。Drizzle は `sqlite` 方言 | `backend/db/schema.ts`、`drizzle.config.ts` |
| DBへの接続 | `backend/src/db/database.ts` が `drizzle-orm/d1` で接続。Repository は `sample-user.repository.ts` の1つ | `backend/src/db/` |
| テストのDB | `vitest.config.ts` が `readD1Migrations` で読み、`backend/test/apply-migrations.ts` が `applyD1Migrations` で一時D1に適用 | 同左 |
| Terraform | `infra/d1.tf` だけ。`hyperdrive.tf` は「回答で決まる」と README にある（ひな形に仕組みはある） | `infra/README.md` |
| PostgreSQLの経路 | `scripts/local-env.ts`・`scripts/db-local.ts` に `DATABASE_URL`・Hyperdrive 用の分岐が残る（使われていない）。Skill「data-access-drizzle」には `pg`＋Hyperdrive の書き方がある | 同左 |
| 既存の決定 | 復旧はTime Travel（C-127）。FTS5を使う場合の影響は T-03 | 決定記録、T-03・T-05 |

- つまり、ハーネス（ひな形）は両方の道を用意している。どちらを選んでも「道具がない」ことはない。
- 実装済みのDBコードはごく少ない（Repository 1つ、テーブル1つ）。今なら、方針の変更による書き換え量は小さい。

## 5. 比較項目ごとの調査結果

### 5-1. 実装のしやすさ

| 観点 | D1のみ | PostgreSQLに一本化 |
| --- | --- | --- |
| トランザクション | 対話型なし。`db.batch()` のみ。「読む→判断→書く」は、条件つき1文＋更新件数の確認（楽観的ロック）で表す。バッチ内で前の文の結果を使えないため、IDはアプリ側で先に作る（design-foundation 4-2） | 通常の `db.transaction()`。行ロック（`SELECT ... FOR UPDATE`）も使える。Hyperdrive はトランザクション単位の接続の使い回しをするため、セッション単位の機能（セッション変数、セッション単位のアドバイザリロック）は使えない見込み（一般知識。公式での確認は未実施） |
| 制約・外部キー | 外部キー・CHECK・一意・部分索引は使える。大文字小文字を区別しない一意は `COLLATE NOCASE` だが、効くのはASCIIのみ（日本語の全角半角は別処理が要る。一般知識）。列の変更が限定的で、Drizzleは表の作り直しを生成する | `citext` や `lower()` の式索引、`timestamptz`、`jsonb`、列挙型、排他制約など型・制約が豊富。DDLもトランザクション内で実行できる（一般知識） |
| 案件番号の連番（取引先×年。C-89）と同時承認 | 採番専用の行を `UPDATE ... RETURNING` で増やす1文で、重複なく採番できる（書き込みが直列のため）。欠番は再利用しない（C-122）に合う。一意制約を最後の守りにする | 同じく採番の行を行ロックで更新する、または連番（`SEQUENCE`）を使う。連番は取り消しても戻らない＝欠番が出る性質が C-122 に合う。ただし取引先×年ごとに数え直すため、採番専用の行で作るのが自然で、差は小さい |
| CSV 100人の一括登録（0-1 AC-6） | 1文の束縛値は100個まで（公式）。1行の列数×行数が100を超えるため、小分けして `batch` に入れる。1バッチ内の全体取り消しはできる | 束縛値の上限が実質気にならない（プロトコル上の上限は65,535。一般知識）。1つのトランザクションで一括登録できる |
| バッチ処理（掃除など。Cron Triggers） | Cron Triggers から `batch` や小分けの削除。D1は1つのDBへの書き込みが直列なので、大きい削除は小分けにする | 同じ。大量削除のロック・バキュームの考慮が要る（一般知識）が、規模から問題にならない見込み |
| マイグレーションの流れ | `drizzle-kit generate`→`wrangler d1 migrations apply`。ひな形の流れが既に整っている | `drizzle-kit generate`→`drizzle-kit migrate` 等の別の流れ。ひな形の Skill に記載はない（「PostgreSQLに変えるときに決める」とされている）。本番へのマイグレーションの手順の整備が追加で要る |
| Drizzleの対応 | `drizzle-orm/d1`。`db.transaction()` が使えない。仮想テーブル（FTS5）は未対応で生SQL（T-03 出典7） | `drizzle-orm/node-postgres`＋`pg`（Cloudflare の推奨）。通常の書き方がすべて使える |
| 既存コードの書き換え量 | なし | 小〜中：`schema.ts`（`sqlite-core`→`pg-core`）、`database.ts`、Repository、`0000_init.sql` の作り直し、テスト基盤、`scripts/`。現在は実装がほぼ無いので、今のうちなら小さい |
| 総合 | 制約はあるが、対処の型（条件つき1文・IDの先行生成・小分け）は決まっている。要件の範囲で足りる見込み | 書き方は素直。ただし「基盤を組み立てる手間」（5-3、5-4、5-6）が増える |

### 5-2. 日本語全文検索（T-03）

| 項目 | D1のみ | PostgreSQLに一本化 |
| --- | --- | --- |
| 使える方式 | FTS5（`unicode61` は日本語に不向き。`trigram` がD1で動くかは**未確認**）、1文字区切り、自前のn-gram表。`LIKE` はパターン50バイトまでで、100文字の検索語を受けられない | `pg_trgm`（3文字の並びで部分一致。GINやGiSTの索引）。PGroongaは日本語向けの全文検索拡張（Supabase の拡張一覧に記載あり） |
| 拡張の対応（公式で確認できたもの） | 拡張の追加は不可（独自のトークナイザは入れられない） | **Neon**：`pg_trgm` 対応。pgroonga・pg_bigm・textsearch_ja は一覧になし（要望は出せる）。**Supabase**：PGroonga の説明ページあり（日本語・中国語などに対応と記載。`pg_trgm` は一般に利用できるが、今回、公式で個別には確認していない）。**PlanetScale Postgres**：`pg_trgm` 対応（1.6）。pgroonga・pg_bigm は一覧になし |
| 1〜2文字の検索（要件：1文字から。C-90） | trigramは3文字未満が一致しない。補う方法（全件走査、1文字区切りの併設）が要る。数十万件で実測が要る | `pg_trgm` も、3文字未満の検索語は索引で効率よく解けない（一般知識。実測は未実施）。PGroongaは短い語も扱える見込み（一般知識。未検証）。つまり、**Supabase＋PGroonga** が、この要件には最も有利な見込み |
| 仮想テーブルの制約 | `wrangler d1 export` が使えない。マイグレーションは生SQL。Time Travel が仮想テーブルを含めて戻せるかは**未確認** | 通常の索引なので、ダンプ・復旧の制約は増えない |
| 判断 | 検索は「第1候補を試す」段階（T-03）。動かなければ代替が必要で、実装の難度が上がる | 検索の面では、案2のほうが安全。ただし Neon・PlanetScale は `pg_trgm` までで、短い語の問題は残る |

### 5-3. テストのしやすさ

| 項目 | D1のみ | PostgreSQLに一本化 |
| --- | --- | --- |
| ローカルの開発DB | wrangler のローカルD1。コンテナ不要（現状のとおり） | Docker の PostgreSQL コンテナが必要（ひな形に分岐はあるが未使用）。Windows では Docker Desktop が前提 |
| CIのDB | 追加なし | PostgreSQL のサービスコンテナを CI に足す |
| `@cloudflare/vitest-pool-workers` との相性 | 本番と同じ実行エンジン（workerd）で、一時D1にマイグレーションを適用して使える（現状の基盤） | `pg` が vitest-pool-workers の中で読み込めない（`tech-stack.md`、2026-09-30時点）。Workers＋PostgreSQLのテストは、`wrangler dev` で起動したアプリのAPIに対する試験、または Node.js 上でDBコンテナに対する試験に分かれる（Skill「data-access-drizzle」） |
| テストDBの作成と後始末 | テストごとに一時D1が作られ、環境ごと破棄される。`DELETE ... WHERE username = ?` による識別子ベースの後始末（C-05）で足りる | テスト用DB（名前が `_test` で終わる）の作成・破棄の手順が要る。識別子ベースの削除スクリプトは同じく要る。接続先が本番になる事故を防ぐ確認が重要（本番DBに接続しうる設定でテストしない） |
| 既存のテスト基盤への影響 | なし | `vitest.config.ts`、`apply-migrations.ts`、`scripts/` の整備と、テストの二重化（Worker内で動くものとNode上で動くもの）。Repositoryの結合テストの書き方が変わる |
| 負荷テスト（k6）・E2E | 追加なし | DBコンテナ（またはテスト用の外部DB）を起動する手順が増える |
| 総合 | 差は大きい。**D1のほうが明確に楽** | |

### 5-4. 運用（バックアップ・復旧、障害、監視、接続数、レイテンシ）

| 項目 | D1のみ | PostgreSQLに一本化（候補別） |
| --- | --- | --- |
| バックアップ・復旧（C-127：7日以内） | Time Travel：Workers Paid で30日、分単位。追加費用なし・設定不要（T-05）。復元は上書き。復元前のブックマークで取り消せる | **Neon**：履歴（PITR相当）は Free で6時間、Launch で最大7日、Scale で最大30日。Free では C-127 の7日を満たせない。Instant restore は Launch 以上で0.20ドル／GB・月。**Supabase**：Pro の日次バックアップは7日分（日単位）。分・秒単位の時点指定（PITR）は追加月100ドル（7日ごと。有効にすると日次バックアップは取られなくなる）。Free はバックアップなし。復元中はプロジェクトにアクセスできない。**PlanetScale**：今回の調査では確認できなかった |
| 移行（マイグレーション）・本番DBの変更前の戻し先 | Time Travel のブックマークを控える | Neon なら履歴からの復元（またはブランチ）、Supabase なら PITR か日次バックアップ。手順を文書化し、検証で確かめる必要がある |
| 障害時 | 依存先はCloudflareだけ。D1の障害＝Workers の障害と同じ事業者に閉じる | 依存先が増える：Cloudflare（Worker・Hyperdrive）とDB事業者。どちらが止まっても使えない。切り分けも2か所になる。稼働率の目標は置かない（C-88）ので、許容できる範囲ではある |
| 監視 | Cloudflare のダッシュボードでD1のメトリクスとWorkers Logs（保持は最大7日） | Cloudflare に加えて、DB事業者のダッシュボード。可用性の監視サービスは使わない方針（案）なので、確認先が増えるだけ |
| 接続数 | 接続の概念が実質ない（バインディング） | Hyperdrive が接続プールを持つ。オリジンへの最大接続数は Paid で構成ごとに約100、Free で約20。Workers からの同時クライアント接続数に上限はない。同時50人程度なら足りる見込みだが、DB側の接続上限（プランと容量による）も確認が要る |
| コールドスタート | なし | **Neon**：5分の無操作でスケールゼロ（Free は無効化不可、Launch は無効化可能）。復帰時に最初のクエリが遅れる（一般知識。実測は未実施）。**Supabase**：Free は1週間の無操作で一時停止。Pro は停止しない |
| リージョン・レイテンシ | D1の置き場所は、ロケーションヒントまたは最初のアクセス付近。ページには日本向けの明示的なヒントの記載はなく、APACが近い可能性がある（公式で確認できず）。Worker とD1が近く、往復は短い見込み。読み取りレプリカ（非同期）もある | **Neon**：東京はなし。シンガポール・シドニーはある。日本からは遠くなる（往復は数十ミリ秒の見込み。実測は未実施）。**Supabase**：東京（`ap-northeast-1`）がある。**PlanetScale**：今回は確認できなかった。1リクエストで複数のクエリを順に発行すると、往復が積み重なる。Hyperdrive の Placement（DBの近くでWorkerを動かす）の設定で軽減できるが、1回のクエリだけなら効果がない（公式） |
| Hyperdrive の制限 | 該当なし | 構成の数（Paid は25）、アイドル接続10分、1クエリ最大60秒。Free は1日10万クエリまで、Paid は無制限 |

### 5-5. 費用（社内規模の概算。月額）

前提：

- 登録は数百人以内、同時50人程度、メッセージは全体で数十万件（C-88）。DBの容量は数百MB〜1GB程度（概算、未計測）。
- Workers Paid（月5ドル）は案1・案2の両方で必要（C-126が Workers Paid を想定）。表では共通分を含めない。Hyperdrive は Workers Paid に含まれ、追加料金なし（公式）。
- 為替は考慮せず、ドル建てで示す。使用量は仮定を置いた概算で、実測ではない。

| 構成 | 追加の月額（概算） | 根拠と仮定 |
| --- | --- | --- |
| 案1：D1のみ | 約0ドル | Workers Paid で、読み取り250億行・書き込み5,000万行・5GBまで込み。超過分は読み取り100万行あたり0.001ドル、書き込み100万行あたり1ドル、保存1GB・月あたり0.75ドル。この規模では込みの範囲に収まる見込み（全件走査をしても、T-03の7-1 の計算で月8万回まで込み） |
| 案2-a：Neon Launch | 約10〜15ドル | 計算 0.106ドル／CU-hour、保存 0.35ドル／GB・月。仮定：0.25 CU で、稼働日の日中12時間相当が起動、月360時間＝90 CU-hours（約9.5ドル）＋ 1GB（0.35ドル）。履歴の保持分の保存、Instant restore（0.20ドル／GB・月）は別。月額の最低料金なし。Free（月100 CU-hours・1GB）では履歴6時間のため、C-127 の7日を満たせない |
| 案2-b：Supabase Pro | 25ドル（時点指定の復旧なし） | 8GBのDBと Micro の計算が含まれる。日次バックアップ7日。分・秒単位の復旧にするなら PITR を月100ドル追加（合計125ドル）。Free は500MB・バックアップなし・1週間で停止のため、本番運用には向かない |
| 案2-c：PlanetScale Postgres | 今回は確認できなかった | 料金ページを取得できなかった。契約前に確認する |

- ざっくりした比較：案1は追加0ドル、案2は月10〜25ドル（復旧機能を同等にそろえると最大125ドル）。年間では最大でも数百〜千数百ドル程度で、事業の費用としては小さいが、学習用で「追加費用なし」を保てるのは案1だけ。
- 見えにくい費用：案2は、DBコンテナの運用（ローカル・CI）、テスト基盤の二重化、秘密情報の管理、事業者の契約管理といった「人の手間」が増える。

### 5-6. セキュリティ

| 項目 | D1のみ | PostgreSQLに一本化 |
| --- | --- | --- |
| 接続情報の管理 | バインディングで接続する。接続文字列（パスワード）が存在しない | 接続文字列（パスワード）が1組できる。ローカルの接続先（`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`）、Terraform の `TF_VAR_hyperdrive_*` の変数、Hyperdrive の構成に認証情報が入る |
| 秘密情報の扱い | 増えない | `infra/README.md` のとおり、Terraform の状態ファイルに接続情報が**平文**で残るため、暗号化・アクセス制限つきの保存先とロックの用意が必須になる（保存先は ADR で決める。現状は未決定）。`docs/secrets.md` の手順、`.env.example` の項目、ローテーションの運用も増える。値は利用者が入力する |
| ネットワーク | Cloudflare の内部。インターネットに出ない | Hyperdrive からDBへは外部のネットワークを通る。TLS（`sslmode`）の指定が要る。DB側の接続許可（IP制限）、専用ロールの最小権限（公式の手順でも、権限を絞ったロールを推奨）の設計が要る。Cloudflare の送信元IPで絞れるか、Tunnel で閉じられるかは今回確認していない |
| 個人情報の置き場所 | Cloudflare 内のみ | 本名など個人情報（C-75）が、別事業者のDBにも保存される。Neon は東京がなく、国外（シンガポールなど）に置かれる。個人情報の取扱い先が増える点は、要件（非機能4章）との整合を確認する必要がある |
| 総合 | 攻撃面・管理対象が少ない | 管理対象と確認項目が増える。対処できるが、手間が増える |

### 5-7. すでに決めた事項・文書への変更の大きさ

| 対象 | 案1：D1のみ | 案2：PostgreSQL |
| --- | --- | --- |
| C-127（復旧目標7日以内、Time Travel、定期エクスポートなし） | 変更なし | 決定の置き換えが必要。復旧の仕組みが事業者ごとに違い、プラン選びが前提になる（Neon Launch 以上／Supabase Pro）。「Time Travelの履歴に旧い内容が残りうることを許容」の条件も事業者の仕様で確かめ直す |
| T-05（D1の復旧調査） | 変更なし。ただしFTS5を使う場合は仮想テーブルの扱いを追記 | 前提が崩れるため、PostgreSQL側のバックアップ・削除反映の調査が別に要る。R2の部分は影響なし |
| T-03（日本語全文検索） | 現状の前提のまま。trigramの動作確認が先 | 前提が変わる。`pg_trgm`・PGroonga での方式の比較に作り直す |
| `docs/requirements.md` 6章（「DBはD1を使う」）、ADR-0003（セッションをD1に保存） | 変更なし | 6章を変更し、ADR-0003 の「D1」を書き換える（方式自体は変わらない） |
| `nonfunctional.md`（2章データの復旧、7章バックアップ・監視、4章個人情報の保存先） | 変更なし | 2・7章の書き換えと、4章の確認 |
| `docs/tech-stack.md` | 変更なし（ただしpgの注記の整理は別Issue） | pg・Hyperdrive・DBの版を載せる。D1に関する記述を置き換える |
| ADR | 新規：採用理由を1行残す程度 | 新規：DB選定（事業者・リージョン・Hyperdrive・テスト方式）と、Terraform の状態ファイルの保存先 |
| `infra/` | 変更なし | `hyperdrive.tf` を追加し、状態ファイルの保存先（暗号化）の整備が先に要る |
| `docs/secrets.md`、`.env.example`、`docker-compose.yml`、CI | 変更なし | DB接続の項目の追加、DBコンテナの追加、CIのサービスコンテナの追加 |
| Skill / `docs/project-rules.md` | 変更なし | ハーネス側はPostgreSQL向けの記述をすでに持つ。プロジェクト固有の決定を `docs/project-rules.md` に書く |
| 総合 | 小 | 大（文書15か所前後、決定記録の置き換え1件以上、新規ADR） |

### 5-8. 将来の変更のしやすさ

| 方向 | 変更の大きさ | 主な作業 |
| --- | --- | --- |
| D1 → PostgreSQL | 中〜大（データが増えるほど増える） | Drizzleのスキーマを `pg-core` に書き換え、マイグレーションを作り直す。データはSQLiteからの移行（`wrangler d1 export` は仮想テーブルを含むと使えず、FTS5を削除してから書き出す）。型の変換（日時、真偽値）。FTSを `pg_trgm` 等へ。テスト基盤の組み替え。Repository 層に閉じ込めれば、Service 層より上は変えずに済む（C-03）。ID形式（ULID のテキスト）はどちらでもそのまま使える |
| PostgreSQL → D1 | 大 | 機能（トランザクション、制約、拡張）の制約に合わせたアプリ側の書き換えが要る。実質、避けたい方向 |
| 同じ方向への準備 | 小 | 移植しやすい書き方に絞る（ULIDのテキストID、DB固有関数を避ける、全文検索はDAOの1か所に閉じ込める）。Repository層以外にDBの知識を漏らさない |

- 決める時期のコスト：現在のスキーマは例の1テーブルだけなので、いまが最も安く方針を決められる。実装が始まってからの移行は、案件・メッセージ・添付などの全テーブルが対象になる。

## 6. 総合の表

評価は、◎＝有利、○＝標準、△＝不利、×＝大きな不利（相対評価）。

| 項目 | D1のみ | PostgreSQL（Neon） | PostgreSQL（Supabase） |
| --- | --- | --- | --- |
| (1) 実装のしやすさ（機能） | △〜○（`batch` と束縛値100個の制約。対処の型は決まっている） | ◎ | ◎ |
| (2) 日本語全文検索 | △（trigramの動作が未確認。1〜2文字は補う必要） | ○（`pg_trgm`。短い語は課題） | ◎（PGroonga。要検証） |
| (3) テストのしやすさ | ◎（現状の基盤をそのまま使う） | △（`pg` が vitest-pool-workers で使えない。DBコンテナ） | △（同左） |
| (4) 運用：復旧・障害・監視 | ◎（Time Travel 30日、1事業者） | ○（Launch 以上で7日。Free は不足。コールドスタート） | ○（日次7日。分単位は月100ドル追加） |
| (4) 運用：レイテンシ | ○（距離は未実測） | △（東京なし。シンガポール） | ○（東京あり） |
| (5) 費用（追加の月額） | ◎（約0ドル） | ○（約10〜15ドル） | △（25ドル。復旧を分単位にすると125ドル） |
| (6) セキュリティ・秘密情報 | ◎（接続情報なし） | △（接続情報・状態ファイル・国外の保存先） | △（接続情報・状態ファイル） |
| (7) 既存の決定・文書への変更 | ◎（変更なし） | ×（広範囲） | ×（広範囲） |
| (8) 将来の変更のしやすさ | ○（D1→PGへの移行は可能。費用は後ほど増える） | ○（先にPGなら逆の移行は不要） | ○ |
| 総合（実装のしやすさ・コスパ） | **有利**（プロジェクト全体の手間と費用が最小。機能面の制約は検証で確かめる） | 機能面は有利、手間・費用・変更量が増える | Neon と同様。検索・東京リージョンは有利、費用は高め |

## 7. 推奨案（参考。決定は利用者）

推奨：**案1「D1のみ」で進める。ただし、10章の検証の結果を見て、切り替えの条件を先に決めておく**。

理由：

1. 追加の費用と契約先が不要で、既に決めた事項（C-127、T-05、requirements、ADR）を変えずに済む。変更範囲が最小。
2. テスト基盤がそのまま使える。PostgreSQLだと、`pg` が vitest-pool-workers で使えず、DBを使うテストの組み立てが二重になり、CIにもDBコンテナが要る。学習用で実装・保守の手間を抑えたい方針に合う。
3. D1の弱点（対話型トランザクションなし、束縛値100個、FTS5のエクスポート不可）には、対処の型がすでに文書にある（design-foundation 4-2）。社内規模（同時50人程度）で足りる見込み。
4. 将来PostgreSQLに移す必要が出ても、Repository層に閉じ込める設計（C-03）なので、移行の範囲は主にスキーマ・テスト基盤・データ移行に限られる。ULIDのテキストIDなら移行時に変えずに済む。
5. 案2の最大の利点は日本語全文検索（特に Supabase の PGroonga）だが、現時点では「D1のFTS5が使えない」と確定したわけではない。検証の前に基盤を重くするのは早い。

案2に切り替える目安（利用者が決める）：

- D1 で trigram が使えず、1文字区切りでも検索の性能（p95で2秒以下。C-88）か、検索語100文字の要件を満たせない。
- 同時承認や採番などで、条件つき1文では表せない処理が多数出て、`batch` の組み立てが複雑になりすぎる。
- 将来、運用先が決まり、時点指定の復旧や外部ツール連携などでPostgreSQLの機能が必要になった。

案2を選ぶ場合の候補（参考）：日本語検索の要件を重視するなら Supabase（東京あり、PGroonga。費用は高め）。費用を抑えるなら Neon Launch（東京なし、`pg_trgm` まで）。

## 8. 利用者が決める必要のある選択

1. DBの方針：案1「D1のみ」（推奨）か、案2「PostgreSQLに一本化」か。
2. 案1の場合：検証（10章）で問題が出たときに、案2へ切り替える条件（7章の目安のとおりでよいか）。ひな形に残るpg経路（`scripts/`、Skill、`docs/tech-stack.md` のpgの注記）を整理する別Issueを立てるか。
3. 案2の場合：事業者（Neon・Supabase・PlanetScale）、リージョン、復旧の水準（分単位まで必要か。月100ドルの追加を許容するか）、国外保存の許容、Terraform の状態ファイルの保存先。
4. 検証（10章）を、#105 の中で行うか、実装の最初のIssueで行うか。

## 9. 未確認・不確かなこと

- D1でtrigramトークナイザが動くか（T-03）。FTS5を含むDBでTime Travelが使えるか（T-03・T-05）。
- D1のレイテンシ（日本からの距離）。D1の置き場所を日本近辺に寄せられるか（ロケーションヒントに日本の記載を確認できなかった）。
- Neon・Supabase・PlanetScale の、日本からのレイテンシ、スケールゼロからの復帰時間、DB側の接続数の上限（いずれも実測・未確認）。
- Hyperdrive のトランザクション単位の接続の使い回しによる制約（セッション変数・アドバイザリロックなど）は、一般知識であり、公式での確認はしていない。
- Supabase で `pg_trgm` が使えること、PGroonga の日本語での動作・短い語の扱いは、今回の取得結果から確認できなかった（PGroongaの説明ページに日本語対応の記載があるのみ）。
- PlanetScale Postgres：リージョン（東京）・料金・バックアップは確認できなかった。
- Neon の公式の Hyperdrive 接続手順は存在する（接続プーリングを無効にした直接接続を使う）。Hyperdrive の「対応データベース」ページには Neon の記載がなかったが、個別の手順ページはある。
- Hyperdrive の送信元IPによるDB側のIP制限、Tunnel の可否は未調査。
- 費用の概算は、使用量の仮定（0.25 CU、月360時間起動、1GB）に基づく。実測ではない。為替・税は含まない。
- 取得はWebFetch（ページ内容の要約）経由で、原文の逐語確認ではない。

## 10. 決める前に実測・検証すべきこと

案1を採る場合、実装の前（#105 の中または最初のIssue）に、次を確かめる。いずれも、テスト専用のD1（本番には接続しない）と架空データ（`[PERF_TEST]` のタグ付き）で行い、後始末の削除スクリプトを用意する。

1. D1で `CREATE VIRTUAL TABLE ... USING fts5(..., tokenize="trigram")` が作れるか（数分）。
2. 100文字の `MATCH` が通るか。`LIKE` の50バイト制限が実際にエラーになるか。
3. FTS5を含むD1で、Time Travel の復元ができるか（検証用のDB）。
4. 30万件規模で、検索語1・2・3・10・50・100文字の p50・p95（T-03 の7章）。
5. 案件番号の採番を、同時に複数の承認要求を送って、重複・欠番の扱いが C-122 どおりか（簡易な負荷試験）。
6. CSV 100人の一括登録を、`batch` の小分けで実装し、途中の失敗で全体が取り消されること。
7. Worker とD1の往復時間（`meta` の `served_by_region`）。日本からの応答時間。

案2を検討する場合の追加の検証：

1. 候補の事業者の無料枠またはテスト用プロジェクトで、Hyperdrive 経由の往復時間（特に Neon のシンガポールと、Supabase の東京）とスケールゼロからの復帰時間。
2. `pg_trgm`／PGroonga での日本語の検索（1・2文字を含む）と性能。
3. vitest-pool-workers を使わない場合のテスト構成（Node上のDBコンテナ）を作り、既存のテストが移せるか。
4. 復旧の水準（Neon の履歴7日、Supabase のバックアップ）で、C-127 の「7日以内」を満たす手順と所要時間。
5. Terraform の状態ファイルの暗号化保存先と、接続情報の受け渡しの手順。

## 出典（Cloudflare・各事業者の公式。2026-11-02に確認）

1. Hyperdrive の料金：https://developers.cloudflare.com/hyperdrive/platform/pricing/
2. Hyperdrive の制限：https://developers.cloudflare.com/hyperdrive/platform/limits/
3. Hyperdrive の始め方（対応DB、Placement、ローカル開発）：https://developers.cloudflare.com/hyperdrive/get-started/
4. Hyperdrive と Neon：https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/neon/
5. Hyperdrive と Supabase：https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/
6. D1 の料金：https://developers.cloudflare.com/d1/platform/pricing/
7. D1 の読み取りレプリケーション：https://developers.cloudflare.com/d1/best-practices/read-replication/
8. Workers の料金：https://developers.cloudflare.com/workers/platform/pricing/
9. Neon の料金：https://neon.com/pricing
10. Neon の拡張機能：https://neon.com/docs/extensions/pg-extensions
11. Neon のリージョン：https://neon.com/docs/introduction/regions
12. Supabase の料金：https://supabase.com/pricing
13. Supabase のバックアップ：https://supabase.com/docs/guides/platform/backups
14. Supabase のリージョン：https://supabase.com/docs/guides/platform/regions
15. Supabase の PGroonga：https://supabase.com/docs/guides/database/extensions/pgroonga
16. PlanetScale Postgres の拡張機能：https://planetscale.com/docs/postgres/extensions
17. 内部の文書：`docs/research/design-foundation.md`、`T-03-japanese-search.md`、`T-05-d1-backup-recovery.md`、`docs/requirements/decision-register.md`（C-88・C-89・C-122・C-126・C-127・I-01〜I-11）、`docs/requirements/nonfunctional.md`、`docs/tech-stack.md`、`docs/adr/0002`・`0003`、`backend/`・`wrangler.jsonc`・`drizzle.config.ts`・`vitest.config.ts`・`scripts/`、`infra/`、Skill「data-access-drizzle」「backend」「env-deploy」
