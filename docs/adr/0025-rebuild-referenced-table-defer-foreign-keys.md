# 0025：他の表から参照される rooms の CHECK を変えるための作り直し（D1 では PRAGMA foreign_keys=OFF が効かないため defer_foreign_keys に置き換える）

- 状態：採用
- 日付：2026-11-12
- 関係：Issue #136（最初の適用：migration 0016）、[ADR-0024](0024-add-column-rewrite-for-table-rebuild.md)、[ADR-0005](0005-database-d1-only.md)、Skill「data-access-drizzle」、[project-rules.md](../project-rules.md)、[docs/design/dms.md](../design/dms.md)

## 背景

Issue #136（ダイレクトメッセージ）で、利用者は、部屋の種類の名前を文書（`data-model.md`）の`'direct'`に合わせることを選んだ（2026-11-12）。実装済みの`rooms.kind`は`'channel'`・`'conversation'`の2値で、DB の CHECK 制約（`rooms_kind_check`）で守っている。

- SQLite は、既存の表の CHECK だけを変える文（`ALTER TABLE … ALTER CONSTRAINT`等）を持たない。CHECK を変えるには、表を作り直す（`__new_rooms`の作成 → 全行コピー → `DROP TABLE rooms` → `RENAME`）必要がある。`npm run db:generate`も、この作り直しを生成する
- `rooms`は、`channels.room_id`（migration 0008）と`messages.room_id`（migration 0012）から外部キーで参照されている。子の表に行があるとき、`DROP TABLE rooms`は外部キーの違反になり得る
- 生成される migration は、drizzle-kit が定型で出力する`PRAGMA foreign_keys=OFF`で外部キーを止めてから作り直す前提で書かれている
- [ADR-0024](0024-add-column-rewrite-for-table-rebuild.md)は列の追加だけを対象にしており、この場面（制約だけの変更）は範囲外である。0024は「列の追加以外で作り直しが生成された場合は、止まって利用者に確認する」と定めている

## リハーサルの事実（2026-11-12。Issue #136のコメントに記録）

使い捨てのローカル D1（スクラッチのフォルダ。リポジトリ・開発用 DB・E2E 用 DB は変更なし）で、0000〜0015 を適用して架空データを入れた DB に 0016 を適用した。

- 生成物のままの 0016 は**不合格**だった
  - D1 では`PRAGMA foreign_keys=OFF`が効かず、外部キーは強制されたままだった（存在しない`room_id`の`messages`を INSERT すると、PRAGMA の直後も`DROP`の直前も`FOREIGN KEY constraint failed`になることで確かめた）
  - データの入った DB では、`DROP TABLE rooms`が`FOREIGN KEY constraint failed`で失敗した（migration 全体が取り消され、変更は残らない）
  - 空の新しい DB への 0000〜0016 の全適用も失敗した。migration 0011 が入れる「全社連絡」のチャンネルの行が、子として`rooms`を参照しているため。本番の D1 でも失敗する見込み
- migration は原子的に実行される（最後の文が失敗すると、それまでの変更と`d1_migrations`の記録が取り消される）ことも確かめた
- PRAGMA の2行を`PRAGMA defer_foreign_keys = on;`と`PRAGMA defer_foreign_keys = off;`に置き換えた版は**合格**だった。次の7項目をすべて満たした
  - (a) データのある DB への適用に成功した
  - (b) `foreign_key_check`が0行
  - (c) `integrity_check`が ok（D1 経由の PRAGMA は`SQLITE_AUTH`で使えないため、DB ファイルを読み取り専用で開いて確かめた）
  - (d) `rooms`・`channels`・`messages`・`channel_members`・`notifications`の件数が前後で同じ
  - (e) `rooms`の主キー・DEFAULT・新しい CHECK があり、`channels`・`messages`の外部キーが`rooms(id)`を指したまま
  - (f) `'direct'`は入り、`'conversation'`・`'other'`は拒否された
  - (g) 新しい DB への全適用にも成功した

## 選択肢

A. DB の値は`'conversation'`のままにし、API・型・文書・画面の名前だけを`direct`にする（Repository に変換の定義元を1か所置く）

- 良い点：`rooms`を作り直さない
- 悪い点：DB の値と文書・API の名前が食い違い続ける。利用者が`'direct'`に合わせることを選んだ決定に反する

B. 子の表（`channels`・`messages`・`channel_members`）も子から順に作り直す

- 良い点：生成物の手順を変えずに済む可能性がある
- 悪い点：作り直す表が増え、全行コピーの範囲と本番での失敗の危険が広がる

C. CHECK をやめて、zod と型だけで値を守る

- 良い点：作り直しが不要になる
- 悪い点：CHECK を外すための作り直しがやはり要り、防御の層だけが減る

D. 生成された 0016 の PRAGMA の2行だけを、`defer_foreign_keys`に置き換えて使う

- 良い点：D1 で実際に通ることをリハーサルで確かめた。`defer_foreign_keys`は migration 0009 で使用実績がある。表の定義・コピーの文は生成物のまま
- 悪い点：生成された migration を手で書き換えるため、Skill の「migration を手で書き換えない」を緩める

## 決定

選択肢Dを採る。利用者が2026-11-12に、生成物で安全に通らない場合に限る条件つきで承認した。リハーサルで条件に当たったため、migration 0016 に適用した。

- 範囲は**0016の1本だけ**。書き換えるのは、`PRAGMA foreign_keys=OFF`の行と`PRAGMA foreign_keys=ON`の行の2行を、`PRAGMA defer_foreign_keys = on;`と`PRAGMA defer_foreign_keys = off;`に置き換えることだけ。表の定義・コピー・DROP・RENAME の文は生成されたまま
- 書き換えた migration の先頭に、このADRの番号をコメントで書く
- `meta/<n>_snapshot.json`と`_journal.json`は、生成されたものを使う。書き換えない。書き換えたあとに`npm run db:generate`をもう一度実行し、差分が出ないことを確かめた
- 既存の migration は変えない

### 守ること（今回の適用で守った手順。同じ場面でも守る）

1. 適用の前に、対象の行の件数を確かめる（`SELECT COUNT(*) FROM rooms WHERE kind='conversation'`が0件。1件以上なら CHECK の違反で migration 全体が失敗するため、止まって利用者に戻す）
2. 使い捨ての D1 でリハーサルをする。判定は上の(a)〜(g)を使い、1つでも満たさなければ採らない
3. snapshot と journal は生成されたものを使う
4. `db:generate`の再実行で差分が出ないこと

### 今後

**他の表から参照される表（`rooms`のほか、`users`・`departments`など）をまた作り直す場合は、この決定を使い回さず、止まって利用者に戻す。** このADRは、0016の1本の例外であり、一般ルールではない（[ADR-0024](0024-add-column-rewrite-for-table-rebuild.md)と違う点）。

## 本番への適用の手順（AI は実行しない。利用者が行う）

本番への適用は、この決定に含まれない。別途、利用者の承認が必要である。

1. 本番で`SELECT COUNT(*) FROM rooms WHERE kind='conversation'`が0件であることを確かめる
2. `wrangler d1 time-travel info`でブックマーク（時点）を記録する。戻すときは`wrangler d1 time-travel restore --bookmark`を使う
3. migration 0016・0017 を、**コードのデプロイより先に**適用する（旧コードは`'channel'`だけを書くので、先に適用しても両立する）
4. 適用の後で、`foreign_key_check`が0行であることと、`rooms`・`channels`・`messages`・`channel_members`の件数が適用前と同じであることを確かめる
5. 失敗したら止める。コードをデプロイせず、利用者に報告して判断を仰ぐ

## 理由

D1 では`PRAGMA foreign_keys=OFF`が効かず、外部キーが常に強制される。一方、`defer_foreign_keys`は、migration の実行中（トランザクションの中）だけ外部キーの検査を後回しにし、コミットの時点で全体の整合を検査する。作り直しの途中で`rooms`が一瞬なくなっても、コミットの時点で子の行が新しい`rooms`を指していれば違反にならない。コミットの時点でも違反が残れば、migration 全体が取り消されるため、データは壊れない。

## 影響

- Skill「data-access-drizzle」の「migrationを手で書き換えない」を、**0016の1本に限って**緩める。ほかの場面では、これまでどおり書き換えない
- 手作成 migration の例外（ADR-0018・0021・0022の3本）には数えない。生成された migration の PRAGMA の2行を直すだけで、手で新規に作るものではない
- `project-rules.md`の「ハーネスのルールより緩めるもの」の表に1行足した
- 参照される表の作り直しが今後必要になったときは、止まって利用者に確認する（上の「今後」）
- 本番への適用は、この決定に含まれない（上の手順を、利用者が承認のうえ行う）
- D1 の`PRAGMA foreign_keys=OFF`が効かないことは、Issue #136 の時点のリハーサルの結果である。D1 の仕様が変わったと分かったときは、この ADR を見直す
