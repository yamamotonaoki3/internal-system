// #143-b b-AC-1〜b-AC-3（S-39・S-38、D-6、screens.md S-01・C-118）: 管理メニューの項目とサイドバーの入口の定義（計画 #143-b 5.5 の F7・F12）。
// 契約：
//   管理メニューの「部署」のまとまりに「チャンネル管理」（/channel-management、requires: perm.channel.edit）。
//   独立の項目 archiveNavItem（「アーカイブ」、/archive、requires: perm.channel.delete）。管理メニュー（adminNavGroups）には入れない。
//   まとまり master-log の表示名は「マスタ・記録」（id は変えない）。その下に「取引先管理」「監査ログ」。
// 表示の制御であり、認可はサーバーが行う。データは架空。
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { AdminMenu } from "./AdminMenu";
import {
  adminNavGroups,
  archiveNavItem,
  visibleAdminGroups,
} from "./navigation";

const EDIT = "perm.channel.edit";
const DELETE = "perm.channel.delete";

describe("#143-b b-AC-1（D-6）: 管理メニュー「部署＞チャンネル管理」", () => {
  it("#143-b b-AC-1: perm.channel.edit があると、部署のまとまりに「チャンネル管理」（/channel-management）だけが出る", () => {
    const groups = visibleAdminGroups(adminNavGroups, new Set([EDIT]));
    expect(groups.map((group) => group.id)).toEqual(["department"]);
    expect(groups[0]?.items).toEqual([
      {
        id: "channel-management",
        label: "チャンネル管理",
        to: "/channel-management",
        requires: EDIT,
      },
    ]);
  });

  it("#143-b b-AC-1: 全体管理者（部署管理の権限もある）には、部署のまとまりに「部署管理」と「チャンネル管理」が出る", () => {
    const groups = visibleAdminGroups(
      adminNavGroups,
      new Set([EDIT, "perm.workspace.create"]),
    );
    const department = groups.find((group) => group.id === "department");
    expect(department?.items.map((item) => item.to).sort()).toEqual([
      "/channel-management",
      "/departments",
    ]);
  });

  it("#143-b b-AC-3: 権限がない・ほかの権限だけ（perm.channel.delete を含む）なら「チャンネル管理」を出さない", () => {
    for (const permissions of [
      new Set<string>(),
      new Set([DELETE]),
      new Set(["perm.channel.request.approve.owner", "perm.workspace.manage"]),
    ]) {
      const links = visibleAdminGroups(adminNavGroups, permissions).flatMap(
        (group) => group.items,
      );
      expect(links.some((item) => item.to === "/channel-management")).toBe(
        false,
      );
    }
  });
});

describe("#143-b b-AC-2（C-124・S-38）: 独立の「アーカイブ」", () => {
  it("#143-b b-AC-2: archiveNavItem は「アーカイブ」（/archive）で、perm.channel.delete を求める", () => {
    expect(archiveNavItem).toEqual({
      id: "archive",
      label: "アーカイブ",
      to: "/archive",
      requires: DELETE,
    });
  });

  it("#143-b b-AC-2: 「アーカイブ」は管理メニューのまとまりに入れない（管理の外）", () => {
    const all = adminNavGroups.flatMap((group) => group.items);
    expect(all.length).toBeGreaterThan(0);
    expect(all.some((item) => item.to === "/archive")).toBe(false);
  });
});

describe("#143-b 追加の決定（F12。screens.md S-01・C-118）: まとまりの名前「マスタ・記録」", () => {
  it("#143-b F12: まとまり master-log の表示名は「マスタ・記録」で、その下に「取引先管理」「監査ログ」がある。「マスタ・ログ」の文字はどこにもない", () => {
    const group = adminNavGroups.find((entry) => entry.id === "master-log");
    expect(group?.label).toBe("マスタ・記録");
    expect(group?.items.map((item) => item.label)).toEqual([
      "取引先管理",
      "監査ログ",
    ]);
    expect(JSON.stringify(adminNavGroups)).not.toContain("マスタ・ログ");
  });

  it("#143-b F12: 管理メニューの見出しに「マスタ・記録」が出る", () => {
    render(
      <MemoryRouter>
        <AdminMenu
          groups={adminNavGroups}
          permissions={new Set(["perm.client.manage", "perm.audit_log.view"])}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("マスタ・記録")).toBeTruthy();
    expect(screen.queryByText("マスタ・ログ")).toBeNull();
  });
});
