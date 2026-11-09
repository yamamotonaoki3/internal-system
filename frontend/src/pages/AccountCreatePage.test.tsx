// #199 AC-1〜AC-4: 画面S-23（アカウント登録。個別のみ）のコンポーネントテスト。API は MSW で返す。
// データはすべて架空（testuser_001・example.com・テスト太郎）。初期パスワードもテスト専用の架空の値。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../test/server";
import { AccountCreatePage } from "./AccountCreatePage";

const BASE = "/api/admin/accounts";
// 画面にだけ出て、どこにも残ってはいけない値（架空）
const TEST_INITIAL_PASSWORD = "Tq7#xZ9!mK2$pW4v";
const DEPT_A = {
  id: "01JTESTDEPT000000000000001",
  name: "[E2E_TEST]テスト部A",
};
const DEPT_B = {
  id: "01JTESTDEPT000000000000002",
  name: "[E2E_TEST]テスト部B",
};
const VALID = {
  loginId: "testuser_001",
  legalName: "テスト太郎",
  email: "testuser_001@example.com",
};

type Counter = { post: number; lastBody: unknown };

function respondOptions() {
  server.use(
    http.get(`${BASE}/department-options`, () =>
      HttpResponse.json({ items: [DEPT_A, DEPT_B] }),
    ),
  );
}

function respondCreated(counter: Counter) {
  server.use(
    http.post(BASE, async ({ request }) => {
      counter.post += 1;
      counter.lastBody = await request.json();
      return HttpResponse.json(
        {
          id: "01JTESTACCT000000000000001",
          loginId: VALID.loginId,
          displayName: VALID.legalName,
          departmentId: DEPT_A.id,
          mustChangePassword: true,
          createdAt: "2026-11-09T00:00:00.000Z",
          initialPassword: TEST_INITIAL_PASSWORD,
        },
        { status: 201, headers: { "Cache-Control": "no-store" } },
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
      <MemoryRouter initialEntries={["/accounts/new"]}>
        <Routes>
          <Route path="/accounts/new" element={<AccountCreatePage />} />
          <Route path="/accounts" element={<p>一覧（テスト用）</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, ...view };
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
      variables: mutation.state.variables,
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

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/社員ID/), VALID.loginId);
  await user.type(screen.getByLabelText(/本名/), VALID.legalName);
  await user.type(screen.getByLabelText(/メールアドレス$/), VALID.email);
  await user.selectOptions(
    await screen.findByRole("combobox", { name: /所属部署/ }),
    DEPT_A.id,
  );
  await user.click(screen.getByRole("checkbox", { name: /会社が発行した/ }));
}

const submitButton = () => screen.getByRole("button", { name: "登録する" });

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  respondOptions();
});

describe("#199 アカウント登録（S-23）", () => {
  it("#199 AC-1・AC-4: 見出しと、有効な部署の単一選択を出す。CSVの切り替えは置かない", async () => {
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "アカウント登録" }),
    ).toBeTruthy();
    const select = (await screen.findByRole("combobox", {
      name: /所属部署/,
    })) as unknown as HTMLSelectElement;
    expect(select.multiple).toBe(false);
    await waitFor(() =>
      expect(screen.getByRole("option", { name: DEPT_B.name })).toBeTruthy(),
    );
    expect(screen.queryByText(/CSV/)).toBeNull();
  });

  it("#199 AC-2・AC-3: 正しい入力で送ると、決めた項目だけを送る（emailConfirmed は true、空の任意項目は送らない）", async () => {
    const counter: Counter = { post: 0, lastBody: null };
    respondCreated(counter);
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(submitButton());
    await waitFor(() => expect(counter.post).toBe(1));
    expect(counter.lastBody).toEqual({
      loginId: VALID.loginId,
      legalName: VALID.legalName,
      displayName: VALID.legalName,
      email: VALID.email,
      emailConfirmed: true,
      departmentId: DEPT_A.id,
    });
  });

  it("#199 AC-3（0-1 AC-3）: メールの確認のチェックがないと送らない", async () => {
    const counter: Counter = { post: 0, lastBody: null };
    respondCreated(counter);
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(screen.getByRole("checkbox", { name: /会社が発行した/ }));
    await user.click(submitButton());
    await new Promise((r) => setTimeout(r, 50));
    expect(counter.post).toBe(0);
  });

  it.each([
    ["社員ID 2文字", /社員ID/, "ab"],
    ["社員IDの記号", /社員ID/, "test@user"],
  ])("#199 AC-2: %sは画面でエラーにして送らない", async (_l, label, value) => {
    const counter: Counter = { post: 0, lastBody: null };
    respondCreated(counter);
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    const field = screen.getByLabelText(label);
    await user.clear(field);
    await user.type(field, value);
    await user.click(submitButton());
    await waitFor(() =>
      expect(field.getAttribute("aria-invalid")).toBe("true"),
    );
    expect(counter.post).toBe(0);
  });

  it("#199 AC-1: 部署を選ばないと送らない", async () => {
    const counter: Counter = { post: 0, lastBody: null };
    respondCreated(counter);
    const user = userEvent.setup();
    renderPage();
    await user.type(await screen.findByLabelText(/社員ID/), VALID.loginId);
    await user.type(screen.getByLabelText(/本名/), VALID.legalName);
    await user.type(screen.getByLabelText(/メールアドレス$/), VALID.email);
    await user.click(screen.getByRole("checkbox", { name: /会社が発行した/ }));
    await user.click(submitButton());
    const select = screen.getByRole("combobox", { name: /所属部署/ });
    await waitFor(() =>
      expect(select.getAttribute("aria-invalid")).toBe("true"),
    );
    expect(counter.post).toBe(0);
  });

  it("#199 AC-2（A-1）: 本名を入れると表示名に同じ値が入り、変えられる", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(await screen.findByLabelText(/本名/), VALID.legalName);
    const display = screen.getByLabelText(/表示名/) as HTMLInputElement;
    expect(display.value).toBe(VALID.legalName);
    await user.clear(display);
    await user.type(display, "テスト表示名");
    expect(display.value).toBe("テスト表示名");
  });

  it("#199 AC-2（A-1）: 本名が30文字なら表示名に同じ値が入り、31文字以上なら表示名の初期値を空にする", async () => {
    const user = userEvent.setup();
    renderPage();
    const legal = await screen.findByLabelText(/本名/);
    const display = screen.getByLabelText(/表示名/) as HTMLInputElement;
    await user.type(legal, "テ".repeat(30));
    expect(display.value).toBe("テ".repeat(30));
    await user.type(legal, "テ");
    expect(display.value).toBe("");
  });

  it("#199 AC-3: 成功すると、社員IDと初期パスワードを一度だけ表示し、フォームを消す", async () => {
    const counter: Counter = { post: 0, lastBody: null };
    respondCreated(counter);
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(submitButton());
    expect(
      await screen.findByRole("heading", { name: "登録が完了しました" }),
    ).toBeTruthy();
    expect(screen.getAllByText(TEST_INITIAL_PASSWORD)).toHaveLength(1);
    expect(screen.getByText(VALID.loginId)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "登録する" })).toBeNull();
    expect(screen.queryByLabelText(/本名/)).toBeNull();
    // 入力欄に入れない
    for (const input of document.querySelectorAll("input"))
      expect(input.value).not.toBe(TEST_INITIAL_PASSWORD);
  });

  it("#199 AC-4（0-1 AC-21）: 入力中も送信後も、localStorage・sessionStorage・URL に入力値と初期パスワードを置かない", async () => {
    const counter: Counter = { post: 0, lastBody: null };
    respondCreated(counter);
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    for (const value of Object.values(VALID))
      expect(storageDump()).not.toContain(value);
    await user.click(submitButton());
    await screen.findByRole("heading", { name: "登録が完了しました" });
    const dump = storageDump();
    for (const value of [...Object.values(VALID), TEST_INITIAL_PASSWORD])
      expect(dump).not.toContain(value);
    expect(window.location.href).not.toContain(VALID.loginId);
    expect(window.location.href).not.toContain(TEST_INITIAL_PASSWORD);
  });

  it("#199 AC-3・AC-4: 「一覧へ戻る」で S-22 へ移り、初期パスワードはキャッシュにも残らない", async () => {
    const counter: Counter = { post: 0, lastBody: null };
    respondCreated(counter);
    const user = userEvent.setup();
    const { client } = renderPage();
    await fillValidForm(user);
    await user.click(submitButton());
    await screen.findByRole("heading", { name: "登録が完了しました" });
    await user.click(screen.getByRole("button", { name: "一覧へ戻る" }));
    expect(await screen.findByText("一覧（テスト用）")).toBeTruthy();
    expect(screen.queryByText(TEST_INITIAL_PASSWORD)).toBeNull();
    await waitFor(() => {
      const dump = cacheDump(client);
      expect(dump).not.toContain(TEST_INITIAL_PASSWORD);
      expect(dump).not.toContain(VALID.email);
      expect(dump).not.toContain(VALID.legalName);
    });
  });

  it("#199 AC-3・AC-4: 表示中に画面を離れても（アンマウント）、初期パスワードはキャッシュに残らない", async () => {
    const counter: Counter = { post: 0, lastBody: null };
    respondCreated(counter);
    const user = userEvent.setup();
    const { client, unmount } = renderPage();
    await fillValidForm(user);
    await user.click(submitButton());
    await screen.findByRole("heading", { name: "登録が完了しました" });
    unmount();
    await waitFor(() =>
      expect(cacheDump(client)).not.toContain(TEST_INITIAL_PASSWORD),
    );
    expect(storageDump()).not.toContain(TEST_INITIAL_PASSWORD);
  });

  it("#199 AC-2: 409 のときは案内を出し、入力値を残して再送信できる", async () => {
    let posts = 0;
    server.use(
      http.post(BASE, () => {
        posts += 1;
        return HttpResponse.json(
          { code: "CONFLICT", message: "この社員IDは既に使われています" },
          { status: 409 },
        );
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(submitButton());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("この社員IDは既に使われています");
    expect((screen.getByLabelText(/社員ID/) as HTMLInputElement).value).toBe(
      VALID.loginId,
    );
    const button = submitButton() as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    await user.click(button);
    await waitFor(() => expect(posts).toBe(2));
  });

  it("#199 AC-2: 422 の fields は該当する欄のエラーにする", async () => {
    server.use(
      http.post(BASE, () =>
        HttpResponse.json(
          {
            code: "VALIDATION_ERROR",
            message: "入力内容を確かめてください",
            fields: ["departmentId"],
          },
          { status: 422 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(submitButton());
    const select = screen.getByRole("combobox", { name: /所属部署/ });
    await waitFor(() =>
      expect(select.getAttribute("aria-invalid")).toBe("true"),
    );
  });
});
