// Resolver：ロールの割り当てから、範囲（会社・部署）ごとの権限の「候補」を返す純粋関数（D-4）。DB・HTTPを知らない。
//
// 返す値の意味：「この範囲で、この操作を試してよいロールの候補」であり、操作の許可ではない。
// 権限表で「条件付き」の権限（参加者のみ・投稿できる場所のみ・本人のみ・対象の部署を範囲にする・自分の申請の扱い・状態の条件など）は、
// 各機能のServiceが対象ごとに条件を確かめてから実行する。Resolverと authorize だけで許可してはいけない。
// 特に R-45（perm.channel.request.approve.owner）は候補にすぎない。チャンネル作成の承認の機能は、申請者の条件
// （一般社員の申請は拒否／オーナー自身の申請は未任命の全体管理者も承認できる／オーナーが自分の申請を承認できるのは全体管理者を兼ねる場合だけ）を必ず確かめる。
import type { Scope } from "../lib/authorization";
import {
  DEPARTMENT_OWNER_ONLY,
  INITIAL_ROLE_PERMISSIONS,
  ROLE_IDS,
  type Permission,
} from "../lib/permissions";

export type ResolverUser = { isActive: boolean };

export type ResolverAssignment = {
  roleId: string;
  scopeType: "company" | "department";
  departmentId: string | null;
};

const departmentOwnerOnly: ReadonlySet<Permission> = new Set(
  DEPARTMENT_OWNER_ONLY,
);

export function resolvePermissions(
  user: ResolverUser,
  assignments: readonly ResolverAssignment[],
  scope: Scope,
): ReadonlySet<Permission> {
  // 無効な利用者は、割り当てが残っていても何も持たない
  if (!user.isActive) return new Set();

  // 有効な利用者は全員、一般メンバーの権限をすべての範囲で持つ（割り当ての行は作らない。data-model 3.4）
  const permissions = new Set<Permission>(
    INITIAL_ROLE_PERMISSIONS[ROLE_IDS.member],
  );

  for (const assignment of assignments) {
    if (
      assignment.roleId === ROLE_IDS.globalAdmin &&
      assignment.scopeType === "company"
    ) {
      // 会社範囲の全体管理者は、会社とすべての部署に効く。ただし部署の範囲では、その部署のオーナーを兼ねる場合だけ効く権限を除く
      for (const permission of INITIAL_ROLE_PERMISSIONS[ROLE_IDS.globalAdmin]) {
        if (scope.type === "company" || !departmentOwnerOnly.has(permission))
          permissions.add(permission);
      }
    } else if (
      assignment.roleId === ROLE_IDS.owner &&
      assignment.scopeType === "department" &&
      scope.type === "department" &&
      assignment.departmentId === scope.departmentId
    ) {
      // 部署のオーナーは、その部署の範囲だけ
      for (const permission of INITIAL_ROLE_PERMISSIONS[ROLE_IDS.owner])
        permissions.add(permission);
    }
  }
  return permissions;
}
