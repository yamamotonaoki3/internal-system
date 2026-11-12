// #131（S-09・S-10・S-11、frontend-build）：画面のルートと入口。
//  - /channel-requests（S-10）はログイン後の全員が開ける。見出し「チャンネル作成の申請」
//  - /channel-approvals（S-11）は、セッションの permissions に perm.channel.request.approve.owner がある人だけに画面を出し、ない人には「ページが見つかりません」
//    （DepartmentManageRoute と同じ形の表示の制御。認可はサーバーが行う）
//  - S-09（チャンネルを探す）に「チャンネルを申請」のリンク（/channel-requests）を置く（screens.md の遷移表）
// データは架空。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { renderApp, SHELL_USER } from "../test/app-shell-harness";
import { respondChannels } from "../test/channel-handlers";
import { respondProfileDepartment } from "../test/channel-request-handlers";
import { server } from "../test/server";
import { ChannelsPage } from "./ChannelsPage";

function respondSession(permissions: string[]) {
  server.use(
    http.get("/api/auth/session", () =>
      HttpResponse.json({
        user: SHELL_USER,
        permissions,
        mustChangePassword: false,
        reauthenticatedAt: null,
      }),
    ),
    http.get("/api/channel-requests/mine", () =>
      HttpResponse.json({ items: [], nextCursor: null }),
    ),
    http.get("/api/channel-requests", () =>
      HttpResponse.json({ items: [], nextCursor: null }),
    ),
  );
}

describe("#131 S-10・S-11 のルート", () => {
  it("#131 AC-1（S-10）: /channel-requests は権限のない一般社員でも開ける", async () => {
    respondSession([]);
    respondProfileDepartment(null);
    renderApp("/channel-requests");
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "チャンネル作成の申請",
      }),
    ).toBeTruthy();
  });

  it("#131 AC-7（S-11）: perm.channel.request.approve.owner のない人が /channel-approvals を開くと「ページが見つかりません」", async () => {
    respondSession([]);
    renderApp("/channel-approvals");
    expect(
      await screen.findByRole("heading", { name: "ページが見つかりません" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "チャンネル作成の承認" }),
    ).toBeNull();
  });

  it("#131 AC-7（S-11）: perm.channel.request.approve.owner のある人は /channel-approvals で承認一覧を開ける", async () => {
    respondSession(["perm.channel.request.approve.owner"]);
    renderApp("/channel-approvals");
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "チャンネル作成の承認",
      }),
    ).toBeTruthy();
  });
});

describe("#131 S-09 から S-10 への入口", () => {
  it("#131 AC-1（screens.md の遷移表）: チャンネル一覧に「チャンネルを申請」のリンク（/channel-requests）がある", async () => {
    respondChannels([]);
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <ChannelsPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    const link = await screen.findByRole("link", { name: "チャンネルを申請" });
    expect(link.getAttribute("href")).toBe("/channel-requests");
  });
});
