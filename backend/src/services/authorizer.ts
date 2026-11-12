// アプリの権限判定。#118 の枠（createAuthorizer）を呼ぶのは、このファイルの1か所だけ。
import {
  withRoleAssignments,
  type RoleAssignmentRepository,
  type UserWithAssignments,
} from "../db/role-assignment.repository";
import {
  createAuthorizer,
  type PermissionResolver,
} from "../lib/authorization";
import { createLogger, type Logger } from "../lib/logger/logger";
import { PERMISSIONS, ROLE_IDS, type Permission } from "../lib/permissions";
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

/** チャンネルの作成申請を審査する本人の事実（#131）。全体管理者か、オーナーである部署の一覧 */
export type ReviewerFacts = {
  isAdmin: boolean;
  ownedDepartmentIds: string[];
};

/**
 * 割り当ての読み込みの結果から、審査者の事実を導く。権限の組み立てを2か所にしないため、resolvePermissions と同じ条件にする：
 * 全体管理者かは会社範囲の resolvePermissions の結果、オーナーの部署は部署範囲のオーナーの割り当て。無効な利用者・存在しない利用者は何も持たない。
 */
export function reviewerFactsOf(
  found: UserWithAssignments | null,
): ReviewerFacts {
  if (found === null || !found.user.isActive)
    return { isAdmin: false, ownedDepartmentIds: [] };
  const isAdmin = resolvePermissions(found.user, found.assignments, {
    type: "company",
  }).has("perm.channel.request.approve.owner");
  const owned = found.assignments.flatMap((assignment) =>
    assignment.roleId === ROLE_IDS.owner &&
    assignment.scopeType === "department" &&
    assignment.departmentId !== null
      ? [assignment.departmentId]
      : [],
  );
  return { isAdmin, ownedDepartmentIds: [...new Set(owned)] };
}

/** セッションの permissions 用：審査者（全体管理者か、いずれかの部署のオーナー）か。表示の制御であり、認可ではない */
export function canReviewChannelRequests(
  env: Env,
  userId: string,
): Promise<boolean> {
  return withRoleAssignments(env, async (repository) => {
    const facts = reviewerFactsOf(await repository.findByUserId(userId));
    return facts.isAdmin || facts.ownedDepartmentIds.length > 0;
  });
}
