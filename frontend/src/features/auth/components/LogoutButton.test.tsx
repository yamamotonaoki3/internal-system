// #120 AC-1（0-2 AC-2・AC-8）：LogoutButton。押すと POST /api/auth/logout を送り、クエリのキャッシュをすべて消して /login へ移る。
// 下書きの消去は、下書きの機能（1-1）が未実装のため申し送り。ここではキャッシュの消去だけを確かめる。
// 公開形の仮定：<LogoutButton />（ボタンの名前は「ログアウト」。送信中は無効）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { TEST_USER } from "../../../test/auth-handlers";
import { server } from "../../../test/server";
import { authKeys } from "../api/query-keys";
import { LogoutButton } from "./LogoutButton";

function CurrentPath() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

function renderButton() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // ログイン中に読み込んだサーバーの状態（架空）
  client.setQueryData(authKeys.session, {
    user: TEST_USER,
    mustChangePassword: false,
  });
  client.setQueryData(["sample", "業務のデータ"], { secret: "[UNIT_TEST]" });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<LogoutButton />} />
          <Route path="/login" element={<p>ログイン画面</p>} />
        </Routes>
        <CurrentPath />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

describe("#120 AC-1 LogoutButton", () => {
  it("#120 AC-1（0-2 AC-2・AC-8）: 押すとログアウトを送り、クエリのキャッシュをすべて消して /login へ移る", async () => {
    let calls = 0;
    server.use(
      http.post("/api/auth/logout", () => {
        calls += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    const client = renderButton();
    await user.click(screen.getByRole("button", { name: "ログアウト" }));
    expect(await screen.findByText("ログイン画面")).toBeDefined();
    expect(calls).toBe(1);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(client.getQueryData(authKeys.session)).toBeUndefined();
  });

  it("#120 AC-1: 送信中はボタンを無効にし、二重に送らない", async () => {
    let calls = 0;
    server.use(
      http.post("/api/auth/logout", async () => {
        calls += 1;
        await delay("infinite");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderButton();
    const button = screen.getByRole("button", { name: /ログアウト/ });
    await user.click(button);
    await waitFor(() =>
      expect((button as HTMLButtonElement).disabled).toBe(true),
    );
    await user.click(button);
    expect(calls).toBe(1);
  });

  it("#120 AC-1: ログアウトが失敗（500）したら、キャッシュを消さず画面に留まり、失敗を伝える", async () => {
    server.use(
      http.post("/api/auth/logout", () =>
        HttpResponse.json(
          { code: "INTERNAL", message: "エラーが発生しました" },
          { status: 500 },
        ),
      ),
    );
    const user = userEvent.setup();
    const client = renderButton();
    await user.click(screen.getByRole("button", { name: "ログアウト" }));
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByTestId("path").textContent).toBe("/");
    expect(client.getQueryData(authKeys.session)).toBeDefined();
  });
});
