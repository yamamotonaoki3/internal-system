// #201：メッセージ（一覧・投稿）のテストで使う MSW の応答（架空のデータのみ）。サーバーの状態を持つ簡易な模擬。
// 契約（実装前の仮置き）：
//   GET  /api/rooms/:roomId/messages            → { items: 新しい順の最新50件, nextCursor: null, hasMore: false }
//   GET  /api/rooms/:roomId/messages?after=ID   → { items: IDより後を昇順, nextCursor: null, hasMore }
//   POST /api/rooms/:roomId/messages { body }   → 201 { id, roomId, createdAt }
// #134 で足した契約（実装前の仮置き。計画 plan-134・改訂1）：
//   一覧の items[] に editedAt（string|null）・deleted（真偽）。削除済みは body: null・editedAt: null（投稿者と日時は残す）
//   PATCH  /api/messages/:messageId { body } → 200 { id, body, editedAt }
//   DELETE /api/messages/:messageId           → 204
// 名前を use〜 にしない（React Hooks の規則の誤検知を避ける）。
import { http, HttpResponse } from "msw";
import { server } from "./server";

export type TestMessage = {
  id: string;
  roomId: string;
  author: { id: string; displayName: string; isActive: boolean };
  /** 削除済みは null（#134） */
  body: string | null;
  createdAt: string;
  /** 編集した日時。編集していない・削除済みは null（#134） */
  editedAt: string | null;
  /** 削除済みか（#134） */
  deleted: boolean;
};

/** message() の上書き。author の isActive は省略でき、省略したときは true（有効）で補う */
export type MessageOverrides = Omit<Partial<TestMessage>, "author"> & {
  author?: { id: string; displayName: string; isActive?: boolean };
};

export const ROOM_ID = "01JTESTROOM00000000000R001";

/** #134：編集が成功したときに模擬のサーバーが返す editedAt */
export const EDITED_AT = "2026-11-14T00:00:00.000Z";

/** n 番目のメッセージ。IDは n の昇順で並ぶ（辞書順＝時刻順） */
/** 削除済みにしない上書き（#134：body を文字列のまま扱える。既存のテストの型を変えないため） */
export type LiveMessageOverrides = MessageOverrides & {
  body?: string;
  deleted?: false;
};
export function message(
  n: number,
  overrides?: LiveMessageOverrides,
): TestMessage & { body: string };
export function message(n: number, overrides: MessageOverrides): TestMessage;
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
    editedAt: null,
    deleted: false,
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
  /** #134：PATCH の要求（届いた順） */
  edits: { messageId: string; body: string }[];
  /** #134：DELETE の要求のメッセージID（届いた順） */
  deletes: string[];
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
    edits: [],
    deletes: [],
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
    // #134：編集。サーバーの状態を書き換え、以後の一覧（after なし）に反映する
    http.patch("/api/messages/:messageId", async ({ params, request }) => {
      const messageId = String(params.messageId);
      const { body } = (await request.json()) as { body: string };
      state.edits.push({ messageId, body });
      const target = state.messages.find((m) => m.id === messageId);
      if (target === undefined)
        return apiErrorResponse(404, "NOT_FOUND", "メッセージが見つかりません");
      if (target.deleted)
        return apiErrorResponse(
          409,
          "CONFLICT",
          "このメッセージは削除済みです",
        );
      target.body = body;
      target.editedAt = EDITED_AT;
      return HttpResponse.json({ id: messageId, body, editedAt: EDITED_AT });
    }),
    // #134：削除。本文は返さず、削除済みにする
    http.delete("/api/messages/:messageId", ({ params }) => {
      const messageId = String(params.messageId);
      state.deletes.push(messageId);
      const target = state.messages.find((m) => m.id === messageId);
      if (target === undefined)
        return apiErrorResponse(404, "NOT_FOUND", "メッセージが見つかりません");
      if (target.deleted)
        return apiErrorResponse(
          409,
          "CONFLICT",
          "このメッセージは削除済みです",
        );
      target.deleted = true;
      target.body = null;
      target.editedAt = null;
      return new HttpResponse(null, { status: 204 });
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
