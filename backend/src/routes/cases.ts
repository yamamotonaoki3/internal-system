// Controller：案件の一覧・概要・詳細（/api/cases。#147 の 147-A。EP-5-06〜08）と、参加者の追加・削除・納期の変更（147-B。EP-5-09・10）、
// 終了・再開（#150 の 150-A。EP-5-11・12）、添付の一覧（#148 の 148-B-1。EP-5-19）。
// 入力の形の確認（422）と応答だけを行い、見える範囲・参加の判定・認可は Service が行う。
// 147-B の本文は、ここでは JSON のオブジェクトであることだけを確かめ、項目の形は Service が 403 までの判定の後に確かめる
// （非参加者に、本文の誤りと他の理由を区別させない。存在の非開示）。
// 認証と送信元の確認（originCheck）は app.ts が /api/* に一括で適用する。
import { Hono, type Context } from "hono";
import { z } from "zod";
import { AppError } from "../lib/app-error";
import { cursorQuerySchema, PAGE_LIMIT } from "../lib/cursor";
import { noStore } from "../lib/security";
import { traceIdOf } from "../lib/trace-id";
import { isUlid } from "../lib/ulid";
import { validate } from "../lib/validation";
import { withCaseAttachmentService } from "../services/case-attachment.service";
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
/** 添付の一覧の1ページの既定の件数（計画 148-B-1「API」） */
const ATTACHMENT_PAGE_DEFAULT_LIMIT = 50;
const attachmentListQuerySchema = cursorQuerySchema({
  defaultLimit: ATTACHMENT_PAGE_DEFAULT_LIMIT,
}).strict();
const caseParamSchema = z.object({ caseId: z.string().refine(isUlid) });
const participantParamSchema = caseParamSchema.extend({
  userId: z.string().refine(isUlid),
});
const bodyEnvelopeSchema = z.looseObject({});

function actorOf(c: Context<{ Bindings: Env }>): CaseActor {
  const principal = c.get("principal");
  if (principal === null) {
    throw new AppError("UNAUTHENTICATED", "ログインしてください");
  }
  return { userId: principal.userId, traceId: traceIdOf(c) };
}

export function caseRoutes() {
  return (
    new Hono<{ Bindings: Env }>()
      .get("/", noStore, validate("query", listQuerySchema), async (c) => {
        const actor = actorOf(c);
        const page = await withCaseService(c.env, (service) =>
          service.list(actor, c.req.valid("query")),
        );
        return c.json(page);
      })
      .get(
        "/:caseId",
        noStore,
        validate("param", caseParamSchema),
        async (c) => {
          const actor = actorOf(c);
          const summary = await withCaseService(c.env, (service) =>
            service.summary(actor, c.req.valid("param").caseId),
          );
          return c.json(summary);
        },
      )
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
      )
      .get(
        "/:caseId/attachments",
        noStore,
        validate("param", caseParamSchema),
        validate("query", attachmentListQuerySchema),
        async (c) => {
          const actor = actorOf(c);
          const { limit } = c.req.valid("query");
          // Service は検証済みのカーソルを、文字列のまま Repository に渡す（Repository が復元する）
          const cursor = c.req.query("cursor") ?? null;
          const page = await withCaseAttachmentService(c.env, (service) =>
            service.list(actor, c.req.valid("param").caseId, {
              limit,
              cursor,
            }),
          );
          return c.json(page);
        },
      )
      .post(
        "/:caseId/participants",
        noStore,
        validate("param", caseParamSchema),
        validate("json", bodyEnvelopeSchema),
        async (c) => {
          const actor = actorOf(c);
          const added = await withCaseService(c.env, (service) =>
            service.addParticipant(
              actor,
              c.req.valid("param").caseId,
              c.req.valid("json"),
            ),
          );
          return c.json(added, 201);
        },
      )
      .delete(
        "/:caseId/participants/:userId",
        noStore,
        validate("param", participantParamSchema),
        async (c) => {
          const actor = actorOf(c);
          const { caseId, userId } = c.req.valid("param");
          await withCaseService(c.env, (service) =>
            service.removeParticipant(actor, caseId, userId),
          );
          return c.body(null, 204);
        },
      )
      .patch(
        "/:caseId/due-date",
        noStore,
        validate("param", caseParamSchema),
        validate("json", bodyEnvelopeSchema),
        async (c) => {
          const actor = actorOf(c);
          const changed = await withCaseService(c.env, (service) =>
            service.changeDueDate(
              actor,
              c.req.valid("param").caseId,
              c.req.valid("json"),
            ),
          );
          return c.json(changed);
        },
      )
      // 終了・再開は本文を持たない（送られても読まない）
      .post(
        "/:caseId/close",
        noStore,
        validate("param", caseParamSchema),
        async (c) => {
          const actor = actorOf(c);
          const closed = await withCaseService(c.env, (service) =>
            service.close(actor, c.req.valid("param").caseId),
          );
          return c.json(closed);
        },
      )
      .post(
        "/:caseId/reopen",
        noStore,
        validate("param", caseParamSchema),
        async (c) => {
          const actor = actorOf(c);
          const reopened = await withCaseService(c.env, (service) =>
            service.reopen(actor, c.req.valid("param").caseId),
          );
          return c.json(reopened);
        },
      )
  );
}
