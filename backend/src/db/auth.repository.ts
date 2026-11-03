// Repository：ログイン・ログアウト・試行制限・掃除（sessions・login_attempts・users・audit_logs）。DB へのアクセスはこの層に閉じ込める。
// 複数の表にまたがる更新は、1つの db.batch で同時に確定する。受付枠の確保は UPSERT ... RETURNING の1文で原子的に行う（並行しても数え落とさない）。
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { loginAttempts, sessions, users } from "../../db/schema";
import type { AuditAction } from "../lib/audit-actions";
import { SESSION_IDLE_MS, SESSION_MAX_AGE_MS } from "../lib/session-policy";
import {
  ACCOUNT_RESET_MS,
  SOURCE_LIMIT,
  SOURCE_LOCK_MS,
  SOURCE_WINDOW_MS,
} from "../lib/throttle-policy";
import {
  auditLogInsert,
  auditLogInsertForSession,
} from "./audit-log.repository";
import type { BatchItem, Database } from "./database";

/** 1日。試行制限の行は、最後の更新からこの時間がたったら消す（D-3） */
const LOGIN_ATTEMPT_RETENTION_MS = 24 * 60 * 60_000;

export type LoginUser = {
  id: string;
  displayName: string;
  passwordHash: string;
  isActive: boolean;
  mustChangePassword: boolean;
};

export type SourceBucketType = "source" | "setup_source";

export type SourceSlot = {
  /** 受け付けたか。false なら lockedUntil に解除の時刻が入る */
  accepted: boolean;
  lockedUntil: string | null;
  /** この受付でロックに入ったか（監査に残すのは、この1回だけ） */
  justLocked: boolean;
};

export type AccountThrottle = {
  failedCount: number;
  lastFailedAt: string | null;
};

export type LoginFailureReason =
  "unknown_user" | "inactive_user" | "wrong_password";

export type AuthRepository = {
  /** 接続元の受付枠を確保する（受付数を1つ増やす。成功も数える）。ハッシュの計算より前に呼ぶ */
  acquireSourceSlot(
    bucketType: SourceBucketType,
    bucketKey: string,
    now: Date,
  ): Promise<SourceSlot>;
  /** ロックに入ったことを監査に残す */
  recordRateLimited(input: {
    action: Extract<AuditAction, "auth.rate_limited" | "setup.rate_limited">;
    traceId: string;
    now: Date;
    lockedUntil: string;
  }): Promise<void>;
  readAccountThrottle(accountKey: string): Promise<AccountThrottle | null>;
  findLoginUser(loginId: string): Promise<LoginUser | null>;
  /** 社員IDの失敗数を1増やし、監査 auth.login（failure）を同時に残す */
  recordLoginFailure(input: {
    accountKey: string;
    now: Date;
    traceId: string;
    reason: LoginFailureReason;
  }): Promise<void>;
  /**
   * 検証時のパスワードのハッシュと有効状態が、確定時にも一致するときだけセッションを作る（作ったら true）。
   * 同じ確定で、監査 auth.login（success）・古いセッションの失効・社員IDの失敗数のリセットを行う。
   */
  createSession(input: {
    sessionId: string;
    userId: string;
    passwordHash: string;
    previousSessionId: string | null;
    accountKey: string;
    now: Date;
    traceId: string;
  }): Promise<boolean>;
  /** 保存中のハッシュが previousHash のままのときだけ置き換える（並行したパスワードの変更を上書きしない） */
  updatePasswordHashIfUnchanged(
    userId: string,
    previousHash: string,
    nextHash: string,
  ): Promise<boolean>;
  /** そのセッションを失効させ、監査 auth.logout を同時に残す。失効済み・存在しないときは何も変えない */
  revokeSession(input: {
    sessionId: string;
    now: Date;
    traceId: string;
  }): Promise<void>;
  /** 失効済み・期限切れのセッションを、limit 件まで消す。消した件数を返す */
  deleteExpiredSessions(now: Date, limit: number): Promise<number>;
  /** 最後の更新から1日たち、ロック中でない試行制限の行を、limit 件まで消す。消した件数を返す */
  deleteExpiredLoginAttempts(now: Date, limit: number): Promise<number>;
};

const slotRowSchema = z.object({
  attempt_count: z.number(),
  locked_until: z.string().nullable(),
});

const isoBefore = (now: Date, ms: number) =>
  new Date(now.getTime() - ms).toISOString();

export function createAuthRepository(db: Database): AuthRepository {
  return {
    async acquireSourceSlot(bucketType, bucketKey, now) {
      const nowIso = now.toISOString();
      const lockUntil = new Date(now.getTime() + SOURCE_LOCK_MS).toISOString();
      const windowCutoff = isoBefore(now, SOURCE_WINDOW_MS);
      // 状態：ロック中（locked_until が未来）／数え直し（ロックが過ぎた・窓が過ぎた）／窓の中。
      // ロック中も受付数を増やす：ロックに入った受付（上限+1回目）だけを、並行しても1件に特定するため
      const locked = sql`(locked_until IS NOT NULL AND locked_until > ${nowIso})`;
      const restart = sql`(locked_until IS NOT NULL OR window_started_at <= ${windowCutoff})`;
      const rows = await db.all(sql`
        INSERT INTO login_attempts (bucket_type, bucket_key, attempt_count, window_started_at, locked_until, updated_at)
        VALUES (${bucketType}, ${bucketKey}, 1, ${nowIso}, NULL, ${nowIso})
        ON CONFLICT (bucket_type, bucket_key) DO UPDATE SET
          attempt_count = CASE WHEN ${locked} THEN attempt_count + 1 WHEN ${restart} THEN 1 ELSE attempt_count + 1 END,
          window_started_at = CASE WHEN ${locked} THEN window_started_at WHEN ${restart} THEN ${nowIso} ELSE window_started_at END,
          locked_until = CASE WHEN ${locked} THEN locked_until WHEN ${restart} THEN NULL WHEN attempt_count + 1 > ${SOURCE_LIMIT} THEN ${lockUntil} ELSE NULL END,
          updated_at = ${nowIso}
        RETURNING attempt_count, locked_until`);
      const row = slotRowSchema.parse(rows[0]);
      if (row.locked_until === null)
        return { accepted: true, lockedUntil: null, justLocked: false };
      return {
        accepted: false,
        lockedUntil: row.locked_until,
        justLocked: row.attempt_count === SOURCE_LIMIT + 1,
      };
    },

    async recordRateLimited(input) {
      await auditLogInsert(db, {
        actorId: null,
        action: input.action,
        targetType: "source",
        targetId: null,
        result: "failure",
        traceId: input.traceId,
        detail: { lockedUntil: input.lockedUntil },
      });
    },

    async readAccountThrottle(accountKey) {
      const rows = await db
        .select({
          failedCount: loginAttempts.failedCount,
          lastFailedAt: loginAttempts.lastFailedAt,
        })
        .from(loginAttempts)
        .where(
          and(
            eq(loginAttempts.bucketType, "account"),
            eq(loginAttempts.bucketKey, accountKey),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (row === undefined) return null;
      return {
        failedCount: row.failedCount ?? 0,
        lastFailedAt: row.lastFailedAt,
      };
    },

    async findLoginUser(loginId) {
      const rows = await db
        .select({
          id: users.id,
          displayName: users.displayName,
          passwordHash: users.passwordHash,
          isActive: users.isActive,
          mustChangePassword: users.mustChangePassword,
        })
        .from(users)
        .where(eq(users.loginIdNormalized, loginId.toLowerCase()))
        .limit(1);
      return rows[0] ?? null;
    },

    async recordLoginFailure(input) {
      const nowIso = input.now.toISOString();
      // 最後の失敗から15分たっていれば、1から数え直す
      const resetCutoff = isoBefore(input.now, ACCOUNT_RESET_MS);
      await db.batch([
        db
          .insert(loginAttempts)
          .values({
            bucketType: "account",
            bucketKey: input.accountKey,
            failedCount: 1,
            lastFailedAt: nowIso,
            updatedAt: nowIso,
          })
          .onConflictDoUpdate({
            target: [loginAttempts.bucketType, loginAttempts.bucketKey],
            set: {
              failedCount: sql`CASE WHEN ${loginAttempts.lastFailedAt} IS NULL OR ${loginAttempts.lastFailedAt} <= ${resetCutoff} THEN 1 ELSE coalesce(${loginAttempts.failedCount}, 0) + 1 END`,
              lastFailedAt: nowIso,
              updatedAt: nowIso,
            },
          }),
        auditLogInsert(db, {
          actorId: null,
          action: "auth.login",
          targetType: "user",
          targetId: null,
          result: "failure",
          traceId: input.traceId,
          detail: { reason: input.reason },
        }),
      ]);
    },

    async createSession(input) {
      const nowIso = input.now.toISOString();
      const created = sql`EXISTS (SELECT 1 FROM sessions WHERE id = ${input.sessionId})`;
      const statements: BatchItem[] = [
        db
          .insert(sessions)
          .select(
            sql`SELECT ${input.sessionId}, u.id, ${nowIso}, ${nowIso}, NULL, NULL FROM users u WHERE u.id = ${input.userId} AND u.password_hash = ${input.passwordHash} AND u.is_active = 1`,
          )
          .returning({ id: sessions.id }),
        auditLogInsertForSession(db, {
          sessionId: input.sessionId,
          requireActive: false,
          action: "auth.login",
          traceId: input.traceId,
        }),
        db
          .delete(loginAttempts)
          .where(
            and(
              eq(loginAttempts.bucketType, "account"),
              eq(loginAttempts.bucketKey, input.accountKey),
              created,
            ),
          ),
      ];
      if (input.previousSessionId !== null) {
        statements.push(
          db
            .update(sessions)
            .set({ revokedAt: nowIso })
            .where(
              and(
                eq(sessions.id, input.previousSessionId),
                isNull(sessions.revokedAt),
                created,
              ),
            ),
        );
      }
      const [inserted] = await db.batch(
        statements as [BatchItem, ...BatchItem[]],
      );
      return Array.isArray(inserted) && inserted.length === 1;
    },

    async updatePasswordHashIfUnchanged(userId, previousHash, nextHash) {
      const result = await db
        .update(users)
        .set({ passwordHash: nextHash })
        .where(and(eq(users.id, userId), eq(users.passwordHash, previousHash)))
        .run();
      return result.meta.changes > 0;
    },

    async revokeSession(input) {
      // 監査は、失効の前の状態（有効）を条件にするため、更新より先に入れる
      await db.batch([
        auditLogInsertForSession(db, {
          sessionId: input.sessionId,
          requireActive: true,
          action: "auth.logout",
          traceId: input.traceId,
        }),
        db
          .update(sessions)
          .set({ revokedAt: input.now.toISOString() })
          .where(
            and(eq(sessions.id, input.sessionId), isNull(sessions.revokedAt)),
          ),
      ]);
    },

    async deleteExpiredSessions(now, limit) {
      const result = await db.run(sql`
        DELETE FROM sessions WHERE id IN (
          SELECT id FROM sessions
          WHERE revoked_at IS NOT NULL
            OR created_at <= ${isoBefore(now, SESSION_MAX_AGE_MS)}
            OR last_active_at <= ${isoBefore(now, SESSION_IDLE_MS)}
          LIMIT ${limit})`);
      return result.meta.changes;
    },

    async deleteExpiredLoginAttempts(now, limit) {
      const result = await db.run(sql`
        DELETE FROM login_attempts WHERE rowid IN (
          SELECT rowid FROM login_attempts
          WHERE (locked_until IS NULL OR locked_until <= ${now.toISOString()})
            AND updated_at <= ${isoBefore(now, LOGIN_ATTEMPT_RETENTION_MS)}
          LIMIT ${limit})`);
      return result.meta.changes;
    },
  };
}

/** Repository を使う間だけ DB につなぐ。接続のファイルは、使うときに初めて読み込む（setup.repository.ts と同じ） */
export async function withAuth<T>(
  env: Env,
  run: (repository: AuthRepository) => Promise<T>,
): Promise<T> {
  const { withDatabase } = await import("./database");
  return withDatabase(env, (db) => run(createAuthRepository(db)));
}
