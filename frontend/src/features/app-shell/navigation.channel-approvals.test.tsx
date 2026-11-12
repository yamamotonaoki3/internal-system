// #131 AC-7（2-2 AC-7・AC-8・AC-10、S-11）：管理メニューの「承認」のまとまりに「チャンネル承認」（/channel-approvals）を置き、
// perm.channel.request.approve.owner（オーナー・全体管理者のセッションに付く）を持つ人だけに出す。表示の制御であり、認可はサーバーが行う。
// 既存の navigation.test.ts・AdminMenu.test.tsx は変更せず、#131 の確認だけをこのファイルに置く。
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { AdminMenu } from "./AdminMenu";
import { adminNavGroups, visibleAdminGroups } from "./navigation";

const PERMISSION = "perm.channel.request.approve.owner";

describe("#131 AC-7: 管理メニュー「承認＞チャンネル承認」", () => {
  it("#131 AC-7: perm.channel.request.approve.owner があると、承認のまとまりに「チャンネル承認」（/channel-approvals）が出る", () => {
    const groups = visibleAdminGroups(adminNavGroups, new Set([PERMISSION]));
    expect(groups.map((group) => group.id)).toEqual(["approval"]);
    expect(groups[0]?.items).toEqual([
      {
        id: "channel-approvals",
        label: "チャンネル承認",
        to: "/channel-approvals",
        requires: PERMISSION,
      },
    ]);
  });

  it("#131 AC-7: 権限がない・ほかの管理権限だけなら「チャンネル承認」を出さない", () => {
    for (const permissions of [
      new Set<string>(),
      new Set([
        "perm.client.manage",
        "perm.account.create",
        "perm.workspace.create",
      ]),
    ]) {
      const links = visibleAdminGroups(adminNavGroups, permissions).flatMap(
        (group) => group.items,
      );
      expect(links.some((item) => item.to === "/channel-approvals")).toBe(
        false,
      );
    }
  });

  it("#131 AC-7: 権限のある人の管理メニューには、見出し「承認」と「チャンネル承認」のリンクが出る", () => {
    render(
      <MemoryRouter>
        <AdminMenu
          groups={adminNavGroups}
          permissions={new Set([PERMISSION])}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("承認")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "チャンネル承認" }).getAttribute("href"),
    ).toBe("/channel-approvals");
  });
});
