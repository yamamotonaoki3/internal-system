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
  // #155（155-C）：S-15 の「案件」の区画が案件の検索（GET /api/search/cases）を取るため、検索の画面を描画する全テストで
  // 「未処理の通信」にならないよう、0件を既定の応答にする。個別のテストは test/search-handlers.ts の respondCaseSearch で上書きする。
  http.get("/api/search/cases", () =>
    HttpResponse.json({ items: [], nextCursor: null }),
  ),
  // #147：サイドバーの「案件」の見出しの下（CaseSidebarSection）が参加中の進行中の案件（GET /api/cases）を取るため、枠を描画する全テストで空を既定の応答にする。
  // 個別のテストは test/case-handlers.tsx の respondCases で上書きする。
  http.get("/api/cases", () =>
    HttpResponse.json({ items: [], nextCursor: null }),
  ),
  // #149：S-17 の TODO の区画（CaseTodoSection）が、参加者のとき TODO の一覧（GET /api/cases/:caseId/todos）を 2 秒ごとに取るため、
  // S-17 を描画する全テストで「未処理の通信」にならないよう、0件を既定の応答にする。個別のテストは test/case-todo-handlers.ts の respondTodos で上書きする。
  http.get("/api/cases/:caseId/todos", () =>
    HttpResponse.json({ items: [], nextCursor: null, progress: null }),
  ),
  // #148（148-B-1）：S-17 の「添付ファイル」の区画が、参加者のとき案件の添付の一覧（GET /api/cases/:caseId/attachments）を取るため、
  // S-17 を描画する全テストで「未処理の通信」にならないよう、0件を既定の応答にする。個別のテストは test/case-attachment-handlers.ts の respondCaseAttachments で上書きする。
  http.get("/api/cases/:caseId/attachments", () =>
    HttpResponse.json({ items: [], nextCursor: null }),
  ),
  // #124：ヘッダーの通知（NotificationBell）が未読数（GET /api/me/notifications/unread-count）を 2 秒ごとに取るため、枠（App・Header）を描画する
  // 全テストで「未処理の通信」にならないよう、未読 0 件を既定の応答にする。個別のテストは test/notification-handlers.ts の respondNotifications で上書きする。
  http.get("/api/me/notifications/unread-count", () =>
    HttpResponse.json({ count: 0 }),
  ),
  // #237：サイドバー（JoinedChannelsSection・DmItems）が未読の件数（GET /api/me/unread）を 2 秒ごとに取り、部屋（S-05・S-06）を開くと
  // 既読（PUT /api/rooms/:roomId/read-position）を送るため、枠・部屋を描画する全テストで「未処理の通信」にならないよう、
  // 未読なし・既読の成功（204）を既定の応答にする。個別のテストは test/unread-handlers.ts の respondUnread で上書きする。
  http.get("/api/me/unread", () =>
    HttpResponse.json({ items: [], nextCursor: null }),
  ),
  http.put(
    "/api/rooms/:roomId/read-position",
    () => new HttpResponse(null, { status: 204 }),
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
