// Repository：セッション（sessions）の読み取りと失効（ADR-0003）。ログイン・ログアウト・掃除は auth.repository.ts。
// 失効の文は、文を返すだけで実行しない：業務の更新・監査と同じ db.batch([...]) に入れる（呼び出し元は #123・#127・無効化のIssue）。
import { and, eq, isNull, ne, type SQL } from "drizzle-orm";
import { sessions, users } from "../../db/schema";
import type { Database } from "./database";

export type SessionRecord = {
  userId: string;
  displayName: string;
  loginId: string;
  mustChangePassword: boolean;
  reauthenticatedAt: string | null;
  isActive: boolean;
  createdAt: string;
  lastActiveAt: string;
  revokedAt: string | null;
};

export type SessionRepository = {
  /** セッションのIDで、セッションと利用者を探す。期限の判定は Service に任せる */
  findSession(sessionId: string): Promise<SessionRecord | null>;
  /** 最終操作の時刻を now にする。読んだ時刻のままのときだけ更新し（並行の更新を上書きしない）、更新したら true */
  touchSession(
    sessionId: string,
    expectedLastActiveAt: string,
    now: Date,
  ): Promise<boolean>;
};

export function createSessionRepository(db: Database): SessionRepository {
  return {
    async findSession(sessionId) {
      const rows = await db
        .select({
          userId: sessions.userId,
          displayName: users.displayName,
          loginId: users.loginId,
          mustChangePassword: users.mustChangePassword,
          reauthenticatedAt: sessions.reauthenticatedAt,
          isActive: users.isActive,
          createdAt: sessions.createdAt,
          lastActiveAt: sessions.lastActiveAt,
          revokedAt: sessions.revokedAt,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(eq(sessions.id, sessionId))
        .limit(1);
      return rows[0] ?? null;
    },
    async touchSession(sessionId, expectedLastActiveAt, now) {
      const result = await db
        .update(sessions)
        .set({ lastActiveAt: now.toISOString() })
        .where(
          and(
            eq(sessions.id, sessionId),
            eq(sessions.lastActiveAt, expectedLastActiveAt),
          ),
        )
        .run();
      return result.meta.changes > 0;
    },
  };
}

/** その利用者の有効なセッションをすべて失効させる文（パスワードの変更・利用者の無効化などが使う） */
export function revokeAllForUserStatement(
  db: Pick<Database, "update">,
  userId: string,
  now: string,
) {
  return db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

/** 現在のセッションを除いて、その利用者の有効なセッションを失効させる文 */
export function revokeOthersForUserStatement(
  db: Pick<Database, "update">,
  userId: string,
  currentSessionId: string,
  now: string,
  onlyWhen?: SQL,
) {
  return db
    .update(sessions)
    .set({ revokedAt: now })
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        ne(sessions.id, currentSessionId),
        onlyWhen,
      ),
    );
}

/** Repository を使う間だけ DB につなぐ。接続のファイルは、使うときに初めて読み込む（setup.repository.ts と同じ） */
export async function withSessions<T>(
  env: Env,
  run: (repository: SessionRepository) => Promise<T>,
): Promise<T> {
  const { withDatabase } = await import("./database");
  return withDatabase(env, (db) => run(createSessionRepository(db)));
}
