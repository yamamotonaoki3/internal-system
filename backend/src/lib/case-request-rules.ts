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
