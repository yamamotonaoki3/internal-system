// MSW のサーバー（テスト用の架空のAPI）。テストごとに server.use(...) で応答を足す。
// #200：サイドバーが参加中のチャンネル（GET /api/channels）を取るため、枠（App・SidebarNav）を描画する全テストで
// 「未処理の通信」にならないよう、空の一覧を既定の応答にする。個別のテストは server.use(...) で上書きできる。
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

// #201：チャンネルの詳細（S-05）がメッセージの一覧（GET /api/rooms/:roomId/messages）も取るため、これも空を既定の応答にする。
export const server = setupServer(
  http.get("/api/channels", () =>
    HttpResponse.json({ items: [], nextCursor: null }),
  ),
  http.get("/api/rooms/:roomId/messages", () =>
    HttpResponse.json({ items: [], nextCursor: null, hasMore: false }),
  ),
  // #136：サイドバーの DM の欄（DmSection）が DM の一覧（GET /api/dms）を取るため、枠を描画する全テストで空を既定の応答にする。
  // 個別のテストは test/dm-handlers.ts の respondDms で上書きする。
  http.get("/api/dms", () =>
    HttpResponse.json({ items: [], nextCursor: null }),
  ),
  // #124：ヘッダーの通知（NotificationBell）が未読数（GET /api/me/notifications/unread-count）を 2 秒ごとに取るため、枠（App・Header）を描画する
  // 全テストで「未処理の通信」にならないよう、未読 0 件を既定の応答にする。個別のテストは test/notification-handlers.ts の respondNotifications で上書きする。
  http.get("/api/me/notifications/unread-count", () =>
    HttpResponse.json({ count: 0 }),
  ),
  // #130：ヘッダーのステータスボタンが自分のプロフィール（GET /api/me/profile）を取るため、在席の架空の値を既定の応答にする。
  // 個別のテストは test/profile-handlers.ts の respondProfileWorld で上書きする。
  http.get("/api/me/profile", () =>
    HttpResponse.json({
      id: "01JTESTUSER000000000000001",
      loginId: "testuser_001",
      displayName: "testuser_001",
      legalName: "テスト花子",
      email: "testuser_001@example.com",
      extension: null,
      jobTitle: null,
      department: null,
      status: { kind: "available", returnAt: null, message: null },
    }),
  ),
);
