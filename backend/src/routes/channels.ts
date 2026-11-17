// Controller（ルート）：チャンネルの一覧・詳細・参加・招待・管理（名前・説明の変更、アーカイブ・復元。#143）（/api/channels）。
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
  archiveReasonSchema,
  channelRequestDescriptionSchema,
  channelRequestNameSchema,
} from "../../../shared/channel-name-rules";
import {
  withChannelService,
  type ChannelInviteActor,
} from "../services/channel.service";
import { withChannelManageService } from "../services/channel-manage.service";

const idParamSchema = z.object({
  channelId: z.string().refine(isUlid),
});

const inviteBodySchema = z
  .object({
    userId: z.string().refine(isUlid),
  })
  .strict();

// 画面が詳細で読んだ版。違えば Service が 409 にする（同時の変更の上書きを防ぐ）
const versionSchema = z.number().int().min(1);

// 名前・説明の少なくとも1つ。名前は整形してから検証する（2-2 AC-13。定義は shared/channel-name-rules.ts）
const updateBodySchema = z
  .object({
    version: versionSchema,
    name: channelRequestNameSchema.optional(),
    description: channelRequestDescriptionSchema.optional(),
  })
  .strict()
  .refine((body) => body.name !== undefined || body.description !== undefined);

const archiveBodySchema = z
  .object({ version: versionSchema, reason: archiveReasonSchema })
  .strict();

const restoreBodySchema = z.object({ version: versionSchema }).strict();

const listSchema = cursorQuerySchema({ defaultLimit: PAGE_LIMIT.default })
  .extend({
    departmentId: z.string().refine(isUlid).optional(),
    joined: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
  })
  .strict();

// 再認証の時刻は招待（#135）とアーカイブ・復元（#143）が使う
function actorOf(c: Context<{ Bindings: Env }>): ChannelInviteActor {
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
    .patch(
      "/:channelId",
      validate("param", idParamSchema),
      validate("json", updateBodySchema),
      async (c) => {
        const actor = actorOf(c);
        const body = c.req.valid("json");
        const updated = await withChannelManageService(c.env, (service) =>
          service.update(actor, c.req.valid("param").channelId, {
            version: body.version,
            ...(body.name === undefined ? {} : { name: body.name }),
            ...(body.description === undefined
              ? {}
              : { description: body.description }),
          }),
        );
        return c.json(updated);
      },
    )
    .post(
      "/:channelId/delete",
      validate("param", idParamSchema),
      validate("json", archiveBodySchema),
      async (c) => {
        const actor = actorOf(c);
        const body = c.req.valid("json");
        const archived = await withChannelManageService(c.env, (service) =>
          service.archive(actor, c.req.valid("param").channelId, {
            version: body.version,
            reason: body.reason ?? null,
          }),
        );
        return c.json(archived);
      },
    )
    .post(
      "/:channelId/restore",
      validate("param", idParamSchema),
      validate("json", restoreBodySchema),
      async (c) => {
        const actor = actorOf(c);
        const restored = await withChannelManageService(c.env, (service) =>
          service.restore(actor, c.req.valid("param").channelId, {
            version: c.req.valid("json").version,
          }),
        );
        return c.json(restored);
      },
    )
    .post("/:channelId/join", validate("param", idParamSchema), async (c) => {
      const actor = actorOf(c);
      const joined = await withChannelService(c.env, (service) =>
        service.join(actor, c.req.valid("param").channelId),
      );
      return c.json(joined);
    })
    .post(
      "/:channelId/invitations",
      validate("param", idParamSchema),
      validate("json", inviteBodySchema),
      async (c) => {
        const actor = actorOf(c);
        const invited = await withChannelService(c.env, (service) =>
          service.invite(
            actor,
            c.req.valid("param").channelId,
            c.req.valid("json").userId,
          ),
        );
        return c.json(invited, 201);
      },
    );
}
