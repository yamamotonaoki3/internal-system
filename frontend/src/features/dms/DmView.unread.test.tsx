// #237 AC-2（3-1 AC-2）：DM の画面（S-06。DmView）を開くと既読になり、サイドバーの DM の件数が再読み込みなしで消える。API は MSW。データは架空。
// 契約（実装者へ。計画「1. 画面から既読にする時機」）：
//   DmView は当事者なので、詳細の取得が成功したら常に useMarkRoomRead(roomId).markRead を RoomMessages の onLatestMessageIdChange に渡す。
//   新着が表示されたら、新しい最新の ID で次の既読を送る。
//   既読の送信が失敗したら、部屋の近くに role=alert で「既読の状態を更新できませんでした」と次の行動の文を出す。
//   詳細が 404（当事者でない・存在しない）のときは送らない。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dmDetail,
  dmItem,
  dmRoomId,
  partnerName,
  respondDms,
} from "../../test/dm-handlers";
import { message, respondMessages } from "../../test/message-handlers";
import { server } from "../../test/server";
import { respondUnread, type UnreadWorld } from "../../test/unread-handlers";
import { DmSection, DmView } from "./index";

const ROOM = dmRoomId(1);
const FAILURE_TEXT = "既読の状態を更新できませんでした";

function renderTree(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/dms/${ROOM}`]}>{children}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const waitPuts = (world: UnreadWorld, count: number) =>
  waitFor(() => expect(world.puts).toHaveLength(count));

const fromPartner = (n: number) =>
  message(n, {
    roomId: ROOM,
    author: { id: "01JTESTDMUSER0000000000001", displayName: partnerName(1) },
  });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("#237 AC-2（3-1 AC-2）S-06 を開くと既読になる", () => {
  it("#237 AC-2: DM を開くと、表示している最新の ID で既読を1回送り、新着が表示されたら次を送る", async () => {
    respondDms({ items: [dmItem(1)], details: [dmDetail(1)] });
    const messages = respondMessages([fromPartner(1), fromPartner(2)]);
    const world = respondUnread();
    renderTree(<DmView roomId={ROOM} />);
    await waitPuts(world, 1);
    expect(world.puts[0]).toEqual({
      roomId: ROOM,
      lastReadMessageId: fromPartner(2).id,
    });
    messages.messages.push(fromPartner(3));
    await advance(2500);
    await waitPuts(world, 2);
    expect(world.puts[1]).toEqual({
      roomId: ROOM,
      lastReadMessageId: fromPartner(3).id,
    });
  });

  it("#237 AC-2: 既読になると、サイドバーの DM の件数が再読み込みなしで消える", async () => {
    respondDms({ items: [dmItem(1)], details: [dmDetail(1)] });
    respondMessages([fromPartner(1)]);
    const world = respondUnread({ counts: { [ROOM]: 1 } });
    // 既読の応答を止めて、先に件数が出ていることを確かめてから、既読を完了させる
    const release = world.holdPut(ROOM, fromPartner(1).id);
    renderTree(
      <>
        <nav aria-label="テスト用サイドバー">
          <DmSection linkClassName={() => ""} />
        </nav>
        <main>
          <DmView roomId={ROOM} />
        </main>
      </>,
    );
    const nav = await screen.findByRole("navigation", {
      name: "テスト用サイドバー",
    });
    await within(nav).findByRole("link", {
      name: new RegExp(`^${partnerName(1)}\\s+未読 1件$`),
    });
    await waitPuts(world, 1);
    release();
    await waitFor(() =>
      expect(
        within(nav).getByRole("link", { name: partnerName(1) }),
      ).toBeDefined(),
    );
    expect(within(nav).queryByText("1", { exact: true })).toBeNull();
  });

  it("#237 AC-2: 既読の送信が失敗すると、部屋の近くに失敗を出す（もみ消さない）", async () => {
    respondDms({ items: [dmItem(1)], details: [dmDetail(1)] });
    respondMessages([fromPartner(1)]);
    const world = respondUnread();
    world.failNextPut = { status: 500 };
    renderTree(<DmView roomId={ROOM} />);
    const alert = await screen.findByText(new RegExp(FAILURE_TEXT));
    expect(alert.closest("[role='alert']")).not.toBeNull();
  });

  it("#237 AC-2: DM が見つからない（404）ときは、既読を送らない", async () => {
    respondDms({ items: [], details: [] });
    respondMessages([fromPartner(1)]);
    server.use(
      http.get("/api/rooms/:roomId/messages", () =>
        HttpResponse.json({ code: "NOT_FOUND", message: "x" }, { status: 404 }),
      ),
    );
    const world = respondUnread();
    renderTree(<DmView roomId={ROOM} />);
    await screen.findByText(/見つかりません/);
    await advance(2500);
    expect(world.puts).toEqual([]);
  });
});
