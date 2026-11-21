// #363 コードレビュー3回目（重大）の直し：古い「成功・非参加」の概要のキャッシュで案件の画面を開いても、案件の一覧のキャッシュを壊さない。
// 根拠：
//   - コードレビュー3回目の指摘：概要が古い非参加のまま画面を開くと、作られた時点で outsider が真になり、一覧（「参加中」）の行が外され、
//     「すべての案件」の行が非参加の形に書き換わる。その後、概要が参加者として取り直されても、一覧は元に戻らない（main にはなかった退行）。
//   - Skill「frontend-state」：操作・取り直しの結果は、再読み込みせずに表示へ即時に反映する。参加者として取り直されたのに、一覧から消えたままにしない。
//   - main の動き：一覧を書き換えるのは、この画面で参加者だったことを見た後に、非参加になったときだけ。
// 決めた直し方：forgetCaseContent（参加者だけの中身）は、非参加が確かめられたら、参加者だったかに関わらず呼ぶ（R-5）。
//   forgetCaseInLists（一覧の書き換え）は、この画面で参加者だったことを見た後に、非参加が確かめられたときだけ呼ぶ。
// 一覧のキャッシュは、観測者がいない状態で用意し（取り直しが走らない）、キャッシュの値を画面の操作の後に確かめる。
// API は MSW。データはすべて架空（testuser_・[UNIT_TEST]）。
import {
  QueryClient,
  QueryClientProvider,
  type InfiniteData,
} from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { authKeys } from "../features/auth";
import { caseKeys } from "../features/cases";
import type { CasePage, CaseSummary } from "../features/cases/api/case-api";
import { TEST_USER } from "../test/auth-handlers";
import { respondCaseAttachments } from "../test/case-attachment-handlers";
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
import { respondTodos, todoItem, todoTitle } from "../test/case-todo-handlers";
import { apiErrorResponse } from "../test/message-handlers";
import { server } from "../test/server";
import { CaseDetailPage } from "./CaseDetailPage";

const N = 363;
const OTHER_N = 364;
const AT = "2026-11-19T01:05:00.000Z";
const SECRET = "[UNIT_TEST]363一覧のテストの説明";
const PRIVATE_TEXT = CASE_TEXTS.participantsOnly;
const SUMMARY_KEY = caseKeys.summary(TEST_USER.id, caseId(N));
const DETAIL_KEY = caseKeys.detail(TEST_USER.id, caseId(N));
const JOINED_KEY = caseKeys.list(TEST_USER.id, "joined", "active");
const ALL_KEY = caseKeys.list(TEST_USER.id, "all", "active");
const OTHER_USER_ID = "01JTESTUSER363000000000AU2";
const OTHER_USER_JOINED_KEY = caseKeys.list(OTHER_USER_ID, "joined", "active");
const OTHER_USER_ALL_KEY = caseKeys.list(OTHER_USER_ID, "all", "active");

const SELF: CaseParticipant = {
  userId: TEST_USER.id,
  displayName: TEST_USER.displayName,
  departmentName: null,
  isActive: true,
  isCreator: false,
  autoRole: null,
  removable: true,
};

/** 一覧にある、参加者としての行（参加者だけの値：lastActivityAt・channelId を持つ） */
const participantRow = (n: number): CaseSummary =>
  caseSummary(n, { lastActivityAt: AT });
const otherRow = participantRow(OTHER_N);

type World = { participant: boolean; summaryFail: { status: number } | null };

function respondWorld(participant: boolean): World {
  const w: World = { participant, summaryFail: null };
  respondTodos([todoItem(1)]);
  respondCaseAttachments();
  server.use(
    http.get("/api/cases/:caseId", () => {
      if (w.summaryFail !== null)
        return apiErrorResponse(
          w.summaryFail.status,
          w.summaryFail.status === 404 ? "NOT_FOUND" : "INTERNAL_ERROR",
          CASE_TEXTS.notFound,
        );
      return HttpResponse.json(
        w.participant
          ? caseSummary(N, { lastActivityAt: AT })
          : outsiderSummary(N),
      );
    }),
    http.get("/api/cases/:caseId/detail", () =>
      w.participant
        ? HttpResponse.json(
            caseDetail(N, {
              description: SECRET,
              participants: [PARTICIPANT_CREATOR, SELF],
            }),
          )
        : apiErrorResponse(403, "FORBIDDEN", PRIVATE_TEXT),
    ),
    http.get("/api/rooms/:roomId/messages", () =>
      HttpResponse.json({ items: [], nextCursor: null, hasMore: false }),
    ),
    http.put(
      "/api/rooms/:roomId/read-position",
      () => new HttpResponse(null, { status: 204 }),
    ),
  );
  return w;
}

/** 一覧のキャッシュを、観測者がいない状態で用意する（この案件と別の案件の、参加者としての行） */
function seedLists(client: QueryClient) {
  const data = (): InfiniteData<CasePage> => ({
    pages: [
      {
        items: [participantRow(N), otherRow],
        nextCursor: null,
      } as CasePage,
    ],
    pageParams: [undefined],
  });
  client.setQueryData(JOINED_KEY, data());
  client.setQueryData(ALL_KEY, data());
  // ほかの利用者の一覧（キーが利用者ごとであることの確かめ。印が付かないこと）
  client.setQueryData(OTHER_USER_JOINED_KEY, data());
  client.setQueryData(OTHER_USER_ALL_KEY, data());
}

function renderPage(seed: {
  summary?: CaseSummary;
  lists?: boolean;
  /** 詳細のキャッシュの目印の値（描画の前に入れる：概要が古いと、作られた時点で片付けが走るため） */
  sentinels?: boolean;
}) {
  const client = new QueryClient({
    defaultOptions: {
      // 概要は古い扱い（staleTime 0）：開いたときに取り直しが走る
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
  if (seed.summary !== undefined)
    client.setQueryData(SUMMARY_KEY, seed.summary);
  if (seed.lists === true) seedLists(client);
  if (seed.sentinels === true) {
    client.setQueryData(DETAIL_KEY, { sentinel: "[UNIT_TEST]363一覧の詳細" });
  }
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/cases/${caseId(N)}`]}>
        <Routes>
          <Route path="/cases/:caseId" element={<CaseDetailPage />} />
          <Route
            path="/cases"
            element={<Link to={`/cases/${caseId(N)}`}>案件に戻る</Link>}
          />
        </Routes>
        <Link to="/cases">一覧へ移る</Link>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, user: userEvent.setup() };
}

const rowsOf = (client: QueryClient, key: readonly unknown[]) =>
  (client.getQueryData<InfiniteData<CasePage>>(key)?.pages ?? []).flatMap(
    (page) => page.items,
  );

const rowOf = (client: QueryClient, key: readonly unknown[], n: number) =>
  rowsOf(client, key).find((row) => row.id === caseId(n));

async function waitForFullView() {
  await screen.findByText(SECRET);
  const region = await screen.findByRole("region", { name: "TODO" });
  await within(region).findByText(todoTitle(1));
}

/** 参加者としての行のまま：「参加中」に残り、「すべての案件」の行が最終更新・部屋の ID を持つ */
function expectListsKeptAsParticipant(client: QueryClient) {
  expect(rowsOf(client, JOINED_KEY).map((row) => row.id)).toEqual([
    caseId(N),
    caseId(OTHER_N),
  ]);
  expect(rowOf(client, ALL_KEY, N)).toEqual(
    expect.objectContaining({
      isParticipant: true,
      lastActivityAt: AT,
      channelId: caseRoomId(N),
    }),
  );
  expect(rowOf(client, ALL_KEY, OTHER_N)).toEqual(otherRow);
}

describe("#363 古い非参加の概要で案件を開いても、一覧のキャッシュを書き換えない", () => {
  // R-10：コードレビュー3回目（重大）。取り直しの結果が参加者なら、一覧の行は参加者のまま残る
  it("#363 R-10 AC-3: 概要のキャッシュが古い「成功・非参加」のとき、サーバーが参加者として返したら、参加者の表示になり、一覧（参加中・すべての案件）の行は参加者のまま残る", async () => {
    respondWorld(true);
    const { client } = renderPage({ summary: outsiderSummary(N), lists: true });
    await waitForFullView();
    await waitFor(() =>
      expect(client.getQueryData<CaseSummary>(SUMMARY_KEY)?.isParticipant).toBe(
        true,
      ),
    );
    expectListsKeptAsParticipant(client);
  });

  // R-11：本当に非参加でも、この画面で参加者だったことを見ていないので、一覧は書き換えない（main と同じ）。中身は消す（R-5 と同じ）
  it("#363 R-11 AC-3: 概要が古い「成功・非参加」で、サーバーも非参加を返したら、非公開の表示になり、一覧は書き換えず、詳細のキャッシュ（目印の値）は消える", async () => {
    respondWorld(false);
    const { client } = renderPage({
      summary: outsiderSummary(N),
      lists: true,
      sentinels: true,
    });
    await waitFor(() => expect(screen.getByText(PRIVATE_TEXT)).toBeTruthy());
    await waitFor(() => {
      expect(client.getQueryData(DETAIL_KEY)).toBeUndefined();
    });
    // 概要の取り直し（古い非参加の置き換え）が終わった後でも、一覧は書き換わらない
    // （用意で1回、取り直しの成功で2回になる）
    await waitFor(() =>
      expect(
        client.getQueryState(SUMMARY_KEY)?.dataUpdateCount,
      ).toBeGreaterThan(1),
    );
    expectListsKeptAsParticipant(client);
  });
});

// R-12（回帰）：この画面で、参加者として見た後に、概要が非参加・404 になったら、一覧を直す（main と同じ）。
// 既存のテストの場所：フックを直接呼ぶ useCaseAccessLoss.forget.test.tsx（#323）と、403 を契機にした CaseActivityAfterAccessLoss.test.tsx（#148）。
// 概要の取り直しの結果（成功して非参加・404）を契機にする、画面を通したものは無いため、ここに足す。
describe("#363 R-12 この画面で参加者として見た後に、参加者でなくなったら、一覧を直す（回帰）", () => {
  function expectListsCleaned(client: QueryClient) {
    expect(rowsOf(client, JOINED_KEY).map((row) => row.id)).toEqual([
      caseId(OTHER_N),
    ]);
    expect(rowOf(client, ALL_KEY, N)).toEqual(
      expect.objectContaining({
        isParticipant: false,
        lastActivityAt: null,
        channelId: null,
      }),
    );
    expect(rowOf(client, ALL_KEY, OTHER_N)).toEqual(otherRow);
  }

  it("#363 R-12 AC-3: 参加者として見た後、概要の取り直しが成功して非参加になったら、「参加中」から外れ、「すべての案件」の行は非参加の形になる", async () => {
    const w = respondWorld(true);
    const { client } = renderPage({ lists: true });
    await waitForFullView();
    expectListsKeptAsParticipant(client);
    w.participant = false;
    await act(async () => {
      await client.invalidateQueries({ queryKey: SUMMARY_KEY });
    });
    await waitFor(() => expect(screen.getByText(PRIVATE_TEXT)).toBeTruthy());
    await waitFor(() => expectListsCleaned(client));
  });

  it("#363 R-12 AC-2: 参加者として見た後、概要の取り直しが 404 になったら、「参加中」から外れ、「すべての案件」の行は非参加の形になる", async () => {
    const w = respondWorld(true);
    const { client } = renderPage({ lists: true });
    await waitForFullView();
    w.summaryFail = { status: 404 };
    await act(async () => {
      await client.invalidateQueries({ queryKey: SUMMARY_KEY });
    });
    expect(await screen.findByText(CASE_TEXTS.notFound)).toBeTruthy();
    await waitFor(() => expectListsCleaned(client));
  });
});

// R-13・R-14（統括の決定）：この画面で参加者として見ていない状態で、非参加・404 が確かめられたとき（作り直しの後・最初から非参加）、
// 一覧の行は書き換えない（古い概要を根拠に行を外さない）。代わりに、その利用者の一覧のクエリに「古い」と印を付け（invalidateQueries）、
// 次の取り直しで、サーバーの答えの形になるようにする。進行中の取得は取り消さない。
// 一覧のキャッシュは観測者がいない状態で用意し、「一覧へ移る」先も一覧を取り直さない部品なので、印は、この仕組みだけで付く。
const isInvalidated = (client: QueryClient, key: readonly unknown[]) =>
  client.getQueryState(key)?.isInvalidated === true;

function expectOtherUserListsUntouched(client: QueryClient) {
  expect(isInvalidated(client, OTHER_USER_JOINED_KEY)).toBe(false);
  expect(isInvalidated(client, OTHER_USER_ALL_KEY)).toBe(false);
}

describe("#363 R-13・R-14 参加者として見ていない非参加の確かめでは、一覧の行は書き換えず、一覧に古い印を付ける", () => {
  it("#363 R-14 AC-2: 参加者として開き、概要が 500 の間に画面を外し、外れている間に概要が 404 になってから戻ると、一覧の行は書き換えず、その利用者の一覧（参加中・すべての案件）に古い印が付き、ほかの利用者の一覧には付かない", async () => {
    const w = respondWorld(true);
    const { client, user } = renderPage({ lists: true });
    await waitForFullView();
    w.summaryFail = { status: 500 };
    await act(async () => {
      await client.invalidateQueries({ queryKey: SUMMARY_KEY });
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    await user.click(screen.getByRole("link", { name: "一覧へ移る" }));
    await screen.findByRole("link", { name: "案件に戻る" });
    // ここまでは、印も書き換えもない（5xx は資格を失った証拠ではない。#363 AC-1）
    expect(isInvalidated(client, JOINED_KEY)).toBe(false);
    expect(isInvalidated(client, ALL_KEY)).toBe(false);
    w.summaryFail = { status: 404 };
    await act(async () => {
      await client.refetchQueries({ queryKey: SUMMARY_KEY, exact: true });
    });
    await waitFor(() =>
      expect(client.getQueryState(SUMMARY_KEY)?.status).toBe("error"),
    );
    await user.click(screen.getByRole("link", { name: "案件に戻る" }));
    expect(await screen.findByText(CASE_TEXTS.notFound)).toBeTruthy();
    await waitFor(() => {
      expect(isInvalidated(client, JOINED_KEY)).toBe(true);
      expect(isInvalidated(client, ALL_KEY)).toBe(true);
    });
    expectListsKeptAsParticipant(client);
    expectOtherUserListsUntouched(client);
  });

  it("#363 R-13 AC-3: 概要が古い「成功・非参加」で、サーバーも非参加を返したら、一覧の行は書き換えず、その利用者の一覧に古い印が付き、ほかの利用者の一覧には付かない", async () => {
    respondWorld(false);
    const { client } = renderPage({ summary: outsiderSummary(N), lists: true });
    await waitFor(() => expect(screen.getByText(PRIVATE_TEXT)).toBeTruthy());
    await waitFor(() =>
      expect(
        client.getQueryState(SUMMARY_KEY)?.dataUpdateCount,
      ).toBeGreaterThan(1),
    );
    await waitFor(() => {
      expect(isInvalidated(client, JOINED_KEY)).toBe(true);
      expect(isInvalidated(client, ALL_KEY)).toBe(true);
    });
    expectListsKeptAsParticipant(client);
    expectOtherUserListsUntouched(client);
  });
});
