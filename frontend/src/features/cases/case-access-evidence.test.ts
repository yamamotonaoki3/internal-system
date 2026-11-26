// #339 AC-1・AC-3（計画 plan-339 の 2 節「取得実績は Query キャッシュから求める」・5 節「片付け・Query削除・購読解除後は古い実績で確認しない」）：
// 取得の実績（返信・スレッド一覧の行・部屋のメッセージ）は、その場の Query のキャッシュから読む。独立した台帳は作らない。
//   キャッシュが消された（片付け・Query の削除）後は、実績として使わない（中継の確かめ・見張りの確かめとも）。
//   行の消失の比較用の情報（取得を始めた時点の一覧の { parentId, caseId, roomId }）は、片付け・Query の削除・利用者の切り替え・購読の解除で捨てる。
//   捨てた後に遅れて届いた応答で、比較用の情報を作り直さない（消失と見なさない）。
// 確かめは、外から見える動き（概要の GET の回数・入口）で見る。実績を読む関数そのものの名前には依らない。
// 前提にした口（実装の担当へ）：features/cases の installCaseAccessLossMonitor(queryClient): () => void・installCaseAccessLossRelay(queryClient): () => void。
//   片付けは features/cases/hooks/useCaseWrites.ts の forgetCaseContent・forgetCaseAfterLeave（既存）。
// 入口は vi.fn。チャンネルはテスト専用の差し替え。データはすべて架空（testuser_・[UNIT_TEST]）。
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestAccessLossReload } from "../access-loss/reload-after-access-loss";
import { installUserSwitchGuard } from "../auth";
import { fetchMyThreads } from "../threads/api/thread-api";
import { TEST_USER } from "../../test/auth-handlers";
import {
  caseId as caseIdOf,
  caseRoomId,
  outsiderSummary,
} from "../../test/case-handlers";
import {
  FakeBroadcastChannel,
  flushTasks,
  postFromOtherTab,
} from "../../test/fake-broadcast-channel";
import { message, reply } from "../../test/message-handlers";
import { server } from "../../test/server";
import { threadItem, type TestThread } from "../../test/thread-handlers";
import { installCaseAccessLossMonitor } from "./case-access-loss-monitor";
import { installCaseAccessLossRelay } from "./case-access-loss-relay";
import { forgetCaseAfterLeave, forgetCaseContent } from "./hooks/useCaseWrites";

vi.mock("../access-loss/reload-after-access-loss", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestAccessLossReload: vi.fn(() => Promise.resolve()),
}));

const N = 3393;
const USER = TEST_USER.id;
const USER_B = {
  id: "01JTESTUSER339000000000EV2",
  displayName: "testuser_339_ev_b",
  loginId: "testuser_339_ev_b",
};
const CASE = caseIdOf(N);
const ROOM = caseRoomId(N);
const CHANNEL = "internal-system:access-loss:v1";
const THREAD_LIST_KEY = ["threads", "list"];

const sessionOf = (user: {
  id: string;
  displayName: string;
  loginId: string;
}) => ({
  user,
  mustChangePassword: false,
  reauthenticatedAt: null,
  permissions: [],
});

const CASE_ROW: TestThread = threadItem(1, {
  room: { kind: "channel", id: ROOM, name: "[UNIT_TEST]339案件の部屋" },
  caseId: CASE,
});
const CHANNEL_ROW: TestThread = threadItem(2, {
  room: {
    kind: "channel",
    id: "01JTESTROOM339000000000EV9",
    name: "[UNIT_TEST]339通常の部屋",
  },
});
const CASE_PARENT = CASE_ROW.parent.id;

let client: QueryClient;
let uninstallMonitor: (() => void) | undefined;
let uninstallRelay: (() => void) | undefined;
let stopObserver: (() => void) | undefined;
let summaryCalls: number;
let listState: {
  rows: TestThread[];
  gate: Promise<void> | null;
  calls: number;
};

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function fetchedCaseReplies() {
  const parent = message(1, { id: CASE_PARENT, roomId: ROOM, replyCount: 1 });
  await client.fetchQuery({
    queryKey: ["messages", "thread", CASE_PARENT],
    queryFn: () =>
      Promise.resolve({
        parent,
        replies: [reply(parent, 1)],
        replyBlockedReason: null,
        joined: true,
        roomWritable: true,
        caseRoom: true,
        caseId: CASE,
      }),
  });
}

async function openThreadList() {
  const observer = new InfiniteQueryObserver(client, {
    queryKey: THREAD_LIST_KEY,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      fetchMyThreads(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: { nextCursor: string | null }) =>
      last.nextCursor ?? undefined,
    retry: false,
  });
  stopObserver = observer.subscribe(() => undefined);
  await vi.waitFor(() =>
    expect(client.getQueryState(THREAD_LIST_KEY)?.status).toBe("success"),
  );
}

const entryCalls = () => vi.mocked(requestAccessLossReload).mock.calls;

beforeEach(() => {
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  vi.stubGlobal("reportError", vi.fn());
  vi.mocked(requestAccessLossReload).mockClear();
  summaryCalls = 0;
  listState = { rows: [CASE_ROW, CHANNEL_ROW], gate: null, calls: 0 };
  server.use(
    http.get("/api/cases/:caseId", () => {
      summaryCalls += 1;
      return HttpResponse.json(outsiderSummary(N));
    }),
    http.get("/api/me/threads", async () => {
      listState.calls += 1;
      const rows = [...listState.rows];
      if (listState.gate !== null) await listState.gate;
      return HttpResponse.json({ items: rows, nextCursor: null });
    }),
  );
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(["auth", "session"], sessionOf(TEST_USER));
});
afterEach(() => {
  uninstallMonitor?.();
  uninstallMonitor = undefined;
  uninstallRelay?.();
  uninstallRelay = undefined;
  stopObserver?.();
  stopObserver = undefined;
  client.clear();
  vi.unstubAllGlobals();
});

describe("#339 AC-1 消された実績で確かめない（中継）", () => {
  it.each([
    [
      "Query の削除（removeQueries）",
      () => client.removeQueries({ queryKey: ["messages", "thread"] }),
    ],
    [
      '片付け（forgetCaseContent の "room"）',
      () => void forgetCaseContent(client, USER, CASE, ROOM, "room"),
    ],
  ])(
    "#339 AC-1: 片付け・Query削除・購読解除後は古い実績で確認しない：返信の実績を%sで消した後の合図は、GET 0回・入口なし",
    async (_label, erase) => {
      uninstallRelay = installCaseAccessLossRelay(client);
      await fetchedCaseReplies();
      erase();
      expect(
        client.getQueryData(["messages", "thread", CASE_PARENT]),
      ).toBeUndefined();
      postFromOtherTab(CHANNEL, { v: 1, userId: USER, caseId: CASE });
      await flushTasks(10);
      expect(summaryCalls).toBe(0);
      expect(entryCalls()).toHaveLength(0);
    },
  );

  it("#339 AC-1: 片付け・Query削除・購読解除後は古い実績で確認しない：スレッド一覧の Query を消した後の合図は、GET 0回", async () => {
    uninstallRelay = installCaseAccessLossRelay(client);
    await openThreadList();
    stopObserver?.();
    stopObserver = undefined;
    client.removeQueries({ queryKey: THREAD_LIST_KEY });
    postFromOtherTab(CHANNEL, { v: 1, userId: USER, caseId: CASE });
    await flushTasks(10);
    expect(summaryCalls).toBe(0);
  });

  it("#339 AC-1: 片付け・Query削除・購読解除後は古い実績で確認しない：対照として、実績が残っていれば、同じ合図で GET 1回・入口1回", async () => {
    uninstallRelay = installCaseAccessLossRelay(client);
    await fetchedCaseReplies();
    postFromOtherTab(CHANNEL, { v: 1, userId: USER, caseId: CASE });
    await vi.waitFor(() => expect(entryCalls()).toHaveLength(1));
    expect(summaryCalls).toBe(1);
  });
});

describe("#339 AC-3 行の消失の比較用の情報を捨てる（見張り）", () => {
  it("#339 AC-1: 片付け・Query削除・購読解除後は古い実績で確認しない：対照として、比較用の情報が生きていれば、行の消失で GET 1回", async () => {
    uninstallMonitor = installCaseAccessLossMonitor(client);
    await openThreadList();
    listState.rows = [CHANNEL_ROW];
    await client.refetchQueries({ queryKey: THREAD_LIST_KEY });
    await vi.waitFor(() => expect(summaryCalls).toBe(1));
  });

  it.each([
    [
      "Query の削除",
      () => {
        stopObserver?.();
        stopObserver = undefined;
        client.removeQueries({ queryKey: THREAD_LIST_KEY });
      },
    ],
    [
      "購読の解除（見張りを外して、付け直す）",
      () => {
        uninstallMonitor?.();
        uninstallMonitor = installCaseAccessLossMonitor(client);
      },
    ],
    [
      "利用者の切り替え（B のセッション。見張りがキャッシュを捨てる）",
      () => client.setQueryData(["auth", "session"], sessionOf(USER_B)),
    ],
    [
      "その案件の中身片付け（forgetCaseContent）",
      () => void forgetCaseContent(client, USER, CASE, ROOM, "room"),
    ],
    [
      "その案件の後片付け（forgetCaseAfterLeave）",
      () => void forgetCaseAfterLeave(client, USER, CASE, ROOM, "room"),
    ],
    [
      "手での書き換え（setQueryData で一覧を書き直す）",
      () =>
        client.setQueryData(THREAD_LIST_KEY, {
          pages: [{ items: [CASE_ROW, CHANNEL_ROW], nextCursor: null }],
          pageParams: [undefined],
        }),
    ],
  ])(
    "#339 AC-1: 片付け・Query削除・購読解除後は古い実績で確認しない：一覧の取り直しの途中の%sの後に、遅れて行の無い応答が届いても、確かめない",
    async (_label, discard) => {
      const stopGuard = installUserSwitchGuard(client);
      try {
        uninstallMonitor = installCaseAccessLossMonitor(client);
        await openThreadList();
        const gate = deferred();
        listState.gate = gate.promise;
        listState.rows = [CHANNEL_ROW];
        const refetching = client
          .refetchQueries({ queryKey: THREAD_LIST_KEY })
          .catch((error: unknown) => error);
        await vi.waitFor(() => expect(listState.calls).toBe(2));
        discard();
        listState.gate = null;
        gate.release();
        await refetching;
        await flushTasks(10);
        expect(summaryCalls).toBe(0);
        expect(entryCalls()).toHaveLength(0);
      } finally {
        stopGuard();
      }
    },
  );
});
