// #120 0-2 AC-5：セッションの読み取りと、最終操作の時刻の更新（session.repository）。D1 で確かめる。
// findSession は期限の判定をせず、利用者の状態と時刻をそのまま返す（判定は Service）。touchSession は読んだ時刻のままのときだけ更新する。
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../db/schema";
import {
  cleanupAuthTestData,
  insertSession,
  sessionRow,
} from "../../test/auth-fixtures";
import {
  cleanupRoleTestData,
  insertDepartment,
  insertUser,
} from "../../test/role-fixtures";
import { createSessionRepository, withSessions } from "./session.repository";

const repo = createSessionRepository(drizzle(env.DB, { schema }));
const T0 = "2026-11-03T03:00:00.000Z";
const T1 = "2026-11-03T03:01:00.000Z";

let userId: string;
beforeEach(async () => {
  const dept = await insertDepartment("読み取りテスト部");
  userId = await insertUser("testuser_001", dept);
});
afterEach(async () => {
  await cleanupAuthTestData();
  await cleanupRoleTestData();
});

describe("findSession", () => {
  it("#120 0-2 AC-5: セッションと利用者の状態・時刻をそのまま返す", async () => {
    const s = await insertSession(userId, {
      createdAt: T0,
      lastActiveAt: T1,
      revokedAt: T1,
    });
    expect(await repo.findSession(s.id)).toEqual({
      userId,
      displayName: "テスト太郎",
      loginId: "testuser_001",
      reauthenticatedAt: null,
      mustChangePassword: true,
      isActive: true,
      createdAt: T0,
      lastActiveAt: T1,
      revokedAt: T1,
    });
  });

  it("#120 0-2 AC-7: 無効な利用者も返す（isActive=false。判定は Service）", async () => {
    const s = await insertSession(userId, { createdAt: T0 });
    await env.DB.prepare("UPDATE users SET is_active = 0 WHERE id = ?")
      .bind(userId)
      .run();
    expect((await repo.findSession(s.id))?.isActive).toBe(false);
  });

  it("#120 0-2 AC-3: ないセッションは null。別のセッションを返さない", async () => {
    await insertSession(userId, { createdAt: T0 });
    expect(await repo.findSession("0".repeat(64))).toBeNull();
  });
});

describe("touchSession", () => {
  it("#120 0-2 AC-5: 読んだ時刻のままなら now に更新して true", async () => {
    const s = await insertSession(userId, { createdAt: T0 });
    expect(await repo.touchSession(s.id, T0, new Date(T1))).toBe(true);
    expect((await sessionRow(s.id))?.last_active_at).toBe(T1);
  });

  it("#120 0-2 AC-5: 並行して更新されていたら（時刻が違う）、上書きせず false", async () => {
    const s = await insertSession(userId, { createdAt: T0, lastActiveAt: T1 });
    expect(
      await repo.touchSession(s.id, T0, new Date("2026-11-03T03:02:00.000Z")),
    ).toBe(false);
    expect((await sessionRow(s.id))?.last_active_at).toBe(T1);
  });

  it("#120 0-2 AC-5: 別のセッションは更新しない", async () => {
    const a = await insertSession(userId, { createdAt: T0 });
    const b = await insertSession(userId, { createdAt: T0 });
    await repo.touchSession(a.id, T0, new Date(T1));
    expect((await sessionRow(b.id))?.last_active_at).toBe(T0);
  });
});

describe("withSessions", () => {
  it("#120: 本物の DB につないだ Repository を渡し、結果をそのまま返す", async () => {
    const s = await insertSession(userId, { createdAt: T0 });
    const found = await withSessions(env, (r) => r.findSession(s.id));
    expect(found?.userId).toBe(userId);
  });
});
