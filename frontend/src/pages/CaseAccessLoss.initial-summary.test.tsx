// #339 AC-2（計画 plan-339 の 3 節「初回の新しい概要」・5 節「決定2・3の4分岐」の画面の2件、計画レビュー2回目の N-2・N-3）：
// 概要を一度も取得していない状態で、S-17 を開いた初回の概要が非参加・404 のとき。
//   決定2（C-206(4)・C-207(6) の置き換え。受け入れ条件への追記）：その案件の部屋・スレッドの取得の実績があれば、片付けたうえで読み込み直す。
//     片付け（非参加は後片付け・404 は中身片付け。スレッドは "room"）→ 入口 → 合図 → その部屋の下書きの消去、を順に1回ずつ。
//     404 は、概要・案件一覧を非参加に書き換えない。
//   実績がなければ、いままでどおり：中身の片付けだけで、入口0・合図0・下書きは残る（#338 P-7・P-7c、#340 D-2 と同じ）。
//   案件一覧の行・案件の詳細・ほかの案件や通常の部屋のスレッドは、実績にしない。
// N-2：初回の概要は S-17 のフックが扱う。全体の見張り（main.tsx と同じく登録する）は、同じ処理をしない（入口・合図・下書きの消去が二重にならない）。
// N-3：実績の判定と部屋の ID の読み取りは、片付けより前。部屋の ID は返信のデータ（parent.roomId）からだけ分かる準備で、
//   片付けが返信のキャッシュを消した後でも、入口・合図・下書きの消去が1回ずつ起きることを確かめる。
// 入口は test/setup.ts の vi.fn（呼ばれた時点のキャッシュ・下書き・合図の数を記録する）。チャンネルはテスト専用の差し替え。
// 実績は、実際の取得（fetchQuery）でキャッシュに入れる。データはすべて架空（testuser_・[UNIT_TEST]）。
// 前提にした口（実装の担当へ）：features/cases（index）の installCaseAccessLossMonitor(queryClient): () => void。
//   返信の Query のデータ（["messages","thread",親ID]）は ThreadRepliesData に caseId: string | null を足した形。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestAccessLossReload } from "../features/access-loss";
import { authKeys } from "../features/auth";
import { caseKeys, installCaseAccessLossMonitor } from "../features/cases";
import { TEST_USER } from "../test/auth-handlers";
import {
  CASE_TEXTS,
  caseId,
  caseRoomId,
  caseSummary,
  outsiderSummary,
} from "../test/case-handlers";
import { respondTodos } from "../test/case-todo-handlers";
import {
  FakeBroadcastChannel,
  flushTasks,
} from "../test/fake-broadcast-channel";
import { apiErrorResponse, message, reply } from "../test/message-handlers";
import { server } from "../test/server";
import { CaseDetailPage } from "./CaseDetailPage";

const N = 3391;
const CASE = caseId(N);
const ROOM = caseRoomId(N);
const OTHER_ROOM = "01JTESTROOM339000000000IS2";
const CASE_PATH = `/cases/${CASE}`;
const CHANNEL = "internal-system:access-loss:v1";
const PRIVATE_TEXT = CASE_TEXTS.participantsOnly;

const SUMMARY_KEY = caseKeys.summary(TEST_USER.id, CASE);
const DETAIL_KEY = caseKeys.detail(TEST_USER.id, CASE);
const JOINED_LIST_KEY = caseKeys.list(TEST_USER.id, "joined", "active");
const CASE_PARENT = message(1, { roomId: ROOM }).id;
const OTHER_PARENT = "01JTESTMSG3390000000000IS2";
const OTHER_CASE_PARENT = "01JTESTMSG3390000000000IS3";
const threadKey = (parentId: string) => ["messages", "thread", parentId];

const draftKey = (scope: string) =>
  `internal-system:draft:v1:${TEST_USER.id}:${scope}`;
const CASE_DRAFTS = [
  draftKey(`room:${ROOM}`),
  draftKey(`thread:${ROOM}:${CASE_PARENT}`),
];
const OTHER_DRAFT = draftKey(`room:${OTHER_ROOM}`);
const caseDraftsPresent = () =>
  CASE_DRAFTS.filter((key) => window.localStorage.getItem(key) !== null).length;

const SESSION = {
  user: TEST_USER,
  mustChangePassword: false,
  reauthenticatedAt: null,
  permissions: [],
};

type Opening = "outsider" | "notFound";

function respondCase(opening: Opening) {
  respondTodos([]);
  server.use(
    http.get("/api/auth/session", () => HttpResponse.json(SESSION)),
    http.get("/api/cases/:caseId", () =>
      opening === "outsider"
        ? HttpResponse.json(outsiderSummary(N))
        : apiErrorResponse(404, "NOT_FOUND", CASE_TEXTS.notFound),
    ),
    http.get("/api/cases/:caseId/detail", () =>
      opening === "outsider"
        ? apiErrorResponse(403, "FORBIDDEN", PRIVATE_TEXT)
        : apiErrorResponse(404, "NOT_FOUND", CASE_TEXTS.notFound),
    ),
    http.get("/api/rooms/:roomId/messages", () =>
      apiErrorResponse(403, "FORBIDDEN", PRIVATE_TEXT),
    ),
  );
}

function repliesData(
  parentId: string,
  roomId: string,
  caseIdValue: string | null,
) {
  const parent = message(1, { id: parentId, roomId, replyCount: 1 });
  return {
    parent,
    replies: [reply(parent, 1, { body: "[UNIT_TEST]339返信" })],
    replyBlockedReason: null,
    joined: true,
    roomWritable: true,
    caseRoom: caseIdValue !== null,
    caseId: caseIdValue,
  };
}

async function fetchedReplies(
  client: QueryClient,
  parentId: string,
  roomId: string,
  caseIdValue: string | null,
) {
  await client.fetchQuery({
    queryKey: threadKey(parentId),
    queryFn: () => Promise.resolve(repliesData(parentId, roomId, caseIdValue)),
  });
}

type AtEntry = {
  request: unknown;
  caseThreadCached: boolean;
  caseDrafts: number;
  announced: number;
};
let atEntry: AtEntry[];
let draftsAtAnnounce: number[];
let uninstall: (() => void) | undefined;

const announced = () => FakeBroadcastChannel.sent(CHANNEL);
const entryCalls = () => vi.mocked(requestAccessLossReload).mock.calls;

/** 概要を一度も取得していない QueryClient。prime で、開く前のキャッシュ（実績など）を作る。見張りは main.tsx と同じく登録する */
async function openCase(prime: (client: QueryClient) => Promise<void>) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  client.setQueryData(authKeys.session, SESSION);
  uninstall = installCaseAccessLossMonitor(client);
  await prime(client);
  expect(client.getQueryData(SUMMARY_KEY)).toBeUndefined();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[CASE_PATH]}>
        <Routes>
          <Route path="/cases/:caseId" element={<CaseDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  vi.stubGlobal("reportError", vi.fn());
  FakeBroadcastChannel.clearSent();
  atEntry = [];
  draftsAtAnnounce = [];
  vi.mocked(requestAccessLossReload).mockReset();
  vi.mocked(requestAccessLossReload).mockImplementation((client, request) => {
    atEntry.push({
      request,
      caseThreadCached:
        client.getQueryData(threadKey(CASE_PARENT)) !== undefined,
      caseDrafts: caseDraftsPresent(),
      announced: announced().length,
    });
    return Promise.resolve();
  });
  FakeBroadcastChannel.onPost.mockImplementation(() => {
    draftsAtAnnounce.push(caseDraftsPresent());
  });
  for (const key of [...CASE_DRAFTS, OTHER_DRAFT])
    window.localStorage.setItem(
      key,
      JSON.stringify({ body: "[UNIT_TEST]339書きかけ", updatedAt: Date.now() }),
    );
});
afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  FakeBroadcastChannel.onPost.mockReset();
  vi.unstubAllGlobals();
});

async function waitForOpened(opening: Opening) {
  expect(
    await screen.findByText(
      opening === "outsider" ? PRIVATE_TEXT : CASE_TEXTS.notFound,
    ),
  ).toBeTruthy();
}

function joinedRowKept(client: QueryClient): boolean {
  const joined = client.getQueryData<{ pages: { items: { id: string }[] }[] }>(
    JOINED_LIST_KEY,
  );
  return (
    joined?.pages.some((page) => page.items.some((item) => item.id === CASE)) ??
    false
  );
}

describe("#339 AC-2 決定2：部屋・スレッドの取得の実績がある初回の非参加・404", () => {
  it.each([
    ["非参加", "outsider"],
    ["404", "notFound"],
  ] as const)(
    "#339 AC-2: 部屋・スレッドの取得実績がある初回非参加は、片付け・入口・合図・下書き消去を順に1回行う（初回が%s）",
    async (_label, opening) => {
      respondCase(opening);
      const client = await openCase(async (primed) => {
        await fetchedReplies(primed, CASE_PARENT, ROOM, CASE);
        await fetchedReplies(primed, OTHER_PARENT, OTHER_ROOM, null);
        primed.setQueryData(JOINED_LIST_KEY, {
          pages: [{ items: [caseSummary(N)], nextCursor: null }],
          pageParams: [undefined],
        });
      });
      await waitForOpened(opening);
      await waitFor(() => expect(announced()).toHaveLength(1));
      await waitFor(() => expect(caseDraftsPresent()).toBe(0));
      await flushTasks(10);

      // 入口・合図は1回ずつ（N-2：見張りの側が同じ処理を重ねない）
      expect(entryCalls()).toHaveLength(1);
      expect(atEntry[0]?.request).toEqual({
        ownerId: TEST_USER.id,
        reason: "lost",
      });
      expect(announced()).toEqual([
        { v: 1, userId: TEST_USER.id, caseId: CASE },
      ]);
      // 順序：入口の時点で片付けは済み（その部屋のスレッドが無い）、合図と下書きの消去はまだ。合図の時点で下書きはまだある
      expect(atEntry[0]?.caseThreadCached).toBe(false);
      expect(atEntry[0]?.announced).toBe(0);
      expect(atEntry[0]?.caseDrafts).toBe(CASE_DRAFTS.length);
      expect(draftsAtAnnounce).toEqual([CASE_DRAFTS.length]);
      // スレッドは "room"：別の部屋のスレッドを巻き込まない。ほかの部屋の下書きは残る
      expect(client.getQueryData(threadKey(OTHER_PARENT))).toBeDefined();
      expect(window.localStorage.getItem(OTHER_DRAFT)).not.toBeNull();
      if (opening === "outsider") {
        // 後片付け：参加中の一覧から行を外す
        expect(joinedRowKept(client)).toBe(false);
      } else {
        // 404 は、概要・案件一覧を非参加に書き換えない
        expect(joinedRowKept(client)).toBe(true);
        expect(client.getQueryData(SUMMARY_KEY)).toBeUndefined();
      }
    },
  );

  it.each([
    ["非参加", "outsider"],
    ["404", "notFound"],
  ] as const)(
    "#339 AC-2 N-3: 部屋の ID が返信のデータからだけ分かる準備で、片付けが返信のキャッシュを消した後でも、入口・合図・下書きの消去が1回ずつ起きる（初回が%s）",
    async (_label, opening) => {
      respondCase(opening);
      const client = await openCase(async (primed) => {
        await fetchedReplies(primed, CASE_PARENT, ROOM, CASE);
      });
      await waitForOpened(opening);
      await waitFor(() => expect(caseDraftsPresent()).toBe(0));
      await flushTasks(10);
      expect(client.getQueryData(threadKey(CASE_PARENT))).toBeUndefined();
      expect(entryCalls()).toHaveLength(1);
      expect(announced()).toHaveLength(1);
      expect(window.localStorage.getItem(OTHER_DRAFT)).not.toBeNull();
    },
  );
});

describe("#339 AC-2 決定2：部屋・スレッドの取得の実績がない初回の非参加・404（いままでどおり）", () => {
  it.each([
    ["非参加", "outsider"],
    ["404", "notFound"],
  ] as const)(
    "#339 AC-2: 部屋・スレッドの取得実績がない初回非参加は、中身の片付けだけで読み込み直さない（初回が%s。案件一覧の行・詳細・ほかの案件と通常の部屋のスレッドは実績にしない）",
    async (_label, opening) => {
      respondCase(opening);
      const client = await openCase(async (primed) => {
        primed.setQueryData(DETAIL_KEY, {
          sentinel: "[UNIT_TEST]339既存の詳細",
        });
        primed.setQueryData(JOINED_LIST_KEY, {
          pages: [{ items: [caseSummary(N)], nextCursor: null }],
          pageParams: [undefined],
        });
        await fetchedReplies(primed, OTHER_PARENT, OTHER_ROOM, null);
        await fetchedReplies(
          primed,
          OTHER_CASE_PARENT,
          OTHER_ROOM,
          caseId(3399),
        );
      });
      await waitForOpened(opening);
      // 中身の片付けは走る
      await waitFor(() =>
        expect(client.getQueryData(DETAIL_KEY)).toBeUndefined(),
      );
      await flushTasks(10);
      expect(entryCalls()).toHaveLength(0);
      expect(announced()).toEqual([]);
      expect(caseDraftsPresent()).toBe(CASE_DRAFTS.length);
      expect(window.localStorage.getItem(OTHER_DRAFT)).not.toBeNull();
    },
  );
});
