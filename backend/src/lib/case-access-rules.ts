// 案件の管理の資格（#147。5-1 AC-21・Q6）の純粋な判定。
// 一覧・概要の canManage と participantCount、147-B の納期の変更の判定が、この同じ関数を使う。
export type CaseManageFacts = {
  isActive: boolean;
  /** 会社範囲の全体管理者か */
  isGlobalAdmin: boolean;
  /** 操作者がオーナーである部署の ID */
  ownedDepartmentIds: readonly string[];
  /** 案件の担当部署の ID */
  caseDepartmentIds: readonly string[];
};

/** 有効で、全体管理者か、担当部署のどれかのオーナーなら管理できる */
export function canManageCase(facts: CaseManageFacts): boolean {
  if (!facts.isActive) return false;
  if (facts.isGlobalAdmin) return true;
  return facts.caseDepartmentIds.some((id) =>
    facts.ownedDepartmentIds.includes(id),
  );
}
