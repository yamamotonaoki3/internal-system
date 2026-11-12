// #136 AC-1（1-2 AC-1・AC-2・AC-6）・AC-3（C-168(4)(5)）: DM の API 層（features/dms/api/dm-api.ts）。応答を Zod で検証し、失敗は ApiError のまま返す。
// 契約（実装前の仮置き。引き継ぎに明記）：
//   startDm(partnerUserId)  → POST /api/dms { partnerUserId }。応答 { roomId, partner: { id, displayName } } を返す
//   fetchDms(cursor?)       → GET /api/dms（cursor があれば付ける）。応答 { items, nextCursor } を返す
//   fetchDm(roomId)         → GET /api/dms/:roomId（roomId は encodeURIComponent）。応答 { roomId, partner, canPost } を返す
// API は MSW。データは架空。
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import {
  dmDetail,
  dmItem,
  partnerId,
  partnerName,
} from "../../../test/dm-handlers";
import { server } from "../../../test/server";
import { fetchDm, fetchDms, startDm } from "./dm-api";

const apiError = (status: number, code: string, message: string) =>
  HttpResponse.json({ code, message }, { status });

describe("#136 AC-1（1-2 AC-1）・AC-3（C-168(5)）startDm", () => {
  it("#136 AC-1（1-2 AC-1）: 相手の利用者IDだけを本文に入れて POST し、roomId と相手を返す", async () => {
    let sent: unknown;
    server.use(
      http.post("/api/dms", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({
          roomId: dmItem(1).roomId,
          partner: { id: partnerId(1), displayName: partnerName(1) },
        });
      }),
    );
    await expect(startDm(partnerId(1))).resolves.toEqual({
      roomId: dmItem(1).roomId,
      partner: { id: partnerId(1), displayName: partnerName(1) },
    });
    expect(sent).toEqual({ partnerUserId: partnerId(1) });
  });

  it.each([
    ["roomId がない", { partner: { id: partnerId(1), displayName: "x" } }],
    [
      "roomId が空",
      { roomId: "", partner: { id: partnerId(1), displayName: "x" } },
    ],
    ["partner がない", { roomId: dmItem(1).roomId }],
  ])(
    "#136 AC-1（1-2 AC-1）: 応答の形が違う（%s）なら成功として扱わない",
    async (_label, body) => {
      server.use(http.post("/api/dms", () => HttpResponse.json(body)));
      await expect(startDm(partnerId(1))).rejects.toBeDefined();
    },
  );

  it.each([
    [422, "VALIDATION_ERROR", "自分にはDMを送れません"],
    [404, "NOT_FOUND", "見つかりませんでした"],
  ])(
    "#136 AC-3（C-168(5)）: %i は ApiError（status・code・message）のまま失敗にする",
    async (status, code, message) => {
      server.use(http.post("/api/dms", () => apiError(status, code, message)));
      await expect(startDm(partnerId(1))).rejects.toMatchObject({
        status,
        code,
        message,
      });
    },
  );
});

describe("#136 AC-1（1-2 AC-5・AC-6）fetchDms", () => {
  it("#136 AC-1（1-2 AC-5）: 一覧と nextCursor を返す。相手が無効なら status は null を受け付ける。最終活動がまだない DM（lastMessageAt: null）も受け付ける", async () => {
    const body = {
      items: [
        dmItem(1),
        dmItem(2, {
          partner: {
            id: partnerId(2),
            displayName: partnerName(2),
            isActive: false,
            status: null,
          },
        }),
        dmItem(3, { lastMessageAt: null }),
      ],
      nextCursor: "c3",
    };
    server.use(http.get("/api/dms", () => HttpResponse.json(body)));
    await expect(fetchDms()).resolves.toEqual(body);
  });

  it("#136 AC-1（1-2 AC-5）: cursor を渡すと、そのままクエリに付ける。渡さなければ付けない", async () => {
    const cursors: (string | null)[] = [];
    server.use(
      http.get("/api/dms", ({ request }) => {
        cursors.push(new URL(request.url).searchParams.get("cursor"));
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    await fetchDms();
    await fetchDms("c20");
    expect(cursors).toEqual([null, "c20"]);
  });

  it.each([
    ["items がない", { nextCursor: null }],
    [
      "isActive がない",
      {
        items: [
          {
            ...dmItem(1),
            partner: { id: partnerId(1), displayName: "x", status: null },
          },
        ],
        nextCursor: null,
      },
    ],
    [
      "status の種類が不明",
      {
        items: [
          {
            ...dmItem(1),
            partner: {
              id: partnerId(1),
              displayName: "x",
              isActive: true,
              status: { kind: "unknown", returnAt: null },
            },
          },
        ],
        nextCursor: null,
      },
    ],
  ])(
    "#136 AC-1（1-2 AC-5）: 応答の形が違う（%s）なら、空の一覧として扱わず失敗にする",
    async (_label, body) => {
      server.use(http.get("/api/dms", () => HttpResponse.json(body)));
      await expect(fetchDms()).rejects.toBeDefined();
    },
  );

  it("#136 AC-1（1-2 AC-5）: 500 は ApiError のまま失敗にする（空の一覧にしない）", async () => {
    server.use(
      http.get("/api/dms", () =>
        apiError(500, "INTERNAL", "一時的なエラーが発生しました"),
      ),
    );
    await expect(fetchDms()).rejects.toMatchObject({
      status: 500,
      code: "INTERNAL",
    });
  });
});

describe("#136 AC-1（1-2 AC-2・AC-6）・AC-2（6-1 AC-1）・AC-3（C-168(4)）fetchDm", () => {
  it("#136 AC-2（6-1 AC-1）: 相手の表示名・部署・有効か・ステータス（戻り予定・一言）と canPost を返す", async () => {
    const body = dmDetail(1, {
      partner: {
        status: {
          kind: "away",
          returnAt: "2026-11-12T06:00:00.000Z",
          message: "[E2E_TEST]外出中",
        },
      },
    });
    server.use(http.get("/api/dms/:roomId", () => HttpResponse.json(body)));
    await expect(fetchDm(body.roomId)).resolves.toEqual(body);
  });

  it("#136 AC-1（1-2 AC-6）: 相手が無効（isActive: false・status: null・canPost: false）も受け付ける。部署なし（null）も受け付ける", async () => {
    const body = dmDetail(1, {
      partner: { isActive: false, status: null, department: null },
      canPost: false,
    });
    server.use(http.get("/api/dms/:roomId", () => HttpResponse.json(body)));
    await expect(fetchDm(body.roomId)).resolves.toEqual(body);
  });

  it("#136 AC-1（1-2 AC-2）: roomId はパスとして符号化して送る", async () => {
    let path = "";
    server.use(
      http.get("/api/dms/:roomId", ({ request }) => {
        path = new URL(request.url).pathname;
        return HttpResponse.json(dmDetail(1));
      }),
    );
    await fetchDm("a/b?c");
    expect(path).toBe("/api/dms/a%2Fb%3Fc");
  });

  it.each([
    [
      "canPost がない",
      { roomId: dmItem(1).roomId, partner: dmDetail(1).partner },
    ],
    [
      "partner の isActive が文字列",
      { ...dmDetail(1), partner: { ...dmDetail(1).partner, isActive: "true" } },
    ],
  ])(
    "#136 AC-3（C-168(4)）: 応答の形が違う（%s）なら成功として扱わない",
    async (_label, body) => {
      server.use(http.get("/api/dms/:roomId", () => HttpResponse.json(body)));
      await expect(fetchDm(dmItem(1).roomId)).rejects.toBeDefined();
    },
  );

  it("#136 AC-1（1-2 AC-2）: 当事者でない（404）は ApiError のまま失敗にする", async () => {
    server.use(
      http.get("/api/dms/:roomId", () =>
        apiError(404, "NOT_FOUND", "見つかりませんでした"),
      ),
    );
    await expect(fetchDm(dmItem(1).roomId)).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
  });
});
