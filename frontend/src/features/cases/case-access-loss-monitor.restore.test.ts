// #342 AC-4〜AC-7（計画 plan342a2 の 3-6・4 節、7 節の U8）：復元の守りが使う、公開の確定の入口
// settleVerifiedCaseAccess(queryClient, context, verdict)。context は、確かめる直前に控えた利用者・案件・部屋の ID・利用者の世代・参加の期間。
// verdict は participant・lost・notFound・switched と、概要の 403 を表す復元だけの forbidden（一般の unverified は渡さない）。
// 戻り値：confirmed（いまの文脈で参加者を採用できた）・handedOff（片付け・入口への引き渡し、または有効な切り替えへの引き渡しが成立した）・
//   unverified（照合で採用できなかった・引き渡しを確かめられなかった）。
// 照合（既存の stillCurrent：セッションの利用者・利用者の世代・参加の期間）が成り立たなければ、副作用なしで unverified。
// 判定ごとの副作用（片付けのスレッドは "room"。順序は 片付け → 入口 → 合図 → 下書き）：
//   participant：参加の期間を進めず、合図・下書きの印も変えない／lost：forgetCaseAfterLeave → 入口 → 合図 → 下書き／
//   notFound：forgetCaseContent（概要・一覧を非参加に書き換えない）→ 入口 → 合図 → 下書き／
//   forbidden：forgetCaseContent → 入口。合図・下書きの消去はしない／switched：喪失の副作用なし。切り替えの入口が動いていれば handedOff、いなければ unverified。
// 片付けの関数は差し替えず、キャッシュに残ったもので見分ける。入口は vi.fn、チャンネルはテスト専用の差し替え。データはすべて架空（testuser_・[UNIT_TEST]）。
// 前提にした口（実装の担当へ）：case-access-loss-monitor.ts の
//   settleVerifiedCaseAccess(queryClient, { userId, caseId, roomId, generation, period }, verdict): "confirmed" | "handedOff" | "unverified"
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isUserSwitchReloadRequested } from "../access-loss";
import {
  noteDraftsRemain,
  requestAccessLossReload,
} from "../access-loss/reload-after-access-loss";
import { TEST_USER } from "../../test/auth-handlers";
import {
  caseDetail,
  caseId as caseIdOf,
  caseRoomId,
  caseSummary,
} from "../../test/case-handlers";
import { FakeBroadcastChannel } from "../../test/fake-broadcast-channel";
import { message, reply } from "../../test/message-handlers";
import {
  announceCaseAccessLossOnce,
  currentLossPeriod,
  currentUserGeneration,
  installCaseAccessLossMonitor,
  settleVerifiedCaseAccess,
  startCaseParticipationPeriod,
} from "./case-access-loss-monitor";

vi.mock("../access-loss/reload-after-access-loss", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestAccessLossReload: vi.fn(() => Promise.resolve()),
  noteDraftsRemain: vi.fn(),
}));
vi.mock("../access-loss", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isUserSwitchReloadRequested: vi.fn(() => false),
}));

const N = 3428;
const USER = TEST_USER.id;
const OTHER_USER = "01JTESTUSER342000000000ST2";
const CASE = caseIdOf(N);
const ROOM = caseRoomId(N);
const OTHER_ROOM = "01JTESTROOM342000000000ST2";
const CHANNEL = "internal-system:access-loss:v1";

const SUMMARY_KEY = ["cases", "summary", USER, CASE];
const DETAIL_KEY = ["cases", "detail", USER, CASE];
const JOINED_LIST_KEY = ["cases", "list", USER, "joined", "active"];
const threadKey = (parentId: string) => ["messages", "thread", parentId];
const CASE_PARENT = "01JTESTMSG3420000000000ST1";
const OTHER_PARENT = "01JTESTMSG3420000000000ST2";

const draftKey = (userId: string, scope: string) =>
  `internal-system:draft:v1:${userId}:${scope}`;
const ROOM_DRAFT = draftKey(USER, `room:${ROOM}`);
const THREAD_DRAFT = draftKey(USER, `thread:${ROOM}:${CASE_PARENT}`);
const OTHER_DRAFT = draftKey(USER, `room:${OTHER_ROOM}`);

const sessionOf = (id: string) => ({
  user: { id, displayName: `testuser_342_${id.slice(-3)}`, loginId: id },
  permissions: [],
  mustChangePassword: false,
  reauthenticatedAt: null,
});

type Verdict = Parameters<typeof settleVerifiedCaseAccess>[2];
type Context = Parameters<typeof settleVerifiedCaseAccess>[1];

let client: QueryClient;
let uninstall: () => void;
let atEntry: { detailCached: boolean; announced: number; drafts: boolean }[];
let draftsAtAnnounce: boolean[];

const announced = () => FakeBroadcastChannel.sent(CHANNEL);
const entryCalls = () => vi.mocked(requestAccessLossReload).mock.calls;
const caseDraftsPresent = () =>
  window.localStorage.getItem(ROOM_DRAFT) !== null &&
  window.localStorage.getItem(THREAD_DRAFT) !== null;
const caseDraftsGone = () =>
  window.localStorage.getItem(ROOM_DRAFT) === null &&
  window.localStorage.getItem(THREAD_DRAFT) === null;

function writeDraft(key: string) {
  window.localStorage.setItem(
    key,
    JSON.stringify({ body: "[UNIT_TEST]342書きかけ", updatedAt: Date.now() }),
  );
}

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

async function primeCaches() {
  client.setQueryData(SUMMARY_KEY, caseSummary(N));
  client.setQueryData(DETAIL_KEY, caseDetail(N));
  client.setQueryData(JOINED_LIST_KEY, {
    pages: [{ items: [caseSummary(N)], nextCursor: null }],
    pageParams: [undefined],
  });
  for (const [parentId, roomId, caseId] of [
    [CASE_PARENT, ROOM, CASE],
    [OTHER_PARENT, OTHER_ROOM, null],
  ] as const)
    await client.fetchQuery({
      queryKey: threadKey(parentId),
      queryFn: () => Promise.resolve(repliesData(parentId, roomId, caseId)),
    });
}

/** いまの文脈（確かめる直前に控える値と同じもの） */
function currentContext(roomId: string | null = ROOM): Context {
  return {
    userId: USER,
    caseId: CASE,
    roomId,
    generation: currentUserGeneration(client),
    period: currentLossPeriod(client, USER, CASE),
  };
}

type Cleanup = "afterLeave" | "content" | "none";

/** 片付けの関数を、キャッシュに残ったものから見分ける。スレッドの範囲 "room" は、別の部屋のスレッドが残ることで見る */
function observeCleanup(): { cleanup: Cleanup; otherRoomThreadKept: boolean } {
  const summary = client.getQueryData<{ isParticipant: boolean }>(SUMMARY_KEY);
  const joined = client.getQueryData<{ pages: { items: { id: string }[] }[] }>(
    JOINED_LIST_KEY,
  );
  const rowKept =
    joined?.pages.some((page) => page.items.some((item) => item.id === CASE)) ??
    false;
  const detailGone = client.getQueryData(DETAIL_KEY) === undefined;
  const caseThreadGone =
    client.getQueryData(threadKey(CASE_PARENT)) === undefined;
  let cleanup: Cleanup = "none";
  if (
    detailGone &&
    caseThreadGone &&
    summary?.isParticipant === false &&
    !rowKept
  )
    cleanup = "afterLeave";
  else if (
    detailGone &&
    caseThreadGone &&
    summary?.isParticipant === true &&
    rowKept
  )
    cleanup = "content";
  return {
    cleanup,
    otherRoomThreadKept:
      client.getQueryData(threadKey(OTHER_PARENT)) !== undefined,
  };
}

beforeEach(async () => {
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  vi.stubGlobal("reportError", vi.fn());
  FakeBroadcastChannel.clearSent();
  vi.mocked(isUserSwitchReloadRequested).mockReset();
  vi.mocked(isUserSwitchReloadRequested).mockReturnValue(false);
  vi.mocked(noteDraftsRemain).mockClear();
  atEntry = [];
  draftsAtAnnounce = [];
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(["auth", "session"], sessionOf(USER));
  vi.mocked(requestAccessLossReload).mockReset();
  vi.mocked(requestAccessLossReload).mockImplementation((queryClient) => {
    atEntry.push({
      detailCached: queryClient.getQueryData(DETAIL_KEY) !== undefined,
      announced: announced().length,
      drafts: caseDraftsPresent(),
    });
    return Promise.resolve();
  });
  FakeBroadcastChannel.onPost.mockImplementation(() => {
    draftsAtAnnounce.push(caseDraftsPresent());
  });
  for (const key of [ROOM_DRAFT, THREAD_DRAFT, OTHER_DRAFT]) writeDraft(key);
  // 利用者の世代を数える見張り（main.tsx と同じく登録する）
  uninstall = installCaseAccessLossMonitor(client);
  await primeCaches();
});
afterEach(() => {
  uninstall();
  client.clear();
  FakeBroadcastChannel.onPost.mockReset();
  vi.unstubAllGlobals();
});

function expectNoSideEffects() {
  expect(observeCleanup().cleanup).toBe("none");
  expect(entryCalls()).toHaveLength(0);
  expect(announced()).toEqual([]);
  expect(caseDraftsPresent()).toBe(true);
}

describe("#342 AC-4 U8 participant：確かめの成功だけを返す", () => {
  it("#342 AC-4 U8: いまの文脈で参加者なら confirmed。片付け・入口・合図・下書きの消去をせず、参加の期間を進めない", () => {
    const period = currentLossPeriod(client, USER, CASE);
    expect(
      settleVerifiedCaseAccess(client, currentContext(), "participant"),
    ).toBe("confirmed");
    expectNoSideEffects();
    expect(currentLossPeriod(client, USER, CASE)).toBe(period);
  });

  it("#342 AC-4 U8: 参加者の確定は、合図・下書きの印を外さない（同じ期間で合図を送った後に confirmed でも、同じ期間の2回目の合図は送らない）", () => {
    const period = currentLossPeriod(client, USER, CASE);
    announceCaseAccessLossOnce(client, USER, CASE, period);
    expect(announced()).toHaveLength(1);
    expect(
      settleVerifiedCaseAccess(client, currentContext(), "participant"),
    ).toBe("confirmed");
    announceCaseAccessLossOnce(client, USER, CASE, period);
    expect(announced()).toHaveLength(1);
  });
});

describe("#342 AC-5 U8 lost・notFound は共通の確定へ、forbidden は中身の片付けと入口だけ", () => {
  it.each([
    ["lost", "afterLeave"],
    ["notFound", "content"],
  ] as const)(
    '#342 AC-5 U8: %s なら handedOff。片付け（%s。スレッドは "room"）→ 入口（lost）→ 合図1回 → 下書きの消去の順',
    (verdict, cleanup) => {
      expect(settleVerifiedCaseAccess(client, currentContext(), verdict)).toBe(
        "handedOff",
      );
      expect(observeCleanup()).toEqual({ cleanup, otherRoomThreadKept: true });
      expect(entryCalls()).toEqual([
        [client, { ownerId: USER, reason: "lost" }],
      ]);
      expect(atEntry).toEqual([
        { detailCached: false, announced: 0, drafts: true },
      ]);
      expect(announced()).toEqual([{ v: 1, userId: USER, caseId: CASE }]);
      expect(draftsAtAnnounce).toEqual([true]);
      expect(caseDraftsGone()).toBe(true);
      expect(window.localStorage.getItem(OTHER_DRAFT)).not.toBeNull();
    },
  );

  it('#342 AC-5 U8: forbidden（概要の 403）なら handedOff。中身を片付け（概要・一覧は参加者のまま。スレッドは "room"）、入口（lost）を呼ぶ。合図・下書きの消去はせず、参加の期間を変えない', () => {
    const period = currentLossPeriod(client, USER, CASE);
    expect(
      settleVerifiedCaseAccess(client, currentContext(), "forbidden"),
    ).toBe("handedOff");
    expect(observeCleanup()).toEqual({
      cleanup: "content",
      otherRoomThreadKept: true,
    });
    expect(entryCalls()).toEqual([[client, { ownerId: USER, reason: "lost" }]]);
    expect(atEntry[0]?.detailCached).toBe(false);
    expect(announced()).toEqual([]);
    expect(caseDraftsPresent()).toBe(true);
    expect(noteDraftsRemain).not.toHaveBeenCalled();
    expect(currentLossPeriod(client, USER, CASE)).toBe(period);
  });

  it("#342 AC-5 U8: 下書き・スレッドの片付けに使う部屋の ID は、控えた文脈のもの（キャッシュから部屋が分からなくても消す）", () => {
    client.removeQueries({ queryKey: SUMMARY_KEY });
    client.removeQueries({ queryKey: DETAIL_KEY });
    expect(settleVerifiedCaseAccess(client, currentContext(ROOM), "lost")).toBe(
      "handedOff",
    );
    expect(caseDraftsGone()).toBe(true);
    expect(client.getQueryData(threadKey(CASE_PARENT))).toBeUndefined();
    expect(client.getQueryData(threadKey(OTHER_PARENT))).toBeDefined();
  });

  it("#342 AC-5 U8: 部屋の ID が分からない（null）文脈では、下書きを消さない（入口・合図は行う）", () => {
    expect(settleVerifiedCaseAccess(client, currentContext(null), "lost")).toBe(
      "handedOff",
    );
    expect(entryCalls()).toHaveLength(1);
    expect(announced()).toHaveLength(1);
    expect(caseDraftsPresent()).toBe(true);
  });

  it("#342 AC-5 U8: 同じ参加の期間で2回確定しても、合図と下書きの処理は1回（1回目の後に書いた新しい下書きは残る）", () => {
    const context = currentContext();
    expect(settleVerifiedCaseAccess(client, context, "lost")).toBe("handedOff");
    writeDraft(ROOM_DRAFT);
    settleVerifiedCaseAccess(client, context, "notFound");
    expect(announced()).toHaveLength(1);
    expect(window.localStorage.getItem(ROOM_DRAFT)).not.toBeNull();
  });
});

describe("#342 AC-3 U8 switched", () => {
  it("#342 AC-3 U8: 切り替えの入口が動いていれば handedOff。喪失の片付け・入口・合図・下書きの消去はしない", () => {
    vi.mocked(isUserSwitchReloadRequested).mockReturnValue(true);
    expect(settleVerifiedCaseAccess(client, currentContext(), "switched")).toBe(
      "handedOff",
    );
    expectNoSideEffects();
  });

  it("#342 AC-3・AC-6 U8: 切り替えの入口が動いていなければ unverified（引き渡しを確かめられない）。副作用なし", () => {
    expect(settleVerifiedCaseAccess(client, currentContext(), "switched")).toBe(
      "unverified",
    );
    expectNoSideEffects();
  });
});

const ADOPTABLE: Verdict[] = ["participant", "lost", "notFound", "forbidden"];

describe("#342 AC-6・AC-7 U8 照合（stillCurrent）が成り立たなければ、副作用なしで unverified", () => {
  it.each(ADOPTABLE)(
    "#342 AC-6・AC-7 U8: セッションの利用者が別の利用者なら、%s でも unverified",
    (verdict) => {
      const context = currentContext();
      client.setQueryData(["auth", "session"], sessionOf(OTHER_USER));
      expect(settleVerifiedCaseAccess(client, context, verdict)).toBe(
        "unverified",
      );
      expectNoSideEffects();
    },
  );

  it.each(ADOPTABLE)(
    "#342 AC-6・AC-7 U8: セッションのキャッシュが無ければ（ログアウトの後など）、%s でも unverified",
    (verdict) => {
      const context = currentContext();
      client.removeQueries({ queryKey: ["auth", "session"] });
      expect(settleVerifiedCaseAccess(client, context, verdict)).toBe(
        "unverified",
      );
      expectNoSideEffects();
    },
  );

  it.each(ADOPTABLE)(
    "#342 AC-6・AC-7 U8: 利用者の世代が進んだ（A → B → A）なら、%s でも unverified",
    (verdict) => {
      const context = currentContext();
      client.setQueryData(["auth", "session"], sessionOf(OTHER_USER));
      client.setQueryData(["auth", "session"], sessionOf(USER));
      expect(currentUserGeneration(client)).not.toBe(context.generation);
      expect(settleVerifiedCaseAccess(client, context, verdict)).toBe(
        "unverified",
      );
      expectNoSideEffects();
    },
  );

  it.each(ADOPTABLE)(
    "#342 AC-6・AC-7 U8: 参加の期間が進んだ（通常の確かめが参加者に戻したなど）なら、%s でも unverified",
    (verdict) => {
      const context = currentContext();
      startCaseParticipationPeriod(client, USER, CASE);
      expect(settleVerifiedCaseAccess(client, context, verdict)).toBe(
        "unverified",
      );
      expectNoSideEffects();
    },
  );
});
