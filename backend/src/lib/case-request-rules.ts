// 案件の作成申請（#146）の純粋な規則。DB を知らない。

/**
 * 申請が届いた通知の宛先（利用者の決定 Q3）：担当部署の有効なオーナーから申請者本人を除く。
 * その集合が空のときだけ、有効な全体管理者から本人を除いたものにする。重複は除く。
 */
export function caseRequestSubmittedRecipients(input: {
  requesterId: string;
  ownerIds: readonly string[];
  adminIds: readonly string[];
}): string[] {
  const others = (ids: readonly string[]) => [
    ...new Set(ids.filter((id) => id !== input.requesterId)),
  ];
  const owners = others(input.ownerIds);
  return owners.length > 0 ? owners : others(input.adminIds);
}

/** 決裁（承認・却下）の判定の材料。決裁者の事実は reviewerFactsOf（いまの割り当て）から作る */
export type CaseDecisionInput = {
  /** 申請の担当部署 */
  departmentIds: readonly string[];
  requesterId: string;
  actorId: string;
  actorIsAdmin: boolean;
  /** 決裁者がオーナーである部署 */
  actorOwnedDepartmentIds: readonly string[];
};

/** 審査の範囲に入るか（5-3 AC-3）：全体管理者か、担当部署のどれかのオーナー。範囲外は存在を明かさない */
export function isCaseRequestReviewable(input: CaseDecisionInput): boolean {
  if (input.actorIsAdmin) return true;
  return input.departmentIds.some((id) =>
    input.actorOwnedDepartmentIds.includes(id),
  );
}

/** 承認・却下できるか（5-3 AC-3・AC-4）：範囲に入り、全体管理者でなければ自分の申請でないこと */
export function canDecideCaseRequest(input: CaseDecisionInput): boolean {
  if (!isCaseRequestReviewable(input)) return false;
  return input.actorIsAdmin || input.requesterId !== input.actorId;
}
