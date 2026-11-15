// #139 1-8 AC-1〜AC-3・3-2 AC-1〜AC-3・1-5 AC-7: 指名候補、送信、表示。
// API は MSW。期待する ID と UTF-16 半開区間は本文から独立した固定値で確かめる。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { ROOM_ID, message, respondMessages } from "../../test/message-handlers";
import { server } from "../../test/server";
import { authKeys } from "../auth";
import { RoomMessages } from "./index";

const ME = "01JTESTACCT000000000000001";
const A = "01JTESTACCT000000000000002";
const B = "01JTESTACCT000000000000003";
const candidates = [
  { id: A, displayName: "testuser_same", departmentName: "テスト営業部" },
  { id: B, displayName: "testuser_same", departmentName: "テスト開発部" },
];

function renderRoom(initial = [] as ReturnType<typeof message>[]) {
  respondMessages(initial);
  server.use(
    http.get("/api/rooms/:roomId/mention-candidates", () =>
      HttpResponse.json({ items: candidates, nextCursor: null }),
    ),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(authKeys.session, {
    user: { id: ME, displayName: "testuser_001", loginId: "testuser_001" },
    permissions: [],
    mustChangePassword: false,
    reauthenticatedAt: null,
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RoomMessages roomId={ROOM_ID} canPost joined canModifyOwn />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return user;
}

const box = () =>
  screen.getByRole<HTMLTextAreaElement>("textbox", { name: "メッセージ" });

describe("#139 1-8 AC-1〜AC-3 指名候補", () => {
  it("#139 1-8 AC-1・AC-2: 同名の社員を部署名で見分け、選んだ userId を UTF-16 の範囲と送る", async () => {
    const posts: unknown[] = [];
    const user = renderRoom();
    server.use(
      http.post("/api/rooms/:roomId/messages", async ({ request }) => {
        posts.push(await request.json());
        return HttpResponse.json(
          {
            id: message(5).id,
            roomId: ROOM_ID,
            createdAt: message(5).createdAt,
          },
          { status: 201 },
        );
      }),
    );
    await user.type(box(), "😀 @testuser");
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]?.textContent).toContain("testuser_same");
    expect(options[0]?.textContent).toContain("テスト営業部");
    expect(options[1]?.textContent).toContain("testuser_same");
    expect(options[1]?.textContent).toContain("テスト開発部");
    await user.click(options[1]!);
    await user.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      body: "😀 @testuser_same",
      mentions: [{ userId: B, start: 3, end: 17 }],
    });
  });

  it("#139 1-8 AC-1・AC-3: 候補を選ばない普通の @ は指名にならず、候補に全員宛を出さない", async () => {
    const posts: unknown[] = [];
    const user = renderRoom();
    server.use(
      http.post("/api/rooms/:roomId/messages", async ({ request }) => {
        posts.push(await request.json());
        return HttpResponse.json(
          {
            id: message(5).id,
            roomId: ROOM_ID,
            createdAt: message(5).createdAt,
          },
          { status: 201 },
        );
      }),
    );
    await user.type(box(), "[[E2E_TEST] @all @testuser_002");
    expect(screen.queryByRole("option", { name: /全員|@all/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      body: "[E2E_TEST] @all @testuser_002",
      mentions: [],
    });
  });

  it("#139 1-8 AC-1: キーボードで候補を選べるが、IME 変換中の Enter は確定に使わない", async () => {
    const user = renderRoom();
    await user.type(box(), "@testuser");
    expect(await screen.findAllByRole("option")).toHaveLength(2);
    fireEvent.keyDown(box(), { key: "Enter", isComposing: true });
    expect(box().value).toBe("@testuser");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(box().value).toBe("@testuser_same");
  });
});

describe("#139 3-2 AC-1〜AC-3 編集と表示", () => {
  it("#139 3-2 AC-1・1-5 AC-7: 保存済みの指名だけ強調し、クリックできない", async () => {
    const item = {
      ...message(1, {
        body: "[E2E_TEST] @testuser_same と @testuser_same",
        author: { id: ME, displayName: "testuser_001" },
      }),
      mentions: [{ userId: A, start: 11, end: 25 }],
    };
    renderRoom([item]);
    const log = await screen.findByRole("log");
    await within(log).findByText(/@testuser_same/);
    await waitFor(() =>
      expect(log.querySelectorAll(".mention")).toHaveLength(1),
    );
    const highlighted = log.querySelectorAll(".mention");
    expect(highlighted[0]?.textContent).toBe("@testuser_same");
    expect(highlighted[0]?.closest("a, button")).toBeNull();
  });

  it("#139 3-2 AC-2・AC-3: 編集で指名を外して保存すると、その userId を送らない", async () => {
    const item = {
      ...message(1, {
        body: "[E2E_TEST] @testuser_same",
        author: { id: ME, displayName: "testuser_001" },
      }),
      mentions: [{ userId: A, start: 11, end: 25 }],
    };
    const edits: unknown[] = [];
    const user = renderRoom([item]);
    server.use(
      http.patch("/api/messages/:messageId", async ({ request }) => {
        edits.push(await request.json());
        return HttpResponse.json({
          id: item.id,
          body: "[E2E_TEST] 確認",
          editedAt: "2026-11-15T00:00:00.000Z",
          mentions: [],
        });
      }),
    );
    const log = await screen.findByRole("log");
    await within(log).findByText(/@testuser_same/);
    await user.click(within(log).getByRole("button", { name: "編集" }));
    const editor = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "メッセージの編集",
    });
    await user.clear(editor);
    await user.type(editor, "[[E2E_TEST] 確認");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(edits).toHaveLength(1));
    expect(edits[0]).toEqual({ body: "[E2E_TEST] 確認", mentions: [] });
  });
});

const DRAFT_KEY = `internal-system:draft:v1:${ME}:room:${ROOM_ID}`;
afterEach(() => window.localStorage.removeItem(DRAFT_KEY));

describe("#139 1-8 AC-2 指名付き下書きの編集", () => {
  it("#139 1-8 AC-2: 復元した指名の前へ文字を入れるとUTF-16範囲を更新して送る", async () => {
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        body: "[E2E_TEST] @testuser_same",
        updatedAt: Date.now(),
        mentions: [{ userId: A, start: 11, end: 25 }],
      }),
    );
    const posts: unknown[] = [];
    const user = renderRoom();
    server.use(
      http.post("/api/rooms/:roomId/messages", async ({ request }) => {
        posts.push(await request.json());
        return HttpResponse.json(
          {
            id: message(5).id,
            roomId: ROOM_ID,
            createdAt: message(5).createdAt,
          },
          { status: 201 },
        );
      }),
    );
    expect(box().value).toBe("[E2E_TEST] @testuser_same");
    box().focus();
    box().setSelectionRange(0, 0);
    await user.keyboard("X");
    expect(box().value).toBe("X[E2E_TEST] @testuser_same");
    await user.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      body: "X[E2E_TEST] @testuser_same",
      mentions: [{ userId: A, start: 12, end: 26 }],
    });
  });
});
