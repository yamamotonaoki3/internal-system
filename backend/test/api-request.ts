// #201 の結合テストで使う、実際のアプリ入口（index.ts の app）への要求と、ログイン済みのセッション・利用者の準備。
// データは架空（testuser_、@example.com）。接続先は vitest-pool-workers の一時 D1 だけ。
import { env } from "cloudflare:workers";
import {
  AUTH_TRACE_PREFIX,
  SESSION_COOKIE,
  TEST_IP,
  insertSession,
  newThrottleKey,
} from "./auth-fixtures";
import { newPiiKey, newSetupToken } from "./random-secrets";
import { insertUser } from "./role-fixtures";
import { loadConfig } from "../src/config";
import { app } from "../src/index";

export const API_ORIGIN = loadConfig(env).allowedOrigins[0] ?? "";
const throttleKey = newThrottleKey();

export async function apiRequest(
  method: string,
  path: string,
  options: { token?: string | null; origin?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {
    Origin: options.origin ?? API_ORIGIN,
    "CF-Connecting-IP": TEST_IP,
    "X-Request-Id": `${AUTH_TRACE_PREFIX}${crypto.randomUUID()}`,
  };
  if (options.token) headers.Cookie = `${SESSION_COOKIE}=${options.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(
    path,
    {
      method,
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    },
    {
      ...env,
      LOGIN_THROTTLE_KEY: throttleKey,
      SETUP_TOKEN: newSetupToken(),
      PII_ENCRYPTION_KEY: newPiiKey(),
    } as unknown as Env,
  );
}

/** パスワード変更の必要がない、有効な利用者を作り、有効なセッションのトークンを返す */
export async function insertReadyUser(loginId: string, departmentId: string) {
  const userId = await insertUser(loginId, departmentId);
  await env.DB.prepare("UPDATE users SET must_change_password = 0 WHERE id = ?")
    .bind(userId)
    .run();
  const session = await insertSession(userId, {
    createdAt: new Date().toISOString(),
  });
  return { userId, token: session.token };
}
