// #239 AC-7（0-1 AC-21・C-117）：下書きを端末に保存するのはメッセージの入力欄だけ。個人情報の欄・パスワード・再認証の入力は保存しない。
// 画面の振り分け（App）を通して各画面を開き、見えている入力欄すべてに入力しても、localStorage・sessionStorage に何も書かれないことを確かめる。
// 実装の前から通る（今は何も保存しない）。下書きの機能を足した後に、対象の外へ保存が広がる退行を防ぐためのテスト。データは架空。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { authKeys, useReauth } from "./features/auth";
import { ReauthProvider } from "./features/auth/ReauthProvider";
import {
  respondLoggedOut,
  respondPublicStatus,
  TEST_USER,
} from "./test/auth-handlers";
import { server } from "./test/server";

const ALL_PERMISSIONS = [
  "perm.client.manage",
  "perm.account.create",
  "perm.workspace.create",
  "perm.channel.request.approve.owner",
];
const DEPT = { id: "01JTESTDEPT00000000000D239", name: "[E2E_TEST]部署239" };
const SESSION = {
  user: TEST_USER,
  permissions: ALL_PERMISSIONS,
  mustChangePassword: false,
  reauthenticatedAt: null,
};
const INPUT = "[E2E_TEST]testuser_239@example.com";

function respondSignedIn() {
  const empty = () => HttpResponse.json({ items: [], nextCursor: null });
  server.use(
    http.get("/api/auth/session", () => HttpResponse.json(SESSION)),
    http.get("/api/admin/clients", empty),
    http.get("/api/clients/candidates", empty),
    http.get("/api/admin/departments", empty),
    http.get("/api/admin/departments/owner-candidates", empty),
    http.get("/api/admin/accounts", empty),
    http.get("/api/admin/accounts/department-options", () =>
      HttpResponse.json({ items: [DEPT] }),
    ),
    http.get("/api/channel-requests/mine", empty),
    http.get("/api/channel-requests", empty),
  );
}

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** 見えている文字の入力欄（textbox・パスワード）すべてに入力する。入力した欄の数を返す */
async function typeIntoAllFields(user: ReturnType<typeof userEvent.setup>) {
  const scope = screen.queryByRole("main") ?? document.body;
  const fields = [
    ...scope.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input[type="text"], input[type="password"], input[type="email"], input[type="tel"], input[type="search"], input:not([type]), textarea',
    ),
  ].filter((field) => !field.disabled && !field.readOnly);
  for (const field of fields) await user.type(field, INPUT);
  return fields.length;
}

const storedCount = () =>
  window.localStorage.length + window.sessionStorage.length;

describe("#239 AC-7 個人情報の欄・パスワード・再認証の入力は保存しない", () => {
  it("#239 AC-7: ログイン（S-02）のユーザーID・パスワードに入力しても、端末に何も保存しない", async () => {
    respondLoggedOut();
    respondPublicStatus();
    const user = userEvent.setup();
    renderAt("/login");
    await screen.findByRole("button", { name: "ログイン" });
    expect(await typeIntoAllFields(user)).toBeGreaterThanOrEqual(2);
    expect(storedCount()).toBe(0);
  });

  it("#239 AC-7: 初回セットアップ（氏名・メール・パスワード）に入力しても、端末に何も保存しない", async () => {
    respondLoggedOut();
    respondPublicStatus(true);
    const user = userEvent.setup();
    renderAt("/setup");
    await waitFor(() =>
      expect(document.querySelectorAll("input").length).toBeGreaterThan(0),
    );
    expect(await typeIntoAllFields(user)).toBeGreaterThan(0);
    expect(storedCount()).toBe(0);
  });

  it.each([
    ["パスワード変更（S-03/S-04）", "/password", "パスワード", null],
    ["プロフィール（S-19）", "/profile", "プロフィール", null],
    ["チャンネルの作成申請", "/channel-requests", "チャンネル", null],
    ["取引先", "/clients", "取引先", "取引先を登録"],
    ["部署の作成", "/departments/new", "部署", null],
    ["アカウントの登録", "/accounts/new", "アカウント", null],
  ])(
    "#239 AC-7: %s の入力欄に入力しても、端末に何も保存しない",
    async (_l, path, heading, opener) => {
      respondSignedIn();
      const user = userEvent.setup();
      renderAt(path);
      await screen.findByRole("heading", {
        level: 1,
        name: new RegExp(heading),
      });
      // 入力欄をボタンで開く画面は、開いてから入力する
      if (opener !== null)
        await user.click(await screen.findByRole("button", { name: opener }));
      await waitFor(() =>
        expect(
          screen.getByRole("main").querySelectorAll("input, textarea").length,
        ).toBeGreaterThan(0),
      );
      expect(await typeIntoAllFields(user)).toBeGreaterThan(0);
      expect(storedCount()).toBe(0);
    },
  );

  it("#239 AC-7: 再認証（S-26）のパスワードに入力しても、端末に何も保存しない", async () => {
    respondSignedIn();
    const failures: unknown[] = [];
    function Trigger() {
      const { withReauth } = useReauth();
      return (
        <button
          type="button"
          onClick={() => {
            // 片付けで中止されたときの失敗は、記録して確かめる（もみ消さない）
            void withReauth("[E2E_TEST]重要な操作", async () => "完了").catch(
              (error: unknown) => failures.push(error),
            );
          }}
        >
          重要な操作
        </button>
      );
    }
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    client.setQueryData(authKeys.session, SESSION);
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/"]}>
          <ReauthProvider>
            <Routes>
              <Route path="/" element={<Trigger />} />
            </Routes>
          </ReauthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await user.click(screen.getByRole("button", { name: "重要な操作" }));
    const password = await screen.findByLabelText("パスワード", {
      selector: "input",
    });
    await user.type(password, INPUT);
    expect(storedCount()).toBe(0);
    expect(failures).toEqual([]);
  });
});
