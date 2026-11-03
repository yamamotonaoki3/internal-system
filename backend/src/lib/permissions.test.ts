// #119 AC-3：第1段階のロール（固定の3つ）とその権限が、権限表（docs/requirements/permissions.md 3章）のとおりに定義されている。
// 期待値は権限表から写した backend/test/permission-table.fixture.ts を使う（実装から決めない）。
import { describe, expect, it } from "vitest";
import {
  EXPECTED_GLOBAL_ADMIN,
  EXPECTED_MEMBER,
  EXPECTED_NO_ROLE,
  EXPECTED_OWNER,
  EXPECTED_PERMISSION_IDS,
} from "../../test/permission-table.fixture";
import {
  DEPARTMENT_OWNER_ONLY,
  INITIAL_ROLE_PERMISSIONS,
  PERMISSIONS,
  ROLE_IDS,
  type Permission,
} from "./permissions";

const sorted = (xs: readonly string[]) => [...xs].sort();

describe("権限IDの一覧（PERMISSIONS）", () => {
  it("#119 AC-3: 権限表の67種類と、過不足なく一致する", () => {
    expect(PERMISSIONS).toHaveLength(67);
    expect(sorted(PERMISSIONS)).toEqual(sorted(EXPECTED_PERMISSION_IDS));
  });

  it("#119 AC-3: 重複がない", () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it("#119 AC-3: すべて perm.<領域>... の形で、権限を持たない行（—）を含まない", () => {
    for (const p of PERMISSIONS) expect(p).toMatch(/^perm\.[a-z0-9_.]+$/);
    expect(PERMISSIONS as readonly string[]).not.toContain("—");
  });
});

describe("ロールのID（ROLE_IDS）", () => {
  it("#119 AC-3: 第1段階の固定の3つのロール", () => {
    expect(ROLE_IDS).toEqual({
      member: "role_member",
      owner: "role_owner",
      globalAdmin: "role_global_admin",
    });
  });
});

describe("初期のロールの権限（INITIAL_ROLE_PERMISSIONS）", () => {
  it("#119 AC-3: 3つのロールだけを持つ", () => {
    expect(sorted(Object.keys(INITIAL_ROLE_PERMISSIONS))).toEqual(
      sorted(Object.values(ROLE_IDS)),
    );
  });

  it("#119 AC-3: 一般メンバーは、権限表のメンバーの列が「可」「条件付き」の権限と一致する", () => {
    expect(sorted(INITIAL_ROLE_PERMISSIONS[ROLE_IDS.member])).toEqual(
      sorted(EXPECTED_MEMBER),
    );
  });

  it("#119 AC-3: オーナーは、権限表のオーナーの列が「可」「条件付き」の権限と一致する", () => {
    expect(sorted(INITIAL_ROLE_PERMISSIONS[ROLE_IDS.owner])).toEqual(
      sorted(EXPECTED_OWNER),
    );
  });

  it("#119 AC-3: 全体管理者は、権限表の全体管理者の列が「可」「条件付き」の権限と一致する", () => {
    expect(sorted(INITIAL_ROLE_PERMISSIONS[ROLE_IDS.globalAdmin])).toEqual(
      sorted(EXPECTED_GLOBAL_ADMIN),
    );
  });

  it("#119 AC-3: 各ロールの権限に重複がなく、すべて PERMISSIONS に含まれる", () => {
    const known = new Set<string>(PERMISSIONS);
    for (const list of Object.values(INITIAL_ROLE_PERMISSIONS)) {
      expect(new Set(list).size).toBe(list.length);
      for (const p of list) expect(known.has(p)).toBe(true);
    }
  });

  it("#119 AC-3: 初期値で全ロール「不可」の権限（他人のメッセージ・添付の削除、他人のリアクションの削除）は、どのロールも持たない", () => {
    for (const list of Object.values(INITIAL_ROLE_PERMISSIONS)) {
      for (const p of EXPECTED_NO_ROLE)
        expect(list as readonly string[]).not.toContain(p);
    }
  });

  // 権限表の代表行（個別に確かめる）
  it.each<[string, Permission, boolean, boolean, boolean]>([
    ["R-01 アカウントの登録", "perm.account.create", false, false, true],
    ["R-05 ログイン", "perm.auth.login", true, true, true],
    ["R-13 本名の変更", "perm.employee.legal_name.edit", false, false, true],
    ["R-14 本名の閲覧", "perm.employee.legal_name.view", true, true, true],
    ["R-15 監査ログの閲覧", "perm.audit_log.view", false, false, true],
    ["R-21 部署のロールの編集", "perm.role.workspace.edit", false, true, true],
    [
      "R-45 チャンネル作成の承認",
      "perm.channel.request.approve.owner",
      false,
      true,
      true,
    ],
    ["R-54 部署の管理", "perm.workspace.manage", false, true, true],
    ["R-84 物理削除", "perm.deleted.purge", false, false, true],
    [
      "R-29 他人のメッセージの削除",
      "perm.message.delete.others",
      false,
      false,
      false,
    ],
  ])(
    "#119 AC-3: 代表行 %s（%s）：メンバー=%s・オーナー=%s・全体管理者=%s",
    (_label, permission, member, owner, admin) => {
      const has = (role: string) =>
        (
          INITIAL_ROLE_PERMISSIONS[
            role as keyof typeof INITIAL_ROLE_PERMISSIONS
          ] as readonly string[]
        ).includes(permission);
      expect(has(ROLE_IDS.member)).toBe(member);
      expect(has(ROLE_IDS.owner)).toBe(owner);
      expect(has(ROLE_IDS.globalAdmin)).toBe(admin);
    },
  );
});

describe("部署のオーナーだけが部署の範囲で持つ権限（DEPARTMENT_OWNER_ONLY）", () => {
  it("#119 AC-3: perm.workspace.manage（R-54）・perm.role.workspace.edit（R-21）・perm.role.workspace.assign（R-22）の3つ（R-45 は含めない）", () => {
    expect(sorted(DEPARTMENT_OWNER_ONLY)).toEqual(
      sorted([
        "perm.workspace.manage",
        "perm.role.workspace.edit",
        "perm.role.workspace.assign",
      ]),
    );
    expect(DEPARTMENT_OWNER_ONLY as readonly string[]).not.toContain(
      "perm.channel.request.approve.owner",
    );
  });
});
