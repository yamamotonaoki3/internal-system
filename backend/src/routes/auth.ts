// Controller（ルート）：ログイン（POST /login）・ログアウト（POST /logout）・セッションの確認（GET /session）。
// DB の処理は引数で受け取る（routes は db/ を直接読まない）。送信元の確認（POST）とログイン中の利用者の特定は app.ts の /api/* で行う。
// Cookie は __Host-session（HttpOnly・Secure・SameSite=Lax・Path=/・Domain なし）。すべての応答を no-store にする（C-58）。
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { loadConfig } from "../config";
import { AppError } from "../lib/app-error";
import { createLogger } from "../lib/logger/logger";
import { noStore } from "../lib/security";
import { SESSION_COOKIE, SESSION_MAX_AGE_MS } from "../lib/session-policy";
import { sourceBucketKey } from "../lib/source-key";
import { traceIdOf } from "../lib/trace-id";
import { validate } from "../lib/validation";
import {
  createAuthDeps,
  login,
  logout,
  type WithAuth,
} from "../services/auth.service";

// 欄の形と上限だけを確かめる。社員ID・パスワードの規則（文字種など）は、ここでは確かめない
// （規則に合わない入力も、存在しない社員IDと同じ 401 にして、規則を推測させない）
const loginSchema = z.object({
  loginId: z.string().min(1).max(64),
  password: z.string().min(1).max(1024),
});

const COOKIE_ATTRIBUTES = { path: "/", secure: true } as const;

export function authRoutes(withAuth: WithAuth) {
  return new Hono<{ Bindings: Env }>()
    .post("/login", noStore, validate("json", loginSchema), async (c) => {
      const body = c.req.valid("json");
      const config = loadConfig(c.env);
      if (config.loginThrottleKey === null) {
        throw new AppError(
          "SERVICE_UNAVAILABLE",
          "ログインは現在使えません。運用担当者に連絡してください",
        );
      }
      const traceId = traceIdOf(c);
      const logger = createLogger({ traceId });
      const throttleKey = config.loginThrottleKey;
      const sourceKey = await sourceBucketKey(
        c.req.header("CF-Connecting-IP"),
        { appEnv: config.appEnv, throttleKey, logger },
      );
      const result = await withAuth(c.env, (repository) =>
        login(
          repository,
          body,
          {
            sourceKey,
            throttleKey,
            traceId,
            previousSessionToken: getCookie(c, SESSION_COOKIE) ?? null,
          },
          createAuthDeps(logger),
        ),
      );
      setCookie(c, SESSION_COOKIE, result.token, {
        ...COOKIE_ATTRIBUTES,
        httpOnly: true,
        sameSite: "Lax",
        maxAge: SESSION_MAX_AGE_MS / 1000,
      });
      return c.json({
        user: result.user,
        mustChangePassword: result.mustChangePassword,
      });
    })
    .post("/logout", noStore, async (c) => {
      const traceId = traceIdOf(c);
      // 失効が確定してから Cookie を消す。DB の失敗は 500 のまま伝え、Cookie は消さない
      await withAuth(c.env, (repository) =>
        logout(
          repository,
          { sessionToken: getCookie(c, SESSION_COOKIE) ?? null, traceId },
          createAuthDeps(createLogger({ traceId })),
        ),
      );
      deleteCookie(c, SESSION_COOKIE, COOKIE_ATTRIBUTES);
      return c.body(null, 204);
    })
    .get("/session", noStore, (c) => {
      const principal = c.get("principal") ?? null;
      if (principal === null) {
        throw new AppError("UNAUTHENTICATED", "ログインしてください");
      }
      return c.json({
        user: { id: principal.userId, displayName: principal.displayName },
        mustChangePassword: principal.mustChangePassword,
      });
    });
}
