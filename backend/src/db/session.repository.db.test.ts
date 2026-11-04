// #120（改訂版：失効関数）：全セッションの失効・他のセッションの失効の文。呼び出し元は #123・#127・無効化のIssue。
// 文を返すだけで実行しない（業務の更新・監査と同じ db.batch に入れる）。D1 で確かめる。
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
import {
  revokeAllForUserStatement,
  revokeOthersForUserStatement,
} from "./session.repository";

const db = drizzle(env.DB, { schema });
const T0 = "2026-11-03T03:00:00.000Z";
const T1 = "2026-11-03T03:05:00.000Z";

let userId: string;
let otherUserId: string;
beforeEach(async () => {
  const dept = await insertDepartment("失効テスト部");
  userId = await insertUser("testuser_001", dept);
  otherUserId = await insertUser("testuser_002", dept);
});
afterEach(async () => {
  await cleanupAuthTestData();
  await cleanupRoleTestData();
});

describe("セッションの失効の文", () => {
  it("#120: revokeAllForUserStatement は、その利用者の有効なセッションをすべて失効させ、他人と失効済みは変えない", async () => {
    const a = await insertSession(userId, { createdAt: T0 });
    const b = await insertSession(userId, { createdAt: T0 });
    const done = await insertSession(userId, { createdAt: T0, revokedAt: T0 });
    const others = await insertSession(otherUserId, { createdAt: T0 });
    await db.batch([revokeAllForUserStatement(db, userId, T1)]);
    expect((await sessionRow(a.id))?.revoked_at).toBe(T1);
    expect((await sessionRow(b.id))?.revoked_at).toBe(T1);
    expect((await sessionRow(done.id))?.revoked_at).toBe(T0);
    expect((await sessionRow(others.id))?.revoked_at).toBeNull();
  });

  it("#120: revokeOthersForUserStatement は、現在のセッションを除いて失効させる", async () => {
    const current = await insertSession(userId, { createdAt: T0 });
    const other = await insertSession(userId, { createdAt: T0 });
    await db.batch([revokeOthersForUserStatement(db, userId, current.id, T1)]);
    expect((await sessionRow(current.id))?.revoked_at).toBeNull();
    expect((await sessionRow(other.id))?.revoked_at).toBe(T1);
  });
});
