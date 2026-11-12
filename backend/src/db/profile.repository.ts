// Repository：プロフィール・社員一覧・ステータス（#130）。DB へのアクセスはこの層に閉じ込める。
// 表示名の変更とその監査、代理設定とその監査は、それぞれ1つの db.batch で確定する（監査の挿入が失敗したら更新も取り消す）。
// 本名は暗号化したまま返す（復号は Service。EP-0-18 と自分のプロフィールだけ）。
import { and, asc, eq, ne, sql, type SQL } from "drizzle-orm";
import { departments, users } from "../../db/schema";
import type { UserStatusKind } from "../../../shared/profile-rules";
import { afterCursor, toPage, type CursorPayload } from "../lib/cursor";
import { isUlid } from "../lib/ulid";
import { auditLogInsert } from "./audit-log.repository";
import { withDatabase, type Database } from "./database";
import {
  createRoleAssignmentRepository,
  type RoleAssignmentRepository,
} from "./role-assignment.repository";

export type ProfileWrite = { actorId: string; traceId: string };

export type DepartmentRef = { id: string; name: string };
export type UserStatus = {
  kind: UserStatusKind;
  returnAt: string | null;
  message: string | null;
};

export type OwnProfile = {
  id: string;
  loginId: string;
  displayName: string;
  legalNameEncrypted: string;
  department: DepartmentRef | null;
  jobTitle: string | null;
  email: string;
  extension: string | null;
  status: UserStatus;
};

export type ProfileCardRow = {
  id: string;
  displayName: string;
  legalNameEncrypted: string;
  isActive: boolean;
  department: DepartmentRef | null;
  status: UserStatus;
};

export type DirectoryRow = {
  id: string;
  displayName: string;
  department: DepartmentRef;
  extension: string | null;
  email: string;
  status: UserStatus;
};

export type StatusTarget = {
  id: string;
  isActive: boolean;
  departmentId: string | null;
};

/** 自分のプロフィールの変更。渡した項目だけを変える（戻り予定・一言は null で消す） */
export type OwnProfileChange = {
  displayName?: string;
  statusKind?: UserStatusKind;
  statusReturnAt?: string | null;
  statusMessage?: string | null;
  /** 戻り予定だけを変えるとき：読んでから書くまでの間に在席へ変わっていたら、何も更新しない（null を返す） */
  onlyIfNotAvailable?: boolean;
};

export type OwnProfileChanged = {
  displayName: string;
  status: UserStatusKind;
  returnAt: string | null;
  statusMessage: string | null;
  updatedAt: string;
};

const statusColumns = {
  kind: users.statusKind,
  returnAt: users.statusReturnAt,
  message: users.statusMessage,
};

export function createProfileRepository(db: Database) {
  return {
    async findOwnProfile(userId: string): Promise<OwnProfile | null> {
      const rows = await db
        .select({
          id: users.id,
          loginId: users.loginId,
          displayName: users.displayName,
          legalNameEncrypted: users.legalName,
          departmentId: departments.id,
          departmentName: departments.name,
          jobTitle: users.jobTitle,
          email: users.email,
          extension: users.extension,
          ...statusColumns,
        })
        .from(users)
        .leftJoin(departments, eq(departments.id, users.departmentId))
        .where(eq(users.id, userId));
      const row = rows[0];
      if (row === undefined) return null;
      return {
        id: row.id,
        loginId: row.loginId,
        displayName: row.displayName,
        legalNameEncrypted: row.legalNameEncrypted,
        department:
          row.departmentId === null || row.departmentName === null
            ? null
            : { id: row.departmentId, name: row.departmentName },
        jobTitle: row.jobTitle,
        email: row.email,
        extension: row.extension,
        status: {
          kind: row.kind,
          returnAt: row.returnAt,
          message: row.message,
        },
      };
    },

    /** 渡した項目だけを更新する。表示名を変えるときだけ、同じ batch で監査を残す（detail は空） */
    async updateOwnProfile(
      userId: string,
      change: OwnProfileChange,
      write: ProfileWrite,
      now: string,
    ): Promise<OwnProfileChanged | null> {
      const touchesStatus =
        change.statusKind !== undefined ||
        change.statusReturnAt !== undefined ||
        change.statusMessage !== undefined;
      const guardAvailable = change.onlyIfNotAvailable === true;
      const update = db
        .update(users)
        .set({
          ...(change.displayName === undefined
            ? {}
            : { displayName: change.displayName }),
          ...(change.statusKind === undefined
            ? {}
            : { statusKind: change.statusKind }),
          ...(change.statusReturnAt === undefined
            ? {}
            : { statusReturnAt: change.statusReturnAt }),
          ...(change.statusMessage === undefined
            ? {}
            : { statusMessage: change.statusMessage }),
          ...(touchesStatus
            ? { statusUpdatedAt: now, statusUpdatedBy: userId }
            : {}),
        })
        .where(
          guardAvailable
            ? and(eq(users.id, userId), ne(users.statusKind, "available"))
            : eq(users.id, userId),
        )
        .returning({
          displayName: users.displayName,
          status: users.statusKind,
          returnAt: users.statusReturnAt,
          statusMessage: users.statusMessage,
        });
      const [rows] =
        change.displayName === undefined
          ? [await update]
          : await db.batch([
              update,
              auditLogInsert(
                db,
                {
                  actorId: write.actorId,
                  action: "profile.display_name_change",
                  targetType: "user",
                  targetId: userId,
                  result: "success",
                  traceId: write.traceId,
                },
                guardAvailable
                  ? {
                      onlyWhen: sql`EXISTS (SELECT 1 FROM users WHERE id = ${userId} AND status_kind <> 'available')`,
                    }
                  : {},
              ),
            ]);
      const row = rows[0];
      if (row === undefined) {
        // ガードで0行になったときだけ null。それ以外で読み戻せないのは不具合
        if (guardAvailable) return null;
        throw new Error("更新した利用者の行を読み戻せませんでした");
      }
      return { ...row, updatedAt: now };
    },

    async findProfileCard(userId: string): Promise<ProfileCardRow | null> {
      const rows = await db
        .select({
          id: users.id,
          displayName: users.displayName,
          legalNameEncrypted: users.legalName,
          isActive: users.isActive,
          departmentId: departments.id,
          departmentName: departments.name,
          ...statusColumns,
        })
        .from(users)
        .leftJoin(departments, eq(departments.id, users.departmentId))
        .where(eq(users.id, userId));
      const row = rows[0];
      if (row === undefined) return null;
      return {
        id: row.id,
        displayName: row.displayName,
        legalNameEncrypted: row.legalNameEncrypted,
        isActive: row.isActive,
        department:
          row.departmentId === null || row.departmentName === null
            ? null
            : { id: row.departmentId, name: row.departmentName },
        status: {
          kind: row.kind,
          returnAt: row.returnAt,
          message: row.message,
        },
      };
    },

    /** 有効かつ所属ありの社員を、表示名・IDの昇順で読む。本名は読まない。keyword は表示名の部分一致だけ（本名は対象にしない。C-75） */
    async listDirectory(options: {
      departmentId?: string;
      keyword?: string;
      limit: number;
      cursor?: CursorPayload;
    }) {
      const conditions: SQL[] = [
        eq(users.isActive, true),
        sql`${users.departmentId} IS NOT NULL`,
      ];
      if (options.departmentId !== undefined)
        conditions.push(eq(users.departmentId, options.departmentId));
      // LIKE は使わない：D1 の LIKE はパターンが 50 バイトまでで、100 文字の検索語（日本語は 300 バイト）を受けられない。
      // instr(lower(...)) は ASCII だけ大小無視の部分一致で、`%`・`_`・`\` も文字として扱う。値はパラメータで渡す
      if (options.keyword !== undefined)
        conditions.push(
          sql`instr(lower(${users.displayName}), lower(${options.keyword})) > 0`,
        );
      if (options.cursor !== undefined)
        conditions.push(
          afterCursor(
            { sort: users.displayName, id: users.id },
            options.cursor,
            "asc",
          ),
        );
      const rows = await db
        .select({
          id: users.id,
          displayName: users.displayName,
          departmentId: departments.id,
          departmentName: departments.name,
          extension: users.extension,
          email: users.email,
          ...statusColumns,
        })
        .from(users)
        .innerJoin(departments, eq(departments.id, users.departmentId))
        .where(and(...conditions))
        .orderBy(asc(users.displayName), asc(users.id))
        .limit(options.limit + 1);
      const page = toPage(rows, options.limit, (row) => {
        if (!isUlid(row.id)) throw new Error("社員IDが不正です");
        return { v: row.displayName, id: row.id };
      });
      return {
        items: page.items.map((row): DirectoryRow => ({
          id: row.id,
          displayName: row.displayName,
          department: { id: row.departmentId, name: row.departmentName },
          extension: row.extension,
          email: row.email,
          status: {
            kind: row.kind,
            returnAt: row.returnAt,
            message: row.message,
          },
        })),
        nextCursor: page.nextCursor,
      };
    },

    /** 絞り込みの候補：有効な部署の id と name だけ、名前順 */
    async listActiveDepartments(): Promise<DepartmentRef[]> {
      return db
        .select({ id: departments.id, name: departments.name })
        .from(departments)
        .where(eq(departments.isActive, true))
        .orderBy(asc(departments.name), asc(departments.id));
    },

    async findStatusTarget(userId: string): Promise<StatusTarget | null> {
      const rows = await db
        .select({
          id: users.id,
          isActive: users.isActive,
          departmentId: users.departmentId,
        })
        .from(users)
        .where(eq(users.id, userId));
      return rows[0] ?? null;
    },

    /** 代理設定：ステータスの更新と status.proxy_set の監査を、同じ batch で確定する。一言は変えない */
    async setStatusByProxy(
      target: { userId: string; departmentId: string },
      change: { statusKind: UserStatusKind; statusReturnAt: string | null },
      write: ProfileWrite,
      now: string,
    ) {
      const [rows] = await db.batch([
        db
          .update(users)
          .set({
            statusKind: change.statusKind,
            statusReturnAt: change.statusReturnAt,
            statusUpdatedAt: now,
            statusUpdatedBy: write.actorId,
          })
          .where(eq(users.id, target.userId))
          .returning({
            userId: users.id,
            status: users.statusKind,
            returnAt: users.statusReturnAt,
          }),
        auditLogInsert(db, {
          actorId: write.actorId,
          action: "status.proxy_set",
          targetType: "user",
          targetId: target.userId,
          result: "success",
          traceId: write.traceId,
          detail: {
            departmentId: target.departmentId,
            status: change.statusKind,
          },
        }),
      ]);
      const row = rows[0];
      if (row === undefined)
        throw new Error("更新した利用者の行を読み戻せませんでした");
      return { ...row, updatedAt: now };
    },
  };
}

export type ProfileRepository = ReturnType<typeof createProfileRepository>;

export function withProfiles<T>(
  env: Env,
  run: (
    repository: ProfileRepository,
    roles: RoleAssignmentRepository,
  ) => Promise<T>,
): Promise<T> {
  return withDatabase(env, (db) =>
    run(createProfileRepository(db), createRoleAssignmentRepository(db)),
  );
}
