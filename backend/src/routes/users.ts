// Controller：社員一覧（EP-7-01）・部署の候補・プロフィールカード（EP-0-18）・ステータスの代理設定（EP-0-15）。
// 入力の形の確認（422）と応答だけを行い、認可と業務のルールは Service が行う。
import { Hono } from "hono";
import { z } from "zod";
import {
  returnAtSchema,
  userStatusKindSchema,
} from "../../../shared/profile-rules";
import { searchKeywordSchema } from "../../../shared/search-rules";
import { actorOf } from "../lib/actor";
import { cursorQuerySchema, PAGE_LIMIT } from "../lib/cursor";
import { noStore } from "../lib/security";
import { isUlid } from "../lib/ulid";
import { validate } from "../lib/validation";
import { withProfileService } from "../services/profile.service";

const idSchema = z.string().refine(isUlid);
const userIdParamSchema = z.object({ userId: idSchema });
const listSchema = cursorQuerySchema({ defaultLimit: PAGE_LIMIT.default })
  .extend({
    departmentId: idSchema.optional(),
    q: searchKeywordSchema.optional(),
  })
  .strict();
// 代理設定では一言を扱わない（P-5）。未知の項目は 422
const proxyStatusSchema = z
  .object({ status: userStatusKindSchema, returnAt: returnAtSchema.optional() })
  .strict();

export function userRoutes() {
  return new Hono<{ Bindings: Env }>()
    .get("/", noStore, validate("query", listSchema), async (c) => {
      const actor = actorOf(c);
      const { q, ...query } = c.req.valid("query");
      const page = await withProfileService(c.env, (service) =>
        service.listDirectory(
          actor,
          q === undefined ? query : { ...query, keyword: q },
        ),
      );
      return c.json(page);
    })
    .get("/departments", noStore, async (c) => {
      const actor = actorOf(c);
      const departments = await withProfileService(c.env, (service) =>
        service.listDepartments(actor),
      );
      return c.json(departments);
    })
    .get(
      "/:userId/profile-card",
      noStore,
      validate("param", userIdParamSchema),
      async (c) => {
        const actor = actorOf(c);
        const card = await withProfileService(c.env, (service) =>
          service.getProfileCard(actor, c.req.valid("param").userId),
        );
        return c.json(card);
      },
    )
    .put(
      "/:userId/status",
      noStore,
      validate("param", userIdParamSchema),
      validate("json", proxyStatusSchema),
      async (c) => {
        const actor = actorOf(c);
        const changed = await withProfileService(c.env, (service) =>
          service.setStatusByProxy(
            actor,
            c.req.valid("param").userId,
            c.req.valid("json"),
          ),
        );
        return c.json(changed);
      },
    );
}
