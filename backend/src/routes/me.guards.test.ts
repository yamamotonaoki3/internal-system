// #130 EP-0-03・EP-0-12・#123 0-3 AC-1：/api/me のルート（routes/me.ts）が、認証の middleware を通らずに呼ばれた場合も
// 利用者なし（principal が null）を 401 にし、Cookie のないパスワード変更を 401、試行制限の鍵がない設定を 503 にすることを確かめる。
// 通常は共通の middleware が先に 401 を返すため、ここではルートだけを Hono に載せ、principal を直接入れて確かめる（多重の防御）。
// データは架空（testuser_me_guard・テスト太郎）。DB には触れない（Service・Repository に届く前に止まることを確かめる）。
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "../../test/auth-fixtures";
import { handleError } from "../lib/error-handler";
import type { WithCredentials } from "../services/credentials.service";
import { meRoutes } from "./me";

const PRINCIPAL = {
  userId: "01JTESTMEGUARDUSER00000001",
  loginId: "testuser_me_guard",
  displayName: "テスト太郎",
  mustChangePassword: false,
  reauthenticatedAt: null,
};

function appWith(principal: typeof PRINCIPAL | null) {
  const withCredentials = vi.fn() as unknown as WithCredentials;
  const app = new Hono<{ Bindings: Env }>()
    .use(async (c, next) => {
      c.set("principal", principal as never);
      await next();
    })
    .route("/api/me", meRoutes(withCredentials))
    .onError(handleError);
  return { app, withCredentials };
}

const json = (body: unknown, cookie?: string) => ({
  method: "PUT",
  headers: {
    "Content-Type": "application/json",
    ...(cookie === undefined ? {} : { Cookie: `${SESSION_COOKIE}=${cookie}` }),
  },
  body: JSON.stringify(body),
});

const passwordBody = {
  currentPassword: "TestPass123!",
  newPassword: "Different456!",
};

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("#130 /api/me の利用者なしの扱い", () => {
  it("#130 EP-0-03: principal が null なら GET /profile は 401 UNAUTHENTICATED", async () => {
    const { app } = appWith(null);
    const res = await app.request("/api/me/profile", {}, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("#130 EP-0-12: principal が null なら PATCH /profile は 401 UNAUTHENTICATED", async () => {
    const { app } = appWith(null);
    const res = await app.request(
      "/api/me/profile",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "テスト改名" }),
      },
      env,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("#123 0-3 AC-1: principal が null なら、Cookie があってもパスワード変更は 401 で、変更の処理を呼ばない", async () => {
    const { app, withCredentials } = appWith(null);
    const res = await app.request(
      "/api/me/password",
      json(passwordBody, "unit-token"),
      env,
    );
    expect(res.status).toBe(401);
    expect(withCredentials).not.toHaveBeenCalled();
  });

  it("#123 0-3 AC-1: Cookie がなければ、利用者がいてもパスワード変更は 401 で、変更の処理を呼ばない", async () => {
    const { app, withCredentials } = appWith(PRINCIPAL);
    const res = await app.request("/api/me/password", json(passwordBody), env);
    expect(res.status).toBe(401);
    expect(withCredentials).not.toHaveBeenCalled();
  });

  it("#123 0-3 AC-1: 試行制限の鍵（LOGIN_THROTTLE_KEY）がない設定では、パスワード変更は 503 SERVICE_UNAVAILABLE で、変更の処理を呼ばない", async () => {
    const { app, withCredentials } = appWith(PRINCIPAL);
    const res = await app.request(
      "/api/me/password",
      json(passwordBody, "unit-token"),
      { ...env, LOGIN_THROTTLE_KEY: "" } as unknown as Env,
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(withCredentials).not.toHaveBeenCalled();
  });
});
