// #201：メッセージ（一覧・投稿）のテストで使う MSW の応答（架空のデータのみ）。サーバーの状態を持つ簡易な模擬。
// 契約（実装前の仮置き）：
//   GET  /api/rooms/:roomId/messages            → { items: 新しい順の最新50件, nextCursor: null, hasMore: false }
//   GET  /api/rooms/:roomId/messages?after=ID   → { items: IDより後を昇順, nextCursor: null, hasMore }
//   POST /api/rooms/:roomId/messages { body }   → 201 { id, roomId, createdAt }
// 名前を use〜 にしない（React Hooks の規則の誤検知を避ける）。
import { http, HttpResponse } from "msw";
import { server } from "./server";

export type TestMessage = {
  id: string;
  roomId: string;
  author: { id: string; displayName: string; isActive: boolean };
  body: string;
  createdAt: string;
};

/** message() の上書き。author の isActive は省略でき、省略したときは true（有効）で補う */
export type MessageOverrides = Omit<Partial<TestMessage>, "author"> & {
  author?: { id: string; displayName: string; isActive?: boolean };
};

export const ROOM_ID = "01JTESTROOM00000000000R001";

/** n 番目のメッセージ。IDは n の昇順で並ぶ（辞書順＝時刻順） */
export function message(
  n: number,
  overrides: MessageOverrides = {},
): TestMessage {
  const author = overrides.author ?? {
    id: "01JTESTUSER000000000000001",
    displayName: "テスト太郎",
  };
  return {
    id: `01JTESTMSG${String(n).padStart(16, "0")}`,
    roomId: ROOM_ID,
    body: `[E2E_TEST]本文${n}`,
    createdAt: "2026-11-09T00:00:00.000Z",
    ...overrides,
    author: { ...author, isActive: author.isActive ?? true },
  };
}

export type MessageServer = {
  /** サーバー側のメッセージ（昇順）。テストが後から足して「別の利用者の投稿」を再現する */
  messages: TestMessage[];
  /** GET の要求の URL */
  requests: URL[];
  /** POST された本文 */
  posts: string[];
};

/**
 * GET・POST を状態付きで返す。afterPageSize を指定すると、after の取得を1回その件数までにして hasMore を真にする。
 */
export function respondMessages(
  initial: TestMessage[],
  options: { afterPageSize?: number } = {},
): MessageServer {
  const state: MessageServer = {
    messages: initial.map((m) => ({ ...m })),
    requests: [],
    posts: [],
  };
  server.use(
    http.get("/api/rooms/:roomId/messages", ({ request }) => {
      const url = new URL(request.url);
      state.requests.push(url);
      const after = url.searchParams.get("after");
      if (after === null) {
        return HttpResponse.json({
          items: state.messages.slice(-50).reverse(),
          nextCursor: null,
          hasMore: false,
        });
      }
      const newer = state.messages.filter((m) => m.id > after);
      const size = options.afterPageSize ?? 100;
      return HttpResponse.json({
        items: newer.slice(0, size),
        nextCursor: null,
        hasMore: newer.length > size,
      });
    }),
    http.post("/api/rooms/:roomId/messages", async ({ request }) => {
      const { body } = (await request.json()) as { body: string };
      state.posts.push(body);
      const created = message(1000 + state.messages.length, { body });
      state.messages.push(created);
      return HttpResponse.json(
        { id: created.id, roomId: ROOM_ID, createdAt: created.createdAt },
        { status: 201 },
      );
    }),
  );
  return state;
}

export const apiErrorResponse = (
  status: number,
  code: string,
  text = "テスト用のエラーです",
  extra: Record<string, unknown> = {},
) => HttpResponse.json({ code, message: text, ...extra }, { status });
