// #123専用。実アカウントを使わず、既存の隔離D1と識別子付き後始末を使う。
import { env } from "cloudflare:workers";
import { loadConfig } from "../src/config";
import { app } from "../src/index";
import {
  AUTH_TRACE_PREFIX,
  SESSION_COOKIE,
  TEST_IP,
  TEST_PASSWORD_HASH,
  cleanupAuthTestData,
  hmacHex,
  insertSession,
  newThrottleKey,
  setUserPassword,
} from "./auth-fixtures";
import {
  cleanupRoleTestData,
  insertDepartment,
  insertUser,
} from "./role-fixtures";

export const CREDENTIAL_LOGIN = "testuser_credential_001";
export const NEW_PASSWORD = "Different456!";
export const FIXED_NOW = new Date("2026-11-06T00:00:00.000Z");

export async function credentialFixture(mustChangePassword = false) {
  const throttleKey = newThrottleKey();
  const userId = await insertUser(
    CREDENTIAL_LOGIN,
    await insertDepartment("認証変更"),
  );
  await setUserPassword(userId, TEST_PASSWORD_HASH, { mustChangePassword });
  const current = await insertSession(userId, {
    createdAt: FIXED_NOW.toISOString(),
  });
  const other = await insertSession(userId, {
    createdAt: FIXED_NOW.toISOString(),
  });
  const bindings = { ...env, LOGIN_THROTTLE_KEY: throttleKey };
  const accountKey = await hmacHex(throttleKey, CREDENTIAL_LOGIN);
  const sourceKey = await hmacHex(throttleKey, TEST_IP);
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    options: {
      token?: string | null;
      origin?: string | null;
      bindings?: Env;
    } = {},
  ) => {
    const headers = new Headers({
      "X-Request-Id": `${AUTH_TRACE_PREFIX}${crypto.randomUUID()}`,
      "CF-Connecting-IP": TEST_IP,
    });
    const token = options.token === undefined ? current.token : options.token;
    if (token !== null) headers.set("Cookie", `${SESSION_COOKIE}=${token}`);
    if (method !== "GET") {
      const origin =
        options.origin === undefined
          ? loadConfig(env).allowedOrigins[0]
          : options.origin;
      if (origin != null) headers.set("Origin", origin);
      headers.set("Content-Type", "application/json");
    }
    return app.request(
      path,
      {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      options.bindings ?? bindings,
    );
  };
  const cleanup = async () => {
    await cleanupAuthTestData([accountKey, sourceKey]);
    await cleanupRoleTestData();
  };
  return {
    userId,
    current,
    other,
    accountKey,
    sourceKey,
    bindings,
    request,
    cleanup,
  };
}

export type CredentialFixture = Awaited<ReturnType<typeof credentialFixture>>;

export async function seedCredentialFailures(
  fixture: CredentialFixture,
  count = 3,
  at = FIXED_NOW,
) {
  await env.DB.prepare(
    "INSERT INTO login_attempts (bucket_type, bucket_key, failed_count, last_failed_at, updated_at) VALUES ('account', ?, ?, ?, ?)",
  )
    .bind(fixture.accountKey, count, at.toISOString(), at.toISOString())
    .run();
}

export async function credentialSnapshot(fixture: CredentialFixture) {
  const user = await env.DB.prepare(
    "SELECT password_hash, must_change_password FROM users WHERE id = ?",
  )
    .bind(fixture.userId)
    .first();
  const sessions = await env.DB.prepare(
    "SELECT id, reauthenticated_at, revoked_at FROM sessions WHERE user_id = ? ORDER BY id",
  )
    .bind(fixture.userId)
    .all();
  const account = await env.DB.prepare(
    "SELECT * FROM login_attempts WHERE bucket_type = 'account' AND bucket_key = ?",
  )
    .bind(fixture.accountKey)
    .first();
  const audits = await env.DB.prepare(
    "SELECT action, result FROM audit_logs WHERE actor_id = ? ORDER BY id",
  )
    .bind(fixture.userId)
    .all();
  return { user, sessions: sessions.results, account, audits: audits.results };
}
