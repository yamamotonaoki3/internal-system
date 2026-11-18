// #147（147-B）5-1 AC-3・AC-7・AC-11、C-182 Q2・Q8、画面 S-17 の「参加者を管理」（S-18 の参加者の部分）。API は MSW で返す。データはすべて架空。
// この層で確かめるもの（計画 147-B のテストケースの「画面」の行と「画面」の節）：入口の出し分け・社員の検索と追加（ページ送り）・
//   自動参加の人の役割の名前と「削除」「退出」を出さないこと・削除と退出の確認・成功の表示・422 は欄、409・403 は欄の外・
//   変更中の二重送信の防止・成功と失敗のどちらでも取り直すこと・退出の後の S-16 への移動・行が消えても完了の表示が残ること。
// 認可・判定の順はサーバー（backend/src/routes/cases.participants.test.ts）で確かめ、ここでは重ねない。
// 画面の契約（実装の担当へ。テストが決めたもの）：
//  - S-17（pages/CaseDetailPage.tsx）に、有効な参加者（isParticipant）で進行中（status: active）のときだけ、ボタン「参加者を管理」を出す
//  - 押すと、ダイアログ（role dialog、名前「参加者を管理」）を開く。中身：
//    - 入力欄「社員の検索」（GET /api/users?q。既存の候補の検索と同じ。結果は「{表示名}を追加」のボタン。続きは「次のページ」）
//    - 参加者の一覧（list）。各行（listitem）に表示名・「作成者」・「退職者」・役割の名前（autoRole が department_owner なら「担当部署のオーナー」、
//      global_admin なら「全体管理者」）
//    - removable が真で、本人でない行だけに、ボタン「{表示名}を削除」。本人の行は、removable が真のときだけボタン「退出する」
//  - 「…を削除」→ 確認のダイアログ（名前「参加者の削除」。対象の表示名を含む）→「削除する」で DELETE /api/cases/:caseId/participants/:userId
//  - 「退出する」→ 確認のダイアログ（名前「案件からの退出」）→ その中の「退出する」で DELETE（userId は本人）。成功したら S-16（/cases）へ移る
//  - 追加は POST /api/cases/:caseId/participants（本文 { userId }）
//  - 成功で「参加者を更新しました」（role status）。422 は「社員の検索」の欄のエラー（aria-invalid・aria-describedby）、409・403 はダイアログの中の role alert
//  - 変更中は、追加・削除・退出のボタンを押せない。成功・失敗のどちらでも案件のキャッシュ（caseKeys.all）を取り直す
//  - ダイアログと完了の表示は、参加者の行の外で持つ（行が消えても、完了の表示が残る）
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { authKeys } from "../features/auth";
import { TEST_USER } from "../test/auth-handlers";
import {
  CASE_147B_TEXTS,
  PARTICIPANT_CREATOR,
  caseDetail,
  caseId,
  caseSummary,
  outsiderSummary,
  respondCaseWrites,
  respondCases,
  respondUserSearch,
  type CaseDetail,
  type CaseParticipant,
  type CaseWriteResponder,
} from "../test/case-handlers";
import { server } from "../test/server";
import { CaseDetailPage } from "./CaseDetailPage";

const SELF: CaseParticipant = {
  userId: TEST_USER.id,
  displayName: TEST_USER.displayName,
  departmentName: "[UNIT_TEST]営業147B",
  isActive: true,
  isCreator: false,
  autoRole: null,
  removable: true,
};
const OWNER: CaseParticipant = {
  userId: "01JTESTCASE147BPART000000A",
  displayName: "testuser_147b_owner",
  departmentName: "[UNIT_TEST]営業147B",
  isActive: true,
  isCreator: false,
  autoRole: "department_owner",
  removable: false,
};
const ADMIN: CaseParticipant = {
  userId: "01JTESTCASE147BPART000000B",
  displayName: "testuser_147b_admin",
  departmentName: "[UNIT_TEST]本部147B",
  isActive: true,
  isCreator: false,
  autoRole: "global_admin",
  removable: false,
};
const MEMBER: CaseParticipant = {
  userId: "01JTESTCASE147BPART000000C",
  displayName: "testuser_147b_member",
  departmentName: "[UNIT_TEST]開発147B",
  isActive: true,
  isCreator: false,
  autoRole: null,
  removable: true,
};
const NEWCOMER = {
  id: "01JTESTCASE147BPART000000D",
  displayName: "testuser_147b_new",
};
const NEXT_PAGE_USER = {
  id: "01JTESTCASE147BPART000000E",
  displayName: "testuser_147b_page2",
};

const N = 21;
const PARTICIPANTS = [PARTICIPANT_CREATOR, SELF, OWNER, ADMIN, MEMBER];

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** S-17 を描画する。/cases（S-16）には目印だけを置く */
function renderPage(
  options: {
    summary?: ReturnType<typeof caseSummary>;
    details?: () => CaseDetail;
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  const session = {
    user: TEST_USER,
    mustChangePassword: false,
    reauthenticatedAt: null,
    permissions: [],
  };
  client.setQueryData(authKeys.session, session);
  server.use(http.get("/api/auth/session", () => HttpResponse.json(session)));
  const summary = options.summary ?? caseSummary(N, { participantCount: 5 });
  const current =
    options.details ??
    (() => caseDetail(N, { ...summary, participants: PARTICIPANTS }));
  const { detailCalls, summaryCalls } = respondCases({
    summaries: [summary],
  });
  // 詳細は呼ばれた時点の状態を返す（書き込みの後の取り直しで、行が消えた一覧を返すため）
  server.use(
    http.get("/api/cases/:caseId/detail", ({ params }) => {
      detailCalls.push(String(params.caseId));
      return HttpResponse.json(current());
    }),
  );
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/cases/${caseId(N)}`]}>
        <Routes>
          <Route path="/cases/:caseId" element={<CaseDetailPage />} />
          <Route path="/cases" element={<p>テスト用のS-16</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user, client, detailCalls, summaryCalls };
}

const manageButton = () =>
  screen.findByRole("button", { name: "参加者を管理" });

async function openManager(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await manageButton());
  return screen.findByRole("dialog", { name: "参加者を管理" });
}

function rowOf(manager: HTMLElement, displayName: string) {
  const row = within(manager)
    .getAllByRole("listitem")
    .find((item) => item.textContent?.includes(displayName));
  if (row === undefined) throw new Error(`${displayName} の行がありません`);
  return row;
}

/** 入力欄のエラー（aria-describedby で結び付いた文） */
function describedText(input: HTMLElement): string {
  return (input.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter((id) => id !== "")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

const conflict =
  (reason: string, message: string): CaseWriteResponder =>
  () =>
    HttpResponse.json({ code: "CONFLICT", message, reason }, { status: 409 });

describe("#147 147-B S-17「参加者を管理」の入口", () => {
  it("#147 5-1 AC-3: 有効な参加者で進行中の案件には「参加者を管理」を出す", async () => {
    renderPage();
    expect(await manageButton()).toBeTruthy();
  });

  it("#147 5-1 AC-11: 終了中の案件には「参加者を管理」を出さない", async () => {
    renderPage({
      summary: caseSummary(N, { status: "closed", participantCount: 5 }),
    });
    await screen.findByRole("list", { name: "参加者" });
    expect(screen.queryByRole("button", { name: "参加者を管理" })).toBeNull();
  });

  it("#147 5-1 AC-3: 非参加者（管理の資格のある人を含む）には「参加者を管理」を出さない", async () => {
    renderPage({
      summary: outsiderSummary(N, { canManage: true, participantCount: 5 }),
    });
    await screen.findByText("参加者だけが見られます（非公開）");
    expect(screen.queryByRole("button", { name: "参加者を管理" })).toBeNull();
  });
});

describe("#147 147-B Q8・Q2: 参加者の一覧の役割の名前と、外す操作の出し分け", () => {
  it("#147 Q8: 担当部署のオーナー・全体管理者の行に役割の名前を出し、「削除」を出さない", async () => {
    const { user } = renderPage();
    const manager = await openManager(user);
    const owner = rowOf(manager, OWNER.displayName);
    const admin = rowOf(manager, ADMIN.displayName);
    expect(owner.textContent).toContain(CASE_147B_TEXTS.roleOwner);
    expect(admin.textContent).toContain(CASE_147B_TEXTS.roleAdmin);
    expect(within(owner).queryAllByRole("button")).toHaveLength(0);
    expect(within(admin).queryAllByRole("button")).toHaveLength(0);
    expect(rowOf(manager, MEMBER.displayName).textContent).not.toContain(
      CASE_147B_TEXTS.roleOwner,
    );
  });

  it("#147 5-1 AC-3: 外せる一般の参加者の行には「{表示名}を削除」を出す。本人の行には「削除」ではなく「退出する」を出す", async () => {
    const { user } = renderPage();
    const manager = await openManager(user);
    expect(
      within(manager).getByRole("button", {
        name: `${MEMBER.displayName}を削除`,
      }),
    ).toBeTruthy();
    const self = rowOf(manager, SELF.displayName);
    expect(within(self).getByRole("button", { name: "退出する" })).toBeTruthy();
    expect(
      within(manager).queryByRole("button", {
        name: `${SELF.displayName}を削除`,
      }),
    ).toBeNull();
  });

  it("#147 Q2: 本人が自動参加の人（removable が偽）なら「退出する」を出さない", async () => {
    const selfOwner: CaseParticipant = {
      ...SELF,
      autoRole: "department_owner",
      removable: false,
    };
    const { user } = renderPage({
      details: () =>
        caseDetail(N, { participants: [PARTICIPANT_CREATOR, selfOwner] }),
    });
    const manager = await openManager(user);
    const self = rowOf(manager, SELF.displayName);
    expect(self.textContent).toContain(CASE_147B_TEXTS.roleOwner);
    expect(within(self).queryByRole("button", { name: "退出する" })).toBeNull();
  });

  it("#147 Q1: 本人が最後の有効な参加者（removable が偽・役割なし）なら「退出する」を出さない", async () => {
    const lastSelf: CaseParticipant = { ...SELF, removable: false };
    const { user } = renderPage({
      details: () => caseDetail(N, { participants: [lastSelf] }),
    });
    const manager = await openManager(user);
    expect(
      within(rowOf(manager, SELF.displayName)).queryByRole("button", {
        name: "退出する",
      }),
    ).toBeNull();
  });
});

describe("#147 147-B 5-1 AC-3・AC-7: 社員の検索と追加", () => {
  it("#147 AC-3: 社員を検索して「{表示名}を追加」を押すと、POST { userId } を1回送り、「参加者を更新しました」を出し、詳細を取り直す", async () => {
    respondUserSearch([[NEWCOMER]]);
    const { writes } = respondCaseWrites();
    const { user, detailCalls } = renderPage();
    const manager = await openManager(user);
    await user.type(
      within(manager).getByRole("textbox", { name: "社員の検索" }),
      "147b",
    );
    const callsBefore = detailCalls.length;
    await user.click(
      await within(manager).findByRole("button", {
        name: `${NEWCOMER.displayName}を追加`,
      }),
    );
    expect(await screen.findByText(CASE_147B_TEXTS.updated)).toBeTruthy();
    expect(writes).toEqual([
      {
        method: "POST",
        path: `/api/cases/${caseId(N)}/participants`,
        body: { userId: NEWCOMER.id },
      },
    ]);
    await waitFor(() =>
      expect(detailCalls.length).toBeGreaterThan(callsBefore),
    );
  });

  it("#147 AC-3: 検索の結果が続くときは「次のページ」で続きを読む", async () => {
    const { queries } = respondUserSearch([[NEWCOMER], [NEXT_PAGE_USER]]);
    respondCaseWrites();
    const { user } = renderPage();
    const manager = await openManager(user);
    await user.type(
      within(manager).getByRole("textbox", { name: "社員の検索" }),
      "147b",
    );
    await user.click(
      await within(manager).findByRole("button", { name: "次のページ" }),
    );
    expect(
      await within(manager).findByRole("button", {
        name: `${NEXT_PAGE_USER.displayName}を追加`,
      }),
    ).toBeTruthy();
    expect(queries.at(-1)).toEqual({ q: "147b", cursor: "page-2" });
  });

  it("#147 AC-3: 追加の 422 は「社員の検索」の欄のエラーにし、欄の外には出さない", async () => {
    respondUserSearch([[NEWCOMER]]);
    respondCaseWrites(() =>
      HttpResponse.json(
        {
          code: "VALIDATION_ERROR",
          message: "この社員は追加できません",
          fields: ["userId"],
        },
        { status: 422 },
      ),
    );
    const { user } = renderPage();
    const manager = await openManager(user);
    const search = within(manager).getByRole("textbox", { name: "社員の検索" });
    await user.type(search, "147b");
    await user.click(
      await within(manager).findByRole("button", {
        name: `${NEWCOMER.displayName}を追加`,
      }),
    );
    await waitFor(() =>
      expect(search.getAttribute("aria-invalid")).toBe("true"),
    );
    expect(describedText(search)).toContain("この社員は追加できません");
    expect(within(manager).queryByRole("alert")).toBeNull();
    expect(screen.queryByText(CASE_147B_TEXTS.updated)).toBeNull();
  });

  it("#147 AC-3: 追加の 409（すでに参加者）は欄の外（role alert）に出し、詳細を取り直す", async () => {
    respondUserSearch([[NEWCOMER]]);
    respondCaseWrites(
      conflict("already_participant", "すでに参加者です（[UNIT_TEST]）"),
    );
    const { user, detailCalls } = renderPage();
    const manager = await openManager(user);
    const search = within(manager).getByRole("textbox", { name: "社員の検索" });
    await user.type(search, "147b");
    const callsBefore = detailCalls.length;
    await user.click(
      await within(manager).findByRole("button", {
        name: `${NEWCOMER.displayName}を追加`,
      }),
    );
    const alert = await within(manager).findByRole("alert");
    expect(alert.textContent).toContain("すでに参加者です（[UNIT_TEST]）");
    expect(search.getAttribute("aria-invalid")).not.toBe("true");
    await waitFor(() =>
      expect(detailCalls.length).toBeGreaterThan(callsBefore),
    );
  });

  it("#147 二重送信の防止: 追加の応答を待つ間は、追加のボタンを押せず、送るのは1回だけ", async () => {
    respondUserSearch([[NEWCOMER, NEXT_PAGE_USER]]);
    const gate = deferred();
    const { writes } = respondCaseWrites(async (write) => {
      await gate.promise;
      return HttpResponse.json(
        {
          caseId: caseId(N),
          userId: (write.body as { userId: string }).userId,
        },
        { status: 201 },
      );
    });
    const { user } = renderPage();
    const manager = await openManager(user);
    await user.type(
      within(manager).getByRole("textbox", { name: "社員の検索" }),
      "147b",
    );
    const first = await within(manager).findByRole("button", {
      name: `${NEWCOMER.displayName}を追加`,
    });
    await user.click(first);
    await waitFor(() => expect(writes).toHaveLength(1));
    const second = within(manager).getByRole("button", {
      name: `${NEXT_PAGE_USER.displayName}を追加`,
    });
    expect((second as HTMLButtonElement).disabled).toBe(true);
    await user.click(second);
    expect(writes).toHaveLength(1);
    gate.release();
    expect(await screen.findByText(CASE_147B_TEXTS.updated)).toBeTruthy();
  });
});

describe("#147 147-B 5-1 AC-3・AC-7: 参加者の削除", () => {
  it("#147 AC-3: 「{表示名}を削除」で確認のダイアログを出し、「削除する」で DELETE を1回送る。行が消えても「参加者を更新しました」が残る", async () => {
    let removed = false;
    const { writes } = respondCaseWrites(() => {
      removed = true;
      return new HttpResponse(null, { status: 204 });
    });
    const { user } = renderPage({
      details: () =>
        caseDetail(N, {
          participants: removed
            ? PARTICIPANTS.filter((p) => p.userId !== MEMBER.userId)
            : PARTICIPANTS,
        }),
    });
    const manager = await openManager(user);
    await user.click(
      within(manager).getByRole("button", {
        name: `${MEMBER.displayName}を削除`,
      }),
    );
    const confirm = await screen.findByRole("dialog", { name: "参加者の削除" });
    expect(confirm.textContent).toContain(MEMBER.displayName);
    await user.click(within(confirm).getByRole("button", { name: "削除する" }));
    expect(await screen.findByText(CASE_147B_TEXTS.updated)).toBeTruthy();
    expect(writes).toEqual([
      {
        method: "DELETE",
        path: `/api/cases/${caseId(N)}/participants/${MEMBER.userId}`,
        body: undefined,
      },
    ]);
    // 取り直した一覧から行が消えた後も、完了の表示が残る
    await waitFor(() =>
      expect(
        within(
          screen.getByRole("dialog", { name: "参加者を管理" }),
        ).queryByRole("button", { name: `${MEMBER.displayName}を削除` }),
      ).toBeNull(),
    );
    expect(screen.getByText(CASE_147B_TEXTS.updated)).toBeTruthy();
  });

  it("#147 AC-3: 確認のダイアログで「キャンセル」なら送らない", async () => {
    const { writes } = respondCaseWrites();
    const { user } = renderPage();
    const manager = await openManager(user);
    await user.click(
      within(manager).getByRole("button", {
        name: `${MEMBER.displayName}を削除`,
      }),
    );
    const confirm = await screen.findByRole("dialog", { name: "参加者の削除" });
    await user.click(
      within(confirm).getByRole("button", { name: "キャンセル" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "参加者の削除" })).toBeNull(),
    );
    expect(writes).toEqual([]);
  });

  it("#147 C-133: 削除の 409（自動参加の人）は欄の外（role alert）に文言を出し、詳細を取り直す", async () => {
    respondCaseWrites(
      conflict("auto_participant", CASE_147B_TEXTS.autoParticipant),
    );
    const { user, detailCalls } = renderPage();
    const manager = await openManager(user);
    await user.click(
      within(manager).getByRole("button", {
        name: `${MEMBER.displayName}を削除`,
      }),
    );
    const callsBefore = detailCalls.length;
    const confirm = await screen.findByRole("dialog", { name: "参加者の削除" });
    await user.click(within(confirm).getByRole("button", { name: "削除する" }));
    const alert = await within(
      screen.getByRole("dialog", { name: "参加者を管理" }),
    ).findByRole("alert");
    expect(alert.textContent).toContain(CASE_147B_TEXTS.autoParticipant);
    expect(screen.queryByText(CASE_147B_TEXTS.updated)).toBeNull();
    await waitFor(() =>
      expect(detailCalls.length).toBeGreaterThan(callsBefore),
    );
  });

  it("#147 5-1 AC-3: 削除の 403（外された後の操作）は欄の外に「参加者だけが操作できます」を出す", async () => {
    respondCaseWrites(() =>
      HttpResponse.json(
        { code: "FORBIDDEN", message: CASE_147B_TEXTS.participantsOnly },
        { status: 403 },
      ),
    );
    const { user } = renderPage();
    const manager = await openManager(user);
    await user.click(
      within(manager).getByRole("button", {
        name: `${MEMBER.displayName}を削除`,
      }),
    );
    const confirm = await screen.findByRole("dialog", { name: "参加者の削除" });
    await user.click(within(confirm).getByRole("button", { name: "削除する" }));
    expect(
      await screen.findByText(CASE_147B_TEXTS.participantsOnly, {
        exact: false,
      }),
    ).toBeTruthy();
  });

  it("#147 二重送信の防止: 削除の応答を待つ間は「削除する」を押せず、送るのは1回だけ", async () => {
    const gate = deferred();
    const { writes } = respondCaseWrites(async () => {
      await gate.promise;
      return new HttpResponse(null, { status: 204 });
    });
    const { user } = renderPage();
    const manager = await openManager(user);
    await user.click(
      within(manager).getByRole("button", {
        name: `${MEMBER.displayName}を削除`,
      }),
    );
    const confirm = await screen.findByRole("dialog", { name: "参加者の削除" });
    const submit = within(confirm).getByRole("button", { name: "削除する" });
    await user.click(submit);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await user.click(submit);
    expect(writes).toHaveLength(1);
    gate.release();
    expect(await screen.findByText(CASE_147B_TEXTS.updated)).toBeTruthy();
  });
});

describe("#147 147-B 5-1 AC-3: 本人の退出", () => {
  it("#147 AC-3: 「退出する」で確認のダイアログを出し、確定すると本人の DELETE を送り、S-16（/cases）へ移り、案件のキャッシュを取り直す", async () => {
    const { writes } = respondCaseWrites();
    const { user, client } = renderPage();
    const manager = await openManager(user);
    await user.click(
      within(rowOf(manager, SELF.displayName)).getByRole("button", {
        name: "退出する",
      }),
    );
    const confirm = await screen.findByRole("dialog", {
      name: "案件からの退出",
    });
    await user.click(within(confirm).getByRole("button", { name: "退出する" }));
    expect(await screen.findByText("テスト用のS-16")).toBeTruthy();
    expect(writes).toEqual([
      {
        method: "DELETE",
        path: `/api/cases/${caseId(N)}/participants/${SELF.userId}`,
        body: undefined,
      },
    ]);
    const cached = client.getQueryCache().findAll({ queryKey: ["cases"] });
    expect(cached.length).toBeGreaterThan(0);
    for (const query of cached)
      expect(query.state.isInvalidated, JSON.stringify(query.queryKey)).toBe(
        true,
      );
  });

  it("#147 Q1: 退出の 409（最後の有効な参加者）は欄の外に出し、S-16 へ移らない", async () => {
    respondCaseWrites(
      conflict(
        "last_active_participant",
        "最後の参加者は退出できません（[UNIT_TEST]）",
      ),
    );
    const { user } = renderPage();
    const manager = await openManager(user);
    await user.click(
      within(rowOf(manager, SELF.displayName)).getByRole("button", {
        name: "退出する",
      }),
    );
    const confirm = await screen.findByRole("dialog", {
      name: "案件からの退出",
    });
    await user.click(within(confirm).getByRole("button", { name: "退出する" }));
    expect(
      await screen.findByText("最後の参加者は退出できません（[UNIT_TEST]）", {
        exact: false,
      }),
    ).toBeTruthy();
    expect(screen.queryByText("テスト用のS-16")).toBeNull();
  });
});
