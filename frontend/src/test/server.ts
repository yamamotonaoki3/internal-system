// MSW のサーバー（テスト用の架空のAPI）。テストごとに server.use(...) で応答を足す。
// #200：サイドバーが参加中のチャンネル（GET /api/channels）を取るため、枠（App・SidebarNav）を描画する全テストで
// 「未処理の通信」にならないよう、空の一覧を既定の応答にする。個別のテストは server.use(...) で上書きできる。
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

export const server = setupServer(
  http.get("/api/channels", () =>
    HttpResponse.json({ items: [], nextCursor: null }),
  ),
);
