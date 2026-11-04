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
  userId: string;
  displayName: string;
  mustChangePassword: boolean;
};

/**
 * トークンから、ログイン中の利用者を求める。失効・期限切れ・無効化された利用者・存在しないトークンは null。
 * 最終操作の時刻の更新は1分に間引く。更新に失敗しても認証の結果は変えず、警告をログに残す。
 * DB の読み取りの失敗は、受け止めずに伝える（認証できないことと、確かめられないことを区別する）。
 */
export async function resolveSession(
  repository: SessionRepository,
  token: string,
  deps: { now: () => Date; logger: Logger },
): Promise<SessionPrincipal | null> {
  const sessionId = await hashSessionToken(token);
  const session = await repository.findSession(sessionId);
  const now = deps.now();
  if (session === null || !session.isActive || isSessionExpired(session, now))
    return null;

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
    userId: session.userId,
    displayName: session.displayName,
    mustChangePassword: session.mustChangePassword,
  };
}
