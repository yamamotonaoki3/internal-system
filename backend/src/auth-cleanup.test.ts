// #120 AC-4（D-3）：期限切れのセッション・試行記録の掃除を、Cron（auth-cleanup。毎日 UTC 18:17 = JST 03:17）で行う。
// Workers の入口（index.ts の default.scheduled）を、ローカルの D1 に対して呼ぶ。500件ずつ繰り返すため、500件を超えても消し切る。
// データは架空のもの（testuser_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupAuthTestData,
  insertSession,
  sessionRow,
  sha256Hex,
} from "../test/auth-fixtures";
import {
  cleanupRoleTestData,
  insertDepartment,
  insertUser,
} from "../test/role-fixtures";
import worker from "./index";

const CRON = "17 18 * * *";
const controller = (cron: string) =>
  ({
    cron,
    scheduledTime: Date.now(),
    type: "scheduled",
  }) as unknown as ScheduledController;
const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

let logSpy: ReturnType<typeof vi.spyOn>;
let userId: string;
beforeEach(async () => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const dept = await insertDepartment("掃除テスト部");
  userId = await insertUser("testuser_001", dept);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupAuthTestData();
  await cleanupRoleTestData();
});

const run = () => worker.scheduled(controller(CRON), env, ctx);

async function countSessionsOf(id: string) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?",
  )
    .bind(id)
    .first<{ n: number }>();
  return row?.n ?? -1;
}

describe("Cron auth-cleanup", () => {
  it("#120 AC-4: UTC 18:17 の Cron で、期限切れ・失効済みのセッションを消し、有効なものを残す", async () => {
    const now = Date.now();
    const expired = await insertSession(userId, {
      createdAt: new Date(now - 2 * 24 * 60 * 60_000).toISOString(),
    });
    const valid = await insertSession(userId, {
      createdAt: new Date(now).toISOString(),
    });
    await run();
    expect(await sessionRow(expired.id)).toBeNull();
    expect(await sessionRow(valid.id)).not.toBeNull();
  });

  it("#120 AC-4: 500件を超える期限切れ（1201件）も、1回の実行で消し切る", async () => {
    const old = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();
    const statements = [];
    for (let i = 0; i < 1201; i += 1) {
      const id = await sha256Hex(`unit-cleanup-${i}`);
      statements.push(
        env.DB.prepare(
          "INSERT INTO sessions (id, user_id, created_at, last_active_at, reauthenticated_at, revoked_at) VALUES (?, ?, ?, ?, NULL, NULL)",
        ).bind(id, userId, old, old),
      );
    }
    await env.DB.batch(statements);
    await run();
    expect(await countSessionsOf(userId)).toBe(0);
  });

  it("#120 AC-4: もう一度実行しても成功する（べき等）", async () => {
    await run();
    await expect(run()).resolves.toBeUndefined();
  });

  it("#120 AC-4: 開始・終了と件数をログ（INFO）に残す", async () => {
    await run();
    const text = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(text).toContain("auth-cleanup");
  });
});
