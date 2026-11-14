// #134 AC-1（1-3 AC-1・AC-3・AC-4）: メッセージの API 層（features/messages/api/message-api.ts）の、編集・削除と一覧の応答の形。
// 契約（実装前の仮置き。計画 plan-134 の「1. API」「7. 一覧の応答」）：
//   一覧（fetchLatestMessages・fetchMessagesAfter）の items[] は editedAt（string|null）・deleted（真偽）を必ず持つ。
//     削除済み（deleted: true）は body: null。削除されていない（deleted: false）は body が文字列。食い違う応答は契約違反として失敗にする。
//   editMessage(messageId: string, body: string) → PATCH /api/messages/:messageId（encodeURIComponent）に { body } だけを送り、
//     応答 { id, body, editedAt（文字列） } を返す。
//   deleteMessage(messageId: string) → DELETE /api/messages/:messageId（本文なし）。204 で undefined を返す。
//   失敗は ApiError（status・code・message・fields）のまま返す（もみ消さない）。
// API は MSW。データは架空。
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import {
  EDITED_AT,
  ROOM_ID,
  apiErrorResponse,
  message,
  respondMessages,
  type TestMessage,
} from "../../../test/message-handlers";
import { server } from "../../../test/server";
import {
  deleteMessage,
  editMessage,
  fetchLatestMessages,
  fetchMessagesAfter,
} from "./message-api";

const MESSAGE_ID = message(1).id;

function respondLatestItems(items: unknown[]) {
  server.use(
    http.get("/api/rooms/:roomId/messages", () =>
      HttpResponse.json({ items, nextCursor: null, hasMore: false }),
    ),
  );
}

describe("#134 AC-1（1-3 AC-1・AC-3）一覧の応答の editedAt・deleted", () => {
  it("#134 AC-1（1-3 AC-1・AC-3）: 編集済み（editedAt あり）・削除済み（deleted 真・body null）・通常の項目を、そのまま受け取る", async () => {
    respondMessages([
      message(1, { body: "[E2E_TEST]編集した本文", editedAt: EDITED_AT }),
      message(2, { body: null, deleted: true }),
      message(3, { body: "[E2E_TEST]通常の本文" }),
    ]);
    const items = await fetchLatestMessages(ROOM_ID);
    expect(
      items.map(({ id, body, editedAt, deleted }) => ({
        id,
        body,
        editedAt,
        deleted,
      })),
    ).toEqual([
      {
        id: message(1).id,
        body: "[E2E_TEST]編集した本文",
        editedAt: EDITED_AT,
        deleted: false,
      },
      { id: message(2).id, body: null, editedAt: null, deleted: true },
      {
        id: message(3).id,
        body: "[E2E_TEST]通常の本文",
        editedAt: null,
        deleted: false,
      },
    ]);
  });

  it("#134 AC-1（1-3 AC-1）: 新着（after）の応答でも、editedAt・deleted を受け取る", async () => {
    respondMessages([message(1), message(2, { body: null, deleted: true })]);
    const page = await fetchMessagesAfter(ROOM_ID, message(1).id);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: message(2).id,
      body: null,
      deleted: true,
      editedAt: null,
    });
  });

  const base = () => {
    const item: Partial<TestMessage> = { ...message(1) };
    delete item.editedAt;
    delete item.deleted;
    return item;
  };

  it.each([
    ["editedAt がない", { ...base(), deleted: false }],
    ["deleted がない", { ...base(), editedAt: null }],
    ["editedAt が数値", { ...base(), editedAt: 1, deleted: false }],
    ["deleted が文字列", { ...base(), editedAt: null, deleted: "false" }],
    [
      "削除されていないのに body が null",
      { ...base(), body: null, editedAt: null, deleted: false },
    ],
    [
      "削除済みなのに本文がある",
      {
        ...base(),
        body: "[E2E_TEST]残っている本文",
        editedAt: null,
        deleted: true,
      },
    ],
  ])(
    "#134 AC-1（1-3 AC-1）: 項目の形が違う（%s）応答は、成功として扱わない",
    async (_label, item) => {
      respondLatestItems([item]);
      await expect(fetchLatestMessages(ROOM_ID)).rejects.toBeDefined();
    },
  );
});

describe("#134 AC-1（1-3 AC-1）editMessage", () => {
  it("#134 AC-1（1-3 AC-1）: PATCH /api/messages/:messageId に本文だけを送り、id・body・editedAt を返す", async () => {
    let sent: unknown;
    let method = "";
    let path = "";
    server.use(
      http.patch("/api/messages/:messageId", async ({ request }) => {
        method = request.method;
        path = new URL(request.url).pathname;
        sent = await request.json();
        return HttpResponse.json({
          id: MESSAGE_ID,
          body: "[E2E_TEST]新しい本文",
          editedAt: EDITED_AT,
        });
      }),
    );
    await expect(
      editMessage(MESSAGE_ID, "[E2E_TEST]新しい本文"),
    ).resolves.toEqual({
      id: MESSAGE_ID,
      body: "[E2E_TEST]新しい本文",
      editedAt: EDITED_AT,
    });
    expect(method).toBe("PATCH");
    expect(path).toBe(`/api/messages/${MESSAGE_ID}`);
    expect(sent).toEqual({ body: "[E2E_TEST]新しい本文" });
  });

  it("#134 AC-1（1-3 AC-1）: メッセージID はパスに入れるときに符号化する", async () => {
    let path = "";
    server.use(
      http.patch("/api/messages/:messageId", ({ request }) => {
        path = new URL(request.url).pathname;
        return HttpResponse.json({
          id: "a/b",
          body: "[E2E_TEST]本文",
          editedAt: EDITED_AT,
        });
      }),
    );
    await editMessage("a/b", "[E2E_TEST]本文");
    expect(path).toBe("/api/messages/a%2Fb");
  });

  it.each([
    ["editedAt がない", { id: MESSAGE_ID, body: "[E2E_TEST]本文" }],
    [
      "editedAt が null",
      { id: MESSAGE_ID, body: "[E2E_TEST]本文", editedAt: null },
    ],
    ["body がない", { id: MESSAGE_ID, editedAt: EDITED_AT }],
    ["id がない", { body: "[E2E_TEST]本文", editedAt: EDITED_AT }],
  ])(
    "#134 AC-1（1-3 AC-1）: 応答の形が違う（%s）なら成功として扱わない",
    async (_label, body) => {
      server.use(
        http.patch("/api/messages/:messageId", () => HttpResponse.json(body)),
      );
      await expect(
        editMessage(MESSAGE_ID, "[E2E_TEST]本文"),
      ).rejects.toBeDefined();
    },
  );

  it.each([
    [403, "FORBIDDEN", "このメッセージは編集できません"],
    [404, "NOT_FOUND", "メッセージが見つかりません"],
    [409, "CONFLICT", "このメッセージは削除済みです"],
  ])(
    "#134 AC-1（1-3 AC-2）: %i は ApiError（status・code・message）のまま失敗にする",
    async (status, code, text) => {
      server.use(
        http.patch("/api/messages/:messageId", () =>
          apiErrorResponse(status, code, text),
        ),
      );
      await expect(
        editMessage(MESSAGE_ID, "[E2E_TEST]本文"),
      ).rejects.toMatchObject({ status, code, message: text });
    },
  );

  it("#134 AC-1: 422 の fields を ApiError に残す", async () => {
    server.use(
      http.patch("/api/messages/:messageId", () =>
        apiErrorResponse(
          422,
          "VALIDATION_ERROR",
          "入力内容を確かめてください",
          {
            fields: ["body"],
          },
        ),
      ),
    );
    await expect(
      editMessage(MESSAGE_ID, "[E2E_TEST]本文"),
    ).rejects.toMatchObject({ status: 422, fields: ["body"] });
  });
});

describe("#134 AC-1（1-3 AC-1・AC-4）deleteMessage", () => {
  it("#134 AC-1（1-3 AC-1）: DELETE /api/messages/:messageId を本文なしで送り、204 なら成功にする", async () => {
    let method = "";
    let path = "";
    let text: string | null = null;
    server.use(
      http.delete("/api/messages/:messageId", async ({ request }) => {
        method = request.method;
        path = new URL(request.url).pathname;
        text = await request.text();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(deleteMessage(MESSAGE_ID)).resolves.toBeUndefined();
    expect(method).toBe("DELETE");
    expect(path).toBe(`/api/messages/${MESSAGE_ID}`);
    expect(text ?? "").toBe("");
  });

  it.each([
    [403, "REAUTH_REQUIRED", "再認証が必要です"],
    [403, "FORBIDDEN", "このメッセージは削除できません"],
    [404, "NOT_FOUND", "メッセージが見つかりません"],
    [409, "CONFLICT", "このメッセージは削除済みです"],
  ])(
    "#134 AC-1（1-3 AC-2・AC-4）: %i %s は ApiError のまま失敗にする",
    async (status, code, text) => {
      server.use(
        http.delete("/api/messages/:messageId", () =>
          apiErrorResponse(status, code, text),
        ),
      );
      await expect(deleteMessage(MESSAGE_ID)).rejects.toMatchObject({
        status,
        code,
        message: text,
      });
    },
  );
});
