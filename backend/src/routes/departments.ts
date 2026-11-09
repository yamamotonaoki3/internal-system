// Controller：部署の作成・オーナーの交代（/api/departments）と、一覧・改名・オーナー候補（/api/admin/departments）。
// 入力の形の確認（422）と応答だけを行い、業務のルール（認可・再認証・状態の確認）は Service が行う。
import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  departmentDescriptionSchema,
  departmentNameSchema,
} from "../../../shared/department-rules";
import { AppError } from "../lib/app-error";
import { cursorQuerySchema, PAGE_LIMIT } from "../lib/cursor";
import { traceIdOf } from "../lib/trace-id";
import { isUlid } from "../lib/ulid";
import { validate } from "../lib/validation";
import {
  withDepartmentService,
  type DepartmentActor,
} from "../services/department.service";

/** オーナー候補の1ページの上限（計画 5章。社員の一覧を一度に大量に返さない） */
const CANDIDATE_LIMIT_MAX = 50;

const idSchema = z.string().refine(isUlid);
const versionSchema = z.number().int().min(1);

const idParamSchema = z.object({ id: idSchema });
const listSchema = cursorQuerySchema({
  defaultLimit: PAGE_LIMIT.default,
}).strict();
const candidatesSchema = cursorQuerySchema({
  defaultLimit: CANDIDATE_LIMIT_MAX,
})
  .extend({
    q: z.string().trim().max(100).default(""),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(CANDIDATE_LIMIT_MAX)
      .default(CANDIDATE_LIMIT_MAX),
  })
  .strict();
const createSchema = z
  .object({
    name: departmentNameSchema,
    description: departmentDescriptionSchema.optional(),
    ownerUserId: idSchema.optional(),
    previousDepartmentSuccessorUserId: idSchema.optional(),
  })
  .strict();
const renameSchema = z
  .object({ name: departmentNameSchema, version: versionSchema })
  .strict();
const changeOwnerSchema = z
  .object({
    ownerUserId: idSchema,
    previousDepartmentSuccessorUserId: idSchema.optional(),
    version: versionSchema,
  })
  .strict();

function actorOf(c: Context<{ Bindings: Env }>): DepartmentActor {
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

export function departmentRoutes() {
  return new Hono<{ Bindings: Env }>()
    .post("/", validate("json", createSchema), async (c) => {
      const actor = actorOf(c);
      const created = await withDepartmentService(c.env, (service) =>
        service.create(actor, c.req.valid("json")),
      );
      return c.json(created, 201);
    })
    .put(
      "/:id/owner",
      validate("param", idParamSchema),
      validate("json", changeOwnerSchema),
      async (c) => {
        const actor = actorOf(c);
        const changed = await withDepartmentService(c.env, (service) =>
          service.changeOwner(
            actor,
            c.req.valid("param").id,
            c.req.valid("json"),
          ),
        );
        return c.json(changed);
      },
    );
}

export function adminDepartmentRoutes() {
  return new Hono<{ Bindings: Env }>()
    .get("/", validate("query", listSchema), async (c) => {
      const actor = actorOf(c);
      const page = await withDepartmentService(c.env, (service) =>
        service.list(actor, c.req.valid("query")),
      );
      return c.json(page);
    })
    .get(
      "/owner-candidates",
      validate("query", candidatesSchema),
      async (c) => {
        const actor = actorOf(c);
        const page = await withDepartmentService(c.env, (service) =>
          service.listOwnerCandidates(actor, c.req.valid("query")),
        );
        return c.json(page);
      },
    )
    .patch(
      "/:id",
      validate("param", idParamSchema),
      validate("json", renameSchema),
      async (c) => {
        const actor = actorOf(c);
        const renamed = await withDepartmentService(c.env, (service) =>
          service.rename(actor, c.req.valid("param").id, c.req.valid("json")),
        );
        return c.json(renamed);
      },
    );
}
