// #200：チャンネル（一覧・詳細・参加）のテストで使う MSW の応答（架空のデータのみ）。サーバーの状態を持つ簡易な模擬。
// 名前を use〜 にしない（React Hooks の規則の誤検知を避ける）。
import { http, HttpResponse } from "msw";
import { server } from "./server";

export type ChannelItem = {
  id: string;
  roomId: string;
  name: string;
  visibility: "public" | "private";
  departmentId: string | null;
  departmentName: string | null;
  joined: boolean;
};

export const DEPT_SALES = {
  id: "01JTESTDEPT000000000000S01",
  name: "[E2E_TEST]営業部",
} as const;
export const DEPT_DEV = {
  id: "01JTESTDEPT000000000000D01",
  name: "[E2E_TEST]開発部",
} as const;

export function channelItem(
  n: string,
  overrides: Partial<ChannelItem> = {},
): ChannelItem {
  const id = `01JTESTCHAN00000000000${n.padStart(3, "0")}`;
  return {
    id,
    roomId: id,
    name: `[E2E_TEST]チャンネル${n}`,
    visibility: "public",
    departmentId: null,
    departmentName: null,
    joined: false,
    ...overrides,
  };
}

export type ChannelServer = {
  /** 一覧の要求（クエリの確認用） */
  listRequests: URL[];
  /** 参加の要求のチャンネルID */
  joinRequests: string[];
};

/**
 * GET /api/channels（departmentId・joined での絞り込み）と POST /api/channels/:id/join を、状態付きで返す。
 * 参加すると、その後の一覧は joined:true になる。
 */
export function respondChannels(initial: ChannelItem[]): ChannelServer {
  const state = initial.map((item) => ({ ...item }));
  const recorded: ChannelServer = { listRequests: [], joinRequests: [] };
  server.use(
    http.get("/api/channels", ({ request }) => {
      const url = new URL(request.url);
      recorded.listRequests.push(url);
      const departmentId = url.searchParams.get("departmentId");
      const joined = url.searchParams.get("joined");
      const items = state.filter(
        (item) =>
          (departmentId === null || item.departmentId === departmentId) &&
          (joined === null || String(item.joined) === joined),
      );
      return HttpResponse.json({ items, nextCursor: null });
    }),
    http.post("/api/channels/:channelId/join", ({ params }) => {
      const id = String(params.channelId);
      recorded.joinRequests.push(id);
      const target = state.find((item) => item.id === id);
      if (target === undefined)
        return HttpResponse.json(
          { code: "NOT_FOUND", message: "チャンネルが見つかりません" },
          { status: 404 },
        );
      target.joined = true;
      return HttpResponse.json({
        channelId: id,
        roomId: id,
        joinedAt: "2026-11-09T00:00:00.000Z",
      });
    }),
  );
  return recorded;
}
