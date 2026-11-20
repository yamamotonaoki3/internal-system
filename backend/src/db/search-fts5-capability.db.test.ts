// #155 T-0: 手元の D1（Miniflare／workerd）で、FTS5 の trigram による日本語の検索が、計画の形で使えるかを確かめる。
//   計画の形：自分で中身を持つ FTS5 の表（tokenize='trigram'）＋対応の表（整数の主キー）、rowid を指定した追加・削除、batch の中での更新。
//   このテストは、migration・本体のコードに頼らず、一時的な名前の表を作って、終わりに消す。
//   「実際の値を確かめて固定する」と書いたものは、手元の D1 で確かめた値を期待に固定している（3・7・8 の一部）。
// データは架空（本文に [UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const FTS = "tmp_t0_search_fts";
const DOCS = "tmp_t0_search_documents";
const PLAIN = "tmp_t0_plain";
const TAG = "[UNIT_TEST]";

const db = env.DB;

/** 句として引用する（" は重ねる）。計画の検索語の渡し方 */
const phrase = (term: string) => `"${term.replaceAll('"', '""')}"`;

async function cleanup(): Promise<void> {
  await db.prepare(`DROP TABLE IF EXISTS ${FTS}`).run();
  await db.prepare(`DROP TABLE IF EXISTS ${DOCS}`).run();
  await db.prepare(`DROP TABLE IF EXISTS ${PLAIN}`).run();
}

async function setup(): Promise<void> {
  await cleanup();
  await db
    .prepare(`CREATE VIRTUAL TABLE ${FTS} USING fts5(body, tokenize='trigram')`)
    .run();
  await db
    .prepare(
      `CREATE TABLE ${DOCS} (id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT NOT NULL UNIQUE)`,
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE ${PLAIN} (id TEXT PRIMARY KEY, v INTEGER NOT NULL, name TEXT)`,
    )
    .run();
}

async function addDoc(ref: string, body: string): Promise<number> {
  const [doc, fts] = await db.batch([
    db.prepare(`INSERT INTO ${DOCS} (ref) VALUES (?)`).bind(ref),
    db
      .prepare(
        `INSERT INTO ${FTS} (rowid, body) VALUES ((SELECT id FROM ${DOCS} WHERE ref = ?), ?)`,
      )
      .bind(ref, `${TAG} ${body}`),
  ]);
  expect(fts?.success).toBe(true);
  return doc?.meta.last_row_id ?? -1;
}

async function matchRefs(term: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT d.ref AS ref FROM ${FTS} f JOIN ${DOCS} d ON d.id = f.rowid
       WHERE ${FTS} MATCH ? ORDER BY d.ref`,
    )
    .bind(phrase(term))
    .all<{ ref: string }>();
  return results.map((r) => r.ref);
}

async function instrRefs(term: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT d.ref AS ref FROM ${FTS} f JOIN ${DOCS} d ON d.id = f.rowid
       WHERE instr(lower(f.body), lower(?)) > 0 ORDER BY d.ref`,
    )
    .bind(term)
    .all<{ ref: string }>();
  return results.map((r) => r.ref);
}

async function countMatch(term: string): Promise<number> {
  const row = await db
    .prepare(`SELECT count(*) AS n FROM ${FTS} WHERE ${FTS} MATCH ?`)
    .bind(phrase(term))
    .first<{ n: number }>();
  return row?.n ?? -1;
}

beforeEach(setup);
afterEach(cleanup);

describe("#155 T-0 FTS5 trigram（手元の D1）", () => {
  it("#155 T-0-1: FTS5 の trigram の表が作れる（PRAGMA compile_options は D1 では使えない）", async () => {
    // 手元の D1 では PRAGMA compile_options は許可されない（SQLITE_AUTH）ため、表が作れることで代える
    await expect(db.prepare("PRAGMA compile_options").all()).rejects.toThrow(
      /SQLITE_AUTH/,
    );
    const exists = await db
      .prepare("SELECT name FROM sqlite_master WHERE name = ?")
      .bind(FTS)
      .first();
    expect(exists).not.toBeNull();
  });

  it("#155 T-0-2: 日本語（ひらがな・カタカナ・漢字・英数字・混在）を3文字以上の語で引ける", async () => {
    await addDoc("hira", "おはようございます、よろしくおねがいします");
    await addDoc("kata", "プロジェクトのスケジュールを確認します");
    await addDoc("kanji", "見積書の提出期限を再確認してください");
    await addDoc("alnum", "Invoice INV2024 is ready");
    await addDoc("mixed", "案件ABC123の見積もりをレビュー依頼");
    await addDoc("other", "全く関係のない文章です");

    expect(await matchRefs("よろしくお")).toEqual(["hira"]);
    expect(await matchRefs("スケジュール")).toEqual(["kata"]);
    expect(await matchRefs("見積書")).toEqual(["kanji"]);
    expect(await matchRefs("INV2024")).toEqual(["alnum"]);
    expect(await matchRefs("ABC123の見")).toEqual(["mixed"]);
    expect(await matchRefs("存在しない語です")).toEqual([]);
  });

  it("#155 T-0-2: 英字の大文字・小文字を区別しない（trigram の既定）", async () => {
    await addDoc("alnum", "Invoice INV2024 is ready");
    expect(await matchRefs("invoice")).toEqual(["alnum"]);
    expect(await matchRefs("INVOICE")).toEqual(["alnum"]);
    expect(await matchRefs("inv2024")).toEqual(["alnum"]);
  });

  it("#155 T-0-3: 1〜2文字の語は MATCH で0件、instr(lower()) なら引ける", async () => {
    await addDoc("a", "見積書の提出");
    await addDoc("b", "Invoice");
    expect(await matchRefs("見")).toEqual([]);
    expect(await matchRefs("見積")).toEqual([]);
    expect(await matchRefs("in")).toEqual([]);
    expect(await instrRefs("見積")).toEqual(["a"]);
    expect(await instrRefs("IN")).toEqual(["b"]);
    expect(await instrRefs("見")).toEqual(["a"]);
  });

  it("#155 T-0-4: FTS5 の構文の文字を含む入力は、句として引用してバインドすれば、その文字列を含む行だけが返る", async () => {
    const bodies: Record<string, string> = {
      quote: 'He said "hello" loudly',
      star: "pattern a*b here",
      caret: "x^2 is square",
      colon: "key:value pair",
      paren: "call (foo) now",
      and: "this AND that",
      or: "this OR that",
      not: "this NOT that",
      near: "this NEAR that",
      bracket: "user[1] list",
      plain: "nothing special here",
    };
    for (const [ref, body] of Object.entries(bodies)) await addDoc(ref, body);

    expect(await matchRefs('"hello"')).toEqual(["quote"]);
    expect(await matchRefs("a*b")).toEqual(["star"]);
    expect(await matchRefs("x^2")).toEqual(["caret"]);
    expect(await matchRefs("key:value")).toEqual(["colon"]);
    expect(await matchRefs("(foo)")).toEqual(["paren"]);
    expect(await matchRefs("this AND that")).toEqual(["and"]);
    expect(await matchRefs("this OR that")).toEqual(["or"]);
    expect(await matchRefs("this NOT that")).toEqual(["not"]);
    expect(await matchRefs("this NEAR that")).toEqual(["near"]);
    expect(await matchRefs("user[1]")).toEqual(["bracket"]);
    // 含まれない構文の語は0件（演算子として解釈されない）
    expect(await matchRefs("foo AND zzz")).toEqual([]);
    expect(await matchRefs("zzz*")).toEqual([]);
    expect(await matchRefs('"')).toEqual([]);
  });

  it("#155 T-0-5: rowid を指定して追加・削除でき、消した後は引けず、同じ番号を入れ直せる", async () => {
    const id = await addDoc("d1", "見積書の提出期限");
    expect(await matchRefs("見積書")).toEqual(["d1"]);

    const del = await db
      .prepare(`DELETE FROM ${FTS} WHERE rowid = ?`)
      .bind(id)
      .run();
    expect(del.success).toBe(true);
    expect(await matchRefs("見積書")).toEqual([]);

    await db
      .prepare(`INSERT INTO ${FTS} (rowid, body) VALUES (?, ?)`)
      .bind(id, `${TAG} 別の本文：請求書の送付`)
      .run();
    expect(await matchRefs("請求書")).toEqual(["d1"]);
    expect(await matchRefs("見積書")).toEqual([]);
  });

  it("#155 T-0-6: batch で通常の表と FTS5 の表を混ぜて書け、途中で失敗すると FTS5 の表も取り消される", async () => {
    await db.batch([
      db.prepare(`INSERT INTO ${PLAIN} (id, v) VALUES ('p1', 1)`),
      db
        .prepare(`INSERT INTO ${FTS} (rowid, body) VALUES (101, ?)`)
        .bind(`${TAG} コミットされる本文`),
    ]);
    expect(await countMatch("コミットされる")).toBe(1);

    await expect(
      db.batch([
        db
          .prepare(`INSERT INTO ${FTS} (rowid, body) VALUES (102, ?)`)
          .bind(`${TAG} 取り消される本文`),
        db.prepare(`INSERT INTO ${PLAIN} (id, v) VALUES ('p2', NULL)`),
      ]),
    ).rejects.toThrow();

    expect(await countMatch("取り消される")).toBe(0);
    const plain = await db
      .prepare(`SELECT count(*) AS n FROM ${PLAIN}`)
      .first<{ n: number }>();
    expect(plain?.n).toBe(1);
  });

  it("#155 T-0-7: UPDATE の直後の changes() を見る文（guardChanges の形）が、FTS5 への書き込みを後ろに足してもずれない", async () => {
    await db
      .prepare(`INSERT INTO ${PLAIN} (id, v, name) VALUES ('p1', 1, 'before')`)
      .run();
    // guardChanges と同じ形：直前の文の変更行数が期待と違えば v が NULL になり（NOT NULL 違反）、batch 全体が失敗する
    const guard = (expected: number) =>
      db.prepare(
        `UPDATE ${PLAIN} SET v = CASE WHEN changes() = ${expected} THEN v ELSE NULL END WHERE id = 'p1'`,
      );

    const results = await db.batch([
      db.prepare(`UPDATE ${PLAIN} SET name = 'after' WHERE id = 'p1'`),
      guard(1),
      db
        .prepare(`INSERT INTO ${FTS} (rowid, body) VALUES (201, ?)`)
        .bind(`${TAG} 追加した本文`),
      db.prepare(`SELECT changes() AS c`),
      guard(1),
      db.prepare(`DELETE FROM ${FTS} WHERE rowid = 201`),
      db.prepare(`SELECT changes() AS c`),
      guard(1),
    ]);
    expect(results.every((r) => r.success)).toBe(true);

    // 実際の値を確かめて固定する（手元の D1）
    // D1 の meta.changes は、FTS5 の内部の表（影の表）への書き込みも数えるため、INSERT は 3、DELETE は 6 になる。SQL の changes() は 1
    expect(results[0]?.meta.changes).toBe(1);
    expect(results[2]?.meta.changes).toBe(3);
    expect(results[5]?.meta.changes).toBe(6);
    expect((results[3]?.results[0] as { c: number }).c).toBe(1);
    expect((results[6]?.results[0] as { c: number }).c).toBe(1);

    // 期待と違えば全体が失敗する（ガードが効いている）
    await expect(
      db.batch([
        db.prepare(`UPDATE ${PLAIN} SET name = 'again' WHERE id = 'p1'`),
        db
          .prepare(`INSERT INTO ${FTS} (rowid, body) VALUES (202, ?)`)
          .bind(`${TAG} 追加`),
        guard(0),
      ]),
    ).rejects.toThrow();
  });

  it("#155 T-0-8: 100文字の語・空の語・空白だけの語の扱い（手元の D1 の値を固定）", async () => {
    await addDoc("long", "あ".repeat(100));
    await addDoc("short", "あいう");

    // 100文字の語：エラーにならず、含む行だけが返る
    expect(await matchRefs("あ".repeat(100))).toEqual(["long"]);

    // 空の語・空白だけの語は、句として引用すると 0 件（エラーにしない）。実際の値を固定する
    expect(await matchRefs("")).toEqual([]);
    expect(await matchRefs("   ")).toEqual([]);
  });
});
