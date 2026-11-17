// #128（128-b）0-1 AC-16: S-22（AccountsList）の部署異動の操作。API は MSW。データは架空（testuser_128_・[E2E_TEST]・example.com）。
// 契約（計画 4.5。実装前の仮置き）：
//   一覧の行（role=row）：有効な行に名前「異動」のボタン。無効な行には出さない。
//   異動：ダイアログ（role=dialog、名前に「異動」を含む。対象の表示名を出す）で異動先の部署（combobox「異動先の部署」。
//     GET /department-options）を選び、「異動する」→ 再認証（useReauth().withReauth。期限内なら省略）→
//     POST /api/admin/accounts/:id/transfer { departmentId } → 204。
//     成功でダイアログを閉じ、accounts・channels・profile（社員一覧）のキャッシュを invalidate する。
//     失敗（409・422）はダイアログの中の role=alert にサーバーの文を出し、成功として閉じない。
//   完了のメッセージ（統括の決定）：成功でダイアログを閉じ、一覧の画面（ダイアログの外）の role=status に「異動しました」を含む文を出す。
//   自分の行にも「異動」を出す（「無効化」は出さないまま）。
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
const DEPT_A = { id: "01JTEST128XDEPTA0000000001", name: "[E2E_TEST]128部署A" };
const DEPT_B = { id: "01JTEST128XDEPTB0000000001", name: "[E2E_TEST]128部署B" };
const ME_ID = "01JTEST128XADMIN0000000001";
const ACTIVE_ID = "01JTEST128XACTIVE000000001";
const GONE_ID = "01JTEST128XGONE00000000001";

function account(
  id: string,
  loginId: string,
  active: boolean,
): Record<string, unknown> {
  return {
    id,
    loginId,
    displayName: `${loginId}_表示`,
    department: active ? DEPT_A : null,
    email: `${loginId}@example.com`,
    extension: null,
    jobTitle: null,
    active,
    mustChangePassword: false,
    createdAt: "2026-11-17T00:00:00.000Z",
  };
}

const ITEMS = [
  account(ME_ID, "testuser_128_x_admin", true),
  account(ACTIVE_ID, "testuser_128_x_active", true),
  account(GONE_ID, "testuser_128_x_gone", false),
];

type Calls = { transfer: { id: string; body: unknown }[] };

function respond(options: { transfer?: () => Response } = {}): Calls {
  const calls: Calls = { transfer: [] };
  server.use(
    http.get(BASE, () => HttpResponse.json({ items: ITEMS, nextCursor: null })),
    http.get(`${BASE}/department-options`, () =>
      HttpResponse.json({ items: [DEPT_A, DEPT_B] }),
    ),
    http.post(`${BASE}/:id/transfer`, async ({ params, request }) => {
      calls.transfer.push({
        id: String(params.id),
        body: await request.json(),
      });
      return options.transfer?.() ?? new HttpResponse(null, { status: 204 });
    }),
  );
  return calls;
}

const apiError = (
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
) => HttpResponse.json({ code, message, ...extra }, { status });

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
      displayName: "testuser_128_x_admin_表示",
      loginId: "testuser_128_x_admin",
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
  return { user, invalidate };
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

/** 有効な行の「異動」を押し、異動先に部署Bを選ぶ。送信はしない */
async function openAndChoose(user: ReturnType<typeof userEvent.setup>) {
  const row = await rowOf("testuser_128_x_active");
  await user.click(within(row).getByRole("button", { name: "異動" }));
  const dialog = await screen.findByRole("dialog", { name: /異動/ });
  const select = await within(dialog).findByRole("combobox", {
    name: /異動先の部署/,
  });
  await within(select).findByRole("option", { name: DEPT_B.name });
  await user.selectOptions(select, DEPT_B.id);
  return dialog;
}

describe("#128 AC-16: 行の操作の出し分け", () => {
  it("#128 AC-16: 有効な行に「異動」を出し、無効な行には出さない", async () => {
    respond();
    renderList();
    const active = await rowOf("testuser_128_x_active");
    expect(within(active).getByRole("button", { name: "異動" })).toBeTruthy();
    const gone = await rowOf("testuser_128_x_gone");
    expect(within(gone).queryByRole("button", { name: "異動" })).toBeNull();
  });
});

describe("#128 AC-16: 部署異動", () => {
  it("#128 AC-16: ダイアログに対象の表示名を出し、異動先を選んで「異動する」で送り、閉じて一覧・チャンネル・社員一覧を取り直す", async () => {
    const calls = respond();
    const { user, invalidate } = renderList();
    const dialog = await openAndChoose(user);
    expect(within(dialog).getByText(/testuser_128_x_active_表示/)).toBeTruthy();
    expect(calls.transfer).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "異動する" }));
    await waitFor(() =>
      expect(calls.transfer).toEqual([
        { id: ACTIVE_ID, body: { departmentId: DEPT_B.id } },
      ]),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /異動/ })).toBeNull(),
    );
    await waitFor(() => {
      const keys = invalidatedKeys(invalidate);
      expect(keys).toContain(JSON.stringify(["accounts"]));
      expect(keys).toContain(JSON.stringify(["channels"]));
      expect(keys).toContain(JSON.stringify(["profile"]));
    });
  });

  it("#128 AC-16: 異動先を選ばずには送らない", async () => {
    const calls = respond();
    const { user } = renderList();
    const row = await rowOf("testuser_128_x_active");
    await user.click(within(row).getByRole("button", { name: "異動" }));
    const dialog = await screen.findByRole("dialog", { name: /異動/ });
    await within(dialog).findByRole("combobox", { name: /異動先の部署/ });
    await user.click(within(dialog).getByRole("button", { name: "異動する" }));
    expect(calls.transfer).toEqual([]);
  });

  it("#128 AC-16: 「キャンセル」では送らない", async () => {
    const calls = respond();
    const { user } = renderList();
    const dialog = await openAndChoose(user);
    await user.click(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /異動/ })).toBeNull(),
    );
    expect(calls.transfer).toEqual([]);
  });

  it("#128 AC-16: 再認証が切れていれば、再認証のダイアログを出し、パスワードを入れるまで送らない", async () => {
    const calls = respond();
    const { user } = renderList({ reauthenticatedAt: null });
    const dialog = await openAndChoose(user);
    await user.click(within(dialog).getByRole("button", { name: "異動する" }));
    expect(await screen.findByRole("dialog", { name: "再認証" })).toBeTruthy();
    expect(calls.transfer).toEqual([]);
  });

  it.each([
    [
      "今の部署のオーナー",
      409,
      "CONFLICT",
      "[UNIT_TEST]部署のオーナーは、先にオーナーを交代してから異動してください",
      { reason: "department_owner" },
    ],
    [
      "無効",
      409,
      "CONFLICT",
      "[UNIT_TEST]無効なアカウントは異動できません",
      { reason: "inactive" },
    ],
    [
      "今の部署と同じ",
      422,
      "VALIDATION_ERROR",
      "[UNIT_TEST]今と違う部署を選んでください",
      { fields: ["departmentId"] },
    ],
  ])(
    "#128 AC-16・AC-18: 対象が%sで拒否されたら、ダイアログの中にサーバーの文を出し、成功として閉じない",
    async (_label, status, code, message, extra) => {
      respond({ transfer: () => apiError(status, code, message, extra) });
      const { user, invalidate } = renderList();
      const dialog = await openAndChoose(user);
      await user.click(
        within(dialog).getByRole("button", { name: "異動する" }),
      );
      await waitFor(() => expect(dialog.textContent ?? "").toContain(message));
      expect(screen.getByRole("dialog", { name: /異動/ })).toBe(dialog);
      expect(invalidatedKeys(invalidate)).not.toContain(
        JSON.stringify(["accounts"]),
      );
    },
  );
});

describe("#128 AC-16: 本人の行", () => {
  it("#128 AC-16: 自分の行にも「異動」を出し、「無効化」は出さない", async () => {
    respond();
    renderList();
    const me = await rowOf("testuser_128_x_admin");
    expect(within(me).getByRole("button", { name: "異動" })).toBeTruthy();
    expect(within(me).queryByRole("button", { name: /無効化/ })).toBeNull();
  });
});

// 無効化・再有効化の完了のメッセージ（account-lifecycle.test.tsx）と同じ書き方
const doneMessage = (text: string) =>
  screen
    .queryAllByRole("status")
    .filter(
      (el) =>
        (el.textContent ?? "").includes(text) && el.closest("dialog") === null,
    );

describe("#128 AC-16: 異動の完了のメッセージ", () => {
  it("#128 AC-16: 異動が成功したら、ダイアログが閉じ、一覧の画面に role=status で「異動しました」を出す", async () => {
    respond();
    const { user } = renderList();
    const dialog = await openAndChoose(user);
    await user.click(within(dialog).getByRole("button", { name: "異動する" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /異動/ })).toBeNull(),
    );
    await waitFor(() => expect(doneMessage("異動しました")).toHaveLength(1));
  });

  it("#128 AC-16: 異動が失敗・キャンセルでは「異動しました」を出さない", async () => {
    respond({
      transfer: () =>
        apiError(
          409,
          "CONFLICT",
          "[UNIT_TEST]無効なアカウントは異動できません",
          {
            reason: "inactive",
          },
        ),
    });
    const { user } = renderList();
    const dialog = await openAndChoose(user);
    await user.click(within(dialog).getByRole("button", { name: "異動する" }));
    await waitFor(() =>
      expect(dialog.textContent ?? "").toContain(
        "[UNIT_TEST]無効なアカウントは異動できません",
      ),
    );
    expect(doneMessage("異動しました")).toHaveLength(0);
    await user.click(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /異動/ })).toBeNull(),
    );
    expect(doneMessage("異動しました")).toHaveLength(0);
  });

  it("#128 AC-16: 次の操作（別のダイアログを開く）を始めたら、前の「異動しました」は消える", async () => {
    respond();
    const { user } = renderList();
    const dialog = await openAndChoose(user);
    await user.click(within(dialog).getByRole("button", { name: "異動する" }));
    await waitFor(() => expect(doneMessage("異動しました")).toHaveLength(1));
    const gone = await rowOf("testuser_128_x_gone");
    await user.click(within(gone).getByRole("button", { name: /再有効化/ }));
    await screen.findByRole("dialog", { name: /再有効化/ });
    expect(doneMessage("異動しました")).toHaveLength(0);
  });
});
