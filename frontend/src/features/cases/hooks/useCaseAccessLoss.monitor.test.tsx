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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestAccessLossReload } from "../../access-loss/reload-after-access-loss";
import {
  FakeBroadcastChannel,
  flushTasks,
} from "../../../test/fake-broadcast-channel";
import { server } from "../../../test/server";
import { installCaseAccessLossMonitor } from "../case-access-loss-monitor";
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

type Answer = "participant" | "lost";

let client: QueryClient;
let answer: Answer;
let gate: Promise<void> | null;
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
  const wrapper = ({ children }: { children: ReactNode }) => {
    const inner = (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return options.strict ? <StrictMode>{inner}</StrictMode> : inner;
  };
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
    { wrapper, initialProps: initial },
  );
  return { ...view, onLost };
}

beforeEach(() => {
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  vi.stubGlobal("reportError", vi.fn());
  FakeBroadcastChannel.clearSent();
  answer = "lost";
  gate = null;
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
      if (gate !== null) await gate;
      return summary(answer === "participant");
    },
  });
  server.use(
    http.get("/api/cases/:caseId", async () => {
      directChecks += 1;
      if (gate !== null) await gate;
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

describe("#339 AC-2 初回の概要と、見張りの確かめの重なり（N-2・N-3）", () => {
  it.each([false, true])(
    "#339 AC-2 N-2・N-3: 初回の概要は S-17 のフックが扱う：部屋・スレッドの実績がある初回の非参加（StrictMode=%s）で、片付け → 入口 → 合図 → 下書きの消去が1回ずつ。見張りは概要を直接確かめない",
    async (strict) => {
      uninstall = installCaseAccessLossMonitor(client);
      client.setQueryData(SUMMARY, summary(false));
      // 実績：その案件の部屋のスレッドの返信を取得した（部屋の ID はここだけから分かる）
      await fetched(threadKey(PARENT), repliesData(PARENT, ROOM, CASE));
      mountS17(INITIAL_OUTSIDER_PROPS, { strict });
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
      client.setQueryData(SUMMARY, summary(false));
      mountS17(INITIAL_OUTSIDER_PROPS, { strict });
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
    "#339 AC-2: 初回概要と確認結果が重なっても確定の副作用は1回：S-17 を描いてから見張りを登録する順序（StrictMode=%s）でも、初回の非参加の確定は1回",
    async (strict) => {
      client.setQueryData(SUMMARY, summary(false));
      await fetched(threadKey(PARENT), repliesData(PARENT, ROOM, CASE));
      mountS17(INITIAL_OUTSIDER_PROPS, { strict });
      uninstall = installCaseAccessLossMonitor(client);
      await waitFor(() => expect(announced()).toHaveLength(1));
      await flushTasks(10);
      expect(announced()).toHaveLength(1);
      expect(entryCalls()).toHaveLength(1);
      expect(directChecks).toBe(0);
      expect(draftsPresent()).toBe(0);
    },
  );
});
