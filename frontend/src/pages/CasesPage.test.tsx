// #147（147-A）5-1 AC-2・AC-4・AC-12・AC-17・AC-19、画面 S-16：案件の一覧。API は MSW で返す。データはすべて架空。
// この層で確かめるもの（計画 147-A のテストケース）：切り替えの4つの組み合わせと送るクエリ・4つの状態（読み込み中・エラー・0件・あり）・0件の文言・
//   行の項目（参加している行の「参加者 N人」、非参加の行は概要だけ）・無効の印・次のページ・「案件の作成を申請」。
// 見える範囲の認可はサーバー（routes/cases.test.ts）で確かめ、ここでは重ねない。
// 画面の契約（実装の担当へ。テストが決めたもの）：
//  - pages/CasesPage.tsx が CasesPage を名前付きで出す。見出し（h1）「案件一覧」
//  - 切り替えはラジオボタン：まとまり（radiogroup）「表示する案件」に「自分が参加する案件」（既定）・「すべての案件」、
//    まとまり（radiogroup）「状態」に「進行中」（既定）・「終了した案件」。GET /api/cases?scope=joined|all&status=active|closed
//  - 案件は listitem のカード：件名のリンク（名前は件名。/cases/:caseId）・案件番号・取引先名（無効なら「（無効）」）・担当部署（「・」でつなぐ）・
//    納期（YYYY-MM-DD）・状態（「進行中」「終了」）。participantCount が null でない行にだけ「参加者 N人」
//  - 読み込み中は「読み込み中です」、失敗は role=alert、0件は「参加している案件はありません」（参加・進行中）／「案件はありません」（すべて・進行中）／
//    「終了した案件はありません」（終了）
//  - 続きは「次のページ」のボタン。「案件の作成を申請」のリンクで /case-requests へ
import { screen, waitFor, within } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import {
  CASE_CLIENT,
  CASE_DEPT_DEV,
  CASE_DEPT_SALES,
  CASE_TEXTS,
  caseId,
  caseNumberOf,
  caseSummary,
  caseTitle,
  outsiderSummary,
  respondCases,
} from "../test/case-handlers";
import { renderCaseRequestScreen } from "../test/case-request-handlers";
import { server } from "../test/server";
import { CasesPage } from "./CasesPage";

function renderPage() {
  return renderCaseRequestScreen(<CasesPage />, {
    at: "/cases",
    path: "/cases",
  });
}

async function findCard(title: string) {
  const link = await screen.findByRole("link", { name: title });
  const card = link.closest("li");
  if (card === null) throw new Error(`${title} のカードがありません`);
  return card;
}

const radio = (name: string) => screen.getByRole("radio", { name });

describe("#147 S-16 切り替えと送るクエリ", () => {
  it("#147 5-1 AC-4・AC-12: 既定は「自分が参加する案件」「進行中」で、scope=joined&status=active を取る", async () => {
    const { queries } = respondCases({
      lists: { "joined:active": [caseSummary(1)] },
    });
    renderPage();
    expect(
      await screen.findByRole("heading", { level: 1, name: "案件一覧" }),
    ).toBeTruthy();
    await findCard(caseTitle(1));
    expect((radio("自分が参加する案件") as HTMLInputElement).checked).toBe(
      true,
    );
    expect((radio("進行中") as HTMLInputElement).checked).toBe(true);
    expect(
      within(
        screen.getByRole("radiogroup", { name: "表示する案件" }),
      ).getAllByRole("radio"),
    ).toHaveLength(2);
    expect(
      within(screen.getByRole("radiogroup", { name: "状態" })).getAllByRole(
        "radio",
      ),
    ).toHaveLength(2);
    expect(queries[0]?.get("scope")).toBe("joined");
    expect(queries[0]?.get("status")).toBe("active");
  });

  it.each([
    ["すべての案件", "進行中", "all", "active", 2],
    ["自分が参加する案件", "終了した案件", "joined", "closed", 3],
    ["すべての案件", "終了した案件", "all", "closed", 4],
  ] as const)(
    "#147 5-1 AC-4・AC-12: 「%s」「%s」を選ぶと scope=%s&status=%s を取り、その一覧を出す",
    async (scopeLabel, statusLabel, scope, status, n) => {
      const { queries } = respondCases({
        lists: {
          "joined:active": [caseSummary(1)],
          [`${scope}:${status}`]: [
            caseSummary(n, {
              status,
              isParticipant: scope === "joined",
            }),
          ],
        },
      });
      const { user } = renderPage();
      await findCard(caseTitle(1));
      await user.click(radio(scopeLabel));
      await user.click(radio(statusLabel));
      await findCard(caseTitle(n));
      await waitFor(() =>
        expect(screen.queryByRole("link", { name: caseTitle(1) })).toBeNull(),
      );
      const last = queries.at(-1);
      expect(last?.get("scope")).toBe(scope);
      expect(last?.get("status")).toBe(status);
    },
  );
});

describe("#147 S-16 4つの状態と0件の文言", () => {
  it("#147 S-16: 読み込み中は「読み込み中です」を出す", async () => {
    server.use(
      http.get("/api/cases", async () => {
        await delay("infinite");
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    renderPage();
    expect(await screen.findByText(CASE_TEXTS.loading)).toBeTruthy();
  });

  it("#147 S-16: 取得に失敗したら role=alert を出し、案件を出さない", async () => {
    server.use(
      http.get("/api/cases", () =>
        HttpResponse.json(
          { code: "INTERNAL_ERROR", message: "サーバーでエラーが発生しました" },
          { status: 500 },
        ),
      ),
    );
    renderPage();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it.each([
    [null, null, CASE_TEXTS.emptyJoined],
    ["すべての案件", null, CASE_TEXTS.emptyAll],
    [null, "終了した案件", CASE_TEXTS.emptyClosed],
    ["すべての案件", "終了した案件", CASE_TEXTS.emptyClosed],
  ] as const)(
    "#147 S-16: 0件のとき（表示する案件：%s、状態：%s）は「%s」を出す",
    async (scopeLabel, statusLabel, text) => {
      respondCases();
      const { user } = renderPage();
      expect(await screen.findByText(CASE_TEXTS.emptyJoined)).toBeTruthy();
      if (scopeLabel !== null) await user.click(radio(scopeLabel));
      if (statusLabel !== null) await user.click(radio(statusLabel));
      expect(await screen.findByText(text)).toBeTruthy();
      // ほかの0件の文言と取り違えていない
      for (const other of [
        CASE_TEXTS.emptyJoined,
        CASE_TEXTS.emptyAll,
        CASE_TEXTS.emptyClosed,
      ].filter((t) => t !== text))
        expect(screen.queryByText(other)).toBeNull();
    },
  );
});

describe("#147 S-16 行の項目", () => {
  it("#147 5-1 AC-2・AC-17・AC-19: 参加している行に、件名のリンク・案件番号・取引先・担当部署（「・」でつなぐ）・納期・状態・「参加者 N人」を出す", async () => {
    respondCases({
      lists: {
        "joined:active": [
          caseSummary(1, {
            departments: [
              { ...CASE_DEPT_SALES, isActive: true },
              { ...CASE_DEPT_DEV, isActive: true },
            ],
            participantCount: 3,
          }),
        ],
      },
    });
    renderPage();
    const card = await findCard(caseTitle(1));
    expect(
      within(card)
        .getByRole("link", { name: caseTitle(1) })
        .getAttribute("href"),
    ).toBe(`/cases/${caseId(1)}`);
    for (const text of [
      caseNumberOf(1),
      CASE_CLIENT.name,
      `${CASE_DEPT_SALES.name}・${CASE_DEPT_DEV.name}`,
      "2026-12-01",
      "進行中",
      "参加者 3人",
    ])
      expect(card.textContent).toContain(text);
  });

  it("#147 5-1 AC-2・AC-4: 「すべての案件」の非参加の行は概要の項目だけで、「参加者」の表示を出さない", async () => {
    respondCases({
      lists: {
        "all:active": [outsiderSummary(5, { title: "[UNIT_TEST]147A非参加" })],
      },
    });
    const { user } = renderPage();
    await user.click(radio("すべての案件"));
    const card = await findCard("[UNIT_TEST]147A非参加");
    for (const text of [
      caseNumberOf(5),
      CASE_CLIENT.name,
      CASE_DEPT_SALES.name,
    ])
      expect(card.textContent).toContain(text);
    expect(card.textContent).not.toContain("参加者");
  });

  it("#147 5-1 AC-21（Q6）: 参加していなくても participantCount がある行（管理の資格）には「参加者 N人」を出す", async () => {
    respondCases({
      lists: {
        "all:active": [
          outsiderSummary(6, { canManage: true, participantCount: 4 }),
        ],
      },
    });
    const { user } = renderPage();
    await user.click(radio("すべての案件"));
    const card = await findCard(caseTitle(6));
    expect(card.textContent).toContain("参加者 4人");
  });

  it("#147 5-1 AC-19・C-120: 無効な取引先・担当部署には「（無効）」の印を付ける。納期がない行は日付を出さない", async () => {
    respondCases({
      lists: {
        "joined:active": [
          caseSummary(7, {
            client: { ...CASE_CLIENT, isActive: false },
            departments: [{ ...CASE_DEPT_DEV, isActive: false }],
            dueDate: null,
          }),
        ],
      },
    });
    renderPage();
    const card = await findCard(caseTitle(7));
    expect(card.textContent).toContain(`${CASE_CLIENT.name}（無効）`);
    expect(card.textContent).toContain(`${CASE_DEPT_DEV.name}（無効）`);
    expect(card.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("#147 S-16: 終了した案件の行の状態は「終了」", async () => {
    respondCases({
      lists: {
        "joined:closed": [caseSummary(8, { status: "closed" })],
      },
    });
    const { user } = renderPage();
    await user.click(radio("終了した案件"));
    const card = await findCard(caseTitle(8));
    expect(card.textContent).toContain("終了");
    expect(card.textContent).not.toContain("進行中");
  });
});

describe("#147 S-16 続きと申請の入口", () => {
  it("#147 project-rules（一覧）: 「次のページ」で続きを取り、前のページの行に足して出す", async () => {
    const { queries } = respondCases({
      lists: { "joined:active": [caseSummary(2)] },
      nextPages: { "joined:active": [caseSummary(1)] },
    });
    const { user } = renderPage();
    await findCard(caseTitle(2));
    await user.click(screen.getByRole("button", { name: "次のページ" }));
    await findCard(caseTitle(1));
    expect(screen.getByRole("link", { name: caseTitle(2) })).toBeTruthy();
    expect(queries.at(-1)?.get("cursor")).toBe("page-2");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "次のページ" })).toBeNull(),
    );
  });

  it("#147 S-16: 「案件の作成を申請」のリンクは /case-requests を指す", async () => {
    respondCases();
    renderPage();
    const link = await screen.findByRole("link", { name: "案件の作成を申請" });
    expect(link.getAttribute("href")).toBe("/case-requests");
  });
});
