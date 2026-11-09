// オーナーの選択で、元部署の後任が要るか・誰が後任の候補かを決める（0-8 AC-10）。画面の補助であり、最終の確認はサーバーが行う。
import type { OwnerCandidate } from "./department-api";

/** 全体管理者でない現オーナーを選んだとき、その人の元部署の後任が要る */
export function needsSuccessor(owner: OwnerCandidate | undefined): boolean {
  return (
    owner !== undefined &&
    !owner.isGlobalAdmin &&
    owner.ownedDepartmentId !== null
  );
}

/** 後任の候補：元部署の有効な一般社員（全体管理者・オーナー・他部署の社員は含めない） */
export function successorCandidates(
  owner: OwnerCandidate | undefined,
  candidates: readonly OwnerCandidate[],
): OwnerCandidate[] {
  if (owner === undefined || !needsSuccessor(owner)) return [];
  return candidates.filter(
    (candidate) =>
      candidate.departmentId === owner.ownedDepartmentId &&
      !candidate.isGlobalAdmin &&
      candidate.ownedDepartmentId === null &&
      candidate.id !== owner.id,
  );
}
