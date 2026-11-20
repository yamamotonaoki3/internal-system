// #150（150-C）計画 4.6・6章「資格を失う」：S-17 の「内容を編集」のダイアログを開いて説明を入力している途中に、ほかの参加者の操作で外されると、
// #308 の仕組み（部屋のメッセージの自動の更新が拒否〔404〕を受けたことを契機に、概要を取り直す。useCaseAccessLoss の onLost）でダイアログが閉じ、
// 説明（開いた時点の値も、入力中の値も）が画面のどこにも残らないこと（入力欄の値を含む）。1件だけ。#308 の網羅は CaseAccessLoss.test.tsx。
// 偽の時計でポーリングを進める（固定の時間の待ちを使わない）。API は MSW。データはすべて架空（testuser_150c_・[UNIT_TEST]）。
// 画面の契約は pages/CaseEdit.test.tsx の冒頭を参照。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authKeys } from "../features/auth";
import { TEST_USER } from "../test/auth-handlers";
import {
  CASE_TEXTS,
  PARTICIPANT_CREATOR,
  caseDetail,
  caseId,
  caseRoomId,
  caseSummary,
  outsiderSummary,
  respondCaseEdit,
  type CaseParticipant,
} from "../test/case-handlers";
import { respondChoices, respondSimilar } from "../test/case-request-handlers";
import { apiErrorResponse, message } from "../test/message-handlers";
import { server } from "../test/server";
import { CaseDetailPage } from "./CaseDetailPage";

/** user-event の type は「[」「{」をキーの指定として読むため、文字として入力するときは重ねる（既存のテストと同じ書き方） */
const typed = (text: string) => text.replace(/[[{]/g, (c) => c + c);
const N = 163;
const POLL_MS = 2_000;
const SECRET = "[UNIT_TEST]150C外されると見えなくなる説明";
const TYPED = "[UNIT_TEST]150C入力中の秘密";

const SELF: CaseParticipant = {
  userId: TEST_USER.id,
  displayName: TEST_USER.displayName,
  departmentName: null,
  isActive: true,
  isCreator: false,
  autoRole: null,
  removable: true,
};

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

/** 画面の文字と、入力欄の値のどちらかに text があるか */
function shows(text: string): boolean {
  if (document.body.textContent?.includes(text)) return true;
  return [...document.querySelectorAll("input, textarea")].some((element) =>
    (element as HTMLInputElement).value.includes(text),
  );
}

describe("#150 150-C 編集の途中で外された人の画面（#308 の仕組み）", () => {
  it("#150 4.6・#308: 説明を入力中に外されると、自動の更新の1回の後にダイアログが閉じ、非公開の表示になり、説明・入力が残らない", async () => {
    const state = { participant: true };
    const parent = message(1, {
      roomId: caseRoomId(N),
      body: "[UNIT_TEST]150Cやり取り",
    });
    server.use(
      http.get("/api/cases/:caseId", () =>
        HttpResponse.json(
          state.participant ? caseSummary(N) : outsiderSummary(N),
        ),
      ),
      http.get("/api/cases/:caseId/detail", () =>
        state.participant
          ? HttpResponse.json(
              caseDetail(N, {
                description: SECRET,
                participants: [PARTICIPANT_CREATOR, SELF],
              }),
            )
          : apiErrorResponse(403, "FORBIDDEN", CASE_TEXTS.participantsOnly),
      ),
      http.get("/api/rooms/:roomId/messages", ({ request }) => {
        if (!state.participant)
          return apiErrorResponse(404, "NOT_FOUND", CASE_TEXTS.notFound);
        const after = new URL(request.url).searchParams.get("after");
        return HttpResponse.json({
          items: after === null ? [parent] : [],
          nextCursor: null,
          hasMore: false,
        });
      }),
      http.put(
        "/api/rooms/:roomId/read-position",
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    respondChoices();
    respondSimilar(false);
    const { writes } = respondCaseEdit();
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
    const user = userEvent.setup({
      advanceTimers: (ms) => vi.advanceTimersByTime(ms),
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/cases/${caseId(N)}`]}>
          <Routes>
            <Route path="/cases/:caseId" element={<CaseDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText(SECRET);
    const button = await screen.findByRole<HTMLButtonElement>("button", {
      name: "内容を編集",
    });
    await waitFor(() => expect(button.disabled).toBe(false));
    await user.click(button);
    const dialog = await screen.findByRole("dialog", {
      name: "案件の内容の編集",
    });
    const description = within(dialog).getByRole("textbox", { name: /説明/ });
    await user.type(description, typed(TYPED));
    expect(shows(TYPED)).toBe(true);

    // ほかの参加者が、この人を外した（サーバーの状態だけが変わる）
    state.participant = false;
    await advance(POLL_MS);

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "案件の内容の編集" }),
      ).toBeNull();
      expect(screen.getByText(CASE_TEXTS.participantsOnly)).toBeTruthy();
    });
    expect(shows(SECRET)).toBe(false);
    expect(shows(TYPED)).toBe(false);
    expect(screen.queryByRole("button", { name: "内容を編集" })).toBeNull();
    expect(writes).toEqual([]);
  });
});
