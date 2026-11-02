// 監査ログの書き込み（AC-3）。文を返すだけで実行しない：業務の更新と同じ db.batch([...]) に入れて、同時に確定・失敗させる。
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
  deps: { newId?: () => Ulid } = {},
) {
  return db.insert(auditLogs).values({
    id: (deps.newId ?? newUlid)(),
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    result: input.result,
    traceId: input.traceId,
    detail:
      input.detail === undefined ? null : JSON.stringify(redact(input.detail)),
  });
}
