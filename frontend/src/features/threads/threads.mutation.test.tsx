// #137 AC-1・AC-4（1-4 AC-1・AC-3・AC-4）: スレッドの画面側の境界（ミューテーションで生き残った分岐）。
// S-07 の見出し（tabIndex=-1）と、StrictMode（main.tsx の本番の描画と同じ）で開いて閉じたときのフォーカスの戻り先、
// 返信・既読の後に取り直すキャッシュの範囲（スレッド一覧だけ。部屋の未読は返信を数えないので取り直さない。C-172 U-2）、スレッド一覧のキーの値。
// 方針：期待するキーの値は本番の定義から作らず、ここで独立に書く。API は MSW、データは架空。
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  OTHER_AUTHOR,
  message,
  reply,
  respondMessages,
  respondReplies,
} from "../../test/message-handlers";
import { respondThreadReadOnly } from "../../test/thread-handlers";
import {
  newClient,
  renderInApp,
  renderPane,
  respondSelf,
} from "../../test/thread-harness";
import { RoomMessages } from "../messages";
import { threadKeys } from "./api/query-keys";
import { useMarkThreadRead } from "./hooks/useMarkThreadRead";
import { ThreadPane, useThreadParam } from "./index";

// 期待するキー（本番の定義から作らない）
const THREADS_ALL = ["threads"];
const THREADS_LIST = ["threads", "list"];
const UNREAD_COUNTS = ["unread", "counts"];

const PARENT = message(1, {
  body: "[E2E_TEST]返信が1件ある親",
  author: OTHER_AUTHOR,
  replyCount: 1,
});
const ROOM = PARENT.roomId;
const FIRST_REPLY = reply(PARENT, 1, { author: OTHER_AUTHOR });

const pane = () => screen.getByRole("region", { name: "スレッド" });

/** スレッド一覧と部屋の未読のキャッシュを置き、取り直しの対象になったか（isInvalidated）を見られるようにする */
function seedCaches(client: ReturnType<typeof newClient>) {
  client.setQueryData(THREADS_LIST, { pages: [], pageParams: [] });
  client.setQueryData(UNREAD_COUNTS, { channels: [], directs: [] });
  return {
    threadsInvalidated: () =>
      client.getQueryState(THREADS_LIST)?.isInvalidated ?? false,
    unreadInvalidated: () =>
      client.getQueryState(UNREAD_COUNTS)?.isInvalidated ?? false,
  };
}

beforeEach(() => {
  respondSelf();
});

describe("#137 AC-1（1-4 AC-3）S-07 の見出しとフォーカス", () => {
  it("#137 AC-1（1-4 AC-3）: 見出し「スレッド」は tabIndex=-1（Tab の順には入らず、プログラムからだけフォーカスできる）", async () => {
    respondThreadReadOnly();
    respondReplies({ parent: PARENT, replies: [FIRST_REPLY] });
    renderPane(PARENT.id);
    const heading = within(pane()).getByRole("heading", { name: "スレッド" });
    expect(heading.getAttribute("tabindex")).toBe("-1");
    await within(pane()).findByRole("log", { name: "返信一覧" });
  });

  it("#137 AC-1（1-4 AC-3）: StrictMode（本番の描画と同じ）でも、閉じるとフォーカスは開いた「返信 n 件」のボタンへ戻る（見出しへは戻さない）", async () => {
    respondThreadReadOnly();
    respondMessages([PARENT]);
    respondReplies({ parent: PARENT, replies: [FIRST_REPLY] });
    function RoomWithThread() {
      const thread = useThreadParam();
      return (
        <>
          <RoomMessages
            roomId={ROOM}
            canPost
            joined
            canModifyOwn
            onOpenThread={thread.open}
          />
          {thread.parentMessageId !== null && (
            <ThreadPane parentMessageId={thread.parentMessageId} />
          )}
        </>
      );
    }
    const { user } = renderInApp(
      <StrictMode>
        <RoomWithThread />
      </StrictMode>,
      { path: "/channels/room" },
    );
    const opener = await screen.findByRole("button", { name: /^返信 1 件/ });
    await user.click(opener);
    await within(pane()).findByRole("log", { name: "返信一覧" });
    expect(document.activeElement).toBe(
      within(pane()).getByRole("heading", { name: "スレッド" }),
    );
    await user.click(
      within(pane()).getByRole("button", { name: "スレッドを閉じる" }),
    );
    expect(screen.queryByRole("region", { name: "スレッド" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

describe("#137 AC-1（1-4 AC-3・AC-4）返信の後に取り直す範囲", () => {
  it("#137 AC-1（1-4 AC-3）: 自分の返信が成功したら、スレッド一覧のキャッシュを取り直しの対象にし、部屋の未読は対象にしない（C-172 U-2）", async () => {
    // 既読の送信は失敗させる（既読の成功による取り直しと区別し、返信の後の取り直しだけを見る）
    respondThreadReadOnly({ failStatus: 500 });
    const state = respondReplies({ parent: PARENT, replies: [FIRST_REPLY] });
    const client = newClient();
    const caches = seedCaches(client);
    const { user } = renderPane(PARENT.id, { client });
    await within(pane()).findByRole("log", { name: "返信一覧" });
    expect(caches.threadsInvalidated()).toBe(false);
    await user.type(
      within(pane()).getByRole("textbox", { name: "返信" }),
      "[[E2E_TEST]取り直しの確認",
    );
    await user.click(within(pane()).getByRole("button", { name: "送信" }));
    await waitFor(() => expect(state.posts).toHaveLength(1));
    await waitFor(() => expect(caches.threadsInvalidated()).toBe(true));
    expect(caches.unreadInvalidated()).toBe(false);
  });
});

describe("#137 AC-4（1-4 AC-4）useMarkThreadRead：既読を送った後に取り直す範囲", () => {
  function setup(parentMessageId: string) {
    const client = newClient();
    const caches = seedCaches(client);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(() => useMarkThreadRead(parentMessageId), {
      wrapper,
    });
    return { ...hook, caches };
  }

  it("#137 AC-4: 既読の送信が成功したら、スレッド一覧のキャッシュを取り直しの対象にする（未読の印が再読み込みなしで消える）", async () => {
    const puts = respondThreadReadOnly();
    const { result, caches } = setup(PARENT.id);
    expect(caches.threadsInvalidated()).toBe(false);
    result.current.markRead(FIRST_REPLY.id);
    await waitFor(() =>
      expect(puts).toEqual([
        { parentMessageId: PARENT.id, lastReadMessageId: FIRST_REPLY.id },
      ]),
    );
    await waitFor(() => expect(caches.threadsInvalidated()).toBe(true));
  });

  it("#137 AC-4（C-172 U-2）: 既読の送信が成功しても、部屋の未読（サイドバー・DM 一覧の件数）は取り直さない（返信を数えないため）", async () => {
    const puts = respondThreadReadOnly();
    const { result, caches } = setup(PARENT.id);
    result.current.markRead(FIRST_REPLY.id);
    await waitFor(() => expect(puts).toHaveLength(1));
    await waitFor(() => expect(caches.threadsInvalidated()).toBe(true));
    expect(caches.unreadInvalidated()).toBe(false);
  });

  it("#137 AC-4: 既読の送信が失敗したら、スレッド一覧を取り直さず、失敗を返す（もみ消さない）", async () => {
    respondThreadReadOnly({ failStatus: 500 });
    const { result, caches } = setup(PARENT.id);
    result.current.markRead(FIRST_REPLY.id);
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(caches.threadsInvalidated()).toBe(false);
  });
});

describe("#137 AC-1（1-4 AC-4）スレッド一覧のキー", () => {
  it('#137 AC-1: スレッド全体のキーは ["threads"]、一覧のキーは ["threads", "list"]（全体のキーで一覧も取り直せる）', () => {
    expect(threadKeys.all).toEqual(THREADS_ALL);
    expect(threadKeys.list).toEqual(THREADS_LIST);
  });
});
