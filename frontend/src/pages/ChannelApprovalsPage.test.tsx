// #131 AC-3・AC-4・AC-7・AC-8（2-2 AC-3・AC-4・AC-7・AC-8、画面 S-11）：チャンネル作成の承認一覧。API は MSW で返す。データはすべて架空。
// 画面の契約（実装者へ。テストが決めたもの）：
//  - pages/ChannelApprovalsPage.tsx が ChannelApprovalsPage を名前付きで出す。見出し（h1）「チャンネル作成の承認」
//  - 選択欄（combobox）「状態」：「承認待ち」（既定。GET /api/channel-requests?status=pending）・「承認済み」・「却下」・「取り下げ」
//  - 申請は listitem のカード：名前・「会社直属」か「部署」・「公開」か「非公開」・申請者の表示名・状態・却下の理由（文字列として）
//    canApprove が true のカードにだけボタン「承認」「却下」（読み上げ名は「{申請名}の申請を承認する」「{申請名}の申請を却下する」）
//  - 承認：再認証（withReauth。直近 5 分以内なら出さない）→ POST /:id/approve。再認証をキャンセルしたら送らない
//  - 却下：再認証 → ダイアログ「却下の理由」（入力欄「理由」・ボタン「却下する」「キャンセル」）→ POST /:id/reject { reason }。
//    前後の空白を除いて 1〜200 文字でなければ確定できない（送らない）
//  - 409 はサーバーの message をそのまま role=alert に出して一覧を取り直す（決裁済み・名前の重複・部署が無効を出し分ける）
//  - 成功したら、再読込なしで一覧が変わる。承認ではチャンネルの一覧（channelKeys.all = ["channels"]）も無効にする（自己承認で参加中が変わる）
//  - 読み込み中は「読み込み中」、0 件は「該当する申請はありません」、失敗は role=alert
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse, delay } from "msw";
import { describe, expect, it } from "vitest";
import { TEST_PASSWORD } from "../test/auth-handlers";
import {
  SERVER_MESSAGES,
  failPost,
  renderChannelRequestScreen,
  respondReauthOk,
  respondReviewRequests,
  reviewRequest,
} from "../test/channel-request-handlers";
import { server } from "../test/server";
import { ChannelApprovalsPage } from "./ChannelApprovalsPage";

// 読み上げ名は「{申請名}の申請を承認する」「{申請名}の申請を却下する」（どのカードのボタンか分かるように。コードレビューの指摘）
const APPROVE_NAME = /の申請を承認する$/;
const REJECT_NAME = /の申請を却下する$/;

function renderPage(
  reauthenticatedAt: string | null = new Date().toISOString(),
) {
  return renderChannelRequestScreen(<ChannelApprovalsPage />, {
    at: "/channel-approvals",
    path: "/channel-approvals",
    reauthenticatedAt,
  });
}

async function findCard(name: string) {
  await waitFor(() =>
    expect(
      screen
        .queryAllByRole("listitem")
        .some((item) => item.textContent?.includes(name)),
    ).toBe(true),
  );
  const found = screen
    .getAllByRole("listitem")
    .find((item) => item.textContent?.includes(name));
  if (!found) throw new Error(`${name} のカードがありません`);
  return found;
}

const companyRequest = reviewRequest("1", {
  name: "UNIT_TEST_会社直属",
  departmentId: null,
  visibility: "private",
  requesterDisplayName: "テスト申請者A",
});
const ownRequest = reviewRequest("2", {
  name: "UNIT_TEST_自分の申請",
  requesterDisplayName: "テストオーナー",
  canApprove: false,
});

describe("#131 AC-7・AC-8（S-11）一覧", () => {
  it("#131 AC-7: 既定は承認待ち（status=pending）で、カードに名前・会社直属か部署・公開範囲・申請者の表示名・状態を出す", async () => {
    const { queries } = respondReviewRequests([companyRequest, ownRequest]);
    renderPage();
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "チャンネル作成の承認",
      }),
    ).toBeTruthy();
    const card = await findCard("UNIT_TEST_会社直属");
    expect(card.textContent).toContain("会社直属");
    expect(card.textContent).toContain("非公開");
    expect(card.textContent).toContain("テスト申請者A");
    expect(card.textContent).toContain("承認待ち");
    const own = await findCard("UNIT_TEST_自分の申請");
    expect(own.textContent).toContain("部署");
    expect(own.textContent).toContain("公開");
    expect(queries[0]?.get("status")).toBe("pending");
  });

  it("#131 AC-8（2-2 AC-8）: canApprove が false のカード（オーナー自身の申請）には「承認」「却下」を出さない", async () => {
    respondReviewRequests([companyRequest, ownRequest]);
    renderPage();
    const own = await findCard("UNIT_TEST_自分の申請");
    expect(
      within(own).queryByRole("button", { name: APPROVE_NAME }),
    ).toBeNull();
    expect(within(own).queryByRole("button", { name: REJECT_NAME })).toBeNull();
    const other = await findCard("UNIT_TEST_会社直属");
    expect(
      within(other).getByRole("button", { name: APPROVE_NAME }),
    ).toBeTruthy();
    expect(
      within(other).getByRole("button", { name: REJECT_NAME }),
    ).toBeTruthy();
  });

  it("#131 AC-7（アクセシビリティ）: 「承認」「却下」のボタンの読み上げ名は、申請名を含む（カードごとに区別できる）", async () => {
    const second = reviewRequest("4", { name: "UNIT_TEST_二件目" });
    respondReviewRequests([companyRequest, second]);
    renderPage();
    const card = await findCard("UNIT_TEST_会社直属");
    expect(
      within(card).getByRole("button", {
        name: "UNIT_TEST_会社直属の申請を承認する",
      }),
    ).toBeTruthy();
    expect(
      within(card).getByRole("button", {
        name: "UNIT_TEST_会社直属の申請を却下する",
      }),
    ).toBeTruthy();
    const other = await findCard("UNIT_TEST_二件目");
    expect(
      within(other).getByRole("button", {
        name: "UNIT_TEST_二件目の申請を承認する",
      }),
    ).toBeTruthy();
    expect(screen.getAllByRole("button", { name: APPROVE_NAME })).toHaveLength(
      2,
    );
  });

  it("#131 AC-5（2-2 AC-5）: 状態で「却下」を選ぶと status=rejected で取り直し、却下の理由を文字列として出す", async () => {
    const { queries } = respondReviewRequests([
      companyRequest,
      reviewRequest("3", {
        name: "UNIT_TEST_却下済み",
        status: "rejected",
        canApprove: false,
        rejectReason: "<script>alert(1)</script>",
      }),
    ]);
    const { user, container } = renderPage();
    await findCard("UNIT_TEST_会社直属");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "状態" }),
      "却下",
    );
    const card = await findCard("UNIT_TEST_却下済み");
    expect(card.textContent).toContain("<script>alert(1)</script>");
    expect(container.querySelector("script")).toBeNull();
    expect(queries.at(-1)?.get("status")).toBe("rejected");
    expect(
      screen
        .queryAllByRole("listitem")
        .some((i) => i.textContent?.includes("UNIT_TEST_会社直属")),
    ).toBe(false);
  });

  it("#131 AC-7: 状態の選択肢は 承認待ち・承認済み・却下・取り下げ", async () => {
    respondReviewRequests([]);
    renderPage();
    const select = await screen.findByRole("combobox", { name: "状態" });
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["承認待ち", "承認済み", "却下", "取り下げ"]);
  });

  it("#131 AC-7（frontend-state）: 読み込み中を出し、0 件なら「該当する申請はありません」", async () => {
    server.use(
      http.get("/api/channel-requests", async () => {
        await delay(50);
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    renderPage();
    expect(await screen.findByText(/読み込み中/)).toBeTruthy();
    expect(await screen.findByText("該当する申請はありません")).toBeTruthy();
  });

  it("#131 AC-7（frontend-state）: 一覧の取得に失敗（403）したら role=alert を出し、空の一覧として表示しない", async () => {
    server.use(
      http.get("/api/channel-requests", () =>
        HttpResponse.json(
          { code: "FORBIDDEN", message: "この操作を行う権限がありません" },
          { status: 403 },
        ),
      ),
    );
    renderPage();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "この操作を行う権限がありません",
    );
    expect(screen.queryByText("該当する申請はありません")).toBeNull();
  });
});

describe("#131 AC-3（2-2 AC-3・0-5）承認", () => {
  it("#131 AC-3: 再認証が要るときは再認証のダイアログを出し、キャンセルすると承認を送らない", async () => {
    const { sent } = respondReviewRequests([companyRequest]);
    const reauth = respondReauthOk();
    const { user } = renderPage(null);
    const card = await findCard("UNIT_TEST_会社直属");
    await user.click(within(card).getByRole("button", { name: APPROVE_NAME }));
    const dialog = await screen.findByRole("dialog", { name: "再認証" });
    await user.click(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "再認証" })).toBeNull(),
    );
    expect(sent).toEqual([]);
    expect(reauth.calls()).toBe(0);
  });

  it("#131 AC-3: 再認証に成功すると承認を 1 回だけ送り、再読込なしで承認待ちの一覧から消え、チャンネルの一覧も無効にする", async () => {
    const { sent } = respondReviewRequests([companyRequest]);
    respondReauthOk();
    const { user, client } = renderPage(null);
    client.setQueryData(["channels", "list", {}], {
      pages: [],
      pageParams: [],
    });
    const card = await findCard("UNIT_TEST_会社直属");
    await user.click(within(card).getByRole("button", { name: APPROVE_NAME }));
    const dialog = await screen.findByRole("dialog", { name: "再認証" });
    await user.type(within(dialog).getByLabelText("パスワード"), TEST_PASSWORD);
    await user.click(within(dialog).getByRole("button", { name: "再認証" }));
    await waitFor(() =>
      expect(screen.queryByText("UNIT_TEST_会社直属")).toBeNull(),
    );
    expect(sent).toEqual([
      {
        method: "POST",
        path: `/api/channel-requests/${companyRequest.id}/approve`,
        body: null,
      },
    ]);
    expect(client.getQueryState(["channels", "list", {}])?.isInvalidated).toBe(
      true,
    );
  });

  it("#131 AC-3: 直近に再認証していれば、ダイアログを出さずに承認を送る", async () => {
    const { sent } = respondReviewRequests([companyRequest]);
    const { user } = renderPage();
    const card = await findCard("UNIT_TEST_会社直属");
    await user.click(within(card).getByRole("button", { name: APPROVE_NAME }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(screen.queryByRole("dialog", { name: "再認証" })).toBeNull();
  });

  it("#131 AC-3（frontend-state）: 送信中は「承認」「却下」を押せない", async () => {
    respondReviewRequests([companyRequest]);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    server.use(
      http.post("/api/channel-requests/:requestId/approve", async () => {
        calls += 1;
        await gate;
        return HttpResponse.json({
          requestId: companyRequest.id,
          status: "approved",
          channelId: "01JTESTCHREQNEWROOM000001",
          roomId: "01JTESTCHREQNEWROOM000001",
        });
      }),
    );
    const { user } = renderPage();
    const card = await findCard("UNIT_TEST_会社直属");
    const approveButton = within(card).getByRole("button", {
      name: APPROVE_NAME,
    });
    await user.click(approveButton);
    await waitFor(() =>
      expect(approveButton.hasAttribute("disabled")).toBe(true),
    );
    expect(
      within(card)
        .getByRole("button", { name: REJECT_NAME })
        .hasAttribute("disabled"),
    ).toBe(true);
    await user.click(approveButton);
    expect(calls).toBe(1);
    release();
  });

  it.each([
    ["決裁済み", SERVER_MESSAGES.decided],
    ["名前の重複", SERVER_MESSAGES.nameTakenOnApprove],
    ["部署が無効", SERVER_MESSAGES.departmentInactive],
  ])(
    "#131 AC-3・AC-13: 409（%s）はサーバーの文言をそのまま表示し、一覧を取り直す",
    async (_label, message) => {
      const { queries } = respondReviewRequests([companyRequest]);
      failPost("/api/channel-requests/:requestId/approve", 409, {
        code: "CONFLICT",
        message,
      });
      const { user } = renderPage();
      const card = await findCard("UNIT_TEST_会社直属");
      const before = queries.length;
      await user.click(
        within(card).getByRole("button", { name: APPROVE_NAME }),
      );
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain(message);
      for (const other of Object.values(SERVER_MESSAGES).filter(
        (m) => m !== message && m !== SERVER_MESSAGES.createConflict,
      ))
        expect(alert.textContent).not.toContain(other);
      await waitFor(() => expect(queries.length).toBeGreaterThan(before));
    },
  );
});

describe("#131 AC-3・AC-4（2-2 AC-3・AC-4、S-11 の却下の流れ）却下", () => {
  async function openReject(
    reauthenticatedAt: string | null = new Date().toISOString(),
  ) {
    const handlers = respondReviewRequests([companyRequest]);
    respondReauthOk();
    const rendered = renderPage(reauthenticatedAt);
    const card = await findCard("UNIT_TEST_会社直属");
    await rendered.user.click(
      within(card).getByRole("button", { name: REJECT_NAME }),
    );
    return { ...handlers, ...rendered };
  }

  it("#131 AC-3（S-11）: 再認証が要るときは、理由のダイアログより先に再認証のダイアログを出す", async () => {
    const { user } = await openReject(null);
    const reauth = await screen.findByRole("dialog", { name: "再認証" });
    expect(screen.queryByRole("dialog", { name: "却下の理由" })).toBeNull();
    await user.type(within(reauth).getByLabelText("パスワード"), TEST_PASSWORD);
    await user.click(within(reauth).getByRole("button", { name: "再認証" }));
    expect(
      await screen.findByRole("dialog", { name: "却下の理由" }),
    ).toBeTruthy();
  });

  it("#131 AC-3: 再認証をキャンセルすると、理由のダイアログを出さず、却下を送らない", async () => {
    const { user, sent } = await openReject(null);
    const reauth = await screen.findByRole("dialog", { name: "再認証" });
    await user.click(
      within(reauth).getByRole("button", { name: "キャンセル" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "再認証" })).toBeNull(),
    );
    expect(screen.queryByRole("dialog", { name: "却下の理由" })).toBeNull();
    expect(sent).toEqual([]);
  });

  it("#131 AC-4・AC-5: 理由を入れて「却下する」を押すと、理由を 1 回だけ送り、再読込なしで承認待ちの一覧から消える", async () => {
    const { user, sent } = await openReject();
    const dialog = await screen.findByRole("dialog", { name: "却下の理由" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "理由" }),
      "名前を見直してください",
    );
    await user.click(within(dialog).getByRole("button", { name: "却下する" }));
    await waitFor(() =>
      expect(screen.queryByText("UNIT_TEST_会社直属")).toBeNull(),
    );
    expect(sent).toEqual([
      {
        method: "POST",
        path: `/api/channel-requests/${companyRequest.id}/reject`,
        body: { reason: "名前を見直してください" },
      },
    ]);
  });

  it.each([
    ["空", ""],
    ["空白だけ", "   　"],
    ["201 文字", "あ".repeat(201)],
  ])(
    "#131 AC-4（2-2 AC-4・C-54）: 理由が%sなら確定できず、送らない",
    async (_label, reason) => {
      const { user, sent } = await openReject();
      const dialog = await screen.findByRole("dialog", { name: "却下の理由" });
      fireEvent.change(within(dialog).getByRole("textbox", { name: "理由" }), {
        target: { value: reason },
      });
      await user.click(
        within(dialog).getByRole("button", { name: "却下する" }),
      );
      expect(screen.getByRole("dialog", { name: "却下の理由" })).toBeTruthy();
      expect(sent).toEqual([]);
    },
  );

  it("#131 AC-4: 理由が 200 文字ちょうどなら確定できる", async () => {
    const { user, sent } = await openReject();
    const dialog = await screen.findByRole("dialog", { name: "却下の理由" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "理由" }), {
      target: { value: "あ".repeat(200) },
    });
    await user.click(within(dialog).getByRole("button", { name: "却下する" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect((sent[0]?.body as { reason: string }).reason.trim()).toBe(
      "あ".repeat(200),
    );
  });

  it("#131 AC-4（S-11）: 理由のダイアログで「キャンセル」を押すと、何も送らず一覧のまま", async () => {
    const { user, sent } = await openReject();
    const dialog = await screen.findByRole("dialog", { name: "却下の理由" });
    await user.click(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "却下の理由" })).toBeNull(),
    );
    expect(sent).toEqual([]);
    expect(await findCard("UNIT_TEST_会社直属")).toBeTruthy();
  });

  it("#131 AC-3: 却下の 409（決裁済み）はサーバーの文言を表示し、一覧を取り直す", async () => {
    const handlers = respondReviewRequests([companyRequest]);
    failPost("/api/channel-requests/:requestId/reject", 409, {
      code: "CONFLICT",
      message: SERVER_MESSAGES.decided,
    });
    const { user } = renderPage();
    const card = await findCard("UNIT_TEST_会社直属");
    await user.click(within(card).getByRole("button", { name: REJECT_NAME }));
    const dialog = await screen.findByRole("dialog", { name: "却下の理由" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "理由" }),
      "理由",
    );
    const before = handlers.queries.length;
    await user.click(within(dialog).getByRole("button", { name: "却下する" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      SERVER_MESSAGES.decided,
    );
    await waitFor(() =>
      expect(handlers.queries.length).toBeGreaterThan(before),
    );
  });
});
