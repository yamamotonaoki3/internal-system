// #237：未読の件数と既読のテストで使う MSW の応答（架空のデータのみ）。サーバーの状態を持つ簡易な模擬。
// 契約（計画「2. 未読数の取得」・「1. 既読にする操作」）：
//   GET /api/me/unread?limit&cursor → { items: [{ roomId, count }], nextCursor }
//       未読が1件以上の部屋だけ、roomId の昇順。count は 1〜100。items は limit より少なく、空でも nextCursor がありうる
//   PUT /api/rooms/:roomId/read-position { lastReadMessageId } → 204（その部屋の未読を 0 にする）
// 名前を use〜 にしない（React Hooks の規則の誤検知を避ける）。
import { http, HttpResponse } from "msw";
import { server } from "./server";

export type ReadPut = { roomId: string; lastReadMessageId: string };

export type UnreadWorld = {
  /** サーバー側の未読の件数（roomId → 件数）。0 の部屋は返さない。テストが後から変えて「新着」を再現する */
  counts: Map<string, number>;
  /** GET /api/me/unread の要求の URL */
  listRequests: URL[];
  /** PUT の要求（届いた順） */
  puts: ReadPut[];
  /** 1ページの部屋の数（既定は limit のまま） */
  pageSize: number | null;
  /** 次の GET を、この応答で失敗させる（回数を指定。0 で失敗しない） */
  failList: { status: number; times: number };
  /** 次の PUT を、この応答で失敗させる（1回だけ） */
  failNextPut: { status: number } | null;
  /** 指定した部屋の PUT の応答を、返された Promise が解けるまで待たせる（応答の順の入れ替わりを作る） */
  holdPut: (roomId: string, messageId: string) => () => void;
  /** 既読にしても未読を 0 にしない（取り直しの要求が出たことだけを確かめるとき） */
  keepCountsOnPut: boolean;
};

export function respondUnread(
  options: { counts?: Record<string, number>; pageSize?: number } = {},
): UnreadWorld {
  const holds = new Map<string, Promise<void>>();
  const world: UnreadWorld = {
    counts: new Map(Object.entries(options.counts ?? {})),
    listRequests: [],
    puts: [],
    pageSize: options.pageSize ?? null,
    failList: { status: 500, times: 0 },
    failNextPut: null,
    keepCountsOnPut: false,
    holdPut(roomId, messageId) {
      let release = () => {};
      holds.set(
        `${roomId}:${messageId}`,
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      return () => release();
    },
  };
  server.use(
    http.get("/api/me/unread", ({ request }) => {
      const url = new URL(request.url);
      world.listRequests.push(url);
      if (world.failList.times > 0) {
        world.failList.times -= 1;
        return HttpResponse.json(
          { code: "TEST_ERROR", message: "テスト用のエラーです" },
          { status: world.failList.status },
        );
      }
      const all = [...world.counts.entries()]
        .filter(([, count]) => count > 0)
        .map(([roomId, count]) => ({ roomId, count: Math.min(count, 100) }))
        .sort((a, b) => (a.roomId < b.roomId ? -1 : 1));
      const limit = Number(url.searchParams.get("limit") ?? "20");
      const size = world.pageSize ?? limit;
      const cursor = url.searchParams.get("cursor");
      const start = cursor === null ? 0 : Number(cursor.replace("c", ""));
      const next = start + size;
      return HttpResponse.json({
        items: all.slice(start, next),
        nextCursor: next < all.length ? `c${next}` : null,
      });
    }),
    http.put(
      "/api/rooms/:roomId/read-position",
      async ({ params, request }) => {
        const roomId = String(params.roomId);
        const { lastReadMessageId } = (await request.json()) as {
          lastReadMessageId: string;
        };
        world.puts.push({ roomId, lastReadMessageId });
        const hold = holds.get(`${roomId}:${lastReadMessageId}`);
        if (hold !== undefined) await hold;
        if (world.failNextPut !== null) {
          const { status } = world.failNextPut;
          world.failNextPut = null;
          return HttpResponse.json(
            { code: "TEST_ERROR", message: "テスト用のエラーです" },
            { status },
          );
        }
        if (!world.keepCountsOnPut) world.counts.delete(roomId);
        return new HttpResponse(null, { status: 204 });
      },
    ),
  );
  return world;
}

/** 何ページにも分かれる未読の一覧を、決まった数のページで返す（全ページの取得の上限を確かめる） */
export function respondUnreadPages(pages: number): { requests: URL[] } {
  const requests: URL[] = [];
  server.use(
    http.get("/api/me/unread", ({ request }) => {
      const url = new URL(request.url);
      requests.push(url);
      const cursor = url.searchParams.get("cursor");
      const index = cursor === null ? 0 : Number(cursor.replace("p", ""));
      return HttpResponse.json({
        items: [
          {
            roomId: `01JTESTXNREADPAGE${String(index).padStart(9, "0")}`,
            count: 1,
          },
        ],
        nextCursor: index + 1 < pages ? `p${index + 1}` : null,
      });
    }),
  );
  return { requests };
}
