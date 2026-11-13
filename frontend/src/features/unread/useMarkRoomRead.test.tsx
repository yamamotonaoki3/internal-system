// #237 AC-2（3-1 AC-2）：useMarkRoomRead — 部屋で表示している最新のメッセージの ID まで既読を送る。API は MSW。
// 契約（実装者へ。計画「1. 画面から既読にする時機」・改訂2 D・改訂4-1）：
//   features/unread/index.ts から useMarkRoomRead(roomId: string) を公開する。戻り値は
//     { markRead: (messageId: string) => void;  // 表示している最新の ID を知らせる（RoomMessages の onLatestMessageIdChange に渡す）
//       error: unknown }                        // 今の部屋の、最後の既読の送信の失敗（なければ null）
//   送るのは、送った ID より大きい ID が来たときだけ（同じ ID・小さい ID は送らない）。
//   タブが非表示の間は送らず、表示に戻ったときに保留していた最新の ID を送る。
//   失敗したら「送った ID」を最後に成功した ID に戻し、次の機会（次の新着・表示に戻ったとき）に送り直す。成功したら失敗の表示は消える。
//   最後に成功した ID は、より大きいときだけ更新する（応答の順が入れ替わっても戻らない）。
//   状態は roomId と組で持ち、roomId が変わったら初期化する（使う側の key に頼らない）。前の部屋の送信の結果では、今の部屋の状態を変えない。
//   成功したら未読の件数（unreadKeys.all）を取り直す。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { respondUnread, type UnreadWorld } from "../../test/unread-handlers";
import { useMarkRoomRead, useUnreadCounts } from "./index";

const ROOM_A = "01JTESTXNREADMARK000000RMA";
const ROOM_B = "01JTESTXNREADMARK000000RMB";
/** 部屋 A のメッセージ（n の昇順に並ぶ） */
const a = (n: number) => `01JTESTXNREADMSGA${String(n).padStart(9, "0")}`;
/** 部屋 B のメッセージ。どれも部屋 A のメッセージより小さい ID */
const b = (n: number) => `01JTESTXNREADMSG0${String(n).padStart(9, "0")}`;

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function setup(roomId = ROOM_A) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    ({ room }: { room: string }) => ({
      mark: useMarkRoomRead(room),
      counts: useUnreadCounts(),
    }),
    { wrapper, initialProps: { room: roomId } },
  );
}

type Rendered = ReturnType<typeof setup>;

const mark = (rendered: Rendered, messageId: string) =>
  act(() => {
    rendered.result.current.mark.markRead(messageId);
  });

/** 送られた PUT が count 件になるまで待つ */
const waitPuts = (world: UnreadWorld, count: number) =>
  waitFor(() => expect(world.puts).toHaveLength(count));

/** 届いた要求を待ちきってから、件数が増えていないことを確かめる */
async function expectNoMorePuts(world: UnreadWorld, count: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  expect(world.puts).toHaveLength(count);
}

afterEach(() => {
  setVisibility("visible");
});

describe("#237 AC-2 最新の ID で既読を送る", () => {
  it("#237 AC-2: 最新の ID で1回送り、同じ ID・それより小さい ID では送らず、新しい ID で次を送る", async () => {
    const world = respondUnread();
    const rendered = setup();
    await mark(rendered, a(1));
    await waitPuts(world, 1);
    expect(world.puts[0]).toEqual({ roomId: ROOM_A, lastReadMessageId: a(1) });
    await mark(rendered, a(1));
    await mark(rendered, a(0));
    await expectNoMorePuts(world, 1);
    await mark(rendered, a(2));
    await waitPuts(world, 2);
    expect(world.puts[1]).toEqual({ roomId: ROOM_A, lastReadMessageId: a(2) });
  });

  it("#237 AC-2: 成功したら未読の件数を取り直し、その部屋の件数が再読み込みなしで消える", async () => {
    const world = respondUnread({ counts: { [ROOM_A]: 3, [ROOM_B]: 1 } });
    const rendered = setup();
    await waitFor(() =>
      expect(rendered.result.current.counts.data?.get(ROOM_A)).toBe(3),
    );
    const listsBefore = world.listRequests.length;
    await mark(rendered, a(3));
    await waitFor(() =>
      expect(rendered.result.current.counts.data?.has(ROOM_A)).toBe(false),
    );
    expect(world.listRequests.length).toBeGreaterThan(listsBefore);
    expect(rendered.result.current.counts.data?.get(ROOM_B)).toBe(1);
  });

  it("#237 AC-2: 失敗がなければ error は null", async () => {
    const world = respondUnread();
    const rendered = setup();
    await mark(rendered, a(1));
    await waitPuts(world, 1);
    expect(rendered.result.current.mark.error).toBeNull();
  });
});

describe("#237 AC-2 タブが非表示の間は送らない", () => {
  it("#237 AC-2: 非表示の間は送らず、表示に戻ったときに保留していた最新の ID を1回送る", async () => {
    const world = respondUnread();
    const rendered = setup();
    await act(() => setVisibility("hidden"));
    await mark(rendered, a(1));
    await mark(rendered, a(2));
    await expectNoMorePuts(world, 0);
    await act(() => setVisibility("visible"));
    await waitPuts(world, 1);
    expect(world.puts[0]).toEqual({ roomId: ROOM_A, lastReadMessageId: a(2) });
    await expectNoMorePuts(world, 1);
  });

  it("#237 AC-2: 保留がないまま表示に戻っても、送らない", async () => {
    const world = respondUnread();
    const rendered = setup();
    await mark(rendered, a(1));
    await waitPuts(world, 1);
    await act(() => setVisibility("hidden"));
    await act(() => setVisibility("visible"));
    await expectNoMorePuts(world, 1);
  });
});

describe("#237 AC-2 失敗と送り直し（もみ消さない）", () => {
  it("#237 AC-2: 失敗すると error に失敗が入り、次の新着で送り直して成功すると error が消える（改訂2 D①）", async () => {
    const world = respondUnread();
    world.failNextPut = { status: 500 };
    const rendered = setup();
    await mark(rendered, a(1));
    await waitFor(() =>
      expect(rendered.result.current.mark.error).not.toBeNull(),
    );
    await mark(rendered, a(2));
    await waitPuts(world, 2);
    expect(world.puts[1]).toEqual({ roomId: ROOM_A, lastReadMessageId: a(2) });
    await waitFor(() => expect(rendered.result.current.mark.error).toBeNull());
  });

  it("#237 AC-2: 失敗したあと、同じ ID でも表示に戻ったときに送り直す", async () => {
    const world = respondUnread();
    world.failNextPut = { status: 500 };
    const rendered = setup();
    await mark(rendered, a(1));
    await waitFor(() =>
      expect(rendered.result.current.mark.error).not.toBeNull(),
    );
    await act(() => setVisibility("hidden"));
    await act(() => setVisibility("visible"));
    await waitPuts(world, 2);
    expect(world.puts[1]).toEqual({ roomId: ROOM_A, lastReadMessageId: a(1) });
  });

  it("#237 AC-2（改訂2 D②）: 新しい ID の成功の後に古い ID の成功が届いても、最後に成功した ID は戻らない", async () => {
    const world = respondUnread();
    const rendered = setup();
    const releaseOld = world.holdPut(ROOM_A, a(1));
    await mark(rendered, a(1));
    await waitPuts(world, 1);
    await mark(rendered, a(2));
    await waitPuts(world, 2);
    await act(async () => {
      releaseOld();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    // 次の送信が失敗すると、送った ID は「最後に成功した ID」に戻る。それが a(2) のままなら、a(2) は送り直さない
    world.failNextPut = { status: 500 };
    await mark(rendered, a(3));
    await waitPuts(world, 3);
    await waitFor(() =>
      expect(rendered.result.current.mark.error).not.toBeNull(),
    );
    await mark(rendered, a(2));
    await expectNoMorePuts(world, 3);
  });
});

describe("#237 AC-2（改訂2 D【重大】・改訂4-1）部屋を移ったとき", () => {
  it("#237 AC-2: 部屋 A で新しい ID まで既読にした後、最新の ID が A より小さい部屋 B に移っても、B の既読を1回送る", async () => {
    const world = respondUnread({ counts: { [ROOM_B]: 2 } });
    const rendered = setup(ROOM_A);
    await mark(rendered, a(9));
    await waitPuts(world, 1);
    rendered.rerender({ room: ROOM_B });
    await mark(rendered, b(1));
    await waitPuts(world, 2);
    expect(world.puts[1]).toEqual({ roomId: ROOM_B, lastReadMessageId: b(1) });
    await waitFor(() =>
      expect(rendered.result.current.counts.data?.has(ROOM_B)).toBe(false),
    );
  });

  it("#237 AC-2: 部屋 A の失敗の表示は、部屋 B に移ると消える", async () => {
    const world = respondUnread();
    world.failNextPut = { status: 500 };
    const rendered = setup(ROOM_A);
    await mark(rendered, a(1));
    await waitFor(() =>
      expect(rendered.result.current.mark.error).not.toBeNull(),
    );
    rendered.rerender({ room: ROOM_B });
    await waitFor(() => expect(rendered.result.current.mark.error).toBeNull());
  });

  it("#237 AC-2（改訂4-1）: A への送信中に B へ移り、A の成功が後から返っても、B の判定は変わらず B の既読は送られる", async () => {
    const world = respondUnread();
    const rendered = setup(ROOM_A);
    const releaseA = world.holdPut(ROOM_A, a(9));
    await mark(rendered, a(9));
    await waitPuts(world, 1);
    rendered.rerender({ room: ROOM_B });
    await act(async () => {
      releaseA();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    await mark(rendered, b(1));
    await waitPuts(world, 2);
    expect(world.puts[1]).toEqual({ roomId: ROOM_B, lastReadMessageId: b(1) });
  });

  it("#237 AC-2（改訂4-1）: A への送信中に B へ移り、A の失敗が後から返っても、B に失敗の表示は出ない", async () => {
    const world = respondUnread();
    const rendered = setup(ROOM_A);
    const releaseA = world.holdPut(ROOM_A, a(1));
    world.failNextPut = { status: 500 };
    await mark(rendered, a(1));
    await waitPuts(world, 1);
    rendered.rerender({ room: ROOM_B });
    await act(async () => {
      releaseA();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(rendered.result.current.mark.error).toBeNull();
    await mark(rendered, b(1));
    await waitPuts(world, 2);
    expect(rendered.result.current.mark.error).toBeNull();
  });
});
