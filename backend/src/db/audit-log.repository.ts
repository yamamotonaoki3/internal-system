// 監査ログの書き込み（AC-3）。文を返すだけで実行しない：業務の更新と同じ db.batch([...]) に入れて、同時に確定・失敗させる。
import { sql, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { auditLogs } from "../../db/schema";
import type { AuditAction } from "../lib/audit-actions";
import { redact } from "../lib/logger/logger";
import { newUlid, type Ulid } from "../lib/ulid";

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
