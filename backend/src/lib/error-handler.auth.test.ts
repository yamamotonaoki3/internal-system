// #120 AC-3・0-2 AC-7：認証のエラー応答（INVALID_CREDENTIALS 401・PASSWORD_CHANGE_REQUIRED 403・RATE_LIMITED の Retry-After）。
// RATE_LIMITED の details.retryAfterSeconds は Retry-After ヘッダーにだけ出し、本文には出さない（残り時間・どの制限かを示さない）。
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "./app-error";
import { handleError } from "./error-handler";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const appThrowing = (error: Error) =>
  new Hono()
    .get("/x", () => {
      throw error;
    })
    .onError(handleError);

describe("認証のエラー応答", () => {
  it("#120 AC-3: RATE_LIMITED は 429 で、Retry-After ヘッダーに秒数を入れ、本文には出さない", async () => {
    const res = await appThrowing(
      new AppError("RATE_LIMITED", "しばらくしてから、もう一度お試しください", {
        retryAfterSeconds: 900,
      }),
    ).request("/x");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("900");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("RATE_LIMITED");
    expect(body).not.toHaveProperty("retryAfterSeconds");
    expect(JSON.stringify(body)).not.toContain("900");
  });

  it("#120 AC-3: retryAfterSeconds がない RATE_LIMITED は、Retry-After を付けない", async () => {
    const res = await appThrowing(
      new AppError("RATE_LIMITED", "しばらくしてから、もう一度お試しください"),
    ).request("/x");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeNull();
  });

  it("#120 0-2 AC-7: INVALID_CREDENTIALS は 401", async () => {
    const res = await appThrowing(
      new AppError("INVALID_CREDENTIALS", "社員IDまたはパスワードが違います"),
    ).request("/x");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("#120 0-2 AC-3: PASSWORD_CHANGE_REQUIRED は 403", async () => {
    const res = await appThrowing(
      new AppError("PASSWORD_CHANGE_REQUIRED", "パスワードの変更が必要です"),
    ).request("/x");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      code: "PASSWORD_CHANGE_REQUIRED",
    });
  });
});
