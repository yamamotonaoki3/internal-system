// 認証済みの操作者（利用者IDと追跡ID）を、リクエストから取り出す。認証は共通middlewareが行う。ここは未認証の念のための拒否。
import type { Context } from "hono";
import { AppError } from "./app-error";
import { traceIdOf } from "./trace-id";

export function actorOf(c: Context<{ Bindings: Env }>) {
  const principal = c.get("principal");
  if (principal === null) {
    throw new AppError("UNAUTHENTICATED", "ログインしてください");
  }
  return { userId: principal.userId, traceId: traceIdOf(c) };
}
