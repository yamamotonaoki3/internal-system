// #237 AC-2・AC-4（ADR-0006・C-169 (5)）：既読位置の表 read_positions の形と制約を、マイグレーション済みの D1 に直接書いて確かめる。
// 計画「1. 表」：
//   user_id（NOT NULL → users.id）・room_id（NOT NULL → rooms.id）・last_read_message_id（NOT NULL。外部キーにしない）・updated_at（NOT NULL、既定は現在時刻）
//   主キー (user_id, room_id)。追加の索引は作らない。
// AC-4：未読数は既読位置から上限つきで数え直す。カウンター（未読数を保存する列・表）や rooms.last_message_id は持たない。
// D1 では PRAGMA を使わない（読み取りが SQLITE_AUTH で失敗するため）。表・索引は sqlite_master、列は raw({ columnNames: true }) で読む。
// データは架空（testuser_rpschema_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupDepartmentTestData,
  insertChannel,
} from "../../test/department-fixtures";
import { cleanupMessageTestData } from "../../test/message-fixtures";
import {
  READ_NOW,
  cleanupReadPositions,
  insertMessagesAt,
  insertReadPosition,
  readPositionOf,
} from "../../test/read-position-fixtures";
import {
  TEST_TAG,
  insertDepartment,
  insertUser,
  testId,
} from "../../test/role-fixtures";

let userA: string;
let roomId: string;

beforeEach(async () => {
  const dept = await insertDepartment("既読制約");
  userA = await insertUser("testuser_rpschema_a", dept);
  roomId = await insertChannel({
    name: `${TEST_TAG}既読制約の部屋`,
    purpose: "normal",
    departmentId: dept,
  });
});

afterEach(async () => {
  try {
    await cleanupReadPositions();
    await cleanupMessageTestData();
  } finally {
    await cleanupDepartmentTestData();
  }
});

async function columnsOf(table: string): Promise<string[]> {
  const [names] = await env.DB.prepare(`SELECT * FROM ${table} LIMIT 0`).raw({
    columnNames: true,
  });
  return (names ?? []).map(String);
}

const insert = (
  user: string,
  room: string,
  messageId: string | null,
  updatedAt?: string,
) =>
  updatedAt === undefined
    ? env.DB.prepare(
        "INSERT INTO read_positions (user_id, room_id, last_read_message_id) VALUES (?, ?, ?)",
      )
        .bind(user, room, messageId)
        .run()
    : env.DB.prepare(
        "INSERT INTO read_positions (user_id, room_id, last_read_message_id, updated_at) VALUES (?, ?, ?, ?)",
      )
        .bind(user, room, messageId, updatedAt)
        .run();

describe("#237 AC-2 表 read_positions の形", () => {
  it("#237 AC-2: 表があり、列は user_id・room_id・last_read_message_id・updated_at だけ", async () => {
    const table = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'read_positions'",
    ).first<{ name: string }>();
    expect(table?.name).toBe("read_positions");
    expect((await columnsOf("read_positions")).sort()).toEqual(
      ["last_read_message_id", "room_id", "updated_at", "user_id"].sort(),
    );
  });

  it("#237 AC-2: 主キーは (user_id, room_id)：同じ利用者・同じ部屋の2行目は入らない", async () => {
    const [first, second] = await insertMessagesAt(
      roomId,
      userA,
      Date.parse(READ_NOW),
      2,
    );
    await insert(userA, roomId, first ?? "", READ_NOW);
    await expect(insert(userA, roomId, second ?? "", READ_NOW)).rejects.toThrow(
      /UNIQUE|PRIMARY KEY|constraint/i,
    );
    expect(await readPositionOf(userA, roomId)).toBe(first);
  });

  it("#237 AC-2: 同じ利用者でも部屋が違えば、別の行として入る", async () => {
    const otherRoom = await insertChannel({
      name: `${TEST_TAG}既読制約の別の部屋`,
      purpose: "normal",
      departmentId: null,
    });
    const id = testId("MSGX");
    await insert(userA, roomId, id, READ_NOW);
    await insert(userA, otherRoom, id, READ_NOW);
    expect(await readPositionOf(userA, otherRoom)).toBe(id);
  });

  it("#237 AC-2: 存在しない利用者・存在しない部屋の既読位置は、外部キーで入らない", async () => {
    await expect(
      insert(testId("NOUSER"), roomId, testId("MSG"), READ_NOW),
    ).rejects.toThrow(/FOREIGN KEY/i);
    await expect(
      insert(userA, testId("NOROOM"), testId("MSG"), READ_NOW),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });

  it("#237 AC-2（C-169 (5)）: last_read_message_id は外部キーにしない（存在しないメッセージの ID でも入り、指しているメッセージも消せる）", async () => {
    await insert(userA, roomId, testId("NOMSG"), READ_NOW);
    const otherUser = await insertUser(
      "testuser_rpschema_b",
      await insertDepartment("既読制約2"),
    );
    const [messageId] = await insertMessagesAt(
      roomId,
      userA,
      Date.parse(READ_NOW),
      1,
    );
    await insertReadPosition(otherUser, roomId, messageId ?? "");
    await env.DB.prepare("DELETE FROM messages WHERE id = ?")
      .bind(messageId ?? "")
      .run();
    expect(await readPositionOf(otherUser, roomId)).toBe(messageId);
  });

  it("#237 AC-2: last_read_message_id は NULL にできない", async () => {
    await expect(insert(userA, roomId, null, READ_NOW)).rejects.toThrow(
      /NOT NULL/i,
    );
  });

  it("#237 AC-2: updated_at を省くと、現在時刻（UTC の ISO 8601、ミリ秒まで）が入る", async () => {
    await insert(userA, roomId, testId("MSG"));
    const row = await env.DB.prepare(
      "SELECT updated_at FROM read_positions WHERE user_id = ? AND room_id = ?",
    )
      .bind(userA, roomId)
      .first<{ updated_at: string }>();
    expect(row?.updated_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it("#237 AC-2: 追加の索引は作らない（主キーの自動の索引だけ）", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'read_positions'",
    ).all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual([
      "sqlite_autoindex_read_positions_1",
    ]);
  });
});

describe("#237 AC-4（ADR-0006）未読数を保存しない", () => {
  it("#237 AC-4: どの表にも、未読数を保存する列（unread を含む名前）がない", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite!_%' ESCAPE '!' AND name NOT LIKE '!_cf!_%' ESCAPE '!' AND name NOT LIKE 'd1!_%' ESCAPE '!'",
    ).all<{ name: string }>();
    const tables = results.map((r) => r.name);
    expect(tables).toContain("read_positions");
    expect(tables.filter((name) => /unread/i.test(name))).toEqual([]);
    for (const table of tables)
      expect(
        (await columnsOf(table)).filter((column) =>
          /unread|read_count/i.test(column),
        ),
        table,
      ).toEqual([]);
  });

  it("#237 AC-4: rooms に最新のメッセージ（last_message_id）の列を持たない", async () => {
    expect(await columnsOf("rooms")).not.toContain("last_message_id");
  });
});
