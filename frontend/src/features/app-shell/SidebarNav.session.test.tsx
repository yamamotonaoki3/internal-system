import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { authKeys } from "../auth/api/query-keys";
import { server } from "../../test/server";
import { SidebarNav } from "./SidebarNav";

const session = {
  user: {
    id: "testuser_192",
    displayName: "testuser_192",
    loginId: "testuser_192",
  },
  mustChangePassword: false,
  reauthenticatedAt: null,
};

describe("#192 AC-1・AC-7: 管理メニューとsession権限", () => {
  it("#192 AC-1・AC-7: ログイン直後のsession取得で管理リンクを出し、権限剥奪後の再取得で消す", async () => {
    let permissions = ["perm.client.manage"];
    let requests = 0;
    server.use(
      http.get("/api/auth/session", () => {
        requests += 1;
        return HttpResponse.json({ ...session, permissions });
      }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SidebarNav />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText("管理");
    fireEvent.click(screen.getByText("マスタ・ログ"));
    expect(
      screen.getByRole("link", { name: "取引先管理" }).getAttribute("href"),
    ).toBe("/clients");
    permissions = [];
    await queryClient.invalidateQueries({ queryKey: authKeys.session });
    await waitFor(() => expect(requests).toBeGreaterThanOrEqual(2));
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "取引先管理" })).toBeNull(),
    );
  });
});
