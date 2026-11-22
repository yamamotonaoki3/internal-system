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
import { attachmentIdsSchema } from "../../../shared/attachment-rules";
import {
  isBlankMessageBody,
  MESSAGE_BODY_REQUIRED_MESSAGE,
  messageContentMaybeBlankSchema,
} from "../../../shared/message-rules";
import {
  isValidReaction,
  REACTION_KINDS,
} from "../../../shared/reaction-rules";
import { searchKeywordSchema } from "../../../shared/search-rules";

const roomParamSchema = z.object({ roomId: z.string().min(1).max(64) });

// 投稿・返信には、アップロード済みの添付の ID を付けられる（#140）。結び付けてよいかは Service と同じ batch の条件で確かめる
// 本文が空（空白だけ）でよいのは、添付を1件以上付けたときだけ（#270・C-137(3)）
const postSchema = messageContentMaybeBlankSchema
  .safeExtend({
    attachmentIds: attachmentIdsSchema.optional(),
  })
  .superRefine(({ body, attachmentIds = [] }, ctx) => {
    if (isBlankMessageBody(body) && attachmentIds.length === 0)
      ctx.addIssue({
        code: "custom",
        path: ["body"],
        message: MESSAGE_BODY_REQUIRED_MESSAGE,
      });
  });
const candidateQuerySchema = cursorQuerySchema({
  defaultLimit: PAGE_LIMIT.default,
})
  .extend({ q: searchKeywordSchema.optional() })
  .strict();

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
// 本文の空は通す。見える添付があるかは、Service が①〜⑤の後に判定する（#270・C-205）
const editSchema = messageContentMaybeBlankSchema;

// リアクションの値は、固定の一覧（shared/reaction-rules.ts）にあるものだけ。422 の応答に入力値を含めない（validate は項目名だけを返す）
const reactionValueSchema = z.object({
  kind: z.enum(REACTION_KINDS),
  value: z.string().max(64),
});
const reactionRefinement = (
  reaction: z.infer<typeof reactionValueSchema>,
  ctx: z.RefinementCtx,
) => {
  if (!isValidReaction(reaction.kind, reaction.value))
    ctx.addIssue({ code: "custom", message: "invalid", path: ["value"] });
};
const reactionBodySchema = reactionValueSchema
  .strict()
  .superRefine(reactionRefinement);
const reactionParamSchema = reactionValueSchema
  .extend({ messageId: z.string().min(1).max(64) })
  .superRefine(reactionRefinement);

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

/** メッセージ 1 件の編集・削除（#134）と、スレッドの返信の取得・投稿（#137）。/api/messages/:messageId */
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
            c.req.valid("json").mentions ?? [],
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
    })
    .post(
      "/:messageId/reactions",
      validate("param", messageParamSchema),
      validate("json", reactionBodySchema),
      async (c) => {
        const actor = actorOf(c);
        const { kind, value } = c.req.valid("json");
        const reactions = await withMessageService(c.env, actor, (service) =>
          service.addReaction(
            actor,
            c.req.valid("param").messageId,
            kind,
            value,
          ),
        );
        return c.json(reactions, 200);
      },
    )
    .delete(
      "/:messageId/reactions/:kind/:value",
      validate("param", reactionParamSchema),
      async (c) => {
        const actor = actorOf(c);
        const { messageId, kind, value } = c.req.valid("param");
        const reactions = await withMessageService(c.env, actor, (service) =>
          service.removeReaction(actor, messageId, kind, value),
        );
        return c.json(reactions, 200);
      },
    )
    .get(
      "/:messageId/replies",
      validate("param", messageParamSchema),
      validate("query", listQuerySchema),
      async (c) => {
        const actor = actorOf(c);
        const page = await withMessageService(c.env, actor, (service) =>
          service.listReplies(
            actor,
            c.req.valid("param").messageId,
            c.req.valid("query"),
          ),
        );
        return c.json(page);
      },
    )
    .post(
      "/:messageId/replies",
      validate("param", messageParamSchema),
      validate("json", postSchema),
      async (c) => {
        const actor = actorOf(c);
        const created = await withMessageService(c.env, actor, (service) =>
          service.postReply(
            actor,
            c.req.valid("param").messageId,
            c.req.valid("json").body,
            c.req.valid("json").mentions ?? [],
            c.req.valid("json").attachmentIds ?? [],
          ),
        );
        return c.json(created, 201);
      },
    );
}

export function messageRoutes() {
  return new Hono<{ Bindings: Env }>()
    .get(
      "/:roomId/mention-candidates",
      validate("param", roomParamSchema),
      validate("query", candidateQuerySchema),
      async (c) => {
        const actor = actorOf(c);
        const { q, ...query } = c.req.valid("query");
        const page = await withMessageService(c.env, actor, (service) =>
          service.mentionCandidates(
            actor,
            c.req.valid("param").roomId,
            q === undefined ? query : { ...query, keyword: q },
          ),
        );
        return c.json(page);
      },
    )
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
            c.req.valid("json").mentions ?? [],
            c.req.valid("json").attachmentIds ?? [],
          ),
        );
        return c.json(created, 201);
      },
    );
}
