// Service：初代全体管理者の初回セットアップ。HTTP（Hono）も DB のライブラリも知らない。
// 処理の順序：設定の不備（503）→ 初回専用の認証（403）→ 入力の検証（422。Controller）→ 完了済み・同時に負けた（409）。
// 認証より前に、入力の検証や完了の状態を知らせない（トークンを持たない人に、状態を教えない）。
import {
  SetupConflictError,
  type SetupConflictReason,
  type SetupRepository,
} from "../db/setup.repository";
import { AppError } from "../lib/app-error";
import type { Logger } from "../lib/logger/logger";
import { generateInitialPassword, hashPassword } from "../lib/password";
import { encryptLegalName } from "../lib/pii-crypto";
import { verifySetupToken } from "../lib/setup-token";
import { newUlid } from "../lib/ulid";

/** Repository を使う間だけ DB につなぐ処理。Workers の入口（index.ts）が本物を渡し、テストが差し替える */
export type WithSetup = <T>(
  env: Env,
  run: (repository: SetupRepository) => Promise<T>,
) => Promise<T>;

export type SetupSecrets = {
  setupToken: string | null;
  piiEncryptionKey: string | null;
};

export type SetupInput = {
  companyName: string;
  departmentName: string;
  loginId: string;
  legalName: string;
  email: string;
  extension?: string | undefined;
  jobTitle?: string | undefined;
};

export type SetupResult = {
  user: { id: string; loginId: string; displayName: string };
  /** 一度だけ画面に表示する。保存しない */
  initialPassword: string;
};

const SETUP_ACTION = "setup.initial_admin.create";

const CONFLICT_MESSAGES: Record<SetupConflictReason, string> = {
  already_completed: "初回セットアップはすでに完了しています",
  login_id: "その社員IDはすでに使われています",
  email: "そのメールアドレスはすでに使われています",
  department_name: "その部署名はすでに使われています",
};

const alreadyCompleted = () =>
  new AppError("CONFLICT", CONFLICT_MESSAGES.already_completed);

export async function getSetupStatus(
  repository: SetupRepository,
): Promise<{ setupRequired: boolean }> {
  return { setupRequired: !(await repository.isSetupCompleted()) };
}

/**
 * 初回専用の認証。設定が使えない（未設定・形式不正）なら 503、トークンが誤り・欠落なら 403。
 * 失敗は logger.audit にだけ記録する（試行制限は #120 で ADR-0008 の仕組みができてから適用する。値は記録しない）。
 * 使える暗号鍵を返す（呼び出し側が null を再確認しなくてよいように）。
 */
export async function authenticateSetup(
  secrets: SetupSecrets,
  token: unknown,
  logger: Logger,
): Promise<{ piiEncryptionKey: string }> {
  const { setupToken, piiEncryptionKey } = secrets;
  if (setupToken === null || piiEncryptionKey === null) {
    throw new AppError(
      "SERVICE_UNAVAILABLE",
      "初回セットアップは現在使えません。運用担当者に連絡してください",
    );
  }
  if (
    typeof token !== "string" ||
    !(await verifySetupToken(token, setupToken))
  ) {
    logger.audit(SETUP_ACTION, "setup", "failure", { reason: "invalid_token" });
    throw new AppError(
      "FORBIDDEN",
      "セットアップ用のトークンが正しくありません",
    );
  }
  return { piiEncryptionKey };
}

export async function completeSetup(
  repository: SetupRepository,
  input: SetupInput,
  context: { piiEncryptionKey: string; traceId: string },
): Promise<SetupResult> {
  if (await repository.isSetupCompleted()) throw alreadyCompleted();

  const userId = newUlid();
  const initialPassword = generateInitialPassword();
  // 初期表示名は本名と同じ値（0-1 AC-11）
  const displayName = input.legalName;
  const [passwordHash, legalNameEncrypted] = await Promise.all([
    hashPassword(initialPassword),
    encryptLegalName(input.legalName, context.piiEncryptionKey, userId),
  ]);

  try {
    await repository.createInitialAdmin({
      userId,
      departmentId: newUlid(),
      companyName: input.companyName,
      departmentName: input.departmentName,
      loginId: input.loginId,
      displayName,
      legalNameEncrypted,
      email: input.email,
      extension: input.extension ?? null,
      jobTitle: input.jobTitle ?? null,
      passwordHash,
      now: new Date().toISOString(),
      traceId: context.traceId,
    });
  } catch (error) {
    if (error instanceof SetupConflictError) {
      throw new AppError(
        "CONFLICT",
        CONFLICT_MESSAGES[error.reason],
        {},
        { cause: error },
      );
    }
    throw error;
  }
  return {
    user: { id: userId, loginId: input.loginId, displayName },
    initialPassword,
  };
}
