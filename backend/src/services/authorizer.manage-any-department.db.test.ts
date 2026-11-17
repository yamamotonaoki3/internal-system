// #128（128-c）0-1 AC-20・C-177（U-8）: セッションの permissions に使う canManageAnyDepartment（services/authorizer.ts）を、実際の D1 で確かめる。
// 期待する結果は要件（docs/requirements/permissions.md の R-54：perm.workspace.manage はその部署のオーナーだけ）から決める。
//   真：いずれかの部署の範囲でオーナーの割り当てを持つ有効な社員（所属する部署は問わない。全体管理者を兼ねていてもよい）
//   偽：会社範囲の割り当てだけの全体管理者／一般の社員／割り当てのない社員／存在しない社員／無効な社員（割り当てが残っていても）
// データは架空（testuser_128cmgr_・[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupRoleTestData,
  insertAssignment,
  insertDepartment,
  insertUser,
  testId,
} from "../../test/role-fixtures";
import { ROLE_IDS } from "../lib/permissions";
import { canManageAnyDepartment } from "./authorizer";

afterEach(cleanupRoleTestData);

type Departments = { own: string; other: string };
/** 社員を作って割り当てを入れ、判定する社員のIDを返す（部署は、その社員が所属する own と、所属しない other） */
type Seed = (departments: Departments) => Promise<string>;

const CASES: [string, Seed, boolean][] = [
  [
    "所属する部署のオーナー",
    async (d) => {
      const id = await insertUser("testuser_128cmgr_owner", d.own);
      await insertAssignment(id, ROLE_IDS.owner, "department", d.own);
      return id;
    },
    true,
  ],
  [
    "所属しない部署のオーナーに任命された社員",
    async (d) => {
      const id = await insertUser("testuser_128cmgr_ownerother", d.own);
      await insertAssignment(id, ROLE_IDS.owner, "department", d.other);
      return id;
    },
    true,
  ],
  [
    "全体管理者で、部署のオーナーも兼ねる社員",
    async (d) => {
      const id = await insertUser("testuser_128cmgr_adminowner", d.own);
      await insertAssignment(id, ROLE_IDS.globalAdmin, "company", null);
      await insertAssignment(id, ROLE_IDS.owner, "department", d.other);
      return id;
    },
    true,
  ],
  [
    "部署の範囲の割り当てが一般のロール（role_member）と、オーナーの割り当てを持つ社員",
    async (d) => {
      const id = await insertUser("testuser_128cmgr_mixed", d.own);
      await insertAssignment(id, ROLE_IDS.member, "department", d.own);
      await insertAssignment(id, ROLE_IDS.owner, "department", d.other);
      return id;
    },
    true,
  ],
  [
    "会社の範囲の割り当てだけの全体管理者（部署のオーナーに任命されていない）",
    async (d) => {
      const id = await insertUser("testuser_128cmgr_admin", d.own);
      await insertAssignment(id, ROLE_IDS.globalAdmin, "company", null);
      return id;
    },
    false,
  ],
  [
    "一般の社員（部署の範囲で role_member）",
    async (d) => {
      const id = await insertUser("testuser_128cmgr_member", d.own);
      await insertAssignment(id, ROLE_IDS.member, "department", d.own);
      return id;
    },
    false,
  ],
  [
    "割り当てのない社員",
    (d) => insertUser("testuser_128cmgr_none", d.own),
    false,
  ],
  [
    "無効な社員（オーナーの割り当てが残っている）",
    async (d) => {
      const id = await insertUser("testuser_128cmgr_inactive", d.own, {
        isActive: false,
      });
      await insertAssignment(id, ROLE_IDS.owner, "department", d.own);
      return id;
    },
    false,
  ],
  ["存在しない社員", () => Promise.resolve(testId("NOUSER")), false],
];

describe("#128（128-c）0-1 AC-20 canManageAnyDepartment（D1）", () => {
  it.each(CASES)(
    "#128 0-1 AC-20（U-8）: %s",
    async (_label, seed, expected) => {
      const departments = {
        own: await insertDepartment("128cmgr部署own"),
        other: await insertDepartment("128cmgr部署other"),
      };
      const userId = await seed(departments);
      expect(await canManageAnyDepartment(env, userId)).toBe(expected);
    },
  );

  // 部署の範囲で department_id が null の行は、DB の制約で作れない（ゆえに「部署の範囲なのに部署なし」の分岐には到達しない）
  it("#128 0-1 AC-20: 部署の範囲で department_id が null のオーナーの割り当ては、DB の制約で作れない", async () => {
    const department = await insertDepartment("128cmgr部署own");
    const userId = await insertUser("testuser_128cmgr_nulldept", department);
    await expect(
      insertAssignment(userId, ROLE_IDS.owner, "department", null),
    ).rejects.toThrow();
  });
});
