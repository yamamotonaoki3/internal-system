import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import {
  respondLoggedIn,
  TEST_PASSWORD,
  TEST_USER,
} from "../test/auth-handlers";
import { server } from "../test/server";

const NEXT_PASSWORD = "Different456!";
const CURRENT_LABEL = "現在のパスワード";
const NEW_LABEL = "新しいパスワード";
const CONFIRM_LABEL = "新しいパスワード（確認）";

function Path() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

function renderAt(path: string, forced = false, state?: unknown) {
  respondLoggedIn(forced);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: path, state }]}>
        <App />
        <Path />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, user };
}

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  confirmation = NEXT_PASSWORD,
) {
  await user.type(await screen.findByLabelText(CURRENT_LABEL), TEST_PASSWORD);
  await user.type(screen.getByLabelText(NEW_LABEL), NEXT_PASSWORD);
  await user.type(screen.getByLabelText(CONFIRM_LABEL), confirmation);
}

function recordChanges(respond: () => Response | Promise<Response>) {
  const bodies: unknown[] = [];
  server.use(
    http.put("/api/me/password", async ({ request }) => {
      bodies.push(await request.json());
      return respond();
    }),
  );
  return bodies;
}

describe("#123 S-03/S-04 本人のパスワード変更", () => {
  it("#123 0-3 AC-1: 通常利用者は共通レイアウト内の/passwordで変更フォームを開ける", async () => {
    renderAt("/password");
    expect(await screen.findByLabelText(CURRENT_LABEL)).toBeDefined();
    expect(screen.getByLabelText(NEW_LABEL)).toBeDefined();
    expect(screen.getByLabelText(CONFIRM_LABEL)).toBeDefined();
    expect(
      screen.getByText(
        "8〜128文字で、大文字・数字・半角記号を含めてください。",
      ),
    ).toBeDefined();
    expect(screen.getByRole("banner")).toBeDefined();
    expect(screen.getByRole("main")).toBeDefined();
  });

  it.each(["/", "/password", "/unknown-route"])(
    "#123 0-3 AC-5: 初回利用者は %s でも枠なしのS-03を表示し、業務ナビを出さない",
    async (path) => {
      renderAt(path, true);
      expect(await screen.findByLabelText(CURRENT_LABEL)).toBeDefined();
      expect(
        screen.getByText(
          "8〜128文字で、大文字・数字・半角記号を含めてください。",
        ),
      ).toBeDefined();
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        "パスワードの変更が必要です",
      );
      expect(screen.getAllByRole("main")).toHaveLength(1);
      expect(screen.queryByRole("banner")).toBeNull();
      expect(screen.queryAllByRole("navigation")).toHaveLength(0);
      expect(screen.getByRole("button", { name: "ログアウト" })).toBeDefined();
    },
  );

  it("#123 0-3 AC-1: 全パスワード欄を個別に表示・非表示へ切り替えられる", async () => {
    const { user } = renderAt("/password");
    for (const label of [CURRENT_LABEL, NEW_LABEL, CONFIRM_LABEL]) {
      const input = (await screen.findByLabelText(label)) as HTMLInputElement;
      expect(input.type).toBe("password");
      expect(input.autocomplete).toBe(
        label === CURRENT_LABEL ? "current-password" : "new-password",
      );
      const container = input.closest<HTMLElement>("div.mb-4");
      if (!container) throw new Error(`${label} の表示切替がありません`);
      await user.click(within(container).getByRole("button", { name: /表示/ }));
      expect(input.type).toBe("text");
      await user.click(within(container).getByRole("button", { name: /隠す/ }));
      expect(input.type).toBe("password");
    }
  });

  it("#123 0-3 AC-1: 確認欄が一致しなければAPIを呼ばず、入力エラーを表示する", async () => {
    const bodies = recordChanges(() => HttpResponse.json({}));
    const { user } = renderAt("/password");
    await fillForm(user, "Different456?");
    await user.click(screen.getByRole("button", { name: "パスワードを変更" }));
    await waitFor(() =>
      expect(
        screen.getByLabelText(CONFIRM_LABEL).getAttribute("aria-invalid"),
      ).toBe("true"),
    );
    expect(bodies).toHaveLength(0);
  });

  it("#123 0-3 AC-1/AC-4: 正常送信では確認欄を送らず、変更済みsessionを即時反映する", async () => {
    const nextSession = {
      user: TEST_USER,
      mustChangePassword: false,
      reauthenticatedAt: null,
    };
    let mustChangePassword = true;
    const bodies = recordChanges(() => {
      mustChangePassword = false;
      return HttpResponse.json(nextSession);
    });
    const { user, client } = renderAt("/password", true);
    server.use(
      http.get("/api/auth/session", () =>
        HttpResponse.json({
          ...nextSession,
          permissions: [],
          mustChangePassword,
        }),
      ),
    );
    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "パスワードを変更" }));
    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe("/"),
    );
    expect(bodies).toEqual([
      { currentPassword: TEST_PASSWORD, newPassword: NEXT_PASSWORD },
    ]);
    expect(
      await screen.findByText(`ようこそ、${TEST_USER.displayName}さん`),
    ).toBeDefined();
    const cached = JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    );
    expect(cached).not.toContain(TEST_PASSWORD);
    expect(cached).not.toContain(NEXT_PASSWORD);
    const mutations = JSON.stringify(
      client
        .getMutationCache()
        .getAll()
        .map((mutation) => mutation.state),
    );
    expect(mutations).not.toContain(TEST_PASSWORD);
    expect(mutations).not.toContain(NEXT_PASSWORD);
  });

  it("#123 0-3 AC-1: 送信中は多重送信を防ぐ", async () => {
    const bodies = recordChanges(async () => {
      await delay("infinite");
      return HttpResponse.json({});
    });
    const { user } = renderAt("/password");
    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "パスワードを変更" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    const button = screen.getByRole("button", {
      name: /変更中/,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await user.click(button);
    expect(bodies).toHaveLength(1);
  });

  it("#123 0-3 AC-1: 現在のパスワードが誤る422は現在欄に示す", async () => {
    recordChanges(() =>
      HttpResponse.json(
        {
          code: "VALIDATION_ERROR",
          message: "入力内容を確認してください",
          fields: ["currentPassword"],
        },
        { status: 422 },
      ),
    );
    const { user } = renderAt("/password");
    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "パスワードを変更" }));
    await waitFor(() =>
      expect(
        screen.getByLabelText(CURRENT_LABEL).getAttribute("aria-invalid"),
      ).toBe("true"),
    );
    expect(screen.getByTestId("path").textContent).toBe("/password");
  });

  it.each([
    [409, "CONFLICT"],
    [429, "RATE_LIMITED"],
  ])(
    "#123 0-3 AC-1: %i %s では画面に失敗を示し、入力画面に留まる",
    async (status, code) => {
      recordChanges(() =>
        HttpResponse.json(
          { code, message: "操作を完了できませんでした" },
          { status },
        ),
      );
      const { user } = renderAt("/password");
      await fillForm(user);
      await user.click(
        screen.getByRole("button", { name: "パスワードを変更" }),
      );
      expect(await screen.findByRole("alert")).toBeDefined();
      expect(screen.getByTestId("path").textContent).toBe("/password");
    },
  );

  it("#123 0-3 AC-1: 通信失敗時も成功扱いせず画面に留まる", async () => {
    recordChanges(() => HttpResponse.error());
    const { user } = renderAt("/password");
    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "パスワードを変更" }));
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByTestId("path").textContent).toBe("/password");
  });

  it("#123 0-3 AC-1: S-04はキャンセルでアプリ内の元画面へ戻る", async () => {
    const { user } = renderAt("/password", false, { from: "/" });
    await screen.findByLabelText(CURRENT_LABEL);
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe("/"),
    );
  });

  it.each([undefined, { from: "https://example.com" }, { from: "/password" }])(
    "#123 0-3 AC-1: S-04は安全な戻り先がなければhomeへ戻る",
    async (state) => {
      const { user } = renderAt("/password", false, state);
      await screen.findByLabelText(CURRENT_LABEL);
      await user.click(screen.getByRole("button", { name: "キャンセル" }));
      await waitFor(() =>
        expect(screen.getByTestId("path").textContent).toBe("/"),
      );
    },
  );

  it("#123 0-3 AC-5: 通常利用者の未知URLはページが見つからないことを示す", async () => {
    renderAt("/unknown-route");
    expect(await screen.findByText("ページが見つかりません")).toBeDefined();
  });
});
