// #155（155-A）の画面のテストで使う、メッセージの検索（GET /api/search/messages。EP-4-01）の架空の応答（MSW）。
// 応答の形は計画 4.4：{ items: [{ messageId, parentMessageId, roomId, roomKind, roomName, author: { id, displayName }, excerpt, createdAt }], nextCursor }。
// world の値を変えると、次の要求から応答が変わる（受けた要求は requests に記録する）。hold を置くと、その Promise が解けるまで応答を保留する。
// データはすべて架空（[E2E_TEST]・testuser_）。
import { http, HttpResponse } from "msw";
import { server } from "./server";

export type SearchItem = {
  messageId: string;
  parentMessageId: string | null;
  roomId: string;
  roomKind: "channel" | "direct" | "case";
  roomName: string;
  author: { id: string; displayName: string };
  excerpt: string;
  createdAt: string;
};

export type SearchRequest = {
  q: string | null;
  roomId: string | null;
  from: string | null;
  to: string | null;
  cursor: string | null;
  limit: string | null;
};

export type SearchWorld = {
  /** cursor（最初のページは null）ごとのページ。無いカーソルは空のページ */
  pages: Map<string | null, { items: SearchItem[]; nextCursor: string | null }>;
  /** 次の n 回を、この状態で失敗させる */
  fail: { status: number; times: number } | null;
  hold: Promise<void> | null;
  requests: SearchRequest[];
};

/** n 番目の結果（ID・日時は n から決まる。本文は呼び出し側で決める） */
export function searchItem(
  n: number,
  overrides: Partial<SearchItem> = {},
): SearchItem {
  const id = `01JTESTSRCH155${String(n).padStart(12, "0")}`;
  return {
    messageId: id,
    parentMessageId: null,
    roomId: "01JTESTROOM155000000000001",
    roomKind: "channel",
    roomName: "[E2E_TEST]検索の部屋",
    author: { id: "01JTESTUSER155000000000002", displayName: "testuser_155_b" },
    excerpt: `[E2E_TEST]検索結果${String(n).padStart(2, "0")}`,
    createdAt: new Date(
      Date.UTC(2026, 10, 20, 0, 0, 0) - n * 60_000,
    ).toISOString(),
    ...overrides,
  };
}

/** 1ページだけの応答（続きなし） */
export function respondSearch(items: SearchItem[]): SearchWorld {
  return respondSearchPages([{ items, nextCursor: null }]);
}

/** 複数ページの応答。i 番目のページは、i-1 番目の nextCursor で取る（最初は cursor なし） */
export function respondSearchPages(
  pages: { items: SearchItem[]; nextCursor: string | null }[],
): SearchWorld {
  const world: SearchWorld = {
    pages: new Map(),
    fail: null,
    hold: null,
    requests: [],
  };
  let cursor: string | null = null;
  for (const page of pages) {
    world.pages.set(cursor, page);
    cursor = page.nextCursor;
  }
  server.use(
    http.get("/api/search/messages", async ({ request }) => {
      const url = new URL(request.url);
      const read = (name: string) => url.searchParams.get(name);
      world.requests.push({
        q: read("q"),
        roomId: read("roomId"),
        from: read("from"),
        to: read("to"),
        cursor: read("cursor"),
        limit: read("limit"),
      });
      const hold = world.hold;
      if (hold !== null) await hold;
      if (world.fail !== null && world.fail.times > 0) {
        world.fail.times -= 1;
        return HttpResponse.json(
          { code: "INTERNAL_ERROR", message: "エラーが発生しました" },
          { status: world.fail.status },
        );
      }
      return HttpResponse.json(
        world.pages.get(read("cursor")) ?? { items: [], nextCursor: null },
      );
    }),
  );
  return world;
}

export function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
