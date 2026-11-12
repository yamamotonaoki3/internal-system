// Controller：チャンネルの作成申請（/api/channel-requests。#131）。申請・自分の申請・審査一覧・承認・却下・取り下げ。
// 入力の形の確認（422）と応答だけを行い、業務のルール（認可・再認証・状態の確認）は Service が行う。
// 申請の部署は、クライアントから受け取らず、Service が認証済みの利用者の所属から決める。
// 認証と送信元の確認（originCheck）は app.ts が /api/* に一括で適用する。
import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  channelRequestDescriptionSchema,
  channelRequestNameSchema,
  rejectReasonSchema,
} from "../../../shared/channel-name-rules";
import { AppError } from "../lib/app-error";
import { cursorQuerySchema, PAGE_LIMIT } from "../lib/cursor";
import { noStore } from "../lib/security";
import { traceIdOf } from "../lib/trace-id";
import { isUlid } from "../lib/ulid";
import { validate } from "../lib/validation";
import {
  withChannelRequestService,
  type ChannelRequestActor,
} from "../services/channel-request.service";

const createSchema = z
  .object({
    scope: z.enum(["department", "company"]),
    name: channelRequestNameSchema,
    description: channelRequestDescriptionSchema.optional(),
    visibility: z.enum(["public", "private"]),
  })
  .strict();
const rejectSchema = z.object({ reason: rejectReasonSchema }).strict();
const mineQuerySchema = cursorQuerySchema({
  defaultLimit: PAGE_LIMIT.default,
}).strict();
const reviewQuerySchema = cursorQuerySchema({
  defaultLimit: PAGE_LIMIT.default,
})
  .extend({
    status: z.enum(["pending", "approved", "rejected", "withdrawn"]).optional(),
    departmentId: z.string().refine(isUlid).optional(),
  })
  .strict();
const requestParamSchema = z.object({ requestId: z.string().refine(isUlid) });

function actorOf(c: Context<{ Bindings: Env }>): ChannelRequestActor {
  const principal = c.get("principal");
  if (principal === null) {
    throw new AppError("UNAUTHENTICATED", "ログインしてください");
  }
  return {
    userId: principal.userId,
    traceId: traceIdOf(c),
    reauthenticatedAt: principal.reauthenticatedAt,
  };
}

export function channelRequestRoutes() {
  return (
    new Hono<{ Bindings: Env }>()
      .post("/", noStore, validate("json", createSchema), async (c) => {
        const actor = actorOf(c);
        const created = await withChannelRequestService(c.env, (service) =>
          service.create(actor, c.req.valid("json")),
        );
        return c.json(created, 201);
      })
      // /mine は /:requestId より前に定義する
      .get("/mine", noStore, validate("query", mineQuerySchema), async (c) => {
        const actor = actorOf(c);
        const page = await withChannelRequestService(c.env, (service) =>
          service.listMine(actor, c.req.valid("query")),
        );
        return c.json(page);
      })
      .get("/", noStore, validate("query", reviewQuerySchema), async (c) => {
        const actor = actorOf(c);
        const page = await withChannelRequestService(c.env, (service) =>
          service.listForReview(actor, c.req.valid("query")),
        );
        return c.json(page);
      })
      .post(
        "/:requestId/approve",
        noStore,
        validate("param", requestParamSchema),
        async (c) => {
          const actor = actorOf(c);
          const approved = await withChannelRequestService(c.env, (service) =>
            service.approve(actor, c.req.valid("param").requestId),
          );
          return c.json(approved);
        },
      )
      .post(
        "/:requestId/reject",
        noStore,
        validate("param", requestParamSchema),
        validate("json", rejectSchema),
        async (c) => {
          const actor = actorOf(c);
          const rejected = await withChannelRequestService(c.env, (service) =>
            service.reject(
              actor,
              c.req.valid("param").requestId,
              c.req.valid("json").reason,
            ),
          );
          return c.json(rejected);
        },
      )
      .post(
        "/:requestId/withdraw",
        noStore,
        validate("param", requestParamSchema),
        async (c) => {
          const actor = actorOf(c);
          const withdrawn = await withChannelRequestService(c.env, (service) =>
            service.withdraw(actor, c.req.valid("param").requestId),
          );
          return c.json(withdrawn);
        },
      )
  );
}
