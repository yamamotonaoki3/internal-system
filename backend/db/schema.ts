// Drizzle のスキーマ（D1）。最初の1つのテーブルは例（架空の名前）。自分のアプリの表に置き換える。
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const sampleUsers = sqliteTable("sample_users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

// 監査ログ（data-model.md）。actor_id は外部キーにしない（ログイン失敗など、利用者が特定できない記録も残すため）。
export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    occurredAt: text("occurred_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    result: text("result").notNull(),
    traceId: text("trace_id").notNull(),
    detail: text("detail"),
  },
  (t) => [
    index("audit_logs_occurred_at_id_idx").on(t.occurredAt, t.id),
    check(
      "audit_logs_result_check",
      sql`${t.result} in ('success', 'failure')`,
    ),
  ],
);
