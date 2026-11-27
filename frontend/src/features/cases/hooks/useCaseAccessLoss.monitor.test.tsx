// #339 AC-1・AC-2（計画 plan-339 の 2 節「S-17 と見張りの分担」・5 節、計画レビュー2回目の N-2・N-3）：
// Query の出来事を受ける購読は、全体の見張り（installCaseAccessLossMonitor）の1つだけ。表示中の S-17（useCaseAccessLoss）は、
// 利用者・案件の担当として見張りに登録し、見張りは同じ利用者・案件の候補をフックへ渡す（自分では確かめ・片付け・入口・合図・下書きの消去をしない）。
//   - 同じ拒否を、全体の見張りとフックの両方が受けても、確かめは1回。合図・下書きの消去も1回（二重にならない）
//   - フックだけを置いても（main.tsx の登録が無くても）、フックが同じ QueryClient に見張りを冪等に設けて動く
//   - 確かめの途中に画面を離れ、同じ案件の画面を作り直しても、担当を二重に作らない。始めた確かめが最後まで処理し、読み込み直しを取りこぼさない
//   - 初回の概要（N-2：初回の概要は S-17 のフックが扱う。見張りの側は同じ処理をしない）と、見張りの確かめの結果が重なっても、確定の副作用は1回
//     （初期表示と登録の順序、StrictMode の登録の解除・登録し直しを含む）
//   - N-3：初回の概要の経路でも、実績の判定と部屋の ID の読み取りは片付けより前。片付けで返信のキャッシュが消えても、入口・合図・下書きの消去が1回ずつ起きる
// フックの概要の確かめは、概要の Query の取り直し（setQueryDefaults の queryFn）で数え、見張りの直接の確かめは MSW（GET /api/cases/:caseId）で数える。合計で比べる。
// 前提にした口（実装の担当へ）：features/cases/case-access-loss-monitor.ts の installCaseAccessLossMonitor(queryClient): () => void（同じ QueryClient に冪等）。
//   useCaseAccessLoss の引数は変えない。返信の Query のデータは ThreadRepliesData に caseId を足した形。
// キーは本番の関数を使わず、リテラルで独立に書く。データはすべて架空（testuser_339_・[UNIT_TEST]）。
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestAccessLossReload } from "../../access-loss/reload-after-access-loss";
import {
  FakeBroadcastChannel,
  flushTasks,
} from "../../../test/fake-broadcast-channel";
import { server } from "../../../test/server";
import {
  installCaseAccessLossMonitor,
  startCaseParticipationPeriod,
} from "../case-access-loss-monitor";
import { useCaseAccessLoss } from "./useCaseAccessLoss";

vi.mock(
  "../../access-loss/reload-after-access-loss",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    requestAccessLossReload: vi.fn(() => Promise.resolve()),
    noteDraftsRemain: vi.fn(),
  }),
);

const USER = "01JTESTUSER339000000000HM1";
const CASE = "01JTESTCASE339000000000HM1";
const ROOM = "01JTESTROOM339000000000HM1";
const OTHER_ROOM = "01JTESTROOM339000000000HM2";
const PARENT = "01JTESTMSG3390000000000HM1";
const OTHER_PARENT = "01JTESTMSG3390000000000HM2";
const CHANNEL = "internal-system:access-loss:v1";

const SUMMARY = ["cases", "summary", USER, CASE];
const DETAIL = ["cases", "detail", USER, CASE];
const ROOM_KEY = ["messages", "room", ROOM];
const threadKey = (parentId: string) => ["messages", "thread", parentId];

const draftKey = (scope: string) => `internal-system:draft:v1:${USER}:${scope}`;
const DRAFTS = [draftKey(`room:${ROOM}`), draftKey(`thread:${ROOM}:${PARENT}`)];
const OTHER_DRAFT = draftKey(`room:${OTHER_ROOM}`);
const draftsPresent = () =>
  DRAFTS.filter((key) => window.localStorage.getItem(key) !== null).length;

function summary(isParticipant: boolean) {
  return {
    id: CASE,
    caseNumber: "QZA-261125-0339",
    title: "[UNIT_TEST]339件名",
    status: "active",
    client: {
      id: "01JTESTCLIENT339000000HM1",
      name: "[UNIT_TEST]339取引先",
      isActive: true,
    },
    departments: [],
    dueDate: null,
    isParticipant,
    canManage: false,
    participantCount: isParticipant ? 2 : null,
    canEditDueDate: false,
    progress: null,
    lastActivityAt: isParticipant ? "2026-11-25T00:00:00.000Z" : null,
    channelId: isParticipant ? ROOM : null,
  };
}

function repliesData(parentId: string, roomId: string, caseId: string | null) {
  return {
    parent: {
      id: parentId,
      roomId,
      author: {
        id: "01JTESTUSER339000000000HM9",
        displayName: "testuser_339_author",
        isActive: true,
      },
      body: "[UNIT_TEST]339親",
      createdAt: "2026-11-25T00:00:00.000Z",
      editedAt: null,
      deleted: false,
      parentMessageId: null,
      replyCount: 0,
      mentions: [],
      reactions: [],
      attachments: [],
    },
    replies: [],
    replyBlockedReason: null,
    joined: true,
    roomWritable: true,
    caseRoom: caseId !== null,
    caseId,
  };
}

type Answer = "participant" | "lost" | "notFound" | "error500" | "network";

let client: QueryClient;
let answer: Answer;
let gate: Promise<void> | null;
// 初回の概要の取得（画面が取る概要）だけを保留する。見張りの確かめの保留（gate）とは別
let summaryGate: Promise<void> | null = null;
let hookChecks: number;
let directChecks: number;
let uninstall: (() => void) | undefined;
let atEntry: { caseThreadCached: boolean; drafts: number; announced: number }[];
let draftsAtAnnounce: number[];

const verifications = () => hookChecks + directChecks;
const announced = () => FakeBroadcastChannel.sent(CHANNEL);
const entryCalls = () => vi.mocked(requestAccessLossReload).mock.calls;

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function fetched(queryKey: unknown[], data: unknown) {
  await client.fetchQuery({
    queryKey,
    queryFn: () => Promise.resolve(data),
    staleTime: 0,
  });
}

async function fail(queryKey: unknown[], status: number) {
  await client
    .fetchQuery({
      queryKey,
      queryFn: () =>
        Promise.reject({
          status,
          code: status === 404 ? "NOT_FOUND" : "FORBIDDEN",
          message: "[UNIT_TEST]339拒否",
        }),
      staleTime: 0,
    })
    .catch(() => undefined);
}

type Props = {
  isParticipant: boolean;
  outsider: boolean;
  roomId: string | null;
  participantRoomId: string | null;
};

const PARTICIPANT_PROPS: Props = {
  isParticipant: true,
  outsider: false,
  roomId: ROOM,
  participantRoomId: ROOM,
};
const INITIAL_OUTSIDER_PROPS: Props = {
  isParticipant: false,
  outsider: true,
  roomId: null,
  participantRoomId: null,
};

function mountS17(initial: Props, options: { strict?: boolean } = {}) {
  const onLost = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    (props: Props) =>
      useCaseAccessLoss({
        caseId: CASE,
        userId: USER,
        roomId: props.roomId,
        participantRoomId: props.participantRoomId,
        isParticipant: props.isParticipant,
        outsider: props.outsider,
        onLost,
      }),
    // StrictMode はルートの側で指定する（効果の登録 → 解除 → 再登録を確実に通す）。wrapper の中の <StrictMode> では、
    // この版（React 19.3.1・Testing Library 16.3.3）で効果が1回しか登録されないことを確かめた（#339 コードレビュー2回目）
    {
      wrapper,
      initialProps: initial,
      reactStrictMode: options.strict === true,
    },
  );
  return { ...view, onLost };
}

beforeEach(() => {
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  vi.stubGlobal("reportError", vi.fn());
  FakeBroadcastChannel.clearSent();
  answer = "lost";
  gate = null;
  summaryGate = null;
  hookChecks = 0;
  directChecks = 0;
  atEntry = [];
  draftsAtAnnounce = [];
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(["auth", "session"], {
    user: {
      id: USER,
      displayName: "testuser_339_hm",
      loginId: "testuser_339_hm",
    },
    mustChangePassword: false,
    reauthenticatedAt: null,
    permissions: [],
  });
  client.setQueryDefaults(SUMMARY, {
    queryFn: async () => {
      hookChecks += 1;
      if (summaryGate !== null) await summaryGate;
      else if (gate !== null) await gate;
      if (answer === "notFound")
        throw { status: 404, code: "NOT_FOUND", message: "[UNIT_TEST]339" };
      if (answer === "error500")
        throw {
          status: 500,
          code: "INTERNAL_ERROR",
          message: "[UNIT_TEST]339",
        };
      if (answer === "network") throw new TypeError("[UNIT_TEST]339通信の失敗");
      return summary(answer === "participant");
    },
  });
  server.use(
    http.get("/api/cases/:caseId", async () => {
      directChecks += 1;
      if (gate !== null) await gate;
      if (answer === "notFound")
        return HttpResponse.json(
          { code: "NOT_FOUND", message: "[UNIT_TEST]339" },
          { status: 404 },
        );
      if (answer === "error500")
        return HttpResponse.json(
          { code: "INTERNAL_ERROR", message: "[UNIT_TEST]339" },
          { status: 500 },
        );
      if (answer === "network") return HttpResponse.error();
      return HttpResponse.json(summary(answer === "participant"));
    }),
  );
  vi.mocked(requestAccessLossReload).mockReset();
  vi.mocked(requestAccessLossReload).mockImplementation((queryClient) => {
    atEntry.push({
      caseThreadCached:
        queryClient.getQueryData(threadKey(PARENT)) !== undefined,
      drafts: draftsPresent(),
      announced: announced().length,
    });
    return Promise.resolve();
  });
  FakeBroadcastChannel.onPost.mockImplementation(() => {
    draftsAtAnnounce.push(draftsPresent());
  });
  for (const key of [...DRAFTS, OTHER_DRAFT])
    window.localStorage.setItem(
      key,
      JSON.stringify({ body: "[UNIT_TEST]339書きかけ", updatedAt: Date.now() }),
    );
});
afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  client.clear();
  FakeBroadcastChannel.onPost.mockReset();
  vi.unstubAllGlobals();
});

describe("#339 AC-1 S-17 の表示中は、見張りがフックへ任せる", () => {
  it.each([
    ["部屋のメッセージの 403", "room"],
    ["その案件のスレッドの返信の 404", "replies"],
  ] as const)(
    "#339 AC-1: S-17の表示中は確認と確定の副作用が二重にならない：全体の見張り（main.tsx と同じ登録）とフックが同じ%sを受けても、確かめは1回、入口・合図・下書きの消去も1回",
    async (_label, trigger) => {
      uninstall = installCaseAccessLossMonitor(client);
      client.setQueryData(SUMMARY, summary(true));
      client.setQueryData(DETAIL, { sentinel: "[UNIT_TEST]339詳細" });
      await fetched(ROOM_KEY, [{ id: "m1" }]);
      await fetched(threadKey(PARENT), repliesData(PARENT, ROOM, CASE));
      await fetched(
        threadKey(OTHER_PARENT),
        repliesData(OTHER_PARENT, OTHER_ROOM, null),
      );
      const { onLost } = mountS17(PARTICIPANT_PROPS);
      if (trigger === "room") await fail(ROOM_KEY, 403);
      else await fail(threadKey(PARENT), 404);
      await waitFor(() => expect(announced()).toHaveLength(1));
      await waitFor(() => expect(draftsPresent()).toBe(0));
      await flushTasks(10);
      expect(verifications()).toBe(1);
      // 確かめは表示中のフックの取り直し（概要の Query）。見張りは直接の GET をしない
      expect(hookChecks).toBe(1);
      expect(directChecks).toBe(0);
      expect(entryCalls()).toHaveLength(1);
      expect(entryCalls()[0]?.[1]).toEqual({ ownerId: USER, reason: "lost" });
      expect(announced()).toEqual([{ v: 1, userId: USER, caseId: CASE }]);
      expect(onLost).toHaveBeenCalled();
      // 表示中の確定は、既存の表示中の片付け（スレッドは "all"）
      expect(client.getQueryData(DETAIL)).toBeUndefined();
      expect(client.getQueryData(threadKey(PARENT))).toBeUndefined();
      expect(client.getQueryData(threadKey(OTHER_PARENT))).toBeUndefined();
      // ほかの部屋の下書きは残る
      expect(window.localStorage.getItem(OTHER_DRAFT)).not.toBeNull();
    },
  );

  it("#339 AC-1: S-17の表示中は確認と確定の副作用が二重にならない：フックだけを置いても（全体の見張りの登録が無くても）、その案件のスレッドの返信の 404 で、フックが1回確かめて確定する", async () => {
    client.setQueryData(SUMMARY, summary(true));
    await fetched(threadKey(PARENT), repliesData(PARENT, ROOM, CASE));
    mountS17(PARTICIPANT_PROPS);
    await fail(threadKey(PARENT), 404);
    await waitFor(() => expect(announced()).toHaveLength(1));
    await flushTasks(10);
    expect(verifications()).toBe(1);
    expect(entryCalls()).toHaveLength(1);
    expect(draftsPresent()).toBe(0);
  });

  it("#339 AC-1: S-17の表示中は確認と確定の副作用が二重にならない：確かめが参加者のままなら、どちらも片付け・入口・合図・下書きの消去をしない", async () => {
    uninstall = installCaseAccessLossMonitor(client);
    answer = "participant";
    client.setQueryData(SUMMARY, summary(true));
    await fetched(threadKey(PARENT), repliesData(PARENT, ROOM, CASE));
    mountS17(PARTICIPANT_PROPS);
    await fail(threadKey(PARENT), 403);
    await waitFor(() => expect(verifications()).toBe(1));
    await flushTasks(10);
    expect(verifications()).toBe(1);
    expect(entryCalls()).toHaveLength(0);
    expect(announced()).toEqual([]);
    expect(draftsPresent()).toBe(DRAFTS.length);
  });
});

describe("#339 AC-1 確かめの途中の離脱・同じ案件の再表示", () => {
  it("#339 AC-1: 確認中の離脱・同じ案件の再表示でも担当を二重に作らない：始めた確かめが最後まで処理し、読み込み直しを取りこぼさず、合図・下書きの消去は1回", async () => {
    uninstall = installCaseAccessLossMonitor(client);
    client.setQueryData(SUMMARY, summary(true));
    await fetched(ROOM_KEY, [{ id: "m1" }]);
    await fetched(threadKey(PARENT), repliesData(PARENT, ROOM, CASE));
    const pending = deferred();
    gate = pending.promise;
    const first = mountS17(PARTICIPANT_PROPS);
    await fail(ROOM_KEY, 403);
    await waitFor(() => expect(verifications()).toBe(1));
    first.unmount();
    // 同じ案件の画面を作り直す（まだ参加者の概要のキャッシュ）
    const second = mountS17(PARTICIPANT_PROPS);
    // 確かめの途中に、同じ案件の別の拒否が届く
    await fail(threadKey(PARENT), 404);
    await flushTasks(5);
    expect(verifications()).toBe(1);
    gate = null;
    pending.release();
    await waitFor(() => expect(entryCalls().length).toBeGreaterThan(0));
    await waitFor(() => expect(announced()).toHaveLength(1));
    await waitFor(() => expect(draftsPresent()).toBe(0));
    // 作り直した画面に、非参加の概要が届く（同じ確定）
    second.rerender({
      isParticipant: false,
      outsider: true,
      roomId: null,
      participantRoomId: null,
    });
    await flushTasks(10);
    expect(verifications()).toBe(1);
    expect(announced()).toHaveLength(1);
    for (const [, request] of entryCalls())
      expect(request).toEqual({ ownerId: USER, reason: "lost" });
  });
});

/**
 * 初回の概要を、取得で届ける（キャッシュが無い所からの取得。統括の決定：初回の確定に使ってよいのは、取得して届いた概要の答えだけ）。
 * 取得を保留して始め、deliver で答えを返す。答えは answer（既定 lost）
 */
function startFreshSummary() {
  const pending = deferred();
  summaryGate = pending.promise;
  const done = client
    .fetchQuery({ queryKey: SUMMARY, staleTime: 0 })
    .catch((error: unknown) => error);
  return {
    async deliver() {
      summaryGate = null;
      pending.release();
      await act(async () => {
        await done;
        await flushTasks(3);
      });
    },
  };
}

/** 初回の概要の答えが届く前：入口・合図・下書きの消去は起きていない */
async function expectNotConfirmedYet() {
  await waitFor(() =>
    expect(client.getQueryState(SUMMARY)?.fetchStatus).toBe("fetching"),
  );
  await act(async () => {
    await flushTasks(3);
  });
  expect(entryCalls()).toHaveLength(0);
  expect(announced()).toEqual([]);
  expect(draftsPresent()).toBe(DRAFTS.length);
}

describe("#339 AC-2 初回の概要と、見張りの確かめの重なり（N-2・N-3）", () => {
  it.each([false, true])(
    "#339 AC-2 N-2・N-3: 初回の概要は S-17 のフックが扱う：部屋・スレッドの実績がある初回の非参加（StrictMode=%s）で、片付け → 入口 → 合図 → 下書きの消去が1回ずつ。見張りは概要を直接確かめない",
    async (strict) => {
      uninstall = installCaseAccessLossMonitor(client);
      // 実績：その案件の部屋のスレッドの返信を取得した（部屋の ID はここだけから分かる）
      await fetched(threadKey(PARENT), repliesData(PARENT, ROOM, CASE));
      const fresh = startFreshSummary();
      mountS17(INITIAL_OUTSIDER_PROPS, { strict });
      await expectNotConfirmedYet();
      await fresh.deliver();
      await waitFor(() => expect(announced()).toHaveLength(1));
      await waitFor(() => expect(draftsPresent()).toBe(0));
      await flushTasks(10);
      expect(directChecks).toBe(0);
      expect(entryCalls()).toHaveLength(1);
      expect(announced()).toEqual([{ v: 1, userId: USER, caseId: CASE }]);
      // N-3：入口の時点で片付け（返信のキャッシュの除去）は済み、合図と下書きの消去はまだ。合図の時点で下書きはまだある
      expect(atEntry[0]).toEqual({
        caseThreadCached: false,
        drafts: DRAFTS.length,
        announced: 0,
      });
      expect(draftsAtAnnounce).toEqual([DRAFTS.length]);
      expect(client.getQueryData(threadKey(PARENT))).toBeUndefined();
      expect(window.localStorage.getItem(OTHER_DRAFT)).not.toBeNull();
    },
  );

  it.each([false, true])(
    "#339 AC-2: 初回概要と確認結果が重なっても確定の副作用は1回：見張りの確かめ（画面の外の返信の 404）の途中に、同じ案件の S-17 が初回の非参加の概要で描かれる（StrictMode=%s）",
    async (strict) => {
      uninstall = installCaseAccessLossMonitor(client);
      await fetched(threadKey(PARENT), repliesData(PARENT, ROOM, CASE));
      const pending = deferred();
      gate = pending.promise;
      await fail(threadKey(PARENT), 404);
      await waitFor(() => expect(directChecks).toBe(1));
      const fresh = startFreshSummary();
      mountS17(INITIAL_OUTSIDER_PROPS, { strict });
      await expectNotConfirmedYet();
      await fresh.deliver();
      await act(async () => {
        gate = null;
        pending.release();
        await flushTasks(10);
      });
      await waitFor(() => expect(announced()).toHaveLength(1));
      await waitFor(() => expect(draftsPresent()).toBe(0));
      await flushTasks(10);
      expect(announced()).toHaveLength(1);
      expect(directChecks).toBe(1);
      expect(entryCalls().length).toBeGreaterThan(0);
      for (const [, request] of entryCalls())
        expect(request).toEqual({ ownerId: USER, reason: "lost" });
    },
  );

  it.each([false, true])(
    "#339 AC-2: 初回概要と確認結果が重なっても下書きの処理は1回：初回の概要で確定 → 同じ持ち主が新しい下書きを保存 → 保留していた画面の外の確かめが完了しても、新しい下書きは残る（StrictMode=%s。C-207(6)(8)）",
    async (strict) => {
      uninstall = installCaseAccessLossMonitor(client);
      await fetched(threadKey(PARENT), repliesData(PARENT, ROOM, CASE));
      const pending = deferred();
      gate = pending.promise;
      await fail(threadKey(PARENT), 404);
      await waitFor(() => expect(directChecks).toBe(1));
      const fresh = startFreshSummary();
      mountS17(INITIAL_OUTSIDER_PROPS, { strict });
      await expectNotConfirmedYet();
      await fresh.deliver();
      // 初回の概要で確定し、下書きが消える
      await waitFor(() => expect(draftsPresent()).toBe(0));
      await flushTasks(5);
      const NEW_DRAFT = draftKey(`room:${ROOM}`);
      window.localStorage.setItem(
        NEW_DRAFT,
        JSON.stringify({
          body: "[UNIT_TEST]339新しい書きかけ",
          updatedAt: Date.now(),
        }),
      );
      await act(async () => {
        gate = null;
        pending.release();
        await flushTasks(10);
      });
      await flushTasks(10);
      expect(directChecks).toBe(1);
      expect(announced()).toHaveLength(1);
      expect(window.localStorage.getItem(NEW_DRAFT)).not.toBeNull();
    },
  );

  it.each([false, true])(
    "#339 AC-2: 初回概要と確認結果が重なっても確定の副作用は1回：S-17 を描いてから見張りを登録する順序（StrictMode=%s）でも、初回の非参加の確定は1回",
    async (strict) => {
      await fetched(threadKey(PARENT), repliesData(PARENT, ROOM, CASE));
      const fresh = startFreshSummary();
      mountS17(INITIAL_OUTSIDER_PROPS, { strict });
      uninstall = installCaseAccessLossMonitor(client);
      await expectNotConfirmedYet();
      await fresh.deliver();
      await waitFor(() => expect(announced()).toHaveLength(1));
      await flushTasks(10);
      expect(announced()).toHaveLength(1);
      expect(entryCalls()).toHaveLength(1);
      expect(directChecks).toBe(0);
      expect(draftsPresent()).toBe(0);
    },
  );
});

// ---- コードレビュー1回目の指摘3：S-17 に委譲しても、経路（スレッド一覧の行の消失）の区別が保たれる（計画 3 節の表） ----
describe("#339 AC-3 S-17 の表示中の、スレッド一覧の行の消失（指摘3）", () => {
  const LIST_KEY = ["threads", "list"];
  let rows: unknown[];
  const caseRow = () => ({
    parent: repliesData(PARENT, ROOM, CASE).parent,
    room: { kind: "channel", id: ROOM, name: "[UNIT_TEST]339案件の部屋" },
    lastReplyAt: "2026-11-25T00:00:00.000Z",
    unreadCount: 0,
    caseId: CASE,
  });
  const otherRow = () => ({
    parent: repliesData(OTHER_PARENT, OTHER_ROOM, null).parent,
    room: { kind: "channel", id: OTHER_ROOM, name: "[UNIT_TEST]339通常の部屋" },
    lastReplyAt: "2026-11-25T00:00:00.000Z",
    unreadCount: 0,
    caseId: null,
  });

  async function openList() {
    rows = [caseRow(), otherRow()];
    await client.fetchInfiniteQuery({
      queryKey: LIST_KEY,
      queryFn: () => Promise.resolve({ items: [...rows], nextCursor: null }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: () => undefined,
    });
  }
  async function refetchList(next: unknown[]) {
    rows = next;
    await client.refetchQueries({ queryKey: LIST_KEY });
  }
  /** 確かめ（フックの概要の取り直し・見張りの直接の取得）が n 回始まり、概要の取り直しが終わるまで待つ */
  async function verificationsSettled(count: number) {
    await waitFor(() => expect(verifications()).toBe(count));
    await waitFor(() =>
      expect(client.isFetching({ queryKey: SUMMARY })).toBe(0),
    );
    await act(async () => {
      await flushTasks(3);
    });
  }

  async function arrange() {
    uninstall = installCaseAccessLossMonitor(client);
    client.setQueryData(SUMMARY, summary(true));
    client.setQueryData(DETAIL, { sentinel: "[UNIT_TEST]339詳細" });
    await fetched(ROOM_KEY, [{ id: "m1" }]);
    await fetched(threadKey(PARENT), repliesData(PARENT, ROOM, CASE));
    await openList();
    return mountS17(PARTICIPANT_PROPS);
  }

  it.each([
    ["500", "error500"],
    ["通信の失敗", "network"],
  ] as const)(
    "#339 AC-3: S-17 の表示中に一覧の行が消え、確かめが%s（unverified）：片付けなし・入口なし・合図なし・下書きは残る。確かめられないの表示にもならない",
    async (_label, failure) => {
      const view = await arrange();
      answer = failure;
      await refetchList([otherRow()]);
      await verificationsSettled(1);
      expect(client.getQueryData(DETAIL)).toBeDefined();
      expect(client.getQueryData(threadKey(PARENT))).toBeDefined();
      expect(entryCalls()).toHaveLength(0);
      expect(announced()).toEqual([]);
      expect(draftsPresent()).toBe(DRAFTS.length);
      expect(view.result.current.unverified).toBe(false);
      expect(view.onLost).not.toHaveBeenCalled();
    },
  );

  it("#339 AC-3: S-17 の表示中に一覧の行が消え、確かめが参加者なら何も起きず、その後の本当の拒否（部屋の 403）から確かめが始まり、確定まで進む", async () => {
    await arrange();
    answer = "participant";
    await refetchList([otherRow()]);
    await verificationsSettled(1);
    expect(entryCalls()).toHaveLength(0);
    answer = "lost";
    await fail(ROOM_KEY, 403);
    await waitFor(() => expect(announced()).toHaveLength(1));
    expect(verifications()).toBe(2);
    expect(entryCalls()).toHaveLength(1);
    await waitFor(() => expect(draftsPresent()).toBe(0));
  });

  it.each([
    ["非参加", "lost"],
    ["404", "notFound"],
  ] as const)(
    '#339 AC-3: S-17 の表示中に一覧の行が消え、確かめが%sなら、委譲した確定の既存の動き（表示中は "all"）：入口・合図・下書きの消去が1回ずつ',
    async (_label, verdict) => {
      await fetched(
        threadKey(OTHER_PARENT),
        repliesData(OTHER_PARENT, OTHER_ROOM, null),
      );
      await arrange();
      answer = verdict;
      await refetchList([otherRow()]);
      await waitFor(() => expect(announced()).toHaveLength(1));
      await waitFor(() => expect(draftsPresent()).toBe(0));
      await verificationsSettled(1);
      expect(entryCalls()).toHaveLength(1);
      expect(client.getQueryData(DETAIL)).toBeUndefined();
      expect(client.getQueryData(threadKey(OTHER_PARENT))).toBeUndefined();
    },
  );

  it("#339 AC-3: S-17 の表示中、一覧の経路の unverified の後も、次のきっかけ（行が戻って、また消える）を受けて確かめる", async () => {
    await arrange();
    answer = "error500";
    await refetchList([otherRow()]);
    await verificationsSettled(1);
    answer = "lost";
    await refetchList([caseRow(), otherRow()]);
    await refetchList([otherRow()]);
    await waitFor(() => expect(announced()).toHaveLength(1));
    expect(verifications()).toBe(2);
  });
});

// ---- 統括の決定（初回の確定は、取得して届いた概要の答えだけで行う。計画 3 節の補足） ----
describe("#339 AC-2 古い非参加の概要のキャッシュだけでは確定しない（取り直しが始まらない・終わらない）", () => {
  async function arrangeStale() {
    uninstall = installCaseAccessLossMonitor(client);
    await fetched(threadKey(PARENT), repliesData(PARENT, ROOM, CASE));
    // 開いた時点でキャッシュにあっただけの、古い非参加（手で書いたもの）
    client.setQueryData(SUMMARY, summary(false));
  }
  async function expectNothingConfirmed() {
    await act(async () => {
      await flushTasks(5);
    });
    expect(entryCalls()).toHaveLength(0);
    expect(announced()).toEqual([]);
    expect(draftsPresent()).toBe(DRAFTS.length);
  }

  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it("#339 AC-2: 古い非参加の概要のキャッシュで開き、概要の取り直しが始まらない：入口0・合図0・下書きは残る", async () => {
    await arrangeStale();
    mountS17(INITIAL_OUTSIDER_PROPS);
    expect(client.getQueryState(SUMMARY)?.fetchStatus).toBe("idle");
    await expectNothingConfirmed();
  });

  it("#339 AC-2: 古い非参加の概要のキャッシュで開き、通信が止まっていて取り直しが保留（paused）のまま：入口0・合図0・下書きは残る。通信が戻って非参加が届くと、順に1回ずつ", async () => {
    await arrangeStale();
    onlineManager.setOnline(false);
    const refetching = client
      .refetchQueries({ queryKey: SUMMARY })
      .catch((error: unknown) => error);
    await waitFor(() =>
      expect(client.getQueryState(SUMMARY)?.fetchStatus).toBe("paused"),
    );
    mountS17(INITIAL_OUTSIDER_PROPS);
    await expectNothingConfirmed();
    expect(hookChecks).toBe(0);
    act(() => onlineManager.setOnline(true));
    await act(async () => {
      await refetching;
    });
    await waitFor(() => expect(announced()).toHaveLength(1));
    await waitFor(() => expect(draftsPresent()).toBe(0));
    expect(entryCalls()).toHaveLength(1);
    expect(atEntry[0]).toEqual({
      caseThreadCached: false,
      drafts: DRAFTS.length,
      announced: 0,
    });
  });

  it.each([false, true])(
    "#339 AC-2: 古い非参加の概要のキャッシュで開いた後、取得した答えが参加者なら、何も起きない（StrictMode=%s）",
    async (strict) => {
      await arrangeStale();
      mountS17(INITIAL_OUTSIDER_PROPS, { strict });
      answer = "participant";
      await act(async () => {
        await client.fetchQuery({ queryKey: SUMMARY, staleTime: 0 });
      });
      await expectNothingConfirmed();
    },
  );

  it.each([
    ["非参加", false, "lost"],
    ["404", false, "notFound"],
    ["非参加", true, "lost"],
    ["404", true, "notFound"],
  ] as const)(
    "#339 AC-2: 古い非参加の概要のキャッシュで開いた後、取得した答えが%sなら、入口・合図・下書きの消去が順に1回ずつ（StrictMode=%s）",
    async (_label, strict, verdict) => {
      await arrangeStale();
      mountS17(INITIAL_OUTSIDER_PROPS, { strict });
      await expectNothingConfirmed();
      answer = verdict;
      await act(async () => {
        await client
          .fetchQuery({ queryKey: SUMMARY, staleTime: 0 })
          .catch((error: unknown) => error);
      });
      await waitFor(() => expect(announced()).toHaveLength(1));
      await waitFor(() => expect(draftsPresent()).toBe(0));
      expect(entryCalls()).toHaveLength(1);
      expect(atEntry[0]).toEqual({
        caseThreadCached: false,
        drafts: DRAFTS.length,
        announced: 0,
      });
      expect(draftsAtAnnounce).toEqual([DRAFTS.length]);
    },
  );

  it("#339 AC-2: 手で書いたデータ（setQueryData で非参加に書き換える）だけでは、確定しない", async () => {
    uninstall = installCaseAccessLossMonitor(client);
    await fetched(threadKey(PARENT), repliesData(PARENT, ROOM, CASE));
    client.setQueryData(SUMMARY, summary(true));
    const view = mountS17(PARTICIPANT_PROPS);
    await expectNothingConfirmed();
    view.unmount();
    client.setQueryData(SUMMARY, summary(false));
    mountS17(INITIAL_OUTSIDER_PROPS);
    await expectNothingConfirmed();
  });
});

// ---- コードレビュー2回目の指摘 B：Query の破棄で、古い確定の待ちを無効にする（計画 2 節「キャッシュの削除後は、そのキャッシュを実績として使わない」。C-207） ----
describe("#339 AC-2 答えを待つ間に、概要の Query と実績が捨てられる（指摘B）", () => {
  it.each([
    ["非参加", "lost"],
    ["404", "notFound"],
  ] as const)(
    "#339 AC-2: 古い非参加の概要のキャッシュ＋実績で開き、答えを待つ間に概要の Query と実績（返信・部屋のメッセージ）が捨てられた後、同じキーで取得した%sが届いても、実績が無い初回の動き（入口0・合図0・下書きは残る）",
    async (_label, verdict) => {
      uninstall = installCaseAccessLossMonitor(client);
      await fetched(threadKey(PARENT), repliesData(PARENT, ROOM, CASE));
      await fetched(ROOM_KEY, []);
      client.setQueryData(SUMMARY, summary(false));
      mountS17(INITIAL_OUTSIDER_PROPS);
      await act(async () => {
        await flushTasks(3);
      });
      client.removeQueries({ queryKey: SUMMARY, exact: true });
      client.removeQueries({ queryKey: threadKey(PARENT), exact: true });
      client.removeQueries({ queryKey: ROOM_KEY, exact: true });
      answer = verdict;
      await act(async () => {
        await client
          .fetchQuery({ queryKey: SUMMARY, staleTime: 0 })
          .catch((error: unknown) => error);
        await flushTasks(5);
      });
      await waitFor(() =>
        expect(client.isFetching({ queryKey: SUMMARY })).toBe(0),
      );
      await act(async () => {
        await flushTasks(3);
      });
      expect(entryCalls()).toHaveLength(0);
      expect(announced()).toEqual([]);
      expect(draftsPresent()).toBe(DRAFTS.length);
    },
  );
});

// ---- ミューテーション診断（#339。mj339 の T1〜T39 のうち、S-17 のフックの側）で足したもの ----
// 期待は、C-206〜C-210・設計書 access-loss.md「S-17 の外での検出」・確定した計画と、統括の決定（初回の確定は、取得して届いた答えだけで行う）から決めた。
const OTHER_CASE_HM = "01JTESTCASE339000000000HM2";
const OTHER_USER_HM = "01JTESTUSER339000000000HM2";
const sessionOfUser = (id: string) => ({
  user: { id, displayName: "testuser_339_hm", loginId: "testuser_339_hm" },
  mustChangePassword: false,
  reauthenticatedAt: null,
  permissions: [],
});
const listRow = (parentId: string, roomId: string, caseId: string | null) => ({
  parent: repliesData(parentId, roomId, caseId).parent,
  room: { kind: "channel", id: roomId, name: "[UNIT_TEST]339部屋" },
  lastReplyAt: "2026-11-25T00:00:00.000Z",
  unreadCount: 0,
  caseId,
});
async function fetchedList(rows: unknown[]) {
  await client.fetchInfiniteQuery({
    queryKey: ["threads", "list"],
    queryFn: () => Promise.resolve({ items: rows, nextCursor: null }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: () => undefined,
  });
}
function channelDetailOf(roomId: string, caseId: string | null) {
  return {
    id: roomId,
    roomId,
    name: "[UNIT_TEST]339チャンネル",
    description: "",
    visibility: "private",
    departmentId: null,
    joined: true,
    isCaseChannel: caseId !== null,
    caseId,
    canPost: true,
    readOnly: false,
    version: 1,
    manage: { canRename: false, canEditDescription: false, canArchive: false },
  };
}
async function expectNothingYet() {
  await act(async () => {
    await flushTasks(5);
  });
  expect(entryCalls()).toHaveLength(0);
  expect(announced()).toEqual([]);
  expect(draftsPresent()).toBe(DRAFTS.length);
}
async function expectConfirmedOnce() {
  await waitFor(() => expect(announced()).toHaveLength(1));
  await waitFor(() => expect(draftsPresent()).toBe(0));
  expect(entryCalls()).toHaveLength(1);
  expect(window.localStorage.getItem(OTHER_DRAFT)).not.toBeNull();
}

describe("#339 AC-2 初回の確定に使う実績と部屋の ID（T1〜T3。計画 2 節・3 節「初回の新しい概要。実績あり」）", () => {
  it.each([
    [
      "別の案件の行と通常の部屋の行だけ",
      () => [
        listRow(OTHER_PARENT, OTHER_ROOM, OTHER_CASE_HM),
        listRow("01JTESTMSG3390000000000HM3", OTHER_ROOM, null),
      ],
      false,
    ],
    [
      "別の案件の行の後に、その案件の行",
      () => [
        listRow(OTHER_PARENT, OTHER_ROOM, OTHER_CASE_HM),
        listRow(PARENT, ROOM, CASE),
      ],
      true,
    ],
  ])(
    "#339 AC-2: 実績がスレッド一覧の%sのとき、初回に取得した非参加で、その案件の行だけを実績にし、その行の部屋の下書きを消す",
    async (_label, rows, confirms) => {
      uninstall = installCaseAccessLossMonitor(client);
      await fetchedList(rows());
      const fresh = startFreshSummary();
      mountS17(INITIAL_OUTSIDER_PROPS);
      await fresh.deliver();
      if (confirms) await expectConfirmedOnce();
      else await expectNothingYet();
    },
  );

  it.each([
    ["別の案件", OTHER_CASE_HM],
    ["通常のチャンネル（caseId が null）", null],
  ])(
    "#339 AC-2: 実績が、%sのチャンネルの詳細と、その部屋の正常に取得したメッセージだけなら、この案件の初回の非参加では確定しない",
    async (_label, caseIdValue) => {
      uninstall = installCaseAccessLossMonitor(client);
      await fetched(
        ["channels", "detail", OTHER_ROOM],
        channelDetailOf(OTHER_ROOM, caseIdValue),
      );
      await fetched(["messages", "room", OTHER_ROOM], []);
      const fresh = startFreshSummary();
      mountS17(INITIAL_OUTSIDER_PROPS);
      await fresh.deliver();
      await expectNothingYet();
    },
  );

  it("#339 AC-2: まだデータの無いチャンネルの詳細の Query が混ざっていても、例外にせず、案件の詳細の部屋と取得済みのメッセージで確定する", async () => {
    uninstall = installCaseAccessLossMonitor(client);
    const pending = deferred();
    const waiting = client
      .fetchQuery({
        queryKey: ["channels", "detail", OTHER_ROOM],
        queryFn: async () => {
          await pending.promise;
          return channelDetailOf(OTHER_ROOM, null);
        },
      })
      .catch((error: unknown) => error);
    client.setQueryData(DETAIL, { id: CASE, channelId: ROOM });
    await fetched(ROOM_KEY, []);
    const fresh = startFreshSummary();
    mountS17(INITIAL_OUTSIDER_PROPS);
    await fresh.deliver();
    await expectConfirmedOnce();
    pending.release();
    await waiting;
  });
});

describe("#339 AC-2 初回の答えを待つ間の変化（T33〜T35・T37）", () => {
  it("#339 AC-2: 開いたときにセッションの利用者が画面の利用者と違えば、その後に同じ利用者になって非参加が届いても、そのとき読んだ実績で確定しない", async () => {
    uninstall = installCaseAccessLossMonitor(client);
    client.setQueryData(["auth", "session"], sessionOfUser(OTHER_USER_HM));
    await fetched(threadKey(PARENT), repliesData(PARENT, ROOM, CASE));
    const fresh = startFreshSummary();
    mountS17(INITIAL_OUTSIDER_PROPS);
    client.setQueryData(["auth", "session"], sessionOfUser(USER));
    await fresh.deliver();
    await expectNothingYet();
  });

  it("#339 AC-2: 初回の答えを待つ間に、手で書いた非参加を挟んでも、その時点では確定せず、待ちも失わない：その後に取得した非参加で1回確定する", async () => {
    uninstall = installCaseAccessLossMonitor(client);
    await fetched(threadKey(PARENT), repliesData(PARENT, ROOM, CASE));
    client.setQueryData(SUMMARY, summary(false));
    mountS17(INITIAL_OUTSIDER_PROPS);
    await expectNothingYet();
    client.setQueryData(SUMMARY, summary(false));
    await expectNothingYet();
    await act(async () => {
      await client.fetchQuery({ queryKey: SUMMARY, staleTime: 0 });
    });
    await expectConfirmedOnce();
  });

  it("#339 AC-2: 捨てた古い概要の Query に遅れて届いた更新は、作り直した Query の答えとして扱わない（作り直した Query の答えが参加者なら、何も起きない）", async () => {
    uninstall = installCaseAccessLossMonitor(client);
    await fetched(threadKey(PARENT), repliesData(PARENT, ROOM, CASE));
    client.setQueryData(SUMMARY, summary(false));
    const oldQuery = client
      .getQueryCache()
      .find({ queryKey: SUMMARY, exact: true });
    client.removeQueries({ queryKey: SUMMARY, exact: true });
    const fresh = startFreshSummary();
    mountS17(INITIAL_OUTSIDER_PROPS);
    await expectNotConfirmedYet();
    await act(async () => {
      await oldQuery
        ?.fetch({
          queryKey: SUMMARY,
          queryFn: () => Promise.resolve(summary(false)),
        })
        .catch((error: unknown) => error);
    });
    await expectNothingYet();
    answer = "participant";
    await fresh.deliver();
    await expectNothingYet();
  });

  it.each([
    ["セッションの利用者だけが替わる", "user"],
    ["参加の期間だけが進む", "period"],
  ] as const)(
    "#339 AC-2: 初回の答えを待つ間に%sと、届いた非参加で確定しない",
    async (_label, kind) => {
      uninstall = installCaseAccessLossMonitor(client);
      await fetched(threadKey(PARENT), repliesData(PARENT, ROOM, CASE));
      const fresh = startFreshSummary();
      mountS17(INITIAL_OUTSIDER_PROPS);
      await expectNotConfirmedYet();
      if (kind === "user")
        client.setQueryData(["auth", "session"], sessionOfUser(OTHER_USER_HM));
      else startCaseParticipationPeriod(client, USER, CASE);
      await fresh.deliver();
      await expectNothingYet();
    },
  );
});

describe("#339 AC-1 S-17 の担当の確かめ（T15・T17・T18・T38・T39）", () => {
  async function failNow(queryKey: unknown[], status: number) {
    await act(async () => {
      await fail(queryKey, status);
    });
  }

  it("#339 AC-1: 一覧の行の消失の確かめの途中に中身の拒否が届き、確かめが参加者なら、中身の経路として処理済みにする：続く同じ拒否で、確かめを重ねない", async () => {
    uninstall = installCaseAccessLossMonitor(client);
    client.setQueryData(SUMMARY, summary(true));
    await fetched(ROOM_KEY, [{ id: "m1" }]);
    let rows: unknown[] = [listRow(PARENT, ROOM, CASE)];
    await client.fetchInfiniteQuery({
      queryKey: ["threads", "list"],
      queryFn: () => Promise.resolve({ items: rows, nextCursor: null }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: () => undefined,
    });
    mountS17(PARTICIPANT_PROPS);
    answer = "participant";
    const pending = deferred();
    gate = pending.promise;
    rows = [];
    await act(async () => {
      await client.refetchQueries({ queryKey: ["threads", "list"] });
    });
    await waitFor(() => expect(hookChecks).toBe(1));
    await failNow(ROOM_KEY, 403);
    gate = null;
    pending.release();
    await waitFor(() =>
      expect(client.isFetching({ queryKey: SUMMARY })).toBe(0),
    );
    await act(async () => {
      await flushTasks(3);
    });
    await failNow(ROOM_KEY, 403);
    await act(async () => {
      await flushTasks(3);
    });
    expect(verifications()).toBe(1);
  });

  it("#339 AC-1: 確かめの途中に参加者に戻ったと分かり（参加の期間が進む）、新しい下書きが置かれた後に、古い期間の非参加が届いても、合図を送らず、新しい下書きを消さない", async () => {
    uninstall = installCaseAccessLossMonitor(client);
    client.setQueryData(SUMMARY, summary(true));
    await fetched(ROOM_KEY, [{ id: "m1" }]);
    const view = mountS17(PARTICIPANT_PROPS);
    const pending = deferred();
    gate = pending.promise;
    await failNow(ROOM_KEY, 403);
    await waitFor(() => expect(hookChecks).toBe(1));
    view.rerender({ ...PARTICIPANT_PROPS, isParticipant: false });
    view.rerender(PARTICIPANT_PROPS);
    const NEW_DRAFT = draftKey(`thread:${ROOM}:${OTHER_PARENT}`);
    window.localStorage.setItem(
      NEW_DRAFT,
      JSON.stringify({ body: "[UNIT_TEST]339新しい", updatedAt: Date.now() }),
    );
    gate = null;
    pending.release();
    await waitFor(() =>
      expect(client.isFetching({ queryKey: SUMMARY })).toBe(0),
    );
    await act(async () => {
      await flushTasks(5);
    });
    expect(announced()).toEqual([]);
    expect(window.localStorage.getItem(NEW_DRAFT)).not.toBeNull();
    expect(draftsPresent()).toBe(DRAFTS.length);
  });

  it("#339 AC-1: 部屋の分からない確定では下書きを消さず、処理済みにもしない：同じ喪失で、後から部屋が分かった確定では、その部屋の下書きを1回消す", async () => {
    uninstall = installCaseAccessLossMonitor(client);
    client.setQueryData(SUMMARY, summary(true));
    const noRoom = {
      isParticipant: true,
      outsider: false,
      roomId: null,
      participantRoomId: null,
    };
    const view = mountS17(noRoom);
    view.rerender({ ...noRoom, isParticipant: false, outsider: true });
    await waitFor(() => expect(announced()).toHaveLength(1));
    expect(draftsPresent()).toBe(DRAFTS.length);
    view.unmount();
    await fetched(threadKey(PARENT), repliesData(PARENT, ROOM, CASE));
    await failNow(threadKey(PARENT), 404);
    await waitFor(() => expect(draftsPresent()).toBe(0));
    expect(announced()).toHaveLength(1);
  });

  it.each([
    ["概要のキャッシュが無い", "absent"],
    ["概要のキャッシュが非参加", "outsider"],
  ] as const)(
    "#339 AC-1: %sときに届いた中身の拒否では、確かめを始めず、例外にしない",
    async (_label, kind) => {
      uninstall = installCaseAccessLossMonitor(client);
      client.setQueryData(SUMMARY, summary(true));
      mountS17(PARTICIPANT_PROPS);
      if (kind === "absent")
        client.removeQueries({ queryKey: SUMMARY, exact: true });
      else client.setQueryData(SUMMARY, summary(false));
      // 取得の失敗は、拒否のまま（担当が例外を投げて、別の失敗に変わらない）
      let failure: unknown = null;
      await act(async () => {
        failure = await client
          .fetchQuery({
            queryKey: ROOM_KEY,
            queryFn: () =>
              Promise.reject({
                status: 403,
                code: "FORBIDDEN",
                message: "[UNIT_TEST]339拒否",
              }),
            staleTime: 0,
          })
          .then(
            () => null,
            (error: unknown) => error,
          );
      });
      expect(failure).toMatchObject({ status: 403, code: "FORBIDDEN" });
      await act(async () => {
        await flushTasks(5);
      });
      expect(verifications()).toBe(0);
      expect(entryCalls()).toHaveLength(0);
    },
  );

  it("#339 AC-1: 確かめられない（500）の後の再試行で参加者と分かったら、その後の本当の拒否から、もう一度確かめて確定する", async () => {
    uninstall = installCaseAccessLossMonitor(client);
    client.setQueryData(SUMMARY, summary(true));
    const view = mountS17(PARTICIPANT_PROPS);
    answer = "error500";
    await failNow(ROOM_KEY, 403);
    await waitFor(() => expect(view.result.current.unverified).toBe(true));
    answer = "participant";
    act(() => view.result.current.retry());
    await waitFor(() => expect(view.result.current.unverified).toBe(false));
    expect(hookChecks).toBe(2);
    answer = "lost";
    await failNow(ROOM_KEY, 403);
    await waitFor(() => expect(hookChecks).toBe(3));
    await waitFor(() => expect(announced()).toHaveLength(1));
  });
});

// ---- T36（統括の決定：初回の概要の答えを待つ間に S-17 を外したら、待ちも捨てる） ----
describe("#339 AC-2 初回の概要の答えを待つ間に、S-17 を外す（T36）", () => {
  it.each([
    ["非参加", "lost"],
    ["404", "notFound"],
  ] as const)(
    "#339 AC-2: 実績ありの初回の概要を待つ間に S-17 を外すと、その後に取得した%sが届いても、入口0・合図0・下書きは残る",
    async (_label, verdict) => {
      uninstall = installCaseAccessLossMonitor(client);
      await fetched(threadKey(PARENT), repliesData(PARENT, ROOM, CASE));
      answer = verdict;
      const fresh = startFreshSummary();
      const view = mountS17(INITIAL_OUTSIDER_PROPS);
      await expectNotConfirmedYet();
      view.unmount();
      await fresh.deliver();
      await waitFor(() =>
        expect(client.isFetching({ queryKey: SUMMARY })).toBe(0),
      );
      await expectNothingYet();
    },
  );
});
