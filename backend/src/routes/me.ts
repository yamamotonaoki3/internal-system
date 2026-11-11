// Controller：本人のパスワード変更と、本人のプロフィールの取得・変更（表示名・ステータス・一言）。認証と初回変更の許可は共通middlewareで行う。
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { z } from "zod";
import { accountDisplayNameSchema } from "../../../shared/account-rules";
import {
  returnAtSchema,
  statusMessageSchema,
  userStatusKindSchema,
} from "../../../shared/profile-rules";
import { loadConfig } from "../config";
import { actorOf } from "../lib/actor";
import { AppError } from "../lib/app-error";
import { createLogger } from "../lib/logger/logger";
import { noStore } from "../lib/security";
import { SESSION_COOKIE } from "../lib/session-policy";
import { sourceBucketKey } from "../lib/source-key";
import { traceIdOf } from "../lib/trace-id";
import { validate } from "../lib/validation";
import { createAuthDeps } from "../services/auth.service";
import { withProfileService } from "../services/profile.service";
import {
  changePassword,
  type WithCredentials,
} from "../services/credentials.service";

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string(),
});

// 変える項目だけを送る。本名・メール・内線・役職・部署などは受け付けない（strict）。0項目は 422
const profilePatchSchema = z
  .object({
    displayName: accountDisplayNameSchema,
    status: userStatusKindSchema,
    returnAt: returnAtSchema,
    statusMessage: statusMessageSchema,
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0);

export function meRoutes(withCredentials: WithCredentials) {
  return new Hono<{ Bindings: Env }>()
    .get("/profile", noStore, async (c) => {
      const actor = actorOf(c);
      const profile = await withProfileService(c.env, (service) =>
        service.getOwnProfile(actor),
      );
      return c.json(profile);
    })
    .patch(
      "/profile",
      noStore,
      validate("json", profilePatchSchema),
      async (c) => {
        const actor = actorOf(c);
        const changed = await withProfileService(c.env, (service) =>
          service.updateOwnProfile(actor, c.req.valid("json")),
        );
        return c.json(changed);
      },
    )
    .put("/password", noStore, validate("json", passwordSchema), async (c) => {
      const principal = c.get("principal");
      const sessionToken = getCookie(c, SESSION_COOKIE);
      if (principal === null || sessionToken === undefined) {
        throw new AppError("UNAUTHENTICATED", "ログインしてください");
      }
      const config = loadConfig(c.env);
      if (config.loginThrottleKey === null) {
        throw new AppError(
          "SERVICE_UNAVAILABLE",
          "パスワードの変更は現在使えません。運用担当者に連絡してください",
        );
      }
      const throttleKey = config.loginThrottleKey;
      const traceId = traceIdOf(c);
      const logger = createLogger({ traceId, userId: principal.userId });
      const sourceKey = await sourceBucketKey(
        c.req.header("CF-Connecting-IP"),
        {
          appEnv: config.appEnv,
          throttleKey,
          logger,
        },
      );
      const result = await withCredentials(c.env, (repository) =>
        changePassword(
          repository,
          c.req.valid("json"),
          {
            userId: principal.userId,
            loginId: principal.loginId,
            displayName: principal.displayName,
            reauthenticatedAt: principal.reauthenticatedAt,
            sessionToken,
            sourceKey,
            throttleKey,
            traceId,
          },
          createAuthDeps(logger),
        ),
      );
      return c.json(result);
    });
}
