// #339 AC-1・AC-3（計画 plan-339 の 2 節・3 節「状態 × 出来事と副作用」・5 節、計画レビュー2回目）：案件の画面（S-17）の外での、資格の喪失の見張り。
// 全体の見張り installCaseAccessLossMonitor(queryClient) は、Query の出来事を1つの購読で受け、S-17 の担当が無いときに、画面の外の処理をする。
// 経路は3つ：取得済みの返信の 403・404／取得済みの部屋の 403・404／スレッド一覧の行の消失（行の消失だけでは確定しない。AC-3）。
// 確かめは、概要を GET /api/cases/:caseId（fetchCaseSummary）で直接1回取り、5種類（participant・lost・notFound・unverified・switched）に分ける。
// 3 節の表を、経路 × 判定でパラメータ化して固定する：
//   片付けの関数（後片付け＝forgetCaseAfterLeave は概要を非参加に書き、参加中の一覧の行を外す／中身片付け＝forgetCaseContent は、概要・一覧に触れない）、
//   スレッドの範囲（"room"：この部屋のスレッドだけを外し、別の部屋のスレッドは残す）、入口（requestAccessLossReload）、合図（announceCaseAccessLoss）、下書き。
// 確定時の順序：片付けの前に利用者・案件・部屋の ID を決める → 片付け → 入口 → 合図 → 下書き（C-207(8)・C-208(8)）。入口・合図が呼ばれた時点の状態を記録して比べる。
// 片付けの関数は差し替えず、キャッシュに残ったもの（観測できる結果）で見分ける。
// 前提にした口（実装の担当へ）：
//   features/cases/case-access-loss-monitor.ts の installCaseAccessLossMonitor(queryClient: QueryClient): () => void（解除の関数を返す。features/cases/index.ts から公開）。
//   現在の利用者は、セッションのキャッシュ（["auth","session"]）の利用者。入口の持ち主（ownerId）もその利用者。
//   返信の Query のデータ（["messages","thread",親ID]）は ThreadRepliesData に caseId: string | null を足した形。スレッド一覧は ["threads","list"] の無限の Query。
//   409 SESSION_USER_MISMATCH の後は features/auth の confirmSessionUserAfterMismatch、切り替えの入口は features/access-loss の isUserSwitchReloadRequested（このファイルで差し替える）。
//   想定外の例外（下書きの消去の TypeError など）は、もみ消さず reportError に渡す（中継と同じ。C-208(12)）。
// 入口は vi.fn（noteDraftsRemain も）。チャンネルはテスト専用の差し替え。待ち時間に頼らず、応答の保留を手で解く。データはすべて架空（testuser_・[UNIT_TEST]）。
import {
  InfiniteQueryObserver,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isUserSwitchReloadRequested } from "../access-loss";
import {
  noteDraftsRemain,
  requestAccessLossReload,
} from "../access-loss/reload-after-access-loss";
import {
  confirmSessionUserAfterMismatch,
  installUserSwitchGuard,
} from "../auth";
import {
  fetchLatestMessages,
  fetchLatestReplies,
} from "../messages/api/message-api";
import { fetchMyThreads } from "../threads/api/thread-api";
import { TEST_USER } from "../../test/auth-handlers";
import {
  caseDetail,
  caseId as caseIdOf,
  caseRoomId,
  caseSummary,
  outsiderSummary,
} from "../../test/case-handlers";
import {
  FakeBroadcastChannel,
  flushTasks,
} from "../../test/fake-broadcast-channel";
import { apiErrorResponse, message, reply } from "../../test/message-handlers";
import { server } from "../../test/server";
import { threadItem, type TestThread } from "../../test/thread-handlers";
import { fetchCases } from "./api/case-api";
import { installCaseAccessLossMonitor } from "./case-access-loss-monitor";
import { useRemoveCaseParticipant } from "./hooks/useCaseWrites";

vi.mock("../access-loss/reload-after-access-loss", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestAccessLossReload: vi.fn(() => Promise.resolve()),
  noteDraftsRemain: vi.fn(),
}));
vi.mock("../auth", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  confirmSessionUserAfterMismatch: vi.fn(() => Promise.resolve("same")),
}));
vi.mock("../access-loss", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isUserSwitchReloadRequested: vi.fn(() => false),
}));

const N = 339;
const USER = TEST_USER.id;
const OTHER_USER = "01JTESTUSER339000000000MO2";
const CASE = caseIdOf(N);
const ROOM = caseRoomId(N);
const OTHER_CASE = caseIdOf(3392);
const OTHER_ROOM = "01JTESTROOM339000000000MO2";
// 部屋の ID の前方一致になるだけの別の部屋
const SIMILAR_ROOM = `${ROOM}0`;
const CHANNEL = "internal-system:access-loss:v1";

const SESSION = {
  user: TEST_USER,
  mustChangePassword: false,
  reauthenticatedAt: null,
  permissions: [],
};

// キーは本番の関数を使わず、リテラルで独立に書く
const SUMMARY_KEY = ["cases", "summary", USER, CASE];
const DETAIL_KEY = ["cases", "detail", USER, CASE];
const JOINED_LIST_KEY = ["cases", "list", USER, "joined", "active"];
const THREAD_LIST_KEY = ["threads", "list"];
const threadKey = (parentId: string) => ["messages", "thread", parentId];
const roomKey = (roomId: string) => ["messages", "room", roomId];

/** 案件の部屋のスレッド（一覧の行。親の ID は message(1)） */
const CASE_ROW: TestThread = threadItem(1, {
  room: { kind: "channel", id: ROOM, name: "[UNIT_TEST]339案件の部屋" },
  caseId: CASE,
});
/** 通常のチャンネルのスレッド */
const CHANNEL_ROW: TestThread = threadItem(2, {
  room: { kind: "channel", id: OTHER_ROOM, name: "[UNIT_TEST]339通常の部屋" },
});
/** 同じ案件の部屋の、別のスレッド */
const CASE_ROW_2: TestThread = threadItem(3, {
  room: { kind: "channel", id: ROOM, name: "[UNIT_TEST]339案件の部屋" },
  caseId: CASE,
});
const CASE_PARENT = CASE_ROW.parent.id;
const OTHER_PARENT = CHANNEL_ROW.parent.id;

const draftKey = (userId: string, scope: string) =>
  `internal-system:draft:v1:${userId}:${scope}`;
/** 消すもの：持ち主の、この案件の部屋の投稿と、その部屋のスレッドの返信（2つ） */
const ERASED = [
  draftKey(USER, `room:${ROOM}`),
  draftKey(USER, `thread:${ROOM}:${CASE_PARENT}`),
  draftKey(USER, `thread:${ROOM}:${CASE_ROW_2.parent.id}`),
];
/** 残すもの：ほかの部屋・前方一致の部屋・申請・ほかの利用者の同じ部屋 */
const KEPT = [
  draftKey(USER, `room:${OTHER_ROOM}`),
  draftKey(USER, `room:${SIMILAR_ROOM}`),
  draftKey(USER, `thread:${SIMILAR_ROOM}:${CASE_PARENT}`),
  draftKey(USER, "case-request:new"),
  draftKey(OTHER_USER, `room:${ROOM}`),
  draftKey(OTHER_USER, `thread:${ROOM}:${CASE_PARENT}`),
];

function seedDrafts() {
  for (const key of [...ERASED, ...KEPT])
    window.localStorage.setItem(
      key,
      JSON.stringify({
        body: `[UNIT_TEST]339書きかけ ${key.slice(-6)}`,
        updatedAt: Date.now(),
      }),
    );
}
const present = (keys: string[]) =>
  keys.filter((key) => window.localStorage.getItem(key) !== null);
const draftsErased = () =>
  present(ERASED).length === 0 && present(KEPT).length === KEPT.length;
const draftsKept = () =>
  present(ERASED).length === ERASED.length &&
  present(KEPT).length === KEPT.length;

// ---- 概要の確かめの応答 ----

type Verdict = "participant" | "lost" | "notFound" | "unverified" | "switched";
type SummaryAnswer =
  | { kind: "participant" }
  | { kind: "outsider" }
  | { kind: "status"; status: number; code: string }
  | { kind: "network" };

type SummaryServer = {
  calls: string[];
  answer: SummaryAnswer;
  gate: Promise<void> | null;
};

function respondSummary(answer: SummaryAnswer): SummaryServer {
  const state: SummaryServer = { calls: [], answer, gate: null };
  server.use(
    http.get("/api/cases/:caseId", async ({ params }) => {
      state.calls.push(String(params.caseId));
      if (state.gate !== null) await state.gate;
      const current = state.answer;
      switch (current.kind) {
        case "participant":
          return HttpResponse.json(caseSummary(N));
        case "outsider":
          return HttpResponse.json(outsiderSummary(N));
        case "network":
          return HttpResponse.error();
        case "status":
          return apiErrorResponse(
            current.status,
            current.code,
            "[UNIT_TEST]339確かめの失敗",
          );
      }
    }),
  );
  return state;
}

/** 判定ごとの、確かめの応答と、409 の後の切り替えの差し替え */
function arrangeVerdict(verdict: Verdict | "unverifiedNetwork"): SummaryServer {
  switch (verdict) {
    case "participant":
      return respondSummary({ kind: "participant" });
    case "lost":
      return respondSummary({ kind: "outsider" });
    case "notFound":
      return respondSummary({ kind: "status", status: 404, code: "NOT_FOUND" });
    case "unverified":
      return respondSummary({
        kind: "status",
        status: 500,
        code: "INTERNAL_ERROR",
      });
    case "unverifiedNetwork":
      return respondSummary({ kind: "network" });
    case "switched":
      vi.mocked(confirmSessionUserAfterMismatch).mockResolvedValue("switched");
      vi.mocked(isUserSwitchReloadRequested).mockReturnValue(true);
      return respondSummary({
        kind: "status",
        status: 409,
        code: "SESSION_USER_MISMATCH",
      });
  }
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

// ---- キャッシュの準備（取得の実績は、実際の取得〔fetchQuery〕で作る。setQueryData は実績にしない） ----

function repliesData(parentId: string, roomId: string, caseId: string | null) {
  const parent = message(1, { id: parentId, roomId, replyCount: 1 });
  return {
    parent,
    replies: [reply(parent, 1)],
    replyBlockedReason: null,
    joined: true,
    roomWritable: true,
    caseRoom: caseId !== null,
    caseId,
  };
}

/** 返信を正常に取得した（成功のデータが Query に入る） */
async function fetchedReplies(
  parentId: string,
  roomId: string,
  caseId: string | null,
) {
  await client.fetchQuery({
    queryKey: threadKey(parentId),
    queryFn: () => Promise.resolve(repliesData(parentId, roomId, caseId)),
    staleTime: 0,
  });
}

/** 返信の取り直しが、本物の API 関数（MSW）で失敗する。直前の成功のデータは Query に残る */
async function failReplies(parentId: string, status: number, code: string) {
  server.use(
    http.get("/api/messages/:messageId/replies", () =>
      apiErrorResponse(status, code, "[UNIT_TEST]339返信の失敗"),
    ),
  );
  await client
    .fetchQuery({
      queryKey: threadKey(parentId),
      queryFn: () => fetchLatestReplies(parentId),
      staleTime: 0,
    })
    .catch(() => undefined);
}

async function fetchedRoom(roomId: string) {
  await client.fetchQuery({
    queryKey: roomKey(roomId),
    queryFn: () =>
      Promise.resolve([message(1, { roomId, body: "[UNIT_TEST]339本文" })]),
  });
}

async function failRoom(roomId: string, status: number, code: string) {
  server.use(
    http.get("/api/rooms/:roomId/messages", () =>
      apiErrorResponse(status, code, "[UNIT_TEST]339部屋の失敗"),
    ),
  );
  await client
    .fetchQuery({
      queryKey: roomKey(roomId),
      queryFn: () => fetchLatestMessages(roomId),
      staleTime: 0,
    })
    .catch(() => undefined);
}

// スレッド一覧（useMyThreads と同じキー・同じ取り方の無限の Query）。ページは cursor（p1, p2…）で返す
type ListServer = {
  pages: TestThread[][];
  calls: number;
  gate: Promise<void> | null;
  fail: number | null;
};
let list: ListServer;
let listObserver: ReturnType<typeof makeListObserver> | undefined;
let stopListObserver: (() => void) | undefined;

function respondList(pages: TestThread[][]): ListServer {
  const state: ListServer = { pages, calls: 0, gate: null, fail: null };
  server.use(
    http.get("/api/me/threads", async ({ request }) => {
      state.calls += 1;
      if (state.gate !== null) await state.gate;
      if (state.fail !== null)
        return apiErrorResponse(state.fail, "INTERNAL_ERROR");
      const cursor = new URL(request.url).searchParams.get("cursor");
      const index = cursor === null ? 0 : Number(cursor.slice(1));
      return HttpResponse.json({
        items: state.pages[index] ?? [],
        nextCursor: index + 1 < state.pages.length ? `p${index + 1}` : null,
      });
    }),
  );
  return state;
}

function makeListObserver() {
  return new InfiniteQueryObserver(client, {
    queryKey: THREAD_LIST_KEY,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      fetchMyThreads(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: { nextCursor: string | null }) =>
      last.nextCursor ?? undefined,
    retry: false,
  });
}

/** スレッド一覧を表示している（S-35 の一覧と同じ Query を、観察者つきで取る） */
async function openThreadList(pages: number) {
  listObserver = makeListObserver();
  stopListObserver = listObserver.subscribe(() => undefined);
  await vi.waitFor(() =>
    expect(client.getQueryState(THREAD_LIST_KEY)?.status).toBe("success"),
  );
  for (let page = 1; page < pages; page += 1)
    await listObserver.fetchNextPage();
}

/** 一覧を、サーバーから取り直す（読み込み済みのすべてのページ） */
async function refetchList() {
  await client
    .refetchQueries({ queryKey: THREAD_LIST_KEY })
    .catch(() => undefined);
}

/** 片付けの観察用：参加者の概要・詳細・参加中の一覧（いずれも手での書き込み。取得の実績にはしない）と、別の部屋のスレッド */
async function primeCaseCaches() {
  client.setQueryData(SUMMARY_KEY, caseSummary(N));
  client.setQueryData(DETAIL_KEY, caseDetail(N));
  client.setQueryData(JOINED_LIST_KEY, {
    pages: [{ items: [caseSummary(N)], nextCursor: null }],
    pageParams: [undefined],
  });
  await fetchedReplies(OTHER_PARENT, OTHER_ROOM, null);
}

// ---- 入口・合図の時点の記録 ----

type AtEntry = {
  request: unknown;
  detailCached: boolean;
  caseThreadCached: boolean;
  draftsKept: boolean | null;
  announcedBefore: number;
};
let atEntry: AtEntry[];
let draftsAtAnnounce: (boolean | null)[];
// 保存先を塞いだテストでは、記録の側で保存先を読まない
let storageBlocked = false;
const draftsKeptIfReadable = () => (storageBlocked ? null : draftsKept());

const entryCalls = () => vi.mocked(requestAccessLossReload).mock.calls;
const announced = () => FakeBroadcastChannel.sent(CHANNEL);

type Observed = {
  cleanup: "afterLeave" | "content" | "none";
  otherRoomThreadKept: boolean;
};

/** 片付けの関数とスレッドの範囲を、キャッシュに残ったものから見分ける */
function observeCleanup(): Observed {
  const summary = client.getQueryData<{ isParticipant: boolean }>(SUMMARY_KEY);
  const joined = client.getQueryData<{
    pages: { items: { id: string }[] }[];
  }>(JOINED_LIST_KEY);
  const rowKept =
    joined?.pages.some((page) => page.items.some((i) => i.id === CASE)) ??
    false;
  const detailGone = client.getQueryData(DETAIL_KEY) === undefined;
  const cleanup: Observed["cleanup"] = !detailGone
    ? "none"
    : summary?.isParticipant === false && !rowKept
      ? "afterLeave"
      : summary?.isParticipant === true && rowKept
        ? "content"
        : "none";
  return {
    cleanup,
    otherRoomThreadKept:
      client.getQueryData(threadKey(OTHER_PARENT)) !== undefined,
  };
}

let client: QueryClient;
let uninstall: (() => void) | undefined;
let reportError: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  reportError = vi.fn();
  vi.stubGlobal("reportError", reportError);
  FakeBroadcastChannel.clearSent();
  vi.mocked(confirmSessionUserAfterMismatch).mockReset();
  vi.mocked(confirmSessionUserAfterMismatch).mockResolvedValue("same");
  vi.mocked(isUserSwitchReloadRequested).mockReset();
  vi.mocked(isUserSwitchReloadRequested).mockReturnValue(false);
  vi.mocked(noteDraftsRemain).mockClear();
  atEntry = [];
  draftsAtAnnounce = [];
  storageBlocked = false;
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(["auth", "session"], SESSION);
  vi.mocked(requestAccessLossReload).mockReset();
  vi.mocked(requestAccessLossReload).mockImplementation((queryClient, req) => {
    atEntry.push({
      request: req,
      detailCached: queryClient.getQueryData(DETAIL_KEY) !== undefined,
      caseThreadCached:
        queryClient.getQueryData(threadKey(CASE_PARENT)) !== undefined,
      draftsKept: draftsKeptIfReadable(),
      announcedBefore: announced().length,
    });
    return Promise.resolve();
  });
  FakeBroadcastChannel.onPost.mockImplementation(() => {
    draftsAtAnnounce.push(draftsKeptIfReadable());
  });
  seedDrafts();
  uninstall = installCaseAccessLossMonitor(client);
});
afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  stopListObserver?.();
  stopListObserver = undefined;
  listObserver = undefined;
  client.clear();
  FakeBroadcastChannel.onPost.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---- 3 節の表 ----

type Expected = {
  cleanup: Observed["cleanup"];
  entry: boolean;
  announce: boolean;
  drafts: "erased" | "kept";
};

const DENIED: Expected = {
  cleanup: "afterLeave",
  entry: true,
  announce: true,
  drafts: "erased",
};
const NOT_FOUND: Expected = {
  cleanup: "content",
  entry: true,
  announce: true,
  drafts: "erased",
};
const NOTHING: Expected = {
  cleanup: "none",
  entry: false,
  announce: false,
  drafts: "kept",
};

/** 返信・部屋の 403・404 の後の確かめ（3 節の表の1〜10行目） */
const CONTENT_ROUTE: [Verdict, Expected][] = [
  ["lost", DENIED],
  ["notFound", NOT_FOUND],
  [
    "unverified",
    { cleanup: "content", entry: true, announce: false, drafts: "kept" },
  ],
  ["participant", NOTHING],
  ["switched", NOTHING],
];
/** スレッド一覧の行の消失の後の確かめ（3 節の表の11〜15行目） */
const LIST_ROUTE: [Verdict, Expected][] = [
  ["lost", DENIED],
  ["notFound", NOT_FOUND],
  ["unverified", NOTHING],
  ["participant", NOTHING],
  ["switched", NOTHING],
];

/** 期待した副作用が起きるまで待ち、さらにタスクを進めて、余分な副作用が出ないことを確かめられる状態にする */
async function waitForExpected(
  summary: SummaryServer,
  expected: Expected,
): Promise<void> {
  await vi.waitFor(() => expect(summary.calls).toEqual([CASE]));
  if (expected.entry)
    await vi.waitFor(() => expect(entryCalls()).toHaveLength(1));
  if (expected.announce)
    await vi.waitFor(() => expect(announced()).toHaveLength(1));
  if (expected.drafts === "erased")
    await vi.waitFor(() => expect(draftsErased()).toBe(true));
  await flushTasks(10);
}

/** 片付けの関数・スレッドの範囲 */
function expectCleanup(expected: Expected): void {
  const observed = observeCleanup();
  expect(observed.cleanup).toBe(expected.cleanup);
  // スレッドの範囲は "room"：別の部屋のスレッドを巻き込まない
  expect(observed.otherRoomThreadKept).toBe(true);
  if (expected.cleanup !== "none")
    expect(client.getQueryData(threadKey(CASE_PARENT))).toBeUndefined();
}

/** 入口・合図・下書きの有無 */
function expectEffects(expected: Expected): void {
  expect(entryCalls()).toHaveLength(expected.entry ? 1 : 0);
  expect(announced()).toEqual(
    expected.announce ? [{ v: 1, userId: USER, caseId: CASE }] : [],
  );
  expect(draftsKept()).toBe(expected.drafts === "kept");
  if (expected.drafts === "erased") expect(draftsErased()).toBe(true);
}

/** 片付け → 入口 → 合図 → 下書きの順（入口の時点で片付けは済み、合図と下書きの消去はまだ。合図の時点で下書きはまだある） */
function expectOrder(expected: Expected): void {
  if (expected.entry) {
    const [first] = atEntry;
    expect(entryCalls()[0]?.[0]).toBe(client);
    expect(first?.request).toEqual({ ownerId: USER, reason: "lost" });
    if (expected.cleanup !== "none") {
      expect(first?.detailCached).toBe(false);
      expect(first?.caseThreadCached).toBe(false);
    }
    expect(first?.announcedBefore).toBe(0);
    expect(first?.draftsKept).toBe(true);
  }
  if (!expected.announce) return;
  expect(draftsAtAnnounce).toEqual([true]);
  const entryOrder =
    vi.mocked(requestAccessLossReload).mock.invocationCallOrder[0] ?? 0;
  const announceOrder =
    FakeBroadcastChannel.onPost.mock.invocationCallOrder[0] ?? 0;
  expect(entryOrder).toBeGreaterThan(0);
  expect(entryOrder).toBeLessThan(announceOrder);
}

async function expectSideEffects(
  summary: SummaryServer,
  expected: Expected,
): Promise<void> {
  await waitForExpected(summary, expected);
  // 概要の確かめは1回だけ（キャッシュの外で直接取る。概要のキャッシュを取り直さない）
  expect(summary.calls).toEqual([CASE]);
  expectCleanup(expected);
  expectEffects(expected);
  expectOrder(expected);
  expect(reportError).not.toHaveBeenCalled();
}

describe("#339 AC-1 取得済みの返信・部屋の 403／404（3 節の表）", () => {
  for (const status of [403, 404] as const)
    it.each(CONTENT_ROUTE)(
      `#339 AC-1: 取得済みの返信・部屋の403／404から5種類に分岐する：返信の ${status} → 確かめが %s`,
      async (verdict, expected) => {
        await primeCaseCaches();
        await fetchedReplies(CASE_PARENT, ROOM, CASE);
        const summary = arrangeVerdict(verdict);
        await failReplies(
          CASE_PARENT,
          status,
          status === 403 ? "FORBIDDEN" : "NOT_FOUND",
        );
        await expectSideEffects(summary, expected);
      },
    );

  for (const status of [403, 404] as const)
    it.each(CONTENT_ROUTE)(
      `#339 AC-1: 取得済みの返信・部屋の403／404から5種類に分岐する：部屋の ${status} → 確かめが %s`,
      async (verdict, expected) => {
        await primeCaseCaches();
        // 案件の部屋のスレッドも取得済み（片付けの "room" の対象）
        await fetchedReplies(CASE_PARENT, ROOM, CASE);
        await fetchedRoom(ROOM);
        const summary = arrangeVerdict(verdict);
        await failRoom(
          ROOM,
          status,
          status === 403 ? "FORBIDDEN" : "NOT_FOUND",
        );
        await expectSideEffects(summary, expected);
      },
    );

  it("#339 AC-1: 取得済みの返信・部屋の403／404から5種類に分岐する：確かめが通信の失敗でも unverified（中身片付け・入口あり・合図なし・下書きは残る）", async () => {
    await primeCaseCaches();
    await fetchedReplies(CASE_PARENT, ROOM, CASE);
    const summary = arrangeVerdict("unverifiedNetwork");
    await failReplies(CASE_PARENT, 404, "NOT_FOUND");
    await expectSideEffects(summary, {
      cleanup: "content",
      entry: true,
      announce: false,
      drafts: "kept",
    });
  });
});

describe("#339 AC-1 返信の 404 は、直前に成功したデータの caseId で確かめる", () => {
  it("#339 AC-1: 返信の404は直前に成功したcaseIdで確認する：エラー応答に案件の ID が無くても、成功のデータの案件を1回確かめる", async () => {
    await fetchedReplies(CASE_PARENT, ROOM, CASE);
    const summary = arrangeVerdict("lost");
    await failReplies(CASE_PARENT, 404, "NOT_FOUND");
    await vi.waitFor(() => expect(entryCalls()).toHaveLength(1));
    expect(summary.calls).toEqual([CASE]);
  });

  it.each([
    ["初回から 404（成功のデータが無い）", "initial404"],
    ["通常のチャンネル・DM のスレッド（caseId が null）の 404", "plainRoom"],
    ["取得済みの返信の 500", "server500"],
    ["取得済みの返信の 401", "unauthenticated"],
    ["取得済みの返信の通信の失敗", "network"],
  ] as const)(
    "#339 AC-1: 返信の404は直前に成功したcaseIdで確認する：%sでは、確かめを始めない（GET 0回・入口なし・片付けなし）",
    async (_label, kind) => {
      const summary = arrangeVerdict("lost");
      client.setQueryData(DETAIL_KEY, caseDetail(N));
      if (kind === "initial404")
        await failReplies(CASE_PARENT, 404, "NOT_FOUND");
      else if (kind === "plainRoom") {
        await fetchedReplies(OTHER_PARENT, OTHER_ROOM, null);
        await failReplies(OTHER_PARENT, 404, "NOT_FOUND");
      } else {
        await fetchedReplies(CASE_PARENT, ROOM, CASE);
        if (kind === "server500")
          await failReplies(CASE_PARENT, 500, "INTERNAL_ERROR");
        else if (kind === "unauthenticated")
          await failReplies(CASE_PARENT, 401, "UNAUTHENTICATED");
        else {
          server.use(
            http.get("/api/messages/:messageId/replies", () =>
              HttpResponse.error(),
            ),
          );
          await client
            .fetchQuery({
              queryKey: threadKey(CASE_PARENT),
              queryFn: () => fetchLatestReplies(CASE_PARENT),
              staleTime: 0,
            })
            .catch(() => undefined);
        }
      }
      await flushTasks(10);
      expect(summary.calls).toEqual([]);
      expect(entryCalls()).toHaveLength(0);
      expect(announced()).toEqual([]);
      expect(client.getQueryData(DETAIL_KEY)).toBeDefined();
      expect(draftsKept()).toBe(true);
    },
  );

  it.each([
    ["初回から 404 の部屋", "initial"],
    ["案件との対応が分からない部屋（取得済み）の 404", "unknownRoom"],
  ] as const)(
    "#339 AC-1: 取得済みの返信・部屋の403／404から5種類に分岐する：%sでは、確かめを始めない",
    async (_label, kind) => {
      const summary = arrangeVerdict("lost");
      if (kind === "initial") {
        client.setQueryData(DETAIL_KEY, caseDetail(N));
        await failRoom(ROOM, 404, "NOT_FOUND");
      } else {
        await fetchedRoom(OTHER_ROOM);
        await failRoom(OTHER_ROOM, 404, "NOT_FOUND");
      }
      await flushTasks(10);
      expect(summary.calls).toEqual([]);
      expect(entryCalls()).toHaveLength(0);
    },
  );

  it("#339 AC-1: 同じ案件の確かめの途中に、返信と部屋の拒否が重なっても、確かめは1回（担当は1つ）", async () => {
    await fetchedReplies(CASE_PARENT, ROOM, CASE);
    await fetchedRoom(ROOM);
    const summary = arrangeVerdict("lost");
    const gate = deferred();
    summary.gate = gate.promise;
    await failReplies(CASE_PARENT, 404, "NOT_FOUND");
    await vi.waitFor(() => expect(summary.calls).toHaveLength(1));
    await failRoom(ROOM, 403, "FORBIDDEN");
    await flushTasks(5);
    expect(summary.calls).toHaveLength(1);
    // 確かめの答えが出る前は、片付け・入口・合図・下書きの消去をしない
    expect(entryCalls()).toHaveLength(0);
    expect(draftsKept()).toBe(true);
    summary.gate = null;
    gate.release();
    await vi.waitFor(() => expect(announced()).toHaveLength(1));
    await flushTasks(5);
    expect(summary.calls).toHaveLength(1);
    expect(entryCalls()).toHaveLength(1);
    expect(announced()).toHaveLength(1);
  });

  it("#339 AC-1: 解除した後は、取得済みの返信の 404 でも確かめない", async () => {
    await fetchedReplies(CASE_PARENT, ROOM, CASE);
    const summary = arrangeVerdict("lost");
    uninstall?.();
    uninstall = undefined;
    await failReplies(CASE_PARENT, 404, "NOT_FOUND");
    await flushTasks(10);
    expect(summary.calls).toEqual([]);
    expect(entryCalls()).toHaveLength(0);
  });
});

describe("#339 AC-1 switched（C-209）", () => {
  it("#339 AC-1: switchedでは喪失側の副作用を行わない：409 の後に別の利用者と確かめられ、切り替えの入口が動いている：片付け・入口・合図・下書きの消去なし", async () => {
    await primeCaseCaches();
    await fetchedReplies(CASE_PARENT, ROOM, CASE);
    const summary = arrangeVerdict("switched");
    await failReplies(CASE_PARENT, 404, "NOT_FOUND");
    await vi.waitFor(() => expect(summary.calls).toEqual([CASE]));
    await vi.waitFor(() =>
      expect(confirmSessionUserAfterMismatch).toHaveBeenCalled(),
    );
    await flushTasks(10);
    expect(observeCleanup().cleanup).toBe("none");
    expect(client.getQueryData(threadKey(CASE_PARENT))).toBeDefined();
    expect(entryCalls()).toHaveLength(0);
    expect(announced()).toEqual([]);
    expect(draftsKept()).toBe(true);
  });

  it.each([
    ["別の利用者だが、切り替えの入口が動いていない", "switched", false],
    ["同じ利用者のまま", "same", false],
    ["未ログイン", "unauthenticated", false],
    ["分からない", "unknown", true],
  ] as const)(
    "#339 AC-1: switchedでは喪失側の副作用を行わない：409 の後の確かめが「%s」なら unverified（中身片付け・入口あり・合図なし・下書きは残る）",
    async (_label, outcome, switchRequested) => {
      await primeCaseCaches();
      await fetchedReplies(CASE_PARENT, ROOM, CASE);
      const summary = respondSummary({
        kind: "status",
        status: 409,
        code: "SESSION_USER_MISMATCH",
      });
      vi.mocked(confirmSessionUserAfterMismatch).mockResolvedValue(outcome);
      vi.mocked(isUserSwitchReloadRequested).mockReturnValue(switchRequested);
      await failReplies(CASE_PARENT, 404, "NOT_FOUND");
      await expectSideEffects(summary, {
        cleanup: "content",
        entry: true,
        announce: false,
        drafts: "kept",
      });
    },
  );
});

describe("#339 AC-1 下書きは、持ち主の当該部屋だけを消す（C-207(5)(9)）", () => {
  it("#339 AC-1: 下書きは持ち主の当該部屋だけを消す：部屋への投稿と、その部屋の返信の下書き（複数）が消え、似た部屋 ID・申請・ほかの利用者の下書きは残る", async () => {
    await fetchedReplies(CASE_PARENT, ROOM, CASE);
    arrangeVerdict("lost");
    await failReplies(CASE_PARENT, 404, "NOT_FOUND");
    await vi.waitFor(() => expect(draftsErased()).toBe(true));
    expect(present(KEPT)).toEqual(KEPT);
    expect(noteDraftsRemain).not.toHaveBeenCalled();
  });

  it("#339 AC-1: 下書きは持ち主の当該部屋だけを消す：削除が SecurityError（保存先が使えない）なら、例外にせず、入口の後に noteDraftsRemain(持ち主) を呼ぶ", async () => {
    await fetchedReplies(CASE_PARENT, ROOM, CASE);
    arrangeVerdict("lost");
    const original = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (
      this: Storage,
      key: string,
    ) {
      if (key.startsWith("internal-system:draft:"))
        throw new DOMException("denied", "SecurityError");
      original.call(this, key);
    });
    await failReplies(CASE_PARENT, 404, "NOT_FOUND");
    await vi.waitFor(() => expect(noteDraftsRemain).toHaveBeenCalledWith(USER));
    const entryOrder =
      vi.mocked(requestAccessLossReload).mock.invocationCallOrder[0] ?? 0;
    const noteOrder =
      vi.mocked(noteDraftsRemain).mock.invocationCallOrder[0] ?? 0;
    expect(entryOrder).toBeGreaterThan(0);
    expect(entryOrder).toBeLessThan(noteOrder);
    expect(announced()).toHaveLength(1);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("#339 AC-1: 下書きは持ち主の当該部屋だけを消す：保存先を開けない（localStorage の参照が SecurityError）でも、入口と合図の後に noteDraftsRemain(持ち主) を呼ぶ", async () => {
    await fetchedReplies(CASE_PARENT, ROOM, CASE);
    const summary = arrangeVerdict("lost");
    const gate = deferred();
    summary.gate = gate.promise;
    await failReplies(CASE_PARENT, 403, "FORBIDDEN");
    await vi.waitFor(() => expect(summary.calls).toHaveLength(1));
    // 確かめの応答の前に、保存先を使えなくする
    storageBlocked = true;
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    summary.gate = null;
    gate.release();
    await vi.waitFor(() => expect(noteDraftsRemain).toHaveBeenCalledWith(USER));
    expect(entryCalls()).toHaveLength(1);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("#339 AC-1: 下書きは持ち主の当該部屋だけを消す：想定外の例外（TypeError）は、もみ消さず reportError に渡す。そのときも入口と合図は済んでいる", async () => {
    await fetchedReplies(CASE_PARENT, ROOM, CASE);
    arrangeVerdict("lost");
    const unexpected = new TypeError("[UNIT_TEST]339想定外");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw unexpected;
    });
    await failReplies(CASE_PARENT, 404, "NOT_FOUND");
    await vi.waitFor(() =>
      expect(reportError).toHaveBeenCalledWith(unexpected),
    );
    expect(entryCalls()).toHaveLength(1);
    expect(announced()).toHaveLength(1);
    expect(noteDraftsRemain).not.toHaveBeenCalled();
  });
});

describe("#339 AC-1 合図の印と読み込み直しの印は別（C-208(9)）", () => {
  it("#339 AC-1: unverifiedの後に確定しても合図と下書き処理を行う：一覧の行の消失 → 確かめが 500（この経路は何も片付けない）→ 残っている取得済みの返信の 404 → 非参加で、合図1回・下書きの消去", async () => {
    list = respondList([[CASE_ROW, CHANNEL_ROW]]);
    await openThreadList(1);
    await fetchedReplies(CASE_PARENT, ROOM, CASE);
    const summary = arrangeVerdict("unverified");
    list.pages = [[CHANNEL_ROW]];
    await refetchList();
    await vi.waitFor(() => expect(summary.calls).toEqual([CASE]));
    await flushTasks(10);
    // 一覧の経路の unverified：片付け・入口・合図・下書きの消去なし（計画 3 節）
    expect(entryCalls()).toHaveLength(0);
    expect(announced()).toEqual([]);
    expect(draftsKept()).toBe(true);
    expect(client.getQueryData(threadKey(CASE_PARENT))).toBeDefined();

    summary.answer = { kind: "outsider" };
    await failReplies(CASE_PARENT, 404, "NOT_FOUND");
    await vi.waitFor(() => expect(announced()).toHaveLength(1));
    await vi.waitFor(() => expect(draftsErased()).toBe(true));
    expect(summary.calls).toEqual([CASE, CASE]);
    expect(announced()).toEqual([{ v: 1, userId: USER, caseId: CASE }]);
    expect(entryCalls()).toHaveLength(1);
    expect(entryCalls()[0]?.[1]).toEqual({ ownerId: USER, reason: "lost" });
  });

  it("#339 AC-1: unverifiedの後に確定しても合図と下書き処理を行う：返信の 404 → 500（入口だけ）→ 新しい正常な取得で実績を得る → 404 → 非参加で、合図1回・下書きの消去（読み込み直しの印とは別）", async () => {
    await fetchedReplies(CASE_PARENT, ROOM, CASE);
    const summary = arrangeVerdict("unverified");
    await failReplies(CASE_PARENT, 404, "NOT_FOUND");
    await vi.waitFor(() => expect(entryCalls()).toHaveLength(1));
    await flushTasks(5);
    expect(announced()).toEqual([]);
    expect(draftsKept()).toBe(true);

    summary.answer = { kind: "outsider" };
    await fetchedReplies(CASE_PARENT, ROOM, CASE);
    await failReplies(CASE_PARENT, 404, "NOT_FOUND");
    await vi.waitFor(() => expect(announced()).toHaveLength(1));
    await vi.waitFor(() => expect(draftsErased()).toBe(true));
    expect(summary.calls).toEqual([CASE, CASE]);
    // 読み込み直しは入口が同じ持ち主の待機に合流する（呼び直しても、呼ばなくてもよい）。呼んだなら持ち主・理由は同じ
    for (const [, request] of entryCalls())
      expect(request).toEqual({ ownerId: USER, reason: "lost" });
  });

  it("#339 AC-1: unverifiedの後に確定しても合図と下書き処理を行う：参加者に戻った後の再びの喪失では、合図をもう一度送る。戻らないままの2回目の喪失では送らない", async () => {
    const summary = arrangeVerdict("lost");
    await fetchedReplies(CASE_PARENT, ROOM, CASE);
    await failReplies(CASE_PARENT, 404, "NOT_FOUND");
    await vi.waitFor(() => expect(announced()).toHaveLength(1));

    // 戻らないまま、もう一度取得の実績ができて、再び非参加
    await fetchedReplies(CASE_PARENT, ROOM, CASE);
    await failReplies(CASE_PARENT, 404, "NOT_FOUND");
    await vi.waitFor(() => expect(summary.calls).toHaveLength(2));
    await flushTasks(10);
    expect(announced()).toHaveLength(1);

    // 参加者に戻った（確かめが参加者）
    summary.answer = { kind: "participant" };
    await fetchedReplies(CASE_PARENT, ROOM, CASE);
    await failReplies(CASE_PARENT, 403, "FORBIDDEN");
    await vi.waitFor(() => expect(summary.calls).toHaveLength(3));
    await flushTasks(10);
    expect(announced()).toHaveLength(1);

    // 再びの喪失
    summary.answer = { kind: "outsider" };
    window.localStorage.setItem(
      draftKey(USER, `room:${ROOM}`),
      JSON.stringify({ body: "[UNIT_TEST]339再び", updatedAt: Date.now() }),
    );
    await fetchedReplies(CASE_PARENT, ROOM, CASE);
    await failReplies(CASE_PARENT, 404, "NOT_FOUND");
    await vi.waitFor(() => expect(announced()).toHaveLength(2));
    await vi.waitFor(() =>
      expect(
        window.localStorage.getItem(draftKey(USER, `room:${ROOM}`)),
      ).toBeNull(),
    );
  });
});

describe("#339 AC-3 スレッド一覧の行の消失（3 節の表）", () => {
  it.each(LIST_ROUTE)(
    "#339 AC-3: 行消失だけでは副作用を行わず、新しい概要で決める：確かめが %s",
    async (verdict, expected) => {
      await primeCaseCaches();
      list = respondList([[CASE_ROW, CHANNEL_ROW]]);
      await openThreadList(1);
      await fetchedReplies(CASE_PARENT, ROOM, CASE);
      const summary = arrangeVerdict(verdict);
      const gate = deferred();
      summary.gate = gate.promise;
      list.pages = [[CHANNEL_ROW]];
      await refetchList();
      await vi.waitFor(() => expect(summary.calls).toEqual([CASE]));
      // 行の消失だけでは、片付け・入口・合図・下書きの消去をしない（確かめの答えを待つ）
      await flushTasks(5);
      expect(observeCleanup().cleanup).toBe("none");
      expect(client.getQueryData(threadKey(CASE_PARENT))).toBeDefined();
      expect(entryCalls()).toHaveLength(0);
      expect(announced()).toEqual([]);
      expect(draftsKept()).toBe(true);
      summary.gate = null;
      gate.release();
      await expectSideEffects(summary, expected);
    },
  );

  it("#339 AC-3: 行消失だけでは副作用を行わず、新しい概要で決める：unverified の後は、次の確かめのきっかけ（行が戻って再び消える）を受けられる", async () => {
    list = respondList([[CASE_ROW, CHANNEL_ROW]]);
    await openThreadList(1);
    const summary = arrangeVerdict("unverified");
    list.pages = [[CHANNEL_ROW]];
    await refetchList();
    await vi.waitFor(() => expect(summary.calls).toHaveLength(1));
    await flushTasks(10);
    expect(entryCalls()).toHaveLength(0);

    summary.answer = { kind: "outsider" };
    list.pages = [[CASE_ROW, CHANNEL_ROW]];
    await refetchList();
    await flushTasks(5);
    expect(summary.calls).toHaveLength(1);
    list.pages = [[CHANNEL_ROW]];
    await refetchList();
    await vi.waitFor(() => expect(entryCalls()).toHaveLength(1));
    expect(summary.calls).toEqual([CASE, CASE]);
    expect(announced()).toHaveLength(1);
  });

  it("#339 AC-3: 行消失だけでは副作用を行わず、新しい概要で決める：同じ案件の行が2つ消えても、確かめは案件ごとに1回", async () => {
    list = respondList([[CASE_ROW, CASE_ROW_2, CHANNEL_ROW]]);
    await openThreadList(1);
    const summary = arrangeVerdict("lost");
    list.pages = [[CHANNEL_ROW]];
    await refetchList();
    await vi.waitFor(() => expect(entryCalls()).toHaveLength(1));
    await flushTasks(10);
    expect(summary.calls).toEqual([CASE]);
    expect(announced()).toHaveLength(1);
    // どちらの行の部屋も同じ：その部屋の下書き（2つのスレッドの返信を含む）が消える
    expect(draftsErased()).toBe(true);
  });

  it("#339 AC-3: 行消失だけでは副作用を行わず、新しい概要で決める：通常のチャンネル・DM の行（caseId が null）が消えても、確かめない", async () => {
    list = respondList([[CASE_ROW, CHANNEL_ROW]]);
    await openThreadList(1);
    const summary = arrangeVerdict("lost");
    list.pages = [[CASE_ROW]];
    await refetchList();
    await flushTasks(10);
    expect(summary.calls).toEqual([]);
    expect(entryCalls()).toHaveLength(0);
  });

  it("#339 AC-3: 行消失だけでは副作用を行わず、新しい概要で決める：一覧の取り直しが失敗しても（500）、消失とは扱わない", async () => {
    list = respondList([[CASE_ROW, CHANNEL_ROW]]);
    await openThreadList(1);
    const summary = arrangeVerdict("lost");
    list.fail = 500;
    await refetchList();
    await flushTasks(10);
    expect(client.getQueryState(THREAD_LIST_KEY)?.status).toBe("error");
    expect(summary.calls).toEqual([]);
  });
});

describe("#339 AC-3 消失として扱わない一覧の変化", () => {
  it.each([
    [
      "並び替え（同じ行の順番だけが変わる）",
      [[CASE_ROW, CHANNEL_ROW]],
      [[CHANNEL_ROW, CASE_ROW]],
    ],
    [
      "ページの間の移動（2ページ目の行が1ページ目へ、1ページ目の行が2ページ目へ）",
      [[CASE_ROW, CHANNEL_ROW], [CASE_ROW_2]],
      [[CASE_ROW_2, CASE_ROW], [CHANNEL_ROW]],
    ],
    [
      "親 ID の重複（同じ行が2つのページに出ていたのが1つになる）",
      [
        [CASE_ROW, CHANNEL_ROW],
        [CHANNEL_ROW, CASE_ROW_2],
      ],
      [[CASE_ROW, CHANNEL_ROW], [CASE_ROW_2]],
    ],
  ] as const)(
    "#339 AC-3: 並び替え・ページ移動・追加取得・手動更新・削除を行消失にしない：%s",
    async (_label, before, after) => {
      list = respondList(before.map((page) => [...page]));
      await openThreadList(before.length);
      const summary = arrangeVerdict("lost");
      list.pages = after.map((page) => [...page]);
      await refetchList();
      await flushTasks(10);
      expect(summary.calls).toEqual([]);
      expect(entryCalls()).toHaveLength(0);
    },
  );

  it("#339 AC-3: 並び替え・ページ移動・追加取得・手動更新・削除を行消失にしない：続きのページの追加の取得（fetchNextPage）", async () => {
    list = respondList([[CASE_ROW], [CHANNEL_ROW]]);
    await openThreadList(1);
    const summary = arrangeVerdict("lost");
    await listObserver?.fetchNextPage();
    await flushTasks(10);
    expect(summary.calls).toEqual([]);
  });

  it("#339 AC-3: 並び替え・ページ移動・追加取得・手動更新・削除を行消失にしない：手での書き換え（setQueryData で行を外す）", async () => {
    list = respondList([[CASE_ROW, CHANNEL_ROW]]);
    await openThreadList(1);
    const summary = arrangeVerdict("lost");
    client.setQueryData<{ pages: { items: TestThread[] }[] }>(
      THREAD_LIST_KEY,
      (previous) =>
        previous === undefined
          ? previous
          : {
              ...previous,
              pages: previous.pages.map((page) => ({
                ...page,
                items: page.items.filter((i) => i.caseId !== CASE),
              })),
            },
    );
    await flushTasks(10);
    expect(summary.calls).toEqual([]);
    // 手での書き換えの後の、サーバーの取り直しでも行が無い：書き換えの後の一覧と比べるので、消失ではない
    list.pages = [[CHANNEL_ROW]];
    await refetchList();
    await flushTasks(10);
    expect(summary.calls).toEqual([]);
  });

  it("#339 AC-3: 並び替え・ページ移動・追加取得・手動更新・削除を行消失にしない：Query の削除（removeQueries）の後に、行の無い一覧を新しく取る", async () => {
    list = respondList([[CASE_ROW, CHANNEL_ROW]]);
    await openThreadList(1);
    const summary = arrangeVerdict("lost");
    stopListObserver?.();
    stopListObserver = undefined;
    client.removeQueries({ queryKey: THREAD_LIST_KEY });
    list.pages = [[CHANNEL_ROW]];
    await openThreadList(1);
    await flushTasks(10);
    expect(summary.calls).toEqual([]);
  });

  it("#339 AC-3: 並び替え・ページ移動・追加取得・手動更新・削除を行消失にしない：取り直しの取り消し（cancelQueries）の後に、遅れて行の無い応答が届く", async () => {
    list = respondList([[CASE_ROW, CHANNEL_ROW]]);
    await openThreadList(1);
    const summary = arrangeVerdict("lost");
    const gate = deferred();
    list.gate = gate.promise;
    list.pages = [[CHANNEL_ROW]];
    const refetching = refetchList();
    await vi.waitFor(() => expect(list.calls).toBeGreaterThan(1));
    await client.cancelQueries({ queryKey: THREAD_LIST_KEY });
    list.gate = null;
    gate.release();
    await refetching;
    await flushTasks(10);
    expect(summary.calls).toEqual([]);
  });

  it("#339 AC-3: 並び替え・ページ移動・追加取得・手動更新・削除を行消失にしない：案件一覧の行の消失は、きっかけにしない", async () => {
    let joined = [caseSummary(N)];
    server.use(
      http.get("/api/cases", () =>
        HttpResponse.json({ items: joined, nextCursor: null }),
      ),
    );
    await client.fetchInfiniteQuery({
      queryKey: JOINED_LIST_KEY,
      queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
        fetchCases("joined", "active", pageParam),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last: { nextCursor: string | null }) =>
        last.nextCursor ?? undefined,
    });
    const summary = arrangeVerdict("lost");
    joined = [];
    await client.refetchQueries({ queryKey: JOINED_LIST_KEY });
    await flushTasks(10);
    expect(summary.calls).toEqual([]);
    expect(entryCalls()).toHaveLength(0);
  });
});

describe("#339 AC-1 別の利用者のキャッシュに作用させない", () => {
  it("#339 AC-1: 確かめの途中に別の利用者へ替わったら、非参加が届いても、片付け・入口・合図・下書きの消去をしない", async () => {
    await fetchedReplies(CASE_PARENT, ROOM, CASE);
    const summary = arrangeVerdict("lost");
    const gate = deferred();
    summary.gate = gate.promise;
    await failReplies(CASE_PARENT, 404, "NOT_FOUND");
    await vi.waitFor(() => expect(summary.calls).toHaveLength(1));
    client.setQueryData(["auth", "session"], {
      ...SESSION,
      user: {
        id: OTHER_USER,
        displayName: "testuser_339_b",
        loginId: "testuser_339_b",
      },
    });
    summary.gate = null;
    gate.release();
    await flushTasks(10);
    expect(entryCalls()).toHaveLength(0);
    expect(announced()).toEqual([]);
    expect(draftsKept()).toBe(true);
    expect(client.getQueryData(threadKey(CASE_PARENT))).toBeDefined();
  });

  it("#339 AC-1: セッションが無い（ログアウトの後）ときの拒否では、確かめを始めない", async () => {
    await fetchedReplies(CASE_PARENT, ROOM, CASE);
    const summary = arrangeVerdict("lost");
    client.removeQueries({ queryKey: ["auth", "session"] });
    await failReplies(CASE_PARENT, 404, "NOT_FOUND");
    await flushTasks(10);
    expect(summary.calls).toEqual([]);
    expect(entryCalls()).toHaveLength(0);
  });

  it("#339 AC-1: 別の案件の取得済みの返信の 404 は、その案件だけを確かめる（この案件の下書き・キャッシュに触れない）", async () => {
    await fetchedReplies(CASE_PARENT, ROOM, CASE);
    const otherParent = message(9).id;
    await fetchedReplies(otherParent, OTHER_ROOM, OTHER_CASE);
    const summary = arrangeVerdict("participant");
    await failReplies(otherParent, 404, "NOT_FOUND");
    await vi.waitFor(() => expect(summary.calls).toEqual([OTHER_CASE]));
    await flushTasks(10);
    expect(client.getQueryData(threadKey(CASE_PARENT))).toBeDefined();
    expect(draftsKept()).toBe(true);
  });
});

// ---- 統括の依頼（調査 inv339 の点2・点3・6）で足したもの ----

/** 確定の後に、同じ持ち主が、その部屋に新しく置いた下書き */
const NEW_DRAFT = draftKey(USER, `room:${ROOM}`);
function writeNewDraft() {
  window.localStorage.setItem(
    NEW_DRAFT,
    JSON.stringify({
      body: "[UNIT_TEST]339新しい書きかけ",
      updatedAt: Date.now(),
    }),
  );
}
const newDraftKept = () => window.localStorage.getItem(NEW_DRAFT) !== null;

describe("#339 AC-3 片付けの後の、新しい一覧の取得（計画 2 節「片付けでは比較用情報を破棄する」）", () => {
  it("#339 AC-3: 画面の外の確定（返信の 404 → 非参加）の後に、新しく一覧の取得を始めても、古い行から概要の確かめ・入口・合図・下書きの消去が増えない", async () => {
    list = respondList([[CASE_ROW, CHANNEL_ROW]]);
    await openThreadList(1);
    await fetchedReplies(CASE_PARENT, ROOM, CASE);
    const summary = arrangeVerdict("lost");
    await failReplies(CASE_PARENT, 404, "NOT_FOUND");
    await vi.waitFor(() => expect(draftsErased()).toBe(true));
    await flushTasks(5);
    writeNewDraft();
    list.pages = [[CHANNEL_ROW]];
    await refetchList();
    await flushTasks(10);
    expect(summary.calls).toEqual([CASE]);
    expect(entryCalls()).toHaveLength(1);
    expect(announced()).toHaveLength(1);
    expect(newDraftKept()).toBe(true);
  });

  it("#339 AC-3: 本人が自分で退出した後（S-17 の担当が無い）に、新しく一覧の取得を始めても、概要の確かめ・lost の入口・合図・下書きの消去が増えない", async () => {
    server.use(
      http.delete(
        "/api/cases/:caseId/participants/:userId",
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    list = respondList([[CASE_ROW, CHANNEL_ROW]]);
    await openThreadList(1);
    await fetchedReplies(CASE_PARENT, ROOM, CASE);
    const summary = arrangeVerdict("lost");
    const { result, unmount } = renderHook(
      () => useRemoveCaseParticipant(CASE),
      {
        wrapper: ({ children }) =>
          createElement(QueryClientProvider, { client }, children),
      },
    );
    await act(async () => {
      await result.current.mutateAsync({
        userId: USER,
        self: true,
        actorId: USER,
        roomId: ROOM,
      });
    });
    unmount();
    await flushTasks(5);
    const announcedAfterLeave = announced().length;
    expect(entryCalls().map(([, request]) => request)).toEqual([
      { ownerId: USER, reason: "left", leftCasePath: `/cases/${CASE}` },
    ]);
    writeNewDraft();
    list.pages = [[CHANNEL_ROW]];
    await refetchList();
    await flushTasks(10);
    expect(summary.calls).toEqual([]);
    expect(entryCalls()).toHaveLength(1);
    expect(announced()).toHaveLength(announcedAfterLeave);
    expect(newDraftKept()).toBe(true);
    expect(reportError).not.toHaveBeenCalled();
  });
});

describe("#339 AC-1 下書きの処理の印（計画 2 節「読み込み直し・合図・下書き処理の印は分ける」・3 節の 5、C-207(5)〜(9)）", () => {
  it("#339 AC-1: 下書きの処理は同じ喪失で1回：確定の後に同じ持ち主がその部屋へ新しい下書きを置き、同じ喪失がもう一度確定しても（参加者に戻っていない）、新しい下書きは残る", async () => {
    const summary = arrangeVerdict("lost");
    await fetchedReplies(CASE_PARENT, ROOM, CASE);
    await failReplies(CASE_PARENT, 404, "NOT_FOUND");
    await vi.waitFor(() => expect(draftsErased()).toBe(true));
    await flushTasks(5);
    writeNewDraft();
    await fetchedReplies(CASE_PARENT, ROOM, CASE);
    await failReplies(CASE_PARENT, 404, "NOT_FOUND");
    await vi.waitFor(() => expect(summary.calls).toHaveLength(2));
    await flushTasks(10);
    expect(newDraftKept()).toBe(true);
    expect(announced()).toHaveLength(1);
  });

  it("#339 AC-1: 下書きの処理は同じ喪失で1回：対照として、参加者に戻ったと確かめられた後の、本当の再びの喪失では、新しい下書きも消える", async () => {
    const summary = arrangeVerdict("lost");
    await fetchedReplies(CASE_PARENT, ROOM, CASE);
    await failReplies(CASE_PARENT, 404, "NOT_FOUND");
    await vi.waitFor(() => expect(draftsErased()).toBe(true));
    summary.answer = { kind: "participant" };
    await fetchedReplies(CASE_PARENT, ROOM, CASE);
    await failReplies(CASE_PARENT, 403, "FORBIDDEN");
    await vi.waitFor(() => expect(summary.calls).toHaveLength(2));
    await flushTasks(10);
    writeNewDraft();
    summary.answer = { kind: "outsider" };
    await fetchedReplies(CASE_PARENT, ROOM, CASE);
    await failReplies(CASE_PARENT, 404, "NOT_FOUND");
    await vi.waitFor(() => expect(newDraftKept()).toBe(false));
  });
});

describe("#339 AC-1 利用者の世代（計画 2 節「進行中の印も、その利用者の世代が終わった時点で無効にする」「完了時と副作用の直前に照合する」）", () => {
  it("#339 AC-1: A の確かめの途中に、切り替えの見張りがキャッシュを捨て（B）、その後セッションがまた A になっても、遅れて届いた古い非参加で、片付け・入口・合図・下書きの消去をしない", async () => {
    const stopGuard = installUserSwitchGuard(client);
    try {
      await fetchedReplies(CASE_PARENT, ROOM, CASE);
      const summary = arrangeVerdict("lost");
      const gate = deferred();
      summary.gate = gate.promise;
      await failReplies(CASE_PARENT, 404, "NOT_FOUND");
      await vi.waitFor(() => expect(summary.calls).toHaveLength(1));
      client.setQueryData(["auth", "session"], {
        ...SESSION,
        user: {
          id: OTHER_USER,
          displayName: "testuser_339_b",
          loginId: "testuser_339_b",
        },
      });
      client.setQueryData(["auth", "session"], SESSION);
      // A の新しい世代のキャッシュ（古い確かめの片付けの対象にしない）
      await fetchedReplies(CASE_PARENT, ROOM, CASE);
      summary.gate = null;
      gate.release();
      await flushTasks(10);
      expect(entryCalls()).toHaveLength(0);
      expect(announced()).toEqual([]);
      expect(draftsKept()).toBe(true);
      expect(client.getQueryData(threadKey(CASE_PARENT))).toBeDefined();
    } finally {
      stopGuard();
    }
  });
});
