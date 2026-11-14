// #137：スレッド一覧（S-35）とスレッドの既読のテストで使う MSW の応答（架空のデータのみ）。サーバーの状態を持つ簡易な模擬。
// 契約（実装前の仮置き。計画 plan-137 の「7. スレッド一覧 EP-3-08」「8. スレッドの既読 EP-3-09」と改訂1〜3）：
//   GET /api/me/threads?limit&cursor → { items: [{ parent, room, lastReplyAt, unreadCount }], nextCursor }
//       最後の返信が新しい順。parent は親の1件（部屋の一覧の項目と同じ形に replyCount を持つ。削除済みは body: null）。
//       room は { kind: "channel", id, name } か { kind: "direct", id, partner: { id, displayName, isActive } }。
//       unreadCount は 0〜100。limit を付けないときの既定は 20。
//   PUT /api/messages/:parentMessageId/thread-read-position { lastReadMessageId } → 204（そのスレッドの未読を 0 にする）
// 名前を use〜 にしない（React Hooks の規則の誤検知を避ける）。
import { http, HttpResponse } from "msw";
import { message, type TestMessage } from "./message-handlers";
import { server } from "./server";

export type TestThreadRoom =
  | { kind: "channel"; id: string; name: string }
  | {
      kind: "direct";
      id: string;
      partner: { id: string; displayName: string; isActive: boolean };
    };

export type TestThread = {
  parent: TestMessage;
  room: TestThreadRoom;
  lastReplyAt: string;
  unreadCount: number;
};

export const THREAD_ROOM_ID = "01JTESTROOM00000000000T001";

/** n 番目のスレッド。親の ID は n の昇順（一覧の並びとは無関係）。返信は 1 件以上ある前提（replyCount の既定は 1） */
export function threadItem(
  n: number,
  overrides: {
    parent?: Partial<TestMessage>;
    room?: TestThreadRoom;
    lastReplyAt?: string;
    unreadCount?: number;
  } = {},
): TestThread {
  const room: TestThreadRoom = overrides.room ?? {
    kind: "channel",
    id: THREAD_ROOM_ID,
    name: `[E2E_TEST]スレッドの部屋${n}`,
  };
  return {
    parent: message(n, {
      body: `[E2E_TEST]親${n}`,
      roomId: room.id,
      replyCount: 1,
      ...overrides.parent,
    }),
    room,
    lastReplyAt: overrides.lastReplyAt ?? "2026-11-13T00:00:00.000Z",
    unreadCount: overrides.unreadCount ?? 0,
  };
}

export type ThreadWorld = {
  /** サーバー側の一覧（最後の返信が新しい順）。テストは bump・setUnread で書き換える */
  items: () => TestThread[];
  /** GET /api/me/threads の要求の URL */
  listRequests: URL[];
  /** PUT の要求（届いた順） */
  puts: { parentMessageId: string; lastReadMessageId: string }[];
  /** 親の ID のスレッドに返信が付いたことを再現する（一覧の先頭に動く） */
  bump: (parentMessageId: string) => void;
  /** まだ一覧にないスレッドが、新しく関わったことで一覧の先頭に加わることを再現する */
  add: (thread: TestThread) => void;
  /** 親の ID のスレッドの未読の件数を書き換える（並びは変えない） */
  setUnread: (parentMessageId: string, count: number) => void;
  /** 次の GET を、この応答で失敗させる（回数を指定。0 で失敗しない） */
  failList: { status: number; times: number };
};

/**
 * GET /api/me/threads・PUT thread-read-position を状態つきで返す。initial は新しい順。
 * カーソルは「ここより古い」を表す内部の連番で、1ページの件数は pageSize（既定は limit、なければ 20）。
 * 並びは、返信が付く（bump）と先頭へ動く。カーソルは位置ではなく連番なので、並びが変わっても古い位置から続きを返す。
 */
export function respondMyThreads(
  initial: TestThread[],
  options: { pageSize?: number } = {},
): ThreadWorld {
  let nextKey = initial.length;
  const entries = initial.map((item, index) => ({
    key: initial.length - index,
    item: { ...item },
  }));
  const sorted = () => [...entries].sort((a, b) => b.key - a.key);
  const world: ThreadWorld = {
    items: () => sorted().map((entry) => entry.item),
    listRequests: [],
    puts: [],
    bump: (parentMessageId) => {
      const entry = entries.find(
        (candidate) => candidate.item.parent.id === parentMessageId,
      );
      if (entry === undefined) return;
      nextKey += 1;
      entry.key = nextKey;
      entry.item = {
        ...entry.item,
        lastReplyAt: "2026-11-14T09:00:00.000Z",
        parent: {
          ...entry.item.parent,
          replyCount: entry.item.parent.replyCount + 1,
        },
      };
    },
    add: (thread) => {
      nextKey += 1;
      entries.push({ key: nextKey, item: { ...thread } });
    },
    setUnread: (parentMessageId, count) => {
      const entry = entries.find(
        (candidate) => candidate.item.parent.id === parentMessageId,
      );
      if (entry !== undefined)
        entry.item = { ...entry.item, unreadCount: count };
    },
    failList: { status: 500, times: 0 },
  };
  server.use(
    http.get("/api/me/threads", ({ request }) => {
      const url = new URL(request.url);
      world.listRequests.push(url);
      if (world.failList.times > 0) {
        world.failList.times -= 1;
        return HttpResponse.json(
          { code: "TEST_ERROR", message: "テスト用のエラーです" },
          { status: world.failList.status },
        );
      }
      const size =
        options.pageSize ?? Number(url.searchParams.get("limit") ?? "20");
      const cursor = url.searchParams.get("cursor");
      const before =
        cursor === null ? Infinity : Number(cursor.replace("k", ""));
      const rest = sorted().filter((entry) => entry.key < before);
      const page = rest.slice(0, size);
      const last = page.at(-1);
      return HttpResponse.json({
        items: page.map((entry) => entry.item),
        nextCursor:
          rest.length > size && last !== undefined ? `k${last.key}` : null,
      });
    }),
    http.put(
      "/api/messages/:messageId/thread-read-position",
      async ({ params, request }) => {
        const parentMessageId = String(params.messageId);
        const { lastReadMessageId } = (await request.json()) as {
          lastReadMessageId: string;
        };
        world.puts.push({ parentMessageId, lastReadMessageId });
        world.setUnread(parentMessageId, 0);
        return new HttpResponse(null, { status: 204 });
      },
    ),
  );
  return world;
}

/** スレッドの既読だけを受ける（ChannelDetailView・DmView などで、一覧は使わずに PUT だけを確かめる） */
export function respondThreadReadOnly(options: { failStatus?: number } = {}) {
  const puts: { parentMessageId: string; lastReadMessageId: string }[] = [];
  server.use(
    http.put(
      "/api/messages/:messageId/thread-read-position",
      async ({ params, request }) => {
        const { lastReadMessageId } = (await request.json()) as {
          lastReadMessageId: string;
        };
        puts.push({
          parentMessageId: String(params.messageId),
          lastReadMessageId,
        });
        if (options.failStatus !== undefined)
          return HttpResponse.json(
            { code: "TEST_ERROR", message: "テスト用のエラーです" },
            { status: options.failStatus },
          );
        return new HttpResponse(null, { status: 204 });
      },
    ),
  );
  return puts;
}
