// Drizzle のスキーマ（D1）。最初の1つのテーブルは例（架空の名前）。自分のアプリの表に置き換える。
import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
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

const nowUtc = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

// 会社の設定（会社のワークスペースを表す1件だけの表。2-1 AC-5）。id を 'company' に固定して、2件目を入れられなくする。
export const companySettings = sqliteTable(
  "company_settings",
  {
    id: text("id").primaryKey(),
    companyName: text("company_name").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (t) => [check("company_settings_id_check", sql`${t.id} = 'company'`)],
);

// 部署。name_normalized は前後の空白を除いて小文字にした値（アプリ側で作る）。大文字・小文字だけが違う名前も重複にする（2-1 AC-12）。
// オーナーは持たない（user_role_assignments の role_owner・部署範囲で表す）。
export const departments = sqliteTable("departments", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  nameNormalized: text("name_normalized").notNull().unique(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(nowUtc),
});

// 社員のアカウント。legal_name は暗号化した値（"v1:<iv>:<暗号文>"）。メール・社員IDの正規化の値は小文字。
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  loginId: text("login_id").notNull(),
  loginIdNormalized: text("login_id_normalized").notNull().unique(),
  displayName: text("display_name").notNull(),
  legalName: text("legal_name").notNull(),
  email: text("email").notNull(),
  emailNormalized: text("email_normalized").notNull().unique(),
  emailVerifiedBy: text("email_verified_by").references(
    (): AnySQLiteColumn => users.id,
  ),
  emailVerifiedAt: text("email_verified_at"),
  departmentId: text("department_id").references(() => departments.id),
  extension: text("extension"),
  jobTitle: text("job_title"),
  passwordHash: text("password_hash").notNull(),
  mustChangePassword: integer("must_change_password", { mode: "boolean" })
    .notNull()
    .default(true),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  deactivatedAt: text("deactivated_at"),
  createdAt: text("created_at").notNull().default(nowUtc),
});

// ロール。第1段階は固定の3つ（マイグレーション seed_initial_roles で入れる）。
export const roles = sqliteTable(
  "roles",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    scopeType: text("scope_type", {
      enum: ["company", "department"],
    }).notNull(),
    departmentId: text("department_id").references(() => departments.id),
    isSystem: integer("is_system", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (t) => [
    check(
      "roles_scope_type_check",
      sql`${t.scopeType} in ('company', 'department')`,
    ),
  ],
);

// ロールと権限の対応。権限IDは文字列（一覧はコードの定数 lib/permissions.ts）
export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id),
    permissionId: text("permission_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

// 利用者へのロールの割り当て（誰が・どのロールを・どの範囲で持つか）。
// 全体管理者は常に1件、部署のオーナーは部署ごとに1件（部分一意インデックス）。一般メンバーの割り当ては作らない（アプリ側で導く）。
export const userRoleAssignments = sqliteTable(
  "user_role_assignments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id),
    scopeType: text("scope_type", {
      enum: ["company", "department"],
    }).notNull(),
    departmentId: text("department_id").references(() => departments.id),
    assignedAt: text("assigned_at").notNull().default(nowUtc),
  },
  (t) => [
    check(
      "user_role_assignments_scope_check",
      sql`(${t.scopeType} = 'company' and ${t.departmentId} is null) or (${t.scopeType} = 'department' and ${t.departmentId} is not null)`,
    ),
    uniqueIndex("user_role_assignments_global_admin_unique")
      .on(t.roleId)
      .where(sql`${t.roleId} = 'role_global_admin'`),
    uniqueIndex("user_role_assignments_owner_department_unique")
      .on(t.departmentId)
      .where(sql`${t.roleId} = 'role_owner'`),
    index("user_role_assignments_user_id_idx").on(t.userId),
  ],
);
