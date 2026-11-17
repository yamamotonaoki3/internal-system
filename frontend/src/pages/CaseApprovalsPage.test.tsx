// #146（146-B）5-3 AC-3〜AC-6・AC-8・AC-14、C-81、画面 S-29：案件作成の承認一覧。API は MSW で返す。データはすべて架空。
// この層で確かめるもの（計画 1.3・B-6）：表示の分岐（4状態）・ボタンの出し分け・理由のダイアログの入力の検査・二重送信の抑止・409 の表示と取り直し・再認証を経ないこと。
// 画面の契約（実装の担当へ。テストが決めたもの）：
//  - pages/CaseApprovalsPage.tsx が CaseApprovalsPage を名前付きで出す。見出し（h1）「案件作成の承認」
//  - 選択欄（combobox）「状態」：「承認待ち」（既定。GET /api/case-requests?status=pending）・「承認済み」・「却下」・「取り下げ」・「自動取消」
//  - 申請は listitem のカード：件名・取引先名（無効なら「（無効）」）・担当部署の名前・納期・申請者の表示名・候補の表示名・状態・却下の理由（文字列として）・
//    類似件名があれば「似た案件があります」
//  - canApprove が true のカードにだけボタン「承認」「却下」（読み上げ名は「{件名}の申請を承認する」「{件名}の申請を却下する」）
//  - 承認：ダイアログ「案件の作成の承認」（候補を足す欄つき。ボタン「承認する」「キャンセル」）→ POST /:id/approve
//  - 却下：ダイアログ「却下の理由」（入力欄「理由」・ボタン「却下する」「キャンセル」）→ POST /:id/reject { reason }。前後の空白を除いて 1〜200 文字でなければ送らない
//  - 承認・却下は再認証を経ない（C-81。セッションの reauthenticatedAt が null でも、再認証のダイアログを出さない）
//  - 409 はサーバーの message をそのまま role=alert に出して一覧を取り直す
//  - 読み込み中は「読み込み中」、0 件は「該当する申請はありません」、失敗は role=alert
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import {
  APPROVE_PERMISSION,
  DECIDE_MESSAGES,
  respondReviewCaseRequests,
  reviewCaseRequest,
} from "../test/case-approval-handlers";
import {
  CANDIDATE,
  CLIENT_A,
  DEPT_SALES,
  failPost,
  renderCaseRequestScreen,
  respondChoices,
} from "../test/case-request-handlers";
import { server } from "../test/server";
import { CaseApprovalsPage } from "./CaseApprovalsPage";

const APPROVE_NAME = /の申請を承認する$/;
const REJECT_NAME = /の申請を却下する$/;

function renderPage() {
  return renderCaseRequestScreen(<CaseApprovalsPage />, {
    at: "/case-approvals",
    path: "/case-approvals",
    permissions: [APPROVE_PERMISSION],
  });
}

async function findCard(text: string) {
  await waitFor(() =>
    expect(
      screen
        .queryAllByRole("listitem")
        .some((item) => item.textContent?.includes(text)),
    ).toBe(true),
  );
  const found = screen
    .getAllByRole("listitem")
    .find((item) => item.textContent?.includes(text));
  if (!found) throw new Error(`${text} のカードがありません`);
  return found;
}

const target = reviewCaseRequest("1", {
  title: "[UNIT_TEST]保守契約",
  dueDate: "2026-12-01",
  candidates: [
    {
      userId: CANDIDATE.id,
      displayName: CANDIDATE.displayName,
      isActive: true,
    },
  ],
  hasSimilarTitle: true,
});
const own = reviewCaseRequest("2", {
  title: "[UNIT_TEST]自分の申請",
  requesterDisplayName: "テストオーナー",
  canApprove: false,
});

describe("#146 S-29 一覧の表示", () => {
  it("#146 S-29・5-3 AC-14: 既定は承認待ち（status=pending）で、カードに件名・取引先・担当部署・納期・申請者・候補・類似件名の警告・状態を出す", async () => {
    const { queries } = respondReviewCaseRequests([target, own]);
    renderPage();
    expect(
      await screen.findByRole("heading", { level: 1, name: "案件作成の承認" }),
    ).toBeTruthy();
    const card = await findCard("[UNIT_TEST]保守契約");
    for (const text of [
      CLIENT_A.name,
      DEPT_SALES.name,
      "2026-12-01",
      "テスト申請者A",
      CANDIDATE.displayName,
      "似た案件があります",
      "承認待ち",
    ])
      expect(card.textContent).toContain(text);
    const ownCard = await findCard("[UNIT_TEST]自分の申請");
    expect(ownCard.textContent).not.toContain("似た案件があります");
    expect(queries[0]?.get("status")).toBe("pending");
  });

  it("#146 C-120・5-3 AC-8: 無効な取引先には「（無効）」の印を出す", async () => {
    respondReviewCaseRequests([
      reviewCaseRequest("3", {
        title: "[UNIT_TEST]無効の取引先",
        client: { ...CLIENT_A, isActive: false },
      }),
    ]);
    renderPage();
    const card = await findCard("[UNIT_TEST]無効の取引先");
    expect(card.textContent).toContain("（無効）");
  });

  it("#146 5-3 AC-4: canApprove が false のカード（オーナー自身の申請）には「承認」「却下」を出さない", async () => {
    respondReviewCaseRequests([target, own]);
    renderPage();
    const ownCard = await findCard("[UNIT_TEST]自分の申請");
    expect(
      within(ownCard).queryByRole("button", { name: APPROVE_NAME }),
    ).toBeNull();
    expect(
      within(ownCard).queryByRole("button", { name: REJECT_NAME }),
    ).toBeNull();
    const card = await findCard("[UNIT_TEST]保守契約");
    expect(
      within(card).getByRole("button", {
        name: "[UNIT_TEST]保守契約の申請を承認する",
      }),
    ).toBeTruthy();
    expect(
      within(card).getByRole("button", {
        name: "[UNIT_TEST]保守契約の申請を却下する",
      }),
    ).toBeTruthy();
  });

  it("#146 S-29: 状態の選択肢は 承認待ち・承認済み・却下・取り下げ・自動取消", async () => {
    respondReviewCaseRequests([]);
    renderPage();
    const select = await screen.findByRole("combobox", { name: "状態" });
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["承認待ち", "承認済み", "却下", "取り下げ", "自動取消"]);
  });

  it("#146 5-3 AC-6: 状態で「却下」を選ぶと status=rejected で取り直し、却下の理由を文字列として出す", async () => {
    const { queries } = respondReviewCaseRequests([
      target,
      reviewCaseRequest("4", {
        title: "[UNIT_TEST]却下済み",
        status: "rejected",
        canApprove: false,
        rejectReason: "<img src=x onerror=alert(1)>",
      }),
    ]);
    const { user, container } = renderPage();
    await findCard("[UNIT_TEST]保守契約");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "状態" }),
      "却下",
    );
    const card = await findCard("[UNIT_TEST]却下済み");
    expect(card.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(container.querySelector("img[src='x']")).toBeNull();
    expect(queries.at(-1)?.get("status")).toBe("rejected");
  });

  it("#146 frontend-state: 読み込み中を出し、0 件なら「該当する申請はありません」", async () => {
    server.use(
      http.get("/api/case-requests", async () => {
        await delay(50);
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    renderPage();
    expect(await screen.findByText(/読み込み中/)).toBeTruthy();
    expect(await screen.findByText("該当する申請はありません")).toBeTruthy();
  });

  it("#146 frontend-state: 一覧の取得に失敗（403）したら role=alert を出し、空の一覧として表示しない", async () => {
    server.use(
      http.get("/api/case-requests", () =>
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

describe("#146 5-3 AC-2・AC-5・C-81 承認", () => {
  async function openApprove() {
    const handlers = respondReviewCaseRequests([target]);
    const rendered = renderPage();
    const card = await findCard("[UNIT_TEST]保守契約");
    await rendered.user.click(
      within(card).getByRole("button", { name: APPROVE_NAME }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "案件の作成の承認",
    });
    return { ...handlers, ...rendered, dialog };
  }

  it("#146 C-81: 再認証していないセッションでも、再認証のダイアログを出さずに承認を1回だけ送り、承認待ちの一覧から消える", async () => {
    const { user, sent, dialog } = await openApprove();
    await user.click(within(dialog).getByRole("button", { name: "承認する" }));
    await waitFor(() =>
      expect(screen.queryByText("[UNIT_TEST]保守契約")).toBeNull(),
    );
    expect(screen.queryByRole("dialog", { name: "再認証" })).toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.path).toBe(`/api/case-requests/${target.id}/approve`);
    const body = sent[0]?.body as { additionalCandidateIds?: string[] } | null;
    expect(body?.additionalCandidateIds ?? []).toEqual([]);
  });

  it("#146 5-3 AC-5: 承認のダイアログで候補を1人足して「承認する」を押すと、additionalCandidateIds にその ID が入って送られる", async () => {
    respondChoices();
    const { user, sent, dialog } = await openApprove();
    await user.type(
      within(dialog).getByRole("textbox", { name: "候補の検索" }),
      "testuser",
    );
    await user.click(
      await within(dialog).findByRole("button", {
        name: `${CANDIDATE.displayName}を追加`,
      }),
    );
    await user.click(within(dialog).getByRole("button", { name: "承認する" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(
      (sent[0]?.body as { additionalCandidateIds?: string[] })
        .additionalCandidateIds,
    ).toEqual([CANDIDATE.id]);
  });

  it("#146 5-3 AC-5: 候補を足さずに承認すると、送る本文に候補の ID は入らない（空の配列か項目なし）", async () => {
    respondChoices();
    const { user, sent, dialog } = await openApprove();
    expect(
      within(dialog).getByRole("textbox", { name: "候補の検索" }),
    ).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "承認する" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    const body = sent[0]?.body as { additionalCandidateIds?: string[] } | null;
    expect(body?.additionalCandidateIds ?? []).toHaveLength(0);
  });

  it("#146 S-29: 承認のダイアログで「キャンセル」を押すと、何も送らない", async () => {
    const { user, sent, dialog } = await openApprove();
    await user.click(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "案件の作成の承認" }),
      ).toBeNull(),
    );
    expect(sent).toEqual([]);
  });

  it("#146 frontend-state: 送信中は「承認する」を押せず、2回押しても1回だけ送る", async () => {
    respondReviewCaseRequests([target]);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    server.use(
      http.post("/api/case-requests/:requestId/approve", async () => {
        calls += 1;
        await gate;
        return HttpResponse.json({
          requestId: target.id,
          status: "approved",
          caseId: "01JTESTCASEAPPNEWCASE00001",
          caseNumber: "QZA-261117-0001",
          roomId: "01JTESTCASEAPPNEWR00M00001",
        });
      }),
    );
    const { user } = renderPage();
    const card = await findCard("[UNIT_TEST]保守契約");
    await user.click(within(card).getByRole("button", { name: APPROVE_NAME }));
    const dialog = await screen.findByRole("dialog", {
      name: "案件の作成の承認",
    });
    const confirm = within(dialog).getByRole("button", { name: "承認する" });
    await user.click(confirm);
    await waitFor(() => expect(confirm.hasAttribute("disabled")).toBe(true));
    await user.click(confirm);
    expect(calls).toBe(1);
    release();
  });

  it.each([
    ["決裁済み", DECIDE_MESSAGES.decided],
    ["担当部署が無効", DECIDE_MESSAGES.departmentInactive],
    ["取引先が無効", DECIDE_MESSAGES.clientInactive],
    ["候補が無効", DECIDE_MESSAGES.candidateInactive],
    ["番号の上限", DECIDE_MESSAGES.numberExhausted],
  ])(
    "#146 B-6: 409（%s）はサーバーの文言をそのまま表示し、一覧を取り直す",
    async (_label, message) => {
      const { queries } = respondReviewCaseRequests([target]);
      failPost("/api/case-requests/:requestId/approve", 409, {
        code: "CONFLICT",
        message,
      });
      const { user } = renderPage();
      const card = await findCard("[UNIT_TEST]保守契約");
      const before = queries.length;
      await user.click(
        within(card).getByRole("button", { name: APPROVE_NAME }),
      );
      const dialog = await screen.findByRole("dialog", {
        name: "案件の作成の承認",
      });
      await user.click(
        within(dialog).getByRole("button", { name: "承認する" }),
      );
      await waitFor(() =>
        expect(
          screen
            .getAllByRole("alert")
            .some((a) => a.textContent?.includes(message)),
        ).toBe(true),
      );
      await waitFor(() => expect(queries.length).toBeGreaterThan(before));
    },
  );
});

describe("#146 5-3 AC-6 却下", () => {
  async function openReject() {
    const handlers = respondReviewCaseRequests([target]);
    const rendered = renderPage();
    const card = await findCard("[UNIT_TEST]保守契約");
    await rendered.user.click(
      within(card).getByRole("button", { name: REJECT_NAME }),
    );
    const dialog = await screen.findByRole("dialog", { name: "却下の理由" });
    return { ...handlers, ...rendered, dialog };
  }

  it("#146 5-3 AC-6・C-81: 再認証を経ずに理由のダイアログを出し、理由を1回だけ送ると、承認待ちの一覧から消える", async () => {
    const { user, sent, dialog } = await openReject();
    expect(screen.queryByRole("dialog", { name: "再認証" })).toBeNull();
    await user.type(
      within(dialog).getByRole("textbox", { name: "理由" }),
      "件名を見直してください",
    );
    await user.click(within(dialog).getByRole("button", { name: "却下する" }));
    await waitFor(() =>
      expect(screen.queryByText("[UNIT_TEST]保守契約")).toBeNull(),
    );
    expect(sent).toEqual([
      {
        method: "POST",
        path: `/api/case-requests/${target.id}/reject`,
        body: { reason: "件名を見直してください" },
      },
    ]);
  });

  it.each([
    ["空", ""],
    ["空白だけ", "   　"],
    ["201 文字", "あ".repeat(201)],
  ])(
    "#146 5-3 AC-6（C-91）: 理由が%sなら確定できず、送らない",
    async (_label, reason) => {
      const { user, sent, dialog } = await openReject();
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

  it("#146 5-3 AC-6: 理由が 200 文字ちょうどなら確定できる", async () => {
    const { user, sent, dialog } = await openReject();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "理由" }), {
      target: { value: "あ".repeat(200) },
    });
    await user.click(within(dialog).getByRole("button", { name: "却下する" }));
    await waitFor(() => expect(sent).toHaveLength(1));
  });

  it("#146 S-29: 理由のダイアログで「キャンセル」を押すと、何も送らず一覧のまま", async () => {
    const { user, sent, dialog } = await openReject();
    await user.click(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "却下の理由" })).toBeNull(),
    );
    expect(sent).toEqual([]);
    expect(await findCard("[UNIT_TEST]保守契約")).toBeTruthy();
  });

  it("#146 B-6: 却下の 409 はサーバーの文言をそのまま表示する", async () => {
    respondReviewCaseRequests([target]);
    failPost("/api/case-requests/:requestId/reject", 409, {
      code: "CONFLICT",
      message: DECIDE_MESSAGES.decided,
    });
    const { user } = renderPage();
    const card = await findCard("[UNIT_TEST]保守契約");
    await user.click(within(card).getByRole("button", { name: REJECT_NAME }));
    const dialog = await screen.findByRole("dialog", { name: "却下の理由" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "理由" }),
      "理由",
    );
    await user.click(within(dialog).getByRole("button", { name: "却下する" }));
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("alert")
          .some((a) => a.textContent?.includes(DECIDE_MESSAGES.decided)),
      ).toBe(true),
    );
  });
});

// #146 レビュー1回目（軽微）：422 の fields は、該当の入力欄に関連付ける（Skill「frontend-state」）。ダイアログは開いたまま・入力は残す。
// fields に該当のない失敗（409 など）は、これまでどおり一覧の上に出してダイアログを閉じる（上のテスト）。
function describedText(element: HTMLElement): string {
  const ids = (element.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter((id) => id !== "");
  return ids
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

describe("#146 レビュー1回目（軽微）：承認・却下の 422 を該当の欄に出す", () => {
  const CANDIDATE_MESSAGE = "追加の候補に、承認できない人が含まれています";
  const REASON_MESSAGE = "却下の理由を1〜200文字で入力してください";

  it("#146 error-api・5-3 AC-5: 承認で 422（additionalCandidateIds）なら、ダイアログは開いたまま・足した候補の選択は残り、候補の欄が aria-invalid になってエラーが説明として関連付く", async () => {
    respondChoices();
    respondReviewCaseRequests([target]);
    const sent = failPost(`/api/case-requests/${target.id}/approve`, 422, {
      code: "VALIDATION_ERROR",
      message: CANDIDATE_MESSAGE,
      fields: ["additionalCandidateIds"],
    });
    const { user } = renderPage();
    const card = await findCard("[UNIT_TEST]保守契約");
    await user.click(within(card).getByRole("button", { name: APPROVE_NAME }));
    const dialog = await screen.findByRole("dialog", {
      name: "案件の作成の承認",
    });
    const search = within(dialog).getByRole("textbox", { name: "候補の検索" });
    await user.type(search, "testuser");
    await user.click(
      await within(dialog).findByRole("button", {
        name: `${CANDIDATE.displayName}を追加`,
      }),
    );
    await user.click(within(dialog).getByRole("button", { name: "承認する" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    await waitFor(() =>
      expect(
        within(dialog)
          .getByRole("textbox", { name: "候補の検索" })
          .getAttribute("aria-invalid"),
      ).toBe("true"),
    );
    expect(
      describedText(
        within(dialog).getByRole("textbox", { name: "候補の検索" }),
      ),
    ).toContain(CANDIDATE_MESSAGE);
    // ダイアログは開いたままで、足した候補の選択も残る
    expect(
      screen.getByRole("dialog", { name: "案件の作成の承認" }),
    ).toBeTruthy();
    expect(within(dialog).getByText(CANDIDATE.displayName)).toBeTruthy();
    expect(
      within(dialog).getByRole("button", {
        name: `${CANDIDATE.displayName}を外す`,
      }),
    ).toBeTruthy();
  });

  it("#146 error-api・5-3 AC-6: 却下で 422（reason）なら、ダイアログは開いたまま・入力した理由は残り、理由の欄が aria-invalid になってエラーが説明として関連付く", async () => {
    respondReviewCaseRequests([target]);
    const sent = failPost(`/api/case-requests/${target.id}/reject`, 422, {
      code: "VALIDATION_ERROR",
      message: REASON_MESSAGE,
      fields: ["reason"],
    });
    const { user } = renderPage();
    const card = await findCard("[UNIT_TEST]保守契約");
    await user.click(within(card).getByRole("button", { name: REJECT_NAME }));
    const dialog = await screen.findByRole("dialog", { name: "却下の理由" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "理由" }),
      "件名を見直してください",
    );
    await user.click(within(dialog).getByRole("button", { name: "却下する" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    await waitFor(() =>
      expect(
        within(dialog)
          .getByRole("textbox", { name: "理由" })
          .getAttribute("aria-invalid"),
      ).toBe("true"),
    );
    const reasonInput = within(dialog).getByRole("textbox", { name: "理由" });
    expect(describedText(reasonInput)).toContain(REASON_MESSAGE);
    expect((reasonInput as HTMLTextAreaElement).value).toBe(
      "件名を見直してください",
    );
    expect(screen.getByRole("dialog", { name: "却下の理由" })).toBeTruthy();
  });

  it("#146 error-api: 承認の 422 で fields に additionalCandidateIds がないとき（別の欄名）は、これまでどおり確認を閉じて一覧の上に出す", async () => {
    respondReviewCaseRequests([target]);
    failPost(`/api/case-requests/${target.id}/approve`, 422, {
      code: "VALIDATION_ERROR",
      message: "入力が正しくありません",
      fields: ["unknownField"],
    });
    const { user } = renderPage();
    const card = await findCard("[UNIT_TEST]保守契約");
    await user.click(within(card).getByRole("button", { name: APPROVE_NAME }));
    const dialog = await screen.findByRole("dialog", {
      name: "案件の作成の承認",
    });
    await user.click(within(dialog).getByRole("button", { name: "承認する" }));
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("alert")
          .some((a) => a.textContent?.includes("入力が正しくありません")),
      ).toBe(true),
    );
    expect(
      screen.queryByRole("dialog", { name: "案件の作成の承認" }),
    ).toBeNull();
  });
});
