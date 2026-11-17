// #147（147-A）5-1 AC-21（Q6）・AC-2：案件の管理の資格の純粋な判定（backend/src/lib/case-access-rules.ts）。
// 管理の資格：操作者が有効で、(a) 会社範囲の全体管理者、または (b) 案件の担当部署のどれかのオーナーであること（計画 147-A「管理の資格」）。
// 147-A の canManage・participantCount、147-B の canEditDueDate・納期の変更の判定が、この同じ関数を使う。
// 契約（実装前の仮置き。計画のとおり）：
//   canManageCase({ isActive: boolean; isGlobalAdmin: boolean; ownedDepartmentIds: readonly string[]; caseDepartmentIds: readonly string[] }): boolean
// データは架空の ID（ULID の形）。
import { describe, expect, it } from "vitest";
import { canManageCase } from "./case-access-rules";

const DEPT_S = "01JTESTCASE147AS000000001A";
const DEPT_D = "01JTESTCASE147AD000000001A";
const DEPT_H = "01JTESTCASE147AH000000001A";

type Facts = Parameters<typeof canManageCase>[0];

const facts = (overrides: Partial<Facts>): Facts => ({
  isActive: true,
  isGlobalAdmin: false,
  ownedDepartmentIds: [],
  caseDepartmentIds: [DEPT_S, DEPT_D],
  ...overrides,
});

describe("#147 5-1 AC-21（Q6）管理の資格（canManageCase）", () => {
  it.each<[string, Partial<Facts>, boolean]>([
    [
      "有効な全体管理者（担当部署のオーナーでない）",
      { isGlobalAdmin: true },
      true,
    ],
    ["担当部署の1つ目のオーナー", { ownedDepartmentIds: [DEPT_S] }, true],
    [
      "担当部署の2つ目のオーナー（複数の担当部署のどれか。C-130）",
      { ownedDepartmentIds: [DEPT_D] },
      true,
    ],
    [
      "他部署のオーナー（担当部署のどれのオーナーでもない）",
      { ownedDepartmentIds: [DEPT_H] },
      false,
    ],
    ["一般の社員（オーナーでも全体管理者でもない）", {}, false],
    ["無効な全体管理者", { isActive: false, isGlobalAdmin: true }, false],
    [
      "無効な担当部署のオーナー",
      { isActive: false, ownedDepartmentIds: [DEPT_S] },
      false,
    ],
    [
      "担当部署がない案件では、オーナーの資格は付かない",
      { ownedDepartmentIds: [DEPT_S], caseDepartmentIds: [] },
      false,
    ],
    [
      "担当部署がない案件でも、有効な全体管理者は管理できる",
      { isGlobalAdmin: true, caseDepartmentIds: [] },
      true,
    ],
  ])("#147 5-1 AC-21: %s → %s", (_label, overrides, expected) => {
    expect(canManageCase(facts(overrides))).toBe(expected);
  });
});
