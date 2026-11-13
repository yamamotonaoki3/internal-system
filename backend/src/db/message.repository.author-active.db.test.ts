// #238 AC-1：メッセージ一覧の Repository（listLatest・listAfter）が投稿者の有効・無効（users.is_active）を1文で読むことを、隔離 D1 で確かめる。
// 契約：items[].author は { id, displayName（投稿時点）, isActive }。SQL の数は投稿者の人数・無効な人の数に比例しない（N+1 にしない）。
// 実行計画（EXPLAIN QUERY PLAN）：messages は messages_room_id_id_idx、users は主キーの索引で引き、表を頭から読む行がない。
// データは架空（testuser_ret238db_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../db/schema";
import {
  insertChannel,
  insertDepartmentWithChannels,
  insertMember,
  type SeededDepartment,
} from "../../test/department-fixtures";
import {
  cleanupMessageScenario,
  insertMessage,
  ulidAt,
} from "../../test/message-fixtures";
import { insertUser } from "../../test/role-fixtures";
import { createMessageRepository } from "./message.repository";

let dept: SeededDepartment;
let users: string[];

async function deactivate(userId: string) {
  await env.DB.prepare(
    "UPDATE users SET is_active = 0, deactivated_at = ? WHERE id = ?",
  )
    .bind("2026-11-13T00:00:00.000Z", userId)
    .run();
}

/** 実行した SQL（prepare）と、その値（bind）を記録する D1 で Repository を作る */
function recordingRepository() {
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
  return {
    repository: createMessageRepository(drizzle(client, { schema })),
    statements,
  };
}

async function planOf(statement: { sql: string; params: unknown[] }) {
  const { results } = await env.DB.prepare(
    `EXPLAIN QUERY PLAN ${statement.sql}`,
  )
    .bind(...statement.params)
    .all<{ detail: string }>();
  return results.map((row) => row.detail);
}

/** 表を索引なしで頭から読む行 */
function fullScans(details: string[]): string[] {
  return details.filter(
    (detail) => /^SCAN \S+/.test(detail) && !detail.includes(" USING "),
  );
}

async function roomWith(authorIds: string[], count: number, name: string) {
  const roomId = await insertChannel({
    name: `[UNIT_TEST]${name}`,
    purpose: "normal",
    departmentId: dept.id,
  });
  for (let i = 0; i < count; i += 1)
    await insertMessage({
      roomId,
      senderId: authorIds[i % authorIds.length] ?? "",
      id: ulidAt(1_800_000_000_000 + i),
      displayName: `投稿時の名前${i}`,
    });
  return roomId;
}

beforeEach(async () => {
  dept = await insertDepartmentWithChannels("退職者表示Repo");
  users = [];
  for (let i = 0; i < 5; i += 1) {
    const id = await insertUser(`testuser_ret238db_${i}`, dept.id);
    await insertMember(dept.dedicatedChannelId, id);
    users.push(id);
  }
});
afterEach(async () => {
  await cleanupMessageScenario();
});

describe("#238 AC-1 Repository が isActive を返す", () => {
  it("#238 AC-1: listLatest・listAfter とも、無効な投稿者は isActive: false、有効な投稿者は true", async () => {
    const roomId = await roomWith(users, 5, "isActive");
    await deactivate(users[1] ?? "");
    const { repository } = recordingRepository();
    const latest = await repository.listLatest(roomId, 50);
    const after = await repository.listAfter(
      roomId,
      "00000000000000000000000000",
      50,
    );
    for (const items of [latest.items, after.items]) {
      expect(items).toHaveLength(5);
      for (const item of items)
        expect(item.author, item.id).toEqual({
          id: item.author.id,
          displayName: expect.stringMatching(/^投稿時の名前\d$/) as string,
          isActive: item.author.id !== users[1],
        });
    }
  });
});

describe("#238 AC-1（N+1）SQL の数が投稿者の人数に比例しない", () => {
  it("#238 AC-1: 投稿者1人のページと、5人（うち無効2人）のページで、listLatest・listAfter の SQL の数が同じ", async () => {
    const single = await roomWith([users[0] ?? ""], 5, "投稿者1人");
    const many = await roomWith(users, 10, "投稿者5人");
    await deactivate(users[1] ?? "");
    await deactivate(users[3] ?? "");
    const zero = "00000000000000000000000000";
    const counts: Record<string, number[]> = { latest: [], after: [] };
    for (const roomId of [single, many]) {
      const latest = recordingRepository();
      await latest.repository.listLatest(roomId, 50);
      counts.latest?.push(latest.statements.length);
      const after = recordingRepository();
      await after.repository.listAfter(roomId, zero, 50);
      counts.after?.push(after.statements.length);
    }
    expect(counts.latest?.[0]).toBeGreaterThan(0);
    expect(counts.after?.[0]).toBeGreaterThan(0);
    expect(new Set(counts.latest).size).toBe(1);
    expect(new Set(counts.after).size).toBe(1);
  });
});

describe("#238 AC-1（索引）実行計画", () => {
  it("#238 AC-1: messages は messages_room_id_id_idx、users は主キーの索引で引き、表を頭から読む行がない", async () => {
    const roomId = await roomWith(users, 10, "EXPLAIN");
    await deactivate(users[2] ?? "");
    for (const call of ["latest", "after"] as const) {
      const recording = recordingRepository();
      if (call === "latest") await recording.repository.listLatest(roomId, 50);
      else
        await recording.repository.listAfter(
          roomId,
          "00000000000000000000000000",
          50,
        );
      const plans: string[][] = [];
      for (const statement of recording.statements)
        plans.push(await planOf(statement));
      const all = plans.flat();
      const text = `${call}\n${all.join("\n")}`;
      expect(
        all.some((d) =>
          /USING (?:COVERING )?INDEX messages_room_id_id_idx/.test(d),
        ),
        text,
      ).toBe(true);
      expect(
        all.some(
          (d) =>
            /\busers\b/.test(d) &&
            /(?:sqlite_autoindex_users_1|PRIMARY KEY)/.test(d),
        ),
        text,
      ).toBe(true);
      for (const details of plans) expect(fullScans(details), text).toEqual([]);
    }
  });
});
