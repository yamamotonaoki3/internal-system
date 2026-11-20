// #323 #308：S-17 を開いたまま、概要の取り直しが「詳細・メッセージ・TODO の拒否より先に」非参加を返したとき（きっかけ (b)）、
// 画面だけでなくキャッシュ（DevTools で見える中身）にも、やり取りの本文・TODO の題名・添付のファイル名・説明が残らないこと。
// 否定の確認が空振りしないよう、外される前に、それらが画面とキャッシュにあることを先に確かめる。API は MSW。データはすべて架空（[UNIT_TEST]）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
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
  type CaseSummary,
} from "../test/case-handlers";
import { respondTodos, todoItem, todoTitle } from "../test/case-todo-handlers";
import { message, respondMessages } from "../test/message-handlers";
import { server } from "../test/server";
import { CaseDetailPage } from "./CaseDetailPage";

const N = 323;
const BODY = "[UNIT_TEST]323やり取りの本文";
const DESCRIPTION = "[UNIT_TEST]323説明";

/** キャッシュの全データ（Query のデータと、操作（Mutation）の応答・変数）を1つの文字列にする（DevTools で見える中身の代わり） */
function cacheText(client: QueryClient): string {
  const queries = client
    .getQueryCache()
    .getAll()
    .map((query) => JSON.stringify(query.state.data ?? null));
  const mutations = client
    .getMutationCache()
    .getAll()
    .map((mutation) =>
      JSON.stringify([
        mutation.state.data ?? null,
        mutation.state.variables ?? null,
      ]),
    );
  return [...queries, ...mutations].join("\n");
}

function renderCase(afterRemoval: () => CaseSummary) {
  const state = { summaryParticipant: true };
  server.use(
    http.get("/api/cases/:caseId", () =>
      HttpResponse.json(
        state.summaryParticipant ? caseSummary(N) : afterRemoval(),
      ),
    ),
    http.get("/api/cases/:caseId/detail", () =>
      HttpResponse.json(
        caseDetail(N, {
          ...caseSummary(N),
          description: DESCRIPTION,
          participants: [PARTICIPANT_CREATOR],
        }),
      ),
    ),
    http.put(
      "/api/rooms/:roomId/read-position",
      () => new HttpResponse(null, { status: 204 }),
    ),
  );
  respondMessages([message(1, { body: BODY })]);
  respondTodos([todoItem(1)]);
  respondCaseAttachments([caseAttachment(1)]);
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
    // 切り替わる途中の画面ではなく、前の内容が画面から消えてから確かめる
    await waitFor(() =>
      expect(document.body.textContent?.includes(BODY)).toBe(false),
    );
  }
  return { client, removeBySummaryFirst };
}

const SECRETS = [BODY, todoTitle(1), caseAttachmentName(1), DESCRIPTION];

async function expectShownAndCached(client: QueryClient) {
  for (const text of [BODY, todoTitle(1), caseAttachmentName(1)])
    expect(await screen.findByText(text)).toBeTruthy();
  for (const text of SECRETS) expect(cacheText(client)).toContain(text);
}

describe("#323 #308 (b) 概要が先に非参加になったとき、キャッシュに参加者だけの中身が残らない", () => {
  it("#323 AC-1 (b): 外された人のキャッシュに、やり取りの本文・TODO の題名・添付のファイル名・説明がない", async () => {
    const { client, removeBySummaryFirst } = renderCase(() =>
      outsiderSummary(N),
    );
    await expectShownAndCached(client);

    await removeBySummaryFirst();

    const cached = cacheText(client);
    expect(SECRETS.filter((text) => cached.includes(text))).toEqual([]);
  });

  it("#323 AC-1 (b) 管理の資格が残る人（担当部署のオーナー）: キャッシュに参加者だけの中身はなく、概要は残る", async () => {
    const { client, removeBySummaryFirst } = renderCase(() =>
      outsiderSummary(N, { canManage: true, canEditDueDate: true }),
    );
    await expectShownAndCached(client);

    await removeBySummaryFirst();

    const cached = cacheText(client);
    expect(SECRETS.filter((text) => cached.includes(text))).toEqual([]);
    expect(
      client.getQueryData(caseKeys.summary(TEST_USER.id, caseId(N))),
    ).toEqual(
      expect.objectContaining({ isParticipant: false, canManage: true }),
    );
  });
});
