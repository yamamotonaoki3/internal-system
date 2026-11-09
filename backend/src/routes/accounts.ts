// Controller（ルート）：アカウントの個別発行・一覧・部署の候補（管理者用。/api/admin/accounts）。
// 処理の順序：認証（app.ts）→ 送信元の確認（app.ts）→ 管理者の認可（403）→ 入力の検証（422）→ 設定の不備（503）→ 保存。
// 認可を入力の検証より先に行い、管理者以外に入力の規則や不備を教えない。認可は Service でも毎回行う。
import { Hono, type Context } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import {
  accountDisplayNameSchema,
  accountEmailSchema,
  accountExtensionSchema,
  accountJobTitleSchema,
  accountLegalNameSchema,
  accountLoginIdSchema,
} from "../../../shared/account-rules";
import { loadConfig } from "../config";
import { AppError } from "../lib/app-error";
import { cursorQuerySchema, PAGE_LIMIT } from "../lib/cursor";
import { noStore } from "../lib/security";
import { traceIdOf } from "../lib/trace-id";
import { isUlid } from "../lib/ulid";
import { validate } from "../lib/validation";
import {
  withAccountService,
  type AccountActor,
} from "../services/account.service";

const listSchema = cursorQuerySchema({
  defaultLimit: PAGE_LIMIT.default,
}).strict();

const createSchema = z
  .object({
    loginId: accountLoginIdSchema,
    legalName: accountLegalNameSchema,
    displayName: accountDisplayNameSchema,
    email: accountEmailSchema,
    // 会社が発行したメールだと管理者が確認したこと。検証だけに使い、保存しない
    emailConfirmed: z.literal(true),
    departmentId: z.string().refine(isUlid),
    extension: accountExtensionSchema.optional(),
    jobTitle: accountJobTitleSchema.optional(),
  })
  .strict();

function actorOf(c: Context<{ Bindings: Env }>): AccountActor {
  const principal = c.get("principal");
  if (principal === null) {
    throw new AppError("UNAUTHENTICATED", "ログインしてください");
  }
  return { userId: principal.userId, traceId: traceIdOf(c) };
}

// 入力の検証より前に、管理者だけを通す
const requireAccountAdmin = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    const actor = actorOf(c);
    await withAccountService(c.env, (service) => service.authorize(actor));
    await next();
  },
);

export function adminAccountRoutes() {
  return (
    new Hono<{ Bindings: Env }>()
      .use("*", requireAccountAdmin)
      .get("/", validate("query", listSchema), async (c) => {
        const actor = actorOf(c);
        const page = await withAccountService(c.env, (service) =>
          service.listAdmin(actor, c.req.valid("query")),
        );
        return c.json(page);
      })
      .get("/department-options", async (c) => {
        const actor = actorOf(c);
        const options = await withAccountService(c.env, (service) =>
          service.departmentOptions(actor),
        );
        return c.json(options);
      })
      // 応答に初期パスワードを含むため、キャッシュさせない
      .post("/", noStore, validate("json", createSchema), async (c) => {
        const actor = actorOf(c);
        const { piiEncryptionKey } = loadConfig(c.env);
        if (piiEncryptionKey === null) {
          throw new AppError(
            "SERVICE_UNAVAILABLE",
            "アカウントの登録は現在使えません。運用担当者に連絡してください",
          );
        }
        // emailConfirmed は検証だけに使い、保存する値には含めない
        const body = c.req.valid("json");
        const input = {
          loginId: body.loginId,
          legalName: body.legalName,
          displayName: body.displayName,
          email: body.email,
          departmentId: body.departmentId,
          extension: body.extension,
          jobTitle: body.jobTitle,
        };
        const created = await withAccountService(c.env, (service) =>
          service.create(actor, input, { piiKey: piiEncryptionKey }),
        );
        return c.json(created, 201);
      })
  );
}
