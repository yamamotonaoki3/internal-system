// Controller（ルート）：自分の部屋ごとの未読数（GET /api/me/unread。EP-3-01。#237）。
// 入力の形の確認（422）と応答だけを行う。利用者は常にセッションの本人で、他人の ID を受け取らない。
// 認証と送信元の確認（originCheck）は app.ts が /api/* に一括で適用する。GET は状態を変えない。
import { Hono } from "hono";
import { actorOf } from "../lib/actor";
import { cursorQuerySchema, PAGE_LIMIT } from "../lib/cursor";
import { noStore } from "../lib/security";
import { validate } from "../lib/validation";
import { withUnreadService } from "../services/unread.service";

// 余分なクエリ（roomId・userId など）は受け付けない（他人の未読を指定できるように見せない）
const listQuerySchema = cursorQuerySchema({
  defaultLimit: PAGE_LIMIT.default,
}).strict();

export function unreadRoutes() {
  return new Hono<{ Bindings: Env }>().get(
    "/",
    noStore,
    validate("query", listQuerySchema),
    async (c) => {
      const actor = actorOf(c);
      const { limit, cursor } = c.req.valid("query");
      const page = await withUnreadService(c.env, actor, (service) =>
        service.list(
          actor,
          cursor === undefined ? { limit } : { limit, cursor },
        ),
      );
      return c.json(page);
    },
  );
}
