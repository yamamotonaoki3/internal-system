// #120 0-2 AC-3：ログインしていない人は、どの API も使えない（/api/* は既定で拒否）。
// 公開の許可リストは6件だけ：GET /api/health・GET /api/setup/status・POST /api/setup・POST /api/auth/login・POST /api/auth/logout・GET /api/auth/session。
// 初回パスワードの利用者（must_change_password）は、ログアウトとセッションの確認以外を 403 PASSWORD_CHANGE_REQUIRED（no-store）で拒否する（#123 が変更APIを足す）。
// 結合のテスト：実際の入口（index.ts の app）を、ローカルの D1 に対して呼ぶ。データは架空のもの（testuser_、[UNIT_TEST]）。
import { SCRYPT_TEST_TIMEOUT_MS } from "../../test/auth-fixtures";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_TRACE_PREFIX,
  SESSION_COOKIE,
  TEST_IP,
  cleanupAuthTestData,
  hmacHex,
  insertSession,
  newThrottleKey,
} from "../../test/auth-fixtures";
import { newPiiKey, newSetupToken } from "../../test/random-secrets";
import {
  cleanupRoleTestData,
  insertDepartment,
  insertUser,
} from "../../test/role-fixtures";
import { loadConfig } from "../config";
import { app } from "../index";

const ALLOWED_ORIGIN = loadConfig(env).allowedOrigins[0] ?? "";
let throttleKey: string;

function envWith() {
  return {
    ...env,
    LOGIN_THROTTLE_KEY: throttleKey,
    SETUP_TOKEN: newSetupToken(),
    PII_ENCRYPTION_KEY: newPiiKey(),
  } as unknown as Env;
}

function call(
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {
    Origin: ALLOWED_ORIGIN,
    "CF-Connecting-IP": TEST_IP,
    "X-Request-Id": `${AUTH_TRACE_PREFIX}${crypto.randomUUID()}`,
  };
  if (options.token !== undefined)
    headers.Cookie = `${SESSION_COOKIE}=${options.token}`;
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

let normalToken: string;
let mustChangeToken: string;

beforeEach(async () => {
  throttleKey = newThrottleKey();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const dept = await insertDepartment("認可テスト部");
  const normal = await insertUser("testuser_001", dept);
  const mustChange = await insertUser("testuser_002", dept);
  await env.DB.prepare("UPDATE users SET must_change_password = 0 WHERE id = ?")
    .bind(normal)
    .run();
  const now = new Date().toISOString();
  normalToken = (await insertSession(normal, { createdAt: now })).token;
  mustChangeToken = (await insertSession(mustChange, { createdAt: now })).token;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupAuthTestData(
    await Promise.all(
      [TEST_IP, "local", "testuser_001", "testuser_999"].map((v) =>
        hmacHex(throttleKey, v),
      ),
    ),
  );
  await cleanupRoleTestData();
});

describe("既定の拒否（0-2 AC-3）", { timeout: SCRYPT_TEST_TIMEOUT_MS }, () => {
  it("#120 0-2 AC-3: 未ログインの保護された API（GET・POST /api/sample-users）は 401 UNAUTHENTICATED で no-store", async () => {
    for (const [method, body] of [
      ["GET", undefined],
      ["POST", { username: "testuser_ac_001" }],
    ] as const) {
      const res = await call(method, "/api/sample-users", { body });
      expect(res.status, method).toBe(401);
      expect(res.headers.get("Cache-Control"), method).toBe("no-store");
      expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    }
  });

  it("#120 0-2 AC-3: 未ログインでは、存在しない API でも 401（既定で拒否。どの API があるかを示さない）", async () => {
    for (const path of [
      "/api/unknown",
      "/api/admin/users",
      "/api/auth/unknown",
    ]) {
      const res = await call("GET", path);
      expect(res.status, path).toBe(401);
    }
  });

  it("#120 0-2 AC-3: ログイン済みなら、存在しない API は 404", async () => {
    const res = await call("GET", "/api/unknown", { token: normalToken });
    expect(res.status).toBe(404);
  });

  it("#120 0-2 AC-3: 偽物のトークンは、未ログインと同じ 401", async () => {
    const res = await call("GET", "/api/sample-users", {
      token: "bogus-token",
    });
    expect(res.status).toBe(401);
  });

  it("#120 0-2 AC-3: 送信元（Origin）の確認は、認証より先に行う（許可外の POST は未ログインでも 403）", async () => {
    const res = await app.request(
      "/api/sample-users",
      {
        method: "POST",
        headers: {
          Origin: "https://origin.invalid",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username: "testuser_ac_001" }),
      },
      envWith(),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
  });
});

describe(
  "#185 符号化された行区切り文字でもAPIのミドルウェアを通る",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    // GHSA-h7mg-cq63-vhpq: wildcardが行区切り文字を含む未知パスにも適用されることを実入口で確かめる。
    const encodedTerminators = ["%0A", "%0D", "%E2%80%A8", "%E2%80%A9"];

    it.each(encodedTerminators)(
      "#185 0-2 AC-3: 未認証GETの未知パス（%s）も401・no-store",
      async (encoded) => {
        const res = await call("GET", `/api/unknown${encoded}tail`);
        expect(res.status).toBe(401);
        expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
        expect(res.headers.get("Cache-Control")).toBe("no-store");
      },
    );

    it.each(encodedTerminators)(
      "#185 0-2 AC-3: 通常sessionの未知パス（%s）は404・no-store",
      async (encoded) => {
        const res = await call("GET", `/api/unknown${encoded}tail`, {
          token: normalToken,
        });
        expect(res.status).toBe(404);
        expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
        expect(res.headers.get("Cache-Control")).toBe("no-store");
      },
    );

    it.each(encodedTerminators)(
      "#185 0-2 AC-3: 未認証POSTの未知パス（%s）でも許可外Originを先に拒否する",
      async (encoded) => {
        const res = await app.request(
          `/api/unknown${encoded}tail`,
          {
            method: "POST",
            headers: { Origin: "https://origin.invalid" },
          },
          envWith(),
        );
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
      },
    );

    it.each(encodedTerminators)(
      "#185 0-3 AC-5: 初回変更必須sessionの未知パス（%s）も403・no-store",
      async (encoded) => {
        const res = await call("GET", `/api/unknown${encoded}tail`, {
          token: mustChangeToken,
        });
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({
          code: "PASSWORD_CHANGE_REQUIRED",
        });
        expect(res.headers.get("Cache-Control")).toBe("no-store");
      },
    );
  },
);

describe(
  "公開の許可リスト（6件。0-2 AC-3）",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it("#120 0-2 AC-3: GET /api/health は、未ログインでも 401 にならない", async () => {
      expect((await call("GET", "/api/health")).status).not.toBe(401);
    });

    it("#120 0-2 AC-3: GET /api/setup/status は、未ログインでも 200", async () => {
      expect((await call("GET", "/api/setup/status")).status).toBe(200);
    });

    it("#120 0-2 AC-3: POST /api/setup は、未ログインでも 401 にならない（初回専用の認証で 403）", async () => {
      const res = await call("POST", "/api/setup", {
        body: { setupToken: "x" },
      });
      expect(res.status).toBe(403);
    });

    it("#120 0-2 AC-3: POST /api/auth/login は、未ログインでも呼べる（失敗は UNAUTHENTICATED ではなく INVALID_CREDENTIALS）", async () => {
      const res = await call("POST", "/api/auth/login", {
        body: { loginId: "testuser_999", password: "WrongPass123!" },
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: "INVALID_CREDENTIALS" });
    });

    it("#120 0-2 AC-3: POST /api/auth/logout は、未ログインでも 204", async () => {
      expect((await call("POST", "/api/auth/logout")).status).toBe(204);
    });

    it("#120 0-2 AC-3: GET /api/auth/session は、未ログインではハンドラが 401 を返す", async () => {
      const res = await call("GET", "/api/auth/session");
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    });

    it("#120 0-2 AC-3: 許可リストは方法（メソッド）も限る（GET /api/auth/login・GET /api/setup は未ログインで 401）", async () => {
      expect((await call("GET", "/api/auth/login")).status).toBe(401);
      expect((await call("GET", "/api/setup")).status).toBe(401);
      expect((await call("DELETE", "/api/auth/session")).status).toBe(401);
    });
  },
);

describe(
  "no-store（コードレビュー1回目の指摘2。C-58）",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it("#120 0-2 AC-3: 認証済みの保護された API の成功応答（200）にも Cache-Control: no-store を付ける", async () => {
      const res = await call("GET", "/api/sample-users", {
        token: normalToken,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    });

    it("#120 0-2 AC-3: 認証済みの存在しない API（404）にも no-store を付ける", async () => {
      const res = await call("GET", "/api/unknown", { token: normalToken });
      expect(res.status).toBe(404);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    });

    it("#120 0-2 AC-3: 公開の GET /api/setup/status は、従来どおり no-store", async () => {
      const res = await call("GET", "/api/setup/status");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    });
  },
);

describe(
  "初回パスワードのゲートの許可リスト（コードレビュー1回目の指摘4）",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it("#120: 初回パスワードの利用者は、公開の許可リストの API でも、ログアウトとセッションの確認以外は 403 PASSWORD_CHANGE_REQUIRED（no-store）", async () => {
      const cases: [string, string, unknown][] = [
        ["POST", "/api/auth/login", { loginId: "testuser_002", password: "x" }],
        ["POST", "/api/setup", { setupToken: "x" }],
        ["GET", "/api/setup/status", undefined],
        ["GET", "/api/health", undefined],
        ["GET", "/api/sample-users", undefined],
        ["POST", "/api/sample-users", { username: "testuser_ac_001" }],
        ["GET", "/api/unknown", undefined],
      ];
      for (const [method, path, body] of cases) {
        const res = await call(method, path, { token: mustChangeToken, body });
        const name = `${method} ${path}`;
        expect(res.status, name).toBe(403);
        expect(res.headers.get("Cache-Control"), name).toBe("no-store");
        expect(await res.json(), name).toMatchObject({
          code: "PASSWORD_CHANGE_REQUIRED",
        });
      }
    });

    it("#120: ゲートの許可リスト（ログアウト・セッションの確認）は、公開の許可リストとは別（未ログインでは公開の6件が従来どおり通る）", async () => {
      expect((await call("GET", "/api/health")).status).not.toBe(403);
      expect((await call("GET", "/api/setup/status")).status).toBe(200);
      expect(
        (await call("POST", "/api/setup", { body: { setupToken: "x" } }))
          .status,
      ).toBe(403);
      expect(
        await (
          await call("POST", "/api/setup", { body: { setupToken: "x" } })
        ).json(),
      ).toMatchObject({ code: "FORBIDDEN" });
      const login = await call("POST", "/api/auth/login", {
        body: { loginId: "testuser_999", password: "WrongPass123!" },
      });
      expect(await login.json()).toMatchObject({ code: "INVALID_CREDENTIALS" });
      expect((await call("POST", "/api/auth/logout")).status).toBe(204);
      expect((await call("GET", "/api/auth/session")).status).toBe(401);
    });
  },
);

describe(
  "初回パスワードのゲート（改訂版。0-3 の本体は #123）",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it("#120: 初回パスワードの利用者は、保護された API を 403 PASSWORD_CHANGE_REQUIRED（no-store）で拒否される", async () => {
      const res = await call("GET", "/api/sample-users", {
        token: mustChangeToken,
      });
      expect(res.status).toBe(403);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await res.json()).toMatchObject({
        code: "PASSWORD_CHANGE_REQUIRED",
      });
    });

    it("#120: 初回パスワードの利用者でも、セッションの確認（印付き）とログアウトはできる", async () => {
      const session = await call("GET", "/api/auth/session", {
        token: mustChangeToken,
      });
      expect(session.status).toBe(200);
      expect(await session.json()).toMatchObject({ mustChangePassword: true });
      expect(
        (await call("POST", "/api/auth/logout", { token: mustChangeToken }))
          .status,
      ).toBe(204);
    });

    it("#120: 初回パスワードでない利用者は、保護された API を使える", async () => {
      const res = await call("GET", "/api/sample-users", {
        token: normalToken,
      });
      expect(res.status).toBe(200);
    });
  },
);

describe(
  "X-Request-Id（監査の trace_id）",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it("#120（改訂版）: 長すぎる X-Request-Id はそのまま監査に入れない（長さの上限）", async () => {
      const long = `${AUTH_TRACE_PREFIX}${"x".repeat(1000)}`;
      await app.request(
        "/api/auth/login",
        {
          method: "POST",
          headers: {
            Origin: ALLOWED_ORIGIN,
            "CF-Connecting-IP": TEST_IP,
            "X-Request-Id": long,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            loginId: "testuser_999",
            password: "WrongPass123!",
          }),
        },
        envWith(),
      );
      const { results } = await env.DB.prepare(
        "SELECT trace_id FROM audit_logs WHERE action = 'auth.login' AND trace_id = ?",
      )
        .bind(long)
        .all();
      expect(results).toEqual([]);
      // 上限の値は計画に書かれていないため、ここでは「1000文字超をそのまま残さない」ことだけを確かめる。
      // 置き換えた trace_id の監査は消す（接頭辞では消えないため）
      await env.DB.prepare(
        "DELETE FROM audit_logs WHERE action = 'auth.login' AND actor_id IS NULL AND trace_id NOT LIKE ?",
      )
        .bind(`${AUTH_TRACE_PREFIX}%`)
        .run();
    });
  },
);
