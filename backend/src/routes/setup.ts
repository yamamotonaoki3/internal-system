// Controller（ルート）：初代全体管理者の初回セットアップ（S-34）。未認証で呼べる。POST は初回専用の認証（SETUP_TOKEN）を必要とする。
// DB の処理は引数で受け取る（routes は db/ を直接読まない）。送信元の確認（POST）は app.ts の /api/* で行う。
// 処理の順序（Service の冒頭のコメントと同じ）：本文の形 → 接続元の受付枠（429）→ 設定の不備 503・トークン 403 → 入力の検証 422 → 完了済み 409。
import { Hono } from "hono";
import { z } from "zod";
import { loadConfig } from "../config";
import { AppError } from "../lib/app-error";
import { createLogger } from "../lib/logger/logger";
import { noStore } from "../lib/security";
import { sourceBucketKey } from "../lib/source-key";
import { traceIdOf } from "../lib/trace-id";
import { validate } from "../lib/validation";
import { admitSource, type WithAuth } from "../services/auth.service";
import {
  authenticateSetup,
  completeSetup,
  getSetupStatus,
  type WithSetup,
} from "../services/setup.service";

// 制御文字（改行・タブ・NUL・DEL など）を含まない
const noControl = (value: string) => !/\p{Cc}/u.test(value);

// 前後の空白（全角空白を含む）を除いた文字数で数える
const text = (max: number) =>
  z.string().trim().min(1).max(max).refine(noControl);

// 本名・表示名は、セットアップでは1〜30文字に限る（D-7。本名の一般の規則1〜50文字は変えない）
const setupSchema = z.object({
  companyName: text(100),
  departmentName: text(50),
  loginId: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[A-Za-z0-9._-]+$/),
  legalName: text(30),
  email: z.string().max(254).pipe(z.email()),
  // 登録に際して「会社が発行した自分のメールアドレス」だと本人が確認したこと（初代管理者は自己確認。改訂版 3.5）
  emailConfirmed: z.literal(true),
  extension: z
    .string()
    .min(1)
    .max(10)
    .regex(/^[0-9-]+$/)
    .optional(),
  jobTitle: text(30).optional(),
});

// 認証の前は、本文が JSON のオブジェクトであることだけを確かめる（トークンの欄の有無・型は認証で扱う）
const envelopeSchema = z.looseObject({ setupToken: z.unknown().optional() });

/**
 * withThrottle は、接続元ごとの試行制限（setup_source）の DB 処理。入口（index.ts）が必ず渡す。
 * 渡されないときは制限をかけられないため、POST を 503 にする（制限なしで動かさない）。
 */
export function setupRoutes(withSetup: WithSetup, withThrottle?: WithAuth) {
  return new Hono<{ Bindings: Env }>()
    .get("/status", noStore, async (c) => {
      return c.json(
        await withSetup(c.env, (repository) => getSetupStatus(repository)),
      );
    })
    .post("/", noStore, validate("json", envelopeSchema), async (c) => {
      const traceId = traceIdOf(c);
      const logger = createLogger({ traceId });
      const body = c.req.valid("json");
      const config = loadConfig(c.env);
      // 接続元の受付枠は、トークンの確認より前に確保する（総当たりを数える）
      if (withThrottle === undefined || config.loginThrottleKey === null) {
        throw new AppError(
          "SERVICE_UNAVAILABLE",
          "初回セットアップは現在使えません。運用担当者に連絡してください",
        );
      }
      const sourceKey = await sourceBucketKey(
        c.req.header("CF-Connecting-IP"),
        {
          appEnv: config.appEnv,
          throttleKey: config.loginThrottleKey,
          logger,
        },
      );
      await withThrottle(c.env, (repository) =>
        admitSource(
          repository,
          "setup_source",
          sourceKey,
          { traceId },
          { now: () => new Date(), logger },
        ),
      );
      const { piiEncryptionKey } = await authenticateSetup(
        config,
        body.setupToken,
        logger,
      );

      const parsed = setupSchema.safeParse(body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "入力内容を確かめてください", {
          fields: [
            ...new Set(
              parsed.error.issues.map((issue) => issue.path.join(".")),
            ),
          ],
        });
      }
      // emailConfirmed は検証だけに使い、保存する値には含めない
      const { companyName, departmentName, loginId, legalName, email } =
        parsed.data;
      const { extension, jobTitle } = parsed.data;
      const input = {
        companyName,
        departmentName,
        loginId,
        legalName,
        email,
        extension,
        jobTitle,
      };
      const result = await withSetup(c.env, (repository) =>
        completeSetup(repository, input, { piiEncryptionKey, traceId }),
      );
      return c.json(result, 201);
    });
}
