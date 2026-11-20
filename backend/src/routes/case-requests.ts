// Controller：案件の作成申請（/api/case-requests。#146）。申請・自分の申請・取り下げ・類似件名の確認（146-A）、審査一覧・承認・却下（146-B）。
// 入力の形の確認（422）と応答だけを行い、業務のルール（認可・所属・整形の後の長さ・納期・再申請の元）は Service が行う。
// 認証と送信元の確認（originCheck）は app.ts が /api/* に一括で適用する。
import { Hono, type Context } from "hono";
import { z } from "zod";
import { rejectReasonSchema } from "../../../shared/channel-name-rules";
import {
  caseDescriptionSchema,
  caseDueDateSchema,
  caseTitleSchema,
} from "../../../shared/case-rules";
import { AppError } from "../lib/app-error";
import { cursorQuerySchema, PAGE_LIMIT } from "../lib/cursor";
import { noStore } from "../lib/security";
import { traceIdOf } from "../lib/trace-id";
import { isUlid } from "../lib/ulid";
import { validate } from "../lib/validation";
import {
  CASE_REQUEST_STATUSES,
  withCaseRequestService,
  type CaseRequestActor,
} from "../services/case-request.service";

const ulidSchema = z.string().refine(isUlid);
// 件数の上限は設けない（C-130）。要素の誤りも配列の欄の誤りとして返すため、配列全体で確かめる
const idListSchema = z
  .array(z.string())
  .refine((ids) => ids.every(isUlid) && new Set(ids).size === ids.length);

const createSchema = z
  .object({
    clientId: ulidSchema,
    // 整形の後の長さは Service が確かめる（整形で値が変わったかを応答に返すため、ここでは整形しない）
    title: z.string(),
    description: caseDescriptionSchema.optional(),
    dueDate: caseDueDateSchema.optional(),
    departmentIds: idListSchema.refine((ids) => ids.length > 0),
    candidateIds: idListSchema.optional(),
    resubmitOf: ulidSchema.optional(),
  })
  .strict();
const mineQuerySchema = cursorQuerySchema({
  defaultLimit: PAGE_LIMIT.default,
}).strict();
const reviewQuerySchema = cursorQuerySchema({
  defaultLimit: PAGE_LIMIT.default,
})
  .extend({ status: z.enum(CASE_REQUEST_STATUSES).optional() })
  .strict();
// 本文は省略できる（承認者が候補を足さないとき）
const approveSchema = z
  .object({ additionalCandidateIds: idListSchema.optional() })
  .strict();
// 却下の理由はチャンネルの作成申請と同じ規則（C-91）
const rejectSchema = z.object({ reason: rejectReasonSchema }).strict();
const similarQuerySchema = z
  // excludeCaseId：再編集の画面が、編集中の案件自身を「似た案件」に数えないために渡す（#150 の 150-C）
  .object({
    clientId: ulidSchema,
    title: caseTitleSchema,
    excludeCaseId: ulidSchema.optional(),
  })
  .strict();
// 存在しない申請と他人の申請を同じ 404 にするため、ID の形は確かめずに Service へ渡す
const requestParamSchema = z.object({ requestId: z.string().min(1) });

function actorOf(c: Context<{ Bindings: Env }>): CaseRequestActor {
  const principal = c.get("principal");
  if (principal === null) {
    throw new AppError("UNAUTHENTICATED", "ログインしてください");
  }
  return { userId: principal.userId, traceId: traceIdOf(c) };
}

export function caseRequestRoutes() {
  return (
    new Hono<{ Bindings: Env }>()
      .post("/", noStore, validate("json", createSchema), async (c) => {
        const actor = actorOf(c);
        const created = await withCaseRequestService(c.env, (service) =>
          service.create(actor, c.req.valid("json")),
        );
        return c.json(created, 201);
      })
      .get("/", noStore, validate("query", reviewQuerySchema), async (c) => {
        const actor = actorOf(c);
        const page = await withCaseRequestService(c.env, (service) =>
          service.listForReview(actor, c.req.valid("query")),
        );
        return c.json(page);
      })
      // /mine と /similar-title は /:requestId より前に定義する
      .get("/mine", noStore, validate("query", mineQuerySchema), async (c) => {
        const actor = actorOf(c);
        const page = await withCaseRequestService(c.env, (service) =>
          service.listMine(actor, c.req.valid("query")),
        );
        return c.json(page);
      })
      .get(
        "/similar-title",
        noStore,
        validate("query", similarQuerySchema),
        async (c) => {
          const actor = actorOf(c);
          const result = await withCaseRequestService(c.env, (service) =>
            service.checkSimilarTitle(actor, c.req.valid("query")),
          );
          return c.json(result);
        },
      )
      .post(
        "/:requestId/withdraw",
        noStore,
        validate("param", requestParamSchema),
        async (c) => {
          const actor = actorOf(c);
          const withdrawn = await withCaseRequestService(c.env, (service) =>
            service.withdraw(actor, c.req.valid("param").requestId),
          );
          return c.json(withdrawn);
        },
      )
      .post(
        "/:requestId/approve",
        noStore,
        validate("param", requestParamSchema),
        validate("json", approveSchema),
        async (c) => {
          const actor = actorOf(c);
          const approved = await withCaseRequestService(c.env, (service) =>
            service.approve(
              actor,
              c.req.valid("param").requestId,
              c.req.valid("json"),
            ),
          );
          return c.json(approved);
        },
      )
      .post(
        "/:requestId/reject",
        noStore,
        validate("param", requestParamSchema),
        validate("json", rejectSchema),
        async (c) => {
          const actor = actorOf(c);
          const rejected = await withCaseRequestService(c.env, (service) =>
            service.reject(
              actor,
              c.req.valid("param").requestId,
              c.req.valid("json").reason,
            ),
          );
          return c.json(rejected);
        },
      )
  );
}
