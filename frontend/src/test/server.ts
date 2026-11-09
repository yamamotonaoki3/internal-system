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
);
