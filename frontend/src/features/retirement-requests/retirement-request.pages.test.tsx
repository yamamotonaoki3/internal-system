// #128（128-c）0-1 AC-20・C-177（U-1・U-3・U-8）：S-22（/accounts）の「退職処理の申請」タブと、自分の申請のページ（/retirement-requests/mine）。
// App を通して描画し、API は MSW（server.use）で返す。データは架空（testuser_128c_・[E2E_TEST]・example.com）。
// 公開形の仮定（契約。計画 5.5。定めのない文言は 128-a・128-b とそろえた仮置き）：
//  S-22：
//   - タブ（role=tab）「退職処理の申請」。/accounts?tab=retirement-requests で開くと、そのタブを選んだ状態（通知の移動先）
//   - GET /api/admin/retirement-requests?status=pending の各行（role=row）に、対象の表示名・部署名・申請者の表示名、ボタン「無効化」「却下」
//   - 「却下」→ ダイアログ（role=dialog、名前に「却下」）・理由の入力（ラベル「却下の理由」）・「却下する」→ POST /api/admin/retirement-requests/:id/reject { reason }
//     再認証（期限内なら省略）の後に送る。理由が空ならダイアログの中の role=alert で知らせ、送らない。成功で閉じ、一覧の上の role=status「却下しました」、一覧を取り直す
//   - 「無効化」→ 128-a の無効化のダイアログ（role=dialog、名前に「無効化」。対象の表示名）→「無効化する」→ POST /api/admin/accounts/:targetId/deactivate
//     成功で一覧の上の role=status「無効化しました」、申請の一覧を取り直す
//   - 失敗（409 等）はダイアログの中の role=alert にサーバーの文
//  自分の申請：
//   - h1「自分の退職処理の申請」。GET /api/retirement-requests/mine の各行に対象の表示名・状態（申請中／完了／却下／取り下げ済み）。却下は理由を文字で出す
//   - 申請中の行にだけ「取り下げ」（名前に対象の表示名）→ 確認のダイアログ（名前に「取り下げ」）→「取り下げる」→ POST /api/retirement-requests/:id/withdraw
import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SHELL_USER,
  installDomStubs,
  renderApp,
  type DomStubs,
} from "../../test/app-shell-harness";
import { server } from "../../test/server";

const DEPT = { id: "01JTEST128CDEPT00000000010", name: "[E2E_TEST]128c部署" };
const TARGET = {
  id: "01JTEST128CTARGET000000010",
  displayName: "testuser_128c_target_表示",
};
const OWNER = {
  id: "01JTEST128C0WNER0000000010",
  displayName: "testuser_128c_owner_表示",
};
const REQ_ID = "01JTEST128CREQ000000000010";
const REASON = "[E2E_TEST]在籍の確認がとれたため";
// user.type では「[」が特別な記号のため、入力用は「[[」に直す
const TYPED_REASON = REASON.replace("[", "[[");

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
});
afterEach(() => {
  stubs.restore();
});

type RequestItem = {
  id: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  target: { id: string; displayName: string };
  department: { id: string; name: string };
  requester: { id: string; displayName: string };
  decisionReason: string | null;
  createdAt: string;
  decidedAt: string | null;
};

const pendingItem = (overrides: Partial<RequestItem> = {}): RequestItem => ({
  id: REQ_ID,
  status: "pending",
  target: TARGET,
  department: DEPT,
  requester: OWNER,
  decisionReason: null,
  createdAt: "2026-11-17T00:00:00.000Z",
  decidedAt: null,
  ...overrides,
});

function respondSession(permissions: string[], reauthenticated = true) {
  server.use(
    http.get("/api/auth/session", () =>
      HttpResponse.json({
        user: SHELL_USER,
        permissions,
        mustChangePassword: false,
        reauthenticatedAt: reauthenticated ? new Date().toISOString() : null,
      }),
    ),
  );
}

type AdminCalls = {
  lists: URL[];
  rejects: { id: string; body: unknown }[];
  deactivates: string[];
};

function respondAdmin(
  options: {
    items?: RequestItem[];
    reject?: () => Response;
  } = {},
): AdminCalls {
  respondSession(["perm.account.create"]);
  const calls: AdminCalls = { lists: [], rejects: [], deactivates: [] };
  let items = options.items ?? [pendingItem()];
  server.use(
    http.get("/api/admin/accounts", () =>
      HttpResponse.json({ items: [], nextCursor: null }),
    ),
    http.get("/api/admin/retirement-requests", ({ request }) => {
      calls.lists.push(new URL(request.url));
      return HttpResponse.json({ items, nextCursor: null });
    }),
    http.post(
      "/api/admin/retirement-requests/:id/reject",
      async ({ params, request }) => {
        calls.rejects.push({
          id: String(params.id),
          body: await request.json(),
        });
        const failure = options.reject?.();
        if (failure) return failure;
        items = [];
        return HttpResponse.json({ id: String(params.id), status: "rejected" });
      },
    ),
    http.post("/api/admin/accounts/:id/deactivate", ({ params }) => {
      calls.deactivates.push(String(params.id));
      items = [];
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return calls;
}

async function openTab(user: ReturnType<typeof renderApp>["user"]) {
  await screen.findByRole("heading", { level: 1, name: "アカウント管理" });
  await user.click(screen.getByRole("tab", { name: "退職処理の申請" }));
}

const requestRow = () =>
  screen.findByRole("row", { name: new RegExp(TARGET.displayName) });

describe("#128（128-c）C-177（U-8）S-22 の「退職処理の申請」タブ", () => {
  it("#128 C-177（U-8）: タブを選ぶと pending の申請を読み、対象の表示名・部署・申請者を行に出す", async () => {
    const calls = respondAdmin();
    const { user } = renderApp("/accounts");
    await openTab(user);
    const row = within(await requestRow());
    expect(row.getByText(DEPT.name)).toBeTruthy();
    expect(row.getByText(OWNER.displayName)).toBeTruthy();
    expect(row.getByRole("button", { name: /無効化/ })).toBeTruthy();
    expect(row.getByRole("button", { name: /却下/ })).toBeTruthy();
    expect(calls.lists.at(-1)?.searchParams.get("status")).toBe("pending");
  });

  it("#128 3-4 AC-1: 通知の移動先 /accounts?tab=retirement-requests で開くと、申請のタブを選んだ状態で出る", async () => {
    respondAdmin();
    renderApp("/accounts?tab=retirement-requests");
    expect(await requestRow()).toBeTruthy();
    expect(
      screen
        .getByRole("tab", { name: "退職処理の申請" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("#128 C-177（U-8）: 申請中の申請がなければ、ないことを知らせる", async () => {
    respondAdmin({ items: [] });
    const { user } = renderApp("/accounts");
    await openTab(user);
    expect(
      await screen.findByText(/申請中の退職処理の申請はありません/),
    ).toBeTruthy();
  });

  it("#128 C-177（U-1）: 「却下」で理由を入れて送ると、ダイアログを閉じ「却下しました」を出し、一覧を取り直す", async () => {
    const calls = respondAdmin();
    const { user } = renderApp("/accounts");
    await openTab(user);
    await user.click(
      within(await requestRow()).getByRole("button", { name: /却下/ }),
    );
    const dialog = await screen.findByRole("dialog", { name: /却下/ });
    await user.type(within(dialog).getByLabelText("却下の理由"), TYPED_REASON);
    const listsBefore = calls.lists.length;
    await user.click(within(dialog).getByRole("button", { name: "却下する" }));
    await waitFor(() =>
      expect(calls.rejects).toEqual([{ id: REQ_ID, body: { reason: REASON } }]),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /却下/ })).toBeNull(),
    );
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("status")
          .some((s) => s.textContent?.includes("却下しました") === true),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(calls.lists.length).toBeGreaterThan(listsBefore),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("row", { name: new RegExp(TARGET.displayName) }),
      ).toBeNull(),
    );
  });

  // 理由の入力欄の、アクセシブルな説明（aria-describedby が指す要素の文）を集める
  function describedText(element: HTMLElement): string {
    return (element.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .filter((id) => id !== "")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
  }

  async function openRejectDialog(user: ReturnType<typeof renderApp>["user"]) {
    await openTab(user);
    await user.click(
      within(await requestRow()).getByRole("button", { name: /却下/ }),
    );
    return screen.findByRole("dialog", { name: /却下/ });
  }

  it("#128 C-177（U-1）・レビュー1回目（軽微）: 理由が空（空白だけ）なら、理由の入力欄に結び付いたエラー（aria-invalid・aria-describedby）で知らせて送らない", async () => {
    const calls = respondAdmin();
    const { user } = renderApp("/accounts");
    const dialog = await openRejectDialog(user);
    const field = within(dialog).getByLabelText("却下の理由");
    await user.type(field, "   ");
    await user.click(within(dialog).getByRole("button", { name: "却下する" }));
    await waitFor(() =>
      expect(field.getAttribute("aria-invalid")).toBe("true"),
    );
    expect(describedText(field)).toContain("1〜200文字で入力してください");
    expect(calls.rejects).toEqual([]);
  });

  it("#128 C-177（U-1）・レビュー1回目（軽微）: 理由が201文字なら、理由の入力欄に結び付いたエラーで知らせて送らない。入力し直して送れば、エラーは消える", async () => {
    const calls = respondAdmin();
    const { user } = renderApp("/accounts");
    const dialog = await openRejectDialog(user);
    const field = within(dialog).getByLabelText("却下の理由");
    await user.click(field);
    await user.paste("あ".repeat(201));
    await user.click(within(dialog).getByRole("button", { name: "却下する" }));
    await waitFor(() =>
      expect(field.getAttribute("aria-invalid")).toBe("true"),
    );
    expect(describedText(field)).toContain("1〜200文字で入力してください");
    expect(calls.rejects).toEqual([]);
    await user.clear(field);
    await user.type(field, TYPED_REASON);
    await user.click(within(dialog).getByRole("button", { name: "却下する" }));
    await waitFor(() =>
      expect(calls.rejects).toEqual([{ id: REQ_ID, body: { reason: REASON } }]),
    );
  });

  it("#128 C-177（U-1）・レビュー1回目（軽微）: サーバーが 422 fields: [reason] を返したら、同じ理由の入力欄に結び付いたエラーとして出し、ダイアログは閉じない", async () => {
    const message = "却下の理由を入力し直してください";
    respondAdmin({
      reject: () =>
        HttpResponse.json(
          { code: "VALIDATION_ERROR", message, fields: ["reason"] },
          { status: 422 },
        ),
    });
    const { user } = renderApp("/accounts");
    const dialog = await openRejectDialog(user);
    const field = within(dialog).getByLabelText("却下の理由");
    await user.type(field, TYPED_REASON);
    await user.click(within(dialog).getByRole("button", { name: "却下する" }));
    await waitFor(() =>
      expect(field.getAttribute("aria-invalid")).toBe("true"),
    );
    expect(describedText(field)).toContain(message);
    expect(screen.getByRole("dialog", { name: /却下/ })).toBeTruthy();
  });

  it("#128 C-177（U-1）: 再認証が切れていれば、「却下する」で再認証のダイアログを出し、パスワードを入れるまで送らない", async () => {
    const calls = respondAdmin();
    respondSession(["perm.account.create"], false);
    const { user } = renderApp("/accounts");
    await openTab(user);
    await user.click(
      within(await requestRow()).getByRole("button", { name: /却下/ }),
    );
    const dialog = await screen.findByRole("dialog", { name: /却下/ });
    await user.type(within(dialog).getByLabelText("却下の理由"), TYPED_REASON);
    await user.click(within(dialog).getByRole("button", { name: "却下する" }));
    expect(await screen.findByRole("dialog", { name: "再認証" })).toBeTruthy();
    expect(calls.rejects).toEqual([]);
  });

  it("#128 C-177（U-1）: 処理済み（409）なら、ダイアログの中にサーバーの文を出し、成功として閉じない", async () => {
    const message = "この申請はすでに処理されています";
    respondAdmin({
      reject: () =>
        HttpResponse.json(
          { code: "CONFLICT", message, reason: "not_pending" },
          { status: 409 },
        ),
    });
    const { user } = renderApp("/accounts");
    await openTab(user);
    await user.click(
      within(await requestRow()).getByRole("button", { name: /却下/ }),
    );
    const dialog = await screen.findByRole("dialog", { name: /却下/ });
    await user.type(within(dialog).getByLabelText("却下の理由"), TYPED_REASON);
    await user.click(within(dialog).getByRole("button", { name: "却下する" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(message);
    expect(screen.getByRole("dialog", { name: /却下/ })).toBeTruthy();
  });

  it("#128 0-1 AC-20・C-177（U-3）: 「無効化」で 128-a の確認のダイアログを出し、「無効化する」で対象を無効化し、「無効化しました」を出して申請の一覧を取り直す", async () => {
    const calls = respondAdmin();
    const { user } = renderApp("/accounts");
    await openTab(user);
    await user.click(
      within(await requestRow()).getByRole("button", { name: /無効化/ }),
    );
    const dialog = await screen.findByRole("dialog", { name: /無効化/ });
    expect(
      within(dialog).getByText(new RegExp(TARGET.displayName)),
    ).toBeTruthy();
    const listsBefore = calls.lists.length;
    await user.click(
      within(dialog).getByRole("button", { name: "無効化する" }),
    );
    await waitFor(() => expect(calls.deactivates).toEqual([TARGET.id]));
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("status")
          .some((s) => s.textContent?.includes("無効化しました") === true),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(calls.lists.length).toBeGreaterThan(listsBefore),
    );
  });
});

type MineCalls = { withdraws: string[] };

function respondMine(items: RequestItem[]): MineCalls {
  respondSession([]);
  const calls: MineCalls = { withdraws: [] };
  let current = items;
  server.use(
    http.get("/api/retirement-requests/mine", () =>
      HttpResponse.json({
        // 自分の申請の応答には申請者の項目を持たない（申請者は本人）
        items: current.map((item) => {
          const rest: Partial<RequestItem> = { ...item };
          delete rest.requester;
          return rest;
        }),
        nextCursor: null,
      }),
    ),
    http.post("/api/retirement-requests/:id/withdraw", ({ params }) => {
      calls.withdraws.push(String(params.id));
      current = current.map((i) =>
        i.id === String(params.id) ? { ...i, status: "withdrawn" } : i,
      );
      return HttpResponse.json({ id: String(params.id), status: "withdrawn" });
    }),
  );
  return calls;
}

describe("#128（128-c）C-177（U-1）自分の退職処理の申請", () => {
  it("#128 C-177（U-1）: 状態を出し分け、却下の理由を文字で出し、申請中の行にだけ「取り下げ」を出す", async () => {
    respondMine([
      pendingItem(),
      pendingItem({
        id: "01JTEST128CREQ000000000020",
        target: {
          id: "01JTEST128CTARGET000000020",
          displayName: "testuser_128c_rejected_表示",
        },
        status: "rejected",
        decisionReason: "<b>[E2E_TEST]却下</b>",
        decidedAt: "2026-11-17T01:00:00.000Z",
      }),
      pendingItem({
        id: "01JTEST128CREQ000000000030",
        target: {
          id: "01JTEST128CTARGET000000030",
          displayName: "testuser_128c_approved_表示",
        },
        status: "approved",
        decidedAt: "2026-11-17T01:00:00.000Z",
      }),
    ]);
    renderApp("/retirement-requests/mine");
    await screen.findByRole("heading", {
      level: 1,
      name: "自分の退職処理の申請",
    });
    const pendingRow = within(await requestRow());
    expect(pendingRow.getByText("申請中")).toBeTruthy();
    expect(pendingRow.getByRole("button", { name: /取り下げ/ })).toBeTruthy();
    const rejected = within(
      await screen.findByRole("row", { name: /testuser_128c_rejected_表示/ }),
    );
    expect(rejected.getByText("却下")).toBeTruthy();
    // 理由はHTMLとして解釈せず、文字として出す
    expect(rejected.getByText(/<b>\[E2E_TEST\]却下<\/b>/)).toBeTruthy();
    expect(rejected.queryByRole("button", { name: /取り下げ/ })).toBeNull();
    const approved = within(
      await screen.findByRole("row", { name: /testuser_128c_approved_表示/ }),
    );
    expect(approved.getByText("完了")).toBeTruthy();
    expect(approved.queryByRole("button", { name: /取り下げ/ })).toBeNull();
  });

  it("#128 C-177（U-1）: 「取り下げ」は確認のダイアログの後に送り、行の状態が「取り下げ済み」になる", async () => {
    const calls = respondMine([pendingItem()]);
    const { user } = renderApp("/retirement-requests/mine");
    await user.click(
      within(await requestRow()).getByRole("button", { name: /取り下げ/ }),
    );
    const dialog = await screen.findByRole("dialog", { name: /取り下げ/ });
    expect(calls.withdraws).toEqual([]);
    await user.click(
      within(dialog).getByRole("button", { name: "取り下げる" }),
    );
    await waitFor(() => expect(calls.withdraws).toEqual([REQ_ID]));
    await waitFor(async () =>
      expect(within(await requestRow()).getByText("取り下げ済み")).toBeTruthy(),
    );
  });
});
