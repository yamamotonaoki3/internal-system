// #156 0-6 AC-1（S-25）：管理メニューの「マスタ・記録」のまとまりに「監査ログ」（/audit-logs）を置き、perm.audit_log.view（全体管理者のセッションだけに付く）を持つ人だけに出す。
// 表示の制御であり、認可はサーバーが行う。既存の navigation.test.ts・AdminMenu.test.tsx は変更せず、#156 の確認だけをこのファイルに置く。
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { AdminMenu } from "./AdminMenu";
import { adminNavGroups, visibleAdminGroups } from "./navigation";

const PERMISSION = "perm.audit_log.view";

describe("#156 0-6 AC-1: 管理メニュー「マスタ・記録＞監査ログ」", () => {
  it("#156 0-6 AC-1: perm.audit_log.view があると、マスタ・記録のまとまりに「監査ログ」（/audit-logs）が出る", () => {
    const groups = visibleAdminGroups(adminNavGroups, new Set([PERMISSION]));
    expect(groups.map((group) => group.id)).toEqual(["master-log"]);
    expect(groups[0]?.items).toEqual([
      {
        id: "audit-logs",
        label: "監査ログ",
        to: "/audit-logs",
        requires: PERMISSION,
      },
    ]);
  });

  it("#156 0-6 AC-1: 取引先の管理権限もある人（全体管理者）には、取引先管理と監査ログの両方が出る", () => {
    const groups = visibleAdminGroups(
      adminNavGroups,
      new Set([PERMISSION, "perm.client.manage"]),
    );
    const masterLog = groups.find((group) => group.id === "master-log");
    expect(masterLog?.items.map((item) => item.to).sort()).toEqual([
      "/audit-logs",
      "/clients",
    ]);
  });

  it("#156 0-6 AC-1: 権限がない・ほかの管理権限だけ（オーナーの権限を含む）なら「監査ログ」を出さない", () => {
    for (const permissions of [
      new Set<string>(),
      new Set(["perm.channel.request.approve.owner", "perm.workspace.manage"]),
      new Set([
        "perm.client.manage",
        "perm.account.create",
        "perm.workspace.create",
      ]),
    ]) {
      const links = visibleAdminGroups(adminNavGroups, permissions).flatMap(
        (group) => group.items,
      );
      expect(links.some((item) => item.to === "/audit-logs")).toBe(false);
    }
  });

  it("#156 0-6 AC-1: 権限のある人の管理メニューには、「監査ログ」のリンクが出る。権限のない人には出ない", () => {
    const { unmount } = render(
      <MemoryRouter>
        <AdminMenu
          groups={adminNavGroups}
          permissions={new Set([PERMISSION])}
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("link", { name: "監査ログ" }).getAttribute("href"),
    ).toBe("/audit-logs");
    unmount();
    render(
      <MemoryRouter>
        <AdminMenu
          groups={adminNavGroups}
          permissions={new Set(["perm.workspace.manage"])}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link", { name: "監査ログ" })).toBeNull();
  });
});
