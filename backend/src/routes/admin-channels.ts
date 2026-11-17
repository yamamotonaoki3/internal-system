// Controller（ルート）：チャンネル管理（S-39。管理者用。/api/admin/channels。#143-b・EP-2-42・EP-2-43）。
// 処理の順序：認証（app.ts）→ 認可（403。入力の検証より先）→ 入力の検証（422）→ 取得（Service。範囲は SQL の条件）。
// 認可を入力の検証より先に行い、管理者でない人に入力の規則を教えない。読み取りだけなので、書き込みのルートは置かない（書き込みは /api/channels）。
import { Hono, type Context } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { DEPARTMENT_ANNOUNCEMENT_NAME_MAX } from "../../../shared/department-rules";
import { AppError } from "../lib/app-error";
import { cursorQuerySchema, PAGE_LIMIT } from "../lib/cursor";
import { noStore } from "../lib/security";
import { traceIdOf } from "../lib/trace-id";
import { isUlid } from "../lib/ulid";
import { validate } from "../lib/validation";
import {
  withChannelAdminService,
  type ChannelAdminActor,
  type ChannelAdminPermission,
} from "../services/channel-admin.service";

/** 一覧の状態の絞り込み（OpenAPI の enum と一致させる） */
export const ADMIN_CHANNEL_STATES = ["all", "active", "archived"] as const;
/** 応答の種類（案件専用は返さない。OpenAPI の enum と一致させる） */
export const ADMIN_CHANNEL_PURPOSES = [
  "normal",
  "department",
  "announcement",
  "company_general",
] as const;
export const CHANNEL_VISIBILITIES = ["public", "private"] as const;

// 検索語は前後の空白を除いて 1〜55 文字（お知らせ専用の名前の上限に合わせる）
const listSchema = cursorQuerySchema({ defaultLimit: PAGE_LIMIT.default })
  .extend({
    q: z
      .string()
      .transform((value) => value.trim())
      .pipe(
        z
          .string()
          .min(1)
          .refine((value) => value.length <= DEPARTMENT_ANNOUNCEMENT_NAME_MAX),
      )
      .optional(),
    state: z.enum(ADMIN_CHANNEL_STATES).default("all"),
  })
  .strict();

const idParamSchema = z.object({
  channelId: z.string().refine(isUlid),
});

export function adminActorOf(c: Context<{ Bindings: Env }>): ChannelAdminActor {
  const principal = c.get("principal");
  if (principal === null) {
    throw new AppError("UNAUTHENTICATED", "ログインしてください");
  }
  return { userId: principal.userId, traceId: traceIdOf(c) };
}

/** 入力の検証より前に、全体管理者か、いずれかの部署のオーナーだけを通す */
export function requireChannelAdmin(permission: ChannelAdminPermission) {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    const actor = adminActorOf(c);
    await withChannelAdminService(c.env, (service) =>
      service.assertCanOpen(actor, permission),
    );
    await next();
  });
}

export function adminChannelRoutes() {
  return new Hono<{ Bindings: Env }>()
    .use("*", requireChannelAdmin("perm.channel.edit"))
    .get("/", noStore, validate("query", listSchema), async (c) => {
      const actor = adminActorOf(c);
      const query = c.req.valid("query");
      const page = await withChannelAdminService(c.env, (service) =>
        service.list(actor, {
          state: query.state,
          limit: query.limit,
          ...(query.q === undefined ? {} : { q: query.q }),
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        }),
      );
      return c.json(page);
    })
    .get(
      "/:channelId",
      noStore,
      validate("param", idParamSchema),
      async (c) => {
        const actor = adminActorOf(c);
        const channel = await withChannelAdminService(c.env, (service) =>
          service.get(actor, c.req.valid("param").channelId),
        );
        return c.json(channel);
      },
    );
}
