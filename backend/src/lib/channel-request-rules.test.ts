// #131 AC-7・AC-8・AC-10（2-2 AC-7・AC-8・AC-10）・3-4 AC-1・AC-3：チャンネルの作成申請の認可と通知の宛先の純粋関数（backend/src/lib/channel-request-rules.ts）。
// 期待値は要件の表（2-2 AC-7・AC-8・AC-10、権限表 L-1・M-1・O-5、3-4 AC-1・AC-3）から決める。実装と同じ式から導かない。
// 契約（実装者へ。計画「認可」「通知」）：
//  type DecisionInput = {
//    departmentId: string | null;      // null は会社直属
//    requesterId: string; actorId: string;
//    actorIsAdmin: boolean;            // 決裁する人が全体管理者か
//    actorOwnsDepartment: boolean;     // 決裁する人が、申請の部署のオーナーか（会社直属は false）
//    requesterOwnsDepartment: boolean; // 申請者が、申請の部署のオーナーか（会社直属は false）
//  }
//  canDecideChannelRequest(input): boolean   承認・却下できるか
//  isReviewable(input): boolean              審査一覧（EP-2-09）に出るか。canDecide が true のもの＋「オーナーが自部署で出した自分の申請」（canApprove=false で出す）
//  channelRequestReviewerIds({ departmentId, requesterId, ownerId: string | null, adminId: string | null }): string[]
//    申請が届いたときの通知の宛先。部署：申請者がその部署のオーナーなら全体管理者、それ以外はその部署のオーナー。会社直属：全体管理者。申請者本人は除く
// ID は架空のもの。
import { describe, expect, it } from "vitest";
import {
  canDecideChannelRequest,
  channelRequestReviewerIds,
  isReviewable,
} from "./channel-request-rules";

const DEPT = "01JTESTCHREQDEPT000000001";
const REQUESTER = "01JTESTCHREQREQUESTER0001";
const OTHER = "01JTESTCHREQOTHER00000001";
const OWNER = "01JTESTCHREQOWNER00000001";
const ADMIN = "01JTESTCHREQADMIN00000001";

type Input = Parameters<typeof canDecideChannelRequest>[0];

const input = (overrides: Partial<Input>): Input => ({
  departmentId: DEPT,
  requesterId: REQUESTER,
  actorId: OTHER,
  actorIsAdmin: false,
  actorOwnsDepartment: false,
  requesterOwnsDepartment: false,
  ...overrides,
});

// [説明, 入力, 承認・却下できるか, 審査一覧に出るか]
const TABLE: [string, Partial<Input>, boolean, boolean][] = [
  // 部署のチャンネル・一般社員の申請（2-2 AC-7）
  [
    "部署・一般社員の申請を、その部署のオーナーが",
    { actorOwnsDepartment: true },
    true,
    true,
  ],
  [
    "部署・一般社員の申請を、任命された（オーナーを兼ねる）全体管理者が",
    { actorOwnsDepartment: true, actorIsAdmin: true },
    true,
    true,
  ],
  [
    "部署・一般社員の申請を、任命されていない全体管理者が",
    { actorIsAdmin: true },
    false,
    false,
  ],
  [
    "部署・一般社員の申請を、メンバー（他部署のオーナーを含む）が",
    {},
    false,
    false,
  ],
  [
    "部署・一般社員の申請を、申請者本人（メンバー）が",
    { actorId: REQUESTER },
    false,
    false,
  ],
  // 部署のチャンネル・オーナー自身の申請（2-2 AC-8）
  [
    "部署・オーナー自身の申請を、そのオーナー本人が",
    {
      actorId: REQUESTER,
      actorOwnsDepartment: true,
      requesterOwnsDepartment: true,
    },
    false,
    true,
  ],
  [
    "部署・オーナー自身の申請を、任命されていない全体管理者が",
    { actorIsAdmin: true, requesterOwnsDepartment: true },
    true,
    true,
  ],
  [
    "部署・オーナー自身の申請を、全体管理者を兼ねるそのオーナー本人が（自己承認）",
    {
      actorId: REQUESTER,
      actorIsAdmin: true,
      actorOwnsDepartment: true,
      requesterOwnsDepartment: true,
    },
    true,
    true,
  ],
  [
    "部署・オーナー自身の申請を、全体管理者でない他人が",
    { requesterOwnsDepartment: true },
    false,
    false,
  ],
  // 会社直属（2-2 AC-10）
  [
    "会社直属・一般社員の申請を、全体管理者が",
    { departmentId: null, actorIsAdmin: true },
    true,
    true,
  ],
  [
    "会社直属・全体管理者自身の申請を、その全体管理者が（自己承認）",
    { departmentId: null, actorId: REQUESTER, actorIsAdmin: true },
    true,
    true,
  ],
  [
    "会社直属・一般社員の申請を、全体管理者でない人（オーナーを含む）が",
    { departmentId: null },
    false,
    false,
  ],
  [
    "会社直属・申請者本人（全体管理者でない）が",
    { departmentId: null, actorId: REQUESTER },
    false,
    false,
  ],
  // 実際には起きない組み合わせでも、審査一覧の例外（オーナーが自部署で出した自分の申請）の条件を 1 つずつ外すと出ない
  [
    "会社直属で、オーナーの印がすべて立った申請者本人が（会社直属にはオーナーの例外を当てない）",
    {
      departmentId: null,
      actorId: REQUESTER,
      actorOwnsDepartment: true,
      requesterOwnsDepartment: true,
    },
    false,
    false,
  ],
  [
    "部署・オーナー自身の申請を、申請者でない人（オーナーの印あり・全体管理者でない）が",
    { actorOwnsDepartment: true, requesterOwnsDepartment: true },
    false,
    false,
  ],
];

describe("#131 AC-7・AC-8・AC-10 canDecideChannelRequest・isReviewable", () => {
  it.each(TABLE)(
    "#131 AC-7・AC-8・AC-10（2-2 AC-7・AC-8・AC-10）: %s → 決裁 %s・一覧 %s",
    (_label, overrides, decide, reviewable) => {
      expect(canDecideChannelRequest(input(overrides))).toBe(decide);
      expect(isReviewable(input(overrides))).toBe(reviewable);
    },
  );

  it("#131 AC-7: 決裁できるものは、必ず審査一覧にも出る（canDecide ⊆ isReviewable）", () => {
    const flags = [true, false];
    for (const departmentId of [DEPT, null])
      for (const actorId of [REQUESTER, OTHER])
        for (const actorIsAdmin of flags)
          for (const actorOwnsDepartment of flags)
            for (const requesterOwnsDepartment of flags) {
              const value = input({
                departmentId,
                actorId,
                actorIsAdmin,
                actorOwnsDepartment,
                requesterOwnsDepartment,
              });
              if (canDecideChannelRequest(value))
                expect(isReviewable(value), JSON.stringify(value)).toBe(true);
            }
  });
});

describe("#131 3-4 AC-1・AC-3 channelRequestReviewerIds（申請が届いたときの宛先）", () => {
  it.each<[string, Parameters<typeof channelRequestReviewerIds>[0], string[]]>([
    [
      "部署・一般社員の申請 → その部署のオーナー",
      {
        departmentId: DEPT,
        requesterId: REQUESTER,
        ownerId: OWNER,
        adminId: ADMIN,
      },
      [OWNER],
    ],
    [
      "部署・オーナー自身の申請 → 全体管理者",
      {
        departmentId: DEPT,
        requesterId: OWNER,
        ownerId: OWNER,
        adminId: ADMIN,
      },
      [ADMIN],
    ],
    [
      "部署・全体管理者を兼ねるオーナー自身の申請 → 誰にも送らない（本人を除く）",
      {
        departmentId: DEPT,
        requesterId: ADMIN,
        ownerId: ADMIN,
        adminId: ADMIN,
      },
      [],
    ],
    [
      "部署・全体管理者（その部署のオーナーではない）の申請 → その部署のオーナー",
      {
        departmentId: DEPT,
        requesterId: ADMIN,
        ownerId: OWNER,
        adminId: ADMIN,
      },
      [OWNER],
    ],
    [
      "会社直属・一般社員の申請 → 全体管理者",
      {
        departmentId: null,
        requesterId: REQUESTER,
        ownerId: null,
        adminId: ADMIN,
      },
      [ADMIN],
    ],
    [
      "会社直属・全体管理者自身の申請 → 誰にも送らない",
      { departmentId: null, requesterId: ADMIN, ownerId: null, adminId: ADMIN },
      [],
    ],
    [
      "部署にオーナーがいない → 誰にも送らない",
      {
        departmentId: DEPT,
        requesterId: REQUESTER,
        ownerId: null,
        adminId: ADMIN,
      },
      [],
    ],
    [
      "会社直属で全体管理者がいない → 誰にも送らない",
      {
        departmentId: null,
        requesterId: REQUESTER,
        ownerId: null,
        adminId: null,
      },
      [],
    ],
    [
      "会社直属では、部署のオーナーが渡されても送らない",
      {
        departmentId: null,
        requesterId: REQUESTER,
        ownerId: OWNER,
        adminId: ADMIN,
      },
      [ADMIN],
    ],
  ])("#131 3-4 AC-1・AC-3: %s", (_label, value, expected) => {
    expect(channelRequestReviewerIds(value)).toEqual(expected);
  });
});
