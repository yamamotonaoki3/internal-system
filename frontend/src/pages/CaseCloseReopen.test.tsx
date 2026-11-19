// #150（150-A）5-1 AC-9・AC-10（C-142(2)）、画面 S-17 の「案件を終了」「案件を再開」と確認のダイアログ。API は MSW で返す。データはすべて架空。
// この層で確かめるもの（計画 150-A 10章の「画面」の行・6.6）：
//   - 有効な参加者（概要の isParticipant）にだけ、進行中なら「案件を終了」、終了中なら「案件を再開」を出す。非参加者（管理の資格のある人を含む）には出さない（R-77）
//   - 確認のダイアログの文言。キャンセルでは送らない（再開のダイアログは 150-B で参加者の選び直しになった。「確認へ」の後に確かめる段階の文言を出す。
//     詳しくは CaseReopenReselect.test.tsx）
//   - 送信中は確定もキャンセルも押せず、二重に送らない
//   - 成功：ダイアログの外に「案件を終了しました」「案件を再開しました」を出し、概要を取り直してボタンが入れ替わる（文言は残る）
//   - 409・403：サーバーの文言をダイアログの外に出し、概要を取り直す
// 認可・判定の順はサーバー（backend の routes/cases.close.test.ts）で確かめ、ここでは重ねない。
// 画面の契約（実装の担当へ。計画 150-A 6.6 から決めたもの）：
//   ボタン「案件を終了」「案件を再開」。ダイアログの名前「案件の終了」「案件の再開」、確定「終了する」「再開する」、「キャンセル」。
//   POST /api/cases/:caseId/close（本文なし）・/reopen（150-B から本文 { participantIds, addUserIds, removeUserIds }）。成功の応答は { caseId, status }。
import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse, type HttpResponseResolver } from "msw";
import { describe, expect, it } from "vitest";
import {
  caseDetail,
  caseId,
  caseSummary,
  outsiderSummary,
  respondCases,
  type CaseDetail,
  type CaseSummary,
} from "../test/case-handlers";
import { renderCaseRequestScreen } from "../test/case-request-handlers";
import { server } from "../test/server";
import { CaseDetailPage } from "./CaseDetailPage";

const TEXTS = {
  close: "案件を終了",
  reopen: "案件を再開",
  closeDialog: "案件の終了",
  reopenDialog: "案件の再開",
  closeBody:
    "終了すると、メッセージ・参加者・納期は読み取り専用になります。参加者は、いつでも再開できます。",
  // 150-B（決定 Q5）で再開のダイアログは参加者の選び直しになり、確かめる段階の文言に置き換わった
  reopenShare:
    "再開すると、追加した人にも、これまでのメッセージ・TODO・添付が共有されます。外れた人は、この案件の内容を見られなくなります。",
  reopenNext: "確認へ",
  closeConfirm: "終了する",
  reopenConfirm: "再開する",
  closed: "案件を終了しました",
  reopened: "案件を再開しました",
  alreadyClosed: "この案件はすでに終了しています",
  participantsOnly: "参加者だけが操作できます",
} as const;

type Write = { method: string; path: string; body: unknown };

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/**
 * 概要・詳細と、終了・再開の架空の応答。respond を省くと、サーバーの状態を切り替えて 200 { caseId, status } を返す。
 * サーバーの状態（state.summary・state.detail）は、取り直しの応答に反映される
 */
function world(
  n: number,
  initial: CaseSummary,
  respond?: (write: Write) => Response | Promise<Response>,
) {
  const summaries = [initial];
  const details: CaseDetail[] = initial.isParticipant
    ? [caseDetail(n, initial)]
    : [];
  const calls = respondCases({ summaries, details });
  const writes: Write[] = [];
  const setStatus = (status: "active" | "closed") => {
    summaries[0] = { ...(summaries[0] as CaseSummary), status };
    if (details[0] !== undefined) details[0] = { ...details[0], status };
  };
  const handle =
    (status: "active" | "closed"): HttpResponseResolver =>
    async ({ request }) => {
      const text = await request.text();
      const write: Write = {
        method: request.method,
        path: new URL(request.url).pathname,
        body: text === "" ? undefined : (JSON.parse(text) as unknown),
      };
      writes.push(write);
      if (respond !== undefined) return respond(write);
      setStatus(status);
      return HttpResponse.json({ caseId: caseId(n), status });
    };
  server.use(
    http.post("/api/cases/:caseId/close", handle("closed")),
    http.post("/api/cases/:caseId/reopen", handle("active")),
  );
  return { ...calls, writes, setStatus, summaries };
}

function renderPage(n: number) {
  return renderCaseRequestScreen(<CaseDetailPage />, {
    at: `/cases/${caseId(n)}`,
    path: "/cases/:caseId",
  });
}

const insideDialog = (element: HTMLElement) =>
  element.closest("dialog") !== null;

describe("#150 150-A S-17 終了・再開のボタンの出し分け", () => {
  it("#150 5-1 AC-9: 参加者で進行中なら「案件を終了」を出し、「案件を再開」は出さない", async () => {
    world(31, caseSummary(31));
    renderPage(31);
    expect(
      await screen.findByRole("button", { name: TEXTS.close }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: TEXTS.reopen })).toBeNull();
  });

  it("#150 5-1 AC-10: 参加者で終了中なら「案件を再開」を出し、「案件を終了」は出さない", async () => {
    world(32, caseSummary(32, { status: "closed", canEditDueDate: false }));
    renderPage(32);
    expect(
      await screen.findByRole("button", { name: TEXTS.reopen }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: TEXTS.close })).toBeNull();
  });

  it.each([
    {
      name: "参加していない一般の社員（進行中）",
      summary: () => outsiderSummary(33),
    },
    {
      name: "参加していない全体管理者・担当部署のオーナー（進行中。R-77）",
      summary: () =>
        outsiderSummary(33, {
          canManage: true,
          participantCount: 3,
          canEditDueDate: true,
        }),
    },
    {
      name: "参加していない管理の資格のある人（終了中）",
      summary: () =>
        outsiderSummary(33, {
          status: "closed",
          canManage: true,
          participantCount: 3,
        }),
    },
  ])(
    "#150 5-1 AC-9・R-77: $name には、どちらのボタンも出さない",
    async ({ summary }) => {
      world(33, summary());
      renderPage(33);
      await screen.findByText("参加者だけが見られます（非公開）");
      expect(screen.queryByRole("button", { name: TEXTS.close })).toBeNull();
      expect(screen.queryByRole("button", { name: TEXTS.reopen })).toBeNull();
    },
  );
});

describe("#150 150-A 確認のダイアログ", () => {
  it("#150 5-1 AC-9・S-17: 「案件を終了」で確認のダイアログ「案件の終了」を開き、読み取り専用になる旨を出す。キャンセルでは送らない", async () => {
    const { writes } = world(34, caseSummary(34));
    const { user } = renderPage(34);
    await user.click(await screen.findByRole("button", { name: TEXTS.close }));
    const dialog = await screen.findByRole("dialog", {
      name: TEXTS.closeDialog,
    });
    expect(within(dialog).getByText(TEXTS.closeBody)).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: TEXTS.closeConfirm }),
    ).toBeTruthy();
    await user.click(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: TEXTS.closeDialog }),
      ).toBeNull(),
    );
    expect(writes).toEqual([]);
  });

  it("#150 5-1 AC-10・AC-16（150-B Q5）: 「案件を再開」で確認のダイアログ「案件の再開」を開き、「確認へ」の後に、過去の情報も共有される旨と「再開する」を出す", async () => {
    world(35, caseSummary(35, { status: "closed", canEditDueDate: false }));
    const { user } = renderPage(35);
    await user.click(await screen.findByRole("button", { name: TEXTS.reopen }));
    const dialog = await screen.findByRole("dialog", {
      name: TEXTS.reopenDialog,
    });
    await user.click(
      within(dialog).getByRole("button", { name: TEXTS.reopenNext }),
    );
    expect(within(dialog).getByText(TEXTS.reopenShare)).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: TEXTS.reopenConfirm }),
    ).toBeTruthy();
  });
});

describe("#150 150-A 終了・再開の送信と結果", () => {
  it("#150 5-1 AC-9: 「終了する」で POST /close を本文なしで1回送り、ダイアログを閉じ、「案件を終了しました」を出し、取り直しで「案件を再開」に入れ替わる", async () => {
    const { writes, summaryCalls } = world(36, caseSummary(36));
    const { user } = renderPage(36);
    await user.click(await screen.findByRole("button", { name: TEXTS.close }));
    const dialog = await screen.findByRole("dialog", {
      name: TEXTS.closeDialog,
    });
    const callsBefore = summaryCalls.length;
    await user.click(
      within(dialog).getByRole("button", { name: TEXTS.closeConfirm }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: TEXTS.closeDialog }),
      ).toBeNull(),
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]?.method).toBe("POST");
    expect(writes[0]?.path).toBe(`/api/cases/${caseId(36)}/close`);
    expect(writes[0]?.body ?? {}).toEqual({});
    await waitFor(() =>
      expect(summaryCalls.length).toBeGreaterThan(callsBefore),
    );
    expect(
      await screen.findByRole("button", { name: TEXTS.reopen }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: TEXTS.close })).toBeNull();
    // 取り直しでボタンが入れ替わっても、完了の表示は残る（ダイアログの外）
    const done = screen.getByText(TEXTS.closed);
    expect(insideDialog(done)).toBe(false);
  });

  it("#150 5-1 AC-10: 「確認へ」→「再開する」で POST /reopen を1回送り、「案件を再開しました」を出し、取り直しで「案件を終了」に入れ替わる", async () => {
    const { writes } = world(
      37,
      caseSummary(37, { status: "closed", canEditDueDate: false }),
    );
    const { user } = renderPage(37);
    await user.click(await screen.findByRole("button", { name: TEXTS.reopen }));
    const dialog = await screen.findByRole("dialog", {
      name: TEXTS.reopenDialog,
    });
    await user.click(
      within(dialog).getByRole("button", { name: TEXTS.reopenNext }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: TEXTS.reopenConfirm }),
    );
    expect(await screen.findByText(TEXTS.reopened)).toBeTruthy();
    expect(
      await screen.findByRole("button", { name: TEXTS.close }),
    ).toBeTruthy();
    expect(writes.map((w) => w.path)).toEqual([
      `/api/cases/${caseId(37)}/reopen`,
    ]);
  });

  it("#150 二重送信の防止: 応答を待つ間は「終了する」「キャンセル」を押せず、送るのは1回だけ", async () => {
    const gate = deferred();
    const n = 38;
    const { writes, setStatus } = world(n, caseSummary(n), async () => {
      await gate.promise;
      setStatus("closed");
      return HttpResponse.json({ caseId: caseId(n), status: "closed" });
    });
    const { user } = renderPage(n);
    await user.click(await screen.findByRole("button", { name: TEXTS.close }));
    const dialog = await screen.findByRole("dialog", {
      name: TEXTS.closeDialog,
    });
    const confirm = within(dialog).getByRole<HTMLButtonElement>("button", {
      name: TEXTS.closeConfirm,
    });
    await user.click(confirm);
    await waitFor(() => expect(writes).toHaveLength(1));
    const cancel = within(dialog).getByRole<HTMLButtonElement>("button", {
      name: "キャンセル",
    });
    expect(confirm.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
    await user.click(confirm);
    expect(writes).toHaveLength(1);
    gate.release();
    expect(await screen.findByText(TEXTS.closed)).toBeTruthy();
    expect(writes).toHaveLength(1);
  });

  it("#150 6.6: 409（ほかの人が先に終了した）なら、サーバーの文言をダイアログの外に出し、概要を取り直して「案件を再開」に切り替わる", async () => {
    const n = 39;
    const { setStatus, summaryCalls } = world(n, caseSummary(n), () => {
      setStatus("closed");
      return HttpResponse.json(
        {
          code: "CONFLICT",
          message: TEXTS.alreadyClosed,
          reason: "already_closed",
        },
        { status: 409 },
      );
    });
    const { user } = renderPage(n);
    await user.click(await screen.findByRole("button", { name: TEXTS.close }));
    const dialog = await screen.findByRole("dialog", {
      name: TEXTS.closeDialog,
    });
    const callsBefore = summaryCalls.length;
    await user.click(
      within(dialog).getByRole("button", { name: TEXTS.closeConfirm }),
    );
    await waitFor(() =>
      expect(
        screen
          .queryAllByText(TEXTS.alreadyClosed)
          .some((element) => !insideDialog(element)),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(summaryCalls.length).toBeGreaterThan(callsBefore),
    );
    expect(
      await screen.findByRole("button", { name: TEXTS.reopen }),
    ).toBeTruthy();
    expect(screen.queryByText(TEXTS.closed)).toBeNull();
  });

  it("#150 6.6: 403（外された後）なら、サーバーの文言をダイアログの外に出し、取り直しで非公開の表示になってもボタンは出さず、文言は残る", async () => {
    const n = 40;
    const { summaries, summaryCalls } = world(n, caseSummary(n), () => {
      summaries[0] = outsiderSummary(n);
      return HttpResponse.json(
        { code: "FORBIDDEN", message: TEXTS.participantsOnly },
        { status: 403 },
      );
    });
    const { user } = renderPage(n);
    await user.click(await screen.findByRole("button", { name: TEXTS.close }));
    const dialog = await screen.findByRole("dialog", {
      name: TEXTS.closeDialog,
    });
    const callsBefore = summaryCalls.length;
    await user.click(
      within(dialog).getByRole("button", { name: TEXTS.closeConfirm }),
    );
    await waitFor(() =>
      expect(summaryCalls.length).toBeGreaterThan(callsBefore),
    );
    expect(
      await screen.findByText("参加者だけが見られます（非公開）"),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        screen
          .queryAllByText(TEXTS.participantsOnly)
          .some((element) => !insideDialog(element)),
      ).toBe(true),
    );
    expect(screen.queryByRole("button", { name: TEXTS.close })).toBeNull();
    expect(screen.queryByRole("button", { name: TEXTS.reopen })).toBeNull();
  });
});
