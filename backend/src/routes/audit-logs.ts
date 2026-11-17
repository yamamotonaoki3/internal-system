// Controller（ルート）：監査ログの閲覧（管理者用。/api/admin/audit-logs。#156・0-6・S-25）。
// 処理の順序：認証（app.ts）→ 送信元の確認（app.ts）→ 全体管理者の認可（403）→ 入力の検証（422）→ 閲覧の記録と取得（Service。同じ batch）。
// 認可を入力の検証より先に行い、全体管理者以外に絞り込みの規則を教えない。認可は Service でも毎回行う。
// 取得のたびに閲覧の記録が残るため、POST にする（取得と記録を一体で行う。EP-0-19）。変更・削除・書き出しのルートは作らない（0-6 AC-4・R-16）。
import { Hono, type Context } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "../lib/audit-actions";
import { AppError } from "../lib/app-error";
import { cursorQuerySchema, PAGE_LIMIT } from "../lib/cursor";
import { noStore } from "../lib/security";
import { traceIdOf } from "../lib/trace-id";
import { isUlid } from "../lib/ulid";
import { validate } from "../lib/validation";
import {
  withAuditLogService,
  type AuditLogActor,
} from "../services/audit-log.service";

/** 暦として正しい YYYY-MM-DD（JST の日付）だけ */
function isCalendarDate(text: string): boolean {
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === (month ?? 1) - 1 &&
    date.getUTCDate() === day
  );
}

const jstDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isCalendarDate);

const searchSchema = cursorQuerySchema({ defaultLimit: PAGE_LIMIT.default })
  .extend({
    from: jstDateSchema.optional(),
    to: jstDateSchema.optional(),
    actorId: z.string().refine(isUlid).optional(),
    action: z.enum(AUDIT_ACTIONS).optional(),
    targetType: z.enum(AUDIT_TARGET_TYPES).optional(),
    targetId: z.string().refine(isUlid).optional(),
    result: z.enum(["success", "failure"]).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.from !== undefined &&
      value.to !== undefined &&
      value.from > value.to
    )
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: "終了日は開始日以降にしてください",
      });
    // 対象は、種類と ID を組で指定する
    if (value.targetType !== undefined && value.targetId === undefined)
      ctx.addIssue({
        code: "custom",
        path: ["targetId"],
        message: "対象の種類と ID は組で指定してください",
      });
    if (value.targetId !== undefined && value.targetType === undefined)
      ctx.addIssue({
        code: "custom",
        path: ["targetType"],
        message: "対象の種類と ID は組で指定してください",
      });
  });

function actorOf(c: Context<{ Bindings: Env }>): AuditLogActor {
  const principal = c.get("principal");
  if (principal === null) {
    throw new AppError("UNAUTHENTICATED", "ログインしてください");
  }
  return {
    userId: principal.userId,
    sessionId: principal.sessionId,
    traceId: traceIdOf(c),
  };
}

// 入力の検証より前に、全体管理者だけを通す
const requireAuditLogViewer = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    const actor = actorOf(c);
    await withAuditLogService(c.env, (service) => service.authorize(actor));
    await next();
  },
);

export function adminAuditLogRoutes() {
  return new Hono<{ Bindings: Env }>()
    .use("*", requireAuditLogViewer)
    .post("/search", noStore, validate("json", searchSchema), async (c) => {
      const actor = actorOf(c);
      const page = await withAuditLogService(c.env, (service) =>
        service.search(actor, c.req.valid("json")),
      );
      return c.json(page);
    });
}
