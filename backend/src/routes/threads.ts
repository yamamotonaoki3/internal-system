// Controller（ルート）：自分のスレッドの一覧（GET /api/me/threads。EP-3-08。#137）。
// 入力の形の確認（422）と応答だけを行う。利用者は常にセッションの本人で、他人の ID を受け取らない。
// 認証と送信元の確認（originCheck）は app.ts が /api/* に一括で適用する。GET は状態を変えない。
import { Hono } from "hono";
import { actorOf } from "../lib/actor";
import { cursorQuerySchema, PAGE_LIMIT } from "../lib/cursor";
import { noStore } from "../lib/security";
import { validate } from "../lib/validation";
import { withThreadService } from "../services/thread.service";

// 余分なクエリ（userId など）は受け付けない（他人のスレッドを指定できるように見せない）
const listQuerySchema = cursorQuerySchema({
  defaultLimit: PAGE_LIMIT.default,
}).strict();

export function threadRoutes() {
  return new Hono<{ Bindings: Env }>().get(
    "/",
    noStore,
    validate("query", listQuerySchema),
    async (c) => {
      const actor = actorOf(c);
      const { limit, cursor } = c.req.valid("query");
      const page = await withThreadService(c.env, actor, (service) =>
        service.list(
          actor,
          cursor === undefined ? { limit } : { limit, cursor },
        ),
      );
      return c.json(page);
    },
  );
}
