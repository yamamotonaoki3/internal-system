// Controller（ルート）：チャンネルのメッセージの一覧・投稿（/api/rooms/:roomId/messages。#201）。
// 入力の形の確認（422）と応答だけを行い、見てよいか・投稿してよいかの判定は Service が行う。
// 認証と送信元の確認（originCheck）は app.ts が /api/* に一括で適用する。
import { Hono, type Context } from "hono";
import { z } from "zod";
import { AppError } from "../lib/app-error";
import {
  afterIdQuerySchema,
  cursorQuerySchema,
  PAGE_LIMIT,
} from "../lib/cursor";
import { traceIdOf } from "../lib/trace-id";
import { validate } from "../lib/validation";
import {
  withMessageService,
  type MessageActor,
  type MessageListQuery,
} from "../services/message.service";
import { messageBodySchema } from "../../../shared/message-rules";

const roomParamSchema = z.object({ roomId: z.string().min(1).max(64) });

const postSchema = z.object({ body: messageBodySchema }).strict();

const latestQuerySchema = cursorQuerySchema({
  defaultLimit: PAGE_LIMIT.message,
}).strict();
const afterQuerySchema = afterIdQuerySchema.strict();

// after があれば「最後のID以降」（ID昇順）、なければ新しい順。同時指定は受け付けない
const listQuerySchema = z
  .looseObject({})
  .transform((query, ctx): MessageListQuery => {
    if ("after" in query && "cursor" in query) {
      ctx.issues.push({
        code: "custom",
        message: "invalid",
        input: query,
        path: ["cursor"],
      });
      return z.NEVER;
    }
    const parsed = (
      "after" in query ? afterQuerySchema : latestQuerySchema
    ).safeParse(query);
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        ctx.issues.push({
          code: "custom",
          message: "invalid",
          input: query,
          path: issue.path,
        });
      return z.NEVER;
    }
    return parsed.data;
  });

const messageParamSchema = z.object({ messageId: z.string().min(1).max(64) });

// 編集は本文だけ。削除の理由（reason）は他人の投稿の削除（#142）で扱うため、ここでは受け付けない
const editSchema = z.object({ body: messageBodySchema }).strict();

function actorOf(c: Context<{ Bindings: Env }>): MessageActor {
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

/** メッセージ 1 件の編集・削除（/api/messages/:messageId。#134） */
export function messageItemRoutes() {
  return new Hono<{ Bindings: Env }>()
    .patch(
      "/:messageId",
      validate("param", messageParamSchema),
      validate("json", editSchema),
      async (c) => {
        const actor = actorOf(c);
        const edited = await withMessageService(c.env, actor, (service) =>
          service.edit(
            actor,
            c.req.valid("param").messageId,
            c.req.valid("json").body,
          ),
        );
        return c.json(edited, 200);
      },
    )
    .delete("/:messageId", validate("param", messageParamSchema), async (c) => {
      const actor = actorOf(c);
      await withMessageService(c.env, actor, (service) =>
        service.remove(actor, c.req.valid("param").messageId),
      );
      return c.body(null, 204);
    });
}

export function messageRoutes() {
  return new Hono<{ Bindings: Env }>()
    .get(
      "/:roomId/messages",
      validate("param", roomParamSchema),
      validate("query", listQuerySchema),
      async (c) => {
        const actor = actorOf(c);
        const page = await withMessageService(c.env, actor, (service) =>
          service.list(
            actor,
            c.req.valid("param").roomId,
            c.req.valid("query"),
          ),
        );
        return c.json(page);
      },
    )
    .post(
      "/:roomId/messages",
      validate("param", roomParamSchema),
      validate("json", postSchema),
      async (c) => {
        const actor = actorOf(c);
        const created = await withMessageService(c.env, actor, (service) =>
          service.post(
            actor,
            c.req.valid("param").roomId,
            c.req.valid("json").body,
          ),
        );
        return c.json(created, 201);
      },
    );
}
