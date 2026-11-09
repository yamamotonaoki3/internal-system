// #199 AC-5: 画面S-22（アカウント管理の一覧）のコンポーネントテスト。API は MSW で返す。データはすべて架空。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { server } from "../test/server";
import { AccountsPage } from "./AccountsPage";

const BASE = "/api/admin/accounts";
const DEPT = { id: "01JTESTDEPT000000000000001", name: "[E2E_TEST]テスト部" };

function account(n: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `01JTESTACCT00000000000000${n}`,
    loginId: `testuser_00${n}`,
    displayName: `テスト表示名${n}`,
    department: DEPT,
    email: `testuser_00${n}@example.com`,
    extension: "0000",
    jobTitle: "課長",
    active: true,
    mustChangePassword: true,
    createdAt: "2026-11-09T00:00:00.000Z",
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <AccountsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("#199 アカウント管理の一覧（S-22）", () => {
  it("#199 AC-5: 見出しと、新規登録（S-23 /accounts/new）への導線を出す", async () => {
    server.use(
      http.get(BASE, () => HttpResponse.json({ items: [], nextCursor: null })),
    );
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "アカウント管理" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "新規登録" }).getAttribute("href"),
    ).toBe("/accounts/new");
  });

  it("#199 AC-5（A-3）: ユーザーID・表示名・部署・メール・状態を行に出す", async () => {
    server.use(
      http.get(BASE, () =>
        HttpResponse.json({
          items: [account("1"), account("2", { active: false })],
          nextCursor: null,
        }),
      ),
    );
    renderPage();
    const row = await screen.findByRole("row", { name: /testuser_001/ });
    expect(row.textContent).toContain("テスト表示名1");
    expect(row.textContent).toContain("[E2E_TEST]テスト部");
    expect(row.textContent).toContain("testuser_001@example.com");
    const inactive = screen.getByRole("row", { name: /testuser_002/ });
    expect(inactive.textContent).toContain("無効");
  });

  it("#199 AC-5: 読み込み中と空の一覧を区別する", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(BASE, async () => {
        await gate;
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    renderPage();
    expect(screen.getByText(/読み込み中/)).toBeTruthy();
    release?.();
    expect(await screen.findByText(/アカウントがありません/)).toBeTruthy();
  });

  it("#199 AC-5: 取得の失敗は、空の一覧として表示しない", async () => {
    server.use(
      http.get(BASE, () =>
        HttpResponse.json(
          { code: "FORBIDDEN", message: "権限がありません" },
          { status: 403 },
        ),
      ),
    );
    renderPage();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/アカウントがありません/)).toBeNull();
  });

  it("#199 AC-5: 次のページは cursor で取得する", async () => {
    const cursors: (string | null)[] = [];
    server.use(
      http.get(BASE, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        cursors.push(cursor);
        return HttpResponse.json(
          cursor === "cursor_next"
            ? { items: [account("3")], nextCursor: null }
            : { items: [account("1")], nextCursor: "cursor_next" },
        );
      }),
    );
    renderPage();
    await screen.findByText("testuser_001");
    fireEvent.click(screen.getByRole("button", { name: "次のページ" }));
    expect(await screen.findByText("testuser_003")).toBeTruthy();
    await waitFor(() => expect(cursors).toContain("cursor_next"));
    expect(screen.queryByRole("button", { name: "次のページ" })).toBeNull();
  });
});
