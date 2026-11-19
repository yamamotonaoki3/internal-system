// #138 AC-1（1-7 AC-1〜AC-3）: メッセージの API 層（message-api.ts）の、リアクションの付け外しと、一覧の項目の reactions。
// 契約（計画「API」「frontend」）：
//   addReaction(messageId, { kind, value }) → POST /api/messages/:messageId/reactions（messageId は encodeURIComponent）に { kind, value } だけを送り、
//     応答 { messageId, reactions } を返す。
//   removeReaction(messageId, kind, value) → DELETE /api/messages/:messageId/reactions/:kind/:value（messageId・kind・value をそれぞれ encodeURIComponent。本文なし）。応答は同じ形。
//   応答は zod で検査する。reactions は必須（項目がない・形が違う応答は、契約違反として失敗にする）。Reaction は { kind: "emoji"|"stamp", value, count（0以上の整数）, reactedByMe（真偽）, users: { id, displayName, isActive }[] }。
//   一覧（fetchLatestMessages・fetchMessagesAfter・fetchLatestReplies・fetchRepliesAfter）の items[] と parent は reactions を必ず持つ（必須。任意にしない）。
//   失敗は ApiError（status・code・message）のまま返す（もみ消さない）。
// API は MSW。データは架空。
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import {
  ROOM_ID,
  apiErrorResponse,
  message,
  reply,
  respondReplies,
} from "../../../test/message-handlers";
import { reaction, reactor } from "../../../test/reaction-handlers";
import { server } from "../../../test/server";
import {
  addReaction,
  fetchLatestMessages,
  fetchLatestReplies,
  fetchMessagesAfter,
  fetchRepliesAfter,
  removeReaction,
} from "./message-api";

const MESSAGE_ID = message(1).id;
const REACTIONS = [
  reaction("emoji", "👍", { others: [reactor(1)], mine: true }),
];

describe("#138 AC-1（1-7 AC-1）addReaction", () => {
  it("#138 AC-1: POST /api/messages/:messageId/reactions に { kind, value } だけを送り、{ messageId, reactions } を返す", async () => {
    let sent: unknown;
    let method = "";
    let path = "";
    server.use(
      http.post("/api/messages/:messageId/reactions", async ({ request }) => {
        method = request.method;
        path = new URL(request.url).pathname;
        sent = await request.json();
        return HttpResponse.json({
          messageId: MESSAGE_ID,
          reactions: REACTIONS,
        });
      }),
    );
    await expect(
      addReaction(MESSAGE_ID, { kind: "emoji", value: "👍" }),
    ).resolves.toEqual({ messageId: MESSAGE_ID, reactions: REACTIONS });
    expect(method).toBe("POST");
    expect(path).toBe(`/api/messages/${MESSAGE_ID}/reactions`);
    expect(sent).toEqual({ kind: "emoji", value: "👍" });
  });

  it("#138 AC-1: メッセージ ID はパスに入れるときに符号化する", async () => {
    let path = "";
    server.use(
      http.post("/api/messages/:messageId/reactions", ({ request }) => {
        path = new URL(request.url).pathname;
        return HttpResponse.json({ messageId: "a/b", reactions: [] });
      }),
    );
    await addReaction("a/b", { kind: "stamp", value: "ok" });
    expect(path).toBe("/api/messages/a%2Fb/reactions");
  });

  it("#138 AC-1（上限）: 409 などの拒否は ApiError のまま失敗にする（もみ消さない・成功に見せない）", async () => {
    server.use(
      http.post("/api/messages/:messageId/reactions", () =>
        apiErrorResponse(409, "CONFLICT", "リアクションは20種類までです"),
      ),
    );
    await expect(
      addReaction(MESSAGE_ID, { kind: "emoji", value: "👍" }),
    ).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
      message: "リアクションは20種類までです",
    });
  });
});

describe("#138 AC-1（1-7 AC-3）removeReaction", () => {
  it("#138 AC-1: DELETE /api/messages/:messageId/reactions/:kind/:value に本文なしで送り、絵文字の value は符号化する", async () => {
    let method = "";
    let path = "";
    let text = "?";
    server.use(
      http.delete(
        "/api/messages/:messageId/reactions/:kind/:value",
        async ({ request }) => {
          method = request.method;
          path = new URL(request.url).pathname;
          text = await request.text();
          return HttpResponse.json({ messageId: MESSAGE_ID, reactions: [] });
        },
      ),
    );
    await expect(removeReaction(MESSAGE_ID, "emoji", "👍")).resolves.toEqual({
      messageId: MESSAGE_ID,
      reactions: [],
    });
    expect(method).toBe("DELETE");
    expect(path).toBe(
      `/api/messages/${MESSAGE_ID}/reactions/emoji/${encodeURIComponent("👍")}`,
    );
    expect(path).toContain("%F0%9F%91%8D");
    expect(text).toBe("");
  });

  it("#138 AC-1: スタンプの id（ハイフンを含む good-work）はそのまま、異体字セレクタつきの絵文字は符号化して送る", async () => {
    const paths: string[] = [];
    server.use(
      http.delete(
        "/api/messages/:messageId/reactions/:kind/:value",
        ({ request }) => {
          paths.push(new URL(request.url).pathname);
          return HttpResponse.json({ messageId: MESSAGE_ID, reactions: [] });
        },
      ),
    );
    await removeReaction(MESSAGE_ID, "stamp", "good-work");
    await removeReaction(MESSAGE_ID, "emoji", "❤️");
    expect(paths).toEqual([
      `/api/messages/${MESSAGE_ID}/reactions/stamp/good-work`,
      `/api/messages/${MESSAGE_ID}/reactions/emoji/${encodeURIComponent("❤️")}`,
    ]);
  });

  it("#138 AC-1: 403・404 の拒否は ApiError のまま失敗にする", async () => {
    server.use(
      http.delete("/api/messages/:messageId/reactions/:kind/:value", () =>
        apiErrorResponse(
          403,
          "FORBIDDEN",
          "このチャンネルには参加していません",
        ),
      ),
    );
    await expect(
      removeReaction(MESSAGE_ID, "emoji", "👍"),
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });
});

describe("#138 AC-1 応答の検査（zod）", () => {
  const first = REACTIONS[0];
  const bad: [string, Record<string, unknown>][] = [
    ["reactions がない", { messageId: MESSAGE_ID }],
    ["messageId がない", { reactions: [] }],
    ["reactions が配列でない", { messageId: MESSAGE_ID, reactions: {} }],
    [
      "kind が emoji・stamp 以外",
      { messageId: MESSAGE_ID, reactions: [{ ...first, kind: "sticker" }] },
    ],
    [
      "count が負",
      { messageId: MESSAGE_ID, reactions: [{ ...first, count: -1 }] },
    ],
    [
      "count が小数",
      { messageId: MESSAGE_ID, reactions: [{ ...first, count: 1.5 }] },
    ],
    [
      "reactedByMe が文字列",
      { messageId: MESSAGE_ID, reactions: [{ ...first, reactedByMe: "true" }] },
    ],
    [
      "users がない",
      { messageId: MESSAGE_ID, reactions: [{ ...first, users: undefined }] },
    ],
    [
      "users の isActive がない",
      {
        messageId: MESSAGE_ID,
        reactions: [
          {
            ...first,
            users: [{ id: "01JTESTUSER00000000000R001", displayName: "x" }],
          },
        ],
      },
    ],
    [
      "value が空",
      { messageId: MESSAGE_ID, reactions: [{ ...first, value: "" }] },
    ],
  ];

  it.each(bad)(
    "#138 AC-1: %s の応答は契約違反として失敗にする（POST・DELETE とも）",
    async (_label, body) => {
      server.use(
        http.post("/api/messages/:messageId/reactions", () =>
          HttpResponse.json(body),
        ),
        http.delete("/api/messages/:messageId/reactions/:kind/:value", () =>
          HttpResponse.json(body),
        ),
      );
      await expect(
        addReaction(MESSAGE_ID, { kind: "emoji", value: "👍" }),
      ).rejects.toBeDefined();
      await expect(
        removeReaction(MESSAGE_ID, "emoji", "👍"),
      ).rejects.toBeDefined();
    },
  );
});

describe("#138 AC-1（1-7 AC-5）一覧の項目の reactions", () => {
  it("#138 AC-1: 部屋の一覧（最新・after）の項目の reactions をそのまま受け取る（付いていない項目は空配列）", async () => {
    server.use(
      http.get("/api/rooms/:roomId/messages", () =>
        HttpResponse.json({
          items: [message(2), message(1, { reactions: REACTIONS })],
          nextCursor: null,
          hasMore: false,
        }),
      ),
    );
    const latest = await fetchLatestMessages(ROOM_ID);
    // 最新の一覧は、新しい順の応答を ID 昇順に直して返す
    expect(latest.map((m) => m.reactions)).toEqual([REACTIONS, []]);
    const after = await fetchMessagesAfter(ROOM_ID, "0");
    expect(after.items.map((m) => m.reactions)).toEqual([[], REACTIONS]);
  });

  it("#138 AC-1: 返信の取得（最新・after）で、親と返信の reactions を受け取る", async () => {
    const parent = message(1, { reactions: REACTIONS });
    const first = reply(parent, 1, { reactions: REACTIONS });
    respondReplies({ parent, replies: [first] });
    const latest = await fetchLatestReplies(parent.id);
    expect(latest.parent.reactions).toEqual(REACTIONS);
    expect(latest.items[0]?.reactions).toEqual(REACTIONS);
    const after = await fetchRepliesAfter(parent.id, "0");
    expect(after.parent.reactions).toEqual(REACTIONS);
    expect(after.items[0]?.reactions).toEqual(REACTIONS);
  });

  it.each([
    ["reactions がない", undefined],
    ["reactions が配列でない", {}],
    ["reactions の項目の kind が不正", [{ ...REACTIONS[0], kind: "sticker" }]],
    ["reactions の項目の count が負", [{ ...REACTIONS[0], count: -1 }]],
  ])(
    "#138 AC-1（必須）: 部屋の一覧の項目で %s の応答は、契約違反として失敗にする",
    async (_label, reactions) => {
      server.use(
        http.get("/api/rooms/:roomId/messages", () =>
          HttpResponse.json({
            items: [{ ...message(1), reactions }],
            nextCursor: null,
            hasMore: false,
          }),
        ),
      );
      await expect(fetchLatestMessages(ROOM_ID)).rejects.toBeDefined();
      await expect(fetchMessagesAfter(ROOM_ID, "0")).rejects.toBeDefined();
    },
  );

  it("#138 AC-1（必須）: 返信の取得で、親の reactions がない応答は失敗にする", async () => {
    const parent = message(1);
    server.use(
      http.get("/api/messages/:messageId/replies", () =>
        HttpResponse.json({
          items: [],
          nextCursor: null,
          hasMore: false,
          parent: { ...parent, reactions: undefined },
          replyBlockedReason: null,
          caseRoom: false,
          joined: true,
          roomWritable: true,
        }),
      ),
    );
    await expect(fetchLatestReplies(parent.id)).rejects.toBeDefined();
    await expect(fetchRepliesAfter(parent.id, "0")).rejects.toBeDefined();
  });
});
