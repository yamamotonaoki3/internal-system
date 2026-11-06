// #120 AC-1〜AC-3・0-2 AC-1/2/4/5/6/7：ログイン・ログアウト・セッションの API（POST /api/auth/login・POST /api/auth/logout・GET /api/auth/session）。
// 結合のテスト：実際の入口（index.ts の app）を、本物と同じ実行エンジン（workerd）のローカルの D1 に対して呼ぶ。
// LOGIN_THROTTLE_KEY はテストの中で乱数から作り、要求ごとの環境（env）に入れる（実際の値をファイルに書かない）。
// 接続元は CF-Connecting-IP に文書用のアドレス（192.0.2.x）を入れる。期限の境界は Date だけを固定して確かめる。
// データは架空のもの（testuser_、[UNIT_TEST]、TestPass123!）。
import { scrypt } from "node:crypto";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_TRACE_PREFIX,
  SESSION_COOKIE,
  TEST_IP,
  SCRYPT_TEST_TIMEOUT_MS,
  TEST_PASSWORD,
  TEST_PASSWORD_HASH,
  authAuditRows,
  cleanupAuthTestData,
  hmacHex,
  insertSession,
  loginAttemptRow,
  newThrottleKey,
  parseSetCookie,
  sessionRow,
  setUserPassword,
  sha256Hex,
} from "../../test/auth-fixtures";
import {
  cleanupRoleTestData,
  countRows,
  insertDepartment,
  insertUser,
} from "../../test/role-fixtures";
import { loadConfig } from "../config";
import { app } from "../index";
import { verifyPassword } from "../lib/password";

const ALLOWED_ORIGIN = loadConfig(env).allowedOrigins[0] ?? "";
const MIN = 60_000;

let throttleKey: string;
// 事前に計算した固定のハッシュ（毎回 hashPassword しない。並列の実行での時間切れを防ぐ）
const currentHash = TEST_PASSWORD_HASH;
let userId: string;
let inactiveUserId: string;

function envWith(overrides: Record<string, unknown> = {}) {
  return {
    ...env,
    LOGIN_THROTTLE_KEY: throttleKey,
    ...overrides,
  } as unknown as Env;
}

type RequestOptions = {
  env?: Env;
  origin?: string | null;
  ip?: string | null;
  cookie?: string | null;
};

function headers(options: RequestOptions, json: boolean) {
  const h: Record<string, string> = {
    "X-Request-Id": `${AUTH_TRACE_PREFIX}${crypto.randomUUID()}`,
  };
  if (json) h["Content-Type"] = "application/json";
  const origin = options.origin === undefined ? ALLOWED_ORIGIN : options.origin;
  if (origin !== null) h.Origin = origin;
  const ip = options.ip === undefined ? TEST_IP : options.ip;
  if (ip !== null) h["CF-Connecting-IP"] = ip;
  if (options.cookie != null) h.Cookie = `${SESSION_COOKIE}=${options.cookie}`;
  return h;
}

const postLogin = (body: unknown, options: RequestOptions = {}) =>
  app.request(
    "/api/auth/login",
    {
      method: "POST",
      headers: headers(options, true),
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    options.env ?? envWith(),
  );

const postLogout = (options: RequestOptions = {}) =>
  app.request(
    "/api/auth/logout",
    { method: "POST", headers: headers(options, false) },
    options.env ?? envWith(),
  );

const getSession = (options: RequestOptions = {}) =>
  app.request(
    "/api/auth/session",
    { headers: headers({ origin: null, ...options }, false) },
    options.env ?? envWith(),
  );

const credentials = (loginId = "testuser_001", password = TEST_PASSWORD) => ({
  loginId,
  password,
});

const sessionCookieOf = (res: Response) =>
  parseSetCookie(res.headers.get("Set-Cookie"));

/** このテストが使う試行制限のキー（後始末のため） */
async function knownBucketKeys() {
  const values = [
    TEST_IP,
    "192.0.2.20",
    "local",
    "testuser_001",
    "testuser_002",
    "testuser_009",
    "testuser_999",
  ];
  return Promise.all(values.map((v) => hmacHex(throttleKey, v)));
}

const b64 = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString("base64").replace(/=+$/, "");

/** 合成した旧パラメータ（ln=14,r=8,p=1）のハッシュ */
async function legacyHash(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password,
      salt,
      32,
      { N: 2 ** 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (e, k) => (e === null ? resolve(k) : reject(e)),
    ),
  );
  return `$scrypt$ln=14,r=8,p=1$${b64(salt)}$${b64(key)}`;
}

beforeEach(async () => {
  throttleKey = newThrottleKey();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const dept = await insertDepartment("ログインテスト部");
  userId = await insertUser("testuser_001", dept);
  inactiveUserId = await insertUser("testuser_002", dept, { isActive: false });
  await setUserPassword(userId, currentHash);
  await setUserPassword(inactiveUserId, currentHash);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupAuthTestData(await knownBucketKeys());
  await cleanupRoleTestData();
});

describe(
  "POST /api/auth/login（成功）",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it("#120 0-2 AC-1: 正しい社員IDとパスワードで 200。利用者の ID・表示名と mustChangePassword を返す", async () => {
      const res = await postLogin(credentials());
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        user: {
          id: userId,
          displayName: "テスト太郎",
          loginId: "testuser_001",
        },
        mustChangePassword: false,
        reauthenticatedAt: null,
      });
    });

    it("#120 0-2 AC-1（D-4）: Cookie は __Host-session、HttpOnly・Secure・SameSite=Lax・Path=/・Domain なし・Max-Age=86400", async () => {
      const res = await postLogin(credentials());
      const cookie = sessionCookieOf(res);
      expect(cookie?.name).toBe("__Host-session");
      expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(cookie?.attributes.has("httponly")).toBe(true);
      expect(cookie?.attributes.has("secure")).toBe(true);
      expect(cookie?.attributes.get("samesite")?.toLowerCase()).toBe("lax");
      expect(cookie?.attributes.get("path")).toBe("/");
      expect(cookie?.attributes.has("domain")).toBe(false);
      expect(cookie?.attributes.get("max-age")).toBe("86400");
    });

    it("#120 0-2 AC-1: DB にはトークンそのものではなく、SHA-256 だけを保存する。本文にもトークンを出さない", async () => {
      const res = await postLogin(credentials());
      const token = sessionCookieOf(res)?.value ?? "";
      expect(await sessionRow(await sha256Hex(token))).toMatchObject({
        user_id: userId,
        revoked_at: null,
      });
      expect(await sessionRow(token)).toBeNull();
      expect(JSON.stringify(await res.json())).not.toContain(token);
    });

    it("#120 0-2 AC-1（C-58）: 応答はキャッシュさせない（no-store）", async () => {
      const res = await postLogin(credentials());
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    });

    it("#120 0-2 AC-1: 社員IDは大文字小文字を区別しない", async () => {
      expect((await postLogin(credentials("TestUser_001"))).status).toBe(200);
    });

    it("#120 0-2 AC-1（固定化対策）: 既存のセッションの Cookie を持ってログインすると、新しいトークンを発行し、古いセッションを失効させる", async () => {
      const old = await insertSession(userId, {
        createdAt: new Date().toISOString(),
      });
      const res = await postLogin(credentials(), { cookie: old.token });
      expect(res.status).toBe(200);
      expect(sessionCookieOf(res)?.value).not.toBe(old.token);
      expect((await sessionRow(old.id))?.revoked_at).not.toBeNull();
    });

    it("#120 0-2 AC-6: 同じアカウントで2回ログインすると、どちらのセッションも使える", async () => {
      const a = sessionCookieOf(await postLogin(credentials()))?.value ?? "";
      const b = sessionCookieOf(await postLogin(credentials()))?.value ?? "";
      expect(a).not.toBe(b);
      expect((await getSession({ cookie: a })).status).toBe(200);
      expect((await getSession({ cookie: b })).status).toBe(200);
    });

    it("#120 0-2 AC-1: 初回パスワードの利用者は mustChangePassword=true（強制変更の本体は #123）", async () => {
      await setUserPassword(userId, currentHash, { mustChangePassword: true });
      const res = await postLogin(credentials());
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ mustChangePassword: true });
    });

    it("#120 AC-1（監査）: 成功は auth.login の success（操作者は本人）。社員ID・パスワード・トークン・IPを含まない", async () => {
      const res = await postLogin(credentials());
      const token = sessionCookieOf(res)?.value ?? "";
      const rows = await authAuditRows();
      expect(rows).toEqual([
        expect.objectContaining({
          action: "auth.login",
          result: "success",
          actor_id: userId,
        }),
      ]);
      const text = JSON.stringify(rows);
      for (const secret of ["testuser_001", TEST_PASSWORD, token, TEST_IP])
        expect(text).not.toContain(secret);
    });
  },
);

describe(
  "POST /api/auth/login（再ハッシュ。AC-2）",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it("#120 AC-2: 旧パラメータのハッシュの利用者はログインでき、現行のパラメータのハッシュに置き換わる", async () => {
      await setUserPassword(userId, await legacyHash(TEST_PASSWORD));
      expect((await postLogin(credentials())).status).toBe(200);
      const row = await env.DB.prepare(
        "SELECT password_hash FROM users WHERE id = ?",
      )
        .bind(userId)
        .first<{ password_hash: string }>();
      expect(row?.password_hash).toMatch(/^\$scrypt\$ln=16,r=8,p=2\$/);
      expect(
        await verifyPassword(TEST_PASSWORD, row?.password_hash ?? ""),
      ).toBe(true);
    });

    it("#120 AC-2: 現行のハッシュは、ログインしても置き換えない", async () => {
      await postLogin(credentials());
      const row = await env.DB.prepare(
        "SELECT password_hash FROM users WHERE id = ?",
      )
        .bind(userId)
        .first<{ password_hash: string }>();
      expect(row?.password_hash).toBe(currentHash);
    });
  },
);

describe(
  "POST /api/auth/login（失敗。0-2 AC-7）",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    /** 応答を比べられる形にする（本文と、すべてのヘッダー） */
    async function shape(res: Response) {
      return {
        status: res.status,
        body: await res.text(),
        headers: [...res.headers.entries()].sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      };
    }

    it("#120 0-2 AC-7: 存在しない社員ID・誤ったパスワード・無効化した利用者は、状態・本文・ヘッダーまで同じ 401", async () => {
      const unknown = await shape(await postLogin(credentials("testuser_999")));
      const wrong = await shape(
        await postLogin(credentials("testuser_001", "WrongPass123!")),
      );
      const inactive = await shape(
        await postLogin(credentials("testuser_002")),
      );
      expect(unknown.status).toBe(401);
      expect(JSON.parse(unknown.body)).toMatchObject({
        code: "INVALID_CREDENTIALS",
      });
      expect(wrong).toEqual(unknown);
      expect(inactive).toEqual(unknown);
    });

    it("#120 0-2 AC-7: 失敗では Cookie を発行せず、セッションを作らない。応答は no-store", async () => {
      const before = await countRows("sessions");
      const res = await postLogin(credentials("testuser_001", "WrongPass123!"));
      expect(res.headers.get("Set-Cookie")).toBeNull();
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await countRows("sessions")).toBe(before);
    });

    it("#120 0-2 AC-7: 文言は、社員IDとパスワードのどちらが違うかを示さない", async () => {
      const body = (await (
        await postLogin(credentials("testuser_999"))
      ).json()) as { message: string };
      expect(body.message).toContain("社員ID");
      expect(body.message).toContain("パスワード");
      expect(body.message).not.toMatch(/存在しません|見つかりません|無効/);
    });

    it("#120 AC-1（監査）: 失敗は auth.login の failure（操作者は null）。社員ID・パスワード・IPを含まない", async () => {
      await postLogin(credentials("testuser_999", "WrongPass123!"));
      const rows = await authAuditRows();
      expect(rows).toEqual([
        expect.objectContaining({
          action: "auth.login",
          result: "failure",
          actor_id: null,
        }),
      ]);
      const text = JSON.stringify(rows);
      for (const secret of ["testuser_999", "WrongPass123!", TEST_IP])
        expect(text).not.toContain(secret);
    });

    it("#120 AC-3: 失敗は社員IDの失敗数（HMAC のキー）として残り、生の社員ID・IPは DB に残らない", async () => {
      await postLogin(credentials("testuser_001", "WrongPass123!"));
      const account = await loginAttemptRow(
        "account",
        await hmacHex(throttleKey, "testuser_001"),
      );
      expect(account?.failed_count).toBe(1);
      const { results } = await env.DB.prepare(
        "SELECT * FROM login_attempts",
      ).all<Record<string, unknown>>();
      for (const row of results) {
        expect(String(row.bucket_key)).toMatch(/^[0-9a-f]{64}$/);
        const text = JSON.stringify(row);
        expect(text).not.toContain("192.0.2");
        expect(text).not.toContain("testuser");
      }
    });
  },
);

describe(
  "POST /api/auth/login（入力・設定の不備）",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it("#120 0-2 AC-1: 欄の欠落・型の違い・壊れた JSON は 422。受付枠を使わず、監査も残さない", async () => {
      for (const body of [
        {},
        { loginId: "testuser_001" },
        { password: TEST_PASSWORD },
        { loginId: 1, password: TEST_PASSWORD },
        { loginId: "testuser_001", password: ["x"] },
        "{bad",
      ]) {
        const res = await postLogin(body);
        expect(res.status, JSON.stringify(body)).toBe(422);
        expect(await res.json()).toMatchObject({ code: "VALIDATION_ERROR" });
      }
      expect(
        await loginAttemptRow("source", await hmacHex(throttleKey, TEST_IP)),
      ).toBeNull();
      expect(await authAuditRows()).toEqual([]);
    });

    it("#120 AC-3: LOGIN_THROTTLE_KEY が未設定・形式不正なら 503（ログインさせない）", async () => {
      for (const value of [undefined, "", "short"]) {
        const res = await postLogin(credentials(), {
          env: envWith({ LOGIN_THROTTLE_KEY: value }),
        });
        expect(res.status, String(value)).toBe(503);
        expect(res.headers.get("Set-Cookie")).toBeNull();
      }
    });

    it("#120 AC-3（D-5）: 本番で CF-Connecting-IP が無いときは 503", async () => {
      const res = await postLogin(credentials(), {
        env: envWith({ APP_ENV: "production" }),
        ip: null,
      });
      expect(res.status).toBe(503);
      expect(res.headers.get("Set-Cookie")).toBeNull();
    });

    it("#120 AC-3（D-5）: テストの環境で CF-Connecting-IP が無いときは、固定の値 local のキーで数える", async () => {
      const res = await postLogin(credentials(), { ip: null });
      expect(res.status).toBe(200);
      expect(
        await loginAttemptRow("source", await hmacHex(throttleKey, "local")),
      ).not.toBeNull();
    });

    it("#120 AC-3: X-Forwarded-For は使わない（CF-Connecting-IP の値で数える）", async () => {
      await app.request(
        "/api/auth/login",
        {
          method: "POST",
          headers: {
            ...headers({}, true),
            "X-Forwarded-For": "192.0.2.20",
          },
          body: JSON.stringify(credentials()),
        },
        envWith(),
      );
      expect(
        await loginAttemptRow("source", await hmacHex(throttleKey, TEST_IP)),
      ).not.toBeNull();
      expect(
        await loginAttemptRow(
          "source",
          await hmacHex(throttleKey, "192.0.2.20"),
        ),
      ).toBeNull();
    });
  },
);

describe(
  "POST /api/auth/login（送信元。C-28）",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it("#120 0-2 AC-3: 許可していない・欠落・null の Origin は 403 で、セッションも監査も作らない", async () => {
      for (const origin of ["https://origin.invalid", null, "null"]) {
        const res = await postLogin(credentials(), { origin });
        expect(res.status, String(origin)).toBe(403);
        expect(await res.json()).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
        expect(res.headers.get("Set-Cookie")).toBeNull();
      }
      expect(await authAuditRows()).toEqual([]);
    });

    it("#120 0-2 AC-3: OPTIONS ではログインの処理をしない（セッションも監査も作らない）", async () => {
      const before = await countRows("sessions");
      await app.request(
        "/api/auth/login",
        { method: "OPTIONS", headers: headers({}, false) },
        envWith(),
      );
      expect(await countRows("sessions")).toBe(before);
      expect(await authAuditRows()).toEqual([]);
    });
  },
);

describe(
  "POST /api/auth/login（接続元の制限。AC-3・D-1）",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    async function seedSource(row: {
      attemptCount: number;
      windowStartedAt: string;
      lockedUntil: string | null;
    }) {
      const key = await hmacHex(throttleKey, TEST_IP);
      await env.DB.prepare(
        `INSERT INTO login_attempts (bucket_type, bucket_key, attempt_count, failed_count, window_started_at, locked_until, last_failed_at, updated_at)
       VALUES ('source', ?, ?, NULL, ?, ?, NULL, ?)`,
      )
        .bind(
          key,
          row.attemptCount,
          row.windowStartedAt,
          row.lockedUntil,
          row.windowStartedAt,
        )
        .run();
      return key;
    }

    it("#120 AC-3: ロック中の接続元は、正しいパスワードでも 429。Retry-After（秒）を付け、本文には残り時間・どの制限かを出さない", async () => {
      const now = Date.now();
      await seedSource({
        attemptCount: 31,
        windowStartedAt: new Date(now - MIN).toISOString(),
        lockedUntil: new Date(now + 10 * MIN).toISOString(),
      });
      const res = await postLogin(credentials());
      expect(res.status).toBe(429);
      const retryAfter = Number(res.headers.get("Retry-After"));
      expect(retryAfter).toBeGreaterThan(9 * 60);
      expect(retryAfter).toBeLessThanOrEqual(10 * 60);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(res.headers.get("Set-Cookie")).toBeNull();
      const body = (await res.json()) as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(["code", "message"]);
      expect(body.code).toBe("RATE_LIMITED");
    });

    it("#120 AC-3: ロック中の 429 は、監査ログ（D1）に残さない（ロックに入った1回だけ残す）", async () => {
      const now = Date.now();
      await seedSource({
        attemptCount: 31,
        windowStartedAt: new Date(now - MIN).toISOString(),
        lockedUntil: new Date(now + 10 * MIN).toISOString(),
      });
      await postLogin(credentials());
      await postLogin(credentials());
      expect(await authAuditRows()).toEqual([]);
    });

    it("#120 AC-3（最終の修正 2）: 成功も受付に数える。29回受け付けた後の30回目は成功し、31回目は正しいパスワードでも 429", async () => {
      await seedSource({
        attemptCount: 29,
        windowStartedAt: new Date(Date.now() - MIN).toISOString(),
        lockedUntil: null,
      });
      expect((await postLogin(credentials())).status).toBe(200);
      const res = await postLogin(credentials());
      expect(res.status).toBe(429);
      const rows = await authAuditRows();
      expect(rows.filter((r) => r.action === "auth.rate_limited")).toHaveLength(
        1,
      );
    });

    it("#120 AC-3: 429 の応答は、存在する社員IDでも存在しない社員IDでも同じ", async () => {
      const now = Date.now();
      await seedSource({
        attemptCount: 31,
        windowStartedAt: new Date(now - MIN).toISOString(),
        lockedUntil: new Date(now + 10 * MIN).toISOString(),
      });
      const a = await postLogin(credentials("testuser_001"));
      const b = await postLogin(credentials("testuser_999"));
      expect(a.status).toBe(429);
      expect(b.status).toBe(429);
      expect(await a.text()).toBe(await b.text());
    });

    it("#120 AC-3: 別の接続元は、ロックの影響を受けない", async () => {
      const now = Date.now();
      await seedSource({
        attemptCount: 31,
        windowStartedAt: new Date(now - MIN).toISOString(),
        lockedUntil: new Date(now + 10 * MIN).toISOString(),
      });
      expect(
        (await postLogin(credentials(), { ip: "192.0.2.20" })).status,
      ).toBe(200);
    });

    it("#120 AC-3（ADR-0008）: 成功しても接続元の受付数は戻らず、社員IDの失敗数は0に戻る", async () => {
      await postLogin(credentials("testuser_001", "WrongPass123!"));
      await postLogin(credentials());
      const source = await loginAttemptRow(
        "source",
        await hmacHex(throttleKey, TEST_IP),
      );
      expect(source?.attempt_count).toBe(2);
      const account = await loginAttemptRow(
        "account",
        await hmacHex(throttleKey, "testuser_001"),
      );
      expect(account === null || account.failed_count === 0).toBe(true);
    });
  },
);

describe(
  "POST /api/auth/logout（0-2 AC-2・AC-6）",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    async function loginToken() {
      return sessionCookieOf(await postLogin(credentials()))?.value ?? "";
    }

    it("#120 0-2 AC-2: 204。そのセッションを失効させ、同じ名前の Cookie を Max-Age=0 で消す。応答は no-store", async () => {
      const token = await loginToken();
      const res = await postLogout({ cookie: token });
      expect(res.status).toBe(204);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      const cookie = sessionCookieOf(res);
      expect(cookie?.name).toBe("__Host-session");
      expect(cookie?.attributes.get("max-age")).toBe("0");
      expect(cookie?.attributes.get("path")).toBe("/");
      expect(cookie?.attributes.has("secure")).toBe(true);
      expect(
        (await sessionRow(await sha256Hex(token)))?.revoked_at,
      ).not.toBeNull();
    });

    it("#120 0-2 AC-2: ログアウトした後のトークンは、使えない（401）", async () => {
      const token = await loginToken();
      await postLogout({ cookie: token });
      const res = await getSession({ cookie: token });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    });

    it("#120 0-2 AC-6: ログアウトは、その端末のセッションだけが対象（別の端末は使える）", async () => {
      const a = await loginToken();
      const b = await loginToken();
      await postLogout({ cookie: a });
      expect((await getSession({ cookie: a })).status).toBe(401);
      expect((await getSession({ cookie: b })).status).toBe(200);
    });

    it("#120 AC-1（監査）: ログアウトは auth.logout の success（操作者は本人）。トークンを含まない", async () => {
      const token = await loginToken();
      await postLogout({ cookie: token });
      const rows = (await authAuditRows()).filter(
        (r) => r.action === "auth.logout",
      );
      expect(rows).toEqual([
        expect.objectContaining({ result: "success", actor_id: userId }),
      ]);
      expect(JSON.stringify(rows)).not.toContain(token);
    });

    it("#120 0-2 AC-2: Cookie なし・偽物・失効済みでも 204 と Cookie の削除（べき等）。DB は変えず、監査も残さない", async () => {
      const revoked = await insertSession(userId, {
        createdAt: new Date().toISOString(),
        revokedAt: new Date(Date.now() - MIN).toISOString(),
      });
      const before = (await sessionRow(revoked.id))?.revoked_at;
      for (const cookie of [null, "bogus-token", revoked.token]) {
        const res = await postLogout({ cookie });
        expect(res.status, String(cookie)).toBe(204);
        expect(sessionCookieOf(res)?.attributes.get("max-age")).toBe("0");
      }
      expect((await sessionRow(revoked.id))?.revoked_at).toBe(before);
      expect(await authAuditRows()).toEqual([]);
    });

    it("#120 0-2 AC-3: 許可していない Origin のログアウトは 403 で、セッションは残る", async () => {
      const token = await loginToken();
      const res = await postLogout({
        cookie: token,
        origin: "https://origin.invalid",
      });
      expect(res.status).toBe(403);
      expect((await sessionRow(await sha256Hex(token)))?.revoked_at).toBeNull();
    });
  },
);

describe(
  "GET /api/auth/session（0-2 AC-3・AC-5）",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it("#120 0-2 AC-1: 有効なセッションでは 200 で利用者を返し、no-store", async () => {
      const token =
        sessionCookieOf(await postLogin(credentials()))?.value ?? "";
      const res = await getSession({ cookie: token });
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await res.json()).toEqual({
        user: {
          id: userId,
          displayName: "テスト太郎",
          loginId: "testuser_001",
        },
        mustChangePassword: false,
        reauthenticatedAt: null,
      });
    });

    it("#120 0-2 AC-3: Cookie なし・偽物は 401（UNAUTHENTICATED）で no-store", async () => {
      for (const cookie of [null, "bogus-token"]) {
        const res = await getSession({ cookie });
        expect(res.status, String(cookie)).toBe(401);
        expect(res.headers.get("Cache-Control")).toBe("no-store");
        expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
      }
    });

    it("#120 0-2 AC-3（security）: GET は業務のデータ（users・audit_logs・login_attempts）を変えない", async () => {
      const token =
        sessionCookieOf(await postLogin(credentials()))?.value ?? "";
      const before = await Promise.all(
        ["users", "audit_logs", "login_attempts"].map(countRows),
      );
      await getSession({ cookie: token });
      await getSession({ cookie: "bogus-token" });
      const after = await Promise.all(
        ["users", "audit_logs", "login_attempts"].map(countRows),
      );
      expect(after).toEqual(before);
    });
  },
);

describe(
  "セッションの期限（0-2 AC-5。読み取り時に判定、Date を固定）",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    const T0 = new Date("2026-11-03T03:00:00.000Z");
    const at = (ms: number) => new Date(T0.getTime() + ms);

    async function sessionAt(
      createdMs: number,
      lastActiveMs: number,
      options: { revokedAt?: string } = {},
    ) {
      return insertSession(userId, {
        createdAt: at(createdMs).toISOString(),
        lastActiveAt: at(lastActiveMs).toISOString(),
        revokedAt: options.revokedAt ?? null,
      });
    }

    function freezeAt(ms: number) {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(at(ms));
    }

    it("#120 0-2 AC-5: 無操作 29分59秒 は使える", async () => {
      const s = await sessionAt(0, 0);
      freezeAt(30 * MIN - 1000);
      expect((await getSession({ cookie: s.token })).status).toBe(200);
    });

    it("#120 0-2 AC-5: 無操作 30分 で使えなくなり（401）、Cookie を消す", async () => {
      const s = await sessionAt(0, 0);
      freezeAt(30 * MIN);
      const res = await getSession({ cookie: s.token });
      expect(res.status).toBe(401);
      const cookie = sessionCookieOf(res);
      expect(cookie?.attributes.get("max-age")).toBe("0");
      expect(cookie?.name).toBe("__Host-session");
      expect(cookie?.attributes.get("path")).toBe("/");
      expect(cookie?.attributes.has("secure")).toBe(true);
      expect(cookie?.attributes.has("domain")).toBe(false);
    });

    it("#120 0-2 AC-5: 操作していても、ログインから24時間で使えなくなる（直前の1秒前は使える）", async () => {
      const s = await sessionAt(0, 24 * 60 * MIN - 2 * MIN);
      freezeAt(24 * 60 * MIN - 1000);
      expect((await getSession({ cookie: s.token })).status).toBe(200);
      vi.setSystemTime(at(24 * 60 * MIN));
      expect((await getSession({ cookie: s.token })).status).toBe(401);
    });

    it("#120 0-2 AC-2: 失効済みのセッションは 401", async () => {
      const s = await sessionAt(0, 0, { revokedAt: at(MIN).toISOString() });
      freezeAt(2 * MIN);
      expect((await getSession({ cookie: s.token })).status).toBe(401);
    });

    it("#120 0-2 AC-7: 無効化された利用者のセッションは 401", async () => {
      const s = await sessionAt(0, 0);
      await env.DB.prepare("UPDATE users SET is_active = 0 WHERE id = ?")
        .bind(userId)
        .run();
      freezeAt(MIN);
      expect((await getSession({ cookie: s.token })).status).toBe(401);
    });

    it("#120 0-2 AC-5（C-149）: 最終操作の時刻の更新は1分に間引く（59秒後は変えず、60秒後は now に更新）", async () => {
      const s = await sessionAt(0, 0);
      freezeAt(59_000);
      await getSession({ cookie: s.token });
      expect((await sessionRow(s.id))?.last_active_at).toBe(T0.toISOString());
      vi.setSystemTime(at(60_000));
      await getSession({ cookie: s.token });
      expect((await sessionRow(s.id))?.last_active_at).toBe(
        at(60_000).toISOString(),
      );
    });

    it("#120 0-2 AC-5: 使うたびに無操作の期限が延びる（20分ごとの操作なら、50分後も使える）", async () => {
      const s = await sessionAt(0, 0);
      freezeAt(20 * MIN);
      expect((await getSession({ cookie: s.token })).status).toBe(200);
      vi.setSystemTime(at(40 * MIN));
      expect((await getSession({ cookie: s.token })).status).toBe(200);
      vi.setSystemTime(at(50 * MIN));
      expect((await getSession({ cookie: s.token })).status).toBe(200);
    });
  },
);
