// Service：セッションの検証（読み取り時に期限を判定する。ADR-0003・0-2 AC-5）。HTTP（Hono）も DB のライブラリも知らない。
import type { SessionRepository } from "../db/session.repository";
import type { Logger } from "../lib/logger/logger";
import {
  isSessionExpired,
  SESSION_TOUCH_INTERVAL_MS,
} from "../lib/session-policy";
import { hashSessionToken } from "../lib/session-token";

/** Repository を使う間だけ DB につなぐ処理。Workers の入口（index.ts）が本物を渡し、テストが差し替える */
export type WithSessions = <T>(
  env: Env,
  run: (repository: SessionRepository) => Promise<T>,
) => Promise<T>;

export type SessionPrincipal = {
  /** セッションの ID（トークンの SHA-256）。書き込みの条件（セッションが今も有効）に使うだけで、応答・ログには出さない */
  sessionId: string;
  userId: string;
  displayName: string;
  loginId: string;
  mustChangePassword: boolean;
  reauthenticatedAt: string | null;
};

/** 画面の想定する利用者と、セッションの利用者が食い違った（#298）。利用者の情報は含めない */
export type SessionUserMismatch = { mismatch: true };

/**
 * トークンから、ログイン中の利用者を求める。失効・期限切れ・無効化された利用者・存在しないトークンは null。
 * expectedUserId（画面の想定する利用者）が渡され、有効なセッションの利用者と文字列として完全に一致しないときは、
 * 最終操作の時刻を更新せずに { mismatch: true } を返す（期限・失効の判定より後）。値は断る向きにだけ使い、利用者の特定には使わない。
 * 最終操作の時刻の更新は1分に間引く。更新に失敗しても認証の結果は変えず、警告をログに残す。
 * DB の読み取りの失敗は、受け止めずに伝える（認証できないことと、確かめられないことを区別する）。
 */
export async function resolveSession(
  repository: SessionRepository,
  token: string,
  deps: { now: () => Date; logger: Logger },
  expectedUserId?: string,
): Promise<SessionPrincipal | SessionUserMismatch | null> {
  const sessionId = await hashSessionToken(token);
  const session = await repository.findSession(sessionId);
  const now = deps.now();
  if (session === null || !session.isActive || isSessionExpired(session, now))
    return null;
  if (expectedUserId !== undefined && expectedUserId !== session.userId)
    return { mismatch: true };

  if (
    now.getTime() - new Date(session.lastActiveAt).getTime() >=
    SESSION_TOUCH_INTERVAL_MS
  ) {
    try {
      await repository.touchSession(sessionId, session.lastActiveAt, now);
    } catch (error) {
      deps.logger.warn("セッションの最終操作の時刻を更新できなかった", {
        error,
      });
    }
  }
  return {
    sessionId,
    userId: session.userId,
    displayName: session.displayName,
    loginId: session.loginId,
    mustChangePassword: session.mustChangePassword,
    reauthenticatedAt: session.reauthenticatedAt,
  };
}
