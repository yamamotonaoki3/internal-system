// #147（147-A）5-1 AC-2・AC-14・AC-17・AC-19・AC-21（Q6）、C-142(1)、画面 S-17（骨格）：案件の詳細。API は MSW で返す。データはすべて架空。
// この層で確かめるもの（計画 147-A のテストケース）：参加者の表示（ヘッダー・説明・参加者の一覧と「作成者」「退職者」）・
//   非参加者の「参加者だけが見られます（非公開）」（詳細を取らない）・存在しない案件・外された後（詳細が 403）に前の内容を残さないこと。
// 見える範囲の認可はサーバー（routes/cases.test.ts）で確かめ、ここでは重ねない。
// 画面の契約（実装の担当へ。テストが決めたもの）：
//  - pages/CaseDetailPage.tsx が CaseDetailPage を名前付きで出す（ルート /cases/:caseId）
//  - まず概要（GET /api/cases/:caseId）を取り、isParticipant が true のときだけ詳細（GET /api/cases/:caseId/detail）を取る
//  - 見出し（h1）は件名。ヘッダーに案件番号・取引先（無効なら「（無効）」）・担当部署・状態・納期・「参加者 N人」（participantCount が null でないとき）
//  - 参加者には説明と、参加者の一覧（list「参加者」）。各行に表示名・部署名、作成者には「作成者」、無効の人には「退職者」
//  - 非参加者・詳細が 403 のときは「参加者だけが見られます（非公開）」を出し、説明・参加者の一覧を出さない
//  - 概要が 404 のときは「案件が見つかりません」
//  - やり取り・TODO・添付のタブは置かない
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  CASE_CLIENT,
  CASE_DEPT_SALES,
  CASE_TEXTS,
  PARTICIPANT_CREATOR,
  PARTICIPANT_RETIRED,
  caseDetail,
  caseId,
  caseNumberOf,
  caseSummary,
  caseTitle,
  outsiderSummary,
  respondCases,
} from "../test/case-handlers";
import { renderCaseRequestScreen } from "../test/case-request-handlers";
import { CaseDetailPage } from "./CaseDetailPage";

function renderPage(n: number) {
  return renderCaseRequestScreen(<CaseDetailPage />, {
    at: `/cases/${caseId(n)}`,
    path: "/cases/:caseId",
  });
}

describe("#147 S-17 参加者の表示", () => {
  it("#147 5-1 AC-2・AC-17・AC-19: 参加者には、件名の見出し・案件番号・取引先・担当部署・状態・納期・「参加者 N人」と説明を出す", async () => {
    const summary = caseSummary(1, { participantCount: 2 });
    respondCases({ summaries: [summary], details: [caseDetail(1)] });
    renderPage(1);
    expect(
      await screen.findByRole("heading", { level: 1, name: caseTitle(1) }),
    ).toBeTruthy();
    expect(await screen.findByText("[UNIT_TEST]147A案件1の説明")).toBeTruthy();
    const body = document.body.textContent ?? "";
    for (const text of [
      caseNumberOf(1),
      CASE_CLIENT.name,
      CASE_DEPT_SALES.name,
      "進行中",
      "2026-12-01",
      "参加者 2人",
    ])
      expect(body).toContain(text);
    expect(screen.queryByText(CASE_TEXTS.participantsOnly)).toBeNull();
  });

  it("#147 5-1 AC-2・C-142(1): 参加者の一覧に、表示名・部署名を出し、作成者に「作成者」、無効の人に「退職者」を付ける", async () => {
    respondCases({ summaries: [caseSummary(1)], details: [caseDetail(1)] });
    renderPage(1);
    const list = await screen.findByRole("list", { name: "参加者" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    const creator = rows.find((row) =>
      row.textContent?.includes(PARTICIPANT_CREATOR.displayName),
    );
    const retired = rows.find((row) =>
      row.textContent?.includes(PARTICIPANT_RETIRED.displayName),
    );
    expect(creator?.textContent).toContain(PARTICIPANT_CREATOR.departmentName);
    expect(creator?.textContent).toContain("作成者");
    expect(creator?.textContent).not.toContain("退職者");
    expect(retired?.textContent).toContain(PARTICIPANT_RETIRED.departmentName);
    expect(retired?.textContent).toContain("退職者");
    expect(retired?.textContent).not.toContain("作成者");
  });

  it("#147 Q7・#148・#149: やり取り・TODO・添付のタブを置かない", async () => {
    respondCases({ summaries: [caseSummary(1)], details: [caseDetail(1)] });
    renderPage(1);
    await screen.findByRole("list", { name: "参加者" });
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryByText("TODO")).toBeNull();
  });
});

describe("#147 5-1 AC-14 非参加者の表示", () => {
  it("#147 5-1 AC-14・AC-2: 非参加者には概要の項目と「参加者だけが見られます（非公開）」を出し、詳細を取らない", async () => {
    const { detailCalls, summaryCalls } = respondCases({
      summaries: [outsiderSummary(3)],
      details: [caseDetail(3)],
    });
    renderPage(3);
    expect(await screen.findByText(CASE_TEXTS.participantsOnly)).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 1, name: caseTitle(3) }),
    ).toBeTruthy();
    const body = document.body.textContent ?? "";
    for (const text of [caseNumberOf(3), CASE_CLIENT.name, "2026-12-01"])
      expect(body).toContain(text);
    expect(body).not.toContain("参加者 ");
    expect(screen.queryByText("[UNIT_TEST]147A案件3の説明")).toBeNull();
    expect(screen.queryByRole("list", { name: "参加者" })).toBeNull();
    expect(summaryCalls).toEqual([caseId(3)]);
    expect(detailCalls).toEqual([]);
  });

  it("#147 5-1 AC-21（Q6）: 参加していない管理の資格のある人には「参加者 N人」も出すが、説明・参加者の一覧は出さない", async () => {
    const { detailCalls } = respondCases({
      summaries: [outsiderSummary(4, { canManage: true, participantCount: 5 })],
    });
    renderPage(4);
    expect(await screen.findByText(CASE_TEXTS.participantsOnly)).toBeTruthy();
    expect(document.body.textContent).toContain("参加者 5人");
    expect(screen.queryByRole("list", { name: "参加者" })).toBeNull();
    expect(detailCalls).toEqual([]);
  });

  it("#147 5-1 AC-14・同時の操作: 概要では参加者でも、詳細が 403（外された）なら「参加者だけが見られます（非公開）」を出し、説明・参加者を出さない", async () => {
    respondCases({
      summaries: [caseSummary(5)],
      details: [caseDetail(5)],
      denied: [caseId(5)],
    });
    renderPage(5);
    expect(await screen.findByText(CASE_TEXTS.participantsOnly)).toBeTruthy();
    expect(screen.queryByText("[UNIT_TEST]147A案件5の説明")).toBeNull();
    expect(screen.queryByRole("list", { name: "参加者" })).toBeNull();
  });
});

describe("#147 S-17 存在しない案件", () => {
  it("#147 判定の順: 概要が 404 のときは「案件が見つかりません」を出し、詳細を取らない", async () => {
    const { detailCalls } = respondCases();
    renderPage(9);
    expect(await screen.findByText(CASE_TEXTS.notFound)).toBeTruthy();
    await waitFor(() => expect(detailCalls).toEqual([]));
    expect(screen.queryByText(CASE_TEXTS.participantsOnly)).toBeNull();
  });
});
