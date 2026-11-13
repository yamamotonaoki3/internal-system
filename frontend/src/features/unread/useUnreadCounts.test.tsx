// #237 AC-1・AC-2（3-1 AC-1・AC-2）：useUnreadCounts — 未読の件数を 2 秒ごとに取り、全ページを 1 つの対応表にまとめる。API は MSW、時間は vi の fake timers。
// 契約（実装者へ。計画「5. 画面」・改訂2 D③・E）：
//   features/unread/index.ts から useUnreadCounts() を公開する。戻り値は TanStack Query の結果で、data は ReadonlyMap<roomId, count>。
//   GET /api/me/unread を limit=100 で取り、nextCursor がある間は続けて取る（空の items のページがあっても続ける）。
//   全ページの取得は 20 ページまで（UNREAD_MAX_PAGES）。超えたら途中の結果を返さずエラーにする（一部だけの件数を出さない）。
//   2秒ごと（messages の MESSAGE_POLL_INTERVAL_MS）に取り直す。401・403 の失敗のあとは取り直さない。それ以外の失敗は次の間隔で再び取る。retry は false。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { respondUnread, respondUnreadPages } from "../../test/unread-handlers";
import { useUnreadCounts } from "./index";

const ROOM_A = "01JTESTXNREADR00000000000A";
const ROOM_B = "01JTESTXNREADR00000000000B";
const ROOM_C = "01JTESTXNREADR00000000000C";
const ROOM_D = "01JTESTXNREADR00000000000D";
const ROOM_E = "01JTESTXNREADR00000000000E";

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useUnreadCounts(), { wrapper });
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const entries = (data: ReadonlyMap<string, number> | undefined) =>
  data === undefined ? undefined : Object.fromEntries(data.entries());

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("#237 AC-1 全ページを 1 つの対応表にまとめる", () => {
  it("#237 AC-1: limit=100 で取り、nextCursor が null になるまで続けて取り、部屋ごとの件数の対応表にする", async () => {
    const world = respondUnread({
      counts: {
        [ROOM_A]: 1,
        [ROOM_B]: 99,
        [ROOM_C]: 100,
        [ROOM_D]: 3,
        [ROOM_E]: 2,
      },
      pageSize: 2,
    });
    const { result } = setup();
    await waitFor(() =>
      expect(entries(result.current.data)).toEqual({
        [ROOM_A]: 1,
        [ROOM_B]: 99,
        [ROOM_C]: 100,
        [ROOM_D]: 3,
        [ROOM_E]: 2,
      }),
    );
    expect(world.listRequests).toHaveLength(3);
    for (const url of world.listRequests)
      expect(url.searchParams.get("limit")).toBe("100");
    expect(world.listRequests[0]?.searchParams.has("cursor")).toBe(false);
    expect(world.listRequests[1]?.searchParams.get("cursor")).toBe("c2");
    expect(world.listRequests[2]?.searchParams.get("cursor")).toBe("c4");
  });

  it("#237 AC-1: 未読がなければ空の対応表", async () => {
    respondUnread();
    const { result } = setup();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.size).toBe(0);
  });

  it("#237 AC-1（改訂2 D③）: ちょうど 20 ページまでは取り切り、件数を出す", async () => {
    const { requests } = respondUnreadPages(20);
    const { result } = setup();
    await waitFor(() => expect(result.current.data?.size).toBe(20));
    expect(requests).toHaveLength(20);
  });

  it("#237 AC-1（改訂2 D③）: 20 ページを超えると、途中の結果を返さずエラーにする（一部だけの件数を出さない）", async () => {
    const { requests } = respondUnreadPages(21);
    const { result } = setup();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(requests.length).toBeLessThanOrEqual(21);
  });
});

describe("#237 AC-1・AC-2 2秒ごとの取り直し", () => {
  it("#237 AC-1: 2秒ごとに取り直し、サーバーの件数の変化（新着・既読）が再読み込みなしで反映される", async () => {
    const world = respondUnread({ counts: { [ROOM_A]: 1 } });
    const { result } = setup();
    await waitFor(() =>
      expect(entries(result.current.data)).toEqual({ [ROOM_A]: 1 }),
    );
    const before = world.listRequests.length;
    await advance(1000);
    expect(world.listRequests).toHaveLength(before);
    world.counts.set(ROOM_A, 2);
    world.counts.set(ROOM_B, 1);
    await advance(1500);
    await waitFor(() =>
      expect(entries(result.current.data)).toEqual({
        [ROOM_A]: 2,
        [ROOM_B]: 1,
      }),
    );
    world.counts.delete(ROOM_A);
    await advance(2000);
    await waitFor(() =>
      expect(entries(result.current.data)).toEqual({ [ROOM_B]: 1 }),
    );
  });

  it.each([401, 403])(
    "#237 AC-1: %i の失敗のあとは取り直さない（待っても直らない）",
    async (status) => {
      const world = respondUnread({ counts: { [ROOM_A]: 1 } });
      world.failList = { status, times: 1 };
      const { result } = setup();
      await waitFor(() => expect(result.current.isError).toBe(true));
      const after = world.listRequests.length;
      await advance(6000);
      expect(world.listRequests).toHaveLength(after);
    },
  );

  it("#237 AC-1: 一時的な失敗（500）は自動で再試行せず、次の間隔で取り直して件数を出す", async () => {
    const world = respondUnread({ counts: { [ROOM_A]: 4 } });
    world.failList = { status: 500, times: 1 };
    const { result } = setup();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(world.listRequests).toHaveLength(1);
    await advance(2500);
    await waitFor(() =>
      expect(entries(result.current.data)).toEqual({ [ROOM_A]: 4 }),
    );
  });
});
