// #147（147-B）5-1 AC-3・AC-7、C-133・C-134、C-182 Q1・Q2：自動参加の人の判定と、参加者を外せるかの判定（純粋関数）。
// 期待値は計画 147-B の「用語」と決定 Q1（自動参加の人も有効な参加者に数える）・Q2（自動参加の人は本人の退出もできない）から決める。
// 契約（実装前の仮置き。計画 147-B の用語。実装の担当へ）：backend/src/lib/case-participant-rules.ts
//   autoRoleOf({ isActive, isGlobalAdmin, ownedDepartmentIds, caseDepartmentIds }): "global_admin" | "department_owner" | null
//     有効で、全体管理者なら global_admin（オーナーでもあるときも global_admin）。有効で、案件の担当部署のどれかのオーナーなら department_owner。
//     それ以外（無効・他部署だけのオーナー・一般）は null。
//   canRemoveParticipant({ targetAutoRole, activeCountAfter }): boolean
//     自動参加の人（targetAutoRole が null でない）は外せない。外した後の有効な参加者が0人になるなら外せない。
// 注意（実装の担当へ）：書き込みの前提（batch の SQL）にも同じ判定を持つ。この関数を、最初の判定（decideRemove）と詳細の応答の removable で
//   本番のコードから使うこと。使わない設計にする場合は、このテストを消すのではなく統括に報告する（147-A のやり直しの先例）。
import { describe, expect, it } from "vitest";
import { autoRoleOf, canRemoveParticipant } from "./case-participant-rules";

const DEPT_S = "01JTESTCASE147BDEPTS000001";
const DEPT_D = "01JTESTCASE147BDEPTD000001";
const DEPT_H = "01JTESTCASE147BDEPTH000001";

describe("#147 147-B 5-1 AC-7・C-133・C-134: 自動参加の人の判定（autoRoleOf）", () => {
  it.each([
    {
      label: "有効な全体管理者（どの部署のオーナーでもない）は global_admin",
      input: { isActive: true, isGlobalAdmin: true, ownedDepartmentIds: [] },
      expected: "global_admin",
    },
    {
      label: "有効な担当部署のオーナーは department_owner",
      input: {
        isActive: true,
        isGlobalAdmin: false,
        ownedDepartmentIds: [DEPT_S],
      },
      expected: "department_owner",
    },
    {
      label: "複数の担当部署のうち、2つ目の部署のオーナーでも department_owner",
      input: {
        isActive: true,
        isGlobalAdmin: false,
        ownedDepartmentIds: [DEPT_D],
      },
      expected: "department_owner",
    },
    {
      label: "他部署（担当部署でない）のオーナーは null",
      input: {
        isActive: true,
        isGlobalAdmin: false,
        ownedDepartmentIds: [DEPT_H],
      },
      expected: null,
    },
    {
      label: "一般の社員は null",
      input: { isActive: true, isGlobalAdmin: false, ownedDepartmentIds: [] },
      expected: null,
    },
    {
      label: "全体管理者で、担当部署のオーナーでもあるときは global_admin",
      input: {
        isActive: true,
        isGlobalAdmin: true,
        ownedDepartmentIds: [DEPT_S],
      },
      expected: "global_admin",
    },
    {
      label: "無効な社員は、全体管理者・オーナーの割り当てが残っていても null",
      input: {
        isActive: false,
        isGlobalAdmin: true,
        ownedDepartmentIds: [DEPT_S],
      },
      expected: null,
    },
    {
      label: "無効な担当部署のオーナーは null",
      input: {
        isActive: false,
        isGlobalAdmin: false,
        ownedDepartmentIds: [DEPT_S],
      },
      expected: null,
    },
  ])("#147 147-B C-133・C-134: $label", ({ input, expected }) => {
    expect(autoRoleOf({ ...input, caseDepartmentIds: [DEPT_S, DEPT_D] })).toBe(
      expected,
    );
  });

  it("#147 147-B C-133: 担当部署から外れた（案件の担当部署にない）部署のオーナーは null", () => {
    expect(
      autoRoleOf({
        isActive: true,
        isGlobalAdmin: false,
        ownedDepartmentIds: [DEPT_S],
        caseDepartmentIds: [DEPT_D],
      }),
    ).toBeNull();
  });
});

describe("#147 147-B 5-1 AC-3・Q1・Q2: 参加者を外せるか（canRemoveParticipant）", () => {
  it.each([
    {
      label: "一般の参加者で、外した後も有効な参加者が1人いれば外せる",
      input: { targetAutoRole: null, activeCountAfter: 1 },
      expected: true,
    },
    {
      label:
        "一般の参加者でも、外すと有効な参加者が0人になるなら外せない（Q1）",
      input: { targetAutoRole: null, activeCountAfter: 0 },
      expected: false,
    },
    {
      label: "担当部署のオーナー（自動参加）は外せない（本人の退出も。Q2）",
      input: { targetAutoRole: "department_owner", activeCountAfter: 3 },
      expected: false,
    },
    {
      label: "全体管理者（自動参加）は外せない（本人の退出も。Q2）",
      input: { targetAutoRole: "global_admin", activeCountAfter: 3 },
      expected: false,
    },
  ] as const)("#147 147-B: $label", ({ input, expected }) => {
    expect(canRemoveParticipant(input)).toBe(expected);
  });
});
