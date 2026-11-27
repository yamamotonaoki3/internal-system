// #383 AC-1・AC-2（2026-11-25 の利用者の決定で書き換えた AC-2）：期限切れ・失効・無効なセッションの Cookie を持った通常の要求は、
// 今までどおり認証を拒否するが、応答でセッションの Cookie を消さない。明示的なログアウトは、失効の確定の後に Cookie を消す（対照）。
// 別のタブのログインが古いセッションを失効させた後に、古い Cookie のままの要求が届いても、応答で新しいセッションの Cookie を消さない（AC-1 のサーバーの側）。
// 結合のテスト：実際の入口（index.ts の app）を、ローカルの D1 に対して呼ぶ。LOGIN_THROTTLE_KEY はテストの中で乱数から作る。
// Cookie の名前・期待の値はテストの側に独立に書く（本番の定数を読み込まない）。データは架空のもの（testuser_、[UNIT_TEST]、TestPass123!）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_TRACE_PREFIX,
  SCRYPT_TEST_TIMEOUT_MS,
  TEST_IP,
  TEST_PASSWORD,
  TEST_PASSWORD_HASH,
  cleanupAuthTestData,
  hmacHex,
  insertSession,
  newThrottleKey,
  setUserPassword,
  sessionRow,
  sha256Hex,
} from "../../test/auth-fixtures";
import {
  cleanupRoleTestData,
  insertDepartment,
  insertUser,
} from "../../test/role-fixtures";
import { loadConfig } from "../config";
import { app } from "../index";

const SESSION_COOKIE_NAME = "__Host-session";
const ALLOWED_ORIGIN = loadConfig(env).allowedOrigins[0] ?? "";
const MIN = 60_000;

let throttleKey: string;
let userA: string;
let userB: string;

function envWith() {
  return { ...env, LOGIN_THROTTLE_KEY: throttleKey } as unknown as Env;
}

function request(
  method: string,
  path: string,
  options: { cookie?: string | null; body?: unknown } = {},
) {
  const headers: Record<string, string> = {
    Origin: ALLOWED_ORIGIN,
    "CF-Connecting-IP": TEST_IP,
    "X-Request-Id": `${AUTH_TRACE_PREFIX}${crypto.randomUUID()}`,
  };
  if (options.cookie != null)
    headers.Cookie = `${SESSION_COOKIE_NAME}=${options.cookie}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(
    path,
    {
      method,
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    },
    envWith(),
  );
}

const login = (loginId: string, password: string, cookie?: string | null) =>
  request("POST", "/api/auth/login", {
    cookie,
    body: { loginId, password },
  });

/** 応答の Set-Cookie のうち、セッションの Cookie（名前が __Host-session）のものだけ。中身が分かるよう、文字列のまま返す */
function sessionSetCookies(res: Response): string[] {
  return res.headers
    .getSetCookie()
    .filter((line) => line.trim().startsWith(`${SESSION_COOKIE_NAME}=`));
}

function attributesOf(line: string) {
  const [pair = "", ...attrs] = line.split(";").map((s) => s.trim());
  const map = new Map<string, string>();
  for (const attr of attrs) {
    const i = attr.indexOf("=");
    if (i === -1) map.set(attr.toLowerCase(), "");
    else map.set(attr.slice(0, i).toLowerCase(), attr.slice(i + 1));
  }
  return { value: pair.slice(pair.indexOf("=") + 1), attributes: map };
}

/** その Set-Cookie が、Cookie を消す指示か（Max-Age=0 以下・過去の Expires・空の値） */
function isDeletion(line: string): boolean {
  const { value, attributes } = attributesOf(line);
  const maxAge = attributes.get("max-age");
  const expires = attributes.get("expires");
  return (
    value === "" ||
    (maxAge !== undefined && Number(maxAge) <= 0) ||
    (expires !== undefined && new Date(expires).getTime() <= Date.now())
  );
}

/** 通常の要求の応答では、セッションの Cookie を消さない（Set-Cookie で Cookie を変えない） */
function expectSessionCookieUntouched(res: Response) {
  const lines = sessionSetCookies(res);
  expect(
    lines.filter(isDeletion),
    "セッションの Cookie を消す Set-Cookie",
  ).toEqual([]);
  expect(lines, "セッションの Cookie の Set-Cookie").toEqual([]);
}

/** このテストが使う試行制限のキー（後始末のため） */
const knownBucketKeys = () =>
  Promise.all(
    [TEST_IP, "testuser_cookie_a", "testuser_cookie_b"].map((v) =>
      hmacHex(throttleKey, v),
    ),
  );

/** 使えないセッションの Cookie（失効・期限切れ・存在しない・形が壊れている）。期限は 0-2 AC-5 の値から独立に作る */
async function unusableCookies(): Promise<[string, string][]> {
  const now = Date.now();
  const revoked = await insertSession(userA, {
    createdAt: new Date(now - 10 * MIN).toISOString(),
    revokedAt: new Date(now - MIN).toISOString(),
  });
  const idle = await insertSession(userA, {
    createdAt: new Date(now - 40 * MIN).toISOString(),
    lastActiveAt: new Date(now - 30 * MIN - 1000).toISOString(),
  });
  const tooOld = await insertSession(userA, {
    createdAt: new Date(now - 24 * 60 * MIN - 1000).toISOString(),
    lastActiveAt: new Date(now - MIN).toISOString(),
  });
  return [
    ["失効", revoked.token],
    ["期限切れ（無操作30分）", idle.token],
    ["期限切れ（ログインから24時間）", tooOld.token],
    ["存在しないトークン", "bogus-token-383"],
    ["形が壊れている", "not*a*valid*token"],
  ];
}

beforeEach(async () => {
  throttleKey = newThrottleKey();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const dept = await insertDepartment("Cookie383テスト部");
  userA = await insertUser("testuser_cookie_a", dept);
  userB = await insertUser("testuser_cookie_b", dept);
  await setUserPassword(userA, TEST_PASSWORD_HASH);
  await setUserPassword(userB, TEST_PASSWORD_HASH);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupAuthTestData(await knownBucketKeys());
  await cleanupRoleTestData();
});

describe("#383 AC-1・AC-2 通常の要求では、使えないセッションの Cookie を消さない", () => {
  it("#383 AC-1・AC-2: 保護された API（GET /api/me/unread）は、失効・期限切れ・存在しない・形の壊れた Cookie で 401 UNAUTHENTICATED を返し、セッションの Cookie を消さない", async () => {
    for (const [label, cookie] of await unusableCookies()) {
      const res = await request("GET", "/api/me/unread", { cookie });
      expect(res.status, label).toBe(401);
      expect(await res.json(), label).toMatchObject({
        code: "UNAUTHENTICATED",
      });
      expectSessionCookieUntouched(res);
    }
  });

  it("#383 AC-1・AC-2: 状態を変える保護された API（POST）も、使えない Cookie では 401 を返し、セッションの Cookie を消さない", async () => {
    for (const [label, cookie] of await unusableCookies()) {
      const res = await request(
        "POST",
        "/api/rooms/01JC000000000000000ROOM383/messages",
        {
          cookie,
          body: { body: "[UNIT_TEST]#383 の投稿" },
        },
      );
      expect(res.status, label).toBe(401);
      expect(await res.json(), label).toMatchObject({
        code: "UNAUTHENTICATED",
      });
      expectSessionCookieUntouched(res);
    }
  });

  it("#383 AC-1・AC-2: GET /api/auth/session は、使えない Cookie で 401 UNAUTHENTICATED（no-store）を返し、セッションの Cookie を消さない", async () => {
    for (const [label, cookie] of await unusableCookies()) {
      const res = await request("GET", "/api/auth/session", { cookie });
      expect(res.status, label).toBe(401);
      expect(res.headers.get("Cache-Control"), label).toBe("no-store");
      expect(await res.json(), label).toMatchObject({
        code: "UNAUTHENTICATED",
      });
      expectSessionCookieUntouched(res);
    }
  });

  it("#383 AC-2: 認証の要らない GET /api/health は、使えない Cookie でも今までの応答（200）のまま、セッションの Cookie を消さない", async () => {
    for (const [label, cookie] of await unusableCookies()) {
      const res = await request("GET", "/api/health", { cookie });
      expect(res.status, label).toBe(200);
      expectSessionCookieUntouched(res);
    }
  });

  it(
    "#383 AC-2: ログインの失敗（パスワードの誤り）は、使えない Cookie を持っていても 401 INVALID_CREDENTIALS で、Set-Cookie でセッションの Cookie を変えない",
    { timeout: SCRYPT_TEST_TIMEOUT_MS },
    async () => {
      const [, revokedToken] = (await unusableCookies())[0] ?? [];
      const res = await login(
        "testuser_cookie_a",
        "WrongPass123!",
        revokedToken,
      );
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: "INVALID_CREDENTIALS" });
      expectSessionCookieUntouched(res);
    },
  );

  it(
    "#383 AC-1・AC-2: 使えない Cookie を持ったままのログインの成功は、新しいセッションの Cookie を 1 件だけ設定する（古い Cookie を消す Set-Cookie と、新しいものの 2 件にならない）",
    { timeout: SCRYPT_TEST_TIMEOUT_MS },
    async () => {
      for (const [label, cookie] of await unusableCookies()) {
        const res = await login("testuser_cookie_a", TEST_PASSWORD, cookie);
        expect(res.status, label).toBe(200);
        const lines = sessionSetCookies(res);
        expect(lines, label).toHaveLength(1);
        const [line = ""] = lines;
        expect(isDeletion(line), label).toBe(false);
        const { value, attributes } = attributesOf(line);
        expect(value, label).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(value, label).not.toBe(cookie);
        expect(attributes.get("max-age"), label).toBe("86400");
        // 新しいトークンで、ログイン中として通る
        expect(
          (await request("GET", "/api/auth/session", { cookie: value })).status,
          label,
        ).toBe(200);
      }
    },
  );
});

describe(
  "#383 AC-1 別のタブのログインの後に、古い Cookie のままの要求が届く",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it("#383 AC-1: B のログインが A の古いセッションを失効させた後、A の古い Cookie の要求は 401 になり、セッションの Cookie を消さない。B の新しいセッションはそのまま使える", async () => {
      const old = await insertSession(userA, {
        createdAt: new Date(Date.now() - 5 * MIN).toISOString(),
      });
      // 別のタブ（同じブラウザの Cookie）で B がログインする。要求は A の古い Cookie を持っている
      const loggedIn = await login(
        "testuser_cookie_b",
        TEST_PASSWORD,
        old.token,
      );
      expect(loggedIn.status).toBe(200);
      const [newLine = ""] = sessionSetCookies(loggedIn);
      const newToken = attributesOf(newLine).value;
      expect(newToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      // ログインが、A の古いセッションを失効させた（競合が起きる前提が成り立っている）
      expect((await sessionRow(old.id))?.revoked_at).not.toBeNull();

      // ログインの確定の後に、古いタブの要求が、A の古い Cookie で届く
      for (const [method, path] of [
        ["GET", "/api/me/unread"],
        ["GET", "/api/auth/session"],
      ] as const) {
        const stale = await request(method, path, { cookie: old.token });
        expect(stale.status, path).toBe(401);
        expect(await stale.json(), path).toMatchObject({
          code: "UNAUTHENTICATED",
        });
        expectSessionCookieUntouched(stale);
      }

      // B の新しいセッションは、ログイン中として通る
      const session = await request("GET", "/api/auth/session", {
        cookie: newToken,
      });
      expect(session.status).toBe(200);
      expect(await session.json()).toMatchObject({ user: { id: userB } });
    });

    it("#383 AC-2（対照）: 明示的なログアウトは、今までどおり 204 で、失効を確定した後にセッションの Cookie を Max-Age=0 で消す", async () => {
      const loggedIn = await login("testuser_cookie_a", TEST_PASSWORD);
      const token = attributesOf(sessionSetCookies(loggedIn)[0] ?? "").value;
      const res = await request("POST", "/api/auth/logout", { cookie: token });
      expect(res.status).toBe(204);
      const lines = sessionSetCookies(res);
      expect(lines).toHaveLength(1);
      const { attributes } = attributesOf(lines[0] ?? "");
      expect(attributes.get("max-age")).toBe("0");
      expect(attributes.get("path")).toBe("/");
      expect(attributes.has("secure")).toBe(true);
      expect(
        (await sessionRow(await sha256Hex(token)))?.revoked_at,
      ).not.toBeNull();
    });

    it("#383 AC-2（対照）: 失効済みの Cookie での明示的なログアウトも、今までどおり 204 と Cookie の削除（べき等）", async () => {
      const [, revokedToken] = (await unusableCookies())[0] ?? [];
      const res = await request("POST", "/api/auth/logout", {
        cookie: revokedToken,
      });
      expect(res.status).toBe(204);
      const lines = sessionSetCookies(res);
      expect(lines).toHaveLength(1);
      expect(isDeletion(lines[0] ?? "")).toBe(true);
    });
  },
);
