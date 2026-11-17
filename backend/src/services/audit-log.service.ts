// Service：監査ログの閲覧（#156・0-6）。HTTP も DB のライブラリも知らない。
// 判定の順：認可（会社範囲の perm.audit_log.view。全体管理者だけ。拒否は authorize が運用ログに記録する）→ 閲覧の記録と取得（Repository の同じ batch）。
// 閲覧の記録が0行（資格が判定の後に崩れた）のときは、最初と同じ順で読み直す：
//   セッション・利用者の理由（行がない・利用者が違う・失効・期限切れ・無効）→ 401、全体管理者でない → 403、どれにも当たらなければ成功にせず元のエラー（500）。
//   セッションの状態を先に見るので、ログアウトした人に権限の状態を教えない。
// 一覧の行は、決めた項目だけを返す（detail の原文・trace_id・本名・メール・ログイン ID は返さない）。
import {
  AuditLogViewStateChangedError,
  createAuditLogReader,
  type AuditLogFilter,
  type AuditLogReader,
  type AuditLogRow,
} from "../db/audit-log.repository";
import { withDatabase } from "../db/database";
import {
  createRoleAssignmentRepository,
  withRoleAssignments,
  type RoleAssignmentRepository,
} from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import type { CursorPayload } from "../lib/cursor";
import { createLogger } from "../lib/logger/logger";
import { isSessionExpired } from "../lib/session-policy";
import { createAppAuthorizer } from "./authorizer";

/** 閲覧する人。sessionId は、書き込みの条件（セッションが今も有効）に使うだけで、応答・ログには出さない */
export type AuditLogActor = {
  userId: string;
  sessionId: string;
  traceId: string;
};

/** 検証済みの検索の本文 */
export type AuditLogSearchBody = AuditLogFilter & {
  cursor?: CursorPayload;
  limit: number;
};

export type AuditLogItem = {
  id: string;
  occurredAt: string;
  action: string;
  result: string;
  actor: { id: string; displayName: string | null; isActive: boolean } | null;
  target: {
    type: string;
    id: string;
    label: string | null;
    isActive: boolean | null;
  } | null;
  failureCategory?: string;
  affectedCount?: number;
  reason?: string;
};

/**
 * detail（JSON の文字列）を、オブジェクトとして読む。読めない・オブジェクトでない場合は、取り出す項目なしとして扱う。
 * 表示の補助の項目だけに使い、壊れた detail 1件のために一覧全体を失敗させない（書き込み側は入れ子にしない決まりで、壊れた値は書かれない）。
 */
function parseDetail(detail: string | null): Record<string, unknown> {
  if (detail === null) return {};
  try {
    const value: unknown = JSON.parse(detail);
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return {};
    return value as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 一覧の行を、返してよい項目だけに整形する。detail からは決めた3項目だけを、型を確かめて取り出す */
export function toAuditLogItem(row: AuditLogRow): AuditLogItem {
  const detail = parseDetail(row.detail);
  // アカウント登録の失敗は、対象の社員を示さず、エラーの分類と対象件数を出す（0-6 AC-2）
  const isRegistrationFailure =
    row.action === "account.create" && row.result === "failure";
  const { failureCategory, affectedCount, reason } = detail;
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    action: row.action,
    result: row.result,
    actor:
      row.actorId === null
        ? null
        : {
            id: row.actorId,
            displayName: row.actorName,
            isActive: row.actorIsActive ?? false,
          },
    target:
      isRegistrationFailure || row.targetId === null
        ? null
        : {
            type: row.targetType,
            id: row.targetId,
            label: row.targetName,
            isActive: row.targetIsActive,
          },
    ...(isRegistrationFailure && typeof failureCategory === "string"
      ? { failureCategory }
      : {}),
    ...(isRegistrationFailure && typeof affectedCount === "number"
      ? { affectedCount }
      : {}),
    ...(typeof reason === "string" ? { reason } : {}),
  };
}

export function withAuditLogService<T>(
  env: Env,
  run: (service: ReturnType<typeof createAuditLogService>) => Promise<T>,
): Promise<T> {
  return withDatabase(env, (db) =>
    run(
      createAuditLogService(
        createAuditLogReader(db),
        createRoleAssignmentRepository(db),
      ),
    ),
  );
}

export function createAuditLogService(
  repository: Pick<AuditLogReader, "search" | "findViewerFacts">,
  roles: RoleAssignmentRepository,
  deps: { now?: () => Date } = {},
) {
  const now = deps.now ?? (() => new Date());

  const authorize = (actor: AuditLogActor) =>
    createAppAuthorizer(roles, {
      logger: createLogger({ traceId: actor.traceId, userId: actor.userId }),
    }).authorize({ userId: actor.userId }, "perm.audit_log.view", {
      type: "company",
    });

  /** 記録が0行だったときの読み直し。理由が分かれば 401・403 を投げる。当たらなければ何もしない（呼び出し側が元のエラーを投げる） */
  async function decideRecheck(actor: AuditLogActor, at: Date): Promise<void> {
    const facts = await repository.findViewerFacts({
      userId: actor.userId,
      sessionId: actor.sessionId,
    });
    if (
      facts.session === null ||
      facts.session.userId !== actor.userId ||
      isSessionExpired(facts.session, at) ||
      !facts.isUserActive
    )
      throw new AppError("UNAUTHENTICATED", "ログインしてください");
    if (!facts.isGlobalAdmin)
      throw new AppError("FORBIDDEN", "この操作を行う権限がありません");
  }

  return {
    /** 入力の検証より前に、全体管理者だけを通す門 */
    authorize,

    /** 閲覧の記録を書いて、一覧を返す（同じ batch）。続きは nextCursor で読む */
    async search(actor: AuditLogActor, input: AuditLogSearchBody) {
      await authorize(actor);
      const at = now();
      try {
        const page = await repository.search({
          viewer: {
            userId: actor.userId,
            sessionId: actor.sessionId,
            traceId: actor.traceId,
          },
          now: at,
          filter: {
            from: input.from,
            to: input.to,
            actorId: input.actorId,
            action: input.action,
            targetType: input.targetType,
            targetId: input.targetId,
            result: input.result,
          },
          cursor: input.cursor,
          limit: input.limit,
        });
        return {
          items: page.items.map(toAuditLogItem),
          nextCursor: page.nextCursor,
        };
      } catch (error) {
        if (!(error instanceof AuditLogViewStateChangedError)) throw error;
        await decideRecheck(actor, at);
        throw error;
      }
    },
  };
}

/** セッションの permissions 用：監査ログを閲覧できるか。表示の制御であり、認可ではない（拒否の記録は出さない can を使う） */
export function canViewAuditLogs(
  env: Env,
  userId: string,
  traceId: string,
): Promise<boolean> {
  return withRoleAssignments(env, (repository) =>
    createAppAuthorizer(repository, {
      logger: createLogger({ traceId }),
    }).can({ userId }, "perm.audit_log.view", { type: "company" }),
  );
}
