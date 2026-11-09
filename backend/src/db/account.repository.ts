// Repository：アカウントの個別発行と管理者用の一覧（DB へのアクセスはこの層に閉じ込める）。
// 利用者の追加と監査ログは、同じ db.batch で確定する（片方が失敗したら、どちらも残さない）。
import { and, asc, eq, sql } from "drizzle-orm";
import { channelMembers, departments, users } from "../../db/schema";
import { afterCursor, toPage, type CursorPayload } from "../lib/cursor";
import { isUlid } from "../lib/ulid";
import { auditLogInsert } from "./audit-log.repository";
import { withDatabase, type Database } from "./database";
import {
  createRoleAssignmentRepository,
  type RoleAssignmentRepository,
} from "./role-assignment.repository";

export type AccountCreateInput = {
  id: string;
  loginId: string;
  displayName: string;
  /** 暗号化した本名 */
  legalNameEncrypted: string;
  email: string;
  departmentId: string;
  extension: string | null;
  jobTitle: string | null;
  /** ハッシュにした初期パスワード */
  passwordHash: string;
  /** 発行した管理者（メールを確認した人として保存する） */
  actorId: string;
  /** 発行の日時（created_at と email_verified_at に同じ値を入れる） */
  now: string;
  traceId: string;
};

export type DepartmentOption = { id: string; name: string };

export type AccountListItem = {
  id: string;
  loginId: string;
  displayName: string;
  department: DepartmentOption | null;
  email: string;
  extension: string | null;
  jobTitle: string | null;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
};

export type AccountListOptions = { limit: number; cursor?: CursorPayload };

export type AccountConflictReason = "login_id" | "email";

/** ユーザーID・メールの一意の制約に違反したときに投げる（値は持たない） */
export class AccountConflictError extends Error {
  constructor(
    readonly reason: AccountConflictReason,
    options?: { cause?: unknown },
  ) {
    super("アカウントの内容が、すでにあるデータと競合しました", options);
    this.name = "AccountConflictError";
  }
}

// 一意の制約に違反した列（D1 のメッセージ "UNIQUE constraint failed: <表>.<列>"）→ 競合の理由
const CONFLICT_BY_COLUMN: Record<string, AccountConflictReason> = {
  "users.login_id_normalized": "login_id",
  "users.email_normalized": "email",
};

/** 全社連絡がない（またはアーカイブ済み）ため、発行できないときに投げる。何も残らない */
export class CompanyGeneralChannelMissingError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("全社連絡のチャンネルがありません", options);
    this.name = "CompanyGeneralChannelMissingError";
  }
}

// 全社連絡の確認の文（users の挿入の直後）が崩れたときに NOT NULL 違反になる列
const COMPANY_GENERAL_ASSERT_COLUMN = "users.display_name";

type Constraint = { kind: "unique" | "not_null"; target: string };

function constraintOf(error: unknown): Constraint | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const match = /(UNIQUE|NOT NULL) constraint failed: ([\w.]+)/i.exec(
      current.message,
    );
    if (match !== null)
      return {
        kind: match[1]?.toUpperCase() === "UNIQUE" ? "unique" : "not_null",
        target: match[2] ?? "",
      };
    current = current.cause;
  }
  return null;
}

/** 一意の制約・全社連絡の確認の失敗だけを専用エラーにし、それ以外（未知のDBエラー）は変えずに返す */
function translateError(error: unknown): unknown {
  const constraint = constraintOf(error);
  if (constraint === null) return error;
  if (constraint.kind === "unique") {
    const reason = CONFLICT_BY_COLUMN[constraint.target];
    return reason === undefined
      ? error
      : new AccountConflictError(reason, { cause: error });
  }
  return constraint.target === COMPANY_GENERAL_ASSERT_COLUMN
    ? new CompanyGeneralChannelMissingError({ cause: error })
    : error;
}

function cursorFor(row: { id: string; loginIdNormalized: string }) {
  if (!isUlid(row.id)) throw new Error("利用者IDが不正です");
  return { v: row.loginIdNormalized, id: row.id };
}

export function createAccountRepository(db: Database) {
  return {
    async findActiveDepartment(id: string): Promise<DepartmentOption | null> {
      const rows = await db
        .select({ id: departments.id, name: departments.name })
        .from(departments)
        .where(and(eq(departments.id, id), eq(departments.isActive, true)))
        .limit(1);
      return rows[0] ?? null;
    },
    // 部署の候補の読み取りだけを持つ。部署の管理（#196）の Repository ができたら、そちらへ統合する
    async listActiveDepartments(): Promise<DepartmentOption[]> {
      return db
        .select({ id: departments.id, name: departments.name })
        .from(departments)
        .where(eq(departments.isActive, true))
        .orderBy(asc(departments.name), asc(departments.id));
    },
    async createAccount(input: AccountCreateInput): Promise<void> {
      try {
        await db.batch([
          db.insert(users).values({
            id: input.id,
            loginId: input.loginId,
            loginIdNormalized: input.loginId.toLowerCase(),
            displayName: input.displayName,
            legalName: input.legalNameEncrypted,
            email: input.email,
            emailNormalized: input.email.toLowerCase(),
            emailVerifiedBy: input.actorId,
            emailVerifiedAt: input.now,
            departmentId: input.departmentId,
            extension: input.extension,
            jobTitle: input.jobTitle,
            passwordHash: input.passwordHash,
            mustChangePassword: true,
            createdAt: input.now,
          }),
          // 全社連絡がなければ NOT NULL 違反で batch 全体を失敗させる（下の参加の文と同じ条件）
          db
            .update(users)
            .set({
              displayName: sql`CASE WHEN EXISTS (SELECT 1 FROM channels WHERE purpose = 'company_general' AND deleted_at IS NULL) THEN ${users.displayName} ELSE NULL END`,
            })
            .where(eq(users.id, input.id)),
          // 全社連絡と、所属部署の専用チャンネル2つ（department・announcement）に参加させる。専用チャンネルがない部署でも成功する
          db.insert(channelMembers).select(sql`
            SELECT c.room_id, ${input.id}, ${input.now} FROM channels c
            WHERE c.deleted_at IS NULL
              AND (c.purpose = 'company_general'
                OR (c.department_id = ${input.departmentId} AND c.purpose IN ('department', 'announcement')))`),
          auditLogInsert(db, {
            actorId: input.actorId,
            action: "account.create",
            targetType: "user",
            targetId: input.id,
            result: "success",
            traceId: input.traceId,
            detail: {
              departmentId: input.departmentId,
              emailVerification: "admin",
            },
          }),
        ]);
      } catch (error) {
        throw translateError(error);
      }
    },
    // 本名は読まない（一覧に含めない）
    async listAdmin(options: AccountListOptions) {
      const rows = await db
        .select({
          id: users.id,
          loginId: users.loginId,
          loginIdNormalized: users.loginIdNormalized,
          displayName: users.displayName,
          departmentId: departments.id,
          departmentName: departments.name,
          email: users.email,
          extension: users.extension,
          jobTitle: users.jobTitle,
          active: users.isActive,
          mustChangePassword: users.mustChangePassword,
          createdAt: users.createdAt,
        })
        .from(users)
        .leftJoin(departments, eq(users.departmentId, departments.id))
        .where(
          options.cursor === undefined
            ? undefined
            : afterCursor(
                { sort: users.loginIdNormalized, id: users.id },
                options.cursor,
                "asc",
              ),
        )
        .orderBy(asc(users.loginIdNormalized), asc(users.id))
        .limit(options.limit + 1);
      const page = toPage(rows, options.limit, cursorFor);
      const items: AccountListItem[] = page.items.map((row) => ({
        id: row.id,
        loginId: row.loginId,
        displayName: row.displayName,
        department:
          row.departmentId === null || row.departmentName === null
            ? null
            : { id: row.departmentId, name: row.departmentName },
        email: row.email,
        extension: row.extension,
        jobTitle: row.jobTitle,
        active: row.active,
        mustChangePassword: row.mustChangePassword,
        createdAt: row.createdAt,
      }));
      return { items, nextCursor: page.nextCursor };
    },
  };
}

export type AccountRepository = ReturnType<typeof createAccountRepository>;

/** Repository を使う間だけ DB につなぐ。権限の Repository（認可用）も一緒に渡す */
export function withAccounts<T>(
  env: Env,
  run: (
    repository: AccountRepository,
    roles: RoleAssignmentRepository,
  ) => Promise<T>,
): Promise<T> {
  return withDatabase(env, (db) =>
    run(createAccountRepository(db), createRoleAssignmentRepository(db)),
  );
}
