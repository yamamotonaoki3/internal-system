// #136 AC-1（1-2 AC-1・AC-2・AC-5）: DM のサーバーの状態（TanStack Query）の Hooks。API は MSW。データは架空。
// 契約（実装前の仮置き。引き継ぎに明記）：
//   useDms()               … GET /api/dms をカーソルで続けて取る（useInfiniteQuery。data.pages[n].items・hasNextPage・fetchNextPage）
//   useDm(roomId)          … GET /api/dms/:roomId（404 は再試行せず、そのまま error にする）
//   useStartDm()           … POST /api/dms の mutation。mutateAsync(partnerUserId) は { roomId, partner } を返す。
//                            成功したら DM のキー全体（dmKeys.all）を invalidate する（開いている DM の一覧が再読み込みなしに取り直される）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  dmDetail,
  dmItem,
  dmRoomId,
  partnerId,
  respondDms,
} from "../../../test/dm-handlers";
import { server } from "../../../test/server";
import { useDm } from "./useDm";
import { useDms } from "./useDms";
import { useStartDm } from "./useStartDm";

function wrapperWith(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

describe("#136 AC-1（1-2 AC-5）useDms", () => {
  it("#136 AC-1（1-2 AC-5）: 最初のページを取り、nextCursor があれば続きを取れる", async () => {
    const world = respondDms({
      items: Array.from({ length: 3 }, (_v, i) => dmItem(i + 1)),
      pageSize: 2,
    });
    const { result } = renderHook(() => useDms(), {
      wrapper: wrapperWith(newClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages[0]?.items.map((i) => i.roomId)).toEqual([
      dmRoomId(1),
      dmRoomId(2),
    ]);
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(result.current.data?.pages[1]?.items.map((i) => i.roomId)).toEqual([
      dmRoomId(3),
    ]);
    expect(world.listRequests.map((u) => u.searchParams.get("cursor"))).toEqual(
      [null, "c2"],
    );
  });
});

describe("#136 AC-1（1-2 AC-2）useDm", () => {
  it("#136 AC-1（1-2 AC-2）: 当事者なら詳細を返す", async () => {
    respondDms({ details: [dmDetail(1)] });
    const { result } = renderHook(() => useDm(dmRoomId(1)), {
      wrapper: wrapperWith(newClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.partner.id).toBe(partnerId(1));
    expect(result.current.data?.canPost).toBe(true);
  });

  it("#136 AC-1（1-2 AC-2）: 404 は再試行せずに error（status 404）にする", async () => {
    const world = respondDms({ details: [] });
    // 既定で再試行する QueryClient でも、404 を取り直し続けない
    const client = new QueryClient();
    const { result } = renderHook(() => useDm(dmRoomId(9)), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ status: 404 });
    expect(world.detailRequests).toEqual([dmRoomId(9)]);
  });
});

describe("#136 AC-1（1-2 AC-1）useStartDm", () => {
  it("#136 AC-1（1-2 AC-1）: 開始すると roomId を返し、開いている DM の一覧を取り直す（再読み込みなしで新しい DM が出る）", async () => {
    const world = respondDms({
      items: [dmItem(1)],
      names: { [partnerId(7)]: "テスト新しい相手" },
    });
    const client = newClient();
    const list = renderHook(() => useDms(), { wrapper: wrapperWith(client) });
    // isSuccess ではなく data そのものを最初から待つ（既定の追跡で data の変化も再描画される）
    const names = () =>
      list.result.current.data?.pages[0]?.items.map(
        (i) => i.partner.displayName,
      );
    await waitFor(() =>
      expect(names()).toEqual([dmItem(1).partner.displayName]),
    );
    const before = world.listRequests.length;

    const start = renderHook(() => useStartDm(), {
      wrapper: wrapperWith(client),
    });
    let started: { roomId: string } | undefined;
    await act(async () => {
      started = await start.result.current.mutateAsync(partnerId(7));
    });
    expect(world.startBodies).toEqual([{ partnerUserId: partnerId(7) }]);
    expect(started?.roomId).toBe(world.items[0]?.roomId);
    await waitFor(() =>
      expect(world.listRequests.length).toBeGreaterThan(before),
    );
    await waitFor(() => expect(names()).toContain("テスト新しい相手"));
  });

  it("#136 AC-1（1-2 AC-1）: 失敗したら一覧を取り直さず、ApiError のまま失敗にする", async () => {
    const world = respondDms({ items: [dmItem(1)] });
    const client = newClient();
    const list = renderHook(() => useDms(), { wrapper: wrapperWith(client) });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    server.use(
      http.post("/api/dms", () =>
        HttpResponse.json(
          { code: "VALIDATION_ERROR", message: "自分にはDMを送れません" },
          { status: 422 },
        ),
      ),
    );
    const before = world.listRequests.length;
    const start = renderHook(() => useStartDm(), {
      wrapper: wrapperWith(client),
    });
    await act(async () => {
      await expect(
        start.result.current.mutateAsync(partnerId(1)),
      ).rejects.toMatchObject({ status: 422 });
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(world.listRequests.length).toBe(before);
  });
});
