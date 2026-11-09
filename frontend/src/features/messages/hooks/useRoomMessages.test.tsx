// #201 AC-3・AC-4: useRoomMessages(roomId) — 2秒ごとの「最後のID以降」のポーリング。API は MSW、時間は vi の fake timers で進める。
// 契約（実装前の仮置き）：戻り値は TanStack Query の結果。data は ID昇順のメッセージの配列。
//   初回は最新50件（after なし）、以降は末尾のID（after）。hasMore が真の間は待たずに続けて取る。
//   401・403・404 の失敗のあとは次の間隔で要求しない。それ以外の失敗は取得済みの一覧を残し、次の間隔で再び取る。
//   タブが非表示の間は取らず、表示に戻ったら取り直す。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ROOM_ID,
  apiErrorResponse,
  message,
  respondMessages,
} from "../../../test/message-handlers";
import { server } from "../../../test/server";
import { useRoomMessages } from "./useRoomMessages";

function setup(roomId = ROOM_ID) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useRoomMessages(roomId), { wrapper });
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const dataIds = (data: { id: string }[] | undefined) =>
  (data ?? []).map((m) => m.id);
const ids = (...numbers: number[]) => numbers.map((n) => message(n).id);

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

describe("#201 AC-4 2秒ごとの取得", () => {
  it("#201 AC-4: 初回は最新の一覧（after なし）を昇順で取り、2秒ごとに末尾のIDを after にして新着だけを取り足す", async () => {
    const state = respondMessages([message(1), message(2)]);
    const { result } = setup();
    await waitFor(() =>
      expect(dataIds(result.current.data)).toEqual(ids(1, 2)),
    );
    expect(state.requests[0]?.searchParams.has("after")).toBe(false);

    // 2秒たつまでは取りに行かない
    const before = state.requests.length;
    await advance(1000);
    expect(state.requests).toHaveLength(before);

    await advance(1500);
    expect(state.requests.at(-1)?.searchParams.get("after")).toBe(ids(2)[0]);
    state.messages.push(message(3)); // 別の利用者の投稿
    await advance(2000);
    await waitFor(() =>
      expect(dataIds(result.current.data)).toEqual(ids(1, 2, 3)),
    );
    await advance(2000);
    expect(state.requests.at(-1)?.searchParams.get("after")).toBe(ids(3)[0]);
    expect(dataIds(result.current.data)).toEqual(ids(1, 2, 3));
  });

  it("#201 AC-3: hasMore が真の間は、2秒待たずに続けて取り、全件を取りこぼさない", async () => {
    const state = respondMessages([message(1)], { afterPageSize: 2 });
    const { result } = setup();
    await waitFor(() => expect(dataIds(result.current.data)).toEqual(ids(1)));
    state.messages.push(message(2), message(3), message(4), message(5));
    const before = state.requests.length;
    await advance(2000);
    await waitFor(() =>
      expect(dataIds(result.current.data)).toEqual(ids(1, 2, 3, 4, 5)),
    );
    expect(
      state.requests.slice(before).map((u) => u.searchParams.get("after")),
    ).toEqual([ids(1)[0], ids(3)[0]]);
  });

  it("#201 AC-4: 取得済みのメッセージが応答にまた含まれても、重複せずID昇順のまま", async () => {
    let call = 0;
    server.use(
      http.get("/api/rooms/:roomId/messages", () => {
        call += 1;
        return call === 1
          ? HttpResponse.json({
              items: [message(2), message(1)],
              nextCursor: null,
              hasMore: false,
            })
          : HttpResponse.json({
              items: [message(1), message(2), message(3)],
              nextCursor: null,
              hasMore: false,
            });
      }),
    );
    const { result } = setup();
    await waitFor(() =>
      expect(dataIds(result.current.data)).toEqual(ids(1, 2)),
    );
    await advance(2000);
    await waitFor(() =>
      expect(dataIds(result.current.data)).toEqual(ids(1, 2, 3)),
    );
  });
});

describe("#201 AC-4 失敗したとき", () => {
  it.each([401, 403, 404])(
    "#201 AC-4: %i を受けたら、取得済みの一覧は残し、それ以降は要求しない",
    async (status) => {
      const state = respondMessages([message(1), message(2)]);
      const { result } = setup();
      await waitFor(() =>
        expect(dataIds(result.current.data)).toEqual(ids(1, 2)),
      );
      server.use(
        http.get("/api/rooms/:roomId/messages", () => {
          state.requests.push(new URL("http://localhost/failed"));
          return apiErrorResponse(status, "ANY");
        }),
      );
      await advance(2500);
      await waitFor(() => expect(result.current.isError).toBe(true));
      const stopped = state.requests.length;
      await advance(8000);
      expect(state.requests).toHaveLength(stopped);
      expect(dataIds(result.current.data)).toEqual(ids(1, 2));
    },
  );

  it("#201 AC-4: 500 のときは取得済みの一覧を残してエラーにし、次の間隔で再び取り、戻ればエラーを消す", async () => {
    const state = respondMessages([message(1), message(2)]);
    const { result } = setup();
    await waitFor(() =>
      expect(dataIds(result.current.data)).toEqual(ids(1, 2)),
    );
    let failing = true;
    server.use(
      http.get("/api/rooms/:roomId/messages", ({ request }) => {
        state.requests.push(new URL(request.url));
        return failing
          ? apiErrorResponse(500, "INTERNAL")
          : HttpResponse.json({
              items: [message(3)],
              nextCursor: null,
              hasMore: false,
            });
      }),
    );
    await advance(2500);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(dataIds(result.current.data)).toEqual(ids(1, 2));
    failing = false;
    await advance(2500);
    await waitFor(() =>
      expect(dataIds(result.current.data)).toEqual(ids(1, 2, 3)),
    );
    expect(result.current.isError).toBe(false);
  });
});

describe("#201 AC-4 タブが非表示のとき", () => {
  it("#201 AC-4（U-3）: 非表示の間は取りに行かず、表示に戻ったら取り直して新着を得る", async () => {
    const state = respondMessages([message(1)]);
    const { result } = setup();
    await waitFor(() => expect(dataIds(result.current.data)).toEqual(ids(1)));
    setVisibility("hidden");
    const hiddenAt = state.requests.length;
    await advance(8000);
    expect(state.requests).toHaveLength(hiddenAt);

    state.messages.push(message(2));
    setVisibility("visible");
    await waitFor(() =>
      expect(dataIds(result.current.data)).toEqual(ids(1, 2)),
    );
  });
});
