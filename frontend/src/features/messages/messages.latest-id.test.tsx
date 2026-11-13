// #237 AC-2（3-1 AC-2）：RoomMessages に足す任意の prop onLatestMessageIdChange。開いた部屋で表示している最新のメッセージの ID を、既読のために知らせる。
// API は MSW、時間は vi の fake timers。データは架空。
// 契約（実装者へ。計画「5. 画面」）：
//   <RoomMessages ... onLatestMessageIdChange?: (messageId: string) => void />
//   表示している最新の ID（一覧の末尾）が変わったら呼ぶ（初回の表示・2秒ごとの新着・自分の投稿の反映）。同じ ID のままなら呼び直さない。
//   0件のとき・一覧の取得が失敗したとき（404 を含む）は呼ばない。prop を渡さないときは、今までの動きのまま。
//   messages は unread を参照しない（依存の向き：channels・dms → unread → messages）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROOM_ID, message, respondMessages } from "../../test/message-handlers";
import { server } from "../../test/server";
import { RoomMessages } from "./index";

function renderRoom(onLatestMessageIdChange?: (id: string) => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RoomMessages
        roomId={ROOM_ID}
        canPost
        joined
        {...(onLatestMessageIdChange === undefined
          ? {}
          : { onLatestMessageIdChange })}
      />
    </QueryClientProvider>,
  );
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("#237 AC-2 onLatestMessageIdChange", () => {
  it("#237 AC-2: 初回の表示で最新の ID を1回知らせ、新着が表示されたら新しい最新の ID を知らせる。変わらなければ呼び直さない", async () => {
    const state = respondMessages([message(1), message(2)]);
    const onLatest = vi.fn();
    renderRoom(onLatest);
    await within(await screen.findByRole("log")).findByText(message(2).body);
    await waitFor(() => expect(onLatest).toHaveBeenCalledWith(message(2).id));
    expect(onLatest).toHaveBeenCalledTimes(1);
    await advance(2500);
    expect(onLatest).toHaveBeenCalledTimes(1);
    state.messages.push(message(3));
    await advance(2500);
    await waitFor(() =>
      expect(onLatest).toHaveBeenLastCalledWith(message(3).id),
    );
    expect(onLatest).toHaveBeenCalledTimes(2);
  });

  it("#237 AC-2: 0件のときは呼ばない", async () => {
    respondMessages([]);
    const onLatest = vi.fn();
    renderRoom(onLatest);
    await screen.findByRole("log");
    await advance(2500);
    expect(onLatest).not.toHaveBeenCalled();
  });

  it("#237 AC-2: 一覧の取得が失敗したとき（404）は呼ばない", async () => {
    server.use(
      http.get("/api/rooms/:roomId/messages", () =>
        HttpResponse.json({ code: "NOT_FOUND", message: "x" }, { status: 404 }),
      ),
    );
    const onLatest = vi.fn();
    renderRoom(onLatest);
    await screen.findByText("このチャンネルは表示できません");
    expect(onLatest).not.toHaveBeenCalled();
  });

  it("#237 AC-2: prop を渡さなくても、今までどおり一覧を出す（既定の動きを変えない）", async () => {
    respondMessages([message(1)]);
    renderRoom();
    expect(
      await within(await screen.findByRole("log")).findByText(message(1).body),
    ).toBeDefined();
  });
});
