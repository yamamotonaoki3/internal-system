// #120 AC-3（ADR-0013・C-158 の申し送り）：初回セットアップ（POST /api/setup）にも、接続元単位の試行制限（bucket_type=setup_source）をかける。
// 窓15分・受付30回・超えたら15分ロック（D-1 と同じ値）。失敗は logger.audit にだけ残す。LOGIN_THROTTLE_KEY が無ければ 503。
// SETUP_TOKEN・PII_ENCRYPTION_KEY・LOGIN_THROTTLE_KEY は、テストの中で乱数から作る。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_TRACE_PREFIX,
  TEST_IP,
  cleanupAuthTestData,
  hmacHex,
  loginAttemptRow,
  newThrottleKey,
} from "../../test/auth-fixtures";
import { newPiiKey, newSetupToken } from "../../test/random-secrets";
import { countRows } from "../../test/role-fixtures";
import { loadConfig } from "../config";
import { app } from "../index";

const ALLOWED_ORIGIN = loadConfig(env).allowedOrigins[0] ?? "";
let throttleKey: string;
let setupToken: string;

function envWith(overrides: Record<string, unknown> = {}) {
  return {
    ...env,
    SETUP_TOKEN: setupToken,
    PII_ENCRYPTION_KEY: newPiiKey(),
    LOGIN_THROTTLE_KEY: throttleKey,
    ...overrides,
  } as unknown as Env;
}

const postSetup = (body: unknown, options: { env?: Env; ip?: string } = {}) =>
  app.request(
    "/api/setup",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: ALLOWED_ORIGIN,
        "CF-Connecting-IP": options.ip ?? TEST_IP,
        "X-Request-Id": `${AUTH_TRACE_PREFIX}${crypto.randomUUID()}`,
      },
      body: JSON.stringify(body),
    },
    options.env ?? envWith(),
  );

beforeEach(() => {
  throttleKey = newThrottleKey();
  setupToken = newSetupToken();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupAuthTestData(
    await Promise.all(
      [TEST_IP, "192.0.2.20", "local"].map((v) => hmacHex(throttleKey, v)),
    ),
  );
});

describe("POST /api/setup の試行制限（setup_source）", () => {
  it("#120 AC-3: 誤ったトークンを30回まで送ると 403、31回目は（正しいトークンでも）429 と Retry-After", async () => {
    for (let i = 0; i < 30; i += 1) {
      const res = await postSetup({ setupToken: newSetupToken() });
      expect(res.status, `${i + 1}回目`).toBe(403);
    }
    const res = await postSetup({ setupToken });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ code: "RATE_LIMITED" });
  });

  it("#120 AC-3: 受付は setup_source の行（HMAC のキー）に数え、ログインの source とは別", async () => {
    await postSetup({ setupToken: newSetupToken() });
    const key = await hmacHex(throttleKey, TEST_IP);
    expect((await loginAttemptRow("setup_source", key))?.attempt_count).toBe(1);
    expect(await loginAttemptRow("source", key)).toBeNull();
  });

  it("#120 AC-3: 別の接続元は、ロックの影響を受けない", async () => {
    for (let i = 0; i < 31; i += 1)
      await postSetup({ setupToken: newSetupToken() });
    const res = await postSetup(
      { setupToken: newSetupToken() },
      { ip: "192.0.2.20" },
    );
    expect(res.status).toBe(403);
  });

  it("#120 AC-3（ADR-0013）: setup のトークンの失敗は D1 の監査ログに残さない。残るのは、ロックに入った1回の setup.rate_limited だけ", async () => {
    const before = await countRows("audit_logs");
    for (let i = 0; i < 33; i += 1)
      await postSetup({ setupToken: newSetupToken() });
    const { results } = await env.DB.prepare(
      "SELECT action FROM audit_logs WHERE trace_id LIKE ?",
    )
      .bind(`${AUTH_TRACE_PREFIX}%`)
      .all<{ action: string }>();
    expect(results.map((r) => r.action)).toEqual(["setup.rate_limited"]);
    expect(await countRows("audit_logs")).toBe(before + 1);
  });

  it("#120 AC-3: LOGIN_THROTTLE_KEY が未設定なら、POST /api/setup は 503", async () => {
    const res = await postSetup(
      { setupToken },
      { env: envWith({ LOGIN_THROTTLE_KEY: undefined }) },
    );
    expect(res.status).toBe(503);
  });

  it("#120 AC-3: GET /api/setup/status は、試行制限の対象にしない（数えない）", async () => {
    for (let i = 0; i < 3; i += 1)
      await app.request("/api/setup/status", {}, envWith());
    expect(
      await loginAttemptRow(
        "setup_source",
        await hmacHex(throttleKey, "local"),
      ),
    ).toBeNull();
    expect(
      await loginAttemptRow(
        "setup_source",
        await hmacHex(throttleKey, TEST_IP),
      ),
    ).toBeNull();
  });
});
