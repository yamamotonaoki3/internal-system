// Controller：退職処理の申請（#128）。部署のオーナーの申請・自分の申請・取り下げ（/api/retirement-requests）と、
// 全体管理者の一覧・却下（/api/admin/retirement-requests）。承認はアカウントの無効化（/api/admin/accounts/:id/deactivate）で行う。
// 入力の形の確認（422）と応答だけを行い、業務のルール（認可・再認証・状態の確認）は Service が行う。
// 申請のIDは形を確かめず Service に渡す（形の違うIDも、存在しない申請と同じ応答にする。accounts.ts の :id と同じ扱い）。
// 認証と送信元の確認（originCheck）は app.ts が /api/* に一括で適用する。
import { Hono, type Context } from "hono";
import { z } from "zod";
import { rejectReasonSchema } from "../../../shared/channel-name-rules";
import { AppError } from "../lib/app-error";
import { cursorQuerySchema, PAGE_LIMIT } from "../lib/cursor";
import { noStore } from "../lib/security";
import { traceIdOf } from "../lib/trace-id";
import { isUlid } from "../lib/ulid";
import { validate } from "../lib/validation";
import {
  withRetirementRequestService,
  type RetirementRequestActor,
} from "../services/retirement-request.service";

const createSchema = z
  .object({ targetUserId: z.string().refine(isUlid) })
  .strict();
// 却下の理由の上限は、チャンネルの作成申請と同じ定義（REJECT_REASON_MAX_LENGTH）を使う
const rejectSchema = z.object({ reason: rejectReasonSchema }).strict();
const mineQuerySchema = cursorQuerySchema({
  defaultLimit: PAGE_LIMIT.default,
}).strict();
const reviewQuerySchema = cursorQuerySchema({
  defaultLimit: PAGE_LIMIT.default,
})
  .extend({
    status: z.enum(["pending", "approved", "rejected", "withdrawn"]).optional(),
  })
  .strict();

function actorOf(c: Context<{ Bindings: Env }>): RetirementRequestActor {
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

export function retirementRequestRoutes() {
  return (
    new Hono<{ Bindings: Env }>()
      .post("/", noStore, validate("json", createSchema), async (c) => {
        const actor = actorOf(c);
        const created = await withRetirementRequestService(c.env, (service) =>
          service.create(actor, c.req.valid("json")),
        );
        return c.json(created, 201);
      })
      // /mine は /:requestId より前に定義する
      .get("/mine", noStore, validate("query", mineQuerySchema), async (c) => {
        const actor = actorOf(c);
        const page = await withRetirementRequestService(c.env, (service) =>
          service.listMine(actor, c.req.valid("query")),
        );
        return c.json(page);
      })
      .post("/:requestId/withdraw", noStore, async (c) => {
        const actor = actorOf(c);
        const withdrawn = await withRetirementRequestService(c.env, (service) =>
          service.withdraw(actor, c.req.param("requestId")),
        );
        return c.json(withdrawn);
      })
  );
}

export function adminRetirementRequestRoutes() {
  return new Hono<{ Bindings: Env }>()
    .get("/", noStore, validate("query", reviewQuerySchema), async (c) => {
      const actor = actorOf(c);
      const page = await withRetirementRequestService(c.env, (service) =>
        service.listForReview(actor, c.req.valid("query")),
      );
      return c.json(page);
    })
    .post(
      "/:requestId/reject",
      noStore,
      validate("json", rejectSchema),
      async (c) => {
        const actor = actorOf(c);
        const rejected = await withRetirementRequestService(c.env, (service) =>
          service.reject(
            actor,
            c.req.param("requestId"),
            c.req.valid("json").reason,
          ),
        );
        return c.json(rejected);
      },
    );
}
