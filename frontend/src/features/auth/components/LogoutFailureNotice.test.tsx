// #239 AC-4（改訂3〜5）：ログアウトの失敗を、アバターメニュー（popover）の外の共通レイアウトにも出す案内。
// 確認ダイアログ（showModal）でアバターメニューが閉じると、メニューの中の「ログアウトできませんでした」が見えなくなるため。
// 契約（実装前の仮置き）：
//   features/auth/index.ts から LogoutFailureNotice を公開する。useMutationState（mutationKey: authKeys.logout）の直近が error のときだけ、
//   role="alert"・tabIndex=-1 の要素に「ログアウトできませんでした。…」を出す。実行中・成功・初期では出さない。
//   直近の mutation が新しく error になったとき（前回の submittedAt と違うとき）だけ、
//   shouldFocusLogoutFailure(document.activeElement, 判定の関数) が true ならその要素へフォーカスを移し、false なら scrollIntoView({ block: "nearest" }) する。
//   マウントした時点ですでに error のときは、フォーカスを移さない（AppShell の作り直しで奪わない）。
//   features/auth/components/logout-failure-focus.ts の shouldFocusLogoutFailure(active: Element | null, isVisible: ((element: Element) => boolean) | undefined): boolean
//     active が null・body なら true。判定の関数がない（jsdom など checkVisibility がない環境）なら true。
//     判定の関数が false（閉じた popover・閉じた dialog の中）なら true。true（見えている要素）なら false。
// データは架空。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TEST_USER } from "../../../test/auth-handlers";
import { server } from "../../../test/server";
import { authKeys, LogoutFailureNotice } from "../index";
import { LogoutButton } from "./LogoutButton";
import { shouldFocusLogoutFailure } from "./logout-failure-focus";

const FAILURE = /ログアウトできませんでした/;

function Harness() {
  const [generation, setGeneration] = useState(0);
  return (
    <>
      <Routes>
        <Route path="/" element={<LogoutButton />} />
        <Route path="/login" element={<p>ログイン画面です</p>} />
      </Routes>
      <button type="button" onClick={() => setGeneration((n) => n + 1)}>
        案内を作り直す
      </button>
      <section aria-label="共通の案内">
        <LogoutFailureNotice key={generation} />
      </section>
    </>
  );
}

function renderNotice() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(authKeys.session, {
    user: TEST_USER,
    permissions: [],
    mustChangePassword: false,
    reauthenticatedAt: null,
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <Harness />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, user };
}

type Reply = "ok" | "fail" | Promise<void>;

/** 呼ばれた順に replies の応答を返す（Promise は解決されるまで待ってから失敗を返す） */
function respondLogoutSequence(replies: Reply[]) {
  const state = { calls: 0 };
  server.use(
    http.post("/api/auth/logout", async () => {
      const reply = replies[state.calls] ?? "fail";
      state.calls += 1;
      if (reply === "ok") return new HttpResponse(null, { status: 204 });
      if (reply !== "fail") await reply;
      return HttpResponse.json(
        { code: "INTERNAL", message: "エラーが発生しました" },
        { status: 500 },
      );
    }),
  );
  return state;
}

const region = () => screen.getByRole("region", { name: "共通の案内" });
const noticeIn = () => within(region()).queryByRole("alert");
const logoutButton = () => screen.getByRole("button", { name: /ログアウト/ });

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, "checkVisibility");
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

describe("#239 AC-4 LogoutFailureNotice", () => {
  it("#239 AC-4: 初めは何も出さない", () => {
    renderNotice();
    expect(noticeIn()).toBeNull();
  });

  it("#239 AC-4: ログアウトが失敗したら、共通の案内に role=alert で失敗を出し、そこへフォーカスを移す", async () => {
    respondLogoutSequence(["fail"]);
    const { user } = renderNotice();
    await user.click(logoutButton());
    const notice = await within(region()).findByRole("alert");
    expect(notice.textContent).toMatch(FAILURE);
    expect(notice.getAttribute("tabindex")).toBe("-1");
    await waitFor(() => expect(document.activeElement).toBe(notice));
  });

  it("#239 AC-4: 失敗の後にもう一度押して実行中になると、案内は消える", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    respondLogoutSequence(["fail", gate]);
    const { user } = renderNotice();
    await user.click(logoutButton());
    await within(region()).findByRole("alert");
    await user.click(logoutButton());
    await waitFor(() => expect(noticeIn()).toBeNull());
    release();
    expect(await within(region()).findByRole("alert")).toBeTruthy();
  });

  it("#239 AC-4: 失敗 → 再実行 → 再び失敗で、もう一度フォーカスを移す", async () => {
    const state = respondLogoutSequence(["fail", "fail"]);
    const { user } = renderNotice();
    await user.click(logoutButton());
    const first = await within(region()).findByRole("alert");
    await waitFor(() => expect(document.activeElement).toBe(first));
    await user.click(logoutButton());
    await waitFor(() => expect(state.calls).toBe(2));
    await waitFor(() =>
      expect(document.activeElement).toBe(within(region()).getByRole("alert")),
    );
  });

  it("#239 AC-4: 成功したら案内を出さない（キャッシュごと消える）", async () => {
    respondLogoutSequence(["ok"]);
    const { client, user } = renderNotice();
    await user.click(logoutButton());
    expect(await screen.findByText("ログイン画面です")).toBeTruthy();
    expect(noticeIn()).toBeNull();
    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });

  it("#239 AC-4: 案内を作り直しても（AppShell の再マウント）、すでに出ている失敗ではフォーカスを奪わない", async () => {
    respondLogoutSequence(["fail"]);
    const { user } = renderNotice();
    await user.click(logoutButton());
    await within(region()).findByRole("alert");
    const remount = screen.getByRole("button", { name: "案内を作り直す" });
    await user.click(remount);
    expect(document.activeElement).toBe(remount);
    expect(within(region()).getByRole("alert")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(document.activeElement).toBe(remount);
  });

  it("#239 AC-4（改訂5）: 利用者が見えている要素を触っているときはフォーカスを移さず、案内を表示域に入れる（scrollIntoView block: nearest）", async () => {
    Object.defineProperty(HTMLElement.prototype, "checkVisibility", {
      configurable: true,
      writable: true,
      value: () => true,
    });
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    });
    respondLogoutSequence(["fail"]);
    const { user } = renderNotice();
    const button = logoutButton();
    await user.click(button);
    const notice = await within(region()).findByRole("alert");
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(scrollIntoView.mock.contexts).toContain(notice);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(document.activeElement).toBe(button);
  });
});

describe("#239 AC-4 shouldFocusLogoutFailure（フォーカスを移すかの判定）", () => {
  it("#239 AC-4: フォーカスがない（null）・body にあるときは移す", () => {
    expect(shouldFocusLogoutFailure(null, () => true)).toBe(true);
    expect(shouldFocusLogoutFailure(document.body, () => true)).toBe(true);
  });

  it("#239 AC-4: 見えている要素にフォーカスがあるときは移さない。判定の関数には、その要素を渡す", () => {
    const element = document.createElement("button");
    document.body.appendChild(element);
    const isVisible = vi.fn(() => true);
    try {
      expect(shouldFocusLogoutFailure(element, isVisible)).toBe(false);
      expect(isVisible).toHaveBeenCalledWith(element);
    } finally {
      element.remove();
    }
  });

  it("#239 AC-4: 見えていない要素（閉じた popover・dialog の中）にフォーカスがあるときは移す", () => {
    const element = document.createElement("button");
    expect(shouldFocusLogoutFailure(element, () => false)).toBe(true);
  });

  it("#239 AC-4: 判定の関数がない環境（checkVisibility なし）では、見えない失敗を作らない側に倒して移す", () => {
    const element = document.createElement("button");
    expect(shouldFocusLogoutFailure(element, undefined)).toBe(true);
  });
});
