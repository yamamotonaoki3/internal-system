// #120 AC-1（0-2 AC-1・AC-7）：S-02 ログイン画面。画面の振り分け（App）を通して確かめる。
// 公開形の仮定：/login が LoginPage。入力欄のラベルは「ユーザーID」「パスワード」、送信ボタンは「ログイン」。
// POST /api/auth/login の本文は { loginId, password }、成功は 200 { user: { id, displayName }, mustChangePassword }。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import {
  respondLoggedIn,
  respondLoggedOut,
  respondPublicStatus,
  TEST_LOGIN_ID,
  TEST_PASSWORD,
  TEST_USER,
} from "../test/auth-handlers";
import { server } from "../test/server";

function CurrentPath() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <CurrentPath />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

const pathname = () => screen.getByTestId("path").textContent;

/** POST /api/auth/login の応答を決め、受け取った本文を記録する */
function respondLogin(respond: () => Response | Promise<Response>): {
  bodies: unknown[];
} {
  const record = { bodies: [] as unknown[] };
  server.use(
    http.post("/api/auth/login", async ({ request }) => {
      record.bodies.push(await request.json());
      return respond();
    }),
  );
  return record;
}

async function fillAndSubmit(
  loginId = TEST_LOGIN_ID,
  password = TEST_PASSWORD,
) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("ユーザーID"), loginId);
  await user.type(screen.getByLabelText("パスワード"), password);
  await user.click(screen.getByRole("button", { name: "ログイン" }));
  return user;
}

beforeEach(() => {
  respondPublicStatus();
  respondLoggedOut();
});

describe("#120 AC-1 S-02 ログイン画面の表示", () => {
  it("#120 AC-1: ユーザーIDとパスワードの欄に label があり、パスワードは伏せ字で current-password", async () => {
    renderAt("/login");
    const loginId = await screen.findByLabelText("ユーザーID");
    expect((loginId as HTMLInputElement).type).toBe("text");
    const password = screen.getByLabelText("パスワード") as HTMLInputElement;
    expect(password.type).toBe("password");
    expect(password.getAttribute("autocomplete")).toBe("current-password");
  });

  it("#120 AC-1: パスワードの表示切替（「パスワードを表示」「パスワードを隠す」・aria-pressed）", async () => {
    const user = userEvent.setup();
    renderAt("/login");
    const password = (await screen.findByLabelText(
      "パスワード",
    )) as HTMLInputElement;
    const show = screen.getByRole("button", { name: "パスワードを表示" });
    expect(show.getAttribute("aria-pressed")).toBe("false");
    await user.click(show);
    expect(password.type).toBe("text");
    const hide = screen.getByRole("button", { name: "パスワードを隠す" });
    expect(hide.getAttribute("aria-pressed")).toBe("true");
    await user.click(hide);
    expect(password.type).toBe("password");
  });

  it("#120 AC-1: 未ログインでもログイン画面にサーバーの状態と「初回セットアップへ」が見える", async () => {
    respondPublicStatus(true);
    renderAt("/login");
    expect(await screen.findByText(/サーバーの状態：ok/)).toBeDefined();
    const link = await screen.findByRole("link", {
      name: "初回セットアップへ",
    });
    expect(link.getAttribute("href")).toBe("/setup");
  });

  it("#120 AC-1: ログイン済みで /login を開くと / へ移る", async () => {
    respondLoggedIn();
    renderAt("/login");
    await waitFor(() => expect(pathname()).toBe("/"));
    expect(
      await screen.findByText(`ようこそ、${TEST_USER.displayName}さん`),
    ).toBeDefined();
  });
});

describe("#120 AC-1 S-02 ログインの送信", () => {
  it("#120 AC-1: 正しい入力で送信すると、本文 { loginId, password } を送り、/ で「ようこそ、{表示名}さん」を出す", async () => {
    let loggedIn = false;
    server.use(
      http.get("/api/auth/session", () =>
        loggedIn
          ? HttpResponse.json({ user: TEST_USER, mustChangePassword: false })
          : HttpResponse.json(
              { code: "UNAUTHENTICATED", message: "x" },
              { status: 401 },
            ),
      ),
    );
    const record = respondLogin(() => {
      loggedIn = true;
      return HttpResponse.json({ user: TEST_USER, mustChangePassword: false });
    });
    renderAt("/login");
    await fillAndSubmit();
    await waitFor(() => expect(pathname()).toBe("/"));
    expect(
      await screen.findByText(`ようこそ、${TEST_USER.displayName}さん`),
    ).toBeDefined();
    expect(record.bodies).toEqual([
      { loginId: TEST_LOGIN_ID, password: TEST_PASSWORD },
    ]);
  });

  it("#120 AC-1: パスワード欄で Enter を押すと送信する", async () => {
    const record = respondLogin(() =>
      HttpResponse.json({ user: TEST_USER, mustChangePassword: false }),
    );
    const user = userEvent.setup();
    renderAt("/login");
    await user.type(await screen.findByLabelText("ユーザーID"), TEST_LOGIN_ID);
    await user.type(screen.getByLabelText("パスワード"), TEST_PASSWORD);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(record.bodies).toHaveLength(1));
  });

  it("#120 AC-1: 送信中はボタンが「ログイン中」で無効になり、二重に送らない", async () => {
    const record = respondLogin(async () => {
      await delay("infinite");
      return HttpResponse.json({});
    });
    renderAt("/login");
    const user = await fillAndSubmit();
    const busy = await screen.findByRole("button", { name: "ログイン中" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    await user.click(busy);
    expect(record.bodies).toHaveLength(1);
  });

  it("#120 AC-1: 空のまま送信すると API を呼ばず、欄を不正として示す", async () => {
    const record = respondLogin(() => HttpResponse.json({}));
    const user = userEvent.setup();
    renderAt("/login");
    await user.click(await screen.findByRole("button", { name: "ログイン" }));
    await waitFor(() =>
      expect(
        screen.getByLabelText("ユーザーID").getAttribute("aria-invalid"),
      ).toBe("true"),
    );
    expect(
      screen.getByLabelText("パスワード").getAttribute("aria-invalid"),
    ).toBe("true");
    expect(record.bodies).toHaveLength(0);
  });
});

describe("#120 AC-1 S-02 失敗の表示（0-2 AC-7：どちらが違うかを示さない）", () => {
  it("#120 AC-1: 401 INVALID_CREDENTIALS は「ユーザーIDまたはパスワードが違います」で、/login に留まる", async () => {
    respondLogin(() =>
      HttpResponse.json(
        { code: "INVALID_CREDENTIALS", message: "サーバーの文言" },
        { status: 401 },
      ),
    );
    renderAt("/login");
    await fillAndSubmit(TEST_LOGIN_ID, "WrongPass999!");
    expect(
      await screen.findByText("ユーザーIDまたはパスワードが違います"),
    ).toBeDefined();
    expect(pathname()).toBe("/login");
    // 入力したユーザーIDは残し、パスワードは画面の文言に出さない
    expect(screen.queryByText(/WrongPass999!/)).toBeNull();
  });

  it("#120 AC-1: 429 は「しばらくしてからお試しください」（残り回数・どの制限かを示さない）", async () => {
    respondLogin(() =>
      HttpResponse.json(
        { code: "RATE_LIMITED", message: "サーバーの文言" },
        { status: 429, headers: { "Retry-After": "900" } },
      ),
    );
    renderAt("/login");
    await fillAndSubmit();
    expect(
      await screen.findByText("しばらくしてからお試しください"),
    ).toBeDefined();
    expect(screen.queryByText(/900|回/)).toBeNull();
    expect(pathname()).toBe("/login");
  });

  it("#120 AC-1: 通信エラーは「接続できませんでした。もう一度お試しください」", async () => {
    respondLogin(() => HttpResponse.error());
    renderAt("/login");
    await fillAndSubmit();
    expect(
      await screen.findByText("接続できませんでした。もう一度お試しください"),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "ログイン" })).toBeDefined();
  });

  it("#120 AC-1: 422 の fields に挙がった欄を不正として示す", async () => {
    respondLogin(() =>
      HttpResponse.json(
        {
          code: "VALIDATION_ERROR",
          message: "入力内容を確認してください",
          fields: ["loginId"],
        },
        { status: 422 },
      ),
    );
    renderAt("/login");
    await fillAndSubmit();
    await waitFor(() =>
      expect(
        screen.getByLabelText("ユーザーID").getAttribute("aria-invalid"),
      ).toBe("true"),
    );
    expect(pathname()).toBe("/login");
  });
});

describe("#120 AC-1 初回パスワードの利用者（0-3 AC-5 の印）", () => {
  it("#120 AC-1: mustChangePassword=true でログインすると、準備中の案内とログアウトを出し、業務の画面は出さない", async () => {
    let loggedIn = false;
    server.use(
      http.get("/api/auth/session", () =>
        loggedIn
          ? HttpResponse.json({ user: TEST_USER, mustChangePassword: true })
          : HttpResponse.json(
              { code: "UNAUTHENTICATED", message: "x" },
              { status: 401 },
            ),
      ),
    );
    respondLogin(() => {
      loggedIn = true;
      return HttpResponse.json({ user: TEST_USER, mustChangePassword: true });
    });
    renderAt("/login");
    await fillAndSubmit();
    expect(
      await screen.findByText(
        "パスワードの変更が必要です。変更画面は準備中です",
      ),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeDefined();
    expect(screen.queryByText(/ようこそ、/)).toBeNull();
  });
});
