// #128（128-c）0-1 AC-20・C-177（U-8）：社員一覧（S-20、/members）の行から、自部署のオーナーが退職処理を申請する。
// App を通して描画し、社員一覧は MSW（test/profile-handlers.ts）、申請の API は server.use で返す。データは架空（testuser_・[E2E_TEST]・example.com）。
// 公開形の仮定（契約。計画 5.5・screens.md S-13 の状態の文言）：
//  - GET /api/users の行の canRequestRetirement が true の他人の行にだけ、ボタン「退職処理を申請」（名前に対象の表示名を含む）を出す（表示の制御。認可はサーバー）
//  - 押すと確認のダイアログ（role=dialog、名前に「退職処理の申請」を含む。対象の表示名を出す。「申請する」「キャンセル」）
//  - 「申請する」で POST /api/retirement-requests { targetUserId }。再認証は求めない（00-foundation.md 0-5。利用者の決定）
//  - 成功でダイアログを閉じ、一覧の上の role=status に「全体管理者へ退職処理を申請しました。処理が完了するまで社員は有効です」。次の操作で消える
//  - 自分がどこかの部署のオーナーのとき（セッションの permissions に perm.workspace.manage。統括の決定の入口）、画面にリンク「自分の退職処理の申請」（/retirement-requests/mine）。オーナーでなければ出さない
//  - 失敗（409 等）はダイアログの中の role=alert にサーバーの文を出し、閉じない
import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SHELL_USER,
  installDomStubs,
  renderApp,
  type DomStubs,
} from "../../test/app-shell-harness";
import { member, respondProfileWorld } from "../../test/profile-handlers";
import { server } from "../../test/server";

const SUCCESS =
  "全体管理者へ退職処理を申請しました。処理が完了するまで社員は有効です";

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
});
afterEach(() => {
  stubs.restore();
});

/** 申請の API を返す。既定では、セッションを「再認証の期限内」にする（reauthenticated: false で再認証なし） */
function respondSubmit(
  response?: () => Response,
  options: { reauthenticated?: boolean; permissions?: string[] } = {},
) {
  const bodies: unknown[] = [];
  server.use(
    http.get("/api/auth/session", () =>
      HttpResponse.json({
        user: SHELL_USER,
        permissions: options.permissions ?? [],
        mustChangePassword: false,
        reauthenticatedAt:
          options.reauthenticated === false ? null : new Date().toISOString(),
      }),
    ),
    http.post("/api/retirement-requests", async ({ request }) => {
      bodies.push(await request.json());
      return (
        response?.() ??
        HttpResponse.json(
          {
            id: "01JTEST128CFR0NTREQ0000010",
            targetUserId: "x",
            departmentId: "y",
            status: "pending",
            createdAt: "2026-11-17T00:00:00.000Z",
          },
          { status: 201 },
        )
      );
    }),
  );
  return bodies;
}

async function rowOf(name: string) {
  await screen.findByRole("heading", { level: 1, name: "社員一覧" });
  const table = await within(screen.getByRole("main")).findByRole("table");
  const button = await within(table).findByRole("button", { name });
  const row = button.closest("tr");
  if (row === null) throw new Error(`${name} の行がありません`);
  return row as HTMLElement;
}

const requestButton = (row: HTMLElement) =>
  within(row).queryByRole("button", { name: /退職処理を申請/ });

describe("#128（128-c）C-177（U-8）S-20 の申請ボタンの出し分け", () => {
  it("#128 C-177（U-8）: canRequestRetirement が true の行にだけ「退職処理を申請」を出し、名前に表示名を含む", async () => {
    respondProfileWorld({
      members: [
        member(1, { canRequestRetirement: true }),
        member(2, { canRequestRetirement: false }),
      ],
    });
    respondSubmit();
    renderApp("/members");
    const row = within(await rowOf("テスト社員001"));
    expect(
      row.getByRole("button", {
        name: /退職処理を申請.*テスト社員001|テスト社員001.*退職処理を申請/,
      }),
    ).toBeTruthy();
    expect(requestButton(await rowOf("テスト社員002"))).toBeNull();
  });
});

describe("#128（128-c）0-1 AC-20 S-20 からの申請", () => {
  it("#128 0-1 AC-20: 確認のダイアログに対象の表示名を出し、「申請する」で対象のIDを送り、閉じて完了の文を出す（再認証の期限内なら再認証のダイアログは出ない）", async () => {
    respondProfileWorld({
      members: [member(1, { canRequestRetirement: true })],
    });
    const bodies = respondSubmit();
    const { user } = renderApp("/members");
    const row = await rowOf("テスト社員001");
    await user.click(requestButton(row) as HTMLElement);
    const dialog = await screen.findByRole("dialog", {
      name: /退職処理の申請/,
    });
    expect(within(dialog).getByText(/テスト社員001/)).toBeTruthy();
    expect(bodies).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "申請する" }));
    await waitFor(() =>
      expect(bodies).toEqual([{ targetUserId: member(1).id }]),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /退職処理の申請/ }),
      ).toBeNull(),
    );
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("status")
          .some((s) => s.textContent?.includes(SUCCESS) === true),
      ).toBe(true),
    );
    expect(screen.queryByRole("dialog", { name: "再認証" })).toBeNull();
    // 申請しただけでは社員は有効のまま（一覧から消えない）
    expect(await rowOf("テスト社員001")).toBeTruthy();
  });

  it("#128 0-1 AC-20（0-5）: 再認証が切れていても、再認証のダイアログを出さずに送り、完了の文を出す", async () => {
    respondProfileWorld({
      members: [member(1, { canRequestRetirement: true })],
    });
    const bodies = respondSubmit(undefined, { reauthenticated: false });
    const { user } = renderApp("/members");
    await user.click(
      requestButton(await rowOf("テスト社員001")) as HTMLElement,
    );
    const dialog = await screen.findByRole("dialog", {
      name: /退職処理の申請/,
    });
    await user.click(within(dialog).getByRole("button", { name: "申請する" }));
    await waitFor(() =>
      expect(bodies).toEqual([{ targetUserId: member(1).id }]),
    );
    await waitFor(() =>
      expect(screen.getByRole("main").textContent).toContain(SUCCESS),
    );
    expect(screen.queryByRole("dialog", { name: "再認証" })).toBeNull();
  });

  it("#128 0-1 AC-20: 完了の文は、次の操作（別の行の申請を開く）で消える", async () => {
    respondProfileWorld({
      members: [
        member(1, { canRequestRetirement: true }),
        member(2, { canRequestRetirement: true }),
      ],
    });
    respondSubmit();
    const { user } = renderApp("/members");
    await user.click(
      requestButton(await rowOf("テスト社員001")) as HTMLElement,
    );
    const dialog = await screen.findByRole("dialog", {
      name: /退職処理の申請/,
    });
    await user.click(within(dialog).getByRole("button", { name: "申請する" }));
    await waitFor(() =>
      expect(screen.getByRole("main").textContent).toContain(SUCCESS),
    );
    await user.click(
      requestButton(await rowOf("テスト社員002")) as HTMLElement,
    );
    await screen.findByRole("dialog", { name: /退職処理の申請/ });
    expect(screen.getByRole("main").textContent).not.toContain(SUCCESS);
  });

  it("#128 0-1 AC-20: 「キャンセル」では送らない", async () => {
    respondProfileWorld({
      members: [member(1, { canRequestRetirement: true })],
    });
    const bodies = respondSubmit();
    const { user } = renderApp("/members");
    await user.click(
      requestButton(await rowOf("テスト社員001")) as HTMLElement,
    );
    const dialog = await screen.findByRole("dialog", {
      name: /退職処理の申請/,
    });
    await user.click(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /退職処理の申請/ }),
      ).toBeNull(),
    );
    expect(bodies).toEqual([]);
    expect(screen.getByRole("main").textContent).not.toContain(SUCCESS);
  });

  it.each([
    [
      "申請中の申請がある（409）",
      409,
      "CONFLICT",
      "この社員には、すでに申請中の退職処理の申請があります",
    ],
    ["権限がない（403）", 403, "FORBIDDEN", "この操作を行う権限がありません"],
  ])(
    "#128 C-177（U-2）: %sなら、ダイアログの中に理由の文を出し、成功として閉じない",
    async (_label, status, code, message) => {
      respondProfileWorld({
        members: [member(1, { canRequestRetirement: true })],
      });
      respondSubmit(() =>
        HttpResponse.json(
          { code, message, reason: "duplicate_pending" },
          { status },
        ),
      );
      const { user } = renderApp("/members");
      await user.click(
        requestButton(await rowOf("テスト社員001")) as HTMLElement,
      );
      const dialog = await screen.findByRole("dialog", {
        name: /退職処理の申請/,
      });
      await user.click(
        within(dialog).getByRole("button", { name: "申請する" }),
      );
      const alert = await within(dialog).findByRole("alert");
      expect(alert.textContent).toContain(message);
      expect(
        screen.getByRole("dialog", { name: /退職処理の申請/ }),
      ).toBeTruthy();
      expect(screen.getByRole("main").textContent).not.toContain(SUCCESS);
    },
  );
});

describe("#128（128-c）C-177（U-1）S-20 から自分の申請への入口", () => {
  const myLink = () =>
    within(screen.getByRole("main")).queryByRole("link", {
      name: "自分の退職処理の申請",
    });

  it("#128 C-177（U-1）: 自分がどこかの部署のオーナーなら、リンク「自分の退職処理の申請」（/retirement-requests/mine）を出す", async () => {
    respondProfileWorld({ members: [member(1)] });
    respondSubmit(undefined, { permissions: ["perm.workspace.manage"] });
    renderApp("/members");
    await rowOf("テスト社員001");
    await waitFor(() => expect(myLink()).not.toBeNull());
    expect(myLink()?.getAttribute("href")).toBe("/retirement-requests/mine");
  });

  it("#128 C-177（U-1）: オーナーでなければ、リンクを出さない", async () => {
    respondProfileWorld({ members: [member(1)] });
    respondSubmit();
    renderApp("/members");
    await rowOf("テスト社員001");
    expect(myLink()).toBeNull();
  });

  it("#128 C-177（U-1）: 申請が成功した後も、完了の文と一緒にリンクがあり、押すと自分の申請の一覧へ移る", async () => {
    respondProfileWorld({
      members: [member(1, { canRequestRetirement: true })],
    });
    respondSubmit(undefined, { permissions: ["perm.workspace.manage"] });
    server.use(
      http.get("/api/retirement-requests/mine", () =>
        HttpResponse.json({ items: [], nextCursor: null }),
      ),
    );
    const { user } = renderApp("/members");
    await user.click(
      requestButton(await rowOf("テスト社員001")) as HTMLElement,
    );
    const dialog = await screen.findByRole("dialog", {
      name: /退職処理の申請/,
    });
    await user.click(within(dialog).getByRole("button", { name: "申請する" }));
    await waitFor(() =>
      expect(screen.getByRole("main").textContent).toContain(SUCCESS),
    );
    const link = myLink();
    expect(link).not.toBeNull();
    await user.click(link as HTMLElement);
    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe(
        "/retirement-requests/mine",
      ),
    );
  });
});
