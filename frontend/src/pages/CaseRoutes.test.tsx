// #147（147-A）5-1 AC-4・AC-5、C-179(3)、画面 S-16・S-17 の入口：App を通して描画し（枠のサイドバーを含む）、ルートと入口を確かめる。API は MSW で返す。データはすべて架空。
// この層で確かめるもの（計画 147-A のテストケース）：メニュー「案件」（全員）→ S-16 → S-17 の遷移、サイドバーの「案件」の下の参加中の案件、
//   自分の申請の承認済みの行の案件番号のリンク、S-29 で承認に成功した後に再読み込みなしで参加中の案件が取り直されること。
// 契約（実装の担当へ。テストが決めたもの）：
//  - App.tsx のレイアウトの子に /cases（CasesPage）と /cases/:caseId（CaseDetailPage）を足す。ログイン後の全員が開ける
//  - navigation.ts の「案件の申請」を「案件」（/cases。権限の条件なし）に置き換える
//  - サイドバー（nav「メインメニュー」）の「案件」の下に CaseSidebarSection を置き、GET /api/cases?scope=joined&status=active の案件を
//    リンク（名前に件名を含む。/cases/:caseId）で出す
//  - 自分の申請（MyCaseRequestList）の承認済みの行の案件番号は、/cases/:caseId へのリンク（名前に案件番号を含む）
//  - 承認の成功（useDecideCaseRequest）で caseKeys.all も取り直す（features/cases/index.ts から caseKeys を公開する）
import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installDomStubs,
  renderApp,
  respondShellUser,
  SHELL_USER,
  type DomStubs,
} from "../test/app-shell-harness";
import {
  APPROVE_PERMISSION,
  respondReviewCaseRequests,
  reviewCaseRequest,
} from "../test/case-approval-handlers";
import {
  caseDetail,
  caseId,
  caseNumberOf,
  caseSummary,
  caseTitle,
  outsiderSummary,
  respondCases,
  type CaseSummary,
} from "../test/case-handlers";
import {
  caseRequestItem,
  respondChoices,
  respondMyCaseRequests,
  respondProfileDepartment,
} from "../test/case-request-handlers";
import { server } from "../test/server";

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
});
afterEach(() => {
  stubs.restore();
});

const menu = () => screen.findByRole("navigation", { name: "メインメニュー" });
const path = () => screen.getByTestId("path").textContent;

describe("#147 メニューと S-16・S-17 のルート", () => {
  it("#147 5-1 AC-4（既定の方針9）: メニューの「案件の申請」は「案件」（/cases）に置き換わり、権限のない一般社員にも出る", async () => {
    respondShellUser();
    renderApp("/");
    const nav = await menu();
    const link = await within(nav).findByRole("link", { name: "案件" });
    expect(link.getAttribute("href")).toBe("/cases");
    expect(within(nav).queryByRole("link", { name: "案件の申請" })).toBeNull();
  });

  it("#147 5-1 AC-4・AC-14: 一般社員がメニュー「案件」→ S-16 の「すべての案件」→ 行の件名 → S-17 に移り、非参加なら非公開の表示になる", async () => {
    respondShellUser();
    respondCases({
      lists: { "all:active": [outsiderSummary(3)] },
      summaries: [outsiderSummary(3)],
    });
    const { user } = renderApp("/");
    const nav = await menu();
    await user.click(await within(nav).findByRole("link", { name: "案件" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "案件一覧" }),
    ).toBeTruthy();
    expect(path()).toBe("/cases");
    await user.click(screen.getByRole("radio", { name: "すべての案件" }));
    const main = screen.getByRole("main");
    await user.click(
      await within(main).findByRole("link", { name: caseTitle(3) }),
    );
    expect(
      await screen.findByText("参加者だけが見られます（非公開）"),
    ).toBeTruthy();
    expect(path()).toBe(`/cases/${caseId(3)}`);
  });
});

describe("#147 5-1 AC-5 サイドバーの参加中の案件", () => {
  it("#147 5-1 AC-5: サイドバーの「案件」の下に、参加している進行中の案件を出し（scope=joined&status=active）、押すと S-17 に移る", async () => {
    respondShellUser();
    const { queries } = respondCases({
      lists: { "joined:active": [caseSummary(1), caseSummary(2)] },
      summaries: [caseSummary(1)],
      details: [caseDetail(1)],
    });
    const { user } = renderApp("/");
    const nav = await menu();
    const first = await within(nav).findByRole("link", {
      name: new RegExp(caseTitle(1).replace(/[[\]]/g, "\\$&")),
    });
    expect(first.getAttribute("href")).toBe(`/cases/${caseId(1)}`);
    expect(
      within(nav)
        .getByRole("link", {
          name: new RegExp(caseTitle(2).replace(/[[\]]/g, "\\$&")),
        })
        .getAttribute("href"),
    ).toBe(`/cases/${caseId(2)}`);
    expect(
      queries.some(
        (q) => q.get("scope") === "joined" && q.get("status") === "active",
      ),
    ).toBe(true);
    await user.click(first);
    expect(
      await screen.findByRole("heading", { level: 1, name: caseTitle(1) }),
    ).toBeTruthy();
    expect(path()).toBe(`/cases/${caseId(1)}`);
  });

  it("#147 5-1 AC-5: サイドバーの参加中の案件が取得に失敗しても、枠全体は壊さず、ほかのメニューは使える", async () => {
    respondShellUser();
    server.use(
      http.get("/api/cases", () =>
        HttpResponse.json(
          { code: "INTERNAL_ERROR", message: "サーバーでエラーが発生しました" },
          { status: 500 },
        ),
      ),
    );
    renderApp("/");
    const nav = await menu();
    expect(await within(nav).findByRole("link", { name: "案件" })).toBeTruthy();
    expect(
      within(nav).getByRole("link", { name: "チャンネルを探す" }),
    ).toBeTruthy();
  });
});

describe("#147 C-179(3) 自分の申請と承認からの入口", () => {
  it("#147 C-179(3): 自分の申請の承認済みの行の案件番号は、その案件（/cases/:caseId）へのリンク", async () => {
    respondShellUser();
    respondChoices();
    respondProfileDepartment({
      id: "01JTESTCASEREQDEPTSALES01",
      name: "[UNIT_TEST]営業",
    });
    respondMyCaseRequests([
      caseRequestItem("9", {
        title: "[UNIT_TEST]147A承認済みの申請",
        status: "approved",
        caseId: caseId(9),
        caseNumber: caseNumberOf(9),
      }),
      caseRequestItem("8", { title: "[UNIT_TEST]147A審査中の申請" }),
    ]);
    renderApp("/case-requests");
    // ログイン状態の確認中の main は枠の main に置き換わるため、枠のメニューが出てから main を取る
    await screen.findByRole("navigation", { name: "メインメニュー" });
    const main = screen.getByRole("main");
    const link = await within(main).findByRole("link", {
      name: new RegExp(caseNumberOf(9)),
    });
    expect(link.getAttribute("href")).toBe(`/cases/${caseId(9)}`);
    // 審査中の行には案件へのリンクがない
    const pendingRow = within(main)
      .getAllByRole("listitem")
      .find((row) => row.textContent?.includes("[UNIT_TEST]147A審査中の申請"));
    expect(pendingRow).toBeDefined();
    expect(
      within(pendingRow as HTMLElement).queryByRole("link", {
        name: /QZA-/,
      }),
    ).toBeNull();
  });

  it("#147 計画 147-A（承認の後の更新）: S-29 で承認に成功すると、再読み込みなしで、サイドバーの参加中の案件が取り直されて新しい案件が出る", async () => {
    server.use(
      http.get("/api/auth/session", () =>
        HttpResponse.json({
          user: SHELL_USER,
          permissions: [APPROVE_PERMISSION],
          mustChangePassword: false,
          reauthenticatedAt: null,
        }),
      ),
    );
    const target = reviewCaseRequest("1", {
      title: "[UNIT_TEST]147A承認する申請",
    });
    respondReviewCaseRequests([target]);
    let joined: CaseSummary[] = [];
    let listCalls = 0;
    server.use(
      http.get("/api/cases", () => {
        listCalls += 1;
        return HttpResponse.json({ items: joined, nextCursor: null });
      }),
    );
    const { user } = renderApp("/case-approvals");
    const nav = await menu();
    await waitFor(() => expect(listCalls).toBeGreaterThanOrEqual(1));
    const callsBefore = listCalls;
    const newTitle = "[UNIT_TEST]147A承認でできた案件";
    expect(
      within(nav).queryByRole("link", {
        name: new RegExp("147A承認でできた案件"),
      }),
    ).toBeNull();

    // 承認の後は、新しい案件に参加している（サーバーの状態が変わる）
    joined = [caseSummary(11, { title: newTitle })];
    const main = screen.getByRole("main");
    await user.click(
      await within(main).findByRole("button", {
        name: "[UNIT_TEST]147A承認する申請の申請を承認する",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "案件の作成の承認",
    });
    await user.click(within(dialog).getByRole("button", { name: "承認する" }));

    const link = await within(nav).findByRole("link", {
      name: new RegExp("147A承認でできた案件"),
    });
    expect(link.getAttribute("href")).toBe(`/cases/${caseId(11)}`);
    expect(listCalls).toBeGreaterThan(callsBefore);
  });
});
