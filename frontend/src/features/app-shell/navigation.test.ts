// #121 AC-1・AC-3：navigation.ts（サイドバーの項目の定義の唯一の登録場所）と visibleAdminGroups（権限で絞る純粋関数）。
// 公開形の仮定：visibleAdminGroups(groups, permissions: ReadonlySet<string>) は、権限のある項目だけを残し、項目が0件のまとまりは除く。
// 入力を書き換えない。adminNavGroups は 承認・アカウント・部署・マスタ/ログ の4つのまとまり（id: approval・account・department・master-log）。
import { describe, expect, it } from "vitest";
import {
  adminNavGroups,
  primaryNavItems,
  visibleAdminGroups,
  type AdminNavGroup,
} from "./navigation";

const groups: AdminNavGroup[] = [
  {
    id: "approval",
    label: "テスト承認",
    items: [
      {
        id: "t-approval-1",
        label: "テスト承認A",
        to: "/test/approval-a",
        requires: "perm.workspace.manage",
      },
    ],
  },
  {
    id: "account",
    label: "テストアカウント",
    items: [
      {
        id: "t-account-1",
        label: "テストアカウントA",
        to: "/test/account-a",
        requires: "perm.role.assign",
      },
      {
        id: "t-account-2",
        label: "テストアカウントB",
        to: "/test/account-b",
        requires: "perm.role.edit",
      },
    ],
  },
  { id: "department", label: "テスト部署", items: [] },
];

describe("#121 AC-1 visibleAdminGroups", () => {
  it("#121 AC-1: 権限が空なら、1つも返さない（一般の利用者に「管理」を出さない）", () => {
    expect(visibleAdminGroups(groups, new Set())).toEqual([]);
  });

  it("#121 AC-1: 持っている権限の項目だけを残す", () => {
    const result = visibleAdminGroups(groups, new Set(["perm.role.edit"]));
    expect(result.map((g) => g.id)).toEqual(["account"]);
    expect(result[0]?.items.map((i) => i.id)).toEqual(["t-account-2"]);
  });

  it("#121 AC-1: 項目が0件のまとまり（もともと空・権限で全部外れた）は返さない", () => {
    const result = visibleAdminGroups(groups, new Set(["perm.role.assign"]));
    expect(result.map((g) => g.id)).toEqual(["account"]);
    expect(result.map((g) => g.id)).not.toContain("department");
    expect(result.map((g) => g.id)).not.toContain("approval");
  });

  it("#121 AC-1: すべての権限があれば、項目のあるまとまりを定義の順にすべて返す", () => {
    const result = visibleAdminGroups(
      groups,
      new Set(["perm.workspace.manage", "perm.role.assign", "perm.role.edit"]),
    );
    expect(result.map((g) => g.id)).toEqual(["approval", "account"]);
    expect(result[1]?.items.map((i) => i.id)).toEqual([
      "t-account-1",
      "t-account-2",
    ]);
  });

  it("#121 AC-1: 無関係な権限だけを持っていても、何も返さない", () => {
    expect(
      visibleAdminGroups(groups, new Set(["perm.search.message"])),
    ).toEqual([]);
  });

  it("#121 AC-1: 入力の定義を書き換えない", () => {
    const before = JSON.stringify(groups);
    visibleAdminGroups(groups, new Set(["perm.role.edit"]));
    expect(JSON.stringify(groups)).toBe(before);
  });

  it("#121 AC-1: 定義が空でも、空の配列を返す", () => {
    expect(visibleAdminGroups([], new Set(["perm.role.edit"]))).toEqual([]);
  });
});

describe("#121 AC-3 navigation の定義", () => {
  it("#121 AC-3: primaryNavItems には、ホーム（/）がある", () => {
    const home = primaryNavItems.find((item) => item.to === "/");
    expect(home?.label).toBe("ホーム");
  });

  it("#121 AC-3: primaryNavItems の id は重複しない（key に使う安定ID）", () => {
    const ids = primaryNavItems.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("#121 AC-3: adminNavGroups は4つのまとまり（承認・アカウント・部署・マスタ/ログ）を持つ", () => {
    expect(adminNavGroups.map((g) => g.id)).toEqual([
      "approval",
      "account",
      "department",
      "master-log",
    ]);
    for (const group of adminNavGroups) expect(group.label.trim()).not.toBe("");
  });

  it("#121 AC-1: 今の定義と空の権限では、管理のまとまりは1つも出ない", () => {
    expect(visibleAdminGroups(adminNavGroups, new Set())).toEqual([]);
  });
});

// #192 AC-1（5-7 AC-1）：管理メニューは全体管理者だけに表示する。
describe("#192 AC-1（5-7 AC-1）: 取引先管理メニュー", () => {
  it("#192 AC-1（5-7 AC-1）: perm.client.manage があると取引先管理へ進める", () => {
    const groups = visibleAdminGroups(
      adminNavGroups,
      new Set(["perm.client.manage"]),
    );
    expect(groups.flatMap((group) => group.items)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: "/clients",
          requires: "perm.client.manage",
        }),
      ]),
    );
  });
  it("#192 AC-1（5-7 AC-1）: 一般・オーナー権限では取引先管理を表示しない", () => {
    for (const permissions of [
      new Set<string>(),
      new Set(["perm.role.assign"]),
    ]) {
      const links = visibleAdminGroups(adminNavGroups, permissions).flatMap(
        (group) => group.items,
      );
      expect(links.some((item) => item.to === "/clients")).toBe(false);
    }
  });
});

// #196 AC-4（2-1 AC-4・7-1 AC-3）：部署管理のメニューは、部署のまとまりに置き、全体管理者（perm.workspace.create）だけに出す。
describe("#196 AC-4: 部署管理メニュー", () => {
  it("#196 AC-4: perm.workspace.create があると、部署のまとまりに「部署管理」（/departments）が出る", () => {
    const groups = visibleAdminGroups(
      adminNavGroups,
      new Set(["perm.workspace.create"]),
    );
    const department = groups.find((group) => group.id === "department");
    expect(department?.items).toEqual([
      expect.objectContaining({
        id: "departments",
        label: "部署管理",
        to: "/departments",
        requires: "perm.workspace.create",
      }),
    ]);
  });

  it("#196 AC-4: 一般・オーナー・取引先管理だけの権限では部署管理を出さない", () => {
    for (const permissions of [
      new Set<string>(),
      new Set(["perm.role.assign"]),
      new Set(["perm.client.manage"]),
    ]) {
      const links = visibleAdminGroups(adminNavGroups, permissions).flatMap(
        (group) => group.items,
      );
      expect(links.some((item) => item.to === "/departments")).toBe(false);
    }
  });
});
