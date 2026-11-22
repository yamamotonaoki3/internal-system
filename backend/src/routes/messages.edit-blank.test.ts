// #270（270-B）AC-5・利用者の決定3・4：添付のある投稿を、編集で本文を空にする（EP-1-03 PATCH /api/messages/:messageId）。
// 実際のアプリ入口（index.ts の app）と隔離 D1 で確かめる（結合）。
// 期待の根拠（実装から写さない）：
//   決定3：削除されていない添付が1件以上ある投稿・返信は、編集で本文を空にできる（200、body は空文字。DB は目印）
//   計画 AC-5：添付がない（すべて削除済みを含む）ときは 422（VALIDATION_ERROR・「メッセージを入力してください」・fields: body）。本文のない投稿に本文を足す編集もできる
//   決定4（C-171(2) の一部の置き換え）：空の本文の編集は、他人の投稿は 403、存在しない・見えない投稿は 404 が、422 より先
//   計画 2.6b：判定の順は Controller（長さの上限・余分な項目・指名の範囲は 422 のまま先）→ ①〜⑤（404・403・409）→ 本文の空と添付（422）→ 指名（422）→ 書き込み
//   計画 2.2 の2：編集の応答の body は、空白だけで送られても空文字
// データは架空（testuser_editblank_、[UNIT_TEST]）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markAttachmentDeleted } from "../../test/attachment-delete-fixtures";
import {
  cleanupAttachmentScenario,
  insertAttachmentRow,
} from "../../test/attachment-fixtures";
import {
  BLANK_BODY_MESSAGE,
  STORED_EMPTY_BODY,
  cleanupAttachmentOnlyLeftovers,
  insertBodylessMessage,
} from "../../test/attachment-only-fixtures";
import {
  TEST_TAG,
  insertChannel,
  insertDepartmentWithChannels,
  insertMember,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { insertMessage, ulidAt } from "../../test/message-fixtures";
import {
  editMessage,
  insertModifyUser,
  listedItem,
  markDeleted,
  messageRow,
  type ModifyUser,
} from "../../test/message-modify-fixtures";
import { testId } from "../../test/role-fixtures";
import { cleanupSearchIndex } from "../../test/search-fixtures";

const ORIGINAL = `${TEST_TAG}空にする前の本文`;
const ADDED = `${TEST_TAG}足した本文`;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let dept: SeededDepartment;
let author: ModifyUser;
let other: ModifyUser;
let room: string;
let seq = 0;

const nextId = () => {
  seq += 1;
  return ulidAt(1_896_000_000_000 + seq * 1_000);
};

/** 投稿（本文あり）と、結び付いた添付 count 件を入れる */
async function seedPost(
  options: {
    count?: number;
    senderId?: string;
    roomId?: string;
    body?: string;
    parentMessageId?: string;
  } = {},
) {
  const id = nextId();
  const senderId = options.senderId ?? author.userId;
  const roomId = options.roomId ?? room;
  await insertMessage({
    roomId,
    senderId,
    id,
    body: options.body ?? ORIGINAL,
    ...(options.parentMessageId === undefined
      ? {}
      : { parentMessageId: options.parentMessageId }),
  });
  const attachments: string[] = [];
  for (let i = 0; i < (options.count ?? 1); i += 1)
    attachments.push(
      await insertAttachmentRow({
        roomId,
        uploaderId: senderId,
        messageId: id,
        threadParentId: options.parentMessageId ?? null,
        originalName: `[UNIT_TEST]編集の添付${seq}-${i}.txt`,
      }),
    );
  return { id, attachments };
}

type ErrorBody = { code: string; message: string; fields?: string[] };

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  dept = await insertDepartmentWithChannels("空の編集");
  author = await insertModifyUser("testuser_editblank_author", dept.id);
  other = await insertModifyUser("testuser_editblank_other", dept.id);
  room = await insertChannel({
    name: `${TEST_TAG}空の編集の部屋`,
    purpose: "normal",
    departmentId: dept.id,
  });
  await insertMember(room, author.userId);
  await insertMember(room, other.userId);
});

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await cleanupAttachmentOnlyLeftovers();
    await cleanupSearchIndex();
  } finally {
    await cleanupAttachmentScenario();
  }
});

describe("#270 AC-5（決定3）添付のある投稿は、本文を空にできる", () => {
  it("#270 AC-5: 添付1件の自分の投稿を空文字に編集すると 200 { id, body: '', editedAt, mentions: [] }。DB の本文は目印、edited_at が付く", async () => {
    const { id } = await seedPost();
    const response = await editMessage(id, { body: "" }, author.token);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      id,
      body: "",
      editedAt: expect.stringMatching(ISO),
      mentions: [],
    });
    const row = await messageRow(id);
    expect(row?.body).toBe(STORED_EMPTY_BODY);
    expect(row?.edited_at).toBe(body.editedAt);
  });

  it("#270 AC-5（計画 2.2 の2）: 空白と改行だけで編集しても、応答の body は空文字で、DB は目印1文字", async () => {
    const { id } = await seedPost();
    const response = await editMessage(id, { body: "  \n　" }, author.token);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { body: string }).body).toBe("");
    expect((await messageRow(id))?.body).toBe(STORED_EMPTY_BODY);
  });

  it("#270 AC-5・AC-4: 空にした後、ほかの参加者の一覧の body は空文字で、editedAt が出る", async () => {
    const { id } = await seedPost();
    const { editedAt } = (await (
      await editMessage(id, { body: "" }, author.token)
    ).json()) as { editedAt: string };
    expect(await listedItem(room, id, other.token)).toMatchObject({
      id,
      body: "",
      editedAt,
      deleted: false,
    });
  });

  it("#270 AC-5: 添付2件のうち1件が削除済みでも、見える添付が1件あれば空にできる（200）", async () => {
    const { id, attachments } = await seedPost({ count: 2 });
    await markAttachmentDeleted(attachments[0] ?? "", author.userId);
    expect((await editMessage(id, { body: "" }, author.token)).status).toBe(
      200,
    );
  });

  it("#270 AC-5: 返信（添付1件）も空にできる（200）", async () => {
    const parent = await seedPost({ count: 0, senderId: other.userId });
    const replied = await seedPost({ parentMessageId: parent.id });
    const response = await editMessage(replied.id, { body: "" }, author.token);
    expect(response.status).toBe(200);
    expect((await messageRow(replied.id))?.body).toBe(STORED_EMPTY_BODY);
  });

  it("#270 AC-5: 本文のない投稿（目印・添付1件）に本文を足す編集は 200 で、その本文を保存して返す", async () => {
    const id = nextId();
    await insertBodylessMessage({ roomId: room, senderId: author.userId, id });
    await insertAttachmentRow({
      roomId: room,
      uploaderId: author.userId,
      messageId: id,
    });
    const response = await editMessage(id, { body: ADDED }, author.token);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { body: string }).body).toBe(ADDED);
    expect((await messageRow(id))?.body).toBe(ADDED);
  });

  it("#270 AC-5: 本文のない投稿（添付1件）を、もう一度空で編集しても 200（目印のまま）", async () => {
    const id = nextId();
    await insertBodylessMessage({ roomId: room, senderId: author.userId, id });
    await insertAttachmentRow({
      roomId: room,
      uploaderId: author.userId,
      messageId: id,
    });
    expect((await editMessage(id, { body: "" }, author.token)).status).toBe(
      200,
    );
    expect((await messageRow(id))?.body).toBe(STORED_EMPTY_BODY);
  });
});

describe("#270 AC-5 添付がない投稿は、空にできない（422）", () => {
  it.each([
    ["添付がない", 0, false],
    ["添付1件が削除済み", 1, true],
  ] as const)(
    "#270 AC-5: %s 自分の投稿を空にする編集は 422 VALIDATION_ERROR（fields: body・文はいまの「メッセージを入力してください」）で、本文も edited_at も変わらない",
    async (_label, count, markAll) => {
      const { id, attachments } = await seedPost({ count });
      if (markAll)
        for (const attachment of attachments)
          await markAttachmentDeleted(attachment, author.userId);
      const response = await editMessage(id, { body: "" }, author.token);
      expect(response.status).toBe(422);
      const error = (await response.json()) as ErrorBody;
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.message).toBe(BLANK_BODY_MESSAGE);
      expect(error.fields).toContain("body");
      expect(await messageRow(id)).toMatchObject({
        body: ORIGINAL,
        edited_at: null,
      });
    },
  );

  it("#270 AC-5: 本文のない投稿で、見える添付がない（例外の状態）ものは、空のままの保存が 422、本文を足す編集は 200（計画 2.7）", async () => {
    const id = nextId();
    await insertBodylessMessage({ roomId: room, senderId: author.userId, id });
    expect((await editMessage(id, { body: "" }, author.token)).status).toBe(
      422,
    );
    expect((await editMessage(id, { body: ADDED }, author.token)).status).toBe(
      200,
    );
  });
});

describe("#270 決定4（C-171(2) の一部の置き換え）判定の順：①〜⑤が、空の本文の 422 より先", () => {
  it.each([
    ["添付のある他人の投稿", 1],
    ["添付のない他人の投稿", 0],
  ] as const)(
    "#270 決定4: %s を空にする編集は 403 FORBIDDEN（422 にしない）で、本文は変わらない",
    async (_label, count) => {
      const { id } = await seedPost({ count, senderId: other.userId });
      const response = await editMessage(id, { body: "" }, author.token);
      expect(response.status).toBe(403);
      expect(((await response.json()) as ErrorBody).code).toBe("FORBIDDEN");
      expect((await messageRow(id))?.body).toBe(ORIGINAL);
    },
  );

  it("#270 決定4: 存在しないメッセージを空にする編集は 404 NOT_FOUND（422 にしない）", async () => {
    const response = await editMessage(
      testId("NOMSG"),
      { body: "" },
      author.token,
    );
    expect(response.status).toBe(404);
  });

  it("#270 決定4: 見えない部屋（非公開・未参加）の投稿を空にする編集は、存在しないものと同じ 404", async () => {
    const secret = await insertChannel({
      name: `${TEST_TAG}空の編集の見えない部屋`,
      purpose: "normal",
      departmentId: dept.id,
      visibility: "private",
    });
    await insertMember(secret, other.userId);
    const { id } = await seedPost({ senderId: other.userId, roomId: secret });
    const missing = await editMessage(
      testId("NOMSG"),
      { body: "" },
      author.token,
    );
    const response = await editMessage(id, { body: "" }, author.token);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(await missing.json());
  });

  it("#270 決定4: 自分の削除済みの投稿（添付なし）を空にする編集は 409（④が 422 より先）", async () => {
    const { id } = await seedPost({ count: 0 });
    await markDeleted(id, author.userId);
    const response = await editMessage(id, { body: "" }, author.token);
    expect(response.status).toBe(409);
    expect(((await response.json()) as ErrorBody).code).toBe("CONFLICT");
  });

  it("#270 決定4（Controller が先のまま）: 長さの上限の誤り（4,001文字）は、他人の投稿・存在しないメッセージでも 422", async () => {
    const { id } = await seedPost({ senderId: other.userId });
    const long = "a".repeat(4001);
    expect((await editMessage(id, { body: long }, author.token)).status).toBe(
      422,
    );
    expect(
      (await editMessage(testId("NOMSG"), { body: long }, author.token)).status,
    ).toBe(422);
  });

  it("#270 AC-5（計画 2.2 の11）: 添付のある自分の投稿でも、空の本文に指名の範囲を付けると 422（fields: mentions）で、本文は変わらない", async () => {
    const { id } = await seedPost();
    const response = await editMessage(
      id,
      {
        body: "",
        mentions: [{ userId: other.userId, start: 0, end: 1 }],
      },
      author.token,
    );
    expect(response.status).toBe(422);
    const fields = ((await response.json()) as ErrorBody).fields ?? [];
    // 指名の誤りの項目名は、いまの形（"mentions.0"）。本文の誤り（body）は含めない（添付があるので本文の空は許される）
    expect(fields.some((field) => field.startsWith("mentions"))).toBe(true);
    expect(fields).not.toContain("body");
    expect((await messageRow(id))?.body).toBe(ORIGINAL);
  });
});
