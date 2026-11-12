// #136：ダイレクトメッセージ（DM）のテストで使う MSW の応答（架空のデータのみ）。サーバーの状態を持つ簡易な模擬。
// 契約（実装前の仮置き。計画 plan-136 の「3. API」）：
//   POST /api/dms { partnerUserId }        → 200 { roomId, partner: { id, displayName } }（新規・既存とも 200。既存なら同じ roomId）
//   GET  /api/dms?cursor=                  → { items: [{ roomId, partner: { id, displayName, isActive, status: { kind, returnAt } | null }, lastMessageAt }], nextCursor }
//                                            最終活動の新しい順。相手が無効なら status は null
//   GET  /api/dms/:roomId                  → { roomId, partner: { id, displayName, department: { id, name } | null, isActive, status: { kind, returnAt, message } | null }, canPost }
//                                            当事者でない・存在しないものは 404
// メッセージの一覧・投稿（GET/POST /api/rooms/:roomId/messages）は test/message-handlers.ts の respondMessages を使う。
// 名前を use〜 にしない（React Hooks の規則の誤検知を避ける）。
import { http, HttpResponse } from "msw";
import type { MessageServer } from "./message-handlers";
import { message } from "./message-handlers";
import { server } from "./server";

export type StatusKind =
  "available" | "away" | "absent" | "vacation" | "meeting";

export type DmListItem = {
  roomId: string;
  partner: {
    id: string;
    displayName: string;
    isActive: boolean;
    status: { kind: StatusKind; returnAt: string | null } | null;
  };
  lastMessageAt: string | null;
};

export type DmDetail = {
  roomId: string;
  partner: {
    id: string;
    displayName: string;
    department: { id: string; name: string } | null;
    isActive: boolean;
    status: {
      kind: StatusKind;
      returnAt: string | null;
      message: string | null;
    } | null;
  };
  canPost: boolean;
};

export const DM_DEPT = {
  id: "01JTESTDMDEPT0000000000D01",
  name: "[E2E_TEST]部署136",
} as const;

/** n 番目の相手の利用者ID・表示名（架空） */
export function partnerId(n: number): string {
  return `01JTESTDMUSER0000000000${String(n).padStart(3, "0")}`;
}
export function partnerName(n: number): string {
  return `テスト相手${String(n).padStart(3, "0")}`;
}
/** n 番目の DM の部屋の ID */
export function dmRoomId(n: number): string {
  return `01JTESTDMROOM0000000000${String(n).padStart(3, "0")}`;
}

export function dmItem(
  n: number,
  overrides: Partial<DmListItem> = {},
): DmListItem {
  return {
    roomId: dmRoomId(n),
    partner: {
      id: partnerId(n),
      displayName: partnerName(n),
      isActive: true,
      status: { kind: "available", returnAt: null },
    },
    lastMessageAt: "2026-11-12T00:00:00.000Z",
    ...overrides,
  };
}

export function dmDetail(
  n: number,
  overrides: {
    partner?: Partial<DmDetail["partner"]>;
    canPost?: boolean;
  } = {},
): DmDetail {
  return {
    roomId: dmRoomId(n),
    partner: {
      id: partnerId(n),
      displayName: partnerName(n),
      department: DM_DEPT,
      isActive: true,
      status: { kind: "available", returnAt: null, message: null },
      ...overrides.partner,
    },
    canPost: overrides.canPost ?? true,
  };
}

export type DmWorld = {
  /** サーバー側の DM の一覧（最終活動の新しい順） */
  items: DmListItem[];
  /** サーバー側の DM の詳細（roomId ごと） */
  details: Map<string, DmDetail>;
  /** GET /api/dms の要求 */
  listRequests: URL[];
  /** GET /api/dms/:roomId の要求の roomId */
  detailRequests: string[];
  /** POST /api/dms の本文 */
  startBodies: Record<string, unknown>[];
  /** 1ページの件数（既定 20） */
  pageSize: number;
  /** 指定した roomId を一覧の先頭に移す（投稿で最終活動が新しくなったことを再現する） */
  bump: (roomId: string) => void;
};

/**
 * GET /api/dms・GET /api/dms/:roomId・POST /api/dms を状態つきで返す。
 * POST で知らない相手を指定すると、新しい部屋を作って一覧の先頭に足す（表示名は names から、無ければ partnerName 相当の仮名）。
 */
export function respondDms(
  options: {
    items?: DmListItem[];
    details?: DmDetail[];
    pageSize?: number;
    /** POST で新しく作るときの相手の表示名（利用者ID → 表示名） */
    names?: Record<string, string>;
  } = {},
): DmWorld {
  const world: DmWorld = {
    items: (options.items ?? []).map((item) => ({ ...item })),
    details: new Map(
      (options.details ?? []).map((detail) => [detail.roomId, detail]),
    ),
    listRequests: [],
    detailRequests: [],
    startBodies: [],
    pageSize: options.pageSize ?? 20,
    bump: (roomId) => {
      const index = world.items.findIndex((item) => item.roomId === roomId);
      if (index < 0) return;
      const [item] = world.items.splice(index, 1);
      if (item)
        world.items.unshift({
          ...item,
          lastMessageAt: "2026-11-12T09:00:00.000Z",
        });
    },
  };
  let created = 0;

  server.use(
    http.get("/api/dms", ({ request }) => {
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
    http.get("/api/dms/:roomId", ({ params }) => {
      const roomId = String(params.roomId);
      world.detailRequests.push(roomId);
      const found = world.details.get(roomId);
      if (found === undefined)
        return HttpResponse.json(
          { code: "NOT_FOUND", message: "見つかりませんでした" },
          { status: 404 },
        );
      return HttpResponse.json(found);
    }),
    http.post("/api/dms", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      world.startBodies.push(body);
      const partnerUserId = String(body.partnerUserId);
      const existing = world.items.find(
        (item) => item.partner.id === partnerUserId,
      );
      if (existing !== undefined)
        return HttpResponse.json({
          roomId: existing.roomId,
          partner: {
            id: existing.partner.id,
            displayName: existing.partner.displayName,
          },
        });
      created += 1;
      const displayName =
        options.names?.[partnerUserId] ?? `テスト新規相手${created}`;
      const roomId = `01JTESTDMROOMNEW0000000${String(created).padStart(3, "0")}`;
      world.items.unshift({
        roomId,
        partner: {
          id: partnerUserId,
          displayName,
          isActive: true,
          status: { kind: "available", returnAt: null },
        },
        lastMessageAt: null,
      });
      world.details.set(roomId, {
        roomId,
        partner: {
          id: partnerUserId,
          displayName,
          department: DM_DEPT,
          isActive: true,
          status: { kind: "available", returnAt: null, message: null },
        },
        canPost: true,
      });
      return HttpResponse.json({
        roomId,
        partner: { id: partnerUserId, displayName },
      });
    }),
  );
  return world;
}

/**
 * DM の部屋への投稿（POST /api/rooms/:roomId/messages）を、メッセージの状態に足し、DM の一覧の先頭に移して返す。
 * respondMessages の後に呼ぶ（後から足した応答が先に使われる）。
 */
export function respondDmPosts(dms: DmWorld, messages: MessageServer): void {
  server.use(
    http.post("/api/rooms/:roomId/messages", async ({ params, request }) => {
      const roomId = String(params.roomId);
      const { body } = (await request.json()) as { body: string };
      messages.posts.push(body);
      const created = message(1000 + messages.messages.length, {
        roomId,
        body,
      });
      messages.messages.push(created);
      dms.bump(roomId);
      return HttpResponse.json(
        { id: created.id, roomId, createdAt: created.createdAt },
        { status: 201 },
      );
    }),
  );
}

/**
 * 「DMを送る」ボタンのアクセシブルな名前。相手の表示名を含め（コードレビュー1回目の指摘）、見えている文字「DMを送る」をそのまま含める
 * （コードレビュー2回目の指摘。WCAG 2.5.3 Label in Name）
 */
export function dmButtonName(displayName: string): string {
  return `${displayName} さんに DMを送る`;
}

/** 「DMを送る」ボタンが無いことを確かめるときに使う。相手の名前に関係なく、どの「DMを送る」にも当たる */
export const ANY_DM_BUTTON = /DM ?を送る/;

/**
 * GET /api/auth/session の応答を止めておき、release() で返す（セッションの読み込み中＝自分のIDが未定の状態を作る）。
 * respondProfileWorld・respondShellUser の後に呼ぶ（後から足した応答が先に使われる）。
 */
export function holdSession(user: {
  id: string;
  displayName: string;
  loginId: string;
}): { release: () => void } {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.get("/api/auth/session", async () => {
      await gate;
      return HttpResponse.json({
        user,
        permissions: [],
        mustChangePassword: false,
        reauthenticatedAt: null,
      });
    }),
  );
  return { release: () => release() };
}
