// 監査ログの書き込み（AC-3）。文を返すだけで実行しない：業務の更新と同じ db.batch([...]) に入れて、同時に確定・失敗させる。
import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { alias } from "drizzle-orm/sqlite-core";
import {
  auditLogs,
  channels,
  clients,
  departments,
  sessions,
  userRoleAssignments,
  users,
} from "../../db/schema";
import type { AuditAction } from "../lib/audit-actions";
import { afterCursor, toPage, type CursorPayload } from "../lib/cursor";
import { redact } from "../lib/logger/logger";
import { ROLE_IDS } from "../lib/permissions";
import { SESSION_IDLE_MS, SESSION_MAX_AGE_MS } from "../lib/session-policy";
import { newUlid, type Ulid } from "../lib/ulid";
import { withDatabase, type Database } from "./database";

/**
 * detail に入れてよいもの：件数、変更前後の識別子・状態、失敗の分類、文字数など、変更の概要。入れ子にしない。
 * 入れてはいけないもの：本文、氏名、メール、電話、CSVの行の値、秘密情報。
 * redact() は項目名による保険であり、個人情報を取り除く仕組みではない。
 */
export type AuditDetail = Record<string, string | number | boolean | null>;

export type AuditLogInput<A extends string = AuditAction> = {
  /** 操作者。ログイン失敗など不明な場合は null */
  actorId: string | null;
  action: A;
  targetType: string;
  targetId: string | null;
  result: "success" | "failure";
  traceId: string;
  detail?: AuditDetail;
};

export function auditLogInsert<A extends string = AuditAction>(
  db: Pick<DrizzleD1Database<Record<string, never>>, "insert">,
  input: AuditLogInput<A>,
  deps: { newId?: () => Ulid; onlyWhen?: SQL } = {},
) {
  const row = {
    id: (deps.newId ?? newUlid)(),
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    result: input.result,
    traceId: input.traceId,
    detail:
      input.detail === undefined ? null : JSON.stringify(redact(input.detail)),
  };
  if (deps.onlyWhen === undefined) return db.insert(auditLogs).values(row);
  return db.insert(auditLogs).select(sql`
    SELECT ${row.id}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      ${row.actorId}, ${row.action}, ${row.targetType}, ${row.targetId},
      ${row.result}, ${row.traceId}, ${row.detail}
    WHERE ${deps.onlyWhen}`);
}

/**
 * セッションの利用者を操作者・対象として記録する、条件付きの書き込み（ログインの成功・ログアウト）。
 * 該当するセッションがあるときだけ書く（requireActive のときは、失効前のセッションだけ）。
 * セッションの作成・失効と同じ db.batch に入れると、セッションが変わったときだけ監査が残る。
 */
export function auditLogInsertForSession(
  db: Pick<DrizzleD1Database<Record<string, never>>, "insert">,
  input: {
    sessionId: string;
    requireActive: boolean;
    action: AuditAction;
    traceId: string;
    detail?: AuditDetail;
  },
  deps: { newId?: () => Ulid } = {},
) {
  const detail =
    input.detail === undefined ? null : JSON.stringify(redact(input.detail));
  const active = input.requireActive ? sql` AND s.revoked_at IS NULL` : sql``;
  // 列は audit_logs の定義の順（id, occurred_at, actor_id, action, target_type, target_id, result, trace_id, detail）
  return db.insert(auditLogs).select(sql`
    SELECT ${(deps.newId ?? newUlid)()}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), s.user_id, ${input.action}, 'user', s.user_id, 'success', ${input.traceId}, ${detail}
    FROM sessions s WHERE s.id = ${input.sessionId}${active}`);
}

// 監査ログの閲覧（#156・0-6）。読み取りと、閲覧の記録（audit_log.view）の書き込みを、同じ db.batch で行う。
// 閲覧の資格（セッション・利用者・全体管理者のロール）は、記録の onlyWhen と一覧の SELECT の WHERE に同じ SQL で入れる。
// 確定の時点で資格がなければ、記録も行も0になり、記録を回避した閲覧はできない（#196 の方式）。

/** 閲覧の資格が、判定の後に崩れて、閲覧の記録が0行だったときに投げる。何も残らない */
export class AuditLogViewStateChangedError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("閲覧の前提が変わったため、監査ログを取得できませんでした", options);
    this.name = "AuditLogViewStateChangedError";
  }
}

/** 一覧の1行。本名・メール・社員ID・trace_id は選ばない。detail は JSON の文字列のまま（取り出しは Service） */
export type AuditLogRow = {
  id: string;
  occurredAt: string;
  action: string;
  result: string;
  actorId: string | null;
  actorName: string | null;
  actorIsActive: boolean | null;
  targetType: string;
  targetId: string | null;
  targetName: string | null;
  targetIsActive: boolean | null;
  detail: string | null;
};

export type AuditLogViewer = {
  userId: string;
  sessionId: string;
  traceId: string;
};

export type AuditLogFilter = {
  /** JST の日付（YYYY-MM-DD）。その日の 00:00 JST 以降 */
  from?: string;
  /** JST の日付（YYYY-MM-DD）。その日の終わりまで */
  to?: string;
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  result?: "success" | "failure";
};

export type AuditLogSearchInput = {
  viewer: AuditLogViewer;
  /** 資格の判定に使う時刻（Service がミドルウェアと同じ時計で渡す） */
  now: Date;
  filter: AuditLogFilter;
  cursor?: CursorPayload;
  limit: number;
};

/** 読み直し用の、閲覧する人の事実 */
export type AuditLogViewerFacts = {
  session: {
    userId: string;
    createdAt: string;
    lastActiveAt: string;
    revokedAt: string | null;
  } | null;
  isUserActive: boolean;
  isGlobalAdmin: boolean;
};

const JST_OFFSET = "+09:00";
const DAY_MS = 24 * 60 * 60_000;

/** JST の日の始まりを、occurred_at と同じ形式（UTC の ISO 8601）にする */
const jstDayStart = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00.000${JST_OFFSET}`)).toISOString();

/** JST の日の翌日の始まり（その日の終わりを含めるための、含めない側の境界） */
const jstNextDayStart = (date: string) =>
  new Date(
    Date.parse(`${date}T00:00:00.000${JST_OFFSET}`) + DAY_MS,
  ).toISOString();

/**
 * 閲覧の資格が、いまも成り立っていること。最初の判定（session.service の resolveSession・session-policy の isSessionExpired・
 * permission-resolver）と同じ条件で、期限は「ちょうど」で切れる。記録と一覧の SELECT の両方で、この1つの関数を使う。
 */
function viewerStillAllowed(viewer: AuditLogViewer, now: Date): SQL {
  const idleCutoff = new Date(now.getTime() - SESSION_IDLE_MS).toISOString();
  const maxAgeCutoff = new Date(
    now.getTime() - SESSION_MAX_AGE_MS,
  ).toISOString();
  return sql`EXISTS (SELECT 1 FROM sessions s WHERE s.id = ${viewer.sessionId} AND s.user_id = ${viewer.userId} AND s.revoked_at IS NULL AND s.last_active_at > ${idleCutoff} AND s.created_at > ${maxAgeCutoff})
    AND EXISTS (SELECT 1 FROM users u WHERE u.id = ${viewer.userId} AND u.is_active = 1)
    AND EXISTS (SELECT 1 FROM user_role_assignments r WHERE r.user_id = ${viewer.userId} AND r.role_id = ${ROLE_IDS.globalAdmin} AND r.scope_type = 'company')`;
}

/** 閲覧の記録の detail。入れ子にしない。絞り込みの操作者・対象の ID は入れず、種類と有無だけにする */
function viewDetail(input: AuditLogSearchInput): AuditDetail {
  const { filter } = input;
  return {
    page: input.cursor === undefined ? "first" : "next",
    filterAction: filter.action ?? null,
    filterResult: filter.result ?? null,
    filterTargetType: filter.targetType ?? null,
    hasActor: filter.actorId !== undefined,
    hasTarget: filter.targetId !== undefined,
    from: filter.from ?? null,
    to: filter.to ?? null,
  };
}

export function createAuditLogReader(db: Database) {
  const actorUser = alias(users, "actor_user");
  const targetUser = alias(users, "target_user");

  return {
    /**
     * 閲覧の記録を書いて、一覧を読む（同じ db.batch）。資格がなく記録が0行なら AuditLogViewStateChangedError。
     * 名前の解決は結合1回で行う（N+1 にしない）。legal_name・email・login_id・trace_id は選ばず、messages は結合しない。
     */
    async search(
      input: AuditLogSearchInput,
    ): Promise<{ items: AuditLogRow[]; nextCursor: string | null }> {
      const { viewer, filter, cursor, limit } = input;
      const allowed = viewerStillAllowed(viewer, input.now);
      const conditions: (SQL | undefined)[] = [
        allowed,
        filter.from === undefined
          ? undefined
          : gte(auditLogs.occurredAt, jstDayStart(filter.from)),
        filter.to === undefined
          ? undefined
          : lt(auditLogs.occurredAt, jstNextDayStart(filter.to)),
        filter.actorId === undefined
          ? undefined
          : eq(auditLogs.actorId, filter.actorId),
        filter.action === undefined
          ? undefined
          : eq(auditLogs.action, filter.action),
        filter.targetType === undefined
          ? undefined
          : eq(auditLogs.targetType, filter.targetType),
        filter.targetId === undefined
          ? undefined
          : eq(auditLogs.targetId, filter.targetId),
        filter.result === undefined
          ? undefined
          : eq(auditLogs.result, filter.result),
        cursor === undefined
          ? undefined
          : afterCursor(
              { sort: auditLogs.occurredAt, id: auditLogs.id },
              cursor,
              "desc",
            ),
      ];
      const [recorded, rows] = await db.batch([
        auditLogInsert(
          db,
          {
            actorId: viewer.userId,
            action: "audit_log.view",
            targetType: "audit_log",
            targetId: null,
            result: "success",
            traceId: viewer.traceId,
            detail: viewDetail(input),
          },
          { onlyWhen: allowed },
        ).returning({ id: auditLogs.id }),
        db
          .select({
            id: auditLogs.id,
            occurredAt: auditLogs.occurredAt,
            action: auditLogs.action,
            result: auditLogs.result,
            actorId: auditLogs.actorId,
            actorName: actorUser.displayName,
            // D1 の batch は列名のオブジェクトで結果を返すため、同じ列名（is_active）が2つあると値が入れ替わる。別名を付ける
            actorIsActive: sql<boolean | null>`${actorUser.isActive}`
              .mapWith(actorUser.isActive)
              .as("actor_is_active"),
            targetType: auditLogs.targetType,
            targetId: auditLogs.targetId,
            targetName: sql<
              string | null
            >`coalesce(${targetUser.displayName}, ${departments.name}, ${clients.name}, ${channels.name})`,
            targetIsActive: sql<boolean | null>`${targetUser.isActive}`
              .mapWith(targetUser.isActive)
              .as("target_is_active"),
            detail: auditLogs.detail,
          })
          .from(auditLogs)
          .leftJoin(actorUser, eq(actorUser.id, auditLogs.actorId))
          .leftJoin(
            targetUser,
            and(
              eq(auditLogs.targetType, "user"),
              eq(targetUser.id, auditLogs.targetId),
            ),
          )
          .leftJoin(
            departments,
            and(
              eq(auditLogs.targetType, "department"),
              eq(departments.id, auditLogs.targetId),
            ),
          )
          .leftJoin(
            clients,
            and(
              eq(auditLogs.targetType, "client"),
              eq(clients.id, auditLogs.targetId),
            ),
          )
          .leftJoin(
            channels,
            and(
              eq(auditLogs.targetType, "channel"),
              eq(channels.roomId, auditLogs.targetId),
            ),
          )
          .where(and(...conditions))
          .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
          .limit(limit + 1),
      ]);
      if (recorded.length === 0) throw new AuditLogViewStateChangedError();
      return toPage(rows, limit, (row) => ({
        v: row.occurredAt,
        id: row.id,
      }));
    },

    /** 閲覧の記録が0行だったときの読み直し用に、セッション・利用者・全体管理者のロールの事実を読む */
    async findViewerFacts(input: {
      userId: string;
      sessionId: string;
    }): Promise<AuditLogViewerFacts> {
      const [sessionRows, userRows, adminRows] = await Promise.all([
        db
          .select({
            userId: sessions.userId,
            createdAt: sessions.createdAt,
            lastActiveAt: sessions.lastActiveAt,
            revokedAt: sessions.revokedAt,
          })
          .from(sessions)
          .where(eq(sessions.id, input.sessionId))
          .limit(1),
        db
          .select({ isActive: users.isActive })
          .from(users)
          .where(eq(users.id, input.userId))
          .limit(1),
        db
          .select({ id: userRoleAssignments.id })
          .from(userRoleAssignments)
          .where(
            and(
              eq(userRoleAssignments.userId, input.userId),
              eq(userRoleAssignments.roleId, ROLE_IDS.globalAdmin),
              eq(userRoleAssignments.scopeType, "company"),
            ),
          )
          .limit(1),
      ]);
      return {
        session: sessionRows[0] ?? null,
        isUserActive: userRows[0]?.isActive ?? false,
        isGlobalAdmin: adminRows.length > 0,
      };
    },
  };
}

export type AuditLogReader = ReturnType<typeof createAuditLogReader>;

/** Repository を使う間だけ DB につなぐ */
export function withAuditLogReader<T>(
  env: Env,
  run: (reader: AuditLogReader) => Promise<T>,
): Promise<T> {
  return withDatabase(env, (db) => run(createAuditLogReader(db)));
}
