// #239 AC-4（1-1 AC-4・0-2 AC-8・C-82）：ログアウトのボタンを押して API が成功したときに、その利用者の端末の下書きをすべて消す。
// 確認の提供元（LeaveGuardProvider）なしで描画する（変更がない／提供元がないときの経路。確認つきの経路は features/leave-guard/leave-guard.test.tsx）。
// 契約（実装前の仮置き。計画 plan-239 と改訂1〜5）：
//   useLogout は mutate の時点のセッションのキャッシュから利用者IDを確定する（後でキャッシュが替わっても、その利用者の分を消す）。
//   mutate の時点でセッションがなければ消去を飛ばし、ログアウトは進める。
//   成功：removeUserDrafts → queryClient.clear() → navigate("/login", { replace: true })。
//   消去に失敗（想定外の例外・DraftStorageUnavailableError のどちらも）：clear() の後に
//         navigate("/login", { replace: true, state: { draftCleanupFailed: true } })。投げ直さない。
//   API の失敗（500）：何も消さない。
//   useMutation に mutationKey: authKeys.logout を付ける。
//   features/auth/index.ts から DraftCleanupNotice を公開する（location.state を Zod で検証し、
//   draftCleanupFailed が true のときだけ「この端末の下書きを消せませんでした。共用の端末では、ブラウザのサイトデータを削除してください。」を出す。role="alert" にしない）。
// データは架空。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "../../../test/server";
import { LogoutButton } from "../components/LogoutButton";
import { authKeys, DraftCleanupNotice } from "../index";

const USER_A = {
  id: "01JTESTUSER00000000000DA01",
  displayName: "testuser_draft_a",
  loginId: "testuser_draft_a",
};
const USER_B = {
  id: "01JTESTUSER00000000000DB01",
  displayName: "testuser_draft_b",
  loginId: "testuser_draft_b",
};
const sessionOf = (user: typeof USER_A) => ({
  user,
  permissions: [],
  mustChangePassword: false,
  reauthenticatedAt: null,
});
const CLEANUP_NOTICE =
  "この端末の下書きを消せませんでした。共用の端末では、ブラウザのサイトデータを削除してください。";

const keyOf = (userId: string, roomId: string) =>
  `internal-system:draft:v1:${userId}:room:${roomId}`;
const putDraft = (userId: string, roomId: string) =>
  window.localStorage.setItem(
    keyOf(userId, roomId),
    JSON.stringify({ body: `[E2E_TEST]${roomId}`, updatedAt: Date.now() }),
  );
const storedKeys = () =>
  Array.from({ length: window.localStorage.length }, (_v, i) =>
    window.localStorage.key(i),
  ).sort();

function seedDrafts() {
  putDraft(USER_A.id, "R1");
  putDraft(USER_A.id, "R2");
  putDraft(USER_B.id, "R1");
  window.localStorage.setItem("other-app:setting", "keep");
}

function renderLogout(session: typeof USER_A | null = USER_A) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  if (session !== null)
    client.setQueryData(authKeys.session, sessionOf(session));
  const router = createMemoryRouter(
    [
      { path: "/", element: <LogoutButton /> },
      {
        path: "/login",
        element: (
          <>
            <p>ログイン画面です</p>
            <DraftCleanupNotice />
          </>
        ),
      },
    ],
    { initialEntries: ["/"] },
  );
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { client, router, user };
}

function respondLogout(status = 204, wait?: Promise<void>) {
  const state = { calls: 0 };
  server.use(
    http.post("/api/auth/logout", async () => {
      state.calls += 1;
      if (wait !== undefined) await wait;
      else await delay(5);
      if (status === 204) return new HttpResponse(null, { status: 204 });
      return HttpResponse.json(
        { code: "INTERNAL", message: "エラーが発生しました" },
        { status },
      );
    }),
  );
  return state;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("#239 AC-4 ログアウトで下書きを消す", () => {
  it("#239 AC-4: ログアウトが成功したら、その利用者の下書きだけを消し、他の利用者・関係のないキーは残して /login へ（replace）移る", async () => {
    seedDrafts();
    respondLogout();
    const { client, router, user } = renderLogout();
    await user.click(screen.getByRole("button", { name: "ログアウト" }));
    expect(await screen.findByText("ログイン画面です")).toBeTruthy();
    expect(storedKeys()).toEqual(
      ["other-app:setting", keyOf(USER_B.id, "R1")].sort(),
    );
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(router.state.historyAction).toBe("REPLACE");
    expect(screen.queryByText(CLEANUP_NOTICE)).toBeNull();
  });

  it("#239 AC-4（U-2）: ログアウトの API が失敗（500）したら、下書きを消さない", async () => {
    seedDrafts();
    const logout = respondLogout(500);
    const { router, user } = renderLogout();
    await user.click(screen.getByRole("button", { name: "ログアウト" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(logout.calls).toBe(1);
    expect(storedKeys()).toEqual(
      [
        "other-app:setting",
        keyOf(USER_A.id, "R1"),
        keyOf(USER_A.id, "R2"),
        keyOf(USER_B.id, "R1"),
      ].sort(),
    );
    expect(router.state.location.pathname).toBe("/");
  });

  it("#239 AC-4: 消す対象の利用者は押した時点で決める（応答を待つ間にキャッシュが B に替わっても、A の下書きを消し B は残す）", async () => {
    seedDrafts();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    respondLogout(204, gate);
    const { client, user } = renderLogout();
    await user.click(screen.getByRole("button", { name: "ログアウト" }));
    client.setQueryData(authKeys.session, sessionOf(USER_B));
    release();
    expect(await screen.findByText("ログイン画面です")).toBeTruthy();
    expect(storedKeys()).toEqual(
      ["other-app:setting", keyOf(USER_B.id, "R1")].sort(),
    );
  });

  it("#239 AC-4: 押した時点でセッションのキャッシュがなければ、消す対象を決められないので消去を飛ばし、ログアウトは進める", async () => {
    seedDrafts();
    const logout = respondLogout();
    const { user } = renderLogout(null);
    await user.click(screen.getByRole("button", { name: "ログアウト" }));
    expect(await screen.findByText("ログイン画面です")).toBeTruthy();
    expect(logout.calls).toBe(1);
    expect(storedKeys()).toHaveLength(4);
    expect(screen.queryByText(CLEANUP_NOTICE)).toBeNull();
  });

  it.each([
    ["想定外の例外", () => new Error("[UNIT_TEST]想定外")],
    [
      "保存先が使えない（SecurityError）",
      () => new DOMException("使えません", "SecurityError"),
    ],
  ])(
    "#239 AC-4: 下書きの消去が%sで失敗しても、キャッシュを消して /login へ（replace）移り、ログイン画面に案内を出す",
    async (_l, make) => {
      seedDrafts();
      respondLogout();
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
        throw make();
      });
      const { client, router, user } = renderLogout();
      await user.click(screen.getByRole("button", { name: "ログアウト" }));
      expect(await screen.findByText("ログイン画面です")).toBeTruthy();
      expect(client.getQueryCache().getAll()).toHaveLength(0);
      expect(router.state.historyAction).toBe("REPLACE");
      const notice = await screen.findByText(CLEANUP_NOTICE);
      expect(notice.closest('[role="alert"]')).toBeNull();
    },
  );

  it("#239 AC-4: ログアウトの mutation は authKeys.logout のキーで記録される", async () => {
    respondLogout(500);
    const { client, user } = renderLogout();
    await user.click(screen.getByRole("button", { name: "ログアウト" }));
    await screen.findByRole("alert");
    expect(authKeys.logout).toBeDefined();
    expect(
      client.getMutationCache().findAll({ mutationKey: authKeys.logout }),
    ).toHaveLength(1);
  });
});

describe("#239 AC-4 DraftCleanupNotice（ログイン画面の案内）", () => {
  function renderNotice(state: unknown) {
    const router = createMemoryRouter(
      [
        {
          path: "/login",
          element: (
            <>
              <p>ログイン画面です</p>
              <DraftCleanupNotice />
            </>
          ),
        },
      ],
      { initialEntries: [{ pathname: "/login", state }] },
    );
    render(<RouterProvider router={router} />);
    // 部品の描画に失敗して何も出ない（空振りで通る）ことを防ぐ
    expect(screen.getByText("ログイン画面です")).toBeTruthy();
  }

  it("#239 AC-4: state.draftCleanupFailed が true のときだけ案内を出す", () => {
    renderNotice({ draftCleanupFailed: true });
    expect(screen.getByText(CLEANUP_NOTICE)).toBeTruthy();
  });

  it.each([
    ["state なし", null],
    ["false", { draftCleanupFailed: false }],
    ["文字列の true", { draftCleanupFailed: "true" }],
    ["別の state", { from: "/channels" }],
  ])("#239 AC-4: %s では案内を出さない", (_l, state) => {
    renderNotice(state);
    expect(screen.queryByText(CLEANUP_NOTICE)).toBeNull();
  });
});
