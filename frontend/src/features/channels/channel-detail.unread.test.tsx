// #237 AC-2（3-1 AC-2）：チャンネルの詳細（S-05。ChannelDetailView）を開くと既読になり、サイドバーの件数が再読み込みなしで消える。API は MSW。データは架空。
// 契約（実装者へ。計画「1. 画面から既読にする時機」・改訂2 D）：
//   ChannelDetailView は、詳細の取得が成功して joined が真のときだけ、useMarkRoomRead(roomId).markRead を RoomMessages の onLatestMessageIdChange に渡す。
//   詳細の取得中・未参加の公開チャンネルでは送らない。参加した後の詳細の取り直しが終わってから送る。
//   既読の送信が失敗したら、部屋の近くに role=alert で「既読の状態を更新できませんでした」と次の行動の文（describeError）を出す。次の既読が成功したら消える。
//   チャンネルを移っても（ChannelDetailPage は key を付けない）、移った先の部屋の既読を送る。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { respondShellUser } from "../../test/app-shell-harness";
import { channelItem } from "../../test/channel-handlers";
import { message, type TestMessage } from "../../test/message-handlers";
import { server } from "../../test/server";
import { respondUnread, type UnreadWorld } from "../../test/unread-handlers";
import { ChannelDetailView, JoinedChannelsSection } from "./index";

const ROOM_A = "01JTESTXNREADCHAN00000000A";
const ROOM_B = "01JTESTXNREADCHAN00000000B";
const FAILURE_TEXT = "既読の状態を更新できませんでした";

type ChannelState = { joined: boolean; name: string };

/**
 * チャンネルの詳細・参加・メッセージの一覧を、部屋ごとの状態つきで返す。
 * holdDetail を設定すると、次の詳細の応答を、その Promise が解けるまで待たせる（参加の後の取り直しの途中を作る）。
 */
function respondRooms(
  initial: Record<string, ChannelState>,
  messages: Record<string, TestMessage[]>,
) {
  const state = {
    channels: new Map(Object.entries(initial).map(([id, s]) => [id, { ...s }])),
    messages: new Map(
      Object.entries(messages).map(([id, list]) => [id, [...list]]),
    ),
    holdDetail: null as Promise<void> | null,
  };
  server.use(
    http.get("/api/channels/:channelId", async ({ params }) => {
      const id = String(params.channelId);
      const channel = state.channels.get(id);
      if (channel === undefined)
        return HttpResponse.json(
          { code: "NOT_FOUND", message: "x" },
          { status: 404 },
        );
      if (state.holdDetail !== null) await state.holdDetail;
      return HttpResponse.json({
        id,
        roomId: id,
        name: channel.name,
        description: "",
        visibility: "public",
        departmentId: null,
        isCaseChannel: false,
        joined: channel.joined,
        canPost: channel.joined,
        // #134：詳細の応答に readOnly（部署が無効）が加わった
        readOnly: false,
        ...(channel.joined
          ? {
              memberCount: 1,
              members: [
                { id: "01JTESTUSER000000000000001", displayName: "テスト太郎" },
              ],
            }
          : {}),
      });
    }),
    http.post("/api/channels/:channelId/join", ({ params }) => {
      const id = String(params.channelId);
      const channel = state.channels.get(id);
      if (channel === undefined)
        return HttpResponse.json(
          { code: "NOT_FOUND", message: "x" },
          { status: 404 },
        );
      channel.joined = true;
      return HttpResponse.json({
        channelId: id,
        roomId: id,
        joinedAt: "2026-11-13T00:00:00.000Z",
      });
    }),
    http.get("/api/channels", () =>
      HttpResponse.json({
        items: [...state.channels.entries()]
          .filter(([, c]) => c.joined)
          .map(([id, c]) =>
            channelItem("0", { id, roomId: id, name: c.name, joined: true }),
          ),
        nextCursor: null,
      }),
    ),
    http.get("/api/rooms/:roomId/messages", ({ params, request }) => {
      const list = state.messages.get(String(params.roomId)) ?? [];
      const after = new URL(request.url).searchParams.get("after");
      if (after === null)
        return HttpResponse.json({
          items: list.slice(-50).reverse(),
          nextCursor: null,
          hasMore: false,
        });
      return HttpResponse.json({
        items: list.filter((m) => m.id > after),
        nextCursor: null,
        hasMore: false,
      });
    }),
  );
  return state;
}

/** 部屋 B のメッセージ。部屋 A のどのメッセージよりも小さい ID */
const smallMessage = (n: number, roomId: string) =>
  message(n, {
    id: `01JTESTMSG0000000000000${String(n).padStart(3, "0")}`,
    roomId,
  });

function renderTree(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const result = render(
    <MemoryRouter>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...result, user, client };
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const waitPuts = (world: UnreadWorld, count: number) =>
  waitFor(() => expect(world.puts).toHaveLength(count));

async function settle() {
  await advance(100);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  respondShellUser();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("#237 AC-2（3-1 AC-2）S-05 を開くと既読になる", () => {
  it("#237 AC-2: 参加中のチャンネルを開くと、表示している最新のメッセージの ID で既読を1回送る", async () => {
    respondRooms(
      { [ROOM_A]: { joined: true, name: "[E2E_TEST]既読A" } },
      {
        [ROOM_A]: [
          message(1, { roomId: ROOM_A }),
          message(2, { roomId: ROOM_A }),
        ],
      },
    );
    const world = respondUnread();
    renderTree(<ChannelDetailView channelId={ROOM_A} />);
    await waitPuts(world, 1);
    expect(world.puts[0]).toEqual({
      roomId: ROOM_A,
      lastReadMessageId: message(2).id,
    });
    await advance(2500);
    await settle();
    expect(world.puts).toHaveLength(1);
  });

  it("#237 AC-2: 開いている間に新着が表示されたら、新しい最新の ID で次の既読を送る", async () => {
    const rooms = respondRooms(
      { [ROOM_A]: { joined: true, name: "[E2E_TEST]既読A" } },
      {
        [ROOM_A]: [message(1, { roomId: ROOM_A })],
      },
    );
    const world = respondUnread();
    renderTree(<ChannelDetailView channelId={ROOM_A} />);
    await waitPuts(world, 1);
    rooms.messages.get(ROOM_A)?.push(message(2, { roomId: ROOM_A }));
    await advance(2500);
    await waitPuts(world, 2);
    expect(world.puts[1]).toEqual({
      roomId: ROOM_A,
      lastReadMessageId: message(2).id,
    });
  });

  it("#237 AC-2（1-1 AC-2・C-94）: 未参加の公開チャンネルは、読めても既読を送らない", async () => {
    respondRooms(
      { [ROOM_A]: { joined: false, name: "[E2E_TEST]未参加" } },
      {
        [ROOM_A]: [
          message(1, { roomId: ROOM_A, body: "[E2E_TEST]読める投稿" }),
        ],
      },
    );
    const world = respondUnread();
    renderTree(<ChannelDetailView channelId={ROOM_A} />);
    await within(await screen.findByRole("log")).findByText(
      "[E2E_TEST]読める投稿",
    );
    await advance(2500);
    await settle();
    expect(world.puts).toEqual([]);
  });

  it("#237 AC-2（改訂2 D）: 参加すると、詳細の取り直しが終わってから既読を1回送る（取り直しの途中では送らない）", async () => {
    const rooms = respondRooms(
      { [ROOM_A]: { joined: false, name: "[E2E_TEST]参加する" } },
      {
        [ROOM_A]: [message(1, { roomId: ROOM_A })],
      },
    );
    const world = respondUnread();
    const { user } = renderTree(<ChannelDetailView channelId={ROOM_A} />);
    const join = await screen.findByRole("button", { name: "参加する" });
    let release = () => {};
    rooms.holdDetail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await user.click(join);
    await advance(500);
    expect(world.puts).toEqual([]);
    rooms.holdDetail = null;
    release();
    await waitPuts(world, 1);
    expect(world.puts[0]).toEqual({
      roomId: ROOM_A,
      lastReadMessageId: message(1).id,
    });
    await settle();
    expect(world.puts).toHaveLength(1);
  });

  it("#237 AC-2: 既読になると、サイドバーの件数が再読み込みなしで消える", async () => {
    respondRooms(
      { [ROOM_A]: { joined: true, name: "[E2E_TEST]件数が消える" } },
      {
        [ROOM_A]: [
          message(1, { roomId: ROOM_A }),
          message(2, { roomId: ROOM_A }),
        ],
      },
    );
    const world = respondUnread({ counts: { [ROOM_A]: 2 } });
    // 既読の応答を止めて、先に件数が出ていることを確かめてから、既読を完了させる
    const release = world.holdPut(ROOM_A, message(2).id);
    renderTree(
      <>
        <nav aria-label="テスト用サイドバー">
          <JoinedChannelsSection linkClassName={() => ""} />
        </nav>
        <main>
          <ChannelDetailView channelId={ROOM_A} />
        </main>
      </>,
    );
    const nav = await screen.findByRole("navigation", {
      name: "テスト用サイドバー",
    });
    await within(nav).findByRole("link", {
      name: /^\[E2E_TEST\]件数が消える\s+未読 2件$/,
    });
    await waitPuts(world, 1);
    release();
    await waitFor(() =>
      expect(
        within(nav).getByRole("link", { name: /^\[E2E_TEST\]件数が消える$/ }),
      ).toBeDefined(),
    );
    expect(within(nav).queryByText("2", { exact: true })).toBeNull();
  });
});

describe("#237 AC-2 既読の失敗（もみ消さない）", () => {
  it("#237 AC-2: 既読の送信が失敗すると、部屋の近くに失敗と次の行動を出し、次の新着で送り直して成功すると消える", async () => {
    const rooms = respondRooms(
      { [ROOM_A]: { joined: true, name: "[E2E_TEST]失敗" } },
      {
        [ROOM_A]: [message(1, { roomId: ROOM_A })],
      },
    );
    const world = respondUnread();
    world.failNextPut = { status: 500 };
    renderTree(<ChannelDetailView channelId={ROOM_A} />);
    const alert = await screen.findByText(new RegExp(FAILURE_TEXT));
    expect(alert.closest("[role='alert']")).not.toBeNull();
    rooms.messages.get(ROOM_A)?.push(message(2, { roomId: ROOM_A }));
    await advance(2500);
    await waitPuts(world, 2);
    expect(world.puts[1]).toEqual({
      roomId: ROOM_A,
      lastReadMessageId: message(2).id,
    });
    await waitFor(() =>
      expect(screen.queryByText(new RegExp(FAILURE_TEXT))).toBeNull(),
    );
  });
});

describe("#237 AC-2（改訂2 D【重大】）チャンネルを移ったとき", () => {
  it("#237 AC-2: key を付けずにチャンネル A から、最新の ID が A より小さいチャンネル B に移っても、B の既読を送る", async () => {
    respondRooms(
      {
        [ROOM_A]: { joined: true, name: "[E2E_TEST]移る前" },
        [ROOM_B]: { joined: true, name: "[E2E_TEST]移った先" },
      },
      {
        [ROOM_A]: [message(9, { roomId: ROOM_A })],
        [ROOM_B]: [smallMessage(1, ROOM_B)],
      },
    );
    const world = respondUnread({ counts: { [ROOM_B]: 1 } });
    const { rerender, client } = renderTree(
      <ChannelDetailView channelId={ROOM_A} />,
    );
    await waitPuts(world, 1);
    expect(world.puts[0]).toEqual({
      roomId: ROOM_A,
      lastReadMessageId: message(9).id,
    });
    rerender(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ChannelDetailView channelId={ROOM_B} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await waitPuts(world, 2);
    expect(world.puts[1]).toEqual({
      roomId: ROOM_B,
      lastReadMessageId: smallMessage(1, ROOM_B).id,
    });
  });
});
