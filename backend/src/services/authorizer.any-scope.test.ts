// #143-b b-AC-1〜b-AC-3（計画 #143-b 5.2・5.5）: 「どこかの範囲で権限を持つか」の判定 canInAnyScope と、セッション用の canManageAnyChannel を、実際の D1 で確かめる。
// 期待は要件（permissions.md R-80 perm.channel.edit・R-81 perm.channel.delete：全体管理者と、その部署のオーナー）と計画 5.2 から決める：
//   真：会社範囲の全体管理者（部署の任命がなくても）／いずれかの部署の範囲でオーナーの割り当てを持つ有効な社員（所属は問わない）
//   偽：一般の社員／割り当てのない社員／会社でない範囲に置かれた全体管理者のロール／存在しない社員／無効な社員（割り当てが残っていても）
// 実装が前提とする約束（実装前。報告に明記）：
//   canInAnyScope(repository: RoleAssignmentRepository, userId: string, permission: Permission): Promise<boolean>
//   canManageAnyChannel(env: Env, userId: string, permission: Permission): Promise<boolean>（表示用。拒否の監査は出さない）
// データは架空（testuser_143bany_・[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { withRoleAssignments } from "../db/role-assignment.repository";
import {
  cleanupRoleTestData,
  insertAssignment,
  insertDepartment,
  insertUser,
  testId,
} from "../../test/role-fixtures";
import { ROLE_IDS, type Permission } from "../lib/permissions";
import { canInAnyScope, canManageAnyChannel } from "./authorizer";

afterEach(cleanupRoleTestData);

type Departments = { own: string; other: string };
/** 社員を作って割り当てを入れ、判定する社員の ID を返す */
type Seed = (departments: Departments) => Promise<string>;

const CASES: [string, Seed, boolean][] = [
  [
    "会社範囲の全体管理者（部署の任命なし）",
    async (d) => {
      const id = await insertUser("testuser_143bany_admin", d.own);
      await insertAssignment(id, ROLE_IDS.globalAdmin, "company", null);
      return id;
    },
    true,
  ],
  [
    "所属する部署のオーナー",
    async (d) => {
      const id = await insertUser("testuser_143bany_owner", d.own);
      await insertAssignment(id, ROLE_IDS.owner, "department", d.own);
      return id;
    },
    true,
  ],
  [
    "所属しない部署のオーナーに任命された社員",
    async (d) => {
      const id = await insertUser("testuser_143bany_ownerother", d.own);
      await insertAssignment(id, ROLE_IDS.owner, "department", d.other);
      return id;
    },
    true,
  ],
  [
    "一般の社員（部署の範囲で role_member）",
    async (d) => {
      const id = await insertUser("testuser_143bany_member", d.own);
      await insertAssignment(id, ROLE_IDS.member, "department", d.own);
      return id;
    },
    false,
  ],
  [
    "割り当てのない社員",
    async (d) => insertUser("testuser_143bany_none", d.own),
    false,
  ],
  [
    "全体管理者のロールが部署の範囲に置かれた社員（会社の範囲でない）",
    async (d) => {
      const id = await insertUser("testuser_143bany_deptadmin", d.own);
      await insertAssignment(id, ROLE_IDS.globalAdmin, "department", d.own);
      return id;
    },
    false,
  ],
  [
    "無効な全体管理者（割り当てが残っている）",
    async (d) => {
      const id = await insertUser("testuser_143bany_inactadmin", d.own, {
        isActive: false,
      });
      await insertAssignment(id, ROLE_IDS.globalAdmin, "company", null);
      return id;
    },
    false,
  ],
  [
    "無効なオーナー（割り当てが残っている）",
    async (d) => {
      const id = await insertUser("testuser_143bany_inactowner", d.own, {
        isActive: false,
      });
      await insertAssignment(id, ROLE_IDS.owner, "department", d.own);
      return id;
    },
    false,
  ],
  ["存在しない社員", async () => testId("NOUSER"), false],
];

const ROWS = CASES.map(([label, make, expected]) => ({
  label,
  make,
  expected,
}));

const PERMISSIONS: Permission[] = ["perm.channel.edit", "perm.channel.delete"];

async function seed(make: Seed) {
  const own = await insertDepartment("143b権限の所属部署");
  const other = await insertDepartment("143b権限の担当部署");
  return make({ own, other });
}

describe("#143-b b-AC-3: canInAnyScope（どこかの範囲で権限を持つか）", () => {
  for (const permission of PERMISSIONS) {
    it.each(ROWS)(
      `#143-b b-AC-3: $label → ${permission} を持つ: $expected`,
      async ({ make, expected }) => {
        const userId = await seed(make);
        expect(
          await withRoleAssignments(env, (repository) =>
            canInAnyScope(repository, userId, permission),
          ),
        ).toBe(expected);
      },
    );
  }

  it("#143-b b-AC-3: どの範囲でも一般の社員が持つ権限（perm.channel.public.join）は、一般の社員でも真（権限の判定を resolvePermissions に任せていること）", async () => {
    const userId = await seed(async (d) =>
      insertUser("testuser_143bany_general", d.own),
    );
    expect(
      await withRoleAssignments(env, (repository) =>
        canInAnyScope(repository, userId, "perm.channel.public.join"),
      ),
    ).toBe(true);
  });
});

describe("#143-b b-AC-1・b-AC-2: canManageAnyChannel（セッションの permissions 用）", () => {
  for (const permission of PERMISSIONS) {
    it.each(ROWS)(
      `#143-b b-AC-1・b-AC-2: $label → ${permission} の入口を出す: $expected`,
      async ({ make, expected }) => {
        const userId = await seed(make);
        expect(await canManageAnyChannel(env, userId, permission)).toBe(
          expected,
        );
      },
    );
  }
});

// #143-b ミューテーションの生き残り（authorizer.ts の canInAnyScope）への追加。割り当ての読み込みは代役にし、範囲の作り方を確かめる。
describe("#143-b b-AC-3: canInAnyScope の範囲の作り方（代役の割り当て）", () => {
  type Row = {
    roleId: string;
    scopeType: "company" | "department";
    departmentId: string | null;
  };
  const DEPT = "01JTESTANYSCOPEDEPT0000001";
  const fake = (assignments: Row[], isActive = true) => ({
    findByUserId: async () => ({ user: { isActive }, assignments }),
  });

  it("#143-b b-AC-3: 会社の範囲で持つ人は、部署の範囲でだけ効く権限（perm.workspace.manage）でも真（会社の範囲 { type: company } で判定する）", async () => {
    expect(
      await canInAnyScope(
        fake([
          {
            roleId: ROLE_IDS.globalAdmin,
            scopeType: "company",
            departmentId: null,
          },
        ]),
        "01JTESTANYSCOPEUSER0000001",
        "perm.workspace.manage",
      ),
    ).toBe(true);
  });

  it("#143-b b-AC-3: 部署の範囲の割り当てでも、その権限を持たないロール（一般のメンバー）は偽", async () => {
    expect(
      await canInAnyScope(
        fake([
          {
            roleId: ROLE_IDS.member,
            scopeType: "department",
            departmentId: DEPT,
          },
        ]),
        "01JTESTANYSCOPEUSER0000001",
        "perm.channel.edit",
      ),
    ).toBe(false);
  });

  it("#143-b b-AC-3: 部署の範囲なのに部署の ID がない割り当て（DB の制約 user_role_assignments_scope_check で作れない形）は、オーナーのロールでも数えない", async () => {
    expect(
      await canInAnyScope(
        fake([
          {
            roleId: ROLE_IDS.owner,
            scopeType: "department",
            departmentId: null,
          },
        ]),
        "01JTESTANYSCOPEUSER0000001",
        "perm.channel.edit",
      ),
    ).toBe(false);
  });

  it("#143-b b-AC-3: 部署の範囲で部署の ID がない行は、DB の制約で入れられない", async () => {
    const userId = await insertUser(
      "testuser_143bany_nulldept",
      await insertDepartment("143b権限の制約部署"),
    );
    const error = await insertAssignment(
      userId,
      ROLE_IDS.owner,
      "department",
      null,
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
  });
});
