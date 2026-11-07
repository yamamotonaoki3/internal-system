// Service：現在の秘密の照合と、再認証・本人パスワード変更の確定を指示する。
import type { CredentialRepository } from "../db/credential.repository";
import { REAUTH_VALIDITY_MS } from "../../../shared/reauth-policy";
import { AppError } from "../lib/app-error";
import type { AuthDeps } from "./auth.service";
import { admitSource } from "./auth.service";
import { isPasswordAllowed } from "../lib/password-policy";
import { hashSessionToken } from "../lib/session-token";
import { accountBucketKey } from "../lib/source-key";
import { accountDelayMs } from "../lib/throttle-policy";

export type WithCredentials = <T>(
  env: Env,
  run: (repository: CredentialRepository) => Promise<T>,
) => Promise<T>;

export type CredentialContext = {
  userId: string;
  loginId: string;
  displayName: string;
  reauthenticatedAt: string | null;
  sessionToken: string;
  sourceKey: string;
  throttleKey: string;
  traceId: string;
};

const POLICY_MESSAGE = "このパスワードは使えません";
const CONFLICT_MESSAGE =
  "認証情報が変更されました。読み込み直してからお試しください";

export function assertRecentReauth(
  reauthenticatedAt: string | null,
  now: Date = new Date(),
): void {
  const at =
    reauthenticatedAt === null ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(reauthenticatedAt)
      ? Number.NaN
      : Date.parse(reauthenticatedAt);
  const elapsed = now.getTime() - at;
  if (
    !Number.isFinite(elapsed) ||
    new Date(at).toISOString() !== reauthenticatedAt ||
    elapsed < 0 ||
    elapsed >= REAUTH_VALIDITY_MS
  ) {
    throw new AppError(
      "REAUTH_REQUIRED",
      "操作を続けるにはパスワードを再入力してください",
    );
  }
}

async function checkPassword(
  repository: CredentialRepository,
  password: string,
  context: CredentialContext,
  action: "auth.password_change" | "auth.reauthenticate",
  deps: AuthDeps,
) {
  await admitSource(repository, "source", context.sourceKey, context, deps);
  const accountKey = await accountBucketKey(
    context.loginId,
    context.throttleKey,
  );
  const throttle = await repository.readAccountThrottle(accountKey);
  const delay =
    throttle === null
      ? 0
      : accountDelayMs(throttle.failedCount, throttle.lastFailedAt, deps.now());
  if (delay > 0) await deps.sleep(delay);
  const credential = await repository.findCredential(context.userId);
  const usable = credential !== null && credential.isActive ? credential : null;
  const matched = await deps.verifyPassword(
    password,
    usable?.passwordHash ?? null,
  );
  if (usable === null || !matched) {
    await repository.recordCredentialFailure({
      accountKey,
      now: deps.now(),
      traceId: context.traceId,
      action,
    });
    if (action === "auth.reauthenticate") {
      throw new AppError(
        "REAUTH_FAILED",
        "パスワードが違います。もう一度入力してください",
      );
    }
    throw new AppError("VALIDATION_ERROR", "現在のパスワードが違います", {
      fields: ["currentPassword"],
    });
  }
  return { credential: usable, accountKey };
}

export async function changePassword(
  repository: CredentialRepository,
  input: { currentPassword: string; newPassword: string },
  context: CredentialContext,
  deps: AuthDeps,
) {
  if (
    !isPasswordAllowed(input.newPassword, context) ||
    input.currentPassword === input.newPassword
  ) {
    throw new AppError("VALIDATION_ERROR", POLICY_MESSAGE, {
      fields: ["newPassword"],
    });
  }
  const { credential, accountKey } = await checkPassword(
    repository,
    input.currentPassword,
    context,
    "auth.password_change",
    deps,
  );
  const changed = await repository.changePassword({
    userId: context.userId,
    sessionId: await hashSessionToken(context.sessionToken),
    passwordHash: credential.passwordHash,
    newPasswordHash: await deps.hashPassword(input.newPassword),
    accountKey,
    traceId: context.traceId,
    now: deps.now(),
  });
  if (!changed) throw new AppError("CONFLICT", CONFLICT_MESSAGE);
  return {
    user: {
      id: context.userId,
      displayName: credential.displayName,
      loginId: credential.loginId,
    },
    mustChangePassword: false,
    reauthenticatedAt: context.reauthenticatedAt,
  };
}

export async function reauthenticate(
  repository: CredentialRepository,
  input: { password: string },
  context: CredentialContext,
  deps: AuthDeps,
): Promise<{ reauthenticatedAt: string }> {
  const { credential, accountKey } = await checkPassword(
    repository,
    input.password,
    context,
    "auth.reauthenticate",
    deps,
  );
  const now = deps.now();
  const changed = await repository.reauthenticate({
    userId: context.userId,
    sessionId: await hashSessionToken(context.sessionToken),
    passwordHash: credential.passwordHash,
    accountKey,
    traceId: context.traceId,
    now,
  });
  if (!changed) throw new AppError("CONFLICT", CONFLICT_MESSAGE);
  return { reauthenticatedAt: now.toISOString() };
}
