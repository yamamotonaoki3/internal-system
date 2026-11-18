// 案件の参加者の判定（#147 の 147-B。決定 Q1・Q2）。純粋関数。
// 書き込みの前提（case.repository.ts の batch の SQL）も同じ意味の条件を持つ。片方だけを変えない。

export type CaseAutoRole = "global_admin" | "department_owner";

/**
 * 自動参加の人の役割。印の列は持たず、いまの割り当てから導く。
 * 有効で全体管理者なら global_admin（オーナーでもあるときも）、有効で案件の担当部署のどれかのオーナーなら department_owner
 */
export function autoRoleOf(input: {
  isActive: boolean;
  isGlobalAdmin: boolean;
  ownedDepartmentIds: readonly string[];
  caseDepartmentIds: readonly string[];
}): CaseAutoRole | null {
  if (!input.isActive) return null;
  if (input.isGlobalAdmin) return "global_admin";
  return input.ownedDepartmentIds.some((id) =>
    input.caseDepartmentIds.includes(id),
  )
    ? "department_owner"
    : null;
}

/** 自動参加の人は外せない（本人の退出も。Q2）。外すと有効な参加者が0人になるなら外せない（Q1） */
export function canRemoveParticipant(input: {
  targetAutoRole: CaseAutoRole | null;
  activeCountAfter: number;
}): boolean {
  return input.targetAutoRole === null && input.activeCountAfter > 0;
}
