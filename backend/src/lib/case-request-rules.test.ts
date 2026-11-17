// #146（146-A）3-4 AC-1・AC-3、利用者の決定 Q3：案件の作成申請が届いた通知の宛先（lib/case-request-rules.ts）。
// 期待値は Q3（担当部署の有効なオーナーから申請者本人を除く。その集合が空のときだけ、有効な全体管理者から本人を除く）から決める。
// 契約（実装前の仮置き。計画 A-3）：
//   caseRequestSubmittedRecipients({ requesterId, ownerIds, adminIds }): string[]
//     ownerIds は担当部署の有効なオーナー（重複を含みうる）、adminIds は有効な全体管理者。重複は除く。順は問わない。
import { describe, expect, it } from "vitest";
import {
  canDecideCaseRequest,
  caseRequestSubmittedRecipients,
  type CaseDecisionInput,
} from "./case-request-rules";

const REQUESTER = "01JTESTCASEREQUSER0000001";
const OWNER_1 = "01JTESTCASEREQUSER0000002";
const OWNER_2 = "01JTESTCASEREQUSER0000003";
const ADMIN = "01JTESTCASEREQUSER0000004";

const recipients = (input: {
  requesterId: string;
  ownerIds: string[];
  adminIds: string[];
}) => [...caseRequestSubmittedRecipients(input)].sort();

describe("#146 3-4 AC-1・AC-3（Q3）申請が届いた通知の宛先", () => {
  it("#146 3-4 AC-1（Q3）: オーナーがいれば、オーナーだけに送る（全体管理者には送らない）", () => {
    expect(
      recipients({
        requesterId: REQUESTER,
        ownerIds: [OWNER_1, OWNER_2],
        adminIds: [ADMIN],
      }),
    ).toEqual([OWNER_1, OWNER_2].sort());
  });

  it("#146 3-4 AC-3（Q3）: 申請者本人がオーナーでも、本人には送らない（ほかのオーナーには送る）", () => {
    expect(
      recipients({
        requesterId: OWNER_1,
        ownerIds: [OWNER_1, OWNER_2],
        adminIds: [ADMIN],
      }),
    ).toEqual([OWNER_2]);
  });

  it("#146 3-4 AC-1（Q3）: オーナーが申請者本人だけなら、全体管理者に送る", () => {
    expect(
      recipients({
        requesterId: OWNER_1,
        ownerIds: [OWNER_1],
        adminIds: [ADMIN],
      }),
    ).toEqual([ADMIN]);
  });

  it("#146 3-4 AC-1（Q3）: オーナーがいなければ全体管理者に送る", () => {
    expect(
      recipients({ requesterId: REQUESTER, ownerIds: [], adminIds: [ADMIN] }),
    ).toEqual([ADMIN]);
  });

  it("#146 3-4 AC-3（Q3）: 全体管理者に切り替わっても、申請者本人の全体管理者には送らない（宛先は空）", () => {
    expect(
      recipients({ requesterId: ADMIN, ownerIds: [], adminIds: [ADMIN] }),
    ).toEqual([]);
  });

  it("#146 3-4 AC-1: 同じオーナーが複数の担当部署に重なっても1件にする", () => {
    expect(
      recipients({
        requesterId: REQUESTER,
        ownerIds: [OWNER_1, OWNER_1, OWNER_2],
        adminIds: [ADMIN],
      }),
    ).toEqual([OWNER_1, OWNER_2].sort());
  });
});

// #146（146-B）5-3 AC-3・AC-4：決裁（承認・却下）できるかの判定（ミューテーションの生き残りへの対応）
// 期待値は 5-3 AC-3（全体管理者か担当部署のオーナーだけが審査の範囲）・AC-4（全体管理者でなければ自分の申請は決裁できない）から決める。
// 状態（承認待ちか）は純粋な判定の材料に入れず、Service の canApprove（status が pending）と batch の版の確認で扱う。
describe("#146 5-3 AC-3・AC-4 canDecideCaseRequest", () => {
  const DEPT_A = "01JTESTCASEDECDPTA00000001";
  const DEPT_B = "01JTESTCASEDECDPTB00000001";
  const decision = (
    overrides: Partial<CaseDecisionInput> = {},
  ): CaseDecisionInput => ({
    departmentIds: [DEPT_A],
    requesterId: REQUESTER,
    actorId: OWNER_1,
    actorIsAdmin: false,
    actorOwnedDepartmentIds: [DEPT_A],
    ...overrides,
  });

  it("#146 5-3 AC-3: 担当部署のオーナーで、申請者でなければ決裁できる", () => {
    expect(canDecideCaseRequest(decision())).toBe(true);
  });

  it("#146 5-3 AC-3: 担当部署のどれのオーナーでもない人（全体管理者でもない）は、申請者本人でなくても決裁できない", () => {
    expect(
      canDecideCaseRequest(decision({ actorOwnedDepartmentIds: [DEPT_B] })),
    ).toBe(false);
    expect(
      canDecideCaseRequest(decision({ actorOwnedDepartmentIds: [] })),
    ).toBe(false);
  });

  it("#146 5-3 AC-4: 全体管理者でないオーナーは、自分の申請を決裁できない", () => {
    expect(canDecideCaseRequest(decision({ requesterId: OWNER_1 }))).toBe(
      false,
    );
  });

  it("#146 5-3 AC-4: 全体管理者は、部署のオーナーでなくても決裁でき、自分の申請も決裁できる", () => {
    const admin = {
      actorIsAdmin: true,
      actorOwnedDepartmentIds: [],
    } as const;
    expect(canDecideCaseRequest(decision(admin))).toBe(true);
    expect(
      canDecideCaseRequest(decision({ ...admin, requesterId: OWNER_1 })),
    ).toBe(true);
  });

  it("#146 5-3 AC-3: 複数の担当部署のうち、片方のオーナーなら決裁できる", () => {
    expect(
      canDecideCaseRequest(
        decision({
          departmentIds: [DEPT_A, DEPT_B],
          actorOwnedDepartmentIds: [DEPT_B],
        }),
      ),
    ).toBe(true);
  });
});
