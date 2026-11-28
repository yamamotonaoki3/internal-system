// セッションのミドルウェア（0-2 AC-3）。/api/* を既定で拒否する：
// 送信元の確認（originCheck）→ loadSession（Cookie からログイン中の利用者を求める）→ requireAuth（公開の許可リスト以外は未ログインを 401）
// → requirePasswordChanged（初回パスワードのままの利用者は、許可リスト以外を 403）。
// 許可リストは「メソッドとパスの完全一致」の6件だけ。新しい公開 API は、ここに足す（足すときは理由をレビューで確かめる）。
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import {
  resolveSession,
  type SessionPrincipal,
  type WithSessions,
} from "../services/session.service";
import { EXPECTED_USER_ID_HEADER } from "../../../shared/session-user-header";
import { AppError } from "./app-error";
import { createLogger } from "./logger/logger";
import { SESSION_COOKIE } from "./session-policy";

// c.get("principal") / c.set("principal", ...) を、どの Hono のアプリでも型つきで使えるようにする（Hono の ContextVariableMap）
declare module "hono" {
  interface ContextVariableMap {
    /** ログイン中の利用者。未ログイン・使えないセッションは null */
    principal: SessionPrincipal | null;
  }
}

const PUBLIC_ENDPOINTS: ReadonlySet<string> = new Set([
  "GET /api/health",
  "GET /api/setup/status",
  "POST /api/setup",
  "POST /api/auth/login",
  "POST /api/auth/logout",
  "GET /api/auth/session",
]);

// 初回パスワードのままの利用者が使える API は、以下の許可リストに限る（ログイン・セットアップ・ヘルス確認も 403）
const PASSWORD_CHANGE_ALLOWLIST: ReadonlySet<string> = new Set([
  "POST /api/auth/logout",
  "GET /api/auth/session",
  "PUT /api/me/password",
]);

const isPublic = (method: string, path: string) =>
  PUBLIC_ENDPOINTS.has(`${method} ${path}`);

/**
 * Cookie のセッションから、ログイン中の利用者を c.var.principal に入れる（いなければ null）。Cookie があるのに使えないときも、ここでは Cookie を消さない。
 * 消す応答が、後からログインした別のセッションの Cookie を消しうるため（#383）。Cookie の削除は、失効を確定した後のログアウトのルートだけが行う。
 * 画面の想定する利用者（X-Expected-User-Id）があり、有効なセッションの利用者と食い違うときは、公開の経路も含めて 409 で断る（#298）。
 * ヘッダーは断る向きにだけ使い、認可・利用者の特定には使わない。値はログにも応答にも出さない。
 */
export function loadSession(
  withSessions: WithSessions,
): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token === undefined || token === "") {
      c.set("principal", null);
      return next();
    }
    const logger = createLogger({ traceId: c.req.header("X-Request-Id") });
    const principal = await withSessions(c.env, (repository) =>
      resolveSession(
        repository,
        token,
        { now: () => new Date(), logger },
        c.req.header(EXPECTED_USER_ID_HEADER),
      ),
    );
    if (principal !== null && "mismatch" in principal) {
      // Cookie を消さない・セッションを失効させない（別の利用者のセッションは有効なまま）。ログアウトの経路でも、ルートの前に断る
      c.header("Cache-Control", "no-store");
      throw new AppError(
        "SESSION_USER_MISMATCH",
        "別の利用者でログインし直されています。ページを読み込み直してください",
      );
    }
    c.set("principal", principal);
    return next();
  };
}

/** 公開の許可リスト以外（認証が必要な API）の応答は、成功・失敗とも no-store を含める（C-58）。公開のルートは、各ルートが必要に応じて付ける */
export const noStoreForProtected: MiddlewareHandler<{ Bindings: Env }> = async (
  c,
  next,
) => {
  await next();
  // 応答が自分で no-store を含む値（添付の配信の private, no-store。#140）を付けた場合は、それを残す
  if (
    !isPublic(c.req.method, c.req.path) &&
    !(c.res.headers.get("Cache-Control") ?? "").includes("no-store")
  )
    c.header("Cache-Control", "no-store");
};

/** 公開の許可リスト以外は、ログインを必要とする（存在しない API も 401 にして、どの API があるかを示さない） */
export const requireAuth: MiddlewareHandler<{ Bindings: Env }> = async (
  c,
  next,
) => {
  if (c.get("principal") === null && !isPublic(c.req.method, c.req.path)) {
    c.header("Cache-Control", "no-store");
    throw new AppError("UNAUTHENTICATED", "ログインしてください");
  }
  return next();
};

/** 初回パスワードのままの利用者は、許可リスト（ログアウト・セッションの確認など）以外を使えない（変更の本体は #123） */
export const requirePasswordChanged: MiddlewareHandler<{
  Bindings: Env;
}> = async (c, next) => {
  if (
    c.get("principal")?.mustChangePassword === true &&
    !PASSWORD_CHANGE_ALLOWLIST.has(`${c.req.method} ${c.req.path}`)
  ) {
    c.header("Cache-Control", "no-store");
    throw new AppError(
      "PASSWORD_CHANGE_REQUIRED",
      "パスワードの変更が必要です",
    );
  }
  return next();
};
