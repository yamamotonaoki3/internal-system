// #124：通知のテストで使う MSW の応答（架空のデータのみ）。サーバーの状態を持つ簡易な模擬。
// 契約（実装前の仮置き。計画「HTTP API」）：
//   GET  /api/me/notifications?cursor&limit        → { items: [{ id, kind, roomId, messageId, targetId, createdAt, readAt }], nextCursor }（新しい順）
//   GET  /api/me/notifications/unread-count        → { count }（100 で打ち切り）
//   POST /api/me/notifications/:notificationId/read → 204（既読にする。状態に反映する）
//   POST /api/me/notifications/read-all             → 204（すべて既読にする。状態に反映する）
// 名前を use〜 にしない（React Hooks の規則の誤検知を避ける）。
import { http, HttpResponse } from "msw";
import { server } from "./server";

export type TestNotification = {
  id: string;
  kind: string;
  roomId: string | null;
  messageId: string | null;
  targetId: string | null;
  createdAt: string;
  readAt: string | null;
};

/** n 番目の通知。ID は n の昇順（辞書順＝時刻順）。respondNotifications には新しい順（大きい n が先）で渡す */
export function notification(
  n: number,
  overrides: Partial<TestNotification> = {},
): TestNotification {
  return {
    id: `01JTESTNOTIF${String(n).padStart(14, "0")}`,
    kind: "test_kind",
    roomId: null,
    messageId: null,
    targetId: `01JTESTTARGET${String(n).padStart(13, "0")}`,
    createdAt: new Date(Date.UTC(2026, 10, 1, 0, n)).toISOString(),
    readAt: null,
    ...overrides,
  };
}

export type NotificationWorld = {
  /** サーバー側の通知（新しい順）。テストが後から足して「新着」を再現する */
  items: TestNotification[];
  /** GET /api/me/notifications の要求の URL */
  listRequests: URL[];
  /** GET /api/me/notifications/unread-count の要求回数 */
  countRequests: number;
  /** POST .../:id/read の対象の ID */
  readPosts: string[];
  /** POST .../read-all の回数 */
  readAllPosts: number;
  /** 1 ページの件数（既定 20） */
  pageSize: number;
  /** 次の既読（1 件）を、この応答で失敗させる（1 回だけ） */
  failNextRead: { status: number; body: unknown } | null;
  /** 設定すると、read-all の応答をこの Promise が解けるまで待たせる（送信中の表示を確かめるため） */
  holdReadAll: Promise<void> | null;
};

const READ_AT = "2026-11-11T00:00:00.000Z";

export function respondNotifications(
  options: { items?: TestNotification[]; pageSize?: number } = {},
): NotificationWorld {
  const world: NotificationWorld = {
    items: (options.items ?? []).map((item) => ({ ...item })),
    listRequests: [],
    countRequests: 0,
    readPosts: [],
    readAllPosts: 0,
    pageSize: options.pageSize ?? 20,
    failNextRead: null,
    holdReadAll: null,
  };
  server.use(
    http.get("/api/me/notifications/unread-count", () => {
      world.countRequests += 1;
      const unread = world.items.filter((item) => item.readAt === null).length;
      return HttpResponse.json({ count: Math.min(unread, 100) });
    }),
    http.get("/api/me/notifications", ({ request }) => {
      const url = new URL(request.url);
      world.listRequests.push(url);
      const cursor = url.searchParams.get("cursor");
      const start = cursor === null ? 0 : Number(cursor.replace("c", ""));
      const items = world.items.slice(start, start + world.pageSize);
      const next = start + world.pageSize;
      return HttpResponse.json({
        items,
        nextCursor: next < world.items.length ? `c${next}` : null,
      });
    }),
    http.post("/api/me/notifications/read-all", async () => {
      world.readAllPosts += 1;
      if (world.holdReadAll !== null) await world.holdReadAll;
      for (const item of world.items) item.readAt = item.readAt ?? READ_AT;
      return new HttpResponse(null, { status: 204 });
    }),
    http.post("/api/me/notifications/:notificationId/read", ({ params }) => {
      const id = String(params.notificationId);
      world.readPosts.push(id);
      if (world.failNextRead !== null) {
        const failure = world.failNextRead;
        world.failNextRead = null;
        return HttpResponse.json(failure.body as Record<string, unknown>, {
          status: failure.status,
        });
      }
      const found = world.items.find((item) => item.id === id);
      if (!found)
        return HttpResponse.json(
          { code: "NOT_FOUND", message: "見つかりませんでした" },
          { status: 404 },
        );
      found.readAt = found.readAt ?? READ_AT;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return world;
}
