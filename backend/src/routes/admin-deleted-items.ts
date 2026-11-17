// Controller（ルート）：アーカイブしたものの一覧（S-38。管理者用。/api/admin/deleted-items。#143-b・EP-2-40）。
// 処理の順序：認証（app.ts）→ 認可（403。入力の検証より先）→ 入力の検証（422）→ 取得（Service。範囲は SQL の条件）。
// 種類は、いまはチャンネルだけ（案件は #151 で足す）。復元・物理削除は別のルート（/api/channels の復元、#143-c）。
import { Hono } from "hono";
import { z } from "zod";
import { cursorQuerySchema, PAGE_LIMIT } from "../lib/cursor";
import { noStore } from "../lib/security";
import { validate } from "../lib/validation";
import { withChannelAdminService } from "../services/channel-admin.service";
import { adminActorOf, requireChannelAdmin } from "./admin-channels";

/** 一覧の種類（OpenAPI の enum と一致させる） */
export const DELETED_ITEM_TYPES = ["channel"] as const;

const listSchema = cursorQuerySchema({ defaultLimit: PAGE_LIMIT.default })
  .extend({ type: z.enum(DELETED_ITEM_TYPES).optional() })
  .strict();

export function adminDeletedItemRoutes() {
  return new Hono<{ Bindings: Env }>()
    .use("*", requireChannelAdmin("perm.channel.delete"))
    .get("/", noStore, validate("query", listSchema), async (c) => {
      const actor = adminActorOf(c);
      const query = c.req.valid("query");
      const page = await withChannelAdminService(c.env, (service) =>
        service.listArchived(actor, {
          limit: query.limit,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        }),
      );
      return c.json(page);
    });
}
