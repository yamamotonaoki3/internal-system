// Repository：初代全体管理者の初回セットアップ（DB へのアクセスはこの層に閉じ込める）。
// 会社の設定・部署・利用者・ロールの割り当て・監査ログを、1つの db.batch で同時に確定する（途中で失敗したら、すべて取り消される）。
import { eq, sql } from "drizzle-orm";
import {
  channelMembers,
  channels,
  companySettings,
  departments,
  rooms,
  userRoleAssignments,
  users,
} from "../../db/schema";
import {
  announcementChannelName,
  channelNameKey,
  departmentNameKey,
} from "../../../shared/department-rules";
import type { AuditAction } from "../lib/audit-actions";
import { ROLE_IDS } from "../lib/permissions";
import { newUlid } from "../lib/ulid";
import { auditLogInsert } from "./audit-log.repository";
import type { Database } from "./database";

export type InitialAdminInput = {
  userId: string;
  departmentId: string;
  companyName: string;
  departmentName: string;
  loginId: string;
  displayName: string;
  /** 暗号化した本名 */
  legalNameEncrypted: string;
  email: string;
  extension: string | null;
  jobTitle: string | null;
  passwordHash: string;
  /** 作成の日時（created_at と email_verified_at に同じ値を入れる） */
  now: string;
  traceId: string;
};

export type SetupConflictReason =
  "already_completed" | "login_id" | "email" | "department_name";

/** 一意の制約に違反した（先にセットアップが完了した、または社員ID・メール・部署名が重複した）ときに投げる */
export class SetupConflictError extends Error {
  constructor(
    readonly reason: SetupConflictReason,
    options?: { cause?: unknown },
  ) {
    super("セットアップの内容が、すでにあるデータと競合しました", options);
    this.name = "SetupConflictError";
  }
}

export type SetupRepository = {
  /** 全体管理者がすでにいるか */
  isSetupCompleted(): Promise<boolean>;
  /** 競合したときは SetupConflictError を投げ、何も残さない */
  createInitialAdmin(input: InitialAdminInput): Promise<void>;
};

// 一意の制約に違反した列（D1 のメッセージ "UNIQUE constraint failed: <表>.<列>"）→ 競合の理由
const CONFLICT_BY_COLUMN: Record<string, SetupConflictReason> = {
  "company_settings.id": "already_completed",
  "user_role_assignments.role_id": "already_completed",
  "users.login_id_normalized": "login_id",
  "users.email_normalized": "email",
  "departments.name_normalized": "department_name",
};

function conflictReason(error: unknown): SetupConflictReason | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const match = /UNIQUE constraint failed: ([\w.]+)/i.exec(current.message);
    if (match !== null) return CONFLICT_BY_COLUMN[match[1] ?? ""] ?? null;
    current = current.cause;
  }
  return null;
}

const SETUP_ACTION: AuditAction = "setup.initial_admin.create";

export function createSetupRepository(db: Database): SetupRepository {
  return {
    async isSetupCompleted() {
      const rows = await db
        .select({ id: userRoleAssignments.id })
        .from(userRoleAssignments)
        .where(eq(userRoleAssignments.roleId, ROLE_IDS.globalAdmin))
        .limit(1);
      return rows.length > 0;
    },
    async createInitialAdmin(input) {
      const dedicatedChannelId = newUlid();
      const announcementChannelId = newUlid();
      const announcementName = announcementChannelName(input.departmentName);
      try {
        await db.batch([
          db.insert(companySettings).values({
            id: "company",
            companyName: input.companyName,
            createdAt: input.now,
          }),
          db.insert(departments).values({
            id: input.departmentId,
            name: input.departmentName,
            nameNormalized: departmentNameKey(input.departmentName),
            createdAt: input.now,
          }),
          db.insert(users).values({
            id: input.userId,
            loginId: input.loginId,
            loginIdNormalized: input.loginId.toLowerCase(),
            displayName: input.displayName,
            legalName: input.legalNameEncrypted,
            email: input.email,
            emailNormalized: input.email.toLowerCase(),
            // 初代管理者のメール確認は自己確認（確認した人は本人）
            emailVerifiedBy: input.userId,
            emailVerifiedAt: input.now,
            departmentId: input.departmentId,
            extension: input.extension,
            jobTitle: input.jobTitle,
            passwordHash: input.passwordHash,
            mustChangePassword: true,
            createdAt: input.now,
          }),
          // 全社連絡（migration 0011 が作る初期データ）がなければ NOT NULL 違反で batch 全体を失敗させる（下の参加の文と同じ条件）
          db
            .update(users)
            .set({
              displayName: sql`CASE WHEN EXISTS (SELECT 1 FROM channels WHERE purpose = 'company_general' AND deleted_at IS NULL) THEN ${users.displayName} ELSE NULL END`,
            })
            .where(eq(users.id, input.userId)),
          // 全体管理者（会社範囲）と、初代管理者が所属する部署のオーナー（部署範囲）
          db.insert(userRoleAssignments).values([
            {
              id: newUlid(),
              userId: input.userId,
              roleId: ROLE_IDS.globalAdmin,
              scopeType: "company",
              departmentId: null,
              assignedAt: input.now,
            },
            {
              id: newUlid(),
              userId: input.userId,
              roleId: ROLE_IDS.owner,
              scopeType: "department",
              departmentId: input.departmentId,
              assignedAt: input.now,
            },
          ]),
          // 初代部署の専用チャンネル2つ（通常・お知らせ）を作り、所属する初代管理者が参加する（7-1 AC-1・AC-2）
          db.insert(rooms).values([
            { id: dedicatedChannelId, kind: "channel", createdAt: input.now },
            {
              id: announcementChannelId,
              kind: "channel",
              createdAt: input.now,
            },
          ]),
          db.insert(channels).values([
            {
              roomId: dedicatedChannelId,
              departmentId: input.departmentId,
              name: input.departmentName,
              nameNormalized: channelNameKey(input.departmentName),
              visibility: "public",
              purpose: "department",
              createdAt: input.now,
              updatedAt: input.now,
            },
            {
              roomId: announcementChannelId,
              departmentId: input.departmentId,
              name: announcementName,
              nameNormalized: channelNameKey(announcementName),
              visibility: "public",
              purpose: "announcement",
              createdAt: input.now,
              updatedAt: input.now,
            },
          ]),
          db.insert(channelMembers).values([
            {
              channelId: dedicatedChannelId,
              userId: input.userId,
              joinedAt: input.now,
            },
            {
              channelId: announcementChannelId,
              userId: input.userId,
              joinedAt: input.now,
            },
          ]),
          // 全社連絡は作らず、最初の管理者を参加させるだけ（全社連絡は migration が作る）
          db.insert(channelMembers).select(sql`
            SELECT c.room_id, ${input.userId}, ${input.now} FROM channels c
            WHERE c.purpose = 'company_general' AND c.deleted_at IS NULL`),
          auditLogInsert(db, {
            actorId: input.userId,
            action: SETUP_ACTION,
            targetType: "user",
            targetId: input.userId,
            result: "success",
            traceId: input.traceId,
            detail: {
              emailVerification: "self",
              departmentId: input.departmentId,
            },
          }),
        ]);
      } catch (error) {
        const reason = conflictReason(error);
        if (reason !== null)
          throw new SetupConflictError(reason, { cause: error });
        throw error;
      }
    },
  };
}

/** Repository を使う間だけ DB につなぐ。接続のファイルは、使うときに初めて読み込む（sample-user.repository.ts と同じ） */
export async function withSetup<T>(
  env: Env,
  run: (repository: SetupRepository) => Promise<T>,
): Promise<T> {
  const { withDatabase } = await import("./database");
  return withDatabase(env, (db) => run(createSetupRepository(db)));
}
