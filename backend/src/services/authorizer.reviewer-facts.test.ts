// #131 AC-7・AC-8（2-2 AC-7・AC-8）：決裁する本人の事実（全体管理者か・オーナーである部署の一覧）を、割り当ての読み込みの結果から導く reviewerFactsOf（services/authorizer.ts）。
// 権限の組み立てを 2 か所にしないため、結果は resolvePermissions と一致しなければならない（計画「認可」・レビュー2回目の指摘 2）。
// 契約（実装者へ）：
//   reviewerFactsOf(found: UserWithAssignments | null): { isAdmin: boolean; ownedDepartmentIds: string[] }
//     isAdmin：resolvePermissions(user, assignments, { type: "company" }).has("perm.channel.request.approve.owner") と同じ
//     ownedDepartmentIds：role_owner かつ scope_type = department の割り当ての department_id（重複なし・順不同）。無効な利用者・存在しない利用者は空
//   canReviewChannelRequests(env, userId, traceId): Promise<boolean>（isAdmin か ownedDepartmentIds が 1 件以上。セッションの permissions に使う）
// ID は架空のもの。
import { describe, expect, it } from "vitest";
import type { UserWithAssignments } from "../db/role-assignment.repository";
import { ROLE_IDS } from "../lib/permissions";
import { reviewerFactsOf } from "./authorizer";
import { resolvePermissions } from "./permission-resolver";

const DEPT_A = "01JTESTCHREQFACTDEPTA0001";
const DEPT_B = "01JTESTCHREQFACTDEPTB0001";
const DEPARTMENTS = [DEPT_A, DEPT_B];

const admin = {
  roleId: ROLE_IDS.globalAdmin,
  scopeType: "company",
  departmentId: null,
} as const;
const ownerOf = (departmentId: string) =>
  ({ roleId: ROLE_IDS.owner, scopeType: "department", departmentId }) as const;

const CASES: [
  string,
  UserWithAssignments | null,
  { isAdmin: boolean; owned: string[] },
][] = [
  [
    "割り当てのないメンバー",
    { user: { isActive: true }, assignments: [] },
    { isAdmin: false, owned: [] },
  ],
  [
    "部署 A のオーナー",
    { user: { isActive: true }, assignments: [ownerOf(DEPT_A)] },
    { isAdmin: false, owned: [DEPT_A] },
  ],
  [
    "全体管理者（任命なし）",
    { user: { isActive: true }, assignments: [admin] },
    { isAdmin: true, owned: [] },
  ],
  [
    "部署 A・B のオーナーを兼ねる全体管理者",
    {
      user: { isActive: true },
      assignments: [admin, ownerOf(DEPT_A), ownerOf(DEPT_B)],
    },
    { isAdmin: true, owned: [DEPT_A, DEPT_B] },
  ],
  [
    "無効な利用者（全体管理者・オーナーの割り当てが残る）",
    { user: { isActive: false }, assignments: [admin, ownerOf(DEPT_A)] },
    { isAdmin: false, owned: [] },
  ],
  [
    "部署範囲になっている全体管理者の割り当て（不正な行）",
    {
      user: { isActive: true },
      assignments: [
        {
          roleId: ROLE_IDS.globalAdmin,
          scopeType: "department",
          departmentId: DEPT_A,
        },
      ],
    },
    { isAdmin: false, owned: [] },
  ],
  [
    "会社範囲になっているオーナーの割り当て（部署範囲でない行）",
    {
      user: { isActive: true },
      assignments: [
        { roleId: ROLE_IDS.owner, scopeType: "company", departmentId: null },
      ],
    },
    { isAdmin: false, owned: [] },
  ],
  [
    "会社範囲だが部署 ID を持つオーナーの割り当て（scope_type が部署でない行は除く）",
    {
      user: { isActive: true },
      assignments: [
        { roleId: ROLE_IDS.owner, scopeType: "company", departmentId: DEPT_A },
      ],
    },
    { isAdmin: false, owned: [] },
  ],
  [
    "部署範囲だが部署 ID が null のオーナーの割り当て（null は部署に数えない）",
    {
      user: { isActive: true },
      assignments: [
        { roleId: ROLE_IDS.owner, scopeType: "department", departmentId: null },
      ],
    },
    { isAdmin: false, owned: [] },
  ],
  [
    "部署範囲の全体管理者の割り当てと、部署 B のオーナー（全体管理者とは数えず、部署 B だけ）",
    {
      user: { isActive: true },
      assignments: [
        {
          roleId: ROLE_IDS.globalAdmin,
          scopeType: "department",
          departmentId: DEPT_A,
        },
        ownerOf(DEPT_B),
      ],
    },
    { isAdmin: false, owned: [DEPT_B] },
  ],
  ["存在しない利用者", null, { isAdmin: false, owned: [] }],
];

describe("#131 AC-7・AC-8 reviewerFactsOf", () => {
  it.each(CASES)("#131 AC-7・AC-8: %s", (_label, found, expected) => {
    const facts = reviewerFactsOf(found);
    expect(facts.isAdmin).toBe(expected.isAdmin);
    expect([...facts.ownedDepartmentIds].sort()).toEqual(
      [...expected.owned].sort(),
    );
  });

  it.each(CASES)(
    "#131 AC-7・AC-8: 結果は resolvePermissions と一致する（%s）",
    (_label, found) => {
      const facts = reviewerFactsOf(found);
      const resolve = (scope: Parameters<typeof resolvePermissions>[2]) =>
        found === null
          ? new Set<string>()
          : resolvePermissions(found.user, found.assignments, scope);
      expect(facts.isAdmin).toBe(
        resolve({ type: "company" }).has("perm.channel.request.approve.owner"),
      );
      for (const departmentId of DEPARTMENTS)
        // その部署のオーナーを兼ねるときだけ効く権限（DEPARTMENT_OWNER_ONLY）の有無が、部署のオーナーであることと一致する
        expect(
          facts.ownedDepartmentIds.includes(departmentId),
          departmentId,
        ).toBe(
          resolve({ type: "department", departmentId }).has(
            "perm.workspace.manage",
          ),
        );
    },
  );

  it("#131 AC-7: 同じ部署の割り当てが 2 行あっても、部署は 1 件にまとめる", () => {
    const facts = reviewerFactsOf({
      user: { isActive: true },
      assignments: [ownerOf(DEPT_A), ownerOf(DEPT_A)],
    });
    expect(facts.ownedDepartmentIds).toEqual([DEPT_A]);
  });
});
