// #155（155-A）の画面のテストで使う、メッセージの検索（GET /api/search/messages。EP-4-01）の架空の応答（MSW）。
// 応答の形は計画 4.4：{ items: [{ messageId, parentMessageId, roomId, roomKind, roomName, author: { id, displayName }, excerpt, createdAt }], nextCursor }。
// 155-B（利用者の決定 B-4）：各行に matchedIn（"body" | "attachment" の配列。1つ以上）と matchedAttachments（{ id, name } の配列）を足す。
//   searchItem の既定は本文だけの一致（matchedIn ["body"]・matchedAttachments []）。
// world の値を変えると、次の要求から応答が変わる（受けた要求は requests に記録する）。hold を置くと、その Promise が解けるまで応答を保留する。
// データはすべて架空（[E2E_TEST]・testuser_）。
import { http, HttpResponse } from "msw";
import { server } from "./server";

export type SearchItem = {
  messageId: string;
  parentMessageId: string | null;
  roomId: string;
  roomKind: "channel" | "direct" | "case";
  roomName: string;
  author: { id: string; displayName: string };
  excerpt: string;
  createdAt: string;
  matchedIn: ("body" | "attachment")[];
  matchedAttachments: { id: string; name: string }[];
};

export type SearchRequest = {
  q: string | null;
  roomId: string | null;
  from: string | null;
  to: string | null;
  cursor: string | null;
  limit: string | null;
};

export type SearchWorld = {
  /** cursor（最初のページは null）ごとのページ。無いカーソルは空のページ。形の誤った応答を試すときは unknown の値を入れる */
  pages: Map<string | null, { items: unknown[]; nextCursor: string | null }>;
  /** 次の n 回を、この状態で失敗させる */
  fail: { status: number; times: number } | null;
  hold: Promise<void> | null;
  requests: SearchRequest[];
};

/** n 番目の結果（ID・日時は n から決まる。本文は呼び出し側で決める） */
export function searchItem(
  n: number,
  overrides: Partial<SearchItem> = {},
): SearchItem {
  const id = `01JTESTSRCH155${String(n).padStart(12, "0")}`;
  return {
    messageId: id,
    parentMessageId: null,
    roomId: "01JTESTROOM155000000000001",
    roomKind: "channel",
    roomName: "[E2E_TEST]検索の部屋",
    author: { id: "01JTESTUSER155000000000002", displayName: "testuser_155_b" },
    excerpt: `[E2E_TEST]検索結果${String(n).padStart(2, "0")}`,
    createdAt: new Date(
      Date.UTC(2026, 10, 20, 0, 0, 0) - n * 60_000,
    ).toISOString(),
    matchedIn: ["body"],
    matchedAttachments: [],
    ...overrides,
  };
}

/** 1ページだけの応答（続きなし） */
export function respondSearch(items: SearchItem[]): SearchWorld {
  return respondSearchPages([{ items, nextCursor: null }]);
}

/** 複数ページの応答。i 番目のページは、i-1 番目の nextCursor で取る（最初は cursor なし） */
export function respondSearchPages(
  pages: { items: SearchItem[]; nextCursor: string | null }[],
): SearchWorld {
  const world: SearchWorld = {
    pages: new Map(),
    fail: null,
    hold: null,
    requests: [],
  };
  let cursor: string | null = null;
  for (const page of pages) {
    world.pages.set(cursor, page);
    cursor = page.nextCursor;
  }
  server.use(
    http.get("/api/search/messages", async ({ request }) => {
      const url = new URL(request.url);
      const read = (name: string) => url.searchParams.get(name);
      world.requests.push({
        q: read("q"),
        roomId: read("roomId"),
        from: read("from"),
        to: read("to"),
        cursor: read("cursor"),
        limit: read("limit"),
      });
      const hold = world.hold;
      if (hold !== null) await hold;
      if (world.fail !== null && world.fail.times > 0) {
        world.fail.times -= 1;
        return HttpResponse.json(
          { code: "INTERNAL_ERROR", message: "エラーが発生しました" },
          { status: world.fail.status },
        );
      }
      return HttpResponse.json(
        world.pages.get(read("cursor")) ?? { items: [], nextCursor: null },
      );
    }),
  );
  return world;
}

export function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

// ---- #155（155-C）案件の検索（GET /api/search/cases。EP-4-02）の架空の応答 ----
// 応答の形は計画 5章：{ items: [{ id, caseNumber, title, status, client: { id, name, isActive }, departments: [{ id, name, isActive }],
//   dueDate, progress: { done, total } | null, isParticipant, matchedIn: ("title" | "caseNumber" | "client")[] }], nextCursor }。
// 参加者だけの項目（説明・参加者・参加者数・管理の資格・部屋の ID・最終更新・版）は持たない。
// test/server.ts の既定の応答は0件（メッセージの検索だけを確かめる既存の画面のテストで「未処理の通信」にしない）。

export type CaseSearchItem = {
  id: string;
  caseNumber: string;
  title: string;
  status: "active" | "closed";
  client: { id: string; name: string; isActive: boolean };
  departments: { id: string; name: string; isActive: boolean }[];
  dueDate: string | null;
  progress: { done: number; total: number } | null;
  isParticipant: boolean;
  matchedIn: ("title" | "caseNumber" | "client")[];
};

export type CaseSearchRequest = {
  q: string | null;
  cursor: string | null;
  limit: string | null;
};

export type CaseSearchWorld = {
  /** cursor（最初のページは null）ごとのページ。形の誤った応答を試すときは unknown の値を入れる */
  pages: Map<string | null, { items: unknown[]; nextCursor: string | null }>;
  /** 次の n 回を、この状態で失敗させる */
  fail: { status: number; times: number } | null;
  hold: Promise<void> | null;
  requests: CaseSearchRequest[];
};

/** n 番目の案件の結果（ID・番号は n から決まる。件名は呼び出し側で決めてよい） */
export function caseSearchItem(
  n: number,
  overrides: Partial<CaseSearchItem> = {},
): CaseSearchItem {
  const serial = String(n).padStart(4, "0");
  return {
    id: `01JTESTCASE155C${String(n).padStart(11, "0")}`,
    caseNumber: `QSC-261121-${serial}`,
    title: `[E2E_TEST]案件の検索結果${serial}`,
    status: "active",
    client: {
      id: "01JTESTCLNT155C00000000001",
      name: "[E2E_TEST]検索の取引先",
      isActive: true,
    },
    departments: [
      {
        id: "01JTESTDEPT155C00000000001",
        name: "[E2E_TEST]検索の部署",
        isActive: true,
      },
    ],
    dueDate: null,
    progress: null,
    isParticipant: false,
    matchedIn: ["title"],
    ...overrides,
  };
}

/** 案件の検索の1ページだけの応答（続きなし） */
export function respondCaseSearch(items: CaseSearchItem[]): CaseSearchWorld {
  return respondCaseSearchPages([{ items, nextCursor: null }]);
}

/** 案件の検索の複数ページの応答。i 番目のページは、i-1 番目の nextCursor で取る（最初は cursor なし） */
export function respondCaseSearchPages(
  pages: { items: CaseSearchItem[]; nextCursor: string | null }[],
): CaseSearchWorld {
  const world: CaseSearchWorld = {
    pages: new Map(),
    fail: null,
    hold: null,
    requests: [],
  };
  let cursor: string | null = null;
  for (const page of pages) {
    world.pages.set(cursor, page);
    cursor = page.nextCursor;
  }
  server.use(
    http.get("/api/search/cases", async ({ request }) => {
      const url = new URL(request.url);
      const read = (name: string) => url.searchParams.get(name);
      world.requests.push({
        q: read("q"),
        cursor: read("cursor"),
        limit: read("limit"),
      });
      const hold = world.hold;
      if (hold !== null) await hold;
      if (world.fail !== null && world.fail.times > 0) {
        world.fail.times -= 1;
        return HttpResponse.json(
          { code: "INTERNAL_ERROR", message: "エラーが発生しました" },
          { status: world.fail.status },
        );
      }
      return HttpResponse.json(
        world.pages.get(read("cursor")) ?? { items: [], nextCursor: null },
      );
    }),
  );
  return world;
}
