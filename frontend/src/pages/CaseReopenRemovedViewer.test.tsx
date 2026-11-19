// #150（150-B）計画 6.6・10章「外された人の画面（#308 の前提の確認）」：終了中の案件の画面（S-17）を開いたままの参加者が、
// ほかの参加者の再開の選び直しで外されると、#308 の仕組み（部屋のメッセージの自動の更新が拒否（404）を受けたことを契機に、概要を取り直す）で、
// 自動の更新の1回の後に非公開の表示に切り替わること（150-B の経路でも効くことの確認。1件だけ。#308 の網羅は CaseAccessLoss.test.tsx）。
// 偽の時計でポーリングを進める（固定の時間の待ちを使わない）。API は MSW。データはすべて架空（testuser_150b_・[UNIT_TEST]）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
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
  type CaseParticipant,
} from "../test/case-handlers";
import { respondTodos, todoItem } from "../test/case-todo-handlers";
import { apiErrorResponse, message } from "../test/message-handlers";
import { server } from "../test/server";
import { CaseDetailPage } from "./CaseDetailPage";

const N = 152;
const POLL_MS = 2_000;
const SECRET = "[UNIT_TEST]150B外されると見えなくなる説明";
const MESSAGE_TEXT = "[UNIT_TEST]150B再開の前のやり取り";

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

describe("#150 150-B 選び直しで外された人の画面（#308 の仕組み）", () => {
  it("#150 5-1 AC-16・#308: 終了中の案件を開いたまま、ほかの参加者の再開で外されると、自動の更新の1回の後に非公開の表示に切り替わり、説明・参加者・やり取りが出ない", async () => {
    respondTodos([todoItem(1)]);
    const state = {
      participant: true,
      status: "closed" as "active" | "closed",
    };
    const parent = message(1, { roomId: caseRoomId(N), body: MESSAGE_TEXT });
    server.use(
      http.get("/api/cases/:caseId", () =>
        HttpResponse.json(
          state.participant
            ? caseSummary(N, {
                status: state.status,
                canEditDueDate: state.status === "active",
              })
            : outsiderSummary(N, { status: state.status }),
        ),
      ),
      http.get("/api/cases/:caseId/detail", () =>
        state.participant
          ? HttpResponse.json(
              caseDetail(N, {
                status: state.status,
                description: SECRET,
                participants: [PARTICIPANT_CREATOR, SELF],
              }),
            )
          : apiErrorResponse(403, "FORBIDDEN", CASE_TEXTS.participantsOnly),
      ),
      http.get("/api/rooms/:roomId/messages", ({ request }) => {
        if (!state.participant)
          // 非参加者には部屋の存在を明かさない（5-2 AC-3。サーバーは 404）
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
    await screen.findAllByText(MESSAGE_TEXT);

    // ほかの参加者が、この人を外して再開した（サーバーの状態だけが変わる）
    state.status = "active";
    state.participant = false;
    await advance(POLL_MS);

    await waitFor(() => {
      expect(screen.queryByText(SECRET)).toBeNull();
      expect(screen.getByText(CASE_TEXTS.participantsOnly)).toBeTruthy();
    });
    expect(screen.queryByText(PARTICIPANT_CREATOR.displayName)).toBeNull();
    expect(screen.queryByRole("list", { name: "参加者" })).toBeNull();
    expect(screen.queryAllByText(MESSAGE_TEXT)).toEqual([]);
    expect(screen.queryByRole("button", { name: "案件を再開" })).toBeNull();
    expect(screen.queryByRole("button", { name: "案件を終了" })).toBeNull();
  });
});
