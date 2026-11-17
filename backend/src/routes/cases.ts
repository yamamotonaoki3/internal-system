// Controller：案件の一覧・概要・詳細（/api/cases。#147 の 147-A。EP-5-06〜08）。
// 入力の形の確認（422）と応答だけを行い、見える範囲・参加の判定・認可は Service が行う。
// 認証と送信元の確認（originCheck）は app.ts が /api/* に一括で適用する。
import { Hono, type Context } from "hono";
import { z } from "zod";
import { AppError } from "../lib/app-error";
import { cursorQuerySchema, PAGE_LIMIT } from "../lib/cursor";
import { noStore } from "../lib/security";
import { traceIdOf } from "../lib/trace-id";
import { isUlid } from "../lib/ulid";
import { validate } from "../lib/validation";
import {
  CASE_LIST_SCOPES,
  CASE_STATUSES,
  withCaseService,
  type CaseActor,
} from "../services/case.service";

// scope・status は必須（既定は未決定のため持たない。画面が「参加中・進行中」から始める）
const listQuerySchema = cursorQuerySchema({
  defaultLimit: PAGE_LIMIT.default,
})
  .extend({
    scope: z.enum(CASE_LIST_SCOPES),
    status: z.enum(CASE_STATUSES),
  })
  .strict();
const caseParamSchema = z.object({ caseId: z.string().refine(isUlid) });

function actorOf(c: Context<{ Bindings: Env }>): CaseActor {
  const principal = c.get("principal");
  if (principal === null) {
    throw new AppError("UNAUTHENTICATED", "ログインしてください");
  }
  return { userId: principal.userId, traceId: traceIdOf(c) };
}

export function caseRoutes() {
  return new Hono<{ Bindings: Env }>()
    .get("/", noStore, validate("query", listQuerySchema), async (c) => {
      const actor = actorOf(c);
      const page = await withCaseService(c.env, (service) =>
        service.list(actor, c.req.valid("query")),
      );
      return c.json(page);
    })
    .get("/:caseId", noStore, validate("param", caseParamSchema), async (c) => {
      const actor = actorOf(c);
      const summary = await withCaseService(c.env, (service) =>
        service.summary(actor, c.req.valid("param").caseId),
      );
      return c.json(summary);
    })
    .get(
      "/:caseId/detail",
      noStore,
      validate("param", caseParamSchema),
      async (c) => {
        const actor = actorOf(c);
        const detail = await withCaseService(c.env, (service) =>
          service.detail(actor, c.req.valid("param").caseId),
        );
        return c.json(detail);
      },
    );
}
