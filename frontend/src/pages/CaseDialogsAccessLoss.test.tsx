// #150（150-C）コードレビューの修正・#308：S-17 でダイアログを開いたまま、概要の取り直しが「詳細・メッセージの拒否より先に」非参加を返したとき
// （useCaseAccessLoss が、参加者から非参加への変化で onLost を呼ぶ）、開いているダイアログがすべて閉じ、参加者だけの中身（参加者の名前・添付のファイル名等）が
// 画面に残らないこと。編集のダイアログは CaseEditAccessLoss.test.tsx。API は MSW。データはすべて架空（testuser_150c_・[UNIT_TEST]）。
// 否定の確認が空振りしないよう、外される前に、ダイアログが開いていて、その中身が画面にあることを先に確かめる。
// 詳細・メッセージ・添付は参加者のまま応答し続け（拒否を契機にする #308 の仕組みは動かない）、概要だけを取り直して非参加にする。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { authKeys } from "../features/auth";
import { caseKeys } from "../features/cases";
import { TEST_USER } from "../test/auth-handlers";
import {
  caseAttachment,
  caseAttachmentName,
  respondCaseAttachments,
} from "../test/case-attachment-handlers";
import {
  CASE_TEXTS,
  PARTICIPANT_CREATOR,
  caseDetail,
  caseId,
  caseSummary,
  outsiderSummary,
  respondUserSearch,
  type CaseParticipant,
  type CaseSummary,
} from "../test/case-handlers";
import { respondTodos } from "../test/case-todo-handlers";
import { server } from "../test/server";
import { CaseDetailPage } from "./CaseDetailPage";

const N = 164;
const MEMBER: CaseParticipant = {
  userId: "01JTESTCASE150CDLG00000001",
  displayName: "testuser_150c_member",
  departmentName: null,
  isActive: true,
  isCreator: false,
  autoRole: null,
  removable: true,
};
const SELF: CaseParticipant = {
  userId: TEST_USER.id,
  displayName: TEST_USER.displayName,
  departmentName: null,
  isActive: true,
  isCreator: false,
  autoRole: null,
  removable: true,
};
const CANDIDATE = {
  id: "01JTESTCASE150CDLG00000002",
  displayName: "testuser_150c_candidate",
};
const PARTICIPANT_NAMES = [PARTICIPANT_CREATOR, MEMBER].map(
  (p) => p.displayName,
);

/** 画面の文字と、入力欄の値のどちらかに text があるか */
function shows(text: string): boolean {
  if (document.body.textContent?.includes(text)) return true;
  return [...document.querySelectorAll("input, textarea")].some((element) =>
    (element as HTMLInputElement).value.includes(text),
  );
}

/**
 * 詳細・メッセージ・添付は参加者のまま応答し、概要だけを afterRemoval に切り替えられる。
 * removeBySummaryFirst：サーバーで外された後、概要だけが先に取り直される
 */
function renderCase(
  status: "active" | "closed",
  afterRemoval: () => CaseSummary,
) {
  const state = { summaryParticipant: true };
  const participantSummary = () =>
    caseSummary(N, { status, canEditDueDate: status === "active" });
  server.use(
    http.get("/api/cases/:caseId", () =>
      HttpResponse.json(
        state.summaryParticipant ? participantSummary() : afterRemoval(),
      ),
    ),
    http.get("/api/cases/:caseId/detail", () =>
      HttpResponse.json(
        caseDetail(N, {
          ...participantSummary(),
          description: "[UNIT_TEST]150C説明",
          participants: [PARTICIPANT_CREATOR, SELF, MEMBER],
        }),
      ),
    ),
    http.get("/api/rooms/:roomId/messages", () =>
      HttpResponse.json({ items: [], nextCursor: null, hasMore: false }),
    ),
    http.put(
      "/api/rooms/:roomId/read-position",
      () => new HttpResponse(null, { status: 204 }),
    ),
  );
  respondTodos([]);
  respondCaseAttachments([
    caseAttachment(1, { canChangeVisibility: status === "active" }),
  ]);
  respondUserSearch([[CANDIDATE]]);
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
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/cases/${caseId(N)}`]}>
        <Routes>
          <Route path="/cases/:caseId" element={<CaseDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  async function removeBySummaryFirst() {
    state.summaryParticipant = false;
    await act(async () => {
      await client.refetchQueries({
        queryKey: caseKeys.summary(TEST_USER.id, caseId(N)),
      });
    });
    await waitFor(() =>
      expect(screen.getByText(CASE_TEXTS.participantsOnly)).toBeTruthy(),
    );
  }
  return { user, removeBySummaryFirst };
}

const dialogNamed = (name: string) => screen.findByRole("dialog", { name });
const noDialog = () => expect(screen.queryByRole("dialog")).toBeNull();

describe("#150 150-C 概要が先に非参加になったとき、開いているダイアログが閉じる（#308）", () => {
  it("#150 4.6・#308: 終了中の案件の「案件の再開」（参加者の選び直し）が閉じ、参加者の名前が画面に残らない", async () => {
    const { user, removeBySummaryFirst } = renderCase("closed", () =>
      outsiderSummary(N, { status: "closed" }),
    );
    await user.click(await screen.findByRole("button", { name: "案件を再開" }));
    const dialog = await dialogNamed("案件の再開");
    // 外される前：候補（参加者の名前）がダイアログの中にある
    for (const name of PARTICIPANT_NAMES)
      expect(within(dialog).getByText(name)).toBeTruthy();

    await removeBySummaryFirst();

    noDialog();
    for (const name of PARTICIPANT_NAMES) expect(shows(name)).toBe(false);
    expect(screen.queryByRole("button", { name: "案件を再開" })).toBeNull();
  });

  it("#150 4.6・#308・#148: 添付の「公開範囲を変更」のダイアログが閉じ、ファイル名が画面に残らない", async () => {
    const { user, removeBySummaryFirst } = renderCase("active", () =>
      outsiderSummary(N),
    );
    await user.click(
      await screen.findByRole("button", {
        name: `${caseAttachmentName(1)} の公開範囲を変更`,
      }),
    );
    const dialog = await dialogNamed("公開範囲を変更");
    // 外される前：ダイアログの選択肢と、区画のファイル名が画面にある（ダイアログ自体にはファイル名は出ない）
    expect(within(dialog).getAllByRole("radio")).toHaveLength(2);
    expect(shows(caseAttachmentName(1))).toBe(true);

    await removeBySummaryFirst();

    noDialog();
    expect(shows(caseAttachmentName(1))).toBe(false);
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("#150 4.6・#308: 「参加者を管理」のダイアログが閉じ、参加者の一覧・検索の候補が画面に残らない", async () => {
    const { user, removeBySummaryFirst } = renderCase("active", () =>
      outsiderSummary(N),
    );
    await user.click(
      await screen.findByRole("button", { name: "参加者を管理" }),
    );
    const dialog = await dialogNamed("参加者を管理");
    const list = within(dialog).getByRole("list", { name: "参加者の一覧" });
    for (const name of PARTICIPANT_NAMES)
      expect(within(list).getByText(name)).toBeTruthy();
    await user.type(
      within(dialog).getByRole("textbox", { name: "社員の検索" }),
      "testuser",
    );
    await within(dialog).findByRole("button", {
      name: `${CANDIDATE.displayName}を追加`,
    });

    await removeBySummaryFirst();

    noDialog();
    expect(screen.queryByRole("list", { name: "参加者の一覧" })).toBeNull();
    for (const name of PARTICIPANT_NAMES) expect(shows(name)).toBe(false);
    expect(shows(CANDIDATE.displayName)).toBe(false);
    expect(shows("社員の検索")).toBe(false);
  });

  it("#150 4.6・#308: 「案件の終了」の確認が閉じ、確認の文が画面に残らない", async () => {
    const { user, removeBySummaryFirst } = renderCase("active", () =>
      outsiderSummary(N),
    );
    await user.click(await screen.findByRole("button", { name: "案件を終了" }));
    const dialog = await dialogNamed("案件の終了");
    expect(
      within(dialog).getByRole("button", { name: "終了する" }),
    ).toBeTruthy();

    await removeBySummaryFirst();

    noDialog();
    expect(screen.queryByRole("button", { name: "終了する" })).toBeNull();
    expect(screen.queryByRole("button", { name: "案件を終了" })).toBeNull();
  });

  it("#150 4.6・#308: 「納期の変更」のダイアログが閉じる", async () => {
    const { user, removeBySummaryFirst } = renderCase("active", () =>
      outsiderSummary(N),
    );
    await user.click(await screen.findByRole("button", { name: "納期を変更" }));
    const dialog = await dialogNamed("納期の変更");
    expect(within(dialog).getByLabelText("納期")).toBeTruthy();

    await removeBySummaryFirst();

    noDialog();
    expect(screen.queryByLabelText("納期")).toBeNull();
  });

  it("#150 4.6・#308・統括の決定: 管理の資格が残る人（canEditDueDate が真のまま）の「納期の変更」も、いったん閉じる", async () => {
    const { user, removeBySummaryFirst } = renderCase("active", () =>
      outsiderSummary(N, { canManage: true, canEditDueDate: true }),
    );
    await user.click(await screen.findByRole("button", { name: "納期を変更" }));
    await dialogNamed("納期の変更");

    await removeBySummaryFirst();

    noDialog();
    // 資格が残るので、ボタンは残り、押せば開き直せる
    expect(screen.getByRole("button", { name: "納期を変更" })).toBeTruthy();
  });
});
