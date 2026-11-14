// #238 AC-1〜AC-3（1-1 AC-3 の後半・C-74）: チャンネルのメッセージ一覧（RoomMessages の中の MessageList）で、
// 無効化された投稿者（応答の author.isActive が偽）の表示名に「退職者」を併記し、名前を押せるものにしない。API は MSW。データは架空。
// 契約（実装前の仮置き。引き継ぎに明記）：
//   GET /api/rooms/:roomId/messages の各 items[].author は { id, displayName（投稿時点）, isActive: boolean }。isActive は必須（zod）。
//   MessageList は、isActive が偽、または retiredAuthorIds に含まれる投稿者に「（退職者）」を併記する（文字だけ。ボタン・リンクにしない）。
//   isActive がない応答は、契約違反として取得の失敗（role=alert）にする。0件・成功とは扱わない。取得済みの一覧は残す。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROOM_ID, message, respondMessages } from "../../test/message-handlers";
import { server } from "../../test/server";
import { RoomMessages } from "./index";

const RETIRED = {
  id: "01JTESTUSER000000000000009",
  displayName: "テスト元社員",
  isActive: false,
};
const ACTIVE = {
  id: "01JTESTUSER000000000000002",
  displayName: "テスト花子",
  isActive: true,
};

function renderRoom() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RoomMessages roomId={ROOM_ID} canPost joined />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("#238 AC-1 無効な投稿者に「退職者」を併記する", () => {
  it("#238 AC-1: isActive が偽の行に、投稿時点の表示名と「退職者」を出す（retiredAuthorIds は渡さない）", async () => {
    respondMessages([
      message(1, { author: RETIRED, body: "[E2E_TEST]元社員の投稿" }),
    ]);
    renderRoom();
    const log = await screen.findByRole("log");
    await within(log).findByText("[E2E_TEST]元社員の投稿");
    const items = within(log).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toContain(RETIRED.displayName);
    expect(items[0]?.textContent).toContain("退職者");
  });

  it("#238 AC-1: ポーリング（after）で届いた新しい投稿の投稿者が無効でも、「退職者」を併記する", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const state = respondMessages([message(1, { author: ACTIVE })]);
    renderRoom();
    const log = await screen.findByRole("log");
    await within(log).findByText("[E2E_TEST]本文1");
    state.messages.push(
      message(2, { author: RETIRED, body: "[E2E_TEST]後から届いた投稿" }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    await within(log).findByText("[E2E_TEST]後から届いた投稿");
    expect(state.requests.some((url) => url.searchParams.has("after"))).toBe(
      true,
    );
    const items = within(log).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).not.toContain("退職者");
    expect(items[1]?.textContent).toContain(RETIRED.displayName);
    expect(items[1]?.textContent).toContain("退職者");
  });

  it("#238 AC-1（契約）: author に isActive がない応答は、取得の失敗として扱い、0件とも成功とも出さない", async () => {
    server.use(
      http.get("/api/rooms/:roomId/messages", () =>
        HttpResponse.json({
          items: [
            {
              id: "01JTESTMSG0000000000000001",
              roomId: ROOM_ID,
              author: { id: ACTIVE.id, displayName: ACTIVE.displayName },
              body: "[E2E_TEST]契約違反の応答",
              createdAt: "2026-11-09T00:00:00.000Z",
              // #134：一覧の項目に editedAt・deleted が加わった（isActive の欠けだけを契約違反にする）
              editedAt: null,
              deleted: false,
            },
          ],
          nextCursor: null,
          hasMore: false,
        }),
      ),
    );
    renderRoom();
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.queryByText("まだメッセージはありません")).toBeNull();
    expect(screen.queryByText("[E2E_TEST]契約違反の応答")).toBeNull();
  });

  it("#238 AC-1（契約）: ポーリング（after）の応答で isActive が欠けたら、取得済みの行を残したままエラーを出す", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const state = respondMessages([
      message(1, { author: ACTIVE, body: "[E2E_TEST]取得済みの行" }),
    ]);
    renderRoom();
    const log = await screen.findByRole("log");
    await within(log).findByText("[E2E_TEST]取得済みの行");
    server.use(
      http.get("/api/rooms/:roomId/messages", ({ request }) => {
        state.requests.push(new URL(request.url));
        return HttpResponse.json({
          items: [
            {
              id: "01JTESTMSG0000000000000002",
              roomId: ROOM_ID,
              author: { id: RETIRED.id, displayName: RETIRED.displayName },
              body: "[E2E_TEST]契約違反の新着",
              createdAt: "2026-11-09T00:00:00.000Z",
              // #134：一覧の項目に editedAt・deleted が加わった（isActive の欠けだけを契約違反にする）
              editedAt: null,
              deleted: false,
            },
          ],
          nextCursor: null,
          hasMore: false,
        });
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(
      within(screen.getByRole("log")).getByText("[E2E_TEST]取得済みの行"),
    ).toBeDefined();
    expect(screen.queryByText("[E2E_TEST]契約違反の新着")).toBeNull();
  });
});

describe("#238 AC-2 無効な投稿者の名前から、プロフィールカード・「DMを送る」を出さない", () => {
  it("#238 AC-2（退行防止。今も通る）: 退職者の行に、ボタン・リンクがなく、「DMを送る」もない", async () => {
    respondMessages([
      message(1, { author: RETIRED, body: "[E2E_TEST]元社員の投稿" }),
    ]);
    renderRoom();
    const log = await screen.findByRole("log");
    await within(log).findByText("[E2E_TEST]元社員の投稿");
    expect(within(log).queryAllByRole("button")).toEqual([]);
    expect(within(log).queryAllByRole("link")).toEqual([]);
    expect(log.textContent).not.toMatch(/DM ?を送る/);
    expect(log.querySelector("[popover]")).toBeNull();
  });
});

describe("#238 AC-3 有効な投稿者の表示は変わらない", () => {
  it("#238 AC-3: isActive が真の行は、表示名と時刻だけ（「退職者」なし）。混ざった一覧でも、有効な人の行だけ併記がない", async () => {
    respondMessages([
      message(1, { author: RETIRED, body: "[E2E_TEST]元社員の投稿" }),
      message(2, { author: ACTIVE, body: "[E2E_TEST]在籍者の投稿" }),
    ]);
    renderRoom();
    const log = await screen.findByRole("log");
    await within(log).findByText("[E2E_TEST]在籍者の投稿");
    const items = within(log).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("退職者");
    const activeItem = items[1];
    expect(activeItem?.textContent).toContain(ACTIVE.displayName);
    expect(activeItem?.textContent).not.toContain("退職者");
    expect(activeItem?.querySelector("time")).not.toBeNull();
    expect(within(activeItem as HTMLElement).queryAllByRole("button")).toEqual(
      [],
    );
  });

  it("#238 AC-3: 既定の isActive（真）の投稿者のみの一覧には、「退職者」が一切出ない", async () => {
    respondMessages([message(1), message(2)]);
    renderRoom();
    const log = await screen.findByRole("log");
    await waitFor(() =>
      expect(within(log).getAllByRole("listitem")).toHaveLength(2),
    );
    expect(log.textContent).not.toContain("退職者");
  });
});
