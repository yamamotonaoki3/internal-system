import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { server } from "../test/server";
import { ClientsPage } from "./ClientsPage";

type Client = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  version: number;
};
const internal: Client = {
  id: "client_int",
  code: "INT",
  name: "社内",
  active: true,
  version: 1,
};
const alpha: Client = {
  id: "client_alpha",
  code: "ABC",
  name: "testclient_alpha",
  active: true,
  version: 1,
};
const inactive: Client = {
  id: "client_old",
  code: "OLD",
  name: "testclient_old",
  active: false,
  version: 2,
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ClientsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function list(items: Client[], nextCursor: string | null = null) {
  server.use(
    http.get("/api/admin/clients", () =>
      HttpResponse.json({ items, nextCursor }),
    ),
  );
}

describe("#192 取引先管理画面（5-7）", () => {
  it("#192 AC-7（5-7 AC-11）: 読込中と空一覧を区別する", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get("/api/admin/clients", async () => {
        await gate;
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    renderPage();
    expect(screen.getByText(/読み込み中/)).toBeTruthy();
    release?.();
    expect(
      await screen.findByText(/取引先がありません|該当する取引先がありません/),
    ).toBeTruthy();
  });

  it("#192 AC-7（5-7 AC-11）: 一覧取得失敗は空一覧や成功として表示しない", async () => {
    server.use(
      http.get("/api/admin/clients", () =>
        HttpResponse.json(
          { code: "INTERNAL", message: "取得できません" },
          { status: 500 },
        ),
      ),
    );
    renderPage();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      screen.queryByText(/取引先がありません|該当する取引先がありません/),
    ).toBeNull();
  });

  it("#192 AC-4・AC-5（5-7 AC-10・AC-12・AC-13）: 無効行は文字で残り、INTに無効化・コード編集・再有効化操作はない", async () => {
    list([alpha, internal, inactive]);
    renderPage();
    const intRow = await screen.findByRole("row", { name: /INT/ });
    const oldRow = screen.getByRole("row", { name: /OLD/ });
    expect(within(oldRow).getByText("無効")).toBeTruthy();
    expect(
      within(intRow).queryByRole("button", { name: /無効にする/ }),
    ).toBeNull();
    expect(
      within(oldRow).queryByRole("button", { name: /有効に戻す/ }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /コードを変更/ })).toBeNull();
  });

  it("#192 AC-5（5-7 AC-11）: 初期状態はすべてでコード順、状態で絞り込める", async () => {
    let status: string | null = null;
    server.use(
      http.get("/api/admin/clients", ({ request }) => {
        status = new URL(request.url).searchParams.get("status");
        const items =
          status === "inactive" ? [inactive] : [alpha, internal, inactive];
        return HttpResponse.json({ items, nextCursor: null });
      }),
    );
    renderPage();
    expect(await screen.findByText("testclient_alpha")).toBeTruthy();
    expect(screen.getByText("社内")).toBeTruthy();
    expect(screen.getByText("testclient_old")).toBeTruthy();
    const rows = screen.getAllByRole("row").map((row) => row.textContent ?? "");
    expect(rows.findIndex((row) => row.includes("ABC"))).toBeLessThan(
      rows.findIndex((row) => row.includes("INT")),
    );
    fireEvent.change(screen.getByRole("combobox", { name: /状態/ }), {
      target: { value: "inactive" },
    });
    expect(await screen.findByText("testclient_old")).toBeTruthy();
    expect(status).toBe("inactive");
    expect(screen.queryByText("testclient_alpha")).toBeNull();
  });

  it("#192 AC-5（5-7 AC-11）: 名前とコードの部分一致検索は入力した語をAPIへ渡す", async () => {
    const queries: string[] = [];
    server.use(
      http.get("/api/admin/clients", ({ request }) => {
        const q = new URL(request.url).searchParams.get("q") ?? "";
        queries.push(q);
        const items =
          q.toLowerCase() === "lph"
            ? [alpha]
            : q.toLowerCase() === "bc"
              ? [alpha]
              : [alpha, internal];
        return HttpResponse.json({ items, nextCursor: null });
      }),
    );
    renderPage();
    await screen.findByText("社内");
    const search = screen.getByRole("searchbox", { name: /取引先|検索/ });
    fireEvent.change(search, { target: { value: "lPh" } });
    fireEvent.submit(search.closest("form")!);
    expect(await screen.findByText("testclient_alpha")).toBeTruthy();
    expect(queries).toContain("lPh");
    fireEvent.change(search, { target: { value: "bC" } });
    fireEvent.submit(search.closest("form")!);
    await waitFor(() => expect(queries).toContain("bC"));
  });

  it("#192 AC-2・AC-7（5-7 AC-2・AC-6）: 不正なコードと空の名前は登録せず入力エラーを示す", async () => {
    let posts = 0;
    list([internal]);
    server.use(
      http.post("/api/admin/clients", () => {
        posts += 1;
        return HttpResponse.json(alpha, { status: 201 });
      }),
    );
    renderPage();
    await screen.findByText("社内");
    fireEvent.click(screen.getByRole("button", { name: /取引先を登録/ }));
    fireEvent.change(screen.getByRole("textbox", { name: /取引先コード/ }), {
      target: { value: "ab1" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /取引先名/ }), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: /^登録$|^保存$/ }));
    expect(
      await screen.findByText(/英大文字3文字|取引先コード.*3文字/),
    ).toBeTruthy();
    expect(posts).toBe(0);
  });

  it("#192 AC-2・AC-7（5-7 AC-2・AC-6）: 登録成功後は再読込なしでコード順に一覧を更新する", async () => {
    let items = [internal];
    list(items);
    server.use(
      http.post("/api/admin/clients", async ({ request }) => {
        expect(await request.json()).toEqual({
          code: "ABC",
          name: "testclient_alpha",
        });
        items = [alpha, internal];
        return HttpResponse.json(alpha, { status: 201 });
      }),
    );
    server.use(
      http.get("/api/admin/clients", () =>
        HttpResponse.json({ items, nextCursor: null }),
      ),
    );
    renderPage();
    await screen.findByText("社内");
    fireEvent.click(screen.getByRole("button", { name: /取引先を登録/ }));
    fireEvent.change(screen.getByRole("textbox", { name: /取引先コード/ }), {
      target: { value: "ABC" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /取引先名/ }), {
      target: { value: "testclient_alpha" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^登録$|^保存$/ }));
    expect(await screen.findByText("testclient_alpha")).toBeTruthy();
  });
});

// 管理操作は、利用者が押した結果と再読込なしの表示を確認する。
describe("#192 管理操作（5-7）", () => {
  it("#192 AC-3・AC-7（5-7 AC-3・AC-8）: 有効取引先の名前変更はコードを保ち一覧へ即反映する", async () => {
    let current = alpha;
    server.use(
      http.get("/api/admin/clients", () =>
        HttpResponse.json({ items: [current, internal], nextCursor: null }),
      ),
      http.patch("/api/admin/clients/client_alpha", async ({ request }) => {
        expect(await request.json()).toEqual({
          name: "testclient_renamed",
          version: 1,
        });
        current = { ...current, name: "testclient_renamed", version: 2 };
        return HttpResponse.json(current);
      }),
    );
    renderPage();
    const row = await screen.findByRole("row", { name: /ABC/ });
    fireEvent.click(
      within(row).getByRole("button", { name: /名前を変更|編集/ }),
    );
    const name = screen.getByRole("textbox", { name: /取引先名/ });
    fireEvent.change(name, { target: { value: "testclient_renamed" } });
    fireEvent.click(screen.getByRole("button", { name: /^保存$|^変更$/ }));
    expect(
      await screen.findByRole("row", {
        name: /ABC.*testclient_renamed|testclient_renamed.*ABC/,
      }),
    ).toBeTruthy();
    expect(screen.queryByText("testclient_alpha")).toBeNull();
  });

  it("#192 AC-3・AC-7（5-7 AC-3）: 版競合で失敗した名前変更を成功表示にしない", async () => {
    server.use(
      http.get("/api/admin/clients", () =>
        HttpResponse.json({ items: [alpha], nextCursor: null }),
      ),
      http.patch("/api/admin/clients/client_alpha", () =>
        HttpResponse.json(
          { code: "CONFLICT", message: "更新されました" },
          { status: 409 },
        ),
      ),
    );
    renderPage();
    const row = await screen.findByRole("row", { name: /ABC/ });
    fireEvent.click(
      within(row).getByRole("button", { name: /名前を変更|編集/ }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: /取引先名/ }), {
      target: { value: "testclient_stale" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^保存$|^変更$/ }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("testclient_stale")).toBeNull();
    expect(screen.getByText("testclient_alpha")).toBeTruthy();
  });

  it("#192 AC-4・AC-7（5-7 AC-4・AC-10・AC-12）: 無効化後は再読込なしで文字状態が変わる", async () => {
    let current = alpha;
    server.use(
      http.get("/api/admin/clients", () =>
        HttpResponse.json({ items: [current, internal], nextCursor: null }),
      ),
      http.patch(
        "/api/admin/clients/client_alpha/status",
        async ({ request }) => {
          expect(await request.json()).toEqual({ active: false, version: 1 });
          current = { ...current, active: false, version: 2 };
          return HttpResponse.json(current);
        },
      ),
    );
    renderPage();
    const row = await screen.findByRole("row", { name: /ABC/ });
    fireEvent.click(within(row).getByRole("button", { name: /無効にする/ }));
    const confirm = screen.queryByRole("button", { name: /無効にする|確認/ });
    if (confirm) fireEvent.click(confirm);
    await waitFor(() => {
      expect(
        within(screen.getByRole("row", { name: /ABC/ })).getByText("無効"),
      ).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /有効に戻す/ })).toBeNull();
  });
});

describe("#192 AC-2・AC-7: 重複登録時の修正案内", () => {
  it("#192 AC-2・AC-7: 重複409では安全なサーバーメッセージを表示して入力を保持する", async () => {
    const message =
      "同じ取引先コードが登録されています。コードを変更してください";
    list([internal]);
    server.use(
      http.post("/api/admin/clients", () =>
        HttpResponse.json({ code: "CONFLICT", message }, { status: 409 }),
      ),
    );
    renderPage();
    await screen.findByText("社内");
    fireEvent.click(screen.getByRole("button", { name: /取引先を登録/ }));
    const code = screen.getByRole("textbox", { name: /取引先コード/ });
    const name = screen.getByRole("textbox", { name: /取引先名/ });
    fireEvent.change(code, { target: { value: "ABC" } });
    fireEvent.change(name, { target: { value: "testclient_duplicate" } });
    fireEvent.click(screen.getByRole("button", { name: /^登録$|^保存$/ }));
    expect((await screen.findByRole("alert")).textContent).toContain(message);
    expect((code as HTMLInputElement).value).toBe("ABC");
    expect((name as HTMLInputElement).value).toBe("testclient_duplicate");
    expect(screen.queryByText(/別の操作で更新されました/)).toBeNull();
  });
});

describe("#192 AC-7（5-7 AC-2・AC-6）: 失敗時の入力と一覧", () => {
  it("#192 AC-7（5-7 AC-2・AC-6）: APIの422 name項目エラーを名前欄に示し入力を保つ", async () => {
    list([internal]);
    server.use(
      http.post("/api/admin/clients", () =>
        HttpResponse.json(
          {
            code: "VALIDATION_ERROR",
            message: "取引先名を確認してください",
            fields: ["name"],
          },
          { status: 422 },
        ),
      ),
    );
    renderPage();
    await screen.findByText("社内");
    fireEvent.click(screen.getByRole("button", { name: "取引先を登録" }));
    const code = screen.getByRole("textbox", { name: "取引先コード" });
    const name = screen.getByRole("textbox", { name: "取引先名" });
    fireEvent.change(code, { target: { value: "XYZ" } });
    fireEvent.change(name, { target: { value: "testclient_name" } });
    fireEvent.click(screen.getByRole("button", { name: "登録" }));
    await waitFor(() => expect(name.getAttribute("aria-invalid")).toBe("true"));
    expect(code.getAttribute("aria-invalid")).not.toBe("true");
    expect((name as HTMLInputElement).value).toBe("testclient_name");
    expect((code as HTMLInputElement).value).toBe("XYZ");
    expect(screen.queryByText("testclient_name")).toBeNull();
  });

  it.each([
    [403, "FORBIDDEN"],
    [409, "CONFLICT"],
    [500, "INTERNAL"],
  ])(
    "#192 AC-7（5-7 AC-4）: 無効化の%d失敗は有効表示と版を保ち再試行できる",
    async (status, errorCode) => {
      const requests: unknown[] = [];
      server.use(
        http.get("/api/admin/clients", () =>
          HttpResponse.json({ items: [alpha], nextCursor: null }),
        ),
        http.patch(
          "/api/admin/clients/client_alpha/status",
          async ({ request }) => {
            requests.push(await request.json());
            return HttpResponse.json(
              { code: errorCode, message: "internal_details_must_not_appear" },
              { status },
            );
          },
        ),
      );
      renderPage();
      const row = await screen.findByRole("row", { name: /ABC/ });
      fireEvent.click(within(row).getByRole("button", { name: "無効にする" }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).not.toContain(
        "internal_details_must_not_appear",
      );
      expect(alert.textContent).toMatch(
        status === 403
          ? /権限/
          : status === 409
            ? /更新.*一覧/
            : /できません.*もう一度/,
      );
      expect(
        within(screen.getByRole("row", { name: /ABC/ })).getByText("有効"),
      ).toBeTruthy();
      expect(
        within(screen.getByRole("row", { name: /ABC/ })).getByRole("button", {
          name: "無効にする",
        }),
      ).toBeTruthy();
      fireEvent.click(
        within(screen.getByRole("row", { name: /ABC/ })).getByRole("button", {
          name: "無効にする",
        }),
      );
      await waitFor(() => expect(requests).toHaveLength(2));
      expect(requests).toEqual([
        { active: false, version: 1 },
        { active: false, version: 1 },
      ]);
    },
  );
});

describe("#192 AC-5・AC-7（5-7 AC-11）: 一覧のページ送り", () => {
  it("#192 AC-5・AC-7（5-7 AC-11）: 次ページはcursorで取得し前ページの行を残さない", async () => {
    const cursors: Array<string | null> = [];
    server.use(
      http.get("/api/admin/clients", ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        cursors.push(cursor);
        return HttpResponse.json(
          cursor === "cursor_next"
            ? { items: [inactive], nextCursor: null }
            : { items: [alpha, internal], nextCursor: "cursor_next" },
        );
      }),
    );
    renderPage();
    await screen.findByText("testclient_alpha");
    fireEvent.click(screen.getByRole("button", { name: "次のページ" }));
    expect(await screen.findByText("testclient_old")).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByText("testclient_alpha")).toBeNull(),
    );
    expect(screen.queryByText("社内")).toBeNull();
    expect(cursors).toContain("cursor_next");
    expect(screen.queryByRole("button", { name: "次のページ" })).toBeNull();
  });

  it("#192 AC-5・AC-7（5-7 AC-11）: 検索を変えると先頭から取得し前のページの表示を消す", async () => {
    const requests: Array<{ q: string | null; cursor: string | null }> = [];
    server.use(
      http.get("/api/admin/clients", ({ request }) => {
        const params = new URL(request.url).searchParams;
        const q = params.get("q");
        const cursor = params.get("cursor");
        requests.push({ q, cursor });
        if (q === "int")
          return HttpResponse.json({ items: [internal], nextCursor: null });
        return HttpResponse.json(
          cursor === "cursor_next"
            ? { items: [inactive], nextCursor: null }
            : { items: [alpha], nextCursor: "cursor_next" },
        );
      }),
    );
    renderPage();
    await screen.findByText("testclient_alpha");
    fireEvent.click(screen.getByRole("button", { name: "次のページ" }));
    await screen.findByText("testclient_old");
    const search = screen.getByRole("searchbox", { name: "取引先を検索" });
    fireEvent.change(search, { target: { value: "int" } });
    fireEvent.submit(search.closest("form")!);
    expect(await screen.findByText("社内")).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByText("testclient_old")).toBeNull(),
    );
    expect(requests).toContainEqual({ q: "int", cursor: null });
  });

  it("#192 AC-5・AC-7（5-7 AC-11）: 状態を変えると先頭から取得し前のページの表示を消す", async () => {
    const requests: Array<{ status: string | null; cursor: string | null }> =
      [];
    server.use(
      http.get("/api/admin/clients", ({ request }) => {
        const params = new URL(request.url).searchParams;
        const status = params.get("status");
        const cursor = params.get("cursor");
        requests.push({ status, cursor });
        if (status === "active")
          return HttpResponse.json({ items: [alpha], nextCursor: null });
        return HttpResponse.json(
          cursor === "cursor_next"
            ? { items: [inactive], nextCursor: null }
            : { items: [alpha], nextCursor: "cursor_next" },
        );
      }),
    );
    renderPage();
    await screen.findByText("testclient_alpha");
    fireEvent.click(screen.getByRole("button", { name: "次のページ" }));
    await screen.findByText("testclient_old");
    fireEvent.change(screen.getByRole("combobox", { name: "状態" }), {
      target: { value: "active" },
    });
    expect(await screen.findByText("testclient_alpha")).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByText("testclient_old")).toBeNull(),
    );
    expect(requests).toContainEqual({ status: "active", cursor: null });
  });
});

describe("#192 AC-2・AC-3・AC-7（5-7 AC-2・AC-3・AC-6）: 保存失敗後のフォーム", () => {
  it("#192 AC-2・AC-7（5-7 AC-2）: APIの422 code項目エラーはコード欄だけに示す", async () => {
    list([internal]);
    server.use(
      http.post("/api/admin/clients", () =>
        HttpResponse.json(
          {
            code: "VALIDATION_ERROR",
            message: "コードを確認してください",
            fields: ["code"],
          },
          { status: 422 },
        ),
      ),
    );
    renderPage();
    await screen.findByText("社内");
    fireEvent.click(screen.getByRole("button", { name: "取引先を登録" }));
    const code = screen.getByRole("textbox", { name: "取引先コード" });
    const name = screen.getByRole("textbox", { name: "取引先名" });
    fireEvent.change(code, { target: { value: "XYZ" } });
    fireEvent.change(name, { target: { value: "testclient_valid" } });
    fireEvent.click(screen.getByRole("button", { name: "登録" }));
    await waitFor(() => expect(code.getAttribute("aria-invalid")).toBe("true"));
    expect(name.getAttribute("aria-invalid")).not.toBe("true");
    expect((code as HTMLInputElement).value).toBe("XYZ");
    expect((name as HTMLInputElement).value).toBe("testclient_valid");
    expect(screen.queryByText("testclient_valid")).toBeNull();
  });

  it("#192 AC-3・AC-7（5-7 AC-3）: 改名の422 name項目エラーでは対象と入力を保持する", async () => {
    list([alpha]);
    server.use(
      http.patch("/api/admin/clients/client_alpha", () =>
        HttpResponse.json(
          {
            code: "VALIDATION_ERROR",
            message: "名前を確認してください",
            fields: ["name"],
          },
          { status: 422 },
        ),
      ),
    );
    renderPage();
    const row = await screen.findByRole("row", { name: /ABC/ });
    fireEvent.click(within(row).getByRole("button", { name: "名前を変更" }));
    const name = screen.getByRole("textbox", { name: "取引先名" });
    fireEvent.change(name, { target: { value: "testclient_renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(name.getAttribute("aria-invalid")).toBe("true"));
    expect((name as HTMLInputElement).value).toBe("testclient_renamed");
    expect(
      screen.getByRole("heading", { name: "取引先名の変更" }),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("row", { name: /ABC/ })).getByText(
        "testclient_alpha",
      ),
    ).toBeTruthy();
  });

  it.each([
    [403, "FORBIDDEN"],
    [500, "INTERNAL"],
  ])(
    "#192 AC-7（5-7 AC-1）: 登録%d失敗では入力と編集画面を保持し安全な案内を示す",
    async (status, errorCode) => {
      list([internal]);
      server.use(
        http.post("/api/admin/clients", () =>
          HttpResponse.json(
            { code: errorCode, message: "internal_details_must_not_appear" },
            { status },
          ),
        ),
      );
      renderPage();
      await screen.findByText("社内");
      fireEvent.click(screen.getByRole("button", { name: "取引先を登録" }));
      const code = screen.getByRole("textbox", { name: "取引先コード" });
      const name = screen.getByRole("textbox", { name: "取引先名" });
      fireEvent.change(code, { target: { value: "XYZ" } });
      fireEvent.change(name, { target: { value: "testclient_retry" } });
      fireEvent.click(screen.getByRole("button", { name: "登録" }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).not.toContain(
        "internal_details_must_not_appear",
      );
      expect(alert.textContent).toMatch(
        status === 403
          ? /権限/
          : status === 409
            ? /更新.*一覧/
            : /できません.*もう一度/,
      );
      expect((code as HTMLInputElement).value).toBe("XYZ");
      expect((name as HTMLInputElement).value).toBe("testclient_retry");
      expect(
        screen.getByRole("heading", { name: "取引先の登録" }),
      ).toBeTruthy();
      expect(screen.queryByText("testclient_retry")).toBeNull();
    },
  );
});

describe("#192 AC-5・AC-7（5-7 AC-11）: 検索語の上限", () => {
  it("#192 AC-5・AC-7（5-7 AC-11）: 101文字は送信せず100文字へ修正すると案内が消えて検索できる", async () => {
    const queries: string[] = [];
    server.use(
      http.get("/api/admin/clients", ({ request }) => {
        const q = new URL(request.url).searchParams.get("q");
        if (q !== null) queries.push(q);
        return HttpResponse.json({ items: [internal], nextCursor: null });
      }),
    );
    renderPage();
    await screen.findByText("社内");
    const search = screen.getByRole("searchbox", { name: "取引先を検索" });
    fireEvent.change(search, { target: { value: "a".repeat(101) } });
    fireEvent.submit(search.closest("form")!);
    expect(await screen.findByText(/検索語は100文字以内/)).toBeTruthy();
    expect(queries).toHaveLength(0);
    fireEvent.change(search, { target: { value: "a".repeat(100) } });
    fireEvent.submit(search.closest("form")!);
    await waitFor(() => expect(queries).toEqual(["a".repeat(100)]));
    expect(screen.queryByText(/検索語は100文字以内/)).toBeNull();
  });
});

describe("#192 AC-7（5-7 AC-4）: 更新中の多重操作", () => {
  it("#192 AC-7（5-7 AC-4）: 無効化応答待ちの再クリックでは二重送信せず完了後に状態を更新する", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    let current = alpha;
    server.use(
      http.get("/api/admin/clients", () =>
        HttpResponse.json({ items: [current], nextCursor: null }),
      ),
      http.patch("/api/admin/clients/client_alpha/status", async () => {
        calls += 1;
        await gate;
        current = { ...current, active: false, version: 2 };
        return HttpResponse.json(current);
      }),
    );
    renderPage();
    const row = await screen.findByRole("row", { name: /ABC/ });
    const button = within(row).getByRole("button", { name: "無効にする" });
    fireEvent.click(button);
    await waitFor(() =>
      expect((button as HTMLButtonElement).disabled).toBe(true),
    );
    fireEvent.click(button);
    expect(calls).toBe(1);
    release?.();
    await waitFor(() =>
      expect(
        within(screen.getByRole("row", { name: /ABC/ })).getByText("無効"),
      ).toBeTruthy(),
    );
    expect(calls).toBe(1);
  });
});

describe("#192 AC-3・AC-4・AC-7（5-7 AC-3・AC-9）: 名前変更の利用者操作", () => {
  it("#192 AC-3・AC-4（5-7 AC-3・AC-9）: INTは名前変更できるがコードを変更できない", async () => {
    let current = internal;
    const requests: unknown[] = [];
    server.use(
      http.get("/api/admin/clients", () =>
        HttpResponse.json({ items: [current], nextCursor: null }),
      ),
      http.patch("/api/admin/clients/client_int", async ({ request }) => {
        requests.push(await request.json());
        current = { ...current, name: "testclient_internal", version: 2 };
        return HttpResponse.json(current);
      }),
    );
    renderPage();
    const row = await screen.findByRole("row", { name: /INT/ });
    fireEvent.click(within(row).getByRole("button", { name: "名前を変更" }));
    expect(screen.getByText("取引先コード：INT")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "取引先コード" })).toBeNull();
    const name = screen.getByRole("textbox", {
      name: "取引先名",
    }) as HTMLInputElement;
    expect(name.value).toBe("社内");
    fireEvent.change(name, { target: { value: "testclient_internal" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(
      await screen.findByRole("row", { name: /INT.*testclient_internal/ }),
    ).toBeTruthy();
    expect(requests).toEqual([{ name: "testclient_internal", version: 1 }]);
    expect(
      screen.queryByRole("heading", { name: "取引先名の変更" }),
    ).toBeNull();
  });

  it("#192 AC-3・AC-7（5-7 AC-3）: 改名をキャンセルした後に別行を開くと前の入力は残らない", async () => {
    const beta: Client = {
      id: "client_beta",
      code: "BET",
      name: "testclient_beta",
      active: true,
      version: 1,
    };
    let patches = 0;
    server.use(
      http.get("/api/admin/clients", () =>
        HttpResponse.json({ items: [alpha, beta], nextCursor: null }),
      ),
      http.patch("/api/admin/clients/:id", () => {
        patches += 1;
        return HttpResponse.json(alpha);
      }),
    );
    renderPage();
    const alphaRow = await screen.findByRole("row", { name: /ABC/ });
    fireEvent.click(
      within(alphaRow).getByRole("button", { name: "名前を変更" }),
    );
    const name = screen.getByRole("textbox", {
      name: "取引先名",
    }) as HTMLInputElement;
    expect(name.value).toBe("testclient_alpha");
    fireEvent.change(name, { target: { value: "testclient_unsaved" } });
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(
      screen.queryByRole("heading", { name: "取引先名の変更" }),
    ).toBeNull();
    fireEvent.click(
      within(screen.getByRole("row", { name: /BET/ })).getByRole("button", {
        name: "名前を変更",
      }),
    );
    expect(
      (screen.getByRole("textbox", { name: "取引先名" }) as HTMLInputElement)
        .value,
    ).toBe("testclient_beta");
    expect(screen.getByText("取引先コード：BET")).toBeTruthy();
    expect(patches).toBe(0);
  });

  it("#192 AC-3（5-7 AC-3）: 無効取引先には名前変更の操作を出さない", async () => {
    list([alpha, inactive]);
    renderPage();
    const activeRow = await screen.findByRole("row", { name: /ABC/ });
    const inactiveRow = screen.getByRole("row", { name: /OLD/ });
    expect(
      within(activeRow).getByRole("button", { name: "名前を変更" }),
    ).toBeTruthy();
    expect(
      within(inactiveRow).queryByRole("button", { name: "名前を変更" }),
    ).toBeNull();
  });
});

describe("#192 AC-2・AC-7（5-7 AC-2）: 登録中の多重操作", () => {
  it("#192 AC-2・AC-7（5-7 AC-2）: 登録応答待ちは入力を保ち再クリックでも一度しか送信しない", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    let items: Client[] = [internal];
    server.use(
      http.get("/api/admin/clients", () =>
        HttpResponse.json({ items, nextCursor: null }),
      ),
      http.post("/api/admin/clients", async ({ request }) => {
        calls += 1;
        expect(await request.json()).toEqual({
          code: "ABC",
          name: "testclient_alpha",
        });
        await gate;
        items = [alpha, internal];
        return HttpResponse.json(alpha, { status: 201 });
      }),
    );
    renderPage();
    await screen.findByText("社内");
    fireEvent.click(screen.getByRole("button", { name: "取引先を登録" }));
    const code = screen.getByRole("textbox", {
      name: "取引先コード",
    }) as HTMLInputElement;
    const name = screen.getByRole("textbox", {
      name: "取引先名",
    }) as HTMLInputElement;
    fireEvent.change(code, { target: { value: "ABC" } });
    fireEvent.change(name, { target: { value: "testclient_alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "登録" }));
    const pending = await screen.findByRole("button", { name: "保存中" });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    expect(code.value).toBe("ABC");
    expect(name.value).toBe("testclient_alpha");
    fireEvent.click(pending);
    expect(calls).toBe(1);
    release?.();
    expect(await screen.findByText("testclient_alpha")).toBeTruthy();
    expect(calls).toBe(1);
  });
});
