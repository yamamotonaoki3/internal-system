// Controller（ルート）：DM の開始（EP-1-05）・一覧（EP-1-06）・詳細（/api/dms/:roomId。#136）。
// 入力の形の確認（422）と応答だけを行い、認可と業務のルールは Service が行う。相手の ID だけを受け取り、当事者は常にセッションの利用者と相手の2人。
// 認証と送信元の確認（originCheck）は app.ts が /api/* に一括で適用する。
import { Hono } from "hono";
import { z } from "zod";
import { actorOf } from "../lib/actor";
import { cursorQuerySchema, PAGE_LIMIT } from "../lib/cursor";
import { noStore } from "../lib/security";
import { isUlid } from "../lib/ulid";
import { validate } from "../lib/validation";
import { withDmService } from "../services/dm.service";

const idSchema = z.string().refine(isUlid);
const startSchema = z.object({ partnerUserId: idSchema }).strict();
const listQuerySchema = cursorQuerySchema({
  defaultLimit: PAGE_LIMIT.default,
}).strict();
const roomParamSchema = z.object({ roomId: idSchema });

export function dmRoutes() {
  return new Hono<{ Bindings: Env }>()
    .post("/", noStore, validate("json", startSchema), async (c) => {
      const actor = actorOf(c);
      const started = await withDmService(c.env, actor, (service) =>
        service.start(actor, c.req.valid("json").partnerUserId),
      );
      return c.json(started);
    })
    .get("/", noStore, validate("query", listQuerySchema), async (c) => {
      const actor = actorOf(c);
      const { limit, cursor } = c.req.valid("query");
      const page = await withDmService(c.env, actor, (service) =>
        service.list(
          actor,
          cursor === undefined ? { limit } : { limit, cursor },
        ),
      );
      return c.json(page);
    })
    .get("/:roomId", noStore, validate("param", roomParamSchema), async (c) => {
      const actor = actorOf(c);
      const detail = await withDmService(c.env, actor, (service) =>
        service.get(actor, c.req.valid("param").roomId),
      );
      return c.json(detail);
    });
}
