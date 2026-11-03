// #119 AC-3：ロールの割り当てから、範囲（会社・部署）ごとの権限の候補を返す Resolver（純粋関数。計画 D-4・改訂版 1・最終の修正 1）。
// 返す値は「この範囲で試してよい操作の候補」であり、「条件付き」の権限の条件は各機能の Service が確かめる。
import { describe, expect, it } from "vitest";
import {
  EXPECTED_GLOBAL_ADMIN,
  EXPECTED_MEMBER,
  EXPECTED_OWNER,
} from "../../test/permission-table.fixture";
import type { Scope } from "../lib/authorization";
import { DEPARTMENT_OWNER_ONLY, ROLE_IDS } from "../lib/permissions";
import { resolvePermissions } from "./permission-resolver";

const DEPT_A = "01JTESTDEPTA0000000000000A";
const DEPT_B = "01JTESTDEPTB0000000000000B";
const company: Scope = { type: "company" };
const deptA: Scope = { type: "department", departmentId: DEPT_A };
const deptB: Scope = { type: "department", departmentId: DEPT_B };

const active = { isActive: true };
const inactive = { isActive: false };

const globalAdmin = {
  roleId: ROLE_IDS.globalAdmin,
  scopeType: "company" as const,
  departmentId: null,
};
const ownerOf = (departmentId: string) => ({
  roleId: ROLE_IDS.owner,
  scopeType: "department" as const,
  departmentId,
});

const sorted = (xs: Iterable<string>) => [...xs].sort();
const union = (...lists: readonly (readonly string[])[]) =>
  sorted(new Set(lists.flat()));
const ownerOnly = new Set<string>(DEPARTMENT_OWNER_ONLY);
const adminInDepartment = EXPECTED_GLOBAL_ADMIN.filter(
  (p) => !ownerOnly.has(p),
);

describe("Resolver（resolvePermissions）", () => {
  describe("無効な利用者", () => {
    it("#119 AC-3: 無効な利用者は、割り当てがあっても、どの範囲でも空集合", () => {
      for (const scope of [company, deptA, deptB]) {
        expect(
          resolvePermissions(inactive, [globalAdmin, ownerOf(DEPT_A)], scope)
            .size,
        ).toBe(0);
        expect(resolvePermissions(inactive, [], scope).size).toBe(0);
      }
    });
  });

  describe("一般メンバー（割り当ての行なし）", () => {
    it("#119 AC-3: 割り当てがない有効な利用者は、会社範囲・どの部署でも一般メンバーの権限だけを持つ", () => {
      for (const scope of [company, deptA, deptB]) {
        expect(sorted(resolvePermissions(active, [], scope))).toEqual(
          sorted(EXPECTED_MEMBER),
        );
      }
    });

    it("#119 AC-3: 一般メンバーは、管理の権限（R-01 アカウントの登録・R-54 部署の管理）と R-45 の候補を持たない", () => {
      for (const scope of [company, deptA]) {
        const got = resolvePermissions(active, [], scope);
        expect(got.has("perm.account.create")).toBe(false);
        expect(got.has("perm.workspace.manage")).toBe(false);
        expect(got.has("perm.channel.request.approve.owner")).toBe(false);
      }
    });
  });

  describe("オーナー（部署範囲の割り当て）", () => {
    it("#119 AC-3: 自分の部署では、オーナーと一般メンバーの権限の和集合を持つ", () => {
      expect(
        sorted(resolvePermissions(active, [ownerOf(DEPT_A)], deptA)),
      ).toEqual(union(EXPECTED_OWNER, EXPECTED_MEMBER));
    });

    it("#119 AC-3: 部署をまたいで効かない：部署Aのオーナーは、部署Bでは一般メンバーの権限だけ（perm.workspace.manage を持たない）", () => {
      const got = resolvePermissions(active, [ownerOf(DEPT_A)], deptB);
      expect(sorted(got)).toEqual(sorted(EXPECTED_MEMBER));
      expect(got.has("perm.workspace.manage")).toBe(false);
    });

    it("#119 AC-3: 部署の割り当ては会社範囲に効かない：会社範囲では一般メンバーの権限だけ", () => {
      expect(
        sorted(resolvePermissions(active, [ownerOf(DEPT_A)], company)),
      ).toEqual(sorted(EXPECTED_MEMBER));
    });

    it("#119 AC-3: オーナーは他部署でも、全員が持つ権限（R-71 perm.announcement.view・R-69 perm.department.channel.view）を持ち、会社範囲で perm.channel.request.create を持つ", () => {
      const inB = resolvePermissions(active, [ownerOf(DEPT_A)], deptB);
      expect(inB.has("perm.announcement.view")).toBe(true);
      expect(inB.has("perm.department.channel.view")).toBe(true);
      expect(
        resolvePermissions(active, [ownerOf(DEPT_A)], company).has(
          "perm.channel.request.create",
        ),
      ).toBe(true);
    });

    it("#119 AC-3: R-45（perm.channel.request.approve.owner）の候補は、自分の部署でだけ持つ", () => {
      expect(
        resolvePermissions(active, [ownerOf(DEPT_A)], deptA).has(
          "perm.channel.request.approve.owner",
        ),
      ).toBe(true);
      expect(
        resolvePermissions(active, [ownerOf(DEPT_A)], deptB).has(
          "perm.channel.request.approve.owner",
        ),
      ).toBe(false);
      expect(
        resolvePermissions(active, [ownerOf(DEPT_A)], company).has(
          "perm.channel.request.approve.owner",
        ),
      ).toBe(false);
    });
  });

  describe("全体管理者（会社範囲の割り当て）", () => {
    it("#119 AC-3: 会社範囲では、全体管理者の権限をすべて持つ", () => {
      expect(
        sorted(resolvePermissions(active, [globalAdmin], company)),
      ).toEqual(union(EXPECTED_GLOBAL_ADMIN, EXPECTED_MEMBER));
    });

    it("#119 AC-3: 任命されていない部署では、DEPARTMENT_OWNER_ONLY の3つを除いた全体管理者の権限を持つ", () => {
      for (const scope of [deptA, deptB]) {
        const got = resolvePermissions(active, [globalAdmin], scope);
        expect(sorted(got)).toEqual(union(adminInDepartment, EXPECTED_MEMBER));
        expect(got.has("perm.workspace.manage")).toBe(false);
        expect(got.has("perm.role.workspace.edit")).toBe(false);
        expect(got.has("perm.role.workspace.assign")).toBe(false);
      }
    });

    it("#119 AC-3: R-45 の候補は、会社範囲と任意の部署（任命の有無によらない）で持つ（最終の修正 1）", () => {
      for (const scope of [company, deptA, deptB]) {
        expect(
          resolvePermissions(active, [globalAdmin], scope).has(
            "perm.channel.request.approve.owner",
          ),
        ).toBe(true);
      }
    });

    it("#119 AC-3・AC-2: オーナーを兼ねる部署では perm.workspace.manage などを持ち、兼ねない部署では持たない（2-1 AC-6・AC-8）", () => {
      const assignments = [globalAdmin, ownerOf(DEPT_A)];
      const inA = resolvePermissions(active, assignments, deptA);
      for (const p of DEPARTMENT_OWNER_ONLY) expect(inA.has(p)).toBe(true);
      expect(sorted(inA)).toEqual(
        union(adminInDepartment, EXPECTED_OWNER, EXPECTED_MEMBER),
      );
      const inB = resolvePermissions(active, assignments, deptB);
      for (const p of DEPARTMENT_OWNER_ONLY) expect(inB.has(p)).toBe(false);
    });

    it("#119 AC-3: 全体管理者でも、初期値で全ロール「不可」の権限（R-29 他人のメッセージの削除）は持たない", () => {
      for (const scope of [company, deptA]) {
        expect(
          resolvePermissions(active, [globalAdmin], scope).has(
            "perm.message.delete.others",
          ),
        ).toBe(false);
      }
    });
  });

  describe("範囲の種類が合わない割り当て・境界", () => {
    it("#119 AC-3: 部署範囲で記録された全体管理者の割り当て（不正な行）は効かない", () => {
      const bad = {
        roleId: ROLE_IDS.globalAdmin,
        scopeType: "department" as const,
        departmentId: DEPT_A,
      };
      for (const scope of [company, deptA, deptB]) {
        expect(sorted(resolvePermissions(active, [bad], scope))).toEqual(
          sorted(EXPECTED_MEMBER),
        );
      }
    });

    it("#119 AC-3: 会社範囲で記録されたオーナーの割り当て（不正な行）は効かない", () => {
      const bad = {
        roleId: ROLE_IDS.owner,
        scopeType: "company" as const,
        departmentId: DEPT_A,
      };
      for (const scope of [company, deptA]) {
        expect(sorted(resolvePermissions(active, [bad], scope))).toEqual(
          sorted(EXPECTED_MEMBER),
        );
      }
    });

    it("#119 AC-3: 部署IDが null のオーナーの割り当ては、どの部署にも効かない", () => {
      const bad = {
        roleId: ROLE_IDS.owner,
        scopeType: "department" as const,
        departmentId: null,
      };
      expect(sorted(resolvePermissions(active, [bad], deptA))).toEqual(
        sorted(EXPECTED_MEMBER),
      );
    });

    it("#119 AC-3: 一般メンバーのロールや知らないロールの割り当ては、権限を増やさない", () => {
      for (const roleId of [ROLE_IDS.member, "role_unknown"]) {
        for (const [scopeType, departmentId] of [
          ["company", null],
          ["department", DEPT_A],
        ] as const) {
          expect(
            sorted(
              resolvePermissions(
                active,
                [{ roleId, scopeType, departmentId }],
                deptA,
              ),
            ),
          ).toEqual(sorted(EXPECTED_MEMBER));
        }
      }
    });

    it("#119 AC-3: 部署IDは完全一致のときだけ効く（前方一致・大文字小文字違いは別の部署）", () => {
      for (const departmentId of [
        DEPT_A.slice(0, -1),
        DEPT_A.toLowerCase(),
        `${DEPT_A}X`,
      ]) {
        expect(
          resolvePermissions(active, [ownerOf(DEPT_A)], {
            type: "department",
            departmentId,
          }).has("perm.workspace.manage"),
        ).toBe(false);
      }
    });

    it("#119 AC-3: 複数の部署のオーナーは、それぞれの部署で効き、どちらでもない部署では効かない（和集合・順序によらない）", () => {
      const DEPT_C = "01JTESTDEPTC0000000000000C";
      for (const assignments of [
        [ownerOf(DEPT_A), ownerOf(DEPT_B)],
        [ownerOf(DEPT_B), ownerOf(DEPT_A)],
      ]) {
        for (const scope of [deptA, deptB]) {
          expect(
            sorted(resolvePermissions(active, assignments, scope)),
          ).toEqual(union(EXPECTED_OWNER, EXPECTED_MEMBER));
        }
        expect(
          sorted(
            resolvePermissions(active, assignments, {
              type: "department",
              departmentId: DEPT_C,
            }),
          ),
        ).toEqual(sorted(EXPECTED_MEMBER));
      }
    });

    it("#119 AC-3: 不正な行が先にあっても、後ろの正しい割り当ては効く", () => {
      const bad = {
        roleId: ROLE_IDS.globalAdmin,
        scopeType: "department" as const,
        departmentId: DEPT_A,
      };
      expect(
        resolvePermissions(active, [bad, globalAdmin], company).has(
          "perm.account.create",
        ),
      ).toBe(true);
      expect(
        resolvePermissions(active, [bad, ownerOf(DEPT_A)], deptA).has(
          "perm.workspace.manage",
        ),
      ).toBe(true);
    });

    it("#119 AC-3: 全体管理者の会社範囲では、DEPARTMENT_OWNER_ONLY の3つも持つ（部署の範囲との境界）", () => {
      const got = resolvePermissions(active, [globalAdmin], company);
      for (const p of DEPARTMENT_OWNER_ONLY) expect(got.has(p)).toBe(true);
    });

    it("#119 AC-3: 全体管理者の部署範囲では、DEPARTMENT_OWNER_ONLY 以外の管理の権限（perm.account.create・perm.audit_log.view）は持つ", () => {
      const got = resolvePermissions(active, [globalAdmin], deptB);
      expect(got.has("perm.account.create")).toBe(true);
      expect(got.has("perm.audit_log.view")).toBe(true);
    });
  });

  it("#119 AC-3: 純粋関数：同じ入力に同じ結果を返し、引数の配列を変えない", () => {
    const assignments = [globalAdmin, ownerOf(DEPT_A)];
    const copy = structuredClone(assignments);
    const a = sorted(resolvePermissions(active, assignments, deptA));
    const b = sorted(resolvePermissions(active, assignments, deptA));
    expect(a).toEqual(b);
    expect(assignments).toEqual(copy);
  });
});
