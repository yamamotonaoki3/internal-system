// #155（155-B）M-1：種類の CHECK を変える migration（利用者の決定 B-1・B-2。計画 R1-1）の更新の試験。
// 決定 B-1：表の作り直しの前に、索引の写し（search_documents・search_fts の行）を全部消す手書きの migration（0034）を置き、
//   その後に生成のままの作り直し（0035）を当て、登録し直す。B-2：CHECK は message・attachment・case_title。
// 背景（計画 R1-1）：search_documents の id は AUTOINCREMENT。作り直し（新しい表 → id ごと写す → DROP → RENAME）で採番の履歴（sqlite_sequence）を失い、
//   最大の番号が使い回される。対応の行のない古い検索用の行（孤立）が残っていると、新しい対応の行が古い文と結び付き、別のメッセージの文で一致する。
// 期待（計画 R1-1 の M-1・2回目の計画レビューの軽微 (2)）：
//   0033 まで当てた DB に、連続する番号の写しを入れ、最大の番号の対応の行だけを消して検索用の行を残す（孤立）→
//   ① 0034 の後、両方の表が0件
//   ② 0034 と 0035 の間・0035 の後で再登録の前、の両方の区間に、投稿・編集・削除を挟んでも、古い文の語で0件・新しい語で引ける（MATCH・instr の両方）
//   ③ 再登録（reindexMessages）の後、索引の対象のメッセージの数と写しの数が一致し、不一致0件。0033 の時点からある添付も登録し直される
//   ④ CHECK は attachment・case_title を通し、ほかの値を拒否
//   対照：0034 を飛ばして 0035 だけを当てると、孤立した番号が使い回され、新しい投稿が古い文の語で誤って一致する（試験が問題を検出できることの確認。必須）。
// migration の選び方（番号で決め打ちしない。project-rules 53行）：
//   「索引を空にする migration」＝本文に DELETE FROM search_fts と DELETE FROM search_documents の両方を含むもの。
//   「種類を変える migration」＝本文に search_documents_kind_check と 'attachment' の両方を含むもの。前者より後ろにあること。
// 方法：テスト専用の空の D1（MIGRATION_UPGRADE_DB）。いつもの DB（env.DB）に世界を作り、その行を更新前の列で写す（search-reindex.db.test.ts と同じ）。
//   0033 の時点の写しは、当時の形（kind='message'・本文の写し）で直接入れる（いまのコードの組は添付の写しも入れ、当時の CHECK に反するため）。
// データは架空（testuser_casereq_・[UNIT_TEST]）。
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import { AUTH_TRACE_PREFIX } from "../../test/auth-fixtures";
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
} from "../../test/related-reads-fixtures";
import {
  NO_ATTACHMENT_MISMATCH,
  NO_MISMATCH,
  attachmentIndexMismatches,
  indexMismatches,
  phraseOf,
} from "../../test/search-fixtures";
import { createMessageRepository } from "./message.repository";
import { reindexMessages } from "./search-reindex";

const testEnv = env as typeof env & {
  TEST_MIGRATIONS: D1Migration[];
  MIGRATION_UPGRADE_DB?: D1Database;
};

const BASE_MS = 1_881_000_000_000;
const ROOM = fixedIdAt(BASE_MS);
const idOf = (n: number) => fixedIdAt(BASE_MS + 10_000 + n * 1_000);
const atOf = (n: number) =>
  new Date(BASE_MS + 10_000 + n * 1_000).toISOString();

/** 孤立させる古い文（3文字以上の語と、ほかの行に無い2文字の語） */
const ORPHAN_WORD = "孤立旧語の議題";
const ORPHAN_PAIR = "鴎鷺";

let w: CaseWorld;
let V: string;

function upgradeDb(): D1Database {
  const db = testEnv.MIGRATION_UPGRADE_DB;
  if (db === undefined)
    throw new Error(
      "テスト専用の空の D1（MIGRATION_UPGRADE_DB）がありません（vitest.config.ts の miniflare.d1Databases）",
    );
  return db;
}

const deletesFrom = (m: D1Migration, table: string) =>
  m.queries.some((q) =>
    new RegExp(`DELETE\\s+FROM\\s+[\`"]?${table}[\`"]?`, "i").test(q),
  );

function splitMigrations() {
  const all = testEnv.TEST_MIGRATIONS;
  const emptyIndex = all.findIndex(
    (m) => deletesFrom(m, "search_fts") && deletesFrom(m, "search_documents"),
  );
  if (emptyIndex < 0)
    throw new Error(
      "索引を空にする migration（DELETE FROM search_fts と DELETE FROM search_documents を含むもの）が見つかりません",
    );
  const kindIndex = all.findIndex(
    (m) =>
      m.queries.some((q) => q.includes("search_documents_kind_check")) &&
      m.queries.some((q) => q.includes("'attachment'")),
  );
  if (kindIndex < 0)
    throw new Error(
      "種類を変える migration（search_documents_kind_check と 'attachment' を含むもの）が見つかりません",
    );
  if (kindIndex <= emptyIndex)
    throw new Error(
      "種類を変える migration が、索引を空にする migration より前にあります",
    );
  return {
    before: all.slice(0, emptyIndex),
    empty: all[emptyIndex] as D1Migration,
    between: all.slice(emptyIndex + 1, kindIndex),
    kind: all[kindIndex] as D1Migration,
    // 種類を変える migration より後ろのもの（検索と関係しない。例：添付の削除の列）。今のコードは、これらの列を読む
    rest: all.slice(kindIndex + 1),
  };
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
 * テスト専用の D1 を空に戻す（ほかの試験・前の試験の状態に依らないため。この D1 はこの種の試験だけで使う）。
 * 仮想の表を先に消し（付随の表も消える）、残りの表と migration の記録を消す。
 */
async function resetUpgradeDb(db: D1Database) {
  const listed = async (where: string) =>
    (
      await db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND ${where}`,
        )
        .all<{ name: string }>()
    ).results.map((r) => r.name);
  for (const name of await listed("sql LIKE 'CREATE VIRTUAL TABLE%'"))
    await db.prepare(`DROP TABLE IF EXISTS "${name}"`).run();
  const rest = await listed("1 = 1");
  if (rest.length > 0)
    await db.batch([
      db.prepare("PRAGMA defer_foreign_keys = ON"),
      ...rest.map((name) => db.prepare(`DROP TABLE IF EXISTS "${name}"`)),
    ]);
  const sequence = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'sqlite_sequence'",
    )
    .first<{ n: number }>();
  if ((sequence?.n ?? 0) > 0)
    await db.prepare("DELETE FROM sqlite_sequence").run();
}

/** env.DB の行を、更新前の DB の列だけで写す（attachment-publication.upgrade.db.test.ts と同じ方法） */
async function copyRows(target: D1Database) {
  const statements: D1PreparedStatement[] = [
    target.prepare("PRAGMA defer_foreign_keys = ON"),
  ];
  for (const table of await tablesOf(target)) {
    if (table.startsWith("search_")) continue;
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

async function insertMessage(
  db: D1Database,
  seed: { n: number; text: string; deleted?: boolean },
): Promise<string> {
  await db
    .prepare(
      `INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at, deleted_at, deleted_by)
       VALUES (?, ?, ?, 'テスト太郎', ?, ?, ?, ?)`,
    )
    .bind(
      idOf(seed.n),
      ROOM,
      V,
      `${TEST_TAG}${seed.text}`,
      atOf(seed.n),
      seed.deleted === true ? atOf(seed.n) : null,
      seed.deleted === true ? V : null,
    )
    .run();
  return idOf(seed.n);
}

async function insertAttachment(
  db: D1Database,
  seed: { id: string; messageId: string | null; name: string },
) {
  await db
    .prepare(
      `INSERT INTO message_attachments (id, room_id, thread_parent_id, message_id, uploader_id, storage_key, original_name, kind, content_type, size_bytes, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, 'document', 'text/plain; charset=utf-8', 10, ?)`,
    )
    .bind(
      seed.id,
      ROOM,
      seed.messageId,
      V,
      `attachments/${seed.id}`,
      seed.name,
      new Date().toISOString(),
    )
    .run();
}

/** 0033 の時点の写し（kind='message'。本文の写しをそのまま）を、採番に任せて入れる。対応の表の id を返す */
async function insertLegacyDocument(
  db: D1Database,
  messageId: string,
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO search_documents (kind, ref_id, room_id, message_id, created_at, source_body)
       SELECT 'message', id, room_id, id, created_at, body FROM messages WHERE id = ? RETURNING id`,
    )
    .bind(messageId)
    .first<{ id: number }>();
  if (row === null) throw new Error("写しを入れられませんでした");
  await db
    .prepare(
      "INSERT INTO search_fts (rowid, text) SELECT ?, body FROM messages WHERE id = ?",
    )
    .bind(row.id, messageId)
    .run();
  return row.id;
}

/** どの種類の写しでも、一致した対応の行の ref_id（昇順） */
async function refsByMatch(db: D1Database, term: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT d.ref_id AS id FROM search_fts f JOIN search_documents d ON d.id = f.rowid
       WHERE search_fts MATCH ? ORDER BY d.ref_id`,
    )
    .bind(phraseOf(term))
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

async function refsByInstr(db: D1Database, term: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT d.ref_id AS id FROM search_fts f JOIN search_documents d ON d.id = f.rowid
       WHERE instr(lower(f.text), lower(?)) > 0 ORDER BY d.ref_id`,
    )
    .bind(term)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

async function counts(db: D1Database) {
  return db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM search_documents) AS documents, (SELECT COUNT(*) FROM search_fts) AS fts`,
    )
    .first<{ documents: number; fts: number }>();
}

/**
 * 0033 まで当てた DB を作る：連続する番号の写し（1〜4）を入れ、最大の番号（M3 の写し）の対応の行だけを消して、検索用の行を残す（孤立）。
 * M3 は削除済み（後始末の途中の失敗で、検索用の行だけが残った状態）。MA は 0033 の時点からある、添付つきの未削除のメッセージ。
 */
async function prepareLegacyState(db: D1Database) {
  const { before } = splitMigrations();
  await resetUpgradeDb(db);
  await applyD1Migrations(db, before);
  expect(await tablesOf(db)).toContain("search_documents");
  await copyRows(db);
  const m1 = await insertMessage(db, { n: 1, text: "第一の本文の語句" });
  const m2 = await insertMessage(db, { n: 2, text: "第二の本文の語句" });
  const ma = await insertMessage(db, { n: 3, text: "据置の本文の語句" });
  const m3 = await insertMessage(db, {
    n: 4,
    text: `${ORPHAN_WORD}と${ORPHAN_PAIR}`,
  });
  const legacyAttachment = idOf(90);
  await insertAttachment(db, {
    id: legacyAttachment,
    messageId: ma,
    name: "更新前添付の資料.txt",
  });
  const ids = [];
  for (const id of [m1, m2, ma, m3])
    ids.push(await insertLegacyDocument(db, id));
  // 連続する番号で、M3 の写しが最大
  expect(ids).toEqual([
    ids[0],
    (ids[0] ?? 0) + 1,
    (ids[0] ?? 0) + 2,
    (ids[0] ?? 0) + 3,
  ]);
  const orphanId = ids[3] as number;
  await db.batch([
    db
      .prepare(
        "UPDATE messages SET deleted_at = ?, deleted_by = ? WHERE id = ?",
      )
      .bind(atOf(5), V, m3),
    db.prepare("DELETE FROM search_documents WHERE id = ?").bind(orphanId),
  ]);
  // 孤立した検索用の行が1つだけある
  const orphan = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM search_fts WHERE rowid NOT IN (SELECT id FROM search_documents)",
    )
    .first<{ n: number }>();
  expect(orphan?.n).toBe(1);
  return { m1, m2, ma, m3, legacyAttachment, orphanId };
}

/** 更新した DB の上の本物の Repository（投稿・編集・削除の組がそのまま走る） */
function repositoryOn(db: D1Database) {
  return createMessageRepository(drizzle(db, { schema }));
}

let posted = 100;
async function postOn(
  db: D1Database,
  text: string,
  attachmentIds: string[] = [],
) {
  posted += 1;
  const id = idOf(posted);
  const changes = await repositoryOn(db).insertIfOrdered({
    id,
    roomId: ROOM,
    senderId: V,
    senderDisplayName: "テスト太郎",
    body: `${TEST_TAG}${text}`,
    createdAt: atOf(posted),
    attachmentIds,
  });
  expect(changes).toBe(1);
  return id;
}

const editOn = async (db: D1Database, messageId: string, text: string) =>
  expect(
    await repositoryOn(db).updateBodyIfModifiable({
      messageId,
      userId: V,
      body: `${TEST_TAG}${text}`,
      editedAt: new Date().toISOString(),
    }),
  ).toBe(1);

const deleteOn = async (db: D1Database, messageId: string) =>
  expect(
    await repositoryOn(db).deleteIfModifiable({
      messageId,
      userId: V,
      roomId: ROOM,
      deletedAt: new Date().toISOString(),
      traceId: `${AUTH_TRACE_PREFIX}search155b-up-${crypto.randomUUID()}`,
    }),
  ).toBe(1);

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  posted = 100;
  w = await setupCaseWorld();
  V = w.memberS1.id;
  await insertChannel({
    id: ROOM,
    name: `${TEST_TAG}search-kind-upgrade`,
    purpose: "normal",
    departmentId: w.deptS.id,
    visibility: "public",
  });
  await insertMember(ROOM, V);
});

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await resetUpgradeDb(upgradeDb());
  } finally {
    await cleanupRelatedReadsRooms([ROOM]);
    await cleanupCaseTestData();
  }
});

describe("#155 AC-3 155-B M-1 種類の CHECK を変える migration の更新の試験（索引を空にしてから作り直す）", () => {
  it("#155 AC-3 M-1 対照: 索引を空にする migration を飛ばして作り直しだけを当てると、孤立した番号が使い回され、新しい投稿が古い文の語で誤って一致する（MATCH・instr）", async () => {
    const db = upgradeDb();
    const { orphanId } = await prepareLegacyState(db);
    const { before, kind, rest } = splitMigrations();
    await applyD1Migrations(db, [...before, kind, ...rest]);

    const fresh = await postOn(db, "対照の新規投稿の語");
    const reused = await db
      .prepare(
        "SELECT id FROM search_documents WHERE kind = 'message' AND ref_id = ?",
      )
      .bind(fresh)
      .first<{ id: number }>();
    // 採番の履歴を失い、孤立した番号が使い回される
    expect(reused?.id).toBe(orphanId);
    // 古い文（削除済みの M3）の語で、新しい投稿が出てしまう
    expect(await refsByMatch(db, ORPHAN_WORD)).toEqual([fresh]);
    expect(await refsByInstr(db, ORPHAN_PAIR)).toEqual([fresh]);
    // 新しい投稿の語では引けない
    expect(await refsByMatch(db, "対照の新規投稿")).toEqual([]);
  });

  it("#155 AC-3 M-1: 0034 で両方の表が0件 → 両方の区間の投稿・編集・削除 → 0035 → 再登録で、古い文で0件・新しい語で引け、不一致0件。CHECK は attachment・case_title を通しほかを拒否", async () => {
    const db = upgradeDb();
    const { m1, m2, ma, legacyAttachment } = await prepareLegacyState(db);
    const { before, empty, between, kind, rest } = splitMigrations();

    // ① 索引を空にする。区間の投稿・編集・削除は今のコードで行い、そのコードは添付の削除の列を読むため、検索と関係しない後ろの migration も先に当てる
    await applyD1Migrations(db, [...before, empty, ...rest]);
    expect(await counts(db)).toEqual({ documents: 0, fts: 0 });

    // ② 0034 と 0035 の間：投稿・編集・削除（このときの CHECK は message だけ。添付は付けない）
    const between1 = await postOn(db, "区間一の新規の語");
    await editOn(db, m1, "区間一で編集した語");
    await deleteOn(db, m2);
    expect(await refsByMatch(db, ORPHAN_WORD)).toEqual([]);
    expect(await refsByInstr(db, ORPHAN_PAIR)).toEqual([]);
    expect(await refsByMatch(db, "区間一の新規")).toEqual([between1]);
    expect(await refsByMatch(db, "区間一で編集")).toEqual([m1]);
    expect(await refsByMatch(db, "第二の本文")).toEqual([]);

    // 作り直し（生成のまま）
    await applyD1Migrations(db, [...before, empty, ...between, kind]);
    expect(await refsByMatch(db, "区間一の新規")).toEqual([between1]);
    expect(await refsByMatch(db, "区間一で編集")).toEqual([m1]);

    // 0035 の後・再登録の前：添付つきの投稿・編集・削除
    const newAttachment = idOf(91);
    await insertAttachment(db, {
      id: newAttachment,
      messageId: null,
      name: "区間二添付の見積.txt",
    });
    const between2 = await postOn(db, "区間二の新規の語", [newAttachment]);
    await editOn(db, between1, "区間二で編集した語");
    await deleteOn(db, m1);
    expect(await refsByMatch(db, ORPHAN_WORD)).toEqual([]);
    expect(await refsByInstr(db, ORPHAN_PAIR)).toEqual([]);
    expect(await refsByMatch(db, "区間二の新規")).toEqual([between2]);
    expect(await refsByMatch(db, "区間二添付の見積")).toEqual([newAttachment]);
    expect(await refsByMatch(db, "区間二で編集")).toEqual([between1]);
    expect(await refsByMatch(db, "区間一の新規")).toEqual([]);
    expect(await refsByMatch(db, "区間一で編集")).toEqual([]);
    // 再登録の前は、0033 の時点からあるメッセージ・添付は出ない（忘れても誤った一致にはならない）
    expect(await refsByMatch(db, "据置の本文")).toEqual([]);
    expect(await refsByMatch(db, "更新前添付の資料")).toEqual([]);

    // ③ 再登録
    const upgraded = drizzle(db, { schema });
    let after: string | null = null;
    for (let round = 0; round < 100; round += 1) {
      after = await reindexMessages(upgraded, { afterId: after });
      if (after === null) break;
    }
    expect(after).toBeNull();
    expect(await refsByMatch(db, "据置の本文")).toEqual([ma]);
    expect(await refsByMatch(db, "更新前添付の資料")).toEqual([
      legacyAttachment,
    ]);
    expect(await refsByMatch(db, ORPHAN_WORD)).toEqual([]);
    expect(await refsByInstr(db, ORPHAN_PAIR)).toEqual([]);
    const alive = await db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM messages WHERE deleted_at IS NULL AND room_id IS NOT NULL) AS messages,
           (SELECT COUNT(*) FROM search_documents WHERE kind = 'message') AS documents`,
      )
      .first<{ messages: number; documents: number }>();
    expect(alive?.documents).toBe(alive?.messages);
    expect(await indexMismatches(undefined, db)).toEqual(NO_MISMATCH);
    expect(await attachmentIndexMismatches(db)).toEqual(NO_ATTACHMENT_MISMATCH);

    // ④ CHECK
    const insertKind = (value: string, ref: string) =>
      db
        .prepare(
          `INSERT INTO search_documents (kind, ref_id, room_id, message_id, created_at, source_body)
           VALUES (?, ?, ?, NULL, ?, '[UNIT_TEST]種類の確認')`,
        )
        .bind(value, ref, ROOM, atOf(1))
        .run();
    await insertKind("attachment", idOf(95));
    await insertKind("case_title", idOf(96));
    await insertKind("message", idOf(97));
    for (const bad of ["other", "Attachment", ""])
      await expect(insertKind(bad, idOf(98))).rejects.toThrow(/CHECK/i);
  });
});
