// #137 AC-1（1-4 AC-1・AC-2・AC-3）: メッセージの API 層（message-api.ts）の、スレッドの項目（parentMessageId・replyCount）と返信の取得・投稿。
// 契約（実装前の仮置き。計画 plan-137 の「3. EP-1-01」「5. EP-1-07」）：
//   部屋の一覧（fetchLatestMessages・fetchMessagesAfter）の items[] は parentMessageId（常に null）・replyCount（0以上の整数）を必ず持つ。
//     parentMessageId が文字列（返信が混ざった）・replyCount がない・負・小数の応答は、契約違反として失敗にする。
//   fetchLatestReplies(parentMessageId) → GET /api/messages/:id/replies（encodeURIComponent）。応答の items は新しい順 → ID昇順に直し、
//     { parent, items, replyBlockedReason } を返す。items の parentMessageId は文字列（親のID）。parent は親の1件（一覧の項目と同じ形）。
//   fetchRepliesAfter(parentMessageId, after) → ?after=。{ parent, items（昇順）, hasMore, replyBlockedReason } を返す。
//   replyBlockedReason は null か "deleted_parent"・"not_joined"・"read_only"・"partner_inactive" のどれか。それ以外の値は契約違反として失敗にする。
//   postReply(parentMessageId, body) → POST /api/messages/:id/replies に { body, mentions: [] } を送り、201 の { id, parentMessageId, createdAt } を返す。
//   失敗は ApiError（status・code・message）のまま返す（もみ消さない）。
// API は MSW。データは架空。
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import {
  ROOM_ID,
  apiErrorResponse,
  message,
  reply,
  respondMessages,
  respondReplies,
} from "../../../test/message-handlers";
import { server } from "../../../test/server";
import {
  fetchLatestMessages,
  fetchLatestReplies,
  fetchMessagesAfter,
  fetchRepliesAfter,
  postReply,
} from "./message-api";

const PARENT = message(1, { replyCount: 2 });

describe("#137 AC-1（1-4 AC-1）部屋の一覧の parentMessageId・replyCount", () => {
  it("#137 AC-1: 親の投稿の replyCount（削除済みの親も）と、常に null の parentMessageId をそのまま受け取る", async () => {
    respondMessages([
      message(1, { replyCount: 3 }),
      message(2, { body: null, deleted: true, replyCount: 1 }),
      message(3),
    ]);
    const items = await fetchLatestMessages(ROOM_ID);
    expect(
      items.map(({ id, parentMessageId, replyCount }) => ({
        id,
        parentMessageId,
        replyCount,
      })),
    ).toEqual([
      { id: message(1).id, parentMessageId: null, replyCount: 3 },
      { id: message(2).id, parentMessageId: null, replyCount: 1 },
      { id: message(3).id, parentMessageId: null, replyCount: 0 },
    ]);
    const page = await fetchMessagesAfter(ROOM_ID, "00000");
    expect(page.items[0]?.replyCount).toBe(3);
  });

  it.each([
    ["replyCount がない", { replyCount: undefined }],
    ["replyCount が負", { replyCount: -1 }],
    ["replyCount が小数", { replyCount: 1.5 }],
    ["replyCount が文字列", { replyCount: "1" }],
    ["parentMessageId がない", { parentMessageId: undefined }],
    [
      "parentMessageId が文字列（返信が部屋の一覧に混ざった）",
      { parentMessageId: "01JTESTMSG0000000000000009" },
    ],
  ])(
    "#137 AC-1: %s の応答は契約違反として失敗にする",
    async (_label, patch) => {
      server.use(
        http.get("/api/rooms/:roomId/messages", () =>
          HttpResponse.json({
            items: [{ ...message(1), ...patch }],
            nextCursor: null,
            hasMore: false,
          }),
        ),
      );
      await expect(fetchLatestMessages(ROOM_ID)).rejects.toBeDefined();
      await expect(fetchMessagesAfter(ROOM_ID, "0")).rejects.toBeDefined();
    },
  );
});

describe("#137 AC-1（1-4 AC-1）返信の応答の joined（今参加しているか）", () => {
  it.each([true, false])(
    "#137 AC-1: joined が %s の応答を、そのまま受け取る（fetchLatestReplies・fetchRepliesAfter）",
    async (joined) => {
      respondReplies({
        parent: PARENT,
        replies: [reply(PARENT, 1)],
        replyBlockedReason: joined ? null : "not_joined",
        caseRoom: false,
        joined,
      });
      expect((await fetchLatestReplies(PARENT.id)).joined).toBe(joined);
      expect(
        (await fetchRepliesAfter(PARENT.id, reply(PARENT, 1).id)).joined,
      ).toBe(joined);
    },
  );

  it.each([
    ["ない", undefined],
    ["文字列", "true"],
    ["null", null],
  ])(
    "#137 AC-1: joined が%sの応答は契約違反として失敗にする",
    async (_label, joined) => {
      server.use(
        http.get("/api/messages/:messageId/replies", () =>
          HttpResponse.json({
            items: [],
            nextCursor: null,
            hasMore: false,
            parent: PARENT,
            replyBlockedReason: null,
            caseRoom: false,
            caseId: null,
            joined,
            roomWritable: true,
          }),
        ),
      );
      await expect(fetchLatestReplies(PARENT.id)).rejects.toBeDefined();
      await expect(fetchRepliesAfter(PARENT.id, "0")).rejects.toBeDefined();
    },
  );
});

describe("#137 AC-1（1-4 AC-1）返信の応答の roomWritable（部屋に今書き込めるか）", () => {
  it.each([true, false])(
    "#137 AC-1: roomWritable が %s の応答を、そのまま受け取る（fetchLatestReplies・fetchRepliesAfter）",
    async (roomWritable) => {
      respondReplies({
        parent: PARENT,
        replies: [reply(PARENT, 1)],
        roomWritable,
      });
      expect((await fetchLatestReplies(PARENT.id)).roomWritable).toBe(
        roomWritable,
      );
      expect(
        (await fetchRepliesAfter(PARENT.id, reply(PARENT, 1).id)).roomWritable,
      ).toBe(roomWritable);
    },
  );

  it.each([
    ["ない", undefined],
    ["文字列", "true"],
    ["null", null],
  ])(
    "#137 AC-1: roomWritable が%sの応答は契約違反として失敗にする",
    async (_label, roomWritable) => {
      server.use(
        http.get("/api/messages/:messageId/replies", () =>
          HttpResponse.json({
            items: [],
            nextCursor: null,
            hasMore: false,
            parent: PARENT,
            replyBlockedReason: null,
            caseRoom: false,
            caseId: null,
            joined: true,
            roomWritable,
          }),
        ),
      );
      await expect(fetchLatestReplies(PARENT.id)).rejects.toBeDefined();
      await expect(fetchRepliesAfter(PARENT.id, "0")).rejects.toBeDefined();
    },
  );
});

describe("#137 AC-1（1-4 AC-1・AC-3）返信の取得", () => {
  it("#137 AC-1: fetchLatestReplies は、新しい順の応答を昇順に直し、親と返信できる理由を返す", async () => {
    respondReplies({
      parent: PARENT,
      replies: [reply(PARENT, 1), reply(PARENT, 2)],
      replyBlockedReason: "read_only",
      caseRoom: false,
    });
    const result = await fetchLatestReplies(PARENT.id);
    expect(result.items.map((m) => m.id)).toEqual([
      reply(PARENT, 1).id,
      reply(PARENT, 2).id,
    ]);
    expect(result.items.every((m) => m.parentMessageId === PARENT.id)).toBe(
      true,
    );
    expect(result.parent.id).toBe(PARENT.id);
    expect(result.parent.parentMessageId).toBeNull();
    expect(result.parent.replyCount).toBe(2);
    expect(result.replyBlockedReason).toBe("read_only");
  });

  it("#137 AC-2: 親が削除済み（body なし・deleted 真）でも受け取り、理由 deleted_parent を返す", async () => {
    respondReplies({
      parent: { ...PARENT, deleted: true, body: null },
      replies: [reply(PARENT, 1)],
      replyBlockedReason: "deleted_parent",
      caseRoom: false,
    });
    const result = await fetchLatestReplies(PARENT.id);
    expect(result.parent.deleted).toBe(true);
    expect(result.parent.body).toBeNull();
    expect(result.replyBlockedReason).toBe("deleted_parent");
    expect(result.items).toHaveLength(1);
  });

  it("#137 AC-1: fetchRepliesAfter は after を付け、続き（hasMore）も返す", async () => {
    const state = respondReplies(
      {
        parent: PARENT,
        replies: [reply(PARENT, 1), reply(PARENT, 2), reply(PARENT, 3)],
      },
      { afterPageSize: 1 },
    );
    const page = await fetchRepliesAfter(PARENT.id, reply(PARENT, 1).id);
    expect(state.requests.at(-1)?.searchParams.get("after")).toBe(
      reply(PARENT, 1).id,
    );
    expect(page.items.map((m) => m.id)).toEqual([reply(PARENT, 2).id]);
    expect(page.hasMore).toBe(true);
    expect(page.replyBlockedReason).toBeNull();
  });

  it("#137 AC-1: 親の ID はパスとして安全に組み立てる（encodeURIComponent）", async () => {
    let seenPath = "";
    server.use(
      http.get("/api/messages/:messageId/replies", ({ request }) => {
        seenPath = new URL(request.url).pathname;
        return apiErrorResponse(404, "NOT_FOUND");
      }),
    );
    await expect(fetchLatestReplies("a/b c")).rejects.toMatchObject({
      status: 404,
    });
    expect(seenPath).toBe("/api/messages/a%2Fb%20c/replies");
  });

  it.each(["unknown_reason", "", 1])(
    "#137 AC-1: 知らない replyBlockedReason（%j）は契約違反として失敗にする",
    async (value) => {
      server.use(
        http.get("/api/messages/:messageId/replies", () =>
          HttpResponse.json({
            items: [],
            nextCursor: null,
            hasMore: false,
            parent: PARENT,
            replyBlockedReason: value,
            caseRoom: false,
            caseId: null,
            // #339：ほかの必須項目をそろえ、理由の値だけで失敗することを確かめる
            joined: true,
            roomWritable: true,
          }),
        ),
      );
      await expect(fetchLatestReplies(PARENT.id)).rejects.toBeDefined();
    },
  );

  it("#137 AC-1: 404 などの失敗は ApiError のまま返す（もみ消さない）", async () => {
    server.use(
      http.get("/api/messages/:messageId/replies", () =>
        apiErrorResponse(404, "NOT_FOUND", "見つかりません"),
      ),
    );
    await expect(fetchLatestReplies(PARENT.id)).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
  });
});

describe("#137 AC-1（1-4 AC-1・AC-2）返信の投稿", () => {
  it("#137 AC-1・#139 3-2 AC-1: body と空の指名を送り、201 の id・parentMessageId・createdAt を返す", async () => {
    const state = respondReplies({ parent: PARENT });
    let sent: unknown;
    const listener = async ({ request }: { request: Request }) => {
      if (request.method === "POST") sent = await request.clone().json();
    };
    server.events.on("request:start", listener);
    const created = await postReply(PARENT.id, "[E2E_TEST]返信の本文");
    expect(created.parentMessageId).toBe(PARENT.id);
    expect(created.id).toBeTruthy();
    expect(created.createdAt).toBeTruthy();
    expect(state.posts).toEqual(["[E2E_TEST]返信の本文"]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sent).toEqual({ body: "[E2E_TEST]返信の本文", mentions: [] });
    server.events.removeListener("request:start", listener);
  });

  it("#137 AC-2: 削除された親への返信（409）は、ApiError のまま返す", async () => {
    const state = respondReplies({ parent: PARENT });
    state.failNextPost = { status: 409, code: "CONFLICT" };
    await expect(
      postReply(PARENT.id, "[E2E_TEST]遅れた返信"),
    ).rejects.toMatchObject({ status: 409, code: "CONFLICT" });
  });
});

// #339 AC-1（計画 plan-339 の 2 節・5 節「成功応答のcaseIdを検証する」）：返信の最新・追加取得の成功応答の caseId を検証して受け取る。
// 案件の部屋なら案件の ID、通常のチャンネル・DM は null。欠落・型違いは契約違反。エラー応答（403・404）には caseId を求めない。
// 前提にした口（実装の担当へ）：fetchLatestReplies・fetchRepliesAfter の戻り値（ThreadRepliesPage・ThreadRepliesAfterPage）に caseId: string | null を足す。
describe("#339 AC-1 返信の成功応答の caseId", () => {
  const CASE_ID = "01JTESTCASE339000000000MA1";

  it.each([
    ["案件の部屋", CASE_ID],
    ["通常のチャンネル・DM", null],
  ])(
    "#339 AC-1: 成功応答のcaseIdを検証する：%sの caseId を、最新の取得（fetchLatestReplies）と追加の取得（fetchRepliesAfter）の両方で受け取る",
    async (_label, caseId) => {
      respondReplies({
        parent: PARENT,
        replies: [reply(PARENT, 1)],
        caseRoom: caseId !== null,
        caseId,
      });
      expect((await fetchLatestReplies(PARENT.id)).caseId).toBe(caseId);
      const after = await fetchRepliesAfter(PARENT.id, reply(PARENT, 1).id);
      expect(after.items).toEqual([]);
      expect(after.caseId).toBe(caseId);
    },
  );

  it.each([
    ["欠落", undefined],
    ["数値", 339],
    ["真偽値", false],
    ["オブジェクト", { id: CASE_ID }],
  ])(
    "#339 AC-1: 成功応答のcaseIdを検証する：caseId が%sの応答は、最新・追加の取得とも契約違反として失敗にする",
    async (_label, caseId) => {
      server.use(
        http.get("/api/messages/:messageId/replies", () =>
          HttpResponse.json({
            items: [],
            nextCursor: null,
            hasMore: false,
            parent: PARENT,
            replyBlockedReason: null,
            caseRoom: true,
            caseId,
            joined: true,
            roomWritable: true,
          }),
        ),
      );
      await expect(fetchLatestReplies(PARENT.id)).rejects.toBeDefined();
      await expect(fetchRepliesAfter(PARENT.id, "0")).rejects.toBeDefined();
    },
  );

  it("#339 AC-1: 404 のエラー応答に caseId が無くても、ApiError のまま返す（エラー応答の形は変えない）", async () => {
    server.use(
      http.get("/api/messages/:messageId/replies", () =>
        apiErrorResponse(404, "NOT_FOUND", "見つかりません"),
      ),
    );
    await expect(fetchLatestReplies(PARENT.id)).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
    await expect(fetchRepliesAfter(PARENT.id, "0")).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
  });
});
