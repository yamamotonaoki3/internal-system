// #155（155-C）I-0：共通のテストデータの削除（backend/db/seeds/cleanup.sql）が、消した案件の件名の写し（kind = 'case_title'）を孤立のまま残さないこと、
// 対象外の案件の件名の写しは残すこと。メッセージ・添付の孤立の削除が、残すべき件名の行を消さないこと。
// 期待は、計画 0-A の2（cleanup.sql は案件を消した後、kind=case_title AND ref_id NOT IN (SELECT id FROM cases) の写しを消す）から決める。
// 方法：cleanup-sql.search.db.test.ts と同じ（cleanup.sql をコメント行を除いて文ごとに分け、1つの batch で隔離 D1 に流す）。
// データは架空（testuser_casereq_＝テストの識別子に当たる利用者、outsider_cleanup155c_＝当たらない利用者、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import cleanupSql from "../../db/seeds/cleanup.sql?raw";
import {
  MISSING_CASE_ID,
  cleanupCaseTestData,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  CASEREQ_NOW,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { insertUser, testId } from "../../test/role-fixtures";
import {
  caseTitleIndexRowsOf,
  cleanupCaseTitleIndex,
  ftsMatchCaseIds,
  insertCaseTitleIndexRow,
  runCaseTitleIndexStatements,
} from "../../test/search-case-fixtures";
import { cleanupSearchIndex } from "../../test/search-fixtures";

function statementsOf(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*\n/)
    .map((text) => text.trim().replace(/;$/, ""))
    .filter((text) => text.length > 0);
}

async function runCleanup() {
  await env.DB.batch(
    statementsOf(cleanupSql).map((text) => env.DB.prepare(text)),
  );
}

const OUTSIDER_USER = testId("OUT155C");
const OUTSIDER_DEPT = testId("OUT155CD");
const OUTSIDER_CLIENT = testId("OUT155CQ");
let w: CaseWorld;
/** テストの利用者が作った案件（cleanup.sql が消す） */
let removed: SeededCase;
/** テストの識別子に当たらない利用者が作った案件（cleanup.sql は消さない） */
let kept: SeededCase;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  w = await setupCaseWorld();
  // 対象外の部署・取引先・利用者（名前・ログイン ID がテストの識別子に当たらない。cleanup.sql が消さず、外部キーで止まらない）
  await env.DB.prepare(
    "INSERT INTO departments (id, name, name_normalized, is_active, created_at) VALUES (?, ?, ?, 1, ?)",
  )
    .bind(OUTSIDER_DEPT, "対象外の部署155C", "対象外の部署155c", CASEREQ_NOW)
    .run();
  await env.DB.prepare(
    "INSERT INTO clients (id, code, name, name_normalized, is_active, version, created_at, updated_at) VALUES (?, 'QOT', ?, ?, 1, 1, ?, ?)",
  )
    .bind(
      OUTSIDER_CLIENT,
      "対象外の取引先155C",
      "対象外の取引先155c",
      CASEREQ_NOW,
      CASEREQ_NOW,
    )
    .run();
  await insertUser("outsider_cleanup155c_001", OUTSIDER_DEPT, {
    id: OUTSIDER_USER,
  });
  removed = await seedCase({
    n: 1791,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]155C消える案件の件名",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
  });
  kept = await seedCase({
    n: 1792,
    clientId: OUTSIDER_CLIENT,
    // 案件の後始末（チャンネル名 QY?-*・QZ?-*）に当たらない番号
    code: "QOT",
    title: "[UNIT_TEST]155C残る案件の件名",
    createdBy: OUTSIDER_USER,
    departmentIds: [OUTSIDER_DEPT],
  });
  await runCaseTitleIndexStatements(removed.id);
  await runCaseTitleIndexStatements(kept.id);
});

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await cleanupSearchIndex();
  } finally {
    // 対象外の案件（cleanup.sql も共通の後始末も消さない）は、ここで識別子で消す
    await env.DB.batch([
      env.DB.prepare("DELETE FROM case_departments WHERE case_id = ?").bind(
        kept.id,
      ),
      env.DB.prepare("DELETE FROM cases WHERE id = ?").bind(kept.id),
      env.DB.prepare("DELETE FROM channels WHERE room_id = ?").bind(
        kept.roomId,
      ),
      env.DB.prepare("DELETE FROM rooms WHERE id = ?").bind(kept.roomId),
      env.DB.prepare("DELETE FROM users WHERE id = ?").bind(OUTSIDER_USER),
      env.DB.prepare("DELETE FROM clients WHERE id = ?").bind(OUTSIDER_CLIENT),
      env.DB.prepare("DELETE FROM departments WHERE id = ?").bind(
        OUTSIDER_DEPT,
      ),
    ]);
    await cleanupCaseTestData();
    await cleanupCaseTitleIndex();
  }
});

describe("#155 155-C I-0 cleanup.sql と件名の写し", () => {
  it("#155 I-0: 消した案件の件名の写しと、元の案件の無い孤立の写しを消し、対象外の案件の件名の写しは残す", async () => {
    await insertCaseTitleIndexRow({
      caseId: MISSING_CASE_ID,
      createdAt: CASEREQ_NOW,
      sourceBody: "[UNIT_TEST]155C孤立の件名の写し",
    });
    // 先に「ある」を確かめる
    expect(await ftsMatchCaseIds("消える案件の件名")).toEqual([removed.id]);
    expect(await ftsMatchCaseIds("孤立の件名の写し")).toEqual([
      MISSING_CASE_ID,
    ]);
    expect(await ftsMatchCaseIds("残る案件の件名")).toEqual([kept.id]);

    await runCleanup();

    expect(
      await env.DB.prepare("SELECT COUNT(*) AS n FROM cases WHERE id = ?")
        .bind(removed.id)
        .first<{ n: number }>(),
    ).toEqual({ n: 0 });
    expect(await caseTitleIndexRowsOf(removed.id)).toEqual([]);
    expect(await caseTitleIndexRowsOf(MISSING_CASE_ID)).toEqual([]);
    expect(await ftsMatchCaseIds("消える案件の件名")).toEqual([]);
    expect(await ftsMatchCaseIds("孤立の件名の写し")).toEqual([]);
    expect(await caseTitleIndexRowsOf(kept.id)).toHaveLength(1);
    expect(await ftsMatchCaseIds("残る案件の件名")).toEqual([kept.id]);
    const orphans = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM search_documents d WHERE d.kind = 'case_title' AND d.ref_id NOT IN (SELECT id FROM cases)) AS documents,
         (SELECT COUNT(*) FROM search_fts f WHERE f.rowid NOT IN (SELECT id FROM search_documents)) AS fts`,
    ).first<{ documents: number; fts: number }>();
    expect(orphans).toEqual({ documents: 0, fts: 0 });
  });

  it("#155 I-0: メッセージ・添付の孤立の削除は、残すべき件名の行を消さない（件名の行は message_id・room_id が NULL）", async () => {
    expect(await caseTitleIndexRowsOf(kept.id)).toHaveLength(1);
    const before = await caseTitleIndexRowsOf(kept.id);
    await runCleanup();
    expect(await caseTitleIndexRowsOf(kept.id)).toEqual(before);
  });
});
