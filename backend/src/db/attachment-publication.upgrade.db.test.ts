// #148（148-B-2）5-2 AC-8・計画 6.2・10章「migration の更新」（Q-1 の案 A。利用者の承認済み）：既存の行がある DB に、
// 公開範囲の列を足す migration を適用しても、既存の行が壊れないこと。
// 方法：テストでだけ使う空の D1（バインディング MIGRATION_UPGRADE_DB。vitest.config.ts の miniflare.d1Databases に足す）に、
//   公開範囲の migration の直前までを applyD1Migrations で適用 → 通常のチャンネル・DM・案件の部屋の添付（投稿済み・未投稿・返信）を入れる →
//   公開範囲の migration だけを適用 → 件数・既存の列・message_id の結び付けが保たれ、新しい列がすべて participants_only。
// migration は番号で決め打ちせず、本文に publication_visibility を含むものを「公開範囲の migration」として選ぶ。
// 行の準備：いつもの DB（env.DB）に世界と添付を作り、その全部の表の行を、更新前の DB の列だけで写す（外部キーは batch の終わりで確かめる。
//   migration の初期データと重なる行は写さない）。写した後、添付の行が7件そろっていることを確かめてから 0030 を適用する。
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
    m.queries.some((q) => q.includes("publication_visibility")),
  );
  if (index < 0) throw new Error("公開範囲の migration が見つかりません");
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

/**
 * env.DB の行を、更新前の DB の列だけで写す（1つの batch。外部キーは終わりで確かめる）。
 * migration の初期データ（ロール・権限など）は両方の DB に同じ値で入っているため、重なる行は写さない（OR IGNORE）。
 */
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

const ROW_COLUMNS =
  "id, room_id, thread_parent_id, message_id, uploader_id, storage_key, original_name, kind, content_type, size_bytes, created_at";

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  cw = await setupCaseRoomWorld(1660);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseRoomWorld();
});

describe("#148 AC-8 計画 Q-1 migration の更新（既存の行がある状態から）", () => {
  it("#148 AC-8 D8: 既存の添付（通常のチャンネル・DM・案件。投稿済み・未投稿・返信）の件数・列・結び付けが保たれ、新しい列はすべて participants_only", async () => {
    const db = upgradeDb();
    const { before, target } = splitMigrations();
    await applyD1Migrations(db, before);
    expect(await columnsOf(db, "message_attachments")).not.toContain(
      "publication_visibility",
    );

    const dm = await insertCaseWorldDm(cw.w.memberS1.id, cw.w.memberD1.id);
    const caseParent = await seedRoomMessage(
      cw.open.roomId,
      cw.w.memberS1.id,
      1,
    );
    const caseReply = await seedRoomReply(
      cw.open.roomId,
      caseParent,
      cw.w.memberD1.id,
      2,
    );
    const normalMessage = await seedRoomMessage(cw.normal, cw.w.memberS1.id, 3);
    const dmMessage = await seedRoomMessage(dm, cw.w.memberD1.id, 4);
    const seeds = [
      {
        n: 1,
        roomId: cw.open.roomId,
        uploaderId: cw.w.memberS1.id,
        messageId: caseParent,
      },
      {
        n: 2,
        roomId: cw.open.roomId,
        uploaderId: cw.w.memberD1.id,
        messageId: caseReply,
        threadParentId: caseParent,
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
        messageId: normalMessage,
      },
      {
        n: 5,
        roomId: cw.normal,
        uploaderId: cw.w.memberD1.id,
        messageId: null,
      },
      { n: 6, roomId: dm, uploaderId: cw.w.memberD1.id, messageId: dmMessage },
      { n: 7, roomId: dm, uploaderId: cw.w.memberS1.id, messageId: null },
    ];
    for (const seed of seeds) await seedCaseAttachment(seed);

    await copyRows(db);
    const select = `SELECT ${ROW_COLUMNS} FROM message_attachments ORDER BY id`;
    const beforeRows = (await db.prepare(select).all()).results;
    expect(beforeRows).toHaveLength(seeds.length);

    await applyD1Migrations(db, [...before, target]);

    expect(await columnsOf(db, "message_attachments")).toContain(
      "publication_visibility",
    );
    expect((await db.prepare(select).all()).results).toEqual(beforeRows);
    const { results } = await db
      .prepare(
        "SELECT publication_visibility AS v, COUNT(*) AS n FROM message_attachments GROUP BY v",
      )
      .all<{ v: string; n: number }>();
    expect(results).toEqual([{ v: "participants_only", n: seeds.length }]);
    // 結び付け：投稿済みの添付の message_id が、同じメッセージの行を指したまま
    const linked = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM message_attachments a JOIN messages m ON m.id = a.message_id",
      )
      .first<{ n: number }>();
    expect(linked?.n).toBe(4);
  });
});
