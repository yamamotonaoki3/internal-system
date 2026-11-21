// #155（155-A）D-14：既存のメッセージの索引の登録（reindexMessages。利用者の決定 D-9）と、migration の更新の試験（計画 5章）。
// 期待は、計画 4.2 の「既存データの登録」（messages.id の順に、未削除の行を batchSize〔既定100〕件読み、行ごとに索引の組を実行し、最後に読んだ ID を返す。
// 組がべき等なので、最初から・返った ID からの再開のどちらでもよい。実行の間の投稿・編集と競合しても不一致にならない）と、
// 計画 5章「更新の試験」（0031 まで当てた DB に架空のメッセージ〔削除済みを含む〕を入れ、検索の migration を当ててから登録を実行し、未削除だけが引ける）から決める。
// 契約（実装前の仮置き）：backend/src/db/search-reindex.ts の reindexMessages(db: Database, { afterId: string | null; batchSize?: number }): Promise<string | null>
//   … 読んだ行がなければ null。afterId は含めない（その ID より大きい行から読む）。
// 検索の migration の選び方：番号で決め打ちせず、本文に search_documents か search_fts を含むものを「検索の migration」とし、その直前までを「更新前」とする。
// 155-B：登録は、行ごとの batch に添付の組も入れる（計画 2章「既存の添付の索引」。関数名・手元の手順は変えない）。期待は、未削除で部屋のあるメッセージに
//   結び付いた添付だけが、名前で引けること（未投稿・削除済みのメッセージの添付は入らない）。2回でも、途中の ID からの再開でも同じ。
// データは架空（testuser_casereq_・[UNIT_TEST]）。
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import { cleanupCaseTestData } from "../../test/case-fixtures";
import {
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import {
  TEST_TAG,
  insertChannel,
  insertMember,
} from "../../test/department-fixtures";
import {
  cleanupRelatedReadsRooms,
  fixedIdAt,
  insertAttachmentRow,
} from "../../test/related-reads-fixtures";
import {
  NO_ATTACHMENT_MISMATCH,
  NO_MISMATCH,
  attachmentIndexMismatches,
  ftsMatchAttachmentIds,
  totalAttachmentDocuments,
  buildSearchIndex,
  cleanupSearchIndex,
  ftsMatchIds,
  indexCountsOf,
  indexMismatches,
  phraseOf,
} from "../../test/search-fixtures";
import { withDatabase } from "./database";
import { withMessages } from "./message.repository";
import { reindexMessages } from "./search-reindex";

const testEnv = env as typeof env & {
  TEST_MIGRATIONS: D1Migration[];
  MIGRATION_UPGRADE_DB?: D1Database;
};

const BASE_MS = 1_872_000_000_000;
const ROOM = fixedIdAt(BASE_MS);
/** 自分のメッセージの ID より小さい ID（ここから読み始める） */
const BEFORE_MINE = fixedIdAt(BASE_MS + 1);
const idOf = (n: number) => fixedIdAt(BASE_MS + 10_000 + n * 1_000);
const atOf = (n: number) =>
  new Date(BASE_MS + 10_000 + n * 1_000).toISOString();

let w: CaseWorld;
let V: string;

async function insertRow(
  db: D1Database,
  seed: { n: number; text: string; deleted?: boolean; parent?: number },
) {
  await db
    .prepare(
      `INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at, deleted_at, deleted_by, parent_message_id)
       VALUES (?, ?, ?, 'テスト太郎', ?, ?, ?, ?, ?)`,
    )
    .bind(
      idOf(seed.n),
      ROOM,
      V,
      `${TEST_TAG}${seed.text}`,
      atOf(seed.n),
      seed.deleted === true ? atOf(seed.n) : null,
      seed.deleted === true ? V : null,
      seed.parent === undefined ? null : idOf(seed.parent),
    )
    .run();
  return idOf(seed.n);
}

const reindexOnce = (
  afterId: string | null,
  batchSize?: number,
): Promise<string | null> =>
  withDatabase(env, (db) =>
    reindexMessages(db, {
      afterId,
      ...(batchSize === undefined ? {} : { batchSize }),
    }),
  );

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = await setupCaseWorld();
  V = w.memberS1.id;
  await insertChannel({
    id: ROOM,
    name: `${TEST_TAG}search-reindex`,
    purpose: "normal",
    departmentId: w.deptS.id,
    visibility: "public",
  });
  await insertMember(ROOM, V);
});

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await cleanupSearchIndex();
  } finally {
    await cleanupRelatedReadsRooms([ROOM]);
    await cleanupCaseTestData();
  }
});

describe("#155 AC-3 D-14 reindexMessages（D-9：既存のメッセージの索引の登録）", () => {
  it("#155 AC-3 D-14: 最初から最後まで実行すると、未削除のメッセージ（返信を含む）だけが引け、削除済みは引けない。不一致0件", async () => {
    const a = await insertRow(env.DB, { n: 1, text: "登録対象の一番" });
    const b = await insertRow(env.DB, { n: 2, text: "登録対象の二番" });
    const deleted = await insertRow(env.DB, {
      n: 3,
      text: "削除済みの三番",
      deleted: true,
    });
    const r = await insertRow(env.DB, {
      n: 4,
      text: "返信の四番です",
      parent: 1,
    });
    await buildSearchIndex(2);
    expect(await ftsMatchIds("登録対象の")).toEqual([a, b]);
    expect(await ftsMatchIds("返信の四番")).toEqual([r]);
    expect(await ftsMatchIds("削除済みの三番")).toEqual([]);
    expect(await indexCountsOf(deleted)).toEqual({ documents: 0, fts: 0 });
    expect(await indexMismatches()).toEqual(NO_MISMATCH);
  });

  it("#155 AC-3 D-14: 記号を除いた本文で入る（申**請**手続 が「申請手続」で引ける）", async () => {
    const id = await insertRow(env.DB, { n: 1, text: "申**請**手続の件" });
    await buildSearchIndex();
    expect(await ftsMatchIds("申請手続")).toEqual([id]);
    expect(await ftsMatchIds("**請")).toEqual([]);
  });

  it("#155 AC-3 D-14: 2回実行しても、写しの数は同じ（べき等）", async () => {
    const ids = [
      await insertRow(env.DB, { n: 1, text: "べき等の確認一" }),
      await insertRow(env.DB, { n: 2, text: "べき等の確認二" }),
    ];
    await buildSearchIndex();
    await buildSearchIndex();
    for (const id of ids)
      expect(await indexCountsOf(id)).toEqual({ documents: 1, fts: 1 });
    expect(await indexMismatches()).toEqual(NO_MISMATCH);
  });

  it("#155 AC-3 D-14: 分割の境目：batchSize 件を読み、最後に読んだ（未削除の）ID を返す。削除済みは数えない。読む行がなければ null", async () => {
    const one = await insertRow(env.DB, { n: 1, text: "分割の確認一" });
    await insertRow(env.DB, { n: 2, text: "分割の確認二", deleted: true });
    const three = await insertRow(env.DB, { n: 3, text: "分割の確認三" });
    const four = await insertRow(env.DB, { n: 4, text: "分割の確認四" });

    const first = await reindexOnce(BEFORE_MINE, 2);
    expect(first).toBe(three);
    // 1回目の後は、読んだ2件だけが入り、残りは入っていない
    expect(await ftsMatchIds("分割の確認")).toEqual([one, three]);

    const second = await reindexOnce(first, 2);
    expect(second).toBe(four);
    expect(await ftsMatchIds("分割の確認")).toEqual([one, three, four]);

    expect(await reindexOnce(four, 2)).toBeNull();
  });

  it("#155 AC-3 D-14: batchSize の既定は 100 件", async () => {
    const statements = Array.from({ length: 101 }, (_, i) =>
      env.DB.prepare(
        `INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at)
         VALUES (?, ?, ?, 'テスト太郎', ?, ?)`,
      ).bind(idOf(i + 1), ROOM, V, `${TEST_TAG}既定件数${i + 1}`, atOf(i + 1)),
    );
    await env.DB.batch(statements);
    expect(await reindexOnce(BEFORE_MINE)).toBe(idOf(100));
    expect(await indexCountsOf(idOf(100))).toEqual({ documents: 1, fts: 1 });
    expect(await indexCountsOf(idOf(101))).toEqual({ documents: 0, fts: 0 });
  });

  it("#155 AC-3 D-14: 途中から再開しても、最初からやり直しても、同じ結果になる", async () => {
    for (let n = 1; n <= 5; n += 1)
      await insertRow(env.DB, { n, text: `再開の確認${n}番` });
    const first = await reindexOnce(BEFORE_MINE, 2);
    // 途中で止まった後に、最初からやり直す
    await buildSearchIndex(2);
    const fromStart = await ftsMatchIds("再開の確認");
    // さらに、止まった所から再開する
    let after = first;
    while (after !== null) after = await reindexOnce(after, 2);
    expect(await ftsMatchIds("再開の確認")).toEqual(fromStart);
    expect(fromStart).toHaveLength(5);
    expect(await indexMismatches()).toEqual(NO_MISMATCH);
  });

  it("#155 AC-3 D-14: 実行の間に投稿・編集があっても、重複・取り残しがなく、不一致0件", async () => {
    await insertRow(env.DB, { n: 1, text: "競合の確認一" });
    const two = await insertRow(env.DB, { n: 2, text: "競合の確認二" });
    await insertRow(env.DB, { n: 3, text: "競合の確認三" });
    const first = await reindexOnce(BEFORE_MINE, 1);
    // 登録の途中で、新しい投稿（索引の組つき）と、まだ読んでいない行の編集
    const posted = idOf(50);
    expect(
      await withMessages(env, (repo) =>
        repo.insertIfOrdered({
          id: posted,
          roomId: ROOM,
          senderId: V,
          senderDisplayName: "テスト太郎",
          body: `${TEST_TAG}競合中の新規投稿`,
          createdAt: atOf(50),
        }),
      ),
    ).toBe(1);
    expect(
      await withMessages(env, (repo) =>
        repo.updateBodyIfModifiable({
          messageId: two,
          userId: V,
          body: `${TEST_TAG}競合中の編集後`,
          editedAt: atOf(51),
        }),
      ),
    ).toBe(1);
    let after = first;
    while (after !== null) after = await reindexOnce(after, 1);
    expect(await indexCountsOf(posted)).toEqual({ documents: 1, fts: 1 });
    expect(await ftsMatchIds("競合中の新規投稿")).toEqual([posted]);
    expect(await ftsMatchIds("競合の確認二")).toEqual([]);
    expect(await ftsMatchIds("競合中の編集後")).toEqual([two]);
    expect(await indexMismatches()).toEqual(NO_MISMATCH);
  });
});

describe("#155 AC-3 155-B 登録（reindexMessages）と添付の名前", () => {
  async function seedAttachments() {
    const one = await insertRow(env.DB, { n: 1, text: "添付登録の一番" });
    const two = await insertRow(env.DB, { n: 2, text: "添付登録の二番" });
    const gone = await insertRow(env.DB, {
      n: 3,
      text: "添付登録の削除済み",
      deleted: true,
    });
    const attach = (messageId: string | null, name: string) =>
      insertAttachmentRow({
        roomId: ROOM,
        uploaderId: V,
        messageId,
        originalName: name,
      });
    return {
      a1: await attach(one, "登録添付名の第一.txt"),
      a2: await attach(two, "登録添付名の第二.txt"),
      a3: await attach(two, "登録添付名の第三.txt"),
      deleted: await attach(gone, "登録添付名の削除済み.txt"),
      pending: await attach(null, "登録添付名の未投稿.txt"),
    };
  }

  it("#155 AC-3 155-B: 最初から最後まで登録すると、未削除のメッセージの添付だけが名前で引け、未投稿・削除済みのメッセージの添付は引けない。不一致0件", async () => {
    const a = await seedAttachments();
    await buildSearchIndex(1);
    expect(await ftsMatchAttachmentIds("登録添付名")).toEqual(
      [a.a1, a.a2, a.a3].sort(),
    );
    expect(await ftsMatchAttachmentIds("登録添付名の削除済み")).toEqual([]);
    expect(await ftsMatchAttachmentIds("登録添付名の未投稿")).toEqual([]);
    expect(await attachmentIndexMismatches()).toEqual(NO_ATTACHMENT_MISMATCH);
  });

  it("#155 AC-3 155-B: 2回登録しても、途中の ID から再開しても、添付の写しの数は同じ", async () => {
    const a = await seedAttachments();
    const first = await reindexOnce(BEFORE_MINE, 1);
    expect(first).not.toBeNull();
    // 途中から再開（返った ID の後ろから最後まで）
    let after = first;
    while (after !== null) after = await reindexOnce(after, 1);
    expect(await totalAttachmentDocuments()).toBe(3);
    await buildSearchIndex();
    await buildSearchIndex(2);
    expect(await totalAttachmentDocuments()).toBe(3);
    expect(await ftsMatchAttachmentIds("登録添付名の第三")).toEqual([a.a3]);
    expect(await attachmentIndexMismatches()).toEqual(NO_ATTACHMENT_MISMATCH);
  });
});

// ---- migration の更新の試験 ----

function upgradeDb(): D1Database {
  const db = testEnv.MIGRATION_UPGRADE_DB;
  if (db === undefined)
    throw new Error(
      "テスト専用の空の D1（MIGRATION_UPGRADE_DB）がありません（vitest.config.ts の miniflare.d1Databases）",
    );
  return db;
}

function splitMigrations() {
  const all = testEnv.TEST_MIGRATIONS;
  const isSearch = (m: D1Migration) =>
    m.queries.some(
      (q) => q.includes("search_documents") || q.includes("search_fts"),
    );
  const index = all.findIndex(isSearch);
  if (index < 0) throw new Error("検索の migration が見つかりません");
  const targets = all.slice(index).filter(isSearch);
  return { before: all.slice(0, index), targets };
}

async function tablesOf(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'",
    )
    .all<{ name: string }>();
  return results.map((r) => r.name);
}

async function columnsOf(db: D1Database, table: string): Promise<string[]> {
  const { results } = await db
    .prepare(`PRAGMA table_info("${table}")`)
    .all<{ name: string }>();
  return results.map((r) => r.name);
}

/** env.DB の行を、更新前の DB の列だけで写す（attachment-publication.upgrade.db.test.ts と同じ方法） */
async function copyRows(target: D1Database) {
  const statements: D1PreparedStatement[] = [
    target.prepare("PRAGMA defer_foreign_keys = ON"),
  ];
  for (const table of await tablesOf(target)) {
    const columns = await columnsOf(target, table);
    const list = columns.map((c) => `"${c}"`).join(", ");
    const { results } = await env.DB.prepare(
      `SELECT ${list} FROM "${table}"`,
    ).all<Record<string, unknown>>();
    for (const row of results)
      statements.push(
        target
          .prepare(
            `INSERT OR IGNORE INTO "${table}" (${list}) VALUES (${columns.map(() => "?").join(", ")})`,
          )
          .bind(...columns.map((c) => row[c] ?? null)),
      );
  }
  await target.batch(statements);
}

describe("#155 AC-3 D-14 migration の更新の試験（既存の行がある DB）", () => {
  it("#155 AC-3 D-14: 検索の migration の直前まで当てた DB に、未削除・削除済みのメッセージがある状態で、検索の migration を当ててから登録を実行すると、未削除だけが引ける", async () => {
    const db = upgradeDb();
    const { before, targets } = splitMigrations();
    expect(targets.length).toBeGreaterThanOrEqual(2);
    await applyD1Migrations(db, before);
    expect(await tablesOf(db)).not.toContain("search_documents");

    const alive = await insertRow(env.DB, { n: 1, text: "更新試験の生存" });
    await insertRow(env.DB, { n: 2, text: "更新試験の削除", deleted: true });
    await copyRows(db);
    const messagesBefore = (
      await db.prepare("SELECT id, body FROM messages ORDER BY id").all()
    ).results;

    await applyD1Migrations(db, [...before, ...targets]);
    expect(await tablesOf(db)).toContain("search_documents");
    expect(await tablesOf(db)).toContain("search_fts");
    // 元の表は変わらない
    expect(
      (await db.prepare("SELECT id, body FROM messages ORDER BY id").all())
        .results,
    ).toEqual(messagesBefore);

    const upgraded = drizzle(db, { schema });
    let after: string | null = null;
    for (let round = 0; round < 100; round += 1) {
      after = await reindexMessages(upgraded, { afterId: after });
      if (after === null) break;
    }
    const match = async (term: string) =>
      (
        await db
          .prepare(
            `SELECT d.ref_id AS id FROM search_fts f JOIN search_documents d ON d.id = f.rowid
             WHERE search_fts MATCH ? ORDER BY d.ref_id`,
          )
          .bind(phraseOf(term))
          .all<{ id: string }>()
      ).results.map((r) => r.id);
    expect(await match("更新試験の生存")).toEqual([alive]);
    expect(await match("更新試験の削除")).toEqual([]);
  });
});
