// 権限判定の枠（AC-4）。「誰が・どの範囲で・どの権限IDを持つか」はResolverが返し、この部品は判定と拒否のしかたを決める。
// 本番の権限IDの一覧と、Resolverの実装（ロールからの解決）は、ロールのIssueが createAuthorizer を呼ぶ1か所で組む。
// 未定義の権限ID（known にないもの）は、Resolverが許可しても拒否する。
import { AppError } from "./app-error";
import type { Logger } from "./logger/logger";

export type Scope =
  { type: "company" } | { type: "department"; departmentId: string };

export type Principal = { userId: string };

/**
 * その利用者がその範囲で持つ権限IDを返す。
 * 部署範囲の割り当ては同じdepartmentIdのときだけ効かせる。会社範囲の権限を部署の操作に効かせるかは、Resolverの実装が権限表に従って決める。
 */
export type PermissionResolver<P extends string> = (
  userId: string,
  scope: Scope,
) => Promise<ReadonlySet<P>>;

export function createAuthorizer<P extends string>(
  known: readonly P[],
  resolve: PermissionResolver<P>,
  options: { logger: Logger },
) {
  const knownSet: ReadonlySet<string> = new Set(known);

  async function can(
    principal: Principal | null,
    permission: P,
    scope: Scope,
  ): Promise<boolean> {
    if (principal === null || !knownSet.has(permission)) return false;
    return (await resolve(principal.userId, scope)).has(permission);
  }

  // 拒否は監査として記録する。内部情報（Resolverの権限集合）や利用者IDは含めない
  function recordDenied(permission: P, scope: Scope, reason: string) {
    options.logger.audit(
      permission,
      scope.type === "company" ? "company" : `department:${scope.departmentId}`,
      "failure",
      { reason },
    );
  }

  async function authorize(
    principal: Principal | null,
    permission: P,
    scope: Scope,
  ): Promise<void> {
    if (principal === null) {
      recordDenied(permission, scope, "unauthenticated");
      throw new AppError("UNAUTHENTICATED", "ログインしてください");
    }
    if (!(await can(principal, permission, scope))) {
      recordDenied(permission, scope, "forbidden");
      throw new AppError("FORBIDDEN", "この操作を行う権限がありません");
    }
  }

  return { can, authorize };
}
