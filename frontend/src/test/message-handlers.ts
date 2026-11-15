// #201：メッセージ（一覧・投稿）のテストで使う MSW の応答（架空のデータのみ）。サーバーの状態を持つ簡易な模擬。
// 契約（実装前の仮置き）：
//   GET  /api/rooms/:roomId/messages            → { items: 新しい順の最新50件, nextCursor: null, hasMore: false }
//   GET  /api/rooms/:roomId/messages?after=ID   → { items: IDより後を昇順, nextCursor: null, hasMore }
//   POST /api/rooms/:roomId/messages { body }   → 201 { id, roomId, createdAt }
// #134 で足した契約（実装前の仮置き。計画 plan-134・改訂1）：
//   一覧の items[] に editedAt（string|null）・deleted（真偽）。削除済みは body: null・editedAt: null（投稿者と日時は残す）
//   PATCH  /api/messages/:messageId { body } → 200 { id, body, editedAt }
//   DELETE /api/messages/:messageId           → 204
// #137 で足した契約（実装前の仮置き。計画 plan-137 と改訂1〜3）：
//   一覧の items[] に parentMessageId（部屋の一覧では常に null）・replyCount（返信の件数。削除済みの返信も数える）
//   GET  /api/messages/:parentId/replies           → { items: 新しい順の最新50件, nextCursor: null, hasMore: false, parent, replyBlockedReason, joined, roomWritable }
//   GET  /api/messages/:parentId/replies?after=ID  → { items: IDより後を昇順, nextCursor: null, hasMore, parent, replyBlockedReason, joined, roomWritable }
//        parent は親の1件（一覧の項目と同じ形。削除済みは body: null）。replyBlockedReason は返信できない理由（できれば null）
//   POST /api/messages/:parentId/replies { body }  → 201 { id, parentMessageId, createdAt }
//   PUT  /api/messages/:parentId/thread-read-position { lastReadMessageId } → 204（test/thread-handlers.ts）
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
  /** #137：返信の親の ID。部屋の一覧に出る投稿（親）は null、返信は親の ID */
  parentMessageId: string | null;
  /** #137：この投稿への返信の件数（削除済みの返信も数える）。返信自身は 0 */
  replyCount: number;
  /** #139：指名先と本文内の UTF-16 半開区間。既存の投稿は空配列 */
  mentions: { userId: string; start: number; end: number }[];
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
    parentMessageId: null,
    replyCount: 0,
    mentions: [],
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
      target.mentions = [];
      return HttpResponse.json({
        id: messageId,
        body,
        editedAt: EDITED_AT,
        mentions: [],
      });
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

// ---- #137：スレッドの返信（EP-1-07・EP-1-08）の模擬 ----

/** 自分（SHELL_USER と同じ ID）以外の、返信の投稿者 */
export const OTHER_AUTHOR = {
  id: "01JTESTUSER000000000000002",
  displayName: "テスト次郎",
} as const;

/** n 番目の返信。親の ID を parentMessageId に持ち、親と同じ部屋。ID は n の昇順（辞書順＝時刻順） */
export function reply(
  parent: TestMessage,
  n: number,
  overrides: MessageOverrides = {},
): TestMessage {
  return message(n, {
    id: `01JTESTRPL${String(n).padStart(16, "0")}`,
    roomId: parent.roomId,
    body: `[E2E_TEST]返信${n}`,
    parentMessageId: parent.id,
    ...overrides,
  });
}

export type ReplyServer = {
  /** 親（テストが書き換えて「他の人の削除」を再現する） */
  parent: TestMessage;
  /** 返信（昇順）。テストが後から足して「別の利用者の返信」を再現する */
  replies: TestMessage[];
  /** 返信できない理由（できるときは null）。テストが書き換えて、ポーリングで届く変化を再現する */
  replyBlockedReason: string | null;
  /** #137：今参加しているか（チャンネルは参加中、DM は当事者なら true）。理由とは別に、既読・編集・削除の判断に使う。既定は true */
  joined: boolean;
  /** #137：部屋に今書き込めるか（部署が無効・読み取り専用・DM の相手が無効なら false）。参加中の自分の返信の「編集」「削除」の判断に使う。既定は true */
  roomWritable: boolean;
  /** GET の要求の URL */
  requests: URL[];
  /** POST された本文 */
  posts: string[];
  /** 次の POST を、この応答で失敗させる（1回だけ） */
  failNextPost: { status: number; code: string } | null;
  /** PATCH・DELETE の要求（返信が対象のものだけ） */
  edits: { messageId: string; body: string }[];
  deletes: string[];
};

/**
 * 1つのスレッドの GET・POST を状態つきで返す。親の replyCount は、応答のたびに返信の件数で作る。
 * 返信の PATCH・DELETE（/api/messages/:messageId）は、対象が返信のときだけ応える（それ以外は、先に登録した respondMessages の応答へ回す）。
 */
export function respondReplies(
  initial: {
    parent: TestMessage;
    replies?: TestMessage[];
    replyBlockedReason?: string | null;
    joined?: boolean;
    roomWritable?: boolean;
  },
  options: { afterPageSize?: number } = {},
): ReplyServer {
  const state: ReplyServer = {
    parent: { ...initial.parent },
    replies: (initial.replies ?? []).map((m) => ({ ...m })),
    replyBlockedReason: initial.replyBlockedReason ?? null,
    joined: initial.joined ?? true,
    roomWritable: initial.roomWritable ?? true,
    requests: [],
    posts: [],
    failNextPost: null,
    edits: [],
    deletes: [],
  };
  const parentView = () => ({
    ...state.parent,
    replyCount: state.replies.length,
  });
  server.use(
    http.get("/api/messages/:messageId/replies", ({ params, request }) => {
      // 別のスレッドの要求は、先に登録した応答へ回す（複数のスレッドを同じテストで使うため）
      if (params.messageId !== state.parent.id) return undefined;
      const url = new URL(request.url);
      state.requests.push(url);
      const after = url.searchParams.get("after");
      const common = {
        parent: parentView(),
        replyBlockedReason: state.replyBlockedReason,
        joined: state.joined,
        roomWritable: state.roomWritable,
      };
      if (after === null)
        return HttpResponse.json({
          items: state.replies.slice(-50).reverse(),
          nextCursor: null,
          hasMore: false,
          ...common,
        });
      const newer = state.replies.filter((m) => m.id > after);
      const size = options.afterPageSize ?? 100;
      return HttpResponse.json({
        items: newer.slice(0, size),
        nextCursor: null,
        hasMore: newer.length > size,
        ...common,
      });
    }),
    http.post(
      "/api/messages/:messageId/replies",
      async ({ params, request }) => {
        // 別のスレッドの要求は、先に登録した応答へ回す（複数のスレッドを同じテストで使うため）
        if (params.messageId !== state.parent.id) return undefined;
        const { body } = (await request.json()) as { body: string };
        state.posts.push(body);
        if (state.failNextPost !== null) {
          const { status, code } = state.failNextPost;
          state.failNextPost = null;
          return apiErrorResponse(status, code, "返信できませんでした");
        }
        const created = reply(state.parent, 1000 + state.replies.length, {
          body,
        });
        state.replies.push(created);
        return HttpResponse.json(
          {
            id: created.id,
            parentMessageId: state.parent.id,
            createdAt: created.createdAt,
          },
          { status: 201 },
        );
      },
    ),
    http.patch("/api/messages/:messageId", async ({ params, request }) => {
      const target = state.replies.find((m) => m.id === params.messageId);
      if (target === undefined) return undefined;
      const { body } = (await request.json()) as { body: string };
      state.edits.push({ messageId: target.id, body });
      target.body = body;
      target.editedAt = EDITED_AT;
      target.mentions = [];
      return HttpResponse.json({
        id: target.id,
        body,
        editedAt: EDITED_AT,
        mentions: [],
      });
    }),
    http.delete("/api/messages/:messageId", ({ params }) => {
      const target = state.replies.find((m) => m.id === params.messageId);
      if (target === undefined) return undefined;
      state.deletes.push(target.id);
      target.deleted = true;
      target.body = null;
      target.editedAt = null;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return state;
}
