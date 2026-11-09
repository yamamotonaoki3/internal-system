// #196 AC-4（2-1 AC-4・7-1 AC-3・0-8 AC-1）: /departments・/departments/new の直接アクセスを、セッションの権限で出し分ける。
// 契約（実装前の前提）：App.tsx に DepartmentManageRoute を置き、perm.workspace.create がなければ NotFoundPage を出す。
// 一覧の見出しは「部署管理」、作成の見出しは「部署作成」。
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { server } from "./test/server";
import { App } from "./App";

const session = {
  user: {
    id: "testuser_196_route",
    displayName: "testuser_196_route",
    loginId: "testuser_196_route",
  },
  mustChangePassword: false,
  reauthenticatedAt: null,
};

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function respond(permissions: string[]) {
  server.use(
    http.get("/api/auth/session", () =>
      HttpResponse.json({ ...session, permissions }),
    ),
    http.get("/api/admin/departments", () =>
      HttpResponse.json({ items: [], nextCursor: null }),
    ),
    http.get("/api/admin/departments/owner-candidates", () =>
      HttpResponse.json({ items: [], nextCursor: null }),
    ),
  );
}

describe("#196 AC-4: 部署管理の画面の直接アクセス", () => {
  it.each([
    ["/departments", "部署管理"],
    ["/departments/new", "部署作成"],
  ])(
    "#196 AC-4: 全体管理者（perm.workspace.create）は %s を開ける",
    async (path, heading) => {
      respond(["perm.client.manage", "perm.workspace.create"]);
      renderAt(path);
      expect(
        await screen.findByRole("heading", { name: heading }),
      ).toBeTruthy();
    },
  );

  it("#196 AC-4: セッション確認中は誤って拒否しない", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get("/api/auth/session", async () => {
        await gate;
        return HttpResponse.json({
          ...session,
          permissions: ["perm.workspace.create"],
        });
      }),
      http.get("/api/admin/departments", () =>
        HttpResponse.json({ items: [], nextCursor: null }),
      ),
    );
    renderAt("/departments");
    expect(await screen.findByText("確認中です")).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "ページが見つかりません" }),
    ).toBeNull();
    release?.();
    expect(
      await screen.findByRole("heading", { name: "部署管理" }),
    ).toBeTruthy();
  });

  it.each([
    ["一般社員", "/departments", []],
    ["部署オーナー", "/departments", []],
    ["取引先管理だけの権限", "/departments", ["perm.client.manage"]],
    ["一般社員", "/departments/new", []],
  ])(
    "#196 AC-4: %sのセッションでは %s を表示せず、ページが見つからない表示にする",
    async (_label, path, permissions) => {
      respond(permissions);
      renderAt(path);
      await waitFor(() => expect(screen.queryByText("確認中です")).toBeNull());
      expect(
        await screen.findByRole("heading", { name: "ページが見つかりません" }),
      ).toBeTruthy();
      expect(screen.queryByRole("heading", { name: "部署管理" })).toBeNull();
      expect(screen.queryByRole("heading", { name: "部署作成" })).toBeNull();
    },
  );
});
