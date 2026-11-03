// #119 AC-4：画面S-34（初代全体管理者の初回セットアップ。TOTPの登録を除く）のコンポーネントテスト。
// API は MSW で返す。データはすべて架空（e2euser_001・example.com・[E2E_TEST]）。トークンもテスト専用の架空の値。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrowserRouter, Route, Routes } from "react-router";
import { server } from "../test/server";
import { SetupPage } from "./SetupPage";

// 架空のトークン（43文字の base64url 形式。本物の値ではない）
const TEST_TOKEN = "TESTONLY_setup_token_aaaaaaaaaaaaaaaaaaaaaa";
// 応答で返す架空の初期パスワード（画面にだけ出て、どこにも残ってはいけない値）
const TEST_INITIAL_PASSWORD = "Tq7#xZ9!mK2$pW4v";

const VALID = {
  companyName: "[E2E_TEST]テスト株式会社",
  departmentName: "[E2E_TEST]テスト部",
  loginId: "e2euser_001",
  legalName: "テスト太郎",
  email: "e2euser_001@example.com",
};

type Counter = { status: number; post: number; lastBody: unknown };

function registerStatusHandler(counter: Counter, setupRequired: () => boolean) {
  server.use(
    http.get("/api/setup/status", () => {
      counter.status += 1;
      return HttpResponse.json(
        { setupRequired: setupRequired() },
        { headers: { "Cache-Control": "no-store" } },
      );
    }),
  );
}

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(client = createClient()) {
  const view = render(
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <Routes>
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/login" element={<p>ログイン画面（テスト用）</p>} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>,
  );
  return { client, ...view };
}

// aria-describedby で結びつけた説明・エラーの文章を集める（入力欄とエラーの結びつきの確認）
function describedText(element: HTMLElement): string {
  const ids = (element.getAttribute("aria-describedby") ?? "").split(/\s+/);
  return ids
    .filter((id) => id !== "")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

// user-event は `[` と `{` をキーの記述の始まりとして扱うため、文字として入力するときは2つ重ねる
function escapeKeys(text: string): string {
  return text.replace(/[[{]/g, (c) => c + c);
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    await screen.findByLabelText(/セットアップ用のトークン/),
    TEST_TOKEN,
  );
  await user.type(
    screen.getByLabelText(/会社名/),
    escapeKeys(VALID.companyName),
  );
  await user.type(
    screen.getByLabelText(/部署名/),
    escapeKeys(VALID.departmentName),
  );
  await user.type(screen.getByLabelText(/社員ID/), VALID.loginId);
  await user.type(screen.getByLabelText(/本名/), VALID.legalName);
  await user.type(screen.getByLabelText(/メールアドレス$/), VALID.email);
  await user.click(
    screen.getByRole("checkbox", {
      name: /会社が発行した自分のメールアドレスだと確認しました/,
    }),
  );
}

function submitButton() {
  return screen.getByRole("button", { name: "登録する" });
}

function cacheDump(client: QueryClient): string {
  const queries = client
    .getQueryCache()
    .getAll()
    .map((query) => ({ key: query.queryKey, state: query.state }));
  const mutations = client
    .getMutationCache()
    .getAll()
    .map((mutation) => ({
      key: mutation.options.mutationKey,
      state: mutation.state,
    }));
  return JSON.stringify({ queries, mutations });
}

function storageDump(): string {
  const all: string[] = [];
  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i) ?? "";
      all.push(key, storage.getItem(key) ?? "");
    }
  }
  return all.join("\n");
}

beforeEach(() => {
  window.history.replaceState(null, "", "/setup");
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("#119 AC-4 S-34 初回セットアップ：状態の表示", () => {
  it("#119 AC-4: 状態の取得中は「読み込み中」を示し、フォームを出さない", async () => {
    server.use(
      http.get("/api/setup/status", async () => {
        await delay("infinite");
        return HttpResponse.json({ setupRequired: true });
      }),
    );
    renderPage();
    expect((await screen.findByRole("status")).textContent).toMatch(
      /読み込み中/,
    );
    expect(screen.queryByRole("button", { name: "登録する" })).toBeNull();
  });

  it("#119 AC-4: 状態の取得に失敗したら、エラーと再試行を示し、再試行で取り直してフォームを出す", async () => {
    let calls = 0;
    server.use(
      http.get("/api/setup/status", () => {
        calls += 1;
        if (calls === 1)
          return HttpResponse.json(
            { code: "INTERNAL", message: "エラーが発生しました" },
            { status: 500 },
          );
        return HttpResponse.json({ setupRequired: true });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole("alert")).toBeTruthy();
    // 失敗を「完了済み」や「未設定」として見せない
    expect(screen.queryByRole("button", { name: "登録する" })).toBeNull();
    expect(screen.queryByText(/完了しています/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "再試行" }));
    expect(
      await screen.findByRole("button", { name: "登録する" }),
    ).toBeTruthy();
    expect(calls).toBe(2);
  });

  it("#119 AC-4: 初代管理者が登録済み（setupRequired=false）なら「完了済み」を示し、フォームを出さず、ログイン画面へ案内する", async () => {
    const counter: Counter = { status: 0, post: 0, lastBody: null };
    registerStatusHandler(counter, () => false);
    renderPage();
    expect(await screen.findByText(/完了しています/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "登録する" })).toBeNull();
    expect(screen.queryByLabelText(/セットアップ用のトークン/)).toBeNull();
    const link = screen.getByRole("link", { name: /ログイン画面/ });
    expect(link.getAttribute("href")).toBe("/login");
  });

  it("#119 AC-4: 未設定（setupRequired=true）なら、番号付きの手順とフォームを出す", async () => {
    const counter: Counter = { status: 0, post: 0, lastBody: null };
    registerStatusHandler(counter, () => true);
    renderPage();
    expect(
      await screen.findByRole("heading", { name: /初回セットアップ/ }),
    ).toBeTruthy();
    expect(screen.getByRole("list")).toBeTruthy();
    for (const label of [
      /セットアップ用のトークン/,
      /会社名/,
      /部署名/,
      /社員ID/,
      /本名/,
      /メールアドレス$/,
    ])
      expect(screen.getByLabelText(label)).toBeTruthy();
    expect(submitButton()).toBeTruthy();
    // 代表取締役社長の確認はトークンの所持で代える（D-10）ことを画面に明記する
    expect(screen.getByText(/代表取締役社長/)).toBeTruthy();
    // 初期パスワードは登録の成功後に一度だけ表示すると、事前に案内する
    expect(screen.getByText(/一度だけ表示/)).toBeTruthy();
  });

  it("#119 AC-4: 本名の欄に「1〜30文字。表示名にも使う」案内を結びつけ、表示名の入力欄は置かない（D-7）", async () => {
    const counter: Counter = { status: 0, post: 0, lastBody: null };
    registerStatusHandler(counter, () => true);
    renderPage();
    const legal = await screen.findByLabelText(/本名/);
    expect(describedText(legal)).toMatch(/1〜30文字/);
    expect(describedText(legal)).toMatch(/表示名にも使います/);
    expect(screen.queryByLabelText(/表示名/)).toBeNull();
  });
});

describe("#119 AC-4 S-34 初回セットアップ：入力と送信", () => {
  it("#119 AC-4: トークン欄は初めは伏せて表示し、切替ボタンで表示・非表示を切り替えられる", async () => {
    const counter: Counter = { status: 0, post: 0, lastBody: null };
    registerStatusHandler(counter, () => true);
    const user = userEvent.setup();
    renderPage();
    const token = (await screen.findByLabelText(
      /セットアップ用のトークン/,
    )) as HTMLInputElement;
    expect(token.type).toBe("password");
    const toggle = screen.getByRole("button", { name: /トークンを表示/ });
    await user.click(toggle);
    expect(token.type).toBe("text");
    await user.click(screen.getByRole("button", { name: /トークンを隠す/ }));
    expect(token.type).toBe("password");
  });

  it("#119 AC-4: メール確認のチェックが無いと送信せず、チェック欄にエラーを結びつける", async () => {
    const counter: Counter = { status: 0, post: 0, lastBody: null };
    registerStatusHandler(counter, () => true);
    server.use(
      http.post("/api/setup", () => {
        counter.post += 1;
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    const check = screen.getByRole("checkbox", {
      name: /会社が発行した自分のメールアドレスだと確認しました/,
    });
    await user.click(check); // チェックを外す
    await user.click(submitButton());
    await waitFor(() =>
      expect(check.getAttribute("aria-invalid")).toBe("true"),
    );
    expect(describedText(check)).not.toBe("");
    expect(counter.post).toBe(0);
  });

  it("#119 AC-4: 本名が31文字なら送信せず、本名の欄にエラーを出す（30文字は境界の内側）", async () => {
    const counter: Counter = { status: 0, post: 0, lastBody: null };
    registerStatusHandler(counter, () => true);
    server.use(
      http.post("/api/setup", () => {
        counter.post += 1;
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    const legal = screen.getByLabelText(/本名/);
    await user.clear(legal);
    await user.type(legal, "あ".repeat(31));
    await user.click(submitButton());
    await waitFor(() =>
      expect(legal.getAttribute("aria-invalid")).toBe("true"),
    );
    expect(counter.post).toBe(0);
  });

  it("#119 AC-4: 送信中は「登録する」を押せず、多重送信しない", async () => {
    const counter: Counter = { status: 0, post: 0, lastBody: null };
    registerStatusHandler(counter, () => true);
    server.use(
      http.post("/api/setup", async () => {
        counter.post += 1;
        await delay("infinite");
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(submitButton());
    await waitFor(() =>
      expect((submitButton() as HTMLButtonElement).disabled).toBe(true),
    );
    await user.click(submitButton());
    expect(counter.post).toBe(1);
  });

  it("#119 AC-4: 送信する本文に、入力した値・emailConfirmed:true・トークンを含める", async () => {
    let setupRequired = true;
    const counter: Counter = { status: 0, post: 0, lastBody: null };
    registerStatusHandler(counter, () => setupRequired);
    server.use(
      http.post("/api/setup", async ({ request }) => {
        counter.post += 1;
        counter.lastBody = await request.json();
        setupRequired = false;
        return HttpResponse.json(
          {
            user: {
              id: "01JTESTULID0000000000000000",
              loginId: VALID.loginId,
              displayName: VALID.legalName,
            },
            initialPassword: TEST_INITIAL_PASSWORD,
          },
          { status: 201, headers: { "Cache-Control": "no-store" } },
        );
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(submitButton());
    await screen.findByText(TEST_INITIAL_PASSWORD);
    expect(counter.lastBody).toMatchObject({
      setupToken: TEST_TOKEN,
      ...VALID,
      emailConfirmed: true,
    });
    // 表示名はサーバーが本名から決めるため、送らない（D-7）
    expect(counter.lastBody).not.toHaveProperty("displayName");
  });

  it("#119 AC-4: 422 VALIDATION_ERROR の fields を、該当する各欄のエラーとして出す", async () => {
    const counter: Counter = { status: 0, post: 0, lastBody: null };
    registerStatusHandler(counter, () => true);
    server.use(
      http.post("/api/setup", () =>
        HttpResponse.json(
          {
            code: "VALIDATION_ERROR",
            message: "入力内容を確かめてください",
            fields: ["companyName", "loginId", "email"],
          },
          { status: 422 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(submitButton());
    for (const label of [/会社名/, /社員ID/, /メールアドレス$/]) {
      const field = screen.getByLabelText(label);
      await waitFor(() =>
        expect(field.getAttribute("aria-invalid")).toBe("true"),
      );
      expect(describedText(field)).toMatch(/入力内容を確かめてください/);
    }
    // 指摘されていない欄にはエラーを付けない
    expect(
      screen.getByLabelText(/部署名/).getAttribute("aria-invalid"),
    ).not.toBe("true");
  });

  it("#119 AC-4: 403（初回専用認証の誤り）はトークン欄のエラーとして出し、ほかの入力は残す", async () => {
    const counter: Counter = { status: 0, post: 0, lastBody: null };
    registerStatusHandler(counter, () => true);
    server.use(
      http.post("/api/setup", () =>
        HttpResponse.json(
          { code: "FORBIDDEN", message: "権限がありません" },
          { status: 403 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(submitButton());
    const token = screen.getByLabelText(/セットアップ用のトークン/);
    await waitFor(() =>
      expect(token.getAttribute("aria-invalid")).toBe("true"),
    );
    expect(describedText(token)).toMatch(/トークン/);
    expect((screen.getByLabelText(/会社名/) as HTMLInputElement).value).toBe(
      VALID.companyName,
    );
  });

  it("#119 AC-4: 409（既に登録済み）なら状態を取り直し、「完了済み」を示してフォームを消す", async () => {
    let setupRequired = true;
    const counter: Counter = { status: 0, post: 0, lastBody: null };
    registerStatusHandler(counter, () => setupRequired);
    server.use(
      http.post("/api/setup", () => {
        setupRequired = false; // 別の人が先に登録した
        return HttpResponse.json(
          { code: "CONFLICT", message: "既に登録されています" },
          { status: 409 },
        );
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    const before = counter.status;
    await user.click(submitButton());
    expect(await screen.findByText(/完了しています/)).toBeTruthy();
    expect(counter.status).toBeGreaterThan(before);
    expect(screen.queryByRole("button", { name: "登録する" })).toBeNull();
  });

  it.each([
    ["社員ID", "この社員IDは既に使われています"],
    ["メールアドレス", "このメールアドレスは既に使われています"],
    ["部署名", "この部署名は既に使われています"],
  ])(
    "#119 AC-4: 409 でも取り直し後に未設定のまま（%sの重複）なら、フォームと入力値を残し、メッセージと再送信の案内を出す",
    async (_kind, message) => {
      const counter: Counter = { status: 0, post: 0, lastBody: null };
      registerStatusHandler(counter, () => true);
      server.use(
        http.post("/api/setup", () => {
          counter.post += 1;
          return HttpResponse.json(
            { code: "CONFLICT", message, details: {} },
            { status: 409 },
          );
        }),
      );
      const user = userEvent.setup();
      renderPage();
      await fillValidForm(user);
      const before = counter.status;
      await user.click(submitButton());
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain(message);
      expect(alert.textContent).toMatch(/別の値に直して再送信してください/);
      // 状態を取り直したうえで、未設定のままなので「完了済み」にしない
      await waitFor(() => expect(counter.status).toBeGreaterThan(before));
      expect(screen.queryByText(/完了しています/)).toBeNull();
      // 入力値が残る
      expect((screen.getByLabelText(/会社名/) as HTMLInputElement).value).toBe(
        VALID.companyName,
      );
      expect((screen.getByLabelText(/社員ID/) as HTMLInputElement).value).toBe(
        VALID.loginId,
      );
      expect(
        (screen.getByLabelText(/メールアドレス$/) as HTMLInputElement).value,
      ).toBe(VALID.email);
      // 再送信できる
      const button = submitButton() as HTMLButtonElement;
      await waitFor(() => expect(button.disabled).toBe(false));
      await user.click(button);
      await waitFor(() => expect(counter.post).toBe(2));
    },
  );

  it("#119 AC-4: 403 FORBIDDEN_ORIGIN は alert に接続元の案内を出し、トークン欄にエラーを付けない", async () => {
    const counter: Counter = { status: 0, post: 0, lastBody: null };
    registerStatusHandler(counter, () => true);
    server.use(
      http.post("/api/setup", () =>
        HttpResponse.json(
          { code: "FORBIDDEN_ORIGIN", message: "許可されていません" },
          { status: 403 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(submitButton());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/接続元が許可されていません/);
    expect(alert.textContent).toMatch(/接続先と許可設定/);
    const token = screen.getByLabelText(/セットアップ用のトークン/);
    expect(token.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("#119 AC-4: 403 FORBIDDEN（トークン誤り）はトークン欄のエラーにし、接続元の案内は出さない", async () => {
    const counter: Counter = { status: 0, post: 0, lastBody: null };
    registerStatusHandler(counter, () => true);
    server.use(
      http.post("/api/setup", () =>
        HttpResponse.json(
          { code: "FORBIDDEN", message: "権限がありません" },
          { status: 403 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(submitButton());
    const token = screen.getByLabelText(/セットアップ用のトークン/);
    await waitFor(() =>
      expect(token.getAttribute("aria-invalid")).toBe("true"),
    );
    expect(document.body.textContent).not.toMatch(/接続元が許可されていません/);
  });

  it("#119 AC-4: 503（初回セットアップが使えない設定）なら、運用者への案内を出す", async () => {
    const counter: Counter = { status: 0, post: 0, lastBody: null };
    registerStatusHandler(counter, () => true);
    server.use(
      http.post("/api/setup", () =>
        HttpResponse.json(
          { code: "SERVICE_UNAVAILABLE", message: "利用できません" },
          { status: 503 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(submitButton());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/初回セットアップを利用できません/);
    expect(screen.queryByText(TEST_INITIAL_PASSWORD)).toBeNull();
  });

  it("#119 AC-4: マウスを使わず、キーボードだけで入力・送信して初期パスワードの表示まで進める", async () => {
    let setupRequired = true;
    const counter: Counter = { status: 0, post: 0, lastBody: null };
    registerStatusHandler(counter, () => setupRequired);
    server.use(
      http.post("/api/setup", () => {
        setupRequired = false;
        return HttpResponse.json(
          {
            user: {
              id: "01JTESTULID0000000000000000",
              loginId: VALID.loginId,
              displayName: VALID.legalName,
            },
            initialPassword: TEST_INITIAL_PASSWORD,
          },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("button", { name: "登録する" });
    const values: [RegExp, string][] = [
      [/セットアップ用のトークン/, TEST_TOKEN],
      [/会社名/, VALID.companyName],
      [/部署名/, VALID.departmentName],
      [/社員ID/, VALID.loginId],
      [/本名/, VALID.legalName],
      [/メールアドレス$/, VALID.email],
    ];
    const filled = new Set<HTMLElement>();
    let checked = false;
    for (let i = 0; i < 40; i += 1) {
      await user.tab();
      const active = document.activeElement as HTMLElement | null;
      if (active === null) continue;
      if (active instanceof HTMLInputElement && active.type === "checkbox") {
        if (!checked) await user.keyboard(" ");
        checked = true;
        continue;
      }
      if (active instanceof HTMLInputElement && !filled.has(active)) {
        const label = active.labels?.[0]?.textContent ?? "";
        const entry = values.find(([re]) => re.test(label));
        if (entry !== undefined) {
          await user.keyboard(escapeKeys(entry[1]));
          filled.add(active);
        }
        continue;
      }
      if (
        active instanceof HTMLButtonElement &&
        active.textContent === "登録する"
      ) {
        await user.keyboard("{Enter}");
        break;
      }
    }
    expect(filled.size).toBe(values.length);
    expect(checked).toBe(true);
    expect(await screen.findByText(TEST_INITIAL_PASSWORD)).toBeTruthy();
  });
});

describe("#119 AC-4 S-34 初期パスワードの一度だけの表示と消去", () => {
  function registerSuccessHandlers() {
    let setupRequired = true;
    const counter: Counter = { status: 0, post: 0, lastBody: null };
    registerStatusHandler(counter, () => setupRequired);
    server.use(
      http.post("/api/setup", () => {
        counter.post += 1;
        setupRequired = false;
        return HttpResponse.json(
          {
            user: {
              id: "01JTESTULID0000000000000000",
              loginId: VALID.loginId,
              displayName: VALID.legalName,
            },
            initialPassword: TEST_INITIAL_PASSWORD,
          },
          { status: 201, headers: { "Cache-Control": "no-store" } },
        );
      }),
    );
    return counter;
  }

  it("#119 AC-4: 成功直後に社員IDと初期パスワードを文字で表示する（入力欄には入れない）", async () => {
    registerSuccessHandlers();
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(submitButton());
    const password = await screen.findByText(TEST_INITIAL_PASSWORD);
    expect(password.closest("input, textarea")).toBeNull();
    expect(screen.getByText(VALID.loginId)).toBeTruthy();
    // 入力欄の値として残していない
    for (const input of Array.from(document.querySelectorAll("input"))) {
      expect(input.value).not.toBe(TEST_INITIAL_PASSWORD);
      expect(input.value).not.toBe(TEST_TOKEN);
    }
    // 表示前に失った場合の再発行の案内
    expect(screen.getByText(/再発行/)).toBeTruthy();
  });

  it("#119 AC-4: 表示した直後と次のイベントループの後で、Query/MutationCache・storage・history.state に初期パスワードとトークンが無い", async () => {
    registerSuccessHandlers();
    const user = userEvent.setup();
    const { client } = renderPage();
    await fillValidForm(user);
    await user.click(submitButton());
    await screen.findByText(TEST_INITIAL_PASSWORD);

    const check = () => {
      const cache = cacheDump(client);
      expect(cache).not.toContain(TEST_INITIAL_PASSWORD);
      expect(cache).not.toContain(TEST_TOKEN);
      const storage = storageDump();
      expect(storage).not.toContain(TEST_INITIAL_PASSWORD);
      expect(storage).not.toContain(TEST_TOKEN);
      const historyState = JSON.stringify(window.history.state ?? null);
      expect(historyState).not.toContain(TEST_INITIAL_PASSWORD);
      expect(historyState).not.toContain(TEST_TOKEN);
      expect(window.location.href).not.toContain(TEST_INITIAL_PASSWORD);
      expect(window.location.href).not.toContain(TEST_TOKEN);
    };

    // 表示された直後
    check();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    // 次のイベントループの後
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    check();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    // 表示は残っている（消去のためにすぐ消してしまわない）
    expect(screen.getByText(TEST_INITIAL_PASSWORD)).toBeTruthy();
  });

  it("#119 AC-4: 「ログイン画面へ進む」で初期パスワードの表示が消え、ログイン画面へ移る（戻る履歴に残さない）", async () => {
    registerSuccessHandlers();
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(submitButton());
    await screen.findByText(TEST_INITIAL_PASSWORD);
    const lengthBefore = window.history.length;
    await user.click(
      screen.getByRole("button", { name: "ログイン画面へ進む" }),
    );
    expect(await screen.findByText("ログイン画面（テスト用）")).toBeTruthy();
    expect(window.location.pathname).toBe("/login");
    expect(screen.queryByText(TEST_INITIAL_PASSWORD)).toBeNull();
    // replace で移るため、履歴は増えない
    expect(window.history.length).toBe(lengthBefore);
    expect(JSON.stringify(window.history.state ?? null)).not.toContain(
      TEST_INITIAL_PASSWORD,
    );
  });

  it("#119 AC-4: 部品を外して付け直す（離脱・再訪）と、初期パスワードは表示されず「完了済み」になる", async () => {
    registerSuccessHandlers();
    const user = userEvent.setup();
    const client = createClient();
    const first = renderPage(client);
    await fillValidForm(user);
    await user.click(submitButton());
    await screen.findByText(TEST_INITIAL_PASSWORD);
    first.unmount();

    renderPage(client);
    expect(await screen.findByText(/完了しています/)).toBeTruthy();
    expect(screen.queryByText(TEST_INITIAL_PASSWORD)).toBeNull();
    expect(document.body.textContent).not.toContain(TEST_INITIAL_PASSWORD);
    expect(cacheDump(client)).not.toContain(TEST_INITIAL_PASSWORD);
  });

  it("#119 AC-4: 成功の表示の中に、トークンを出さない", async () => {
    registerSuccessHandlers();
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(submitButton());
    const password = await screen.findByText(TEST_INITIAL_PASSWORD);
    const region =
      password.closest("section, [role='region'], div") ?? document.body;
    expect(within(region as HTMLElement).queryByText(TEST_TOKEN)).toBeNull();
    expect(document.body.textContent).not.toContain(TEST_TOKEN);
  });
});
