// #270（270-A）計画 4.7・7章「migration」・project-rules（148-B-2 の migration の更新の試験）：既存の行がある DB に、
// 添付の削除の列（deleted_at・deleted_by）と部分索引（message_attachments_deleted_at_idx。(deleted_at, id)・条件 deleted_at IS NOT NULL）を足す
// migration を適用しても、既存の行が壊れないこと。2列はすべて NULL（削除されていない）であること。
// 方法：attachment-publication.upgrade.db.test.ts と同じ（テストでだけ使う空の D1〔MIGRATION_UPGRADE_DB〕に直前までを適用 → 行を写す → 対象だけを適用）。
// migration は番号で決め打ちせず、message_attachments に deleted_at を足すものを選ぶ。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedCaseAttachment } from "../../test/case-attachment-fixtures";
import {
  cleanupCaseRoomWorld,
  insertCaseWorldDm,
  seedRoomMessage,
  seedRoomReply,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";

const testEnv = env as typeof env & {
  TEST_MIGRATIONS: D1Migration[];
  MIGRATION_UPGRADE_DB?: D1Database;
};

const INDEX = "message_attachments_deleted_at_idx";
let cw: CaseRoomWorld;

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
  const index = all.findIndex((m) =>
    m.queries.some(
      (q) =>
        /message_attachments/.test(q) &&
        /deleted_at/.test(q) &&
        // drizzle の生成は `ADD \`deleted_at\``（COLUMN なし）。書き換え（ADR-0024）では `ADD COLUMN` になる
        /(ADD(\s+COLUMN)?\s|CREATE\s+TABLE)/i.test(q),
    ),
  );
  if (index < 0) throw new Error("添付の削除の migration が見つかりません");
  return { before: all.slice(0, index), target: all[index] as D1Migration };
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

/** env.DB の行を、更新前の DB の列だけで写す（attachment-publication.upgrade.db.test.ts と同じ） */
async function copyRows(target: D1Database) {
  const statements: D1PreparedStatement[] = [
    target.prepare("PRAGMA defer_foreign_keys = ON"),
  ];
  for (const table of await tablesOf(target)) {
    // FTS5 の仮想の表と、その内部の表は写さない（検索の索引はこの試験の対象でない）
    if (table.startsWith("search_fts")) continue;
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

const ROW_COLUMNS =
  "id, room_id, thread_parent_id, message_id, uploader_id, storage_key, original_name, kind, content_type, size_bytes, created_at, publication_visibility";

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  cw = await setupCaseRoomWorld(1740);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseRoomWorld();
});

describe("#270 計画 4.7 migration の更新（既存の行がある状態から）", () => {
  it("#270 AC-1: 既存の添付の件数・列・結び付けが保たれ、deleted_at・deleted_by はすべて NULL。部分索引 (deleted_at, id) がある", async () => {
    const db = upgradeDb();
    const { before, target } = splitMigrations();
    await applyD1Migrations(db, before);
    expect(await columnsOf(db, "message_attachments")).not.toContain(
      "deleted_at",
    );

    const dm = await insertCaseWorldDm(cw.w.memberS1.id, cw.w.memberD1.id);
    const parent = await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 1);
    const reply = await seedRoomReply(
      cw.open.roomId,
      parent,
      cw.w.memberD1.id,
      2,
    );
    const normal = await seedRoomMessage(cw.normal, cw.w.memberS1.id, 3);
    const dmMessage = await seedRoomMessage(dm, cw.w.memberD1.id, 4);
    const seeds = [
      {
        n: 1,
        roomId: cw.open.roomId,
        uploaderId: cw.w.memberS1.id,
        messageId: parent,
      },
      {
        n: 2,
        roomId: cw.open.roomId,
        uploaderId: cw.w.memberD1.id,
        messageId: reply,
        threadParentId: parent,
      },
      {
        n: 3,
        roomId: cw.open.roomId,
        uploaderId: cw.w.memberS1.id,
        messageId: null,
      },
      {
        n: 4,
        roomId: cw.normal,
        uploaderId: cw.w.memberS1.id,
        messageId: normal,
      },
      { n: 5, roomId: dm, uploaderId: cw.w.memberD1.id, messageId: dmMessage },
      { n: 6, roomId: dm, uploaderId: cw.w.memberS1.id, messageId: null },
    ];
    for (const seed of seeds) await seedCaseAttachment(seed);

    await copyRows(db);
    const select = `SELECT ${ROW_COLUMNS} FROM message_attachments ORDER BY id`;
    const beforeRows = (await db.prepare(select).all()).results;
    expect(beforeRows).toHaveLength(seeds.length);

    await applyD1Migrations(db, [...before, target]);

    const columns = await columnsOf(db, "message_attachments");
    expect(columns).toContain("deleted_at");
    expect(columns).toContain("deleted_by");
    expect((await db.prepare(select).all()).results).toEqual(beforeRows);
    const marked = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM message_attachments WHERE deleted_at IS NOT NULL OR deleted_by IS NOT NULL",
      )
      .first<{ n: number }>();
    expect(marked?.n).toBe(0);
    const linked = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM message_attachments a JOIN messages m ON m.id = a.message_id",
      )
      .first<{ n: number }>();
    expect(linked?.n).toBe(4);

    // 部分索引：(deleted_at, id) の順で、条件 deleted_at IS NOT NULL
    const { results: indexColumns } = await db
      .prepare(`PRAGMA index_info("${INDEX}")`)
      .all<{ seqno: number; name: string }>();
    expect(
      [...indexColumns].sort((a, b) => a.seqno - b.seqno).map((c) => c.name),
    ).toEqual(["deleted_at", "id"]);
    const definition = await db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?",
      )
      .bind(INDEX)
      .first<{ sql: string }>();
    expect(definition?.sql ?? "").toMatch(
      /where\s+"?deleted_at"?\s+is\s+not\s+null/i,
    );
  });

  it("#270 計画 4.7: deleted_by は users を参照する（外部キー）", async () => {
    const { results } = await env.DB.prepare(
      'PRAGMA foreign_key_list("message_attachments")',
    ).all<{ from: string; table: string; to: string }>();
    expect(results).toContainEqual(
      expect.objectContaining({ from: "deleted_by", table: "users", to: "id" }),
    );
  });
});
