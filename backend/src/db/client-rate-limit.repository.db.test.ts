// #192 AC-1・AC-6（X-8）: D1のrate窓を実操作で検証する。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupRoleTestData,
  insertDepartment,
  insertUser,
} from "../../test/role-fixtures";
import { withDatabase } from "./database";
import { createClientRateLimitRepository } from "./client-rate-limit.repository";

let userId: string;
beforeEach(async () => {
  const department = await insertDepartment("取引先rate窓テスト部署");
  userId = await insertUser("testuser_client_rate_window", department);
});
afterEach(async () => {
  await env.DB.prepare("DELETE FROM client_api_rate_limits WHERE user_id = ?")
    .bind(userId)
    .run();
  await cleanupRoleTestData();
});

function consume(bucket: "read" | "write", nowMs: number, limit: number) {
  return withDatabase(env, (db) =>
    createClientRateLimitRepository(db).consume({
      userId,
      bucket,
      nowMs,
      limit,
    }),
  );
}

describe("#192 AC-1・AC-6（X-8）: D1の固定分窓", () => {
  it("#192 AC-1・AC-6（X-8）: 遅延した旧窓要求は保存窓を戻さず新窓の回数へ加算し上限を迂回できない", async () => {
    const firstWindow = Date.parse("2026-11-08T00:00:00.000Z");
    const secondWindow = firstWindow + 60_000;
    expect(await consume("read", firstWindow + 59_000, 2)).toEqual({
      windowStartedAtMs: firstWindow,
      attemptCount: 1,
    });
    expect(await consume("read", secondWindow + 1_000, 2)).toEqual({
      windowStartedAtMs: secondWindow,
      attemptCount: 1,
    });
    expect(await consume("read", firstWindow + 59_500, 2)).toEqual({
      windowStartedAtMs: secondWindow,
      attemptCount: 2,
    });
    expect(await consume("read", secondWindow + 2_000, 2)).toEqual({
      windowStartedAtMs: secondWindow,
      attemptCount: 3,
    });
    expect(await consume("read", firstWindow + 59_900, 2)).toEqual({
      windowStartedAtMs: secondWindow,
      attemptCount: 3,
    });
    const stored = await env.DB.prepare(
      "SELECT window_started_at_ms, attempt_count FROM client_api_rate_limits WHERE user_id = ? AND bucket_type = 'read'",
    )
      .bind(userId)
      .first<{ window_started_at_ms: number; attempt_count: number }>();
    expect(stored).toMatchObject({
      window_started_at_ms: secondWindow,
      attempt_count: 3,
    });
  });

  it("#192 AC-1・AC-6（X-8）: 同じ利用者の並行受付も上限を超える件数だけ拒否対象にする", async () => {
    const nowMs = Date.parse("2026-11-08T00:00:10.000Z");
    const results = await Promise.all(
      Array.from({ length: 8 }, () => consume("read", nowMs, 5)),
    );
    expect(results.filter((item) => item.attemptCount <= 5)).toHaveLength(5);
    expect(results.filter((item) => item.attemptCount > 5)).toHaveLength(3);
    const stored = await env.DB.prepare(
      "SELECT attempt_count FROM client_api_rate_limits WHERE user_id = ? AND bucket_type = 'read'",
    )
      .bind(userId)
      .first<{ attempt_count: number }>();
    expect(stored?.attempt_count).toBe(6);
  });
});
