// #270（270-B）AC-7（競合）：本文のない投稿の添付の同時の削除と、本文を空にする編集と最後の添付の削除の同時の実行で、
// 「本文も、見える添付もない投稿」が残らないことを、実際のアプリ入口・隔離 D1・手元の R2 で確かめる（結合）。
// 期待の根拠（実装から写さない）：
//   計画 AC-7 (a)：本文のない投稿の、残り2件の添付の同時の削除は、片方だけが 204、もう片方は AC-6 の 409
//   計画 AC-7 (b)：本文を空にする編集と最後の添付の削除は、先に確定したほうが通り、後のほうは、削除なら AC-6 の 409、編集なら AC-5 の 422
//   計画 2.6：どちらの順でも、本文も添付もない投稿は残らない（DB を直接読んで確かめる）
// 同時の実行は Promise.all で送り、D1 が書き込みを1つずつ実行する前提（messages.md の「前提」）で、結果の組を確かめる。順序を決めた実行も別に確かめる。
// データは架空（testuser_attrace_、[UNIT_TEST]）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEXT_BYTES } from "../../test/attachment-files";
import {
  cleanupAttachmentDeleteScenario,
  deleteAttachment,
} from "../../test/attachment-delete-fixtures";
import { seedStoredAttachment } from "../../test/attachment-fixtures";
import {
  BLANK_BODY_MESSAGE,
  LAST_ATTACHMENT_MESSAGE,
  STORED_EMPTY_BODY,
  cleanupAttachmentOnlyLeftovers,
  emptyPostsWithoutAttachments,
  insertBodylessMessage,
  storedBodyOf,
  visibleAttachmentCount,
} from "../../test/attachment-only-fixtures";
import {
  TEST_TAG,
  insertChannel,
  insertDepartmentWithChannels,
  insertMember,
} from "../../test/department-fixtures";
import { insertMessage, ulidAt } from "../../test/message-fixtures";
import {
  editMessage,
  insertModifyUser,
  type ModifyUser,
} from "../../test/message-modify-fixtures";
import { cleanupSearchIndex } from "../../test/search-fixtures";

const ORIGINAL = `${TEST_TAG}競合の本文`;
let author: ModifyUser;
let room: string;
let seq = 0;

const nextId = () => {
  seq += 1;
  return ulidAt(1_897_000_000_000 + seq * 1_000);
};

async function attachTo(messageId: string, count: number) {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1)
    ids.push(
      await seedStoredAttachment(
        {
          roomId: room,
          uploaderId: author.userId,
          messageId,
          originalName: `[UNIT_TEST]競合の添付${seq}-${i}.txt`,
        },
        TEXT_BYTES,
      ),
    );
  return ids;
}

type Outcome = { status: number; message: string | null };
async function outcomeOf(response: Response): Promise<Outcome> {
  if (response.status === 200 || response.status === 204)
    return { status: response.status, message: null };
  return {
    status: response.status,
    message: ((await response.json()) as { message: string }).message,
  };
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const dept = await insertDepartmentWithChannels("添付だけの競合");
  author = await insertModifyUser("testuser_attrace_author", dept.id, 60_000);
  room = await insertChannel({
    name: `${TEST_TAG}添付だけの競合の部屋`,
    purpose: "normal",
    departmentId: dept.id,
  });
  await insertMember(room, author.userId);
});

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await cleanupAttachmentOnlyLeftovers();
    await cleanupSearchIndex();
  } finally {
    await cleanupAttachmentDeleteScenario();
  }
});

describe("#270 AC-7 (a) 本文のない投稿の、残り2件の添付の同時の削除", () => {
  it("#270 AC-7 (a): 同時に2件を消すと、204 が1つ・AC-6 の 409 が1つで、見える添付が1件残る", async () => {
    const messageId = nextId();
    await insertBodylessMessage({
      roomId: room,
      senderId: author.userId,
      id: messageId,
    });
    const [first = "", second = ""] = await attachTo(messageId, 2);
    const results = await Promise.all([
      deleteAttachment(first, author.token).then(outcomeOf),
      deleteAttachment(second, author.token).then(outcomeOf),
    ]);
    const sorted = [...results].sort((a, b) => a.status - b.status);
    expect(sorted).toEqual([
      { status: 204, message: null },
      { status: 409, message: LAST_ATTACHMENT_MESSAGE },
    ]);
    expect(await visibleAttachmentCount(messageId)).toBe(1);
    expect(await emptyPostsWithoutAttachments()).toEqual([]);
  });
});

describe("#270 AC-7 (b) 本文を空にする編集と、最後の添付の削除", () => {
  async function seedWithOne() {
    const messageId = nextId();
    await insertMessage({
      roomId: room,
      senderId: author.userId,
      id: messageId,
      body: ORIGINAL,
    });
    const [attachment = ""] = await attachTo(messageId, 1);
    return { messageId, attachment };
  }

  it("#270 AC-7 (b)（編集が先）: 編集は 200、その後の削除は AC-6 の 409。本文は目印で、添付は1件残る", async () => {
    const { messageId, attachment } = await seedWithOne();
    expect(
      await outcomeOf(await editMessage(messageId, { body: "" }, author.token)),
    ).toEqual({ status: 200, message: null });
    expect(
      await outcomeOf(await deleteAttachment(attachment, author.token)),
    ).toEqual({ status: 409, message: LAST_ATTACHMENT_MESSAGE });
    expect(await storedBodyOf(messageId)).toBe(STORED_EMPTY_BODY);
    expect(await visibleAttachmentCount(messageId)).toBe(1);
    expect(await emptyPostsWithoutAttachments()).toEqual([]);
  });

  it("#270 AC-7 (b)（削除が先）: 削除は 204、その後の空への編集は AC-5 の 422。本文は元のまま", async () => {
    const { messageId, attachment } = await seedWithOne();
    expect(
      await outcomeOf(await deleteAttachment(attachment, author.token)),
    ).toEqual({ status: 204, message: null });
    expect(
      await outcomeOf(await editMessage(messageId, { body: "" }, author.token)),
    ).toEqual({ status: 422, message: BLANK_BODY_MESSAGE });
    expect(await storedBodyOf(messageId)).toBe(ORIGINAL);
    expect(await emptyPostsWithoutAttachments()).toEqual([]);
  });

  it.each(["編集を先に送る", "削除を先に送る"] as const)(
    "#270 AC-7 (b)（同時・%s）: 結果の組は「200＋409」か「422＋204」のどちらかで、本文も見える添付もない投稿は残らない",
    async (order) => {
      const { messageId, attachment } = await seedWithOne();
      const edit = () =>
        editMessage(messageId, { body: "" }, author.token).then(outcomeOf);
      const remove = () =>
        deleteAttachment(attachment, author.token).then(outcomeOf);
      const [editResult, deleteResult] =
        order === "編集を先に送る"
          ? await Promise.all([edit(), remove()])
          : await Promise.all([remove(), edit()]).then(
              ([d, e]) => [e, d] as const,
            );
      const pair = [editResult.status, deleteResult.status];
      expect([
        [200, 409],
        [422, 204],
      ]).toContainEqual(pair);
      if (pair[0] === 200) {
        expect(deleteResult.message).toBe(LAST_ATTACHMENT_MESSAGE);
        expect(await storedBodyOf(messageId)).toBe(STORED_EMPTY_BODY);
        expect(await visibleAttachmentCount(messageId)).toBe(1);
      } else {
        expect(editResult.message).toBe(BLANK_BODY_MESSAGE);
        expect(await storedBodyOf(messageId)).toBe(ORIGINAL);
      }
      expect(await emptyPostsWithoutAttachments()).toEqual([]);
    },
  );
});
