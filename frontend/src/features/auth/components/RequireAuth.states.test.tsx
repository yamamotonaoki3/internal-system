// #121 AC-1：RequireAuth は AppShell の外に置くため、確認中・取得エラー・パスワード変更待ちは、画面の枠（main と h1 を1つずつ）で包む。
// banner・navigation（サイドバー・ヘッダー）は出さない。ログイン済みの中身は包まない（AppShell が main を持つため二重にしない）。
// h1 の文言（利用者の承認済み）：確認中・取得エラー「ログイン状態の確認」、パスワード変更待ち「パスワードの変更が必要です」。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { respondLoggedIn } from "../../../test/auth-handlers";
import { server } from "../../../test/server";
import { RequireAuth } from "./RequireAuth";

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
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function expectBareFrame(h1: string) {
  const main = screen.getByRole("main");
  expect(screen.getAllByRole("main")).toHaveLength(1);
  const headings = screen.getAllByRole("heading", { level: 1 });
  expect(headings).toHaveLength(1);
  expect(headings[0]?.textContent).toBe(h1);
  expect(within(main).getByRole("heading", { level: 1 })).toBe(headings[0]);
  expect(screen.queryByRole("banner")).toBeNull();
  expect(screen.queryAllByRole("navigation")).toHaveLength(0);
  expect(screen.queryByText("保護された中身")).toBeNull();
  return main;
}

describe("#121 AC-1 RequireAuth の各状態の枠", () => {
  it("#121 AC-1: 確認中は、main と h1「ログイン状態の確認」を1つずつ出し、「確認中です」を伝える", () => {
    server.use(
      http.get("/api/auth/session", async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );
    renderGuarded();
    const main = expectBareFrame("ログイン状態の確認");
    expect(within(main).getByRole("status").textContent).toBe("確認中です");
  });

  it("#121 AC-1: 確認できなかった（500）ときは、main と h1「ログイン状態の確認」、エラーと再試行を出し、banner・navigation は出さない", async () => {
    server.use(
      http.get("/api/auth/session", () =>
        HttpResponse.json({ code: "INTERNAL", message: "x" }, { status: 500 }),
      ),
    );
    renderGuarded();
    const alert = await screen.findByRole("alert");
    const main = expectBareFrame("ログイン状態の確認");
    expect(within(main).getByRole("alert")).toBe(alert);
    expect(within(main).getByRole("button", { name: "再試行" })).toBeDefined();
  });

  it("#123 0-3 AC-5: パスワードの変更待ちは、main と h1「パスワードの変更が必要です」を1つずつ出し、入力欄とログアウトを出す", async () => {
    respondLoggedIn(true);
    renderGuarded();
    await screen.findByLabelText("現在のパスワード");
    const main = expectBareFrame("パスワードの変更が必要です");
    expect(
      within(main).getByRole("button", { name: "ログアウト" }),
    ).toBeDefined();
  });

  it("#121 AC-1: ログイン済みの中身は、RequireAuth が main や h1 で包まない（枠は AppShell が持つ）", async () => {
    respondLoggedIn();
    renderGuarded();
    expect(await screen.findByText("保護された中身")).toBeDefined();
    expect(screen.queryByRole("main")).toBeNull();
    expect(screen.queryAllByRole("heading")).toHaveLength(0);
  });
});
