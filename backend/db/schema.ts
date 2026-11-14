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
import { USER_STATUS_KINDS } from "../../shared/profile-rules";

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

// CHECK 制約の値の並び（shared/profile-rules.ts が定義元。固定の値だけなので sql.raw に渡してよい）
const STATUS_KIND_LIST = USER_STATUS_KINDS.map((kind) => `'${kind}'`).join(
  ", ",
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
  description: text("description").notNull().default(""),
  version: integer("version").notNull().default(1),
  // ADD COLUMN は式の既定値を付けられないため NULL を許す。アプリが作成・改名・交代のたびに値を入れる
  updatedAt: text("updated_at"),
});

// 社員のアカウント。legal_name は暗号化した値（"v1:<iv>:<暗号文>"）。メール・社員IDの正規化の値は小文字。
// ステータス（#130）：status_kind は既定が在席。status_updated_by は最後に設定した人（本人の変更なら本人、代理設定ならその操作者）。
// 一覧は有効かつ所属ありの社員を、表示名・ID の順に読む（users_directory_idx は部署で絞る場合、users_display_name_idx は全社）。
export const users = sqliteTable(
  "users",
  {
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
    statusKind: text("status_kind", { enum: USER_STATUS_KINDS })
      .notNull()
      .default("available"),
    statusReturnAt: text("status_return_at"),
    statusMessage: text("status_message"),
    statusUpdatedAt: text("status_updated_at"),
    statusUpdatedBy: text("status_updated_by").references(
      (): AnySQLiteColumn => users.id,
    ),
  },
  (t) => [
    check(
      "users_status_kind_check",
      sql`${t.statusKind} in (${sql.raw(STATUS_KIND_LIST)})`,
    ),
    index("users_directory_idx").on(t.departmentId, t.displayName, t.id),
    index("users_display_name_idx").on(t.displayName, t.id),
  ],
);

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

// ログインのセッション（ADR-0003）。id はトークンの SHA-256（16進）で、トークンそのものは保存しない。時刻は ISO 8601（UTC）の文字列。
// 失効（revoked_at）・無操作30分・ログインから24時間は、読み取り時に判定する。期限の切れた行は Cron（auth-cleanup）で消す。
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: text("created_at").notNull().default(nowUtc),
    lastActiveAt: text("last_active_at").notNull().default(nowUtc),
    // 再認証の時刻（0-5。再認証が必要な操作の機能が使う）
    reauthenticatedAt: text("reauthenticated_at"),
    revokedAt: text("revoked_at"),
  },
  (t) => [index("sessions_user_id_created_at_idx").on(t.userId, t.createdAt)],
);

// 試行制限（ADR-0008）。bucket_key は HMAC-SHA256(LOGIN_THROTTLE_KEY, 値) の16進（生のIP・社員IDは保存しない）。
// 接続元（'source'=ログイン、'setup_source'=初回セットアップ）：attempt_count（受付数。成功も数える）・window_started_at・locked_until を使う。
// 社員ID（'account'）：failed_count・last_failed_at を使う（ロックはせず、失敗数に応じて遅らせる）。
// updated_at は最後に更新した時刻で、掃除（auth-cleanup）が使う。
export const loginAttempts = sqliteTable(
  "login_attempts",
  {
    bucketType: text("bucket_type").notNull(),
    bucketKey: text("bucket_key").notNull(),
    attemptCount: integer("attempt_count"),
    failedCount: integer("failed_count"),
    windowStartedAt: text("window_started_at"),
    lockedUntil: text("locked_until"),
    lastFailedAt: text("last_failed_at"),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (t) => [
    primaryKey({ columns: [t.bucketType, t.bucketKey] }),
    check(
      "login_attempts_bucket_type_check",
      sql`${t.bucketType} in ('source', 'account', 'setup_source')`,
    ),
    index("login_attempts_updated_at_idx").on(t.updatedAt),
  ],
);

export const clients = sqliteTable(
  "clients",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    nameNormalized: text("name_normalized").notNull().unique(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (t) => [index("clients_code_id_idx").on(t.code, t.id)],
);

export const clientApiRateLimits = sqliteTable(
  "client_api_rate_limits",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bucketType: text("bucket_type").notNull(),
    windowStartedAtMs: integer("window_started_at_ms").notNull(),
    attemptCount: integer("attempt_count").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.bucketType] }),
    check(
      "client_api_rate_limits_bucket_type_check",
      sql`${t.bucketType} in ('read', 'write')`,
    ),
  ],
);

// チャンネルとDMの共通の入れ物（メッセージ #201 は room_id で結ぶ）。
export const rooms = sqliteTable(
  "rooms",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["channel", "direct"] }).notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (t) => [check("rooms_kind_check", sql`${t.kind} in ('channel', 'direct')`)],
);

// チャンネル。purpose：normal=通常、department=部署の専用、announcement=部署のお知らせ専用、company_general=全社連絡、case=案件（値の予約だけ）。
// name_normalized はアーカイブ済み（deleted_at あり）を含めて会社内で一意（V-25・C-124）。参加は channel_members の行の有無で表す。
// CHECK の値を増やすときは、表の作り直しのマイグレーションが要る（docs/design/department-management.md）。
export const channels = sqliteTable(
  "channels",
  {
    roomId: text("room_id")
      .primaryKey()
      .references(() => rooms.id),
    departmentId: text("department_id").references(() => departments.id),
    name: text("name").notNull(),
    nameNormalized: text("name_normalized").notNull().unique(),
    description: text("description").notNull().default(""),
    visibility: text("visibility", { enum: ["public", "private"] }).notNull(),
    purpose: text("purpose", {
      enum: ["normal", "department", "announcement", "company_general", "case"],
    }).notNull(),
    createdBy: text("created_by").references(() => users.id),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
    deletedAt: text("deleted_at"),
    deletedBy: text("deleted_by").references(() => users.id),
  },
  (t) => [
    check(
      "channels_visibility_check",
      sql`${t.visibility} in ('public', 'private')`,
    ),
    check(
      "channels_purpose_check",
      sql`${t.purpose} in ('normal', 'department', 'announcement', 'company_general', 'case')`,
    ),
    check(
      "channels_department_purpose_check",
      sql`${t.purpose} not in ('department', 'announcement') or (${t.departmentId} is not null and ${t.visibility} = 'public')`,
    ),
    check(
      "channels_company_general_check",
      sql`${t.purpose} <> 'company_general' or ${t.departmentId} is null`,
    ),
    uniqueIndex("channels_department_purpose_unique")
      .on(t.departmentId, t.purpose)
      .where(sql`${t.purpose} in ('department', 'announcement')`),
    // 全社連絡は会社で1つだけ（Q-3）。列は purpose で、条件の行（company_general）の間で重複を拒否する
    uniqueIndex("channels_company_general_unique")
      .on(t.purpose)
      .where(sql`${t.purpose} = 'company_general'`),
    index("channels_department_id_idx").on(t.departmentId),
  ],
);

export const channelMembers = sqliteTable(
  "channel_members",
  {
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.roomId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    joinedAt: text("joined_at").notNull().default(nowUtc),
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.userId] }),
    index("channel_members_user_id_idx").on(t.userId),
  ],
);

// DM（1対1）。direct_key は2人の組を一意にするキー（同じ2人のDMを重ねて作らない）。
export const conversations = sqliteTable("conversations", {
  roomId: text("room_id")
    .primaryKey()
    .references(() => rooms.id),
  directKey: text("direct_key").notNull().unique(),
  createdAt: text("created_at").notNull().default(nowUtc),
});

export const conversationMembers = sqliteTable(
  "conversation_members",
  {
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.roomId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId] }),
    index("conversation_members_user_id_idx").on(t.userId),
  ],
);

// メッセージ（#201）。room_id でチャンネル・DM・案件の共通の親（rooms）に結ぶ。
// sender_display_name は投稿時点の表示名のスナップショット（後で表示名を変えても過去の投稿は変わらない）。
// 本文の上限は UTF-16 の単位で数えるためアプリ側で検証する（SQLite の length は文字数で数え方が違う）。DB では空の本文だけを拒否する。
// 部屋の中では、コミットの順に id が必ず増える（「最後のID以降」で取りこぼさないため。message.repository の条件付き INSERT が保つ）。
export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id),
    senderId: text("sender_id")
      .notNull()
      .references(() => users.id),
    senderDisplayName: text("sender_display_name").notNull(),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
    // 編集・削除（#134）。削除は本文を残して印を付けるだけで、API は削除済みの本文を返さない
    editedAt: text("edited_at"),
    deletedAt: text("deleted_at"),
    deletedBy: text("deleted_by").references(() => users.id),
  },
  (t) => [
    check("messages_body_check", sql`length(${t.body}) >= 1`),
    index("messages_room_id_id_idx").on(t.roomId, t.id),
  ],
);

// 通知（#124）。文言は持たず、種類と対象の ID だけを保存する（文言・移動先は画面で組み立てる。本名・本文を行に入れない）。
// kind に CHECK は付けない（種類を足すたびに表の作り直しが要るため。値は shared/notification-kinds.ts で守る）。
// room_id・message_id・target_id は外部キーにしない（直接削除・物理削除の通知が、消えた対象を指しうるため）。
export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(),
    roomId: text("room_id"),
    messageId: text("message_id"),
    targetId: text("target_id"),
    createdAt: text("created_at").notNull().default(nowUtc),
    readAt: text("read_at"),
  },
  (t) => [
    index("notifications_user_id_created_at_id_idx").on(
      t.userId,
      t.createdAt,
      t.id,
    ),
    index("notifications_user_id_unread_idx")
      .on(t.userId)
      .where(sql`${t.readAt} is null`),
  ],
);

// 既読位置（#237。ADR-0006）。利用者×部屋ごとに、最後に読んだメッセージの ID を持つ。未読数はこの ID より後のメッセージを上限つきで数え直して得る（カウンターは持たない）。
// last_read_message_id は外部キーにしない（メッセージの直接削除・物理削除を止めず、既読位置が一緒に消えることも避けるため。notifications.message_id と同じ判断。C-169）。
// 後戻りさせない更新は、DAO の条件付き upsert（read-position-advance.sql.ts）が行う。追加の索引は作らない（主キーで「利用者×部屋」を引く）。
export const readPositions = sqliteTable(
  "read_positions",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id),
    lastReadMessageId: text("last_read_message_id").notNull(),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roomId] })],
);

// チャンネルの作成申請（#131。2-2）。チャンネルは承認の時に初めて作り、申請の内容はこの表に持つ（承認待ちの間は channels に行がない）。
// department_id が null なら会社直属。name は整形後、name_normalized は重複判定の比較キー（channelNameKey）。
// 承認待ち同士の名前の重複は、部分一意索引（status = 'pending'）で拒否する。却下・取り下げ・承認済みの名前は比較から外れる（承認済みは channels 側で拾う）。
// version は二重決裁の検出用。decided_by は、取り下げでは申請者本人。channel_id は承認で作ったチャンネルの room_id で、
// 将来の物理削除（2-6 AC-6）を止めないため外部キーにしない。決裁の履歴は、この行の列と監査ログで残す。
export const channelCreationRequests = sqliteTable(
  "channel_creation_requests",
  {
    id: text("id").primaryKey(),
    departmentId: text("department_id").references(() => departments.id),
    name: text("name").notNull(),
    nameNormalized: text("name_normalized").notNull(),
    description: text("description").notNull().default(""),
    visibility: text("visibility", { enum: ["public", "private"] }).notNull(),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => users.id),
    status: text("status", {
      enum: ["pending", "approved", "rejected", "withdrawn"],
    })
      .notNull()
      .default("pending"),
    version: integer("version").notNull().default(1),
    decidedBy: text("decided_by").references(() => users.id),
    decisionReason: text("decision_reason"),
    channelId: text("channel_id"),
    requestedAt: text("requested_at").notNull().default(nowUtc),
    decidedAt: text("decided_at"),
  },
  (t) => [
    check(
      "channel_creation_requests_visibility_check",
      sql`${t.visibility} in ('public', 'private')`,
    ),
    check(
      "channel_creation_requests_status_check",
      sql`${t.status} in ('pending', 'approved', 'rejected', 'withdrawn')`,
    ),
    check(
      "channel_creation_requests_rejected_reason_check",
      sql`${t.status} <> 'rejected' or ${t.decisionReason} is not null`,
    ),
    check(
      "channel_creation_requests_approved_channel_check",
      sql`${t.status} <> 'approved' or ${t.channelId} is not null`,
    ),
    check(
      "channel_creation_requests_decided_check",
      sql`${t.status} = 'pending' or (${t.decidedAt} is not null and ${t.decidedBy} is not null)`,
    ),
    uniqueIndex("channel_creation_requests_pending_name_unique")
      .on(t.nameNormalized)
      .where(sql`${t.status} = 'pending'`),
    index("channel_creation_requests_requested_by_id_idx").on(
      t.requestedBy,
      t.id,
    ),
    index("channel_creation_requests_status_department_id_idx").on(
      t.status,
      t.departmentId,
      t.id,
    ),
  ],
);
