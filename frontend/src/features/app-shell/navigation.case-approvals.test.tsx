// #146（146-B）5-3 AC-3、S-29：管理メニューの「承認」のまとまりに「案件承認」（/case-approvals）を置き、
// perm.case.request.approve（オーナー・全体管理者のセッションに付く）を持つ人だけに出す。表示の制御であり、認可はサーバーが行う（計画 B-2）。
// 既存の navigation のテストは変更せず、#146 の確認だけをこのファイルに置く。
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { AdminMenu } from "./AdminMenu";
import { adminNavGroups, visibleAdminGroups } from "./navigation";

const PERMISSION = "perm.case.request.approve";

describe("#146 5-3 AC-3: 管理メニュー「承認＞案件承認」", () => {
  it("#146 5-3 AC-3: perm.case.request.approve があると、承認のまとまりに「案件承認」（/case-approvals）が出る", () => {
    const groups = visibleAdminGroups(adminNavGroups, new Set([PERMISSION]));
    expect(groups.map((group) => group.id)).toEqual(["approval"]);
    expect(groups[0]?.items).toEqual([
      {
        id: "case-approvals",
        label: "案件承認",
        to: "/case-approvals",
        requires: PERMISSION,
      },
    ]);
  });

  it("#146 5-3 AC-3: 権限がない（メンバー）・ほかの管理権限だけなら「案件承認」を出さない", () => {
    for (const permissions of [
      new Set<string>(),
      new Set([
        "perm.client.manage",
        "perm.account.create",
        "perm.workspace.create",
        "perm.channel.request.approve.owner",
      ]),
    ]) {
      const links = visibleAdminGroups(adminNavGroups, permissions).flatMap(
        (group) => group.items,
      );
      expect(links.some((item) => item.to === "/case-approvals")).toBe(false);
    }
  });

  it("#146 5-3 AC-3: オーナー・全体管理者（両方の承認の権限）には、承認のまとまりに「チャンネル承認」と「案件承認」が出る", () => {
    render(
      <MemoryRouter>
        <AdminMenu
          groups={adminNavGroups}
          permissions={
            new Set(["perm.channel.request.approve.owner", PERMISSION])
          }
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("承認")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "案件承認" }).getAttribute("href"),
    ).toBe("/case-approvals");
    expect(screen.getByRole("link", { name: "チャンネル承認" })).toBeTruthy();
  });
});
