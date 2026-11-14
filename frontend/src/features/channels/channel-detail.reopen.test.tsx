// #134 AC-1（利用者の決定 U-8・改訂1 の軽微5 ①②）: 部屋を開き直したら、最新の一覧から取り直す。チャンネルの詳細（S-05。ChannelDetailView）で確かめる。
// API は MSW。データは架空。
// 契約（実装前の仮置き。計画 plan-134 の U-8・改訂1 の軽微5）：
//   開いたままの画面には、他の人の編集・削除は届かない（2秒ごとの取得は after だけ）。部屋の画面を外れてから開き直すと、
//   キャッシュの古い一覧を使わず、最新の一覧（after なし）から取り直す。そのため、開き直した部屋には、外れていた間の編集・削除が出る。
//   ① 部屋 A → B → A と移ったとき、A の最新の一覧を表示した後に、A の最新の ID で既読を送る（古い一覧の ID・B の ID で A の既読を送らない）。
//   ② 投稿の下書き（端末に保存）は、開き直しても復元される（キャッシュを捨てても下書きは消えない）。
//   ChannelDetailPage は key を付けないため、ChannelDetailView の channelId を替えて描画し直すことで、部屋の移動を再現する（既存の #237 のテストと同じ）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHELL_USER, respondShellUser } from "../../test/app-shell-harness";
import {
  EDITED_AT,
  message,
  type TestMessage,
} from "../../test/message-handlers";
import { server } from "../../test/server";
import { respondUnread } from "../../test/unread-handlers";
import { authKeys } from "../auth";
import { ReauthProvider } from "../auth/ReauthProvider";
import { ChannelDetailView } from "./index";

const ROOM_A = "01JTESTXNREOPENCHAN000000A";
const ROOM_B = "01JTESTXNREOPENCHAN000000B";
const EDITED_MARK = "（編集済み）";
const DELETED_TEXT = "このメッセージは削除されました";

/** チャンネルの詳細（参加中・読み取り専用でない）と、部屋ごとのメッセージの一覧を、状態つきで返す */
function respondRooms(messages: Record<string, TestMessage[]>) {
  const state = {
    messages: new Map(
      Object.entries(messages).map(([id, list]) => [id, [...list]]),
    ),
    requests: [] as { roomId: string; after: string | null }[],
  };
  server.use(
    http.get("/api/channels/:channelId", ({ params }) => {
      const id = String(params.channelId);
      return HttpResponse.json({
        id,
        roomId: id,
        name: `[E2E_TEST]開き直し${id.slice(-1)}`,
        description: "",
        visibility: "public",
        departmentId: null,
        isCaseChannel: false,
        joined: true,
        canPost: true,
        readOnly: false,
        memberCount: 1,
        members: [{ id: SHELL_USER.id, displayName: SHELL_USER.displayName }],
      });
    }),
    http.get("/api/rooms/:roomId/messages", ({ params, request }) => {
      const roomId = String(params.roomId);
      const list = state.messages.get(roomId) ?? [];
      const after = new URL(request.url).searchParams.get("after");
      state.requests.push({ roomId, after });
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

const mine = (n: number, roomId: string, body: string) =>
  message(n, {
    roomId,
    author: { id: SHELL_USER.id, displayName: SHELL_USER.displayName },
    body,
  });

/** 部屋 B のメッセージ。部屋 A のどのメッセージよりも小さい ID */
const smallMessage = (n: number, roomId: string, body: string) =>
  message(n, {
    id: `01JTESTMSG0000000000000${String(n).padStart(3, "0")}`,
    roomId,
    body,
  });

function renderTree() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const tree = (children: ReactNode) => (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ReauthProvider>{children}</ReauthProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
  const result = render(tree(<ChannelDetailView channelId={ROOM_A} />));
  const open = (roomId: string) =>
    result.rerender(tree(<ChannelDetailView channelId={roomId} />));
  return { client, user, open };
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

async function rowWith(text: string): Promise<HTMLElement> {
  return waitFor(() => {
    const row = within(screen.getByRole("log"))
      .getAllByRole("listitem")
      .filter((li) => li.parentElement?.closest("li") === null)
      .find((li) => (li.textContent ?? "").includes(text));
    if (row === undefined) throw new Error(`「${text}」の行がありません`);
    return row;
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  respondShellUser();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("#134 AC-1（U-8・改訂1 の軽微5 ①）開き直すと最新の一覧から取り直す", () => {
  it("#134 AC-1（U-8）: 部屋 A → B → A と移ると、A は最新の一覧（after なし）から取り直し、外れていた間の編集・削除・新着が出る", async () => {
    const rooms = respondRooms({
      [ROOM_A]: [
        mine(1, ROOM_A, "[E2E_TEST]Aの編集される投稿"),
        mine(2, ROOM_A, "[E2E_TEST]Aの削除される投稿"),
      ],
      [ROOM_B]: [smallMessage(1, ROOM_B, "[E2E_TEST]Bの投稿")],
    });
    respondUnread();
    const { open } = renderTree();
    await rowWith("[E2E_TEST]Aの削除される投稿");

    open(ROOM_B);
    await rowWith("[E2E_TEST]Bの投稿");
    await advance(100);

    // B を見ている間に、A で編集・削除・新着があった（別のタブ・別の利用者の操作）
    const [first, second] = rooms.messages.get(ROOM_A) ?? [];
    if (first === undefined || second === undefined)
      throw new Error("A のメッセージがありません");
    rooms.messages.set(ROOM_A, [
      { ...first, body: "[E2E_TEST]Aの直した投稿", editedAt: EDITED_AT },
      { ...second, body: null, deleted: true },
      mine(3, ROOM_A, "[E2E_TEST]Aの新着"),
    ]);
    const before = rooms.requests.length;

    open(ROOM_A);
    const edited = await rowWith("[E2E_TEST]Aの直した投稿");
    expect(edited.textContent).toContain(EDITED_MARK);
    await rowWith("[E2E_TEST]Aの新着");
    expect(screen.queryByText("[E2E_TEST]Aの削除される投稿")).toBeNull();
    expect(screen.getByRole("log").textContent).toContain(DELETED_TEXT);
    // 開き直した後の A の最初の取得は、最新の一覧（after なし）
    const firstAfterReopen = rooms.requests
      .slice(before)
      .find((r) => r.roomId === ROOM_A);
    expect(firstAfterReopen).toEqual({ roomId: ROOM_A, after: null });
  });

  it("#134 AC-1（改訂1 の軽微5 ①）: A → B → A と移ったとき、A の最新の一覧を表示した後に、A の最新の ID で既読を送る（古い一覧の ID・B の ID で送らない）", async () => {
    const rooms = respondRooms({
      [ROOM_A]: [mine(1, ROOM_A, "[E2E_TEST]Aの最初の投稿")],
      [ROOM_B]: [smallMessage(1, ROOM_B, "[E2E_TEST]Bの投稿")],
    });
    const world = respondUnread();
    const { open } = renderTree();
    await waitFor(() => expect(world.puts).toHaveLength(1));
    expect(world.puts[0]).toEqual({
      roomId: ROOM_A,
      lastReadMessageId: message(1).id,
    });

    open(ROOM_B);
    await waitFor(() => expect(world.puts).toHaveLength(2));
    expect(world.puts[1]).toEqual({
      roomId: ROOM_B,
      lastReadMessageId: smallMessage(1, ROOM_B, "").id,
    });

    // B を見ている間に、A に新着があった
    rooms.messages.get(ROOM_A)?.push(mine(2, ROOM_A, "[E2E_TEST]Aの新着"));

    open(ROOM_A);
    await rowWith("[E2E_TEST]Aの新着");
    await waitFor(() => expect(world.puts.length).toBeGreaterThanOrEqual(3));
    await advance(2500);
    // 開き直した後の既読は、すべて A の最新の ID（古い一覧の ID・B の ID を A に送らない）
    expect(world.puts.slice(2)).toEqual([
      { roomId: ROOM_A, lastReadMessageId: message(2).id },
    ]);
  });
});

describe("#134 AC-1（改訂1 の軽微5 ②）開き直しと投稿の下書き", () => {
  it("#134 AC-1（改訂1 の軽微5 ②）: 投稿の下書きは、部屋 A → B → A と開き直しても復元される", async () => {
    respondRooms({
      [ROOM_A]: [mine(1, ROOM_A, "[E2E_TEST]Aの投稿")],
      [ROOM_B]: [smallMessage(1, ROOM_B, "[E2E_TEST]Bの投稿")],
    });
    respondUnread();
    const { client, user, open } = renderTree();
    await waitFor(() =>
      expect(client.getQueryData(authKeys.session)).toBeDefined(),
    );
    const boxA = await screen.findByRole<HTMLTextAreaElement>("textbox", {
      name: "メッセージ",
    });
    await user.type(boxA, "[[E2E_TEST]Aの下書き");

    open(ROOM_B);
    await rowWith("[E2E_TEST]Bの投稿");
    expect(
      screen.getByRole<HTMLTextAreaElement>("textbox", { name: "メッセージ" })
        .value,
    ).toBe("");

    open(ROOM_A);
    await rowWith("[E2E_TEST]Aの投稿");
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLTextAreaElement>("textbox", {
          name: "メッセージ",
        }).value,
      ).toBe("[E2E_TEST]Aの下書き"),
    );
  });
});
