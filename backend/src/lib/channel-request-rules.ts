// チャンネルの作成申請の認可と通知の宛先を決める純粋関数（#131。2-2 AC-7・AC-8・AC-10、3-4 AC-1・AC-3）。DB・HTTP を知らない。
// Resolver の perm.channel.request.approve.owner は候補にすぎない。承認・却下の可否は、申請ごとにここで決める。

export type DecisionInput = {
  /** 申請の部署。null は会社直属 */
  departmentId: string | null;
  requesterId: string;
  actorId: string;
  /** 決裁する人が全体管理者か */
  actorIsAdmin: boolean;
  /** 決裁する人が、申請の部署のオーナーか（会社直属は false） */
  actorOwnsDepartment: boolean;
  /** 申請者が、申請の部署のオーナーか（会社直属は false） */
  requesterOwnsDepartment: boolean;
};

/**
 * 承認・却下できるか。
 * - 会社直属：全体管理者（自己承認も可）
 * - 部署で申請者がその部署のオーナー：全体管理者（任命の有無を問わない。兼任のオーナー本人の自己承認もこれに含む）
 * - 部署でそれ以外：その部署のオーナー（全体管理者は任命された部署のオーナーとしてだけ）
 */
export function canDecideChannelRequest(input: DecisionInput): boolean {
  if (input.departmentId === null) return input.actorIsAdmin;
  if (input.requesterOwnsDepartment) return input.actorIsAdmin;
  return input.actorOwnsDepartment;
}

/** 審査一覧に出るか。決裁できるもの＋オーナーが自部署で出した自分の申請（canApprove=false で出す） */
export function isReviewable(input: DecisionInput): boolean {
  if (canDecideChannelRequest(input)) return true;
  return (
    input.departmentId !== null &&
    input.requesterOwnsDepartment &&
    input.actorOwnsDepartment &&
    input.actorId === input.requesterId
  );
}

/**
 * 申請が届いたときの通知の宛先。申請者本人は除く。
 * 部署：申請者がその部署のオーナーなら全体管理者、それ以外はその部署のオーナー。会社直属：全体管理者。
 */
export function channelRequestReviewerIds(input: {
  departmentId: string | null;
  requesterId: string;
  ownerId: string | null;
  adminId: string | null;
}): string[] {
  const reviewer =
    input.departmentId !== null && input.requesterId !== input.ownerId
      ? input.ownerId
      : input.adminId;
  return reviewer === null || reviewer === input.requesterId ? [] : [reviewer];
}
