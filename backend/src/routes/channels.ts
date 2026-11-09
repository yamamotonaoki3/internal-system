// Controller（ルート）：チャンネルの一覧・詳細・参加（/api/channels）。
// 入力の形の確認（422）と応答だけを行い、見てよいか・参加してよいかの判定は Service が行う。
// 認証と送信元の確認（originCheck）は app.ts が /api/* に一括で適用する（参加は POST のため、許可されていない Origin は 403）。
import { Hono, type Context } from "hono";
import { z } from "zod";
import { AppError } from "../lib/app-error";
import { cursorQuerySchema, PAGE_LIMIT } from "../lib/cursor";
import { traceIdOf } from "../lib/trace-id";
import { isUlid } from "../lib/ulid";
import { validate } from "../lib/validation";
import {
  withChannelService,
  type ChannelActor,
} from "../services/channel.service";

const idParamSchema = z.object({
  channelId: z.string().refine(isUlid),
});

const listSchema = cursorQuerySchema({ defaultLimit: PAGE_LIMIT.default })
  .extend({
    departmentId: z.string().refine(isUlid).optional(),
    joined: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
  })
  .strict();

function actorOf(c: Context<{ Bindings: Env }>): ChannelActor {
  const principal = c.get("principal");
  if (principal === null) {
    throw new AppError("UNAUTHENTICATED", "ログインしてください");
  }
  return { userId: principal.userId, traceId: traceIdOf(c) };
}

export function channelRoutes() {
  return new Hono<{ Bindings: Env }>()
    .get("/", validate("query", listSchema), async (c) => {
      const actor = actorOf(c);
      const query = c.req.valid("query");
      const page = await withChannelService(c.env, (service) =>
        service.list(actor, {
          limit: query.limit,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.departmentId === undefined
            ? {}
            : { departmentId: query.departmentId }),
          ...(query.joined === undefined ? {} : { joined: query.joined }),
        }),
      );
      return c.json(page);
    })
    .get("/:channelId", validate("param", idParamSchema), async (c) => {
      const actor = actorOf(c);
      const channel = await withChannelService(c.env, (service) =>
        service.get(actor, c.req.valid("param").channelId),
      );
      return c.json(channel);
    })
    .post("/:channelId/join", validate("param", idParamSchema), async (c) => {
      const actor = actorOf(c);
      const joined = await withChannelService(c.env, (service) =>
        service.join(actor, c.req.valid("param").channelId),
      );
      return c.json(joined);
    });
}
