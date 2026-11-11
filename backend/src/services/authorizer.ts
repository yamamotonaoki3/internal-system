// アプリの権限判定。#118 の枠（createAuthorizer）を呼ぶのは、このファイルの1か所だけ。
import {
  withRoleAssignments,
  type RoleAssignmentRepository,
} from "../db/role-assignment.repository";
import {
  createAuthorizer,
  type PermissionResolver,
} from "../lib/authorization";
import { createLogger, type Logger } from "../lib/logger/logger";
import { PERMISSIONS, type Permission } from "../lib/permissions";
import { resolvePermissions } from "./permission-resolver";

export function createAppAuthorizer(
  repository: RoleAssignmentRepository,
  options: { logger: Logger },
) {
  const resolve: PermissionResolver<Permission> = async (userId, scope) => {
    const found = await repository.findByUserId(userId);
    // 存在しない利用者は、何も持たない（全員の権限も含めて拒否する）
    if (found === null) return new Set<Permission>();
    return resolvePermissions(found.user, found.assignments, scope);
  };
  return createAuthorizer(PERMISSIONS, resolve, options);
}

export function canManageClients(
  env: Env,
  userId: string,
  traceId: string,
): Promise<boolean> {
  return withRoleAssignments(env, (repository) =>
    createAppAuthorizer(repository, {
      logger: createLogger({ traceId }),
    }).can({ userId }, "perm.client.manage", { type: "company" }),
  );
}

export function canManageDepartments(
  env: Env,
  userId: string,
  traceId: string,
): Promise<boolean> {
  return withRoleAssignments(env, (repository) =>
    createAppAuthorizer(repository, {
      logger: createLogger({ traceId }),
    }).can({ userId }, "perm.workspace.create", { type: "company" }),
  );
}

export function canManageAccounts(
  env: Env,
  userId: string,
  traceId: string,
): Promise<boolean> {
  return withRoleAssignments(env, (repository) =>
    createAppAuthorizer(repository, {
      logger: createLogger({ traceId }),
    }).can({ userId }, "perm.account.create", { type: "company" }),
  );
}

/**
 * 部署ごとの権限の有無を、割り当ての読み込み1回で判定する（一覧の各行の可否用）。
 * 判定は createAppAuthorizer と同じ resolvePermissions で行う。存在しない・無効な利用者は、すべて false。
 * 読み込みの失敗は呼び出し元へ伝える。
 */
export async function canForDepartments(
  repository: RoleAssignmentRepository,
  userId: string,
  permission: Permission,
  departmentIds: readonly string[],
): Promise<Map<string, boolean>> {
  const found = await repository.findByUserId(userId);
  return new Map(
    [...new Set(departmentIds)].map((departmentId) => [
      departmentId,
      found !== null &&
        resolvePermissions(found.user, found.assignments, {
          type: "department",
          departmentId,
        }).has(permission),
    ]),
  );
}
