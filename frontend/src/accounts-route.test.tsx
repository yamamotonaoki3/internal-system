// #199 AC-1・AC-3・AC-5: /accounts・/accounts/new のルートガードと、管理メニューの出し分け、S-23 → S-22 の戻り。
// 画面の出し分けは表示の制御で、認可はサーバーで行う（API の403は backend のテストで確かめる）。データは架空。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { adminNavGroups } from "./features/app-shell/navigation";
import { SidebarNav } from "./features/app-shell/SidebarNav";
import { server } from "./test/server";

const BASE = "/api/admin/accounts";
const TEST_INITIAL_PASSWORD = "Tq7#xZ9!mK2$pW4v";
const DEPT = { id: "01JTESTDEPT000000000000001", name: "[E2E_TEST]テスト部" };
const session = {
  user: {
    id: "testuser_199_route",
    displayName: "testuser_199_route",
    loginId: "testuser_199_route",
  },
  mustChangePassword: false,
  reauthenticatedAt: null,
};

function respondSession(permissions: string[]) {
  server.use(
    http.get("/api/auth/session", () =>
      HttpResponse.json({ ...session, permissions }),
    ),
    http.get(BASE, () => HttpResponse.json({ items: [], nextCursor: null })),
    http.get(`${BASE}/department-options`, () =>
      HttpResponse.json({ items: [DEPT] }),
    ),
  );
}

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("#199 AC-1: アカウント管理のルートとメニュー", () => {
  it("#199 AC-1: 管理メニューの「アカウント」に、perm.account.create が必要な /accounts の項目がある", () => {
    const group = adminNavGroups.find((g) => g.id === "account");
    expect(group?.items).toContainEqual({
      id: "accounts",
      label: "アカウント管理",
      to: "/accounts",
      requires: "perm.account.create",
    });
  });

  it.each(["/accounts", "/accounts/new"])(
    "#199 AC-1: 全体管理者は %s を開ける",
    async (path) => {
      respondSession(["perm.client.manage", "perm.account.create"]);
      renderAt(path);
      expect(
        await screen.findByRole("heading", {
          name: path === "/accounts" ? "アカウント管理" : "アカウント登録",
        }),
      ).toBeTruthy();
    },
  );

  it.each([
    ["一般社員・オーナー（権限なし）", [], "/accounts"],
    ["一般社員・オーナー（権限なし）", [], "/accounts/new"],
    ["取引先の権限だけ", ["perm.client.manage"], "/accounts/new"],
  ])("#199 AC-1: %sは %s を開けず NotFound", async (_l, permissions, path) => {
    respondSession(permissions);
    renderAt(path);
    expect(
      await screen.findByRole("heading", { name: "ページが見つかりません" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "アカウント管理" }),
    ).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "アカウント登録" }),
    ).toBeNull();
  });

  it("#199 AC-1: 権限があればメニューに「アカウント管理」を出し、なければ出さない", async () => {
    let permissions = ["perm.account.create"];
    server.use(
      http.get("/api/auth/session", () =>
        HttpResponse.json({ ...session, permissions }),
      ),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SidebarNav />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText("管理");
    fireEvent.click(screen.getByText("アカウント"));
    expect(
      screen.getByRole("link", { name: "アカウント管理" }).getAttribute("href"),
    ).toBe("/accounts");
    view.unmount();
    permissions = [];
    const other = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={other}>
        <MemoryRouter>
          <SidebarNav />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.queryByText("管理")).toBeNull());
    expect(screen.queryByRole("link", { name: "アカウント管理" })).toBeNull();
  });
});

describe("#199 AC-3・AC-5: 発行から一覧への戻り", () => {
  it("#199 AC-3・AC-5（A-7）: 発行後に「一覧へ戻る」で S-22 に移り、「登録しました」を出して一覧を取り直す。初期パスワードは再表示しない", async () => {
    let listRequests = 0;
    respondSession(["perm.account.create"]);
    server.use(
      http.get(BASE, () => {
        listRequests += 1;
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
      http.post(BASE, () =>
        HttpResponse.json(
          {
            id: "01JTESTACCT000000000000001",
            loginId: "testuser_001",
            displayName: "テスト太郎",
            departmentId: DEPT.id,
            mustChangePassword: true,
            createdAt: "2026-11-09T00:00:00.000Z",
            initialPassword: TEST_INITIAL_PASSWORD,
          },
          { status: 201 },
        ),
      ),
    );
    const user = userEvent.setup();
    const client = renderAt("/accounts/new");
    await user.type(await screen.findByLabelText(/社員ID/), "testuser_001");
    await user.type(screen.getByLabelText(/本名/), "テスト太郎");
    await user.type(
      screen.getByLabelText(/メールアドレス$/),
      "testuser_001@example.com",
    );
    await user.selectOptions(
      await screen.findByRole("combobox", { name: /所属部署/ }),
      DEPT.id,
    );
    await user.click(screen.getByRole("checkbox", { name: /会社が発行した/ }));
    await user.click(screen.getByRole("button", { name: "登録する" }));
    expect(await screen.findByText(TEST_INITIAL_PASSWORD)).toBeTruthy();
    const before = listRequests;
    await user.click(screen.getByRole("button", { name: "一覧へ戻る" }));
    expect(
      await screen.findByRole("heading", { name: "アカウント管理" }),
    ).toBeTruthy();
    expect(await screen.findByText(/登録しました/)).toBeTruthy();
    await waitFor(() => expect(listRequests).toBeGreaterThan(before));
    expect(screen.queryByText(TEST_INITIAL_PASSWORD)).toBeNull();
    await waitFor(() => {
      const dump = JSON.stringify({
        q: client
          .getQueryCache()
          .getAll()
          .map((q) => q.state),
        m: client
          .getMutationCache()
          .getAll()
          .map((m) => m.state),
      });
      expect(dump).not.toContain(TEST_INITIAL_PASSWORD);
    });
    // 新規登録の画面へ戻っても、初期パスワードは出ない
    await user.click(screen.getByRole("link", { name: "新規登録" }));
    expect(
      await screen.findByRole("heading", { name: "アカウント登録" }),
    ).toBeTruthy();
    expect(screen.queryByText(TEST_INITIAL_PASSWORD)).toBeNull();
  });
});
