// #120 AC-1（0-2 AC-3・0-3 AC-5 の印）：RequireAuth。ログイン済みのときだけ中身を出す。
// 公開形の仮定：<RequireAuth>{children}</RequireAuth>。未ログイン（GET /api/auth/session が 401）なら自分で /login へ移る
// （main.tsx の 401 ハンドラが登録されていないテストでも移る）。mustChangePassword なら PasswordChangePending を出す。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { respondLoggedIn, respondLoggedOut } from "../../../test/auth-handlers";
import { RequireAuth } from "./RequireAuth";

function CurrentPath() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

function renderGuarded() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={
              <RequireAuth>
                <p>保護された中身</p>
              </RequireAuth>
            }
          />
          <Route path="/login" element={<p>ログイン画面</p>} />
        </Routes>
        <CurrentPath />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

describe("#120 AC-1 RequireAuth", () => {
  it("#120 AC-1: ログイン済みなら中身を出す", async () => {
    respondLoggedIn();
    renderGuarded();
    expect(await screen.findByText("保護された中身")).toBeDefined();
  });

  it("#120 AC-1: セッションの確認中は中身を出さない", () => {
    respondLoggedIn();
    renderGuarded();
    expect(screen.queryByText("保護された中身")).toBeNull();
  });

  it("#120 AC-1（0-2 AC-3）: 未ログインなら中身を出さず /login へ移る", async () => {
    respondLoggedOut();
    renderGuarded();
    expect(await screen.findByText("ログイン画面")).toBeDefined();
    expect(screen.getByTestId("path").textContent).toBe("/login");
    expect(screen.queryByText("保護された中身")).toBeNull();
  });

  it("#120 AC-1: mustChangePassword なら中身の代わりに準備中の案内を出す（/login には移らない）", async () => {
    respondLoggedIn(true);
    renderGuarded();
    expect(
      await screen.findByText(
        "パスワードの変更が必要です。変更画面は準備中です",
      ),
    ).toBeDefined();
    expect(screen.queryByText("保護された中身")).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe("/"),
    );
  });
});
