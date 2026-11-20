// #155（155-A）計画 4.2「索引を変えない操作」・6章：共通のテストデータの削除（backend/db/seeds/cleanup.sql）が、消すメッセージの
// 検索の索引の行（search_documents と search_fts）も消し、対象外のメッセージの索引の行は残すこと。孤立した検索用の行を残さないこと。
// 方法：cleanup-sql.thread.db.test.ts と同じ（cleanup.sql をコメント行を除いて文ごとに分け、1つの batch で隔離 D1 に流す）。
// データは架空（testuser_cleanup_、outsider_cleanup_＝テストの識別子に当たらない利用者、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import cleanupSql from "../../db/seeds/cleanup.sql?raw";
import { insertChannel, insertMember } from "../../test/department-fixtures";
import { insertMessage, ulidAt } from "../../test/message-fixtures";
import { insertDepartment, insertUser, testId } from "../../test/role-fixtures";
import {
  buildSearchIndex,
  cleanupSearchIndex,
  ftsMatchIds,
  indexCountsOf,
} from "../../test/search-fixtures";
import { cleanupThreadScenario } from "../../test/thread-fixtures";

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

const OUTSIDER_DEPT = testId("OUTDEPT");
const OUTSIDER_ROOM = testId("OUTROOM");
const OUTSIDER_USER = testId("OUTUSER");
const OUTSIDER_MESSAGE = ulidAt(1_879_000_000_000);
const TEST_MESSAGE = ulidAt(1_879_000_001_000);
let testUser: string;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  await env.DB.prepare(
    "INSERT INTO departments (id, name, name_normalized, is_active, created_at) VALUES (?, ?, ?, 1, ?)",
  )
    .bind(
      OUTSIDER_DEPT,
      "対象外の部署",
      "対象外の部署",
      "2026-11-09T00:00:00.000Z",
    )
    .run();
  await insertUser("outsider_cleanup_001", OUTSIDER_DEPT, {
    id: OUTSIDER_USER,
  });
  await insertChannel({
    name: "対象外のチャンネル",
    purpose: "normal",
    departmentId: OUTSIDER_DEPT,
    id: OUTSIDER_ROOM,
  });
  const testDept = await insertDepartment("cleanup検索用");
  testUser = await insertUser("testuser_cleanup_001", testDept);
  await insertMember(OUTSIDER_ROOM, testUser);
  await insertMember(OUTSIDER_ROOM, OUTSIDER_USER);
});

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM search_fts WHERE rowid IN (SELECT id FROM search_documents WHERE ref_id = ?)",
      ).bind(OUTSIDER_MESSAGE),
      env.DB.prepare("DELETE FROM search_documents WHERE ref_id = ?").bind(
        OUTSIDER_MESSAGE,
      ),
    ]);
  } finally {
    try {
      await cleanupSearchIndex();
    } finally {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM messages WHERE room_id = ?").bind(
          OUTSIDER_ROOM,
        ),
        env.DB.prepare("DELETE FROM channel_members WHERE channel_id = ?").bind(
          OUTSIDER_ROOM,
        ),
        env.DB.prepare("DELETE FROM channels WHERE room_id = ?").bind(
          OUTSIDER_ROOM,
        ),
        env.DB.prepare("DELETE FROM rooms WHERE id = ?").bind(OUTSIDER_ROOM),
        env.DB.prepare("DELETE FROM users WHERE id = ?").bind(OUTSIDER_USER),
        env.DB.prepare("DELETE FROM departments WHERE id = ?").bind(
          OUTSIDER_DEPT,
        ),
      ]);
      await cleanupThreadScenario();
    }
  }
});

describe("#155 AC-3 cleanup.sql と検索の索引", () => {
  it("#155 AC-3: テストの利用者のメッセージの索引の行（対応の表・検索用の表）を消し、対象外のメッセージの索引の行は残す。孤立した行を残さない", async () => {
    await insertMessage({
      id: OUTSIDER_MESSAGE,
      roomId: OUTSIDER_ROOM,
      senderId: OUTSIDER_USER,
      body: "対象外の利用者の残る本文です",
    });
    await insertMessage({
      id: TEST_MESSAGE,
      roomId: OUTSIDER_ROOM,
      senderId: testUser,
      body: "[UNIT_TEST]消える利用者の本文です",
    });
    await buildSearchIndex();
    expect(await indexCountsOf(TEST_MESSAGE)).toEqual({ documents: 1, fts: 1 });

    await runCleanup();

    expect(await indexCountsOf(TEST_MESSAGE)).toEqual({ documents: 0, fts: 0 });
    expect(await indexCountsOf(OUTSIDER_MESSAGE)).toEqual({
      documents: 1,
      fts: 1,
    });
    expect(await ftsMatchIds("残る本文")).toEqual([OUTSIDER_MESSAGE]);
    const orphans = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM search_documents d WHERE d.kind = 'message' AND d.ref_id NOT IN (SELECT id FROM messages)) AS documents,
         (SELECT COUNT(*) FROM search_fts f WHERE f.rowid NOT IN (SELECT id FROM search_documents)) AS fts`,
    ).first<{ documents: number; fts: number }>();
    expect(orphans).toEqual({ documents: 0, fts: 0 });
  });
});
