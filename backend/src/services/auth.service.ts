// Service：ログイン・ログアウト・掃除。HTTP（Hono）も DB のライブラリも知らない。
// ログインは2段：verifyFirstFactor（第一要素＝社員IDとパスワードの確認。セッションを作らない）→ issueSession（セッションの発行）。
// #122 の TOTP は、この間に第二要素の確認を挿入する。
// 処理の順序：受付枠の確保（ハッシュの計算より前）→ 社員IDの遅延 → 検証（存在しない・無効・誤りで同じ計算を1回）→ 失敗の記録または発行。
import type { AuthRepository, SourceBucketType } from "../db/auth.repository";
import { AppError } from "../lib/app-error";
import type { Logger } from "../lib/logger/logger";
import {
  hashPassword,
  needsRehash,
  verifyPasswordConstantCost,
} from "../lib/password";
import { generateSessionToken, hashSessionToken } from "../lib/session-token";
import { accountBucketKey } from "../lib/source-key";
import { accountDelayMs, retryAfterSeconds } from "../lib/throttle-policy";
import { createLogger } from "../lib/logger/logger";
import type { CronJob } from "../scheduled";

export type {
  AuthRepository,
  LoginUser,
  SourceBucketType,
} from "../db/auth.repository";

/** Repository を使う間だけ DB につなぐ処理。Workers の入口（index.ts）が本物を渡し、テストが差し替える */
export type WithAuth = <T>(
  env: Env,
  run: (repository: AuthRepository) => Promise<T>,
) => Promise<T>;

/** 時刻・乱数・待ち・パスワードの計算。テストが差し替える */
export type AuthDeps = {
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  newToken: () => string;
  verifyPassword: (password: string, stored: string | null) => Promise<boolean>;
  needsRehash: (stored: string) => boolean;
  hashPassword: (password: string) => Promise<string>;
  logger: Logger;
};

export function createAuthDeps(logger: Logger): AuthDeps {
  return {
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    newToken: generateSessionToken,
    verifyPassword: verifyPasswordConstantCost,
    needsRehash,
    hashPassword,
    logger,
  };
}

export type LoginContext = {
  /** 接続元のキー（HMAC。生のIPは持ち込まない） */
  sourceKey: string;
  throttleKey: string;
  traceId: string;
  /** 要求に付いてきた、既存のセッションのトークン（固定化対策で失効させる） */
  previousSessionToken: string | null;
};

export type LoginInput = { loginId: string; password: string };

/** 第一要素を確認できた利用者。issueSession に渡す */
export type VerifiedUser = {
  user: { id: string; displayName: string };
  mustChangePassword: boolean;
  /** 検証したときのハッシュ。確定時にも一致するときだけセッションを作る */
  passwordHash: string;
  accountKey: string;
};

// どれが違うかを示さない文言（存在しない・無効・誤りで同じ）
const INVALID_CREDENTIALS_MESSAGE = "社員IDまたはパスワードが違います";
const RATE_LIMITED_MESSAGE = "しばらくしてから、もう一度お試しください";

/**
 * 接続元の受付枠を確保する。取れなければ 429（Retry-After の秒数つき）。ハッシュの計算・利用者の検索より前に呼ぶ。
 * 監査（D1）に残すのは、ロックに入った1回だけ。ロック中の拒否は、ログだけに残す。
 */
export async function admitSource(
  repository: AuthRepository,
  bucketType: SourceBucketType,
  sourceKey: string,
  context: { traceId: string },
  deps: Pick<AuthDeps, "now" | "logger">,
): Promise<void> {
  const now = deps.now();
  const slot = await repository.acquireSourceSlot(bucketType, sourceKey, now);
  if (slot.accepted) return;
  if (slot.lockedUntil === null) {
    throw new Error("受付枠の状態が正しくありません（ロックの解除時刻がない）");
  }
  if (slot.justLocked) {
    await repository.recordRateLimited({
      action:
        bucketType === "source" ? "auth.rate_limited" : "setup.rate_limited",
      traceId: context.traceId,
      now,
      lockedUntil: slot.lockedUntil,
    });
  }
  // 試行制限の発動は監査として記録する。D1 の監査ログに残すのは、ロックに入った1回だけ（上の recordRateLimited）
  deps.logger.audit(
    bucketType === "source" ? "auth.rate_limited" : "setup.rate_limited",
    bucketType,
    "failure",
    { justLocked: slot.justLocked },
  );
  throw new AppError("RATE_LIMITED", RATE_LIMITED_MESSAGE, {
    retryAfterSeconds: retryAfterSeconds(slot.lockedUntil, now),
  });
}

export async function verifyFirstFactor(
  repository: AuthRepository,
  input: LoginInput,
  context: LoginContext,
  deps: AuthDeps,
): Promise<VerifiedUser> {
  await admitSource(repository, "source", context.sourceKey, context, deps);

  const accountKey = await accountBucketKey(input.loginId, context.throttleKey);
  const throttle = await repository.readAccountThrottle(accountKey);
  const delay =
    throttle === null
      ? 0
      : accountDelayMs(throttle.failedCount, throttle.lastFailedAt, deps.now());
  if (delay > 0) await deps.sleep(delay);

  const found = await repository.findLoginUser(input.loginId);
  // 存在しない・無効な利用者も、保存値なし（null）で検証して、現行のダミーの計算を1回行う（時間差を作らない）
  const usable = found !== null && found.isActive ? found : null;
  const matched = await deps.verifyPassword(
    input.password,
    usable === null ? null : usable.passwordHash,
  );
  if (usable === null || !matched) {
    await repository.recordLoginFailure({
      accountKey,
      now: deps.now(),
      traceId: context.traceId,
      reason:
        found === null
          ? "unknown_user"
          : !found.isActive
            ? "inactive_user"
            : "wrong_password",
    });
    throw new AppError("INVALID_CREDENTIALS", INVALID_CREDENTIALS_MESSAGE);
  }
  return {
    user: { id: usable.id, displayName: usable.displayName },
    mustChangePassword: usable.mustChangePassword,
    passwordHash: usable.passwordHash,
    accountKey,
  };
}

export async function issueSession(
  repository: AuthRepository,
  verified: VerifiedUser,
  context: LoginContext,
  deps: AuthDeps,
): Promise<{ token: string }> {
  // 毎回新しいトークンを発行する（セッション固定化の対策）。同じ利用者の別のセッションは、そのまま残す
  const token = deps.newToken();
  const created = await repository.createSession({
    sessionId: await hashSessionToken(token),
    userId: verified.user.id,
    passwordHash: verified.passwordHash,
    previousSessionId:
      context.previousSessionToken === null
        ? null
        : await hashSessionToken(context.previousSessionToken),
    accountKey: verified.accountKey,
    now: deps.now(),
    traceId: context.traceId,
  });
  // 検証から確定までの間に、パスワードの変更・無効化があった
  if (!created)
    throw new AppError("INVALID_CREDENTIALS", INVALID_CREDENTIALS_MESSAGE);
  return { token };
}

export async function login(
  repository: AuthRepository,
  input: LoginInput,
  context: LoginContext,
  deps: AuthDeps,
): Promise<{
  user: { id: string; displayName: string };
  mustChangePassword: boolean;
  token: string;
}> {
  const verified = await verifyFirstFactor(repository, input, context, deps);
  const { token } = await issueSession(repository, verified, context, deps);
  await rehashIfNeeded(repository, verified, input.password, deps);
  return {
    user: verified.user,
    mustChangePassword: verified.mustChangePassword,
    token,
  };
}

/**
 * 現行のパラメータと違うハッシュは、ログインの成功後に作り直す（ADR-0007）。
 * 付随する後始末のため、失敗してもログインは成功のままにする。失敗は必ずログに残す（C-148）。
 */
async function rehashIfNeeded(
  repository: AuthRepository,
  verified: VerifiedUser,
  password: string,
  deps: AuthDeps,
): Promise<void> {
  if (!deps.needsRehash(verified.passwordHash)) return;
  try {
    const next = await deps.hashPassword(password);
    await repository.updatePasswordHashIfUnchanged(
      verified.user.id,
      verified.passwordHash,
      next,
    );
  } catch (error) {
    deps.logger.error("パスワードのハッシュの作り直しに失敗した", {
      error,
      userId: verified.user.id,
    });
  }
}

/** 提示されたセッションだけを失効させる。トークンがなければ何もしない（べき等）。DB の失敗は呼び出し元へ伝える */
export async function logout(
  repository: AuthRepository,
  input: { sessionToken: string | null; traceId: string },
  deps: Pick<AuthDeps, "now">,
): Promise<void> {
  if (input.sessionToken === null) return;
  await repository.revokeSession({
    sessionId: await hashSessionToken(input.sessionToken),
    now: deps.now(),
    traceId: input.traceId,
  });
}

/** 1回に消す件数 */
export const CLEANUP_BATCH_SIZE = 500;
// 件数が尽きないときに無限に繰り返さないための、1種類あたりの回数の上限（50,000件）
const CLEANUP_MAX_BATCHES = 100;

async function deleteAll(
  deleteBatch: () => Promise<number>,
  deps: Pick<AuthDeps, "logger">,
  label: string,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < CLEANUP_MAX_BATCHES; i += 1) {
    const deleted = await deleteBatch();
    total += deleted;
    if (deleted < CLEANUP_BATCH_SIZE) return total;
  }
  deps.logger.warn("掃除の回数の上限に達した。残りは次の実行で消す", {
    target: label,
    deleted: total,
  });
  return total;
}

/** 失効済み・期限切れのセッションと、古い試行制限の行を消す。DB の失敗は受け止めずに伝える */
export async function cleanupExpired(
  repository: AuthRepository,
  deps: Pick<AuthDeps, "now" | "logger">,
): Promise<{ sessions: number; loginAttempts: number }> {
  const now = deps.now();
  const sessions = await deleteAll(
    () => repository.deleteExpiredSessions(now, CLEANUP_BATCH_SIZE),
    deps,
    "sessions",
  );
  const loginAttempts = await deleteAll(
    () => repository.deleteExpiredLoginAttempts(now, CLEANUP_BATCH_SIZE),
    deps,
    "login_attempts",
  );
  return { sessions, loginAttempts };
}

/** 毎日 UTC 18:17（日本時間 03:17）に掃除する Cron のジョブ。wrangler.jsonc の triggers.crons と同じ式 */
export function authCleanupJob(withAuth: WithAuth): CronJob {
  return {
    cron: "17 18 * * *",
    name: "auth-cleanup",
    run: async (env) => {
      const logger = createLogger();
      logger.info("auth-cleanup：期限切れのセッションと試行制限の掃除を開始");
      const deleted = await withAuth(env, (repository) =>
        cleanupExpired(repository, { now: () => new Date(), logger }),
      );
      // 項目名に session などの語を含めると、ロガーの伏せ字（REDACT_KEYS）に当たって件数が見えなくなるため、別の名前にする
      logger.info("auth-cleanup：掃除を終了", {
        deletedLoginRows: deleted.sessions,
        deletedAttemptRows: deleted.loginAttempts,
      });
    },
  };
}
