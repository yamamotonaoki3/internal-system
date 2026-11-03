// Controller（ルート）：初代全体管理者の初回セットアップ（S-34）。未認証で呼べる。POST は初回専用の認証（SETUP_TOKEN）を必要とする。
// DB の処理は引数で受け取る（routes は db/ を直接読まない）。送信元の確認（POST）は app.ts の /api/* で行う。
// 処理の順序（Service の冒頭のコメントと同じ）：本文の形 → 設定の不備 503・トークン 403 → 入力の検証 422 → 完了済み 409。
import { Hono } from "hono";
import { z } from "zod";
import { loadConfig } from "../config";
import { AppError } from "../lib/app-error";
import { createLogger } from "../lib/logger/logger";
import { noStore } from "../lib/security";
import { newUlid } from "../lib/ulid";
import { validate } from "../lib/validation";
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

export function setupRoutes(withSetup: WithSetup) {
  return new Hono<{ Bindings: Env }>()
    .get("/status", noStore, async (c) => {
      return c.json(
        await withSetup(c.env, (repository) => getSetupStatus(repository)),
      );
    })
    .post("/", noStore, validate("json", envelopeSchema), async (c) => {
      const traceId = c.req.header("X-Request-Id") ?? newUlid();
      const body = c.req.valid("json");
      const { piiEncryptionKey } = await authenticateSetup(
        loadConfig(c.env),
        body.setupToken,
        createLogger({ traceId }),
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
