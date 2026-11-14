// #134 U-7（利用者の決定 2026-11-14）: 削除したメッセージは未読に数えない。編集は ID が変わらないので未読の数に影響しない。
// 未読の数え方（#237）の DAO（unread-counts.sql.ts の listUnreadCountRows）と Repository（listUnread）を、隔離 D1 で確かめる。
// 実行計画（EXPLAIN QUERY PLAN）：削除の条件を足しても、messages は messages_room_id_id_idx (room_id=? AND id>?) の範囲で読む。
// データは架空（testuser_u7_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../db/schema";
import {
  DEPT_NOW,
  TEST_TAG,
  insertChannel,
  insertMember,
} from "../../test/department-fixtures";
import { insertDm } from "../../test/dm-fixtures";
import {
  cleanupMessageModifyScenario,
  markDeleted,
  markEdited,
} from "../../test/message-modify-fixtures";
import { insertMessagesAt } from "../../test/read-position-fixtures";
import { insertDepartment, insertUser } from "../../test/role-fixtures";
import { withDatabase } from "./database";
import { createReadPositionRepository } from "./read-position.repository";
import { listUnreadCountRows } from "./unread-counts.sql";

/** 参加（DEPT_NOW）の後の投稿の時刻 */
const AFTER_JOIN_MS = Date.parse(DEPT_NOW) + 60_000;

let deptId: string;
let viewer: string;
let other: string;

async function joinedChannel(label: string) {
  const roomId = await insertChannel({
    name: `${TEST_TAG}U7${label}`,
    purpose: "normal",
    departmentId: deptId,
  });
  await insertMember(roomId, viewer);
  return roomId;
}

async function unreadOf(userId: string) {
  const page = await withDatabase(env, (db) =>
    createReadPositionRepository(db).listUnread(userId, { limit: 100 }),
  );
  return new Map(page.items.map((item) => [item.roomId, item.count]));
}

beforeEach(async () => {
  deptId = await insertDepartment("U7未読");
  viewer = await insertUser("testuser_u7_viewer", deptId);
  other = await insertUser("testuser_u7_other", deptId);
});

afterEach(async () => {
  await cleanupMessageModifyScenario();
});

describe("#134 U-7 削除したメッセージは未読に数えない", () => {
  it("#134 AC-1（U-7）: チャンネルの他人の投稿3件のうち1件が削除されると、未読は 2", async () => {
    const roomId = await joinedChannel("チャンネル");
    const ids = await insertMessagesAt(roomId, other, AFTER_JOIN_MS, 3);
    expect((await unreadOf(viewer)).get(roomId)).toBe(3);
    await markDeleted(ids[1] ?? "", other);
    expect((await unreadOf(viewer)).get(roomId)).toBe(2);
  });

  it("#134 AC-1（U-7）: 未読がすべて削除された部屋は、未読の一覧に出ない", async () => {
    const roomId = await joinedChannel("全部削除");
    const ids = await insertMessagesAt(roomId, other, AFTER_JOIN_MS, 2);
    for (const id of ids) await markDeleted(id, other);
    expect((await unreadOf(viewer)).has(roomId)).toBe(false);
  });

  it("#134 AC-1（U-7）: DM でも、削除したメッセージは未読に数えない", async () => {
    const roomId = await insertDm(viewer, other);
    const ids = await insertMessagesAt(roomId, other, AFTER_JOIN_MS, 2);
    await markDeleted(ids[0] ?? "", other);
    expect((await unreadOf(viewer)).get(roomId)).toBe(1);
  });

  it("#134 AC-1（U-7）: 編集したメッセージは、未読の数を変えない（ID は変わらない）", async () => {
    const roomId = await joinedChannel("編集");
    const ids = await insertMessagesAt(roomId, other, AFTER_JOIN_MS, 2);
    await markEdited(ids[0] ?? "", "2026-11-14T00:00:00.000Z");
    expect((await unreadOf(viewer)).get(roomId)).toBe(2);
  });

  it("#134 AC-1（U-7）: DAO（listUnreadCountRows）も、削除したメッセージを数えない", async () => {
    const roomId = await joinedChannel("DAO");
    const ids = await insertMessagesAt(roomId, other, AFTER_JOIN_MS, 3);
    await markDeleted(ids[2] ?? "", other);
    const rows = await withDatabase(env, (db) =>
      listUnreadCountRows(db, viewer, [{ roomId, lower: "" }]),
    );
    expect(rows).toEqual([{ roomId, count: 2 }]);
  });
});

/** 実行した SQL（prepare）と、その値（bind）を記録する D1 */
function recordingDatabase() {
  const statements: { sql: string; params: unknown[] }[] = [];
  const client = new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "prepare")
        return (query: string) => {
          const entry = { sql: query, params: [] as unknown[] };
          statements.push(entry);
          const prepared = target.prepare(query);
          return new Proxy(prepared, {
            get(stmt, key) {
              if (key === "bind")
                return (...values: unknown[]) => {
                  entry.params = values;
                  return stmt.bind(...values);
                };
              const value: unknown = Reflect.get(stmt, key, stmt);
              return typeof value === "function" ? value.bind(stmt) : value;
            },
          });
        };
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db: drizzle(client, { schema }), statements };
}

describe("#134 U-7 実行計画（EXPLAIN QUERY PLAN）", () => {
  it("#134 AC-1（U-7）: 削除の条件を足した未読の数え方も、messages を messages_room_id_id_idx (room_id=? AND id>?) で読む", async () => {
    const roomId = await joinedChannel("EXPLAIN");
    const ids = await insertMessagesAt(roomId, other, AFTER_JOIN_MS, 5);
    await markDeleted(ids[0] ?? "", other);
    const recording = recordingDatabase();
    const rows = await listUnreadCountRows(recording.db, viewer, [
      { roomId, lower: "" },
    ]);
    expect(rows).toEqual([{ roomId, count: 4 }]);
    const details: string[] = [];
    for (const statement of recording.statements) {
      const { results } = await env.DB.prepare(
        `EXPLAIN QUERY PLAN ${statement.sql}`,
      )
        .bind(...statement.params)
        .all<{ detail: string }>();
      details.push(...results.map((row) => row.detail));
    }
    expect(
      details.some((detail) =>
        /USING (?:COVERING )?INDEX messages_room_id_id_idx \(room_id=\? AND id>\?\)/.test(
          detail,
        ),
      ),
      details.join("\n"),
    ).toBe(true);
    expect(
      details.filter(
        (detail) => /^SCAN m\b/.test(detail) && !detail.includes(" USING "),
      ),
      details.join("\n"),
    ).toEqual([]);
  });
});
