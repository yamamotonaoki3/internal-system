// #200 AC-2: チャンネルのルート（routes/channels.ts）の単体テスト。
// 結合テスト（channels.test.ts）では届かない「principal が null のときの防御」を確かめる（通常は入口の認証が先に 401 にする）。
// 防御が働けば、DB に触れる前に 401 になる（env も渡さない）。
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleError } from "../lib/error-handler";
import { channelRoutes } from "./channels";

const CHANNEL = "01JTE5TCHAN00000000000XX01";

function appWithoutPrincipal() {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", async (c, next) => {
    c.set("principal", null);
    await next();
  });
  app.route("/api/channels", channelRoutes());
  app.onError(handleError);
  return app;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("#200 AC-2 ルートの防御（principal が null）", () => {
  it.each([
    ["GET", "/api/channels"],
    ["GET", `/api/channels/${CHANNEL}`],
    ["POST", `/api/channels/${CHANNEL}/join`],
  ])(
    "#200 AC-2（認可）: %s %s は、principal が null のとき 401 UNAUTHENTICATED（決めた文言）を返す",
    async (method, path) => {
      const response = await appWithoutPrincipal().request(path, { method });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        code: "UNAUTHENTICATED",
        message: "ログインしてください",
      });
    },
  );
});
