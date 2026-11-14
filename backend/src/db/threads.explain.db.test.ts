// #137 AC-1（1-4 AC-1・AC-4）: 返信・スレッド一覧・スレッドの既読の SQL が、索引を使い（表を頭から読まない）、件数に比例して SQL の数が増えない（N+1 にしない）ことを、
// 隔離 D1 の EXPLAIN QUERY PLAN で確かめる（Skill「backend」）。実際のアプリ入口（index.ts の app）に、実行した SQL を記録する D1 を渡して呼び、記録した SELECT を EXPLAIN する。
// Repository・DAO の関数名に依存しない（API の呼び出しだけで確かめる）。
// 期待：messages の読み取りは、索引（messages_parent_message_id_id_idx・messages_room_id_id_idx・主キー）で引く。thread_read_positions は主キーで引く。
// データは架空（testuser_thrplan_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newThrottleKey } from "../../test/auth-fixtures";
import { API_ORIGIN } from "../../test/api-request";
import { SESSION_COOKIE, TEST_IP } from "../../test/auth-fixtures";
import { insertReplies } from "../../test/message-fixtures";
import { newPiiKey, newSetupToken } from "../../test/random-secrets";
import {
  TEST_TAG,
  ZERO,
  cleanupThreadScenario,
  createThreadWorld,
  idAt,
  insertThreadReadPosition,
  isoAt,
  repliesPath,
  seedParent,
  seedReply,
  THREADS_PATH,
  threadReadPath,
  type ThreadWorld,
} from "../../test/thread-fixtures";
import { app } from "../index";

type Recorded = { sql: string; params: unknown[] };

/** 実行した SQL（prepare）と値（bind）を記録する D1 で、アプリに要求を送る */
async function recordedRequest(
  method: string,
  path: string,
  token: string,
  body?: unknown,
) {
  const statements: Recorded[] = [];
  const db = new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "prepare")
        return (query: string) => {
          const entry: Recorded = { sql: query, params: [] };
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
  const headers: Record<string, string> = {
    Origin: API_ORIGIN,
    "CF-Connecting-IP": TEST_IP,
    Cookie: `${SESSION_COOKIE}=${token}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await app.request(
    path,
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    {
      ...env,
      DB: db,
      LOGIN_THROTTLE_KEY: newThrottleKey(),
      SETUP_TOKEN: newSetupToken(),
      PII_ENCRYPTION_KEY: newPiiKey(),
    } as unknown as Env,
  );
  return { response, statements };
}

async function plansOf(statements: Recorded[]): Promise<string[]> {
  const details: string[] = [];
  for (const statement of statements) {
    if (!/^\s*(SELECT|WITH)\b/i.test(statement.sql)) continue;
    const { results } = await env.DB.prepare(
      `EXPLAIN QUERY PLAN ${statement.sql}`,
    )
      .bind(...statement.params)
      .all<{ detail: string }>();
    details.push(...results.map((row) => row.detail));
  }
  return details;
}

/** messages・thread_read_positions を、索引なしで頭から読む行 */
function fullScans(details: string[]): string[] {
  return details.filter(
    (detail) =>
      /^SCAN (messages|thread_read_positions)\b/.test(detail) &&
      !detail.includes(" USING "),
  );
}

let world: ThreadWorld;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  world = await createThreadWorld("thrplan");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupThreadScenario();
});

/** count 件のスレッド（親は alice、返信は bob・dave）。offset 件ぶん後ろの番号から始める（番号が重ならないようにする） */
async function seedThreads(count: number, offset = 0) {
  const seeds: Parameters<typeof insertReplies>[0] = [];
  const parents: string[] = [];
  for (let i = offset; i < offset + count; i += 1) {
    const parent = await seedParent(
      world.channel,
      world.alice.userId,
      1 + i * 3,
    );
    parents.push(parent);
    for (const [k, sender] of [world.bob, world.dave].entries())
      seeds.push({
        id: idAt(2 + i * 3 + k),
        roomId: world.channel,
        senderId: sender.userId,
        parentMessageId: parent,
        createdAt: isoAt(2 + i * 3 + k),
        body: `${TEST_TAG}返信`,
      });
  }
  await insertReplies(seeds);
  return parents;
}

describe("#137 AC-1（EXPLAIN）返信の取得", () => {
  it("#137 AC-1: 返信の最新・after は、parent_message_id の索引で引き、messages を頭から読まない", async () => {
    const [parent] = await seedThreads(3);
    for (const query of ["", `?after=${ZERO}`]) {
      const { response, statements } = await recordedRequest(
        "GET",
        `${repliesPath(parent ?? "")}${query}`,
        world.alice.token,
      );
      expect(response.status).toBe(200);
      const plan = await plansOf(statements);
      const text = `${query}\n${plan.join("\n")}`;
      expect(
        plan.some((d) =>
          /USING (?:COVERING )?INDEX messages_parent_message_id_id_idx/.test(d),
        ),
        text,
      ).toBe(true);
      expect(fullScans(plan), text).toEqual([]);
    }
  });

  it("#137 AC-1: 返信の取得の SQL の数は、返信の件数・投稿者の人数に比例しない", async () => {
    const [few] = await seedThreads(1);
    const first = await recordedRequest(
      "GET",
      `${repliesPath(few ?? "")}?limit=100`,
      world.alice.token,
    );
    const many = await seedParent(world.channel, world.alice.userId, 500);
    const seeds = Array.from({ length: 30 }, (_, i) => ({
      id: idAt(501 + i),
      roomId: world.channel,
      senderId: [world.bob, world.dave, world.alice][i % 3]?.userId ?? "",
      parentMessageId: many,
      createdAt: isoAt(501 + i),
      body: `${TEST_TAG}多数${i}`,
    }));
    await insertReplies(seeds);
    const second = await recordedRequest(
      "GET",
      `${repliesPath(many)}?limit=100`,
      world.alice.token,
    );
    expect(first.response.status).toBe(200);
    expect(second.response.status).toBe(200);
    expect(second.statements.length).toBe(first.statements.length);
  });
});

describe("#137 AC-1（EXPLAIN）部屋の一覧の replyCount", () => {
  it("#137 AC-1: 部屋の一覧（最新・after）の replyCount は、索引で数え、messages を頭から読まない。SQL の数は項目の数に比例しない", async () => {
    await seedThreads(2);
    const counts: number[] = [];
    for (const query of ["?limit=50", `?after=${ZERO}&limit=50`]) {
      const { response, statements } = await recordedRequest(
        "GET",
        `/api/rooms/${world.channel}/messages${query}`,
        world.alice.token,
      );
      expect(response.status).toBe(200);
      const plan = await plansOf(statements);
      expect(fullScans(plan), `${query}\n${plan.join("\n")}`).toEqual([]);
      counts.push(statements.length);
    }
    await seedThreads(3, 10);
    const again = await recordedRequest(
      "GET",
      `/api/rooms/${world.channel}/messages?limit=50`,
      world.alice.token,
    );
    expect(again.statements.length).toBe(counts[0]);
  });
});

describe("#137 AC-4（EXPLAIN）スレッド一覧", () => {
  it("#137 AC-4: スレッド一覧の SQL は、messages・thread_read_positions を頭から読まず、返信は parent_message_id の索引で引く", async () => {
    const [parent] = await seedThreads(4);
    await insertThreadReadPosition(world.alice.userId, parent ?? "", idAt(2));
    for (const query of ["?limit=20", "?limit=2"]) {
      const { response, statements } = await recordedRequest(
        "GET",
        `${THREADS_PATH}${query}`,
        world.alice.token,
      );
      expect(response.status).toBe(200);
      const plan = await plansOf(statements);
      const text = `${query}\n${plan.join("\n")}`;
      expect(fullScans(plan), text).toEqual([]);
      expect(
        plan.some((d) => /INDEX messages_parent_message_id_id_idx/.test(d)),
        text,
      ).toBe(true);
    }
  });

  it("#137 AC-4（N+1）: スレッド一覧の SQL の数は、スレッドの数に比例しない（2本程度のまま）", async () => {
    await seedThreads(1);
    const small = await recordedRequest(
      "GET",
      `${THREADS_PATH}?limit=100`,
      world.alice.token,
    );
    // 続けて9スレッドを足す（時刻が重ならない番号から）
    const seeds: Parameters<typeof insertReplies>[0] = [];
    for (let i = 0; i < 9; i += 1) {
      const parent = await seedParent(
        world.channel,
        world.alice.userId,
        100 + i * 3,
      );
      seeds.push({
        id: idAt(101 + i * 3),
        roomId: world.channel,
        senderId: world.bob.userId,
        parentMessageId: parent,
        createdAt: isoAt(101 + i * 3),
        body: `${TEST_TAG}返信`,
      });
    }
    await insertReplies(seeds);
    const large = await recordedRequest(
      "GET",
      `${THREADS_PATH}?limit=100`,
      world.alice.token,
    );
    expect(small.response.status).toBe(200);
    expect(large.response.status).toBe(200);
    const items = (await large.response.json()) as { items: unknown[] };
    expect(items.items).toHaveLength(10);
    expect(large.statements.length).toBe(small.statements.length);
  });
});

describe("#137 AC-4（EXPLAIN）スレッドの既読", () => {
  it("#137 AC-4: スレッドの既読の SQL は、messages・thread_read_positions を頭から読まない", async () => {
    const parent = await seedParent(world.channel, world.alice.userId, 1);
    const reply = await seedReply(world.channel, parent, world.bob.userId, 2);
    const { response, statements } = await recordedRequest(
      "PUT",
      threadReadPath(parent),
      world.alice.token,
      { lastReadMessageId: reply },
    );
    expect(response.status).toBe(204);
    const plan = await plansOf(statements);
    expect(fullScans(plan), plan.join("\n")).toEqual([]);
  });
});
