// #136 AC-1（1-2 AC-6）・AC-3（C-168(2)(6)）: RoomMessages（と中の MessageList）に足す任意の props。DM（S-06）から使う。API は MSW。データは架空。
// 契約（実装前の仮置き。引き継ぎに明記）：
//   <RoomMessages roomId canPost joined
//      notFoundText?      … 一覧の取得が 404 のときの文（既定は「このチャンネルは表示できません」）
//      emptyText?         … 0件のときの文（既定は「まだメッセージはありません」）
//      cannotPostText?    … 参加中で canPost が偽のときの案内（既定はお知らせ専用の案内）
//      retiredAuthorIds?  … readonly string[]。この利用者IDの投稿者の表示名に「退職者」を併記する（既定は空。チャンネルでは併記しない）
//      onPosted?          … () => void。投稿が成功したあと（入力欄を空にしたあと）に1回呼ぶ。onPosted の例外は、送信の失敗として表示せず
//                           （onPostError を呼ばない）、その場で受け止めずに外へ伝える（利用者の決定。console は使わない）。
//                           前提とする呼び出し方：onSubmit（async）の中で、mutateAsync の成功と reset() のあとに onPosted?.() を try/catch で囲まずに呼ぶ。
//                           例外は react-hook-form の handleSubmit が投げ直し、送信の Promise の処理されなかった失敗として外へ伝わる
//      onPostError?       … (error: unknown) => void。投稿が失敗したときに、ApiError のまま呼ぶ
//   />
//   既定値（props を渡さない）では、今のチャンネルの動き（文言・併記なし）のまま変えない。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  ROOM_ID,
  apiErrorResponse,
  message,
  respondMessages,
} from "../../test/message-handlers";
import { server } from "../../test/server";
import { RoomMessages } from "./index";

const RETIRED = {
  id: "01JTESTUSER000000000000009",
  displayName: "テスト元社員",
};
const ACTIVE = { id: "01JTESTUSER000000000000002", displayName: "テスト花子" };

function renderRoom(props: Partial<ComponentProps<typeof RoomMessages>> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RoomMessages roomId={ROOM_ID} canPost joined {...props} />
    </QueryClientProvider>,
  );
}

/**
 * 処理されなかった Promise の失敗（unhandledRejection）を、このテストの間だけ捕まえる。
 * 例外が外へ伝わることを確かめるため。vitest の既定の受け手を一時的に外し、restore() で必ず元に戻す（全体の実行を失敗させない）。
 */
function captureUnhandledRejections(): {
  reasons: unknown[];
  restore: () => void;
} {
  const reasons: unknown[] = [];
  const saved = process.listeners("unhandledRejection");
  const listener = (reason: unknown) => {
    reasons.push(reason);
  };
  process.removeAllListeners("unhandledRejection");
  process.on("unhandledRejection", listener);
  return {
    reasons,
    restore: () => {
      process.off("unhandledRejection", listener);
      for (const original of saved) process.on("unhandledRejection", original);
    },
  };
}

describe("#136 AC-3（C-168(6)）既定値ではチャンネルの動きのまま", () => {
  it("#136 AC-3（C-168(6)）: props を渡さなければ、0件は「まだメッセージはありません」、投稿者に「退職者」を併記しない", async () => {
    respondMessages([]);
    renderRoom();
    expect(await screen.findByText("まだメッセージはありません")).toBeDefined();
    expect(document.body.textContent).not.toContain("退職者");
  });

  it("#136 AC-3（C-168(6)）: props を渡さなければ、404 は「このチャンネルは表示できません」", async () => {
    server.use(
      http.get("/api/rooms/:roomId/messages", () =>
        apiErrorResponse(404, "NOT_FOUND"),
      ),
    );
    renderRoom();
    expect(
      await screen.findByText("このチャンネルは表示できません"),
    ).toBeDefined();
  });

  it("#136 AC-3（C-168(6)）: props を渡さなければ、canPost が偽の案内はお知らせ専用のまま", async () => {
    respondMessages([message(1)]);
    renderRoom({ canPost: false });
    expect(await screen.findByText(/オーナーと全体管理者/)).toBeDefined();
  });

  it("#136 AC-3（C-168(6)）: props を渡さなければ、どの投稿者にも「退職者」を併記しない（チャンネルは #133 で扱う）", async () => {
    respondMessages([
      message(1, { author: RETIRED, body: "[E2E_TEST]元社員の投稿" }),
    ]);
    renderRoom();
    const log = await screen.findByRole("log");
    await within(log).findByText("[E2E_TEST]元社員の投稿");
    expect(log.textContent).not.toContain("退職者");
  });
});

describe("#136 AC-1（1-2 AC-6）・AC-3（C-168(6)）retiredAuthorIds", () => {
  it("#136 AC-1（1-2 AC-6）: 指定した投稿者の表示名（投稿時点）に「退職者」を併記し、ほかの投稿者には併記しない", async () => {
    respondMessages([
      message(1, { author: RETIRED, body: "[E2E_TEST]元社員の投稿" }),
      message(2, { author: ACTIVE, body: "[E2E_TEST]在籍者の投稿" }),
    ]);
    renderRoom({ retiredAuthorIds: [RETIRED.id] });
    const log = await screen.findByRole("log");
    await within(log).findByText("[E2E_TEST]在籍者の投稿");
    const items = within(log).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    // 1件目（指定した投稿者）：投稿時点の表示名と「退職者」。2件目（ほかの投稿者）：表示名だけ
    expect(items[0]?.textContent).toContain(RETIRED.displayName);
    expect(items[0]?.textContent).toContain("退職者");
    expect(items[1]?.textContent).toContain(ACTIVE.displayName);
    expect(items[1]?.textContent).not.toContain("退職者");
  });
});

describe("#136 AC-1（1-2 AC-3）・AC-3（C-168(2)）文言の差し替えと投稿の通知", () => {
  it("#136 AC-1（1-2 AC-3）: emptyText を渡すと、0件のときにその文を出す（既定の文は出さない）", async () => {
    respondMessages([]);
    renderRoom({ emptyText: "テストの最初の案内です" });
    expect(await screen.findByText("テストの最初の案内です")).toBeDefined();
    expect(screen.queryByText("まだメッセージはありません")).toBeNull();
  });

  it("#136 AC-1（1-2 AC-2）: notFoundText を渡すと、404 のときにその文を出し、入力欄を出さない", async () => {
    server.use(
      http.get("/api/rooms/:roomId/messages", () =>
        apiErrorResponse(404, "NOT_FOUND"),
      ),
    );
    renderRoom({ notFoundText: "テストのDMは見つかりません" });
    expect(await screen.findByText("テストのDMは見つかりません")).toBeDefined();
    expect(screen.queryByText("このチャンネルは表示できません")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "メッセージ" })).toBeNull();
  });

  it("#136 AC-1（1-2 AC-6）: cannotPostText を渡すと、canPost が偽のときにその文を出し、入力欄を出さない", async () => {
    respondMessages([message(1)]);
    renderRoom({ canPost: false, cannotPostText: "テストの送信できない案内" });
    expect(await screen.findByText("テストの送信できない案内")).toBeDefined();
    expect(screen.queryByText(/オーナーと全体管理者/)).toBeNull();
    expect(screen.queryByRole("textbox", { name: "メッセージ" })).toBeNull();
  });

  it("#136 即時反映: 投稿が成功したら onPosted を1回呼ぶ。onPostError は呼ばない", async () => {
    const state = respondMessages([]);
    const onPosted = vi.fn();
    const onPostError = vi.fn();
    renderRoom({ onPosted, onPostError });
    const input = await screen.findByRole("textbox", { name: "メッセージ" });
    fireEvent.change(input, { target: { value: "[E2E_TEST]成功" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(state.posts).toEqual(["[E2E_TEST]成功"]));
    await waitFor(() => expect(onPosted).toHaveBeenCalledTimes(1));
    expect(onPostError).not.toHaveBeenCalled();
  });

  it.each([
    ["「送信」ボタン", "button"],
    ["Ctrl+Enter", "shortcut"],
  ] as const)(
    "#136 即時反映（コードレビュー1回目の指摘・利用者の決定）: %s で送って onPosted が例外を投げても、送信の失敗として表示せず（onPostError なし・alert なし・入力欄は空）、例外はもみ消さずに外へ伝える",
    async (_label, how) => {
      const state = respondMessages([]);
      const failure = new Error("テストの onPosted の例外");
      const onPosted = vi.fn(() => {
        throw failure;
      });
      const onPostError = vi.fn();
      const rejections = captureUnhandledRejections();
      try {
        renderRoom({ onPosted, onPostError });
        const input = await screen.findByRole("textbox", {
          name: "メッセージ",
        });
        fireEvent.change(input, { target: { value: "[E2E_TEST]投稿は成功" } });
        if (how === "button")
          fireEvent.click(screen.getByRole("button", { name: "送信" }));
        else fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
        await waitFor(() =>
          expect(state.posts).toEqual(["[E2E_TEST]投稿は成功"]),
        );
        await waitFor(() => expect(onPosted).toHaveBeenCalledTimes(1));
        // 例外は受け止められず、外へ（処理されなかった Promise の失敗として）伝わる
        await waitFor(() => expect(rejections.reasons).toContain(failure));
        // 投稿そのものは成功として扱う
        const log = await screen.findByRole("log");
        expect(
          await within(log).findByText("[E2E_TEST]投稿は成功"),
        ).toBeDefined();
        await waitFor(() =>
          expect((input as HTMLTextAreaElement).value).toBe(""),
        );
        expect(onPostError).not.toHaveBeenCalled();
        expect(screen.queryByRole("alert")).toBeNull();
        expect(input.getAttribute("aria-invalid")).not.toBe("true");
        // 届いたのはこの例外だけ（ほかの失敗が紛れていない）
        expect(rejections.reasons).toEqual([failure]);
      } finally {
        rejections.restore();
      }
    },
  );

  it("#136 AC-3（C-168(2)）: 投稿が 409 なら onPostError を ApiError（status 409）で呼び、onPosted は呼ばない。入力は消さない", async () => {
    respondMessages([]);
    server.use(
      http.post("/api/rooms/:roomId/messages", () =>
        HttpResponse.json(
          { code: "CONFLICT", message: "送信できませんでした" },
          { status: 409 },
        ),
      ),
    );
    const onPosted = vi.fn();
    const onPostError = vi.fn();
    renderRoom({ onPosted, onPostError });
    const input = await screen.findByRole("textbox", { name: "メッセージ" });
    fireEvent.change(input, { target: { value: "[E2E_TEST]届かない" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(onPostError).toHaveBeenCalledTimes(1));
    expect(onPostError.mock.calls[0]?.[0]).toMatchObject({
      status: 409,
      code: "CONFLICT",
    });
    expect(onPosted).not.toHaveBeenCalled();
    expect((input as HTMLTextAreaElement).value).toBe("[E2E_TEST]届かない");
  });

  it("#136 AC-3（C-168(2)）: onPostError を渡さなくても、409 は今までどおりエラーとして知らせる（もみ消さない）", async () => {
    respondMessages([]);
    server.use(
      http.post("/api/rooms/:roomId/messages", () =>
        HttpResponse.json(
          { code: "CONFLICT", message: "送信できませんでした" },
          { status: 409 },
        ),
      ),
    );
    renderRoom();
    const input = await screen.findByRole("textbox", { name: "メッセージ" });
    fireEvent.change(input, { target: { value: "[E2E_TEST]届かない" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "送信できませんでした",
    );
  });
});
