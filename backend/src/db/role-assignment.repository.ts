// Repository：利用者のロールの割り当てを読む（権限の判定用）。DB へのアクセスはこの層に閉じ込める。
import { eq } from "drizzle-orm";
import { userRoleAssignments, users } from "../../db/schema";
import { withDatabase, type Database } from "./database";

export type UserRoleAssignment = {
  roleId: string;
  scopeType: "company" | "department";
  departmentId: string | null;
};

export type UserWithAssignments = {
  user: { isActive: boolean };
  assignments: UserRoleAssignment[];
};

export type RoleAssignmentRepository = {
  /** 利用者と割り当てを1回のJOINで読む。利用者が存在しなければ null。無効な利用者も返す（判定はResolverが行う） */
  findByUserId(userId: string): Promise<UserWithAssignments | null>;
};

export function createRoleAssignmentRepository(
  db: Database,
): RoleAssignmentRepository {
  return {
    async findByUserId(userId) {
      const rows = await db
        .select({
          isActive: users.isActive,
          roleId: userRoleAssignments.roleId,
          scopeType: userRoleAssignments.scopeType,
          departmentId: userRoleAssignments.departmentId,
        })
        .from(users)
        .leftJoin(userRoleAssignments, eq(userRoleAssignments.userId, users.id))
        .where(eq(users.id, userId));
      const first = rows[0];
      if (first === undefined) return null;
      return {
        user: { isActive: first.isActive },
        assignments: rows.flatMap((row) =>
          row.roleId === null || row.scopeType === null
            ? []
            : [
                {
                  roleId: row.roleId,
                  scopeType: row.scopeType,
                  departmentId: row.departmentId,
                },
              ],
        ),
      };
    },
  };
}

export function withRoleAssignments<T>(
  env: Env,
  run: (repository: RoleAssignmentRepository) => Promise<T>,
): Promise<T> {
  return withDatabase(env, (db) => run(createRoleAssignmentRepository(db)));
}
