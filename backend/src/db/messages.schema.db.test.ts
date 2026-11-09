// #201 AC-2・AC-3・AC-6: messages の migration（0012）の制約を、マイグレーション済みの D1 に直接書いて確かめる。
// 列（sender_display_name = 投稿時の表示名のスナップショット）、本文が空の行を拒否する CHECK、部屋・投稿者の外部キー、(room_id, id) の索引。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupMessageScenario,
  insertMessage,
  ulidAt,
} from "../../test/message-fixtures";
import {
  insertDepartmentWithChannels,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { insertUser, testId } from "../../test/role-fixtures";

let dept: SeededDepartment;
let userId: string;

beforeEach(async () => {
  dept = await insertDepartmentWithChannels("メッセージ制約");
  userId = await insertUser("testuser_msgschema_001", dept.id);
});
afterEach(async () => {
  await cleanupMessageScenario();
});

describe("#201 messages の制約（D1）", () => {
  it("#201 AC-6: 表に決めた列があり、投稿時の表示名を保存する列（sender_display_name）を持つ", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM pragma_table_info('messages')",
    ).all<{ name: string }>();
    const names = results.map((r) => r.name);
    for (const column of [
      "id",
      "room_id",
      "sender_id",
      "sender_display_name",
      "body",
      "created_at",
    ])
      expect(names).toContain(column);
  });

  it("#201 AC-2: 本文が空の行は保存できない", async () => {
    await expect(
      insertMessage({
        roomId: dept.dedicatedChannelId,
        senderId: userId,
        body: "",
      }),
    ).rejects.toThrow();
  });

  it("#201 AC-2: 本文が1文字の行は保存できる", async () => {
    await insertMessage({
      roomId: dept.dedicatedChannelId,
      senderId: userId,
      body: "a",
    });
  });

  it("#201 AC-1: 存在しない部屋を指す行は、外部キーで保存できない", async () => {
    await expect(
      insertMessage({ roomId: testId("NOROOM"), senderId: userId }),
    ).rejects.toThrow();
  });

  it("#201 AC-1: 存在しない投稿者を指す行は、外部キーで保存できない", async () => {
    await expect(
      insertMessage({
        roomId: dept.dedicatedChannelId,
        senderId: testId("NOUSER"),
      }),
    ).rejects.toThrow();
  });

  it("#201 AC-3: 同じIDの行は2つ保存できない", async () => {
    const id = ulidAt(1_800_000_000_000);
    await insertMessage({
      roomId: dept.dedicatedChannelId,
      senderId: userId,
      id,
    });
    await expect(
      insertMessage({ roomId: dept.dedicatedChannelId, senderId: userId, id }),
    ).rejects.toThrow();
  });

  it("#201 AC-3: (room_id, id) の順の索引がある（部屋ごとにID順で読むため）", async () => {
    const { results: indexes } = await env.DB.prepare(
      "SELECT name FROM pragma_index_list('messages')",
    ).all<{ name: string }>();
    const columnLists: string[][] = [];
    for (const index of indexes) {
      const { results } = await env.DB.prepare(
        `SELECT name FROM pragma_index_info('${index.name.replace(/'/g, "''")}') ORDER BY seqno`,
      ).all<{ name: string }>();
      columnLists.push(results.map((r) => r.name));
    }
    expect(columnLists).toContainEqual(["room_id", "id"]);
  });
});
