// #137 AC-1（1-4 AC-1・AC-2・AC-3）: useThreadReplies(parentMessageId) — スレッドの返信を2秒ごとに「最後のID以降」で取り足す。API は MSW、時間は vi の fake timers で進める。
// 契約（実装前の仮置き。計画 plan-137 の「5. 返信の取得 EP-1-07」）：
//   features/messages/hooks/useThreadReplies.ts が useThreadReplies(parentMessageId: string) を公開する。戻り値は TanStack Query の結果。
//   data は { parent: RoomMessage, replies: RoomMessage[]（ID昇順）, replyBlockedReason: string | null }。
//   初回は最新の一覧（after なし。応答は新しい順）、以降は返信の末尾のID（after）で取り足す。まだ返信がないときは、2秒ごとに最新の一覧を取り直す。
//   hasMore が真の間は待たずに続けて取る。応答のたびに parent・replyBlockedReason を最新に置き換える（親の削除・編集、返信できなくなったことが届く）。
//   401・403・404 の失敗のあとは次の間隔で要求しない。タブが非表示の間は止まる（useRoomMessages と同じ）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiErrorResponse,
  message,
  reply,
  respondReplies,
} from "../../../test/message-handlers";
import { server } from "../../../test/server";
import { requestAccessLossReload } from "../../access-loss";
import { installCaseAccessLossMonitor } from "../../cases";
import { useThreadReplies } from "./useThreadReplies";

const PARENT = message(1, { replyCount: 2 });
const rep = (n: number) => reply(PARENT, n);

function setup(parentId = PARENT.id) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useThreadReplies(parentId), { wrapper });
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const replyIds = (data: { replies: { id: string }[] } | undefined): string[] =>
  (data?.replies ?? []).map((m) => m.id);
const ids = (...numbers: number[]) => numbers.map((n) => rep(n).id);

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  setVisibility("visible");
  vi.useRealTimers();
});

describe("#137 AC-1（1-4 AC-1・AC-3）返信の取得", () => {
  it("#137 AC-1（1-4 AC-3）: 初回は最新の返信（after なし）を昇順で取り、親と返信できる状態も受け取る", async () => {
    const state = respondReplies({ parent: PARENT, replies: [rep(1), rep(2)] });
    const { result } = setup();
    await waitFor(() =>
      expect(replyIds(result.current.data)).toEqual(ids(1, 2)),
    );
    expect(state.requests[0]?.searchParams.has("after")).toBe(false);
    expect(result.current.data?.parent.id).toBe(PARENT.id);
    expect(result.current.data?.parent.replyCount).toBe(2);
    expect(result.current.data?.replyBlockedReason).toBeNull();
  });

  it("#137 AC-1（1-4 AC-3）: 2秒ごとに、返信の末尾のID（after）で取り足し、他の人の新しい返信が再読み込みなしで増える", async () => {
    const state = respondReplies({ parent: PARENT, replies: [rep(1), rep(2)] });
    const { result } = setup();
    await waitFor(() =>
      expect(replyIds(result.current.data)).toEqual(ids(1, 2)),
    );
    const before = state.requests.length;
    await advance(1000);
    expect(state.requests).toHaveLength(before);

    await advance(1500);
    expect(state.requests.at(-1)?.searchParams.get("after")).toBe(ids(2)[0]);
    state.replies.push(rep(3));
    await advance(2000);
    await waitFor(() =>
      expect(replyIds(result.current.data)).toEqual(ids(1, 2, 3)),
    );
    await advance(2000);
    expect(state.requests.at(-1)?.searchParams.get("after")).toBe(ids(3)[0]);
  });

  it("#137 AC-1（1-4 AC-3）: hasMore が真の間は、2秒待たずに続けて取り、取りこぼさない", async () => {
    const state = respondReplies(
      { parent: PARENT, replies: [rep(1)] },
      { afterPageSize: 2 },
    );
    const { result } = setup();
    await waitFor(() => expect(replyIds(result.current.data)).toEqual(ids(1)));
    state.replies.push(rep(2), rep(3), rep(4), rep(5));
    const before = state.requests.length;
    await advance(2000);
    await waitFor(() =>
      expect(replyIds(result.current.data)).toEqual(ids(1, 2, 3, 4, 5)),
    );
    expect(
      state.requests.slice(before).map((u) => u.searchParams.get("after")),
    ).toEqual([ids(1)[0], ids(3)[0]]);
  });

  it("#137 AC-1（1-4 AC-3）: 取得済みの返信が応答にまた含まれても、重複せずID昇順のまま", async () => {
    let call = 0;
    const common = {
      parent: PARENT,
      replyBlockedReason: null,
      caseRoom: false,
      caseId: null,
      joined: true,
      roomWritable: true,
    };
    server.use(
      http.get("/api/messages/:messageId/replies", () => {
        call += 1;
        return call === 1
          ? HttpResponse.json({
              items: [rep(2), rep(1)],
              nextCursor: null,
              hasMore: false,
              ...common,
            })
          : HttpResponse.json({
              items: [rep(1), rep(2), rep(3)],
              nextCursor: null,
              hasMore: false,
              ...common,
            });
      }),
    );
    const { result } = setup();
    await waitFor(() =>
      expect(replyIds(result.current.data)).toEqual(ids(1, 2)),
    );
    await advance(2000);
    await waitFor(() =>
      expect(replyIds(result.current.data)).toEqual(ids(1, 2, 3)),
    );
  });

  it("#137 AC-1（1-4 AC-3）: 返信が0件のあいだも2秒ごとに取り直し、最初の返信が届くと出る", async () => {
    const state = respondReplies({ parent: message(1), replies: [] });
    const { result } = setup();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(replyIds(result.current.data)).toEqual([]);
    state.replies.push(rep(1));
    await advance(2500);
    await waitFor(() => expect(replyIds(result.current.data)).toEqual(ids(1)));
  });
});

describe("#137 AC-2（1-4 AC-2）親の削除などの変化が届く", () => {
  it("#137 AC-2: 2秒後の取得で、親が削除済み（body なし）・返信できない理由（deleted_parent）に変わり、既存の返信は残る", async () => {
    const state = respondReplies({ parent: PARENT, replies: [rep(1), rep(2)] });
    const { result } = setup();
    await waitFor(() =>
      expect(replyIds(result.current.data)).toEqual(ids(1, 2)),
    );
    state.parent = { ...state.parent, deleted: true, body: null };
    state.replyBlockedReason = "deleted_parent";
    await advance(2500);
    await waitFor(() =>
      expect(result.current.data?.replyBlockedReason).toBe("deleted_parent"),
    );
    expect(result.current.data?.parent.deleted).toBe(true);
    expect(result.current.data?.parent.body).toBeNull();
    expect(replyIds(result.current.data)).toEqual(ids(1, 2));
  });
});

describe("#137 AC-1 失敗したとき・非表示のとき", () => {
  it.each([401, 403, 404])(
    "#137 AC-1: %i を受けたら、取得済みの返信は残し、それ以降は要求しない",
    async (status) => {
      const state = respondReplies({ parent: PARENT, replies: [rep(1)] });
      const { result } = setup();
      await waitFor(() =>
        expect(replyIds(result.current.data)).toEqual(ids(1)),
      );
      server.use(
        http.get("/api/messages/:messageId/replies", () => {
          state.requests.push(new URL("http://localhost/failed"));
          return apiErrorResponse(status, "ANY");
        }),
      );
      await advance(2500);
      await waitFor(() => expect(result.current.isError).toBe(true));
      const stopped = state.requests.length;
      await advance(8000);
      expect(state.requests).toHaveLength(stopped);
      expect(replyIds(result.current.data)).toEqual(ids(1));
    },
  );

  it("#137 AC-1: 非表示の間は取りに行かず、表示に戻ったら取り直して新しい返信を得る", async () => {
    const state = respondReplies({ parent: PARENT, replies: [rep(1)] });
    const { result } = setup();
    await waitFor(() => expect(replyIds(result.current.data)).toEqual(ids(1)));
    setVisibility("hidden");
    const hiddenAt = state.requests.length;
    await advance(8000);
    expect(state.requests).toHaveLength(hiddenAt);
    state.replies.push(rep(2));
    setVisibility("visible");
    await waitFor(() =>
      expect(replyIds(result.current.data)).toEqual(ids(1, 2)),
    );
  });

  it("#137 AC-1: 別のスレッドへ替えると、前のスレッドの返信は混ざらず、新しいスレッドの最新の返信から取る", async () => {
    const other = message(2, { replyCount: 1 });
    respondReplies({ parent: PARENT, replies: [rep(1)] });
    respondReplies({ parent: other, replies: [reply(other, 50)] });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useThreadReplies(id),
      {
        initialProps: { id: PARENT.id },
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      },
    );
    await waitFor(() => expect(replyIds(result.current.data)).toEqual(ids(1)));
    rerender({ id: other.id });
    await waitFor(() =>
      expect(replyIds(result.current.data)).toEqual([reply(other, 50).id]),
    );
  });
});

describe("#137 AC-4（1-4 AC-4・C-172 統括(8)）参加・書き込みの状態の変化が届く", () => {
  it("#137 AC-4: 2秒後の取り足し（after あり）で、joined が真から偽に変わったら、新しい値に置き換える", async () => {
    const state = respondReplies({ parent: PARENT, replies: [rep(1)] });
    const { result } = setup();
    await waitFor(() => expect(replyIds(result.current.data)).toEqual(ids(1)));
    expect(result.current.data?.joined).toBe(true);
    state.joined = false;
    await advance(2500);
    await waitFor(() => expect(result.current.data?.joined).toBe(false));
    expect(state.requests.at(-1)?.searchParams.get("after")).toBe(rep(1).id);
    expect(replyIds(result.current.data)).toEqual(ids(1));
  });

  it("#137 AC-4: 2秒後の取り足し（after あり）で、roomWritable が真から偽に変わったら（部署の無効化・DM の相手の無効化）、新しい値に置き換える", async () => {
    const state = respondReplies({ parent: PARENT, replies: [rep(1)] });
    const { result } = setup();
    await waitFor(() => expect(replyIds(result.current.data)).toEqual(ids(1)));
    expect(result.current.data?.roomWritable).toBe(true);
    state.roomWritable = false;
    await advance(2500);
    await waitFor(() => expect(result.current.data?.roomWritable).toBe(false));
    expect(state.requests.at(-1)?.searchParams.get("after")).toBe(rep(1).id);
    expect(replyIds(result.current.data)).toEqual(ids(1));
  });
});

// #339 AC-1（計画 plan-339 の 2 節「返信の403・404では、直前に成功した Query データの caseId と parent.roomId を使う」・5 節）：
// useThreadReplies は、最新の取得・追加の取得とも、応答の caseId を data に保持する。追加の取得が0件でも、案件の ID を消さない。
// その後の 404（エラー応答に caseId は無い）で、全体の見張り（installCaseAccessLossMonitor）が、保持した caseId の概要を確かめる。
// 前提にした口（実装の担当へ）：ThreadRepliesData に caseId: string | null。
//   features/cases（index）の installCaseAccessLossMonitor(queryClient): () => void（解除の関数を返す）。
//   概要の確かめは GET /api/cases/:caseId（fetchCaseSummary）を直接呼ぶ。入口は test/setup.ts の vi.fn。
describe("#339 AC-1 返信の caseId の保持と、その後の 404", () => {
  const CASE_ID = "01JTESTCASE339000000000HR1";
  const CASE_ROOM = "01JTESTROOM339000000000HR1";
  const CASE_PARENT = message(1, { roomId: CASE_ROOM, replyCount: 1 });
  const SESSION = {
    user: {
      id: "01JTESTUSER000000000000001",
      displayName: "testuser_001",
      loginId: "testuser_001",
    },
    mustChangePassword: false,
    reauthenticatedAt: null,
    permissions: [],
  };
  let uninstall: (() => void) | undefined;

  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
  });

  async function setupWithMonitor(parentId: string) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(["auth", "session"], SESSION);
    uninstall = installCaseAccessLossMonitor(client);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return renderHook(() => useThreadReplies(parentId), { wrapper });
  }

  function respondSummary() {
    const summaryCalls: string[] = [];
    server.use(
      http.get("/api/cases/:caseId", ({ params }) => {
        summaryCalls.push(String(params.caseId));
        return HttpResponse.json({
          id: String(params.caseId),
          caseNumber: "QZA-261125-0339",
          title: "[UNIT_TEST]339案件",
          status: "active",
          client: {
            id: "01JTESTCLIENT339000000HR1",
            name: "[UNIT_TEST]339取引先",
            isActive: true,
          },
          departments: [],
          dueDate: null,
          isParticipant: false,
          canManage: false,
          participantCount: null,
          canEditDueDate: false,
          progress: null,
          lastActivityAt: null,
          channelId: null,
        });
      }),
    );
    return summaryCalls;
  }

  it("#339 AC-1: 追加返信が0件でもcaseIdを保持し、その後の404から確認できる（最新の取得 → 0件の追加の取得 → 404 の順）", async () => {
    vi.mocked(requestAccessLossReload).mockClear();
    const summaryCalls = respondSummary();
    const state = respondReplies({
      parent: CASE_PARENT,
      replies: [reply(CASE_PARENT, 1)],
      caseRoom: true,
      caseId: CASE_ID,
    });
    const { result } = await setupWithMonitor(CASE_PARENT.id);
    await waitFor(() => expect(result.current.data?.caseId).toBe(CASE_ID));
    expect(state.requests[0]?.searchParams.has("after")).toBe(false);

    // 追加の取得（after あり）が0件
    const before = state.requests.length;
    await advance(2500);
    await waitFor(() => expect(state.requests.length).toBeGreaterThan(before));
    expect(state.requests.at(-1)?.searchParams.get("after")).toBe(
      reply(CASE_PARENT, 1).id,
    );
    expect(result.current.data?.caseId).toBe(CASE_ID);
    expect(replyIdsOf(result.current.data)).toEqual([reply(CASE_PARENT, 1).id]);
    expect(summaryCalls).toEqual([]);

    // 404（エラー応答には caseId が無い）
    server.use(
      http.get("/api/messages/:messageId/replies", () =>
        apiErrorResponse(404, "NOT_FOUND", "[UNIT_TEST]339見つかりません"),
      ),
    );
    await advance(2500);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data?.caseId).toBe(CASE_ID);
    await waitFor(() => expect(summaryCalls).toEqual([CASE_ID]));
    await waitFor(() =>
      expect(vi.mocked(requestAccessLossReload).mock.calls).toHaveLength(1),
    );
    expect(vi.mocked(requestAccessLossReload).mock.calls[0]?.[1]).toEqual({
      ownerId: SESSION.user.id,
      reason: "lost",
    });
  });

  it("#339 AC-1: 通常のチャンネル・DM のスレッド（caseId が null）は、0件の追加の取得の後の 404 でも、概要を確かめない", async () => {
    vi.mocked(requestAccessLossReload).mockClear();
    const summaryCalls = respondSummary();
    const state = respondReplies({ parent: PARENT, replies: [rep(1)] });
    const { result } = await setupWithMonitor(PARENT.id);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.caseId).toBeNull();
    const before = state.requests.length;
    await advance(2500);
    await waitFor(() => expect(state.requests.length).toBeGreaterThan(before));
    expect(result.current.data?.caseId).toBeNull();
    server.use(
      http.get("/api/messages/:messageId/replies", () =>
        apiErrorResponse(404, "NOT_FOUND"),
      ),
    );
    await advance(2500);
    await waitFor(() => expect(result.current.isError).toBe(true));
    await advance(4000);
    expect(summaryCalls).toEqual([]);
    expect(vi.mocked(requestAccessLossReload)).not.toHaveBeenCalled();
  });
});

function replyIdsOf(data: { replies: { id: string }[] } | undefined): string[] {
  return (data?.replies ?? []).map((m) => m.id);
}
