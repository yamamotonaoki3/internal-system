// #201 AC-2・AC-4: メッセージの部品（RoomMessages：一覧と入力欄）を、利用者の操作に基づいて確かめる。API は MSW。データは架空。
// 画面の契約（実装前の仮置き。引き継ぎに明記）：
//   <RoomMessages roomId canPost joined /> を messages/index.ts から公開する。
//   一覧は role="log"。読み込み中は role="status"（「読み込み中」を含む）、0件は「まだメッセージはありません」、失敗は role="alert"。
//   入力欄は、名前「メッセージ」の textbox。送信は名前「送信」のボタン、または Ctrl+Enter（Macは Cmd+Enter）。Enter だけは改行で送らない。
//   空白だけは送らず、入力欄を aria-invalid にする。422 の fields に body があれば、同じく aria-invalid。
//   ポーリングが 404 で止まったら「このチャンネルは表示できません」を出し、入力欄を消す。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ROOM_ID,
  apiErrorResponse,
  message,
  respondMessages,
} from "../../test/message-handlers";
import { server } from "../../test/server";
import { RoomMessages } from "./index";

function renderRoom(props: { canPost?: boolean; joined?: boolean } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RoomMessages
        roomId={ROOM_ID}
        canPost={props.canPost ?? true}
        joined={props.joined ?? true}
      />
    </QueryClientProvider>,
  );
}

const box = () => screen.findByRole("textbox", { name: "メッセージ" });
const sendButton = () => screen.getByRole("button", { name: "送信" });

afterEach(() => {
  vi.useRealTimers();
});

describe("#201 AC-4 一覧の4つの状態", () => {
  it("#201 AC-4: 読み込み中は role=status で「読み込み中」を出す", async () => {
    server.use(
      http.get("/api/rooms/:roomId/messages", () => new Promise(() => {})),
    );
    renderRoom();
    expect((await screen.findByRole("status")).textContent).toContain(
      "読み込み中",
    );
  });

  it("#201 AC-4: 0件は「まだメッセージはありません」", async () => {
    respondMessages([]);
    renderRoom();
    expect(await screen.findByText("まだメッセージはありません")).toBeTruthy();
  });

  it("#201 AC-4: ありのときは role=log に、投稿者の表示名と本文を古い順に出す。本文の <script> は文字として出す", async () => {
    respondMessages([
      message(1, { body: "[E2E_TEST]最初" }),
      message(2, {
        author: { id: "01JTESTUSER000000000000002", displayName: "テスト花子" },
        body: "<script>alert(1)</script>",
      }),
    ]);
    const { container } = renderRoom();
    const log = await screen.findByRole("log");
    await within(log).findByText("[E2E_TEST]最初");
    expect(within(log).getByText("テスト花子")).toBeTruthy();
    expect(within(log).getByText("<script>alert(1)</script>")).toBeTruthy();
    expect(container.querySelector("script")).toBeNull();
    const text = log.textContent ?? "";
    expect(text.indexOf("[E2E_TEST]最初")).toBeLessThan(
      text.indexOf("<script>alert(1)</script>"),
    );
  });

  it("#201 AC-4: 取得に失敗したら、0件とは出さず role=alert を出す", async () => {
    server.use(
      http.get("/api/rooms/:roomId/messages", () =>
        apiErrorResponse(500, "INTERNAL", "一時的なエラーです"),
      ),
    );
    renderRoom();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "一時的なエラーです",
    );
    expect(screen.queryByText("まだメッセージはありません")).toBeNull();
  });

  it("#201 AC-4: 初回の取得が404なら「このチャンネルは表示できません」を出し、入力欄を出さない", async () => {
    server.use(
      http.get("/api/rooms/:roomId/messages", () =>
        apiErrorResponse(404, "NOT_FOUND"),
      ),
    );
    renderRoom();
    expect(
      await screen.findByText("このチャンネルは表示できません"),
    ).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "メッセージ" })).toBeNull();
  });

  it("#201 AC-4: ポーリングが404で止まったら「このチャンネルは表示できません」を出し、入力欄を消す", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    respondMessages([message(1)]);
    renderRoom();
    await box();
    server.use(
      http.get("/api/rooms/:roomId/messages", () =>
        apiErrorResponse(404, "NOT_FOUND"),
      ),
    );
    await vi.advanceTimersByTimeAsync(2500);
    expect(
      await screen.findByText("このチャンネルは表示できません"),
    ).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "メッセージ" })).toBeNull();
  });
});

describe("#201 AC-2・AC-4 入力と送信", () => {
  it("#201 AC-4: 書いて「送信」を押すと本文をPOSTし、入力欄が空になり、再読み込みなしで一覧に出る", async () => {
    const state = respondMessages([]);
    renderRoom();
    const input = await box();
    fireEvent.change(input, { target: { value: "[E2E_TEST]こんにちは" } });
    fireEvent.click(sendButton());
    await waitFor(() => expect(state.posts).toEqual(["[E2E_TEST]こんにちは"]));
    const log = await screen.findByRole("log");
    expect(await within(log).findByText("[E2E_TEST]こんにちは")).toBeTruthy();
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(""));
  });

  it.each([
    ["Ctrl+Enter", { ctrlKey: true }],
    ["Cmd+Enter（Mac）", { metaKey: true }],
  ])("#201 AC-4（確定した判断）: %s で送信できる", async (_label, modifier) => {
    const state = respondMessages([]);
    renderRoom();
    const input = await box();
    fireEvent.change(input, { target: { value: "[E2E_TEST]ショートカット" } });
    fireEvent.keyDown(input, { key: "Enter", ...modifier });
    await waitFor(() =>
      expect(state.posts).toEqual(["[E2E_TEST]ショートカット"]),
    );
  });

  it("#201 AC-4（確定した判断）: Enter だけでは送信しない（改行）", async () => {
    const state = respondMessages([]);
    renderRoom();
    const input = await box();
    fireEvent.change(input, { target: { value: "[E2E_TEST]改行" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(state.posts).toEqual([]);
    expect((input as HTMLTextAreaElement).value).toBe("[E2E_TEST]改行");
  });

  it.each([[""], [" \n  "]])(
    "#201 AC-2: 空白だけ(%j)の本文は送らず、入力欄にエラーを出す",
    async (value) => {
      const state = respondMessages([]);
      renderRoom();
      const input = await box();
      fireEvent.change(input, { target: { value } });
      fireEvent.click(sendButton());
      await waitFor(() =>
        expect(input.getAttribute("aria-invalid")).toBe("true"),
      );
      expect(state.posts).toEqual([]);
    },
  );

  it("#201 AC-2: サーバーが422（fields に body）を返したら、入力欄にエラーを出し、入力は消さない", async () => {
    respondMessages([]);
    server.use(
      http.post("/api/rooms/:roomId/messages", () =>
        apiErrorResponse(
          422,
          "VALIDATION_ERROR",
          "入力内容を確かめてください",
          {
            fields: ["body"],
          },
        ),
      ),
    );
    renderRoom();
    const input = await box();
    fireEvent.change(input, { target: { value: "[E2E_TEST]本文" } });
    fireEvent.click(sendButton());
    await waitFor(() =>
      expect(input.getAttribute("aria-invalid")).toBe("true"),
    );
    expect((input as HTMLTextAreaElement).value).toBe("[E2E_TEST]本文");
  });

  it("#201 AC-4: 送信中は「送信」を押せず、続けて押しても二重に送らない", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const posts: string[] = [];
    respondMessages([]);
    server.use(
      http.post("/api/rooms/:roomId/messages", async ({ request }) => {
        posts.push(((await request.json()) as { body: string }).body);
        await gate;
        return HttpResponse.json(
          {
            id: message(9).id,
            roomId: ROOM_ID,
            createdAt: message(9).createdAt,
          },
          { status: 201 },
        );
      }),
    );
    renderRoom();
    const input = await box();
    fireEvent.change(input, { target: { value: "[E2E_TEST]一度だけ" } });
    fireEvent.click(sendButton());
    await waitFor(() =>
      expect((sendButton() as HTMLButtonElement).disabled).toBe(true),
    );
    fireEvent.click(sendButton());
    release?.();
    await waitFor(() =>
      expect((sendButton() as HTMLButtonElement).disabled).toBe(false),
    );
    expect(posts).toEqual(["[E2E_TEST]一度だけ"]);
  });
});
