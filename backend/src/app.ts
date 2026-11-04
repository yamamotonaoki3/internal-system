// Hono のアプリ。ミドルウェア・エラーハンドラ・ルートをここで組み立てる。
// DB につなぐルートなどは、入口（index.ts）が options.routes で渡す。テストは、差し替えたものを渡す。
// /api/* の順序：セキュリティヘッダー → 送信元の確認 → セッションの読み込み → 認証（既定で拒否）→ 初回パスワードのゲート。
import { Hono } from "hono";
import { loadConfig } from "./config";
import { handleError, handleNotFound } from "./lib/error-handler";
import { originCheck, securityHeaders } from "./lib/security";
import {
  loadSession,
  noStoreForProtected,
  requireAuth,
  requirePasswordChanged,
} from "./lib/session-middleware";
import { healthRoutes } from "./routes/health";
import type { WithSessions } from "./services/session.service";

export type AppOptions = {
  /** 追加で組み込むルート（パスと、そのルートの Hono のアプリ） */
  routes?: { path: string; app: Hono<{ Bindings: Env }> }[];
  /**
   * セッションの読み込みの DB 処理。入口（index.ts）が必ず渡す：渡すと /api/* が既定で拒否になる（公開の許可リスト以外はログインが必要）。
   * 渡さないアプリ（ルートの組み立てだけを確かめるテスト）は、認証の確認を行わない。
   */
  sessions?: WithSessions;
};

export function createApp(options: AppOptions = {}) {
  const app = new Hono<{ Bindings: Env }>().use(securityHeaders).use(
    "/api/*",
    originCheck((env) => loadConfig(env).allowedOrigins),
  );
  if (options.sessions !== undefined) {
    app.use(
      "/api/*",
      noStoreForProtected,
      loadSession(options.sessions),
      requireAuth,
      requirePasswordChanged,
    );
  }
  app.route("/api/health", healthRoutes);
  for (const route of options.routes ?? []) app.route(route.path, route.app);
  app.onError(handleError);
  app.notFound(handleNotFound);
  return app;
}
