// #128（128-a）0-1 AC-9・AC-11・AC-14: S-22（AccountsList）の無効化・再有効化の操作。API は MSW。データは架空（testuser_128_・[E2E_TEST]・example.com）。
// 契約（計画 3.5・3.6。実装前の仮置き）：
//   <AccountsList /> を QueryClientProvider・MemoryRouter・ReauthProvider の中で描画する。ログイン中の利用者は auth のセッションのキャッシュ。
//   一覧の行（role=row）：有効な行に名前「無効化」のボタン、無効な行に名前「再有効化」のボタン。状態の列は「有効」「無効」。
//     自分の行には「無効化」を出さない（表示の制御。認可はサーバー）。
//   無効化：確認のダイアログ（role=dialog、名前に「無効化」を含む。対象の表示名を出す。「無効化する」「キャンセル」）→
//     再認証（useReauth().withReauth。期限内なら省略）→ POST /api/admin/accounts/:id/deactivate。
//     成功でダイアログを閉じ、accounts・channels・profile（社員一覧）のキャッシュを invalidate する。
//     失敗（409・422）はダイアログの中の role=alert にサーバーの文を出す。
//   再有効化：ダイアログ（role=dialog、名前に「再有効化」を含む）で所属部署（combobox「所属部署」。GET /department-options）を選び、
//     「再有効化する」→ 再認証 → POST /api/admin/accounts/:id/reactivate { departmentId } → 一時パスワードをダイアログに表示。
//     一時パスワードは useMutation に載せず（project-rules #199）、ダイアログの useState だけに置く。「閉じる」で消える。端末に保存しない。
// 期待値は要件・計画から書く。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { server } from "../../test/server";
import { authKeys } from "../auth";
import { ReauthProvider } from "../auth/ReauthProvider";
import { AccountsList } from "./AccountsList";

const BASE = "/api/admin/accounts";
// テスト専用の固定値（実際の一時パスワードではない）
const TEST_INITIAL_PASSWORD = "Tq7#xZ9!mK2$pW4v";
const DEPT = { id: "01JTEST128DEPT000000000001", name: "[E2E_TEST]128部署" };
const ME_ID = "01JTEST128ADMIN00000000001";
const ACTIVE_ID = "01JTEST128ACTIVE0000000001";
const GONE_ID = "01JTEST128GONE000000000001";

function account(
  id: string,
  loginId: string,
  active: boolean,
): Record<string, unknown> {
  return {
    id,
    loginId,
    displayName: `${loginId}_表示`,
    department: active ? DEPT : null,
    email: `${loginId}@example.com`,
    extension: null,
    jobTitle: null,
    active,
    mustChangePassword: false,
    createdAt: "2026-11-17T00:00:00.000Z",
  };
}

const ITEMS = [
  account(ME_ID, "testuser_128_admin", true),
  account(ACTIVE_ID, "testuser_128_active", true),
  account(GONE_ID, "testuser_128_gone", false),
];

type Calls = {
  list: number;
  deactivate: string[];
  reactivate: { id: string; body: unknown }[];
};

function respond(
  options: {
    deactivate?: () => Response;
    reactivate?: () => Response;
  } = {},
): Calls {
  const calls: Calls = { list: 0, deactivate: [], reactivate: [] };
  server.use(
    http.get(BASE, () => {
      calls.list += 1;
      return HttpResponse.json({ items: ITEMS, nextCursor: null });
    }),
    http.get(`${BASE}/department-options`, () =>
      HttpResponse.json({ items: [DEPT] }),
    ),
    http.post(`${BASE}/:id/deactivate`, ({ params }) => {
      calls.deactivate.push(String(params.id));
      return options.deactivate?.() ?? new HttpResponse(null, { status: 204 });
    }),
    http.post(`${BASE}/:id/reactivate`, async ({ params, request }) => {
      calls.reactivate.push({
        id: String(params.id),
        body: await request.json(),
      });
      return (
        options.reactivate?.() ??
        HttpResponse.json(
          { id: String(params.id), initialPassword: TEST_INITIAL_PASSWORD },
          { headers: { "Cache-Control": "no-store" } },
        )
      );
    }),
  );
  return calls;
}

const apiError = (
  status: number,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
) => HttpResponse.json({ code, message, details }, { status });

function renderList(options: { reauthenticatedAt?: string | null } = {}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  client.setQueryData(authKeys.session, {
    user: {
      id: ME_ID,
      displayName: "testuser_128_admin_表示",
      loginId: "testuser_128_admin",
    },
    permissions: ["perm.account.create"],
    mustChangePassword: false,
    reauthenticatedAt:
      options.reauthenticatedAt === undefined
        ? new Date().toISOString()
        : options.reauthenticatedAt,
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ReauthProvider>
          <AccountsList />
        </ReauthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user, client, invalidate };
}

async function rowOf(loginId: string) {
  return screen.findByRole("row", { name: new RegExp(loginId) });
}

const invalidatedKeys = (invalidate: {
  mock: { calls: readonly (readonly unknown[])[] };
}) =>
  invalidate.mock.calls.map((call) =>
    JSON.stringify((call[0] as { queryKey?: unknown } | undefined)?.queryKey),
  );

describe("#128 AC-9・AC-11: 行の操作の出し分け", () => {
  it("#128 AC-9・AC-14: 有効な他人の行に「無効化」、無効な行に「再有効化」と「無効」を出し、自分の行には「無効化」を出さない", async () => {
    respond();
    renderList();
    const active = await rowOf("testuser_128_active");
    expect(within(active).getByRole("button", { name: /無効化/ })).toBeTruthy();
    expect(
      within(active).queryByRole("button", { name: /再有効化/ }),
    ).toBeNull();
    const gone = await rowOf("testuser_128_gone");
    expect(within(gone).getByRole("button", { name: /再有効化/ })).toBeTruthy();
    expect(
      within(gone)
        .queryAllByRole("button")
        .filter((b) => /無効化/.test(b.textContent ?? "")),
    ).toHaveLength(0);
    expect(within(gone).getByText("無効")).toBeTruthy();
    const me = await rowOf("testuser_128_admin");
    expect(within(me).queryByRole("button", { name: /無効化/ })).toBeNull();
  });
});

describe("#128 AC-9: 無効化", () => {
  it("#128 AC-9: 確認のダイアログに対象の表示名を出し、「無効化する」で送り、閉じて一覧・チャンネル・社員一覧を取り直す", async () => {
    const calls = respond();
    const { user, invalidate } = renderList();
    const row = await rowOf("testuser_128_active");
    await user.click(within(row).getByRole("button", { name: /無効化/ }));
    const dialog = await screen.findByRole("dialog", { name: /無効化/ });
    expect(within(dialog).getByText(/testuser_128_active_表示/)).toBeTruthy();
    expect(calls.deactivate).toEqual([]);
    await user.click(
      within(dialog).getByRole("button", { name: "無効化する" }),
    );
    await waitFor(() => expect(calls.deactivate).toEqual([ACTIVE_ID]));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /無効化/ })).toBeNull(),
    );
    const keys = invalidatedKeys(invalidate);
    expect(keys).toContain(JSON.stringify(["accounts"]));
    expect(keys).toContain(JSON.stringify(["channels"]));
    expect(keys).toContain(JSON.stringify(["profile"]));
  });

  it("#128 AC-9: 「キャンセル」では送らない", async () => {
    const calls = respond();
    const { user } = renderList();
    const row = await rowOf("testuser_128_active");
    await user.click(within(row).getByRole("button", { name: /無効化/ }));
    const dialog = await screen.findByRole("dialog", { name: /無効化/ });
    await user.click(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /無効化/ })).toBeNull(),
    );
    expect(calls.deactivate).toEqual([]);
  });

  it("#128 AC-9: 再認証が切れていれば、再認証のダイアログを出し、パスワードを入れるまで送らない", async () => {
    const calls = respond();
    const { user } = renderList({ reauthenticatedAt: null });
    const row = await rowOf("testuser_128_active");
    await user.click(within(row).getByRole("button", { name: /無効化/ }));
    const dialog = await screen.findByRole("dialog", { name: /無効化/ });
    await user.click(
      within(dialog).getByRole("button", { name: "無効化する" }),
    );
    expect(await screen.findByRole("dialog", { name: "再認証" })).toBeTruthy();
    expect(calls.deactivate).toEqual([]);
  });

  it.each([
    [
      "全体管理者",
      409,
      "CONFLICT",
      "全体管理者は、後任へ引き継ぐまで無効化できません",
      { reason: "global_admin" },
    ],
    [
      "部署のオーナー",
      409,
      "CONFLICT",
      "部署のオーナーは、先にオーナーを交代してから無効化してください",
      { reason: "department_owner" },
    ],
    [
      "既に無効",
      409,
      "CONFLICT",
      "このアカウントはすでに無効です",
      { reason: "already_inactive" },
    ],
    ["本人", 422, "VALIDATION_ERROR", "自分のアカウントは無効化できません", {}],
  ])(
    "#128 AC-9: 対象が%sで拒否されたら、ダイアログの中に理由の文を出し、成功として閉じない",
    async (_label, status, code, message, details) => {
      respond({ deactivate: () => apiError(status, code, message, details) });
      const { user, invalidate } = renderList();
      const row = await rowOf("testuser_128_active");
      await user.click(within(row).getByRole("button", { name: /無効化/ }));
      const dialog = await screen.findByRole("dialog", { name: /無効化/ });
      await user.click(
        within(dialog).getByRole("button", { name: "無効化する" }),
      );
      const alert = await within(dialog).findByRole("alert");
      expect(alert.textContent).toContain(message);
      expect(screen.getByRole("dialog", { name: /無効化/ })).toBeTruthy();
      expect(invalidatedKeys(invalidate)).not.toContain(
        JSON.stringify(["accounts"]),
      );
    },
  );
});

describe("#128 AC-14: 再有効化と一時パスワードの表示", () => {
  it("#128 AC-14（U-7）: 部署を選んで送ると一時パスワードを一度だけ表示し、「閉じる」で消える。端末には保存しない", async () => {
    const calls = respond();
    const { user, invalidate, client } = renderList();
    const row = await rowOf("testuser_128_gone");
    await user.click(within(row).getByRole("button", { name: /再有効化/ }));
    const dialog = await screen.findByRole("dialog", { name: /再有効化/ });
    const select = await within(dialog).findByRole("combobox", {
      name: /所属部署/,
    });
    await within(select).findByRole("option", { name: DEPT.name });
    await user.selectOptions(select, DEPT.id);
    await user.click(
      within(dialog).getByRole("button", { name: "再有効化する" }),
    );
    await waitFor(() =>
      expect(calls.reactivate).toEqual([
        { id: GONE_ID, body: { departmentId: DEPT.id } },
      ]),
    );
    expect(
      await within(dialog).findByText(TEST_INITIAL_PASSWORD, { exact: false }),
    ).toBeTruthy();
    // MutationCache・端末に一時パスワードを残さない（#199）
    expect(
      JSON.stringify(
        client
          .getMutationCache()
          .getAll()
          .map((m) => m.state),
      ),
    ).not.toContain(TEST_INITIAL_PASSWORD);
    const stored = JSON.stringify({
      ...window.localStorage,
      ...window.sessionStorage,
    });
    expect(stored).not.toContain(TEST_INITIAL_PASSWORD);
    const keys = invalidatedKeys(invalidate);
    expect(keys).toContain(JSON.stringify(["accounts"]));
    expect(keys).toContain(JSON.stringify(["channels"]));
    expect(keys).toContain(JSON.stringify(["profile"]));

    await user.click(within(dialog).getByRole("button", { name: "閉じる" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /再有効化/ })).toBeNull(),
    );
    expect(
      screen.queryByText(TEST_INITIAL_PASSWORD, { exact: false }),
    ).toBeNull();
  });

  it("#128 AC-14: 部署を選ばずには送らない", async () => {
    const calls = respond();
    const { user } = renderList();
    const row = await rowOf("testuser_128_gone");
    await user.click(within(row).getByRole("button", { name: /再有効化/ }));
    const dialog = await screen.findByRole("dialog", { name: /再有効化/ });
    await within(dialog).findByRole("combobox", { name: /所属部署/ });
    await user.click(
      within(dialog).getByRole("button", { name: "再有効化する" }),
    );
    expect(calls.reactivate).toEqual([]);
  });

  it("#128 AC-14: 拒否（409）されたらダイアログの中にサーバーの文を出し、一時パスワードを出さない", async () => {
    respond({
      reactivate: () =>
        apiError(409, "CONFLICT", "このアカウントはすでに有効です", {
          reason: "already_active",
        }),
    });
    const { user } = renderList();
    const row = await rowOf("testuser_128_gone");
    await user.click(within(row).getByRole("button", { name: /再有効化/ }));
    const dialog = await screen.findByRole("dialog", { name: /再有効化/ });
    const select = await within(dialog).findByRole("combobox", {
      name: /所属部署/,
    });
    await within(select).findByRole("option", { name: DEPT.name });
    await user.selectOptions(select, DEPT.id);
    await user.click(
      within(dialog).getByRole("button", { name: "再有効化する" }),
    );
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("このアカウントはすでに有効です");
    expect(
      screen.queryByText(TEST_INITIAL_PASSWORD, { exact: false }),
    ).toBeNull();
  });
});
