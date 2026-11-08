import { Hono, type Context } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import {
  clientCodeSchema,
  clientNameSchema,
  clientSearchSchema,
} from "../../../shared/client-rules";
import { AppError } from "../lib/app-error";
import { cursorQuerySchema, PAGE_LIMIT } from "../lib/cursor";
import { createLogger } from "../lib/logger/logger";
import { traceIdOf } from "../lib/trace-id";
import { isUlid } from "../lib/ulid";
import { validate } from "../lib/validation";
import {
  consumeClientApiRateLimit,
  withClientService,
  type ClientActor,
  type ClientRateBucket,
} from "../services/client.service";

const CLIENT_RATE_LIMIT = { read: 120, write: 30 } as const;
function clientRateLimit(bucket: ClientRateBucket) {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    const principal = c.get("principal");
    if (principal === null) {
      throw new AppError("UNAUTHENTICATED", "ログインしてください");
    }
    const logger = createLogger({
      traceId: traceIdOf(c),
      userId: principal.userId,
    });
    const nowMs = Date.now();
    const limit = CLIENT_RATE_LIMIT[bucket];
    let consumed;
    try {
      consumed = await consumeClientApiRateLimit(c.env, {
        userId: principal.userId,
        bucket,
        nowMs,
        limit,
      });
    } catch (error) {
      logger.error("取引先APIの試行制限の記録に失敗した", { bucket, error });
      throw new AppError(
        "SERVICE_UNAVAILABLE",
        "取引先の操作を受け付けられません。時間をおいて試してください",
        {},
        { cause: error },
      );
    }
    if (consumed.attemptCount > limit) {
      logger.audit("client.rate_limited", bucket, "failure");
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((consumed.windowStartedAtMs + 60_000 - nowMs) / 1000),
      );
      throw new AppError("RATE_LIMITED", "しばらく待ってから試してください", {
        retryAfterSeconds,
      });
    }
    await next();
  });
}
const readRateLimit = clientRateLimit("read");
const writeRateLimit = clientRateLimit("write");

const listSchema = cursorQuerySchema({ defaultLimit: PAGE_LIMIT.default })
  .extend({
    q: clientSearchSchema.default(""),
    status: z.enum(["all", "active", "inactive"]).default("all"),
  })
  .strict();
const publicListSchema = cursorQuerySchema({ defaultLimit: PAGE_LIMIT.default })
  .extend({ q: clientSearchSchema.default("") })
  .strict();
const createSchema = z
  .object({
    code: clientCodeSchema,
    name: clientNameSchema,
  })
  .strict();
const idSchema = z.object({
  id: z.string().refine(isUlid),
});
const renameSchema = z
  .object({
    name: clientNameSchema,
    version: z.number().int().min(1),
  })
  .passthrough()
  .superRefine((input, context) => {
    for (const key of Object.keys(input)) {
      if (key !== "name" && key !== "version") {
        context.addIssue({
          code: "custom",
          path: [key],
          message: "余分な項目です",
        });
      }
    }
  });
const statusSchema = z
  .object({
    active: z.literal(false),
    version: z.number().int().min(1),
  })
  .strict();

function actorOf(c: Context<{ Bindings: Env }>): ClientActor {
  const principal = c.get("principal");
  if (principal === null) {
    throw new AppError("UNAUTHENTICATED", "ログインしてください");
  }
  return { userId: principal.userId, traceId: traceIdOf(c) };
}

export function adminClientRoutes() {
  return new Hono<{ Bindings: Env }>()
    .get("/", readRateLimit, validate("query", listSchema), async (c) => {
      const actor = actorOf(c);
      const page = await withClientService(c.env, (service) =>
        service.listAdmin(actor, c.req.valid("query")),
      );
      return c.json(page);
    })
    .post("/", writeRateLimit, validate("json", createSchema), async (c) => {
      const actor = actorOf(c);
      const client = await withClientService(c.env, (service) =>
        service.create(actor, c.req.valid("json")),
      );
      return c.json(client, 201);
    })
    .patch(
      "/:id",
      writeRateLimit,
      validate("param", idSchema),
      validate("json", renameSchema),
      async (c) => {
        const actor = actorOf(c);
        const client = await withClientService(c.env, (service) =>
          service.rename(actor, c.req.valid("param").id, c.req.valid("json")),
        );
        return c.json(client);
      },
    )
    .patch(
      "/:id/status",
      writeRateLimit,
      validate("param", idSchema),
      validate("json", statusSchema),
      async (c) => {
        const actor = actorOf(c);
        const client = await withClientService(c.env, (service) =>
          service.deactivate(
            actor,
            c.req.valid("param").id,
            c.req.valid("json"),
          ),
        );
        return c.json(client);
      },
    );
}

export function clientRoutes() {
  return new Hono<{ Bindings: Env }>()
    .get("/", readRateLimit, validate("query", publicListSchema), async (c) => {
      const page = await withClientService(c.env, (service) =>
        service.listPublic(c.req.valid("query")),
      );
      return c.json(page);
    })
    .get(
      "/candidates",
      readRateLimit,
      validate("query", publicListSchema),
      async (c) => {
        const page = await withClientService(c.env, (service) =>
          service.listCandidates(c.req.valid("query")),
        );
        return c.json(page);
      },
    );
}
