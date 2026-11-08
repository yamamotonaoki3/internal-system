import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { server } from "./test/server";
import { App } from "./App";

const session = {
  user: {
    id: "testuser_192_route",
    displayName: "testuser_192_route",
    loginId: "testuser_192_route",
  },
  mustChangePassword: false,
  reauthenticatedAt: null,
};

function renderAtClients() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/clients"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("#192 AC-1・AC-7: /clientsの直接アクセス", () => {
  it("#192 AC-1・AC-7: session確認中は誤拒否せず、管理権限確定後に取引先管理を表示する", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get("/api/auth/session", async () => {
        await gate;
        return HttpResponse.json({
          ...session,
          permissions: ["perm.client.manage"],
        });
      }),
      http.get("/api/admin/clients", () =>
        HttpResponse.json({ items: [], nextCursor: null }),
      ),
    );
    renderAtClients();
    expect(await screen.findByText("確認中です")).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "ページが見つかりません" }),
    ).toBeNull();
    release?.();
    expect(
      await screen.findByRole("heading", { name: "取引先管理" }),
    ).toBeTruthy();
  });

  it.each(["一般社員", "部署オーナー"])(
    "#192 AC-1・AC-7: %sのsessionでは直接URLの管理画面を表示しない",
    async () => {
      server.use(
        http.get("/api/auth/session", () =>
          HttpResponse.json({ ...session, permissions: [] }),
        ),
        http.get("/api/admin/clients", () =>
          HttpResponse.json({ items: [], nextCursor: null }),
        ),
      );
      renderAtClients();
      await waitFor(() => expect(screen.queryByText("確認中です")).toBeNull());
      expect(screen.queryByRole("heading", { name: "取引先管理" })).toBeNull();
    },
  );
});
