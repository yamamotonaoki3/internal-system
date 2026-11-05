// #120 AC-1（0-2 AC-1・AC-3）：HomePage は RequireAuth で包む。ログイン済み・未ログイン・変更が必要の3つの状態で確かめる。
// #119 AC-4（D-10）の「初回セットアップへ」のリンクは、未ログインでも見えるようログイン画面（LoginPage）側に移した（利用者の承認済みの変更）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import {
  respondLoggedIn,
  respondLoggedOut,
  respondPublicStatus,
  TEST_USER,
} from "../test/auth-handlers";
import { server } from "../test/server";

function CurrentPath() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

function renderHome() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <App />
        <CurrentPath />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  server.use(
    http.get("/api/health", () =>
      HttpResponse.json({ status: "ok", appEnv: "test" }),
    ),
  );
});

describe("#120 AC-1 HomePage（ログイン済み）", () => {
  // #121（利用者の承認済みの変更 N-1）：ログアウトは、画面に直接は出さず、アバターメニュー（表示名のボタンで開く）の中に移った。
  // 確かめる内容（ようこそ・ログアウトのボタンがあること）は変えない。jsdom には popover がないため、開閉そのものは e2e/app-shell.spec.ts で確かめる
  it("#120 AC-1: 「ようこそ、{表示名}さん」を出し、アバターメニュー（表示名のボタン）の中にログアウトのボタンを出す", async () => {
    respondLoggedIn();
    respondPublicStatus();
    renderHome();
    expect(
      await screen.findByText(`ようこそ、${TEST_USER.displayName}さん`),
    ).toBeDefined();
    const avatar = screen.getByRole("button", {
      name: `アカウントメニュー（${TEST_USER.displayName}）`,
    });
    const logout = screen.getByRole("button", { name: "ログアウト" });
    const panel = logout.closest("[popover]");
    expect(panel).not.toBeNull();
    expect(avatar.getAttribute("aria-controls")).toBe(panel?.id);
    expect(screen.getByTestId("path").textContent).toBe("/");
  });
});

describe("#120 AC-1 HomePage（未ログイン。0-2 AC-3）", () => {
  it("#120 AC-1: /login へ移り、ようこその表示は出さない", async () => {
    respondLoggedOut();
    respondPublicStatus();
    renderHome();
    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe("/login"),
    );
    expect(screen.queryByText(/ようこそ、/)).toBeNull();
    expect(await screen.findByLabelText("ユーザーID")).toBeDefined();
    expect(await screen.findByText(/サーバーの状態：ok/)).toBeDefined();
  });

  it("#119 AC-4: setupRequired=true なら、ログイン画面に「初回セットアップへ」のリンク（/setup）を出す", async () => {
    respondLoggedOut();
    respondPublicStatus(true);
    renderHome();
    const link = await screen.findByRole("link", {
      name: "初回セットアップへ",
    });
    expect(link.getAttribute("href")).toBe("/setup");
  });

  it("#119 AC-4: setupRequired=false ならリンクを出さない", async () => {
    respondLoggedOut();
    let called = false;
    server.use(
      http.get("/api/setup/status", () => {
        called = true;
        return HttpResponse.json({ setupRequired: false });
      }),
    );
    const client = renderHome();
    await waitFor(() => expect(called).toBe(true));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(
      screen.queryByRole("link", { name: "初回セットアップへ" }),
    ).toBeNull();
  });

  it("#119 AC-4: 状態の取得に失敗したときは、リンクを出さない（未設定とみなさない）", async () => {
    respondLoggedOut();
    let called = false;
    server.use(
      http.get("/api/setup/status", () => {
        called = true;
        return HttpResponse.json(
          { code: "INTERNAL", message: "x" },
          { status: 500 },
        );
      }),
    );
    const client = renderHome();
    await waitFor(() => expect(called).toBe(true));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(
      screen.queryByRole("link", { name: "初回セットアップへ" }),
    ).toBeNull();
  });
});

describe("#120 AC-1 HomePage（初回パスワードの変更が必要）", () => {
  it("#120 AC-1: 準備中の案内とログアウトを出し、ようこその表示は出さず /login にも移らない", async () => {
    respondLoggedIn(true);
    respondPublicStatus();
    renderHome();
    expect(
      await screen.findByText(
        "パスワードの変更が必要です。変更画面は準備中です",
      ),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeDefined();
    expect(screen.queryByText(/ようこそ、/)).toBeNull();
    expect(screen.getByTestId("path").textContent).toBe("/");
  });
});
