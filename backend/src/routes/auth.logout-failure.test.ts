// #120 0-2 AC-2（改訂版：ログアウトの原子性）：失効の DB 処理が失敗したら、成功扱いにせず 500 を返し、Cookie を消さない。
// DB の処理（withAuth）を、例外を投げる代役に差し替えて確かめる（routes は db/ を直接読まない）。
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, newSessionToken } from "../../test/auth-fixtures";
import { handleError } from "../lib/error-handler";
import type { AuthRepository } from "../services/auth.service";
import { authRoutes } from "./auth";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const failing = {
  revokeSession: async () => {
    throw new Error("D1 failed [UNIT_TEST]");
  },
} as unknown as AuthRepository;

const withFailingAuth = <T>(
  _env: Env,
  run: (repository: AuthRepository) => Promise<T>,
) => run(failing);

const app = new Hono<{ Bindings: Env }>()
  .route("/api/auth", authRoutes(withFailingAuth))
  .onError(handleError);

describe("POST /api/auth/logout（DB の失敗）", () => {
  it("#120 0-2 AC-2: 失効の DB 処理が失敗したら 500 で、Cookie を消さない（失敗を隠さない）", async () => {
    const res = await app.request(
      "/api/auth/logout",
      {
        method: "POST",
        headers: { Cookie: `${SESSION_COOKIE}=${newSessionToken()}` },
      },
      { APP_ENV: "test", ALLOWED_ORIGINS: "" } as unknown as Env,
    );
    expect(res.status).toBe(500);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });
});
