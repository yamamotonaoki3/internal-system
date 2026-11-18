// #147（147-B）5-1 AC-17・AC-21（Q6）、画面 S-17 のヘッダーの「納期を変更」。API は MSW で返す。データはすべて架空。
// この層で確かめるもの（計画 147-B の「画面」の納期の行）：canEditDueDate による出し分け（非参加の管理者にも出す）・日付の入力（下限は日本時間の今日）・
//   「未定に戻す」・422 は欄のエラー・変更中の二重送信の防止・成功の後に概要を取り直すこと。
// 編集できる人の判定（認可）はサーバー（backend/src/routes/cases.participants.test.ts）で確かめ、ここでは重ねない。
// 画面の契約（実装の担当へ。テストが決めたもの）：
//  - 概要の canEditDueDate が真のときだけ、ヘッダーにボタン「納期を変更」を出す（参加者でなくても）
//  - 押すと、ダイアログ（名前「納期の変更」）を開く。日付の入力欄「納期」（type=date、min は日本時間の今日、今の納期を初期値にする）・
//    ボタン「保存する」「未定に戻す」「キャンセル」
//  - 「保存する」は PATCH /api/cases/:caseId/due-date に { dueDate: "YYYY-MM-DD" }、「未定に戻す」は { dueDate: null } を送る
//  - 成功でダイアログを閉じ、案件のキャッシュ（caseKeys.all）を取り直す。422 は「納期」の欄のエラー（aria-invalid・aria-describedby）
//  - 送信中は「保存する」「未定に戻す」を押せない
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  caseDetail,
  caseId,
  caseSummary,
  outsiderSummary,
  respondCaseWrites,
  respondCases,
  type CaseSummary,
} from "../test/case-handlers";
import { renderCaseRequestScreen } from "../test/case-request-handlers";
import { CaseDetailPage } from "./CaseDetailPage";

const N = 22;
const PAST_MESSAGE = "納期は今日以降の日付を入力してください（[UNIT_TEST]）";

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function renderPage(summary: CaseSummary) {
  const calls = respondCases({
    summaries: [summary],
    details: summary.isParticipant ? [caseDetail(N, summary)] : [],
  });
  const rendered = renderCaseRequestScreen(<CaseDetailPage />, {
    at: `/cases/${caseId(N)}`,
    path: "/cases/:caseId",
  });
  return { ...rendered, ...calls };
}

const dueInput = (dialog: HTMLElement) =>
  within(dialog).getByLabelText<HTMLInputElement>("納期");

async function openDialog(user: ReturnType<typeof renderPage>["user"]) {
  await user.click(await screen.findByRole("button", { name: "納期を変更" }));
  return screen.findByRole("dialog", { name: "納期の変更" });
}

function describedText(input: HTMLElement): string {
  return (input.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter((id) => id !== "")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("#147 147-B S-17 納期の変更の入口", () => {
  it("#147 5-1 AC-17: canEditDueDate が偽なら「納期を変更」を出さない", async () => {
    renderPage(caseSummary(N, { canEditDueDate: false }));
    await screen.findByRole("list", { name: "参加者" });
    expect(screen.queryByRole("button", { name: "納期を変更" })).toBeNull();
  });

  it("#147 5-1 AC-17: 参加者で canEditDueDate が真なら「納期を変更」を出す", async () => {
    renderPage(caseSummary(N, { canEditDueDate: true }));
    expect(
      await screen.findByRole("button", { name: "納期を変更" }),
    ).toBeTruthy();
  });

  it("#147 5-1 AC-21（Q6）: 参加していない管理の資格のある人も、canEditDueDate が真なら概要の画面から「納期を変更」を使える", async () => {
    renderPage(
      outsiderSummary(N, {
        canManage: true,
        participantCount: 3,
        canEditDueDate: true,
      }),
    );
    await screen.findByText("参加者だけが見られます（非公開）");
    expect(screen.getByRole("button", { name: "納期を変更" })).toBeTruthy();
  });
});

describe("#147 147-B 5-1 AC-17: 納期の変更", () => {
  it("#147 AC-17・C-125: 納期の欄の初期値は今の納期で、下限は日本時間の今日（UTC ではまだ前日の時刻でも）", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T15:30:00.000Z"));
    const { user } = renderPage(caseSummary(N, { dueDate: "2026-12-01" }));
    const dialog = await openDialog(user);
    expect(dueInput(dialog).type).toBe("date");
    expect(dueInput(dialog).value).toBe("2026-12-01");
    expect(dueInput(dialog).min).toBe("2026-11-17");
  });

  it("#147 AC-17: 日付を選んで「保存する」で PATCH { dueDate } を1回送り、ダイアログを閉じ、概要を取り直す", async () => {
    const { writes } = respondCaseWrites();
    const { user, summaryCalls } = renderPage(
      caseSummary(N, { dueDate: null }),
    );
    const dialog = await openDialog(user);
    fireEvent.change(dueInput(dialog), { target: { value: "2026-12-24" } });
    const callsBefore = summaryCalls.length;
    await user.click(within(dialog).getByRole("button", { name: "保存する" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "納期の変更" })).toBeNull(),
    );
    expect(writes).toEqual([
      {
        method: "PATCH",
        path: `/api/cases/${caseId(N)}/due-date`,
        body: { dueDate: "2026-12-24" },
      },
    ]);
    await waitFor(() =>
      expect(summaryCalls.length).toBeGreaterThan(callsBefore),
    );
  });

  it("#147 AC-17: 「未定に戻す」で PATCH { dueDate: null } を送る", async () => {
    const { writes } = respondCaseWrites();
    const { user } = renderPage(caseSummary(N, { dueDate: "2026-12-01" }));
    const dialog = await openDialog(user);
    await user.click(
      within(dialog).getByRole("button", { name: "未定に戻す" }),
    );
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.body).toEqual({ dueDate: null });
  });

  it("#147 AC-17: 今日より前の日付は、納期の欄のエラーにする（サーバーの 422 も欄に出す）", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T03:00:00.000Z"));
    respondCaseWrites(() =>
      HttpResponse.json(
        {
          code: "VALIDATION_ERROR",
          message: PAST_MESSAGE,
          fields: ["dueDate"],
        },
        { status: 422 },
      ),
    );
    const { user } = renderPage(caseSummary(N, { dueDate: null }));
    const dialog = await openDialog(user);
    fireEvent.change(dueInput(dialog), { target: { value: "2026-11-16" } });
    await user.click(within(dialog).getByRole("button", { name: "保存する" }));
    await waitFor(() =>
      expect(dueInput(dialog).getAttribute("aria-invalid")).toBe("true"),
    );
    expect(describedText(dueInput(dialog))).not.toBe("");
    expect(screen.getByRole("dialog", { name: "納期の変更" })).toBeTruthy();
  });

  it("#147 AC-17: サーバーの 422 の文言を、納期の欄のエラーとして出す", async () => {
    respondCaseWrites(() =>
      HttpResponse.json(
        {
          code: "VALIDATION_ERROR",
          message: PAST_MESSAGE,
          fields: ["dueDate"],
        },
        { status: 422 },
      ),
    );
    const { user } = renderPage(caseSummary(N, { dueDate: null }));
    const dialog = await openDialog(user);
    fireEvent.change(dueInput(dialog), { target: { value: "2027-01-05" } });
    await user.click(within(dialog).getByRole("button", { name: "保存する" }));
    await waitFor(() =>
      expect(describedText(dueInput(dialog))).toContain(PAST_MESSAGE),
    );
    expect(dueInput(dialog).getAttribute("aria-invalid")).toBe("true");
  });

  it("#147 二重送信の防止: 応答を待つ間は「保存する」「未定に戻す」を押せず、送るのは1回だけ", async () => {
    const gate = deferred();
    const { writes } = respondCaseWrites(async () => {
      await gate.promise;
      return HttpResponse.json({ caseId: caseId(N), dueDate: "2026-12-24" });
    });
    const { user } = renderPage(caseSummary(N, { dueDate: null }));
    const dialog = await openDialog(user);
    fireEvent.change(dueInput(dialog), { target: { value: "2026-12-24" } });
    const save = within(dialog).getByRole("button", { name: "保存する" });
    await user.click(save);
    await waitFor(() => expect(writes).toHaveLength(1));
    const reset = within(dialog).getByRole("button", { name: "未定に戻す" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect((reset as HTMLButtonElement).disabled).toBe(true);
    await user.click(save);
    expect(writes).toHaveLength(1);
    gate.release();
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "納期の変更" })).toBeNull(),
    );
  });
});
