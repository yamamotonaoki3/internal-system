// #120 コードレビュー1回目の指摘1・3：DB の障害時に個人情報を漏らさない／ログアウトの DB 失敗で Cookie を消さない。
// 置き場所：routes/ は db/ を直接読めない（依存のルール no-routes-to-db）ため、組み立てを行う src/ の直下に置く。
// createApp を通した結合テスト（ローカルの D1）。DB の障害は、本物の D1 の問い合わせを存在しない表に向けて失敗させ、
// 本物の Drizzle の例外（DrizzleQueryError。SQL とパラメータを含む）を起こす。データは架空のもの（testuser_leak_001、TestPass123!）。
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../db/schema";
import {
  AUTH_TRACE_PREFIX,
  SESSION_COOKIE,
  TEST_IP,
  cleanupAuthTestData,
  hmacHex,
  insertSession,
  newThrottleKey,
  parseSetCookie,
  sessionRow,
} from "../test/auth-fixtures";
import {
  cleanupRoleTestData,
  insertDepartment,
  insertUser,
} from "../test/role-fixtures";
import { createApp } from "./app";
import { loadConfig } from "./config";
import {
  createAuthRepository,
  type AuthRepository,
} from "./db/auth.repository";
import { withSessions } from "./db/session.repository";
import { authRoutes } from "./routes/auth";

const ALLOWED_ORIGIN = loadConfig(env).allowedOrigins[0] ?? "";
const LEAK_LOGIN_ID = "testuser_leak_001";
const LEAK_PASSWORD = "TestPass123!LeakCheck";
let throttleKey: string;
let output: () => string;

beforeEach(() => {
  throttleKey = newThrottleKey();
  const spies = [
    vi.spyOn(console, "log").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
    vi.spyOn(console, "error").mockImplementation(() => {}),
  ];
  output = () =>
    spies
      .flatMap((s) =>
        s.mock.calls.map((c: unknown[]) => c.map(String).join(" ")),
      )
      .join("\n");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupAuthTestData(
    await Promise.all(
      [TEST_IP, "local", LEAK_LOGIN_ID, "testuser_001"].map((v) =>
        hmacHex(throttleKey, v),
      ),
    ),
  );
  await cleanupRoleTestData();
});

const envWith = () =>
  ({ ...env, LOGIN_THROTTLE_KEY: throttleKey }) as unknown as Env;

/** users を読む問い合わせだけを、存在しない表に向ける D1（それ以外は本物のまま） */
function d1WithBrokenUsers(): D1Database {
  const db = env.DB;
  return new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare")
        return (query: string) =>
          target.prepare(
            /^\s*select/i.test(query)
              ? query.replace(/"users"/g, '"users_missing_unit"')
              : query,
          );
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("DB の障害時の個人情報（指摘1）", () => {
  const app = createApp({
    sessions: withSessions,
    routes: [
      {
        path: "/api/auth",
        app: authRoutes((_env, run) =>
          run(createAuthRepository(drizzle(d1WithBrokenUsers(), { schema }))),
        ),
      },
    ],
  });

  it("#120 AC-1（security）: 利用者の検索が Drizzle の例外で失敗しても、500 で、ログと応答に社員ID・パスワード・SQL のパラメータを出さない", async () => {
    const res = await app.request(
      "/api/auth/login",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: ALLOWED_ORIGIN,
          "CF-Connecting-IP": TEST_IP,
          "X-Request-Id": `${AUTH_TRACE_PREFIX}${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          loginId: LEAK_LOGIN_ID,
          password: LEAK_PASSWORD,
        }),
      },
      envWith(),
    );
    expect(res.status).toBe(500);
    const body = await res.text();
    const logs = output();
    // 本物の DB の失敗が起きたこと（ログに残っていること）を先に確かめる
    expect(logs).toMatch(/ERROR/);
    for (const secret of [
      LEAK_LOGIN_ID,
      LEAK_LOGIN_ID.toLowerCase(),
      LEAK_PASSWORD,
    ]) {
      expect(logs, secret).not.toContain(secret);
      expect(body, secret).not.toContain(secret);
    }
    expect(body).not.toMatch(/select|users_missing_unit|params/i);
  });
});

describe("ログアウトの DB 失敗と Cookie（指摘3）", () => {
  const failing = {
    revokeSession: async () => {
      throw new Error("D1 failed [UNIT_TEST]");
    },
  } as unknown as AuthRepository;
  const app = createApp({
    sessions: withSessions,
    routes: [
      { path: "/api/auth", app: authRoutes((_env, run) => run(failing)) },
    ],
  });

  let userId: string;
  beforeEach(async () => {
    const dept = await insertDepartment("ログアウト障害テスト部");
    userId = await insertUser("testuser_001", dept);
    await env.DB.prepare(
      "UPDATE users SET must_change_password = 0 WHERE id = ?",
    )
      .bind(userId)
      .run();
  });

  const logout = (token: string) =>
    app.request(
      "/api/auth/logout",
      {
        method: "POST",
        headers: {
          Origin: ALLOWED_ORIGIN,
          Cookie: `${SESSION_COOKIE}=${token}`,
          "X-Request-Id": `${AUTH_TRACE_PREFIX}${crypto.randomUUID()}`,
        },
      },
      envWith(),
    );

  /** 応答に、セッションの Cookie を消す Set-Cookie が付いていないこと */
  function expectNoCookieDeletion(res: Response) {
    const cookie = parseSetCookie(res.headers.get("Set-Cookie"));
    expect(
      cookie !== null &&
        cookie.name === SESSION_COOKIE &&
        cookie.attributes.get("max-age") === "0",
    ).toBe(false);
  }

  it("#120 0-2 AC-2: 有効な Cookie で失効の DB 処理が失敗したら、500 で Cookie を消さない", async () => {
    const s = await insertSession(userId, {
      createdAt: new Date().toISOString(),
    });
    const res = await logout(s.token);
    expect(res.status).toBe(500);
    expectNoCookieDeletion(res);
    expect((await sessionRow(s.id))?.revoked_at).toBeNull();
  });

  it("#120 0-2 AC-2: 期限切れの Cookie で失効の DB 処理が失敗したら、500 で Cookie を消さない", async () => {
    const old = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();
    const s = await insertSession(userId, { createdAt: old });
    const res = await logout(s.token);
    expect(res.status).toBe(500);
    expectNoCookieDeletion(res);
  });

  it("#120 0-2 AC-2: 失効済みの Cookie で失効の DB 処理が失敗したら、500 で Cookie を消さない", async () => {
    const now = new Date().toISOString();
    const s = await insertSession(userId, { createdAt: now, revokedAt: now });
    const res = await logout(s.token);
    expect(res.status).toBe(500);
    expectNoCookieDeletion(res);
  });
});
