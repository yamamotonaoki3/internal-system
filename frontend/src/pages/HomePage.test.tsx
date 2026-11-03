// #119 AC-4（D-10）：HomePage は初代管理者が未設定（setupRequired=true）のときだけ「初回セットアップへ」のリンクを出す。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../test/server";
import { HomePage } from "./HomePage";

function renderHome() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HomePage />
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

describe("#119 AC-4 HomePage の初回セットアップへの入口", () => {
  it("#119 AC-4: setupRequired=true なら「初回セットアップへ」のリンク（/setup）を出す", async () => {
    server.use(
      http.get("/api/setup/status", () =>
        HttpResponse.json({ setupRequired: true }),
      ),
    );
    renderHome();
    const link = await screen.findByRole("link", {
      name: "初回セットアップへ",
    });
    expect(link.getAttribute("href")).toBe("/setup");
  });

  it("#119 AC-4: setupRequired=false ならリンクを出さない", async () => {
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
