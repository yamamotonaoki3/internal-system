// #121 AC-1：AdminMenu。権限のある項目があるまとまりだけを <details><summary> で出し、0件なら「管理」の見出しごと何も描画しない。
// 公開形の仮定：<AdminMenu groups={AdminNavGroup[]} permissions={ReadonlySet<string>} />（react-router の中で描画する）。
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { AdminMenu } from "./AdminMenu";
import type { AdminNavGroup } from "./navigation";

const groups: AdminNavGroup[] = [
  {
    id: "account",
    label: "テストアカウント",
    items: [
      {
        id: "t-account-1",
        label: "テストアカウント一覧",
        to: "/test/accounts",
        requires: "perm.role.assign",
      },
    ],
  },
  {
    id: "approval",
    label: "テスト承認",
    items: [
      {
        id: "t-approval-1",
        label: "テスト承認待ち",
        to: "/test/approvals",
        requires: "perm.workspace.manage",
      },
    ],
  },
  { id: "department", label: "テスト部署", items: [] },
];

function renderMenu(permissions: ReadonlySet<string>) {
  return render(
    <MemoryRouter>
      <AdminMenu groups={groups} permissions={permissions} />
    </MemoryRouter>,
  );
}

describe("#121 AC-1 AdminMenu", () => {
  it("#121 AC-1: 権限が空なら何も描画しない（「管理」の見出しも出さない）", () => {
    const { container } = renderMenu(new Set());
    expect(container.childElementCount).toBe(0);
    expect(screen.queryByText("管理")).toBeNull();
    expect(screen.queryByText("テストアカウント")).toBeNull();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("#121 AC-1: 権限のある項目があれば、「管理」と、そのまとまりと項目のリンクを出す", () => {
    renderMenu(new Set(["perm.role.assign"]));
    expect(screen.getByText("管理")).toBeDefined();
    expect(screen.getByText("テストアカウント")).toBeDefined();
    const link = screen.getByRole("link", { name: "テストアカウント一覧" });
    expect(link.getAttribute("href")).toBe("/test/accounts");
  });

  it("#121 AC-1: 権限のないまとまり・項目0件のまとまりは出さない", () => {
    renderMenu(new Set(["perm.role.assign"]));
    expect(screen.queryByText("テスト承認")).toBeNull();
    expect(screen.queryByText("テスト部署")).toBeNull();
    expect(screen.queryByRole("link", { name: "テスト承認待ち" })).toBeNull();
  });

  it("#121 AC-1: 複数の権限があれば、まとまりごとに <details> で出す", () => {
    const { container } = renderMenu(
      new Set(["perm.role.assign", "perm.workspace.manage"]),
    );
    expect(screen.getByText("テストアカウント")).toBeDefined();
    expect(screen.getByText("テスト承認")).toBeDefined();
    expect(container.querySelectorAll("details")).toHaveLength(2);
    expect(container.querySelectorAll("details > summary")).toHaveLength(2);
  });
});
