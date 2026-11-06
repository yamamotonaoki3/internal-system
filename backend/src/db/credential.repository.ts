// Repository：認証情報の条件付き確定。全副作用を同じ D1 batch に入れる。
import { and, eq, isNull, sql } from "drizzle-orm";
import { loginAttempts, sessions, users } from "../../db/schema";
import { SESSION_IDLE_MS, SESSION_MAX_AGE_MS } from "../lib/session-policy";
import { ACCOUNT_RESET_MS } from "../lib/throttle-policy";
import { auditLogInsert } from "./audit-log.repository";
import { createAuthRepository } from "./auth.repository";
import type { BatchItem, Database } from "./database";
import { revokeOthersForUserStatement } from "./session.repository";

type ConfirmInput = {
  userId: string;
  sessionId: string;
  passwordHash: string;
  accountKey: string;
  traceId: string;
  now: Date;
};

type ChangeInput = ConfirmInput & { newPasswordHash: string };

function sessionCondition(input: ConfirmInput) {
  const idleCutoff = new Date(
    input.now.getTime() - SESSION_IDLE_MS,
  ).toISOString();
  const ageCutoff = new Date(
    input.now.getTime() - SESSION_MAX_AGE_MS,
  ).toISOString();
  return sql`EXISTS (
    SELECT 1 FROM sessions s WHERE s.id = ${input.sessionId}
      AND s.user_id = ${input.userId} AND s.revoked_at IS NULL
      AND s.last_active_at > ${idleCutoff} AND s.created_at > ${ageCutoff}
  )`;
}

export function createCredentialRepository(db: Database) {
  const auth = createAuthRepository(db);
  return {
    ...auth,

    async findCredential(userId: string) {
      const rows = await db
        .select({
          id: users.id,
          loginId: users.loginId,
          displayName: users.displayName,
          passwordHash: users.passwordHash,
          isActive: users.isActive,
          mustChangePassword: users.mustChangePassword,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return rows[0] ?? null;
    },

    async recordCredentialFailure(input: {
      accountKey: string;
      now: Date;
      traceId: string;
      action: "auth.password_change" | "auth.reauthenticate";
    }): Promise<void> {
      const nowIso = input.now.toISOString();
      const resetCutoff = new Date(
        input.now.getTime() - ACCOUNT_RESET_MS,
      ).toISOString();
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
          action: input.action,
          targetType: "user",
          targetId: null,
          result: "failure",
          traceId: input.traceId,
          detail: { reason: "wrong_password" },
        }),
      ]);
    },

    async changePassword(input: ChangeInput): Promise<boolean> {
      const nowIso = input.now.toISOString();
      const validSession = sessionCondition(input);
      const updated = db
        .update(users)
        .set({ passwordHash: input.newPasswordHash, mustChangePassword: false })
        .where(
          and(
            eq(users.id, input.userId),
            eq(users.passwordHash, input.passwordHash),
            eq(users.isActive, true),
            validSession,
          ),
        )
        .returning({ id: users.id });
      // 新ハッシュは要求ごとに異なるsaltで作るため、このbatchの更新成功の証跡になる。
      const changed = sql`EXISTS (
        SELECT 1 FROM users u WHERE u.id = ${input.userId}
          AND u.password_hash = ${input.newPasswordHash} AND u.is_active = 1
      )`;
      const statements: [BatchItem, ...BatchItem[]] = [
        updated,
        revokeOthersForUserStatement(
          db,
          input.userId,
          input.sessionId,
          nowIso,
          changed,
        ),
        auditLogInsert(
          db,
          {
            actorId: input.userId,
            action: "auth.password_change",
            targetType: "user",
            targetId: input.userId,
            result: "success",
            traceId: input.traceId,
          },
          { onlyWhen: changed },
        ),
        db
          .delete(loginAttempts)
          .where(
            and(
              eq(loginAttempts.bucketType, "account"),
              eq(loginAttempts.bucketKey, input.accountKey),
              changed,
            ),
          ),
      ];
      const [result] = await db.batch(statements);
      return Array.isArray(result) && result.length === 1;
    },

    async reauthenticate(input: ConfirmInput): Promise<boolean> {
      const nowIso = input.now.toISOString();
      const validSession = sessionCondition(input);
      const validUser = sql`EXISTS (
        SELECT 1 FROM users u WHERE u.id = ${input.userId}
          AND u.password_hash = ${input.passwordHash} AND u.is_active = 1
      )`;
      // 同じ時刻の再要求でも敗者の監査を残さないため、確定前の時刻を条件に含める。
      const unconfirmed = sql`EXISTS (
        SELECT 1 FROM sessions s WHERE s.id = ${input.sessionId}
          AND s.reauthenticated_at IS NOT ${nowIso}
      )`;
      const admitted = sql`${validSession} AND ${validUser} AND ${unconfirmed}`;
      const statements: [BatchItem, ...BatchItem[]] = [
        auditLogInsert(
          db,
          {
            actorId: input.userId,
            action: "auth.reauthenticate",
            targetType: "user",
            targetId: input.userId,
            result: "success",
            traceId: input.traceId,
          },
          { onlyWhen: admitted },
        ),
        db
          .delete(loginAttempts)
          .where(
            and(
              eq(loginAttempts.bucketType, "account"),
              eq(loginAttempts.bucketKey, input.accountKey),
              admitted,
            ),
          ),
        db
          .update(sessions)
          .set({ reauthenticatedAt: nowIso })
          .where(
            and(
              eq(sessions.id, input.sessionId),
              eq(sessions.userId, input.userId),
              isNull(sessions.revokedAt),
              sql`${sessions.reauthenticatedAt} IS NOT ${nowIso}`,
              validSession,
              validUser,
            ),
          )
          .returning({ id: sessions.id }),
      ];
      const result = await db.batch(statements);
      const updated = result[2];
      return Array.isArray(updated) && updated.length === 1;
    },
  };
}

export type CredentialRepository = ReturnType<
  typeof createCredentialRepository
>;

export async function withCredentials<T>(
  env: Env,
  run: (repository: CredentialRepository) => Promise<T>,
): Promise<T> {
  const { withDatabase } = await import("./database");
  return withDatabase(env, (db) => run(createCredentialRepository(db)));
}
