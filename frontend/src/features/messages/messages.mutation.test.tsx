// #201 AC-2・AC-4: メッセージの画面側の境界（ミューテーションで生き残った分岐）。
// 入力欄のショートカット・二重送信ガード・エラー表示の振り分け、ポーリングの上限・表示に戻ったときの取り直し、
// 投稿後の取り直しの範囲、部屋ごとのキー、時刻の表示、応答の形の検証。
// 方針：振る舞い（表示の有無・aria-invalid・要求の回数と宛先・戻り値）で確かめ、文言の完全一致では見ない。データは架空。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MESSAGE_BODY_MAX_LENGTH,
  messageBodySchema,
} from "../../../../shared/message-rules";
import {
  ROOM_ID,
  apiErrorResponse,
  message,
  respondMessages,
} from "../../test/message-handlers";
import { server } from "../../test/server";
import { postMessage } from "./api/message-api";
import { messageKeys } from "./api/query-keys";
import { MessageComposer } from "./components/MessageComposer";
import { RoomMessages } from "./components/RoomMessages";
import { usePostMessage } from "./hooks/usePostMessage";
import { useRoomMessages } from "./hooks/useRoomMessages";

const MESSAGES_URL = "/api/rooms/:roomId/messages";

function newClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}
const providerOf = (client: QueryClient) =>
  function Provider({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };

describe("#201 AC-4 query-keys", () => {
  it("#201 AC-4: 部屋ごとに別のキーになり、同じ部屋は同じキーになる", () => {
    expect(messageKeys.room("room-a")).not.toEqual(messageKeys.room("room-b"));
    expect(messageKeys.room("room-a")).toEqual(messageKeys.room("room-a"));
    expect(Array.isArray(messageKeys.room("room-a"))).toBe(true);
  });
});

describe("#201 AC-2 shared/message-rules の入力チェック", () => {
  it.each([
    ["空白だけ", " \n "],
    [
      `${MESSAGE_BODY_MAX_LENGTH + 1}文字`,
      "a".repeat(MESSAGE_BODY_MAX_LENGTH + 1),
    ],
  ])(
    "#201 AC-2: %s は拒否し、利用者に見せる説明が空でなく、理由ごとに違う",
    (_l, value) => {
      const result = messageBodySchema.safeParse(value);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message.length).toBeGreaterThan(0);
    },
  );

  it("#201 AC-2: 空白だけの説明と長すぎる説明は別の文", () => {
    const blank = messageBodySchema.safeParse(" ").error?.issues[0]?.message;
    const long = messageBodySchema.safeParse(
      "a".repeat(MESSAGE_BODY_MAX_LENGTH + 1),
    ).error?.issues[0]?.message;
    expect(blank).not.toEqual(long);
  });

  it("#201 AC-2: 上限ちょうどの長さは受け付ける", () => {
    expect(
      messageBodySchema.safeParse("a".repeat(MESSAGE_BODY_MAX_LENGTH)).success,
    ).toBe(true);
  });
});

describe("#201 AC-4 postMessage の応答の検証", () => {
  it("#201 AC-4: 投稿の応答の id・roomId・createdAt をそのまま返す", async () => {
    server.use(
      http.post(MESSAGES_URL, () =>
        HttpResponse.json(
          {
            id: message(9).id,
            roomId: ROOM_ID,
            createdAt: "2026-11-09T00:00:00.000Z",
          },
          { status: 201 },
        ),
      ),
    );
    expect(await postMessage(ROOM_ID, "[E2E_TEST]本文")).toEqual({
      id: message(9).id,
      roomId: ROOM_ID,
      createdAt: "2026-11-09T00:00:00.000Z",
    });
  });

  it.each([
    ["id がない", { roomId: ROOM_ID, createdAt: "x" }],
    ["id が空", { id: "", roomId: ROOM_ID, createdAt: "x" }],
    ["roomId が空", { id: "a", roomId: "", createdAt: "x" }],
    ["createdAt がない", { id: "a", roomId: ROOM_ID }],
  ])("#201 AC-4: 応答に%sときは、成功にせず失敗する", async (_l, body) => {
    server.use(
      http.post(MESSAGES_URL, () => HttpResponse.json(body, { status: 201 })),
    );
    await expect(postMessage(ROOM_ID, "[E2E_TEST]本文")).rejects.toBeDefined();
  });
});

describe("#201 AC-4 usePostMessage", () => {
  it("#201 AC-4: 投稿に成功すると、その部屋の一覧だけを古い扱いにし、ほかの部屋には触れない", async () => {
    respondMessages([]);
    const client = newClient();
    client.setQueryData(messageKeys.room(ROOM_ID), []);
    client.setQueryData(messageKeys.room("OTHER_ROOM"), []);
    const { result } = renderHook(() => usePostMessage(ROOM_ID), {
      wrapper: providerOf(client),
    });
    await act(async () => {
      await result.current.mutateAsync("[E2E_TEST]本文");
    });
    expect(client.getQueryState(messageKeys.room(ROOM_ID))?.isInvalidated).toBe(
      true,
    );
    expect(
      client.getQueryState(messageKeys.room("OTHER_ROOM"))?.isInvalidated,
    ).toBe(false);
  });

  it("#201 AC-4: 投稿に失敗したときは、一覧を古い扱いにしない", async () => {
    server.use(
      http.post(MESSAGES_URL, () => apiErrorResponse(500, "INTERNAL")),
    );
    const client = newClient();
    client.setQueryData(messageKeys.room(ROOM_ID), []);
    const { result } = renderHook(() => usePostMessage(ROOM_ID), {
      wrapper: providerOf(client),
    });
    await act(async () => {
      await result.current.mutateAsync("[E2E_TEST]本文").catch(() => undefined);
    });
    expect(client.getQueryState(messageKeys.room(ROOM_ID))?.isInvalidated).toBe(
      false,
    );
  });
});

function renderComposer() {
  return render(<MessageComposer roomId={ROOM_ID} />, {
    wrapper: providerOf(newClient()),
  });
}
const box = () =>
  screen.findByRole("textbox", {
    name: "メッセージ",
  }) as Promise<HTMLTextAreaElement>;
const sendButton = () => screen.getByRole("button", { name: "送信" });

describe("#201 AC-4 MessageComposer のショートカットと二重送信", () => {
  it("#201 AC-4: 最初はエラー表示（alert）がない", async () => {
    renderComposer();
    await box();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("#201 AC-4: Ctrl+Enter は送信し、ブラウザの既定の動作（改行）は止める。Enter だけ・Ctrl+別キーは止めず、送らない", async () => {
    const state = respondMessages([]);
    renderComposer();
    const input = await box();
    fireEvent.change(input, { target: { value: "[E2E_TEST]ショートカット" } });
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(true);
    expect(fireEvent.keyDown(input, { key: "a", ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(input, { key: "a", metaKey: true })).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(state.posts).toEqual([]);
    expect(fireEvent.keyDown(input, { key: "Enter", ctrlKey: true })).toBe(
      false,
    );
    await waitFor(() =>
      expect(state.posts).toEqual(["[E2E_TEST]ショートカット"]),
    );
  });

  it.each([
    ["Ctrl+Enter", { ctrlKey: true }],
    ["Cmd+Enter", { metaKey: true }],
  ])(
    "#201 AC-4: %s を送信中にもう一度押しても、二重には送らない",
    async (_l, modifier) => {
      let posts = 0;
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      server.use(
        http.post(MESSAGES_URL, async () => {
          posts += 1;
          await gate;
          return HttpResponse.json(
            {
              id: message(1).id,
              roomId: ROOM_ID,
              createdAt: "2026-11-09T00:00:00.000Z",
            },
            { status: 201 },
          );
        }),
      );
      renderComposer();
      const input = await box();
      fireEvent.change(input, { target: { value: "[E2E_TEST]二重" } });
      fireEvent.keyDown(input, { key: "Enter", ...modifier });
      await waitFor(() =>
        expect(sendButton().hasAttribute("disabled")).toBe(true),
      );
      fireEvent.keyDown(input, { key: "Enter", ...modifier });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(posts).toBe(1);
      release();
      await waitFor(() => expect(input.value).toBe(""));
      expect(posts).toBe(1);
    },
  );
});

describe("#201 AC-2・AC-4 MessageComposer のエラーの出し分け", () => {
  it.each([
    ["422（fields に body）", 422, { fields: ["body"] }, "field"],
    ["422（fields が body 以外）", 422, { fields: ["other"] }, "alert"],
    ["422（fields なし）", 422, {}, "alert"],
    ["500（fields に body があっても）", 500, { fields: ["body"] }, "alert"],
    ["500", 500, {}, "alert"],
  ] as const)(
    "#201 AC-2: サーバーが%sを返したとき、表示は %s になり、入力は消さない",
    async (_l, status, extra, place) => {
      server.use(
        http.post(MESSAGES_URL, () =>
          apiErrorResponse(
            status,
            status === 422 ? "VALIDATION_ERROR" : "INTERNAL",
            "サーバーからの説明です",
            extra,
          ),
        ),
      );
      renderComposer();
      const input = await box();
      fireEvent.change(input, { target: { value: "[E2E_TEST]本文" } });
      fireEvent.click(sendButton());
      if (place === "field") {
        await waitFor(() =>
          expect(input.getAttribute("aria-invalid")).toBe("true"),
        );
        expect(screen.queryByRole("alert")).toBeNull();
      } else {
        expect((await screen.findByRole("alert")).textContent).toContain(
          "サーバーからの説明です",
        );
        expect(input.getAttribute("aria-invalid")).toBeNull();
      }
      expect(input.value).toBe("[E2E_TEST]本文");
    },
  );
});

describe("#201 AC-4 MessageList の時刻", () => {
  it("#201 AC-4: 投稿者の表示名の後に、秒なしの短い日時を出す", async () => {
    respondMessages([message(1)]);
    const { container } = render(
      <RoomMessages roomId={ROOM_ID} canPost={false} joined={false} />,
      { wrapper: providerOf(newClient()) },
    );
    await screen.findByRole("log");
    await waitFor(() => expect(container.querySelector("time")).not.toBeNull());
    expect(container.querySelector("time")?.textContent).toMatch(
      /^\d{4}\/\d{1,2}\/\d{1,2} \d{1,2}:\d{2}$/,
    );
    expect(container.querySelector("time")?.parentElement?.textContent).toMatch(
      /^テスト太郎 \d{4}\//,
    );
  });
});

function setVisibility(state: "visible" | "hidden", notify = true) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  if (notify) document.dispatchEvent(new Event("visibilitychange"));
}
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const dataIds = (data: { id: string }[] | undefined) =>
  (data ?? []).map((m) => m.id);
const ids = (...numbers: number[]) => numbers.map((n) => message(n).id);

describe("#201 AC-4 useRoomMessages の取得上限と表示への復帰", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    setVisibility("visible");
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("#201 AC-3: 続きがあり続けても、1回のポーリングで続けて取るのは5回まで（残りは次の間隔）", async () => {
    const afterRequests: string[] = [];
    let latest = 1;
    server.use(
      http.get(MESSAGES_URL, ({ request }) => {
        const after = new URL(request.url).searchParams.get("after");
        if (after === null)
          return HttpResponse.json({
            items: [message(1)],
            nextCursor: null,
            hasMore: false,
          });
        afterRequests.push(after);
        latest += 1;
        return HttpResponse.json({
          items: [message(latest)],
          nextCursor: null,
          hasMore: true,
        });
      }),
    );
    const { result, unmount } = renderHook(() => useRoomMessages(ROOM_ID), {
      wrapper: providerOf(newClient()),
    });
    await waitFor(() => expect(dataIds(result.current.data)).toEqual(ids(1)));
    await advance(2100);
    await waitFor(() => expect(afterRequests).toHaveLength(5));
    await advance(300);
    expect(afterRequests).toHaveLength(5);
    expect(afterRequests).toEqual(ids(1, 2, 3, 4, 5));
    expect(dataIds(result.current.data)).toEqual(ids(1, 2, 3, 4, 5, 6));
    unmount();
  });

  function trackedRoom(roomId = ROOM_ID) {
    const state = respondMessages([message(1)]);
    const client = newClient();
    const hook = renderHook(({ id }) => useRoomMessages(id), {
      wrapper: providerOf(client),
      initialProps: { id: roomId },
    });
    return { state, client, ...hook };
  }

  it("#201 AC-4: 表示に戻ったときの取り直しは1回だけ。表示のままのイベントでは取り直さない", async () => {
    const { state, result } = trackedRoom();
    await waitFor(() => expect(dataIds(result.current.data)).toEqual(ids(1)));
    const before = state.requests.length;
    setVisibility("hidden");
    setVisibility("visible");
    await waitFor(() => expect(state.requests).toHaveLength(before + 1));
    await advance(300);
    setVisibility("visible");
    await advance(300);
    expect(state.requests).toHaveLength(before + 1);
  });

  it("#201 AC-4: 最初から非表示だったタブが表示に戻ったときも、取り直す", async () => {
    setVisibility("hidden", false);
    const { state, result } = trackedRoom();
    await waitFor(() => expect(dataIds(result.current.data)).toEqual(ids(1)));
    const before = state.requests.length;
    setVisibility("visible");
    await waitFor(() => expect(state.requests).toHaveLength(before + 1));
  });

  it("#201 AC-4: 取得中に表示へ戻っても、取得を中断して重ねない", async () => {
    let requests = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(MESSAGES_URL, async () => {
        requests += 1;
        await gate;
        return HttpResponse.json({
          items: [message(1)],
          nextCursor: null,
          hasMore: false,
        });
      }),
    );
    const { result } = renderHook(() => useRoomMessages(ROOM_ID), {
      wrapper: providerOf(newClient()),
    });
    await waitFor(() => expect(requests).toBe(1));
    setVisibility("hidden");
    setVisibility("visible");
    await advance(300);
    expect(requests).toBe(1);
    release();
    await waitFor(() => expect(dataIds(result.current.data)).toEqual(ids(1)));
    expect(requests).toBe(1);
  });

  it("#201 AC-4: 表示に戻ったときに取り直すのは、この部屋の一覧だけ（ほかの一覧は取り直さない）", async () => {
    const { client, state, result } = trackedRoom();
    const other = vi.fn(async () => ["other"]);
    await client.prefetchQuery({
      queryKey: messageKeys.room("OTHER_ROOM"),
      queryFn: other,
    });
    await waitFor(() => expect(dataIds(result.current.data)).toEqual(ids(1)));
    const before = state.requests.length;
    setVisibility("hidden");
    setVisibility("visible");
    await waitFor(() => expect(state.requests).toHaveLength(before + 1));
    await advance(300);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it("#201 AC-4: 部屋が切り替わったあとは、新しい部屋を取り直す", async () => {
    const { state, result, rerender } = trackedRoom("ROOM_A");
    await waitFor(() => expect(dataIds(result.current.data)).toEqual(ids(1)));
    rerender({ id: "ROOM_B" });
    await waitFor(() =>
      expect(state.requests.at(-1)?.pathname).toBe(
        "/api/rooms/ROOM_B/messages",
      ),
    );
    await waitFor(() => expect(dataIds(result.current.data)).toEqual(ids(1)));
    await advance(300);
    const before = state.requests.length;
    setVisibility("hidden");
    setVisibility("visible");
    await waitFor(() => expect(state.requests).toHaveLength(before + 1));
    expect(state.requests.at(-1)?.pathname).toBe("/api/rooms/ROOM_B/messages");
  });

  it("#201 AC-4: 画面を離れたら、表示に戻ったときの取り直しの待ち受けをやめる", async () => {
    const added = vi.spyOn(document, "addEventListener");
    const removed = vi.spyOn(document, "removeEventListener");
    const { result, unmount } = trackedRoom();
    await waitFor(() => expect(dataIds(result.current.data)).toEqual(ids(1)));
    const registered = added.mock.calls
      .filter(([type]) => type === "visibilitychange")
      .map(([, listener]) => listener);
    expect(registered.length).toBeGreaterThan(0);
    unmount();
    const unregistered = removed.mock.calls
      .filter(([type]) => type === "visibilitychange")
      .map(([, listener]) => listener);
    for (const listener of registered) expect(unregistered).toContain(listener);
  });
});
