import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installDomStubs,
  pressEscapeOn,
  type DomStubs,
} from "../../../test/app-shell-harness";
import {
  respondLoggedIn,
  TEST_PASSWORD,
  TEST_USER,
} from "../../../test/auth-handlers";
import { server } from "../../../test/server";
import { ReauthProvider } from "../ReauthProvider";
import { authKeys } from "../api/query-keys";
import { useReauth } from "./useReauth";

const NOW = new Date("2026-11-06T00:00:00.000Z");
let stubs: DomStubs;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function Trigger({
  run,
  onFailure,
}: {
  run: () => Promise<string>;
  onFailure: (error: unknown) => void;
}) {
  const { withReauth } = useReauth();
  const navigate = useNavigate();
  return (
    <>
      <button
        onClick={() => {
          void withReauth("重要な操作A", run).catch(onFailure);
        }}
      >
        操作A
      </button>
      <button
        onClick={() => {
          void withReauth("重要な操作B", run).catch(onFailure);
        }}
      >
        操作B
      </button>
      <button onClick={() => navigate("/other")}>画面移動</button>
    </>
  );
}

function renderReauth(
  options: {
    reauthenticatedAt?: string | null;
    run?: () => Promise<string>;
  } = {},
) {
  respondLoggedIn(false, options.reauthenticatedAt ?? null);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(authKeys.session, {
    user: TEST_USER,
    mustChangePassword: false,
    reauthenticatedAt: options.reauthenticatedAt ?? null,
  });
  const run = options.run ?? vi.fn(async () => "完了");
  const failures: unknown[] = [];
  const user = userEvent.setup();
  const rendered = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <ReauthProvider>
          <Routes>
            <Route
              path="/"
              element={
                <Trigger
                  run={run}
                  onFailure={(error) => failures.push(error)}
                />
              }
            />
            <Route path="/other" element={<p>移動先</p>} />
          </Routes>
        </ReauthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user, run, client, failures, unmount: rendered.unmount };
}

beforeEach(() => {
  stubs = installDomStubs();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  stubs.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("#123 0-5 AC-1/AC-2 共通再認証", () => {
  it.each([
    ["空の応答", {}],
    ["null時刻", { reauthenticatedAt: null }],
    ["数値時刻", { reauthenticatedAt: 123 }],
    ["不正な日時", { reauthenticatedAt: "invalid" }],
  ])(
    "#123 0-5 AC-1/2: 200でも%sを拒否し、cacheも操作も変えない（レビュー回帰）",
    async (_name, body) => {
      server.use(
        http.post("/api/auth/reauthenticate", () => HttpResponse.json(body)),
      );
      const { user, run, client, failures } = renderReauth();
      const before = client.getQueryData(authKeys.session);
      await user.click(screen.getByRole("button", { name: "操作A" }));
      await user.type(
        await screen.findByLabelText("パスワード"),
        TEST_PASSWORD,
      );
      await user.click(screen.getByRole("button", { name: "再認証" }));
      await waitFor(() =>
        expect(
          failures.length > 0 || screen.queryByRole("alert") !== null,
        ).toBe(true),
      );
      expect(run).not.toHaveBeenCalled();
      expect(client.getQueryData(authKeys.session)).toEqual(before);
    },
  );
  it("#123 0-5 AC-1: 未確認なら操作名を表示し、成功後に操作を一度だけ実行する", async () => {
    const sent: unknown[] = [];
    server.use(
      http.post("/api/auth/reauthenticate", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({ reauthenticatedAt: NOW.toISOString() });
      }),
    );
    const { user, run } = renderReauth();
    await user.click(screen.getByRole("button", { name: "操作A" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("重要な操作A");
    const input = screen.getByLabelText("パスワード") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input.autocomplete).toBe("current-password");
    expect(run).not.toHaveBeenCalled();
    await user.type(input, TEST_PASSWORD);
    await user.click(screen.getByRole("button", { name: "再認証" }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(sent).toEqual([{ password: TEST_PASSWORD }]);
  });

  it("#123 0-5 AC-1: パスワード欄は表示・非表示を切り替えられる", async () => {
    const { user } = renderReauth();
    await user.click(screen.getByRole("button", { name: "操作A" }));
    const input = (await screen.findByLabelText(
      "パスワード",
    )) as HTMLInputElement;
    const dialog = screen.getByRole("dialog");
    await user.click(
      dialog.querySelector<HTMLButtonElement>(
        "button[aria-label='パスワードを表示']",
      )!,
    );
    expect(input.type).toBe("text");
    await user.click(
      dialog.querySelector<HTMLButtonElement>(
        "button[aria-label='パスワードを隠す']",
      )!,
    );
    expect(input.type).toBe("password");
  });

  it("#123 0-5 AC-1: 誤ったパスワード403では操作せず、入力エラーを示す", async () => {
    server.use(
      http.post("/api/auth/reauthenticate", () =>
        HttpResponse.json(
          { code: "REAUTH_FAILED", message: "再認証に失敗しました" },
          { status: 403 },
        ),
      ),
    );
    const { user, run } = renderReauth();
    await user.click(screen.getByRole("button", { name: "操作A" }));
    await user.type(
      await screen.findByLabelText("パスワード"),
      "WrongPass456!",
    );
    await user.click(screen.getByRole("button", { name: "再認証" }));
    await waitFor(() =>
      expect(
        screen.getByLabelText("パスワード").getAttribute("aria-invalid"),
      ).toBe("true"),
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("#123 0-5 AC-1: キャンセルとEscでは操作せず、起動ボタンへフォーカスを戻す", async () => {
    const { user, run, failures } = renderReauth();
    const trigger = screen.getByRole("button", { name: "操作A" });
    await user.click(trigger);
    await screen.findByRole("dialog");
    expect(document.activeElement).toBe(screen.getByLabelText("パスワード"));
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(failures).toHaveLength(1));
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);
    const reopenedDialog = (await screen.findByRole(
      "dialog",
    )) as HTMLDialogElement;
    pressEscapeOn(reopenedDialog);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(failures).toHaveLength(2));
    expect(document.activeElement).toBe(trigger);
    expect(run).not.toHaveBeenCalled();
  });

  it("#123 0-5 AC-2: 5分未満なら種類の異なる操作も入力せず実行する", async () => {
    const at = new Date(NOW.getTime() - 5 * 60_000 + 1).toISOString();
    const { user, run } = renderReauth({ reauthenticatedAt: at });
    await user.click(screen.getByRole("button", { name: "操作A" }));
    await user.click(screen.getByRole("button", { name: "操作B" }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("#123 0-5 AC-2: ちょうど5分で再入力を求め、操作を止める", async () => {
    const at = new Date(NOW.getTime() - 5 * 60_000).toISOString();
    const { user, run } = renderReauth({ reauthenticatedAt: at });
    await user.click(screen.getByRole("button", { name: "操作A" }));
    expect(await screen.findByRole("dialog")).toBeDefined();
    expect(run).not.toHaveBeenCalled();
  });

  it("#123 0-5 AC-1: 再認証中の二つ目の呼出は即失敗し、一つ目だけを保持する", async () => {
    const { user, run, failures } = renderReauth();
    await user.click(screen.getByRole("button", { name: "操作A" }));
    expect(await screen.findByRole("dialog")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "操作B" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await waitFor(() => expect(failures).toHaveLength(1));
    expect(run).not.toHaveBeenCalled();
  });

  it("#123 0-5 AC-1: 認証応答の到着前に画面移動すると遅れた成功でも操作しない", async () => {
    const response = deferred<Response>();
    server.use(http.post("/api/auth/reauthenticate", () => response.promise));
    const { user, run } = renderReauth();
    await user.click(screen.getByRole("button", { name: "操作A" }));
    await user.type(await screen.findByLabelText("パスワード"), TEST_PASSWORD);
    await user.click(screen.getByRole("button", { name: "再認証" }));
    await user.click(screen.getByRole("button", { name: "画面移動" }));
    expect(await screen.findByText("移動先")).toBeDefined();
    await act(async () =>
      response.resolve(
        HttpResponse.json({ reauthenticatedAt: NOW.toISOString() }),
      ),
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("#123 0-5 AC-1: キャンセル後に遅れた成功が届いても操作しない", async () => {
    const response = deferred<Response>();
    server.use(http.post("/api/auth/reauthenticate", () => response.promise));
    const { user, run, failures } = renderReauth();
    await user.click(screen.getByRole("button", { name: "操作A" }));
    await user.type(await screen.findByLabelText("パスワード"), TEST_PASSWORD);
    await user.click(screen.getByRole("button", { name: "再認証" }));
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    await waitFor(() => expect(failures).toHaveLength(1));
    await act(async () =>
      response.resolve(
        HttpResponse.json({ reauthenticatedAt: NOW.toISOString() }),
      ),
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("#123 0-5 AC-1: 認証切れ401では操作しない", async () => {
    server.use(
      http.post("/api/auth/reauthenticate", () =>
        HttpResponse.json(
          { code: "UNAUTHENTICATED", message: "ログインしてください" },
          { status: 401 },
        ),
      ),
    );
    const { user, run, failures } = renderReauth();
    await user.click(screen.getByRole("button", { name: "操作A" }));
    await user.type(await screen.findByLabelText("パスワード"), TEST_PASSWORD);
    await user.click(screen.getByRole("button", { name: "再認証" }));
    await waitFor(() => expect(failures).toHaveLength(1));
    expect(run).not.toHaveBeenCalled();
  });

  it("#123 0-5 AC-1: Providerの破棄後に遅れた認証成功が届いても操作しない", async () => {
    const response = deferred<Response>();
    server.use(http.post("/api/auth/reauthenticate", () => response.promise));
    const { user, run, unmount } = renderReauth();
    await user.click(screen.getByRole("button", { name: "操作A" }));
    await user.type(await screen.findByLabelText("パスワード"), TEST_PASSWORD);
    await user.click(screen.getByRole("button", { name: "再認証" }));
    unmount();
    await act(async () =>
      response.resolve(
        HttpResponse.json({ reauthenticatedAt: NOW.toISOString() }),
      ),
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("#123 0-5 AC-1: 業務操作自身の失敗を呼出元へ返す", async () => {
    const failure = new Error("業務操作に失敗");
    const run = vi.fn(async (): Promise<string> => {
      throw failure;
    });
    const { user, failures } = renderReauth({
      reauthenticatedAt: NOW.toISOString(),
      run,
    });
    await user.click(screen.getByRole("button", { name: "操作A" }));
    await waitFor(() => expect(failures).toEqual([failure]));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
