// #270（270-B）AC-1・AC-2・AC-3（代表）・計画 2.2 の11：添付だけの投稿・返信（C-137(3)）を、実際のアプリ入口（index.ts の app）と隔離 D1 で確かめる（結合）。
// 期待の根拠（実装から写さない）：
//   利用者の決定1：本文なしは、DB の本文に目印（半角の空白1文字）を保存し、API は body に空文字を返す
//   計画 AC-1：添付が1件以上あれば、本文が空（空文字・空白・改行だけ）でも、チャンネル・DM・案件の部屋に投稿できる（201）。
//     本文も添付もないときは、これまでどおり 422（fields: body）。Controller が先（見えない部屋でも 422）
//   計画 AC-2：返信も同じ規則（3種の部屋とも）
//   計画 AC-3：空の本文で、指定した添付が結び付かない（他人・別の部屋・使用済み・存在しない）ときは、これまでの応答（404／409）で、
//     メッセージ・指名・通知・索引のどれも残らない（条件の網羅は db/attachment.repository.db.test.ts。ここは応答のコードの代表）
//   計画 2.2 の11：本文が空なら、指名の範囲は必ず不正で 422（fields: mentions）。本文なしの投稿では通知は増えない
//   計画 2.1：空白だけは空と同じ（目印に置き換える）。前後に空白のある本文は送られたまま
// データは架空（testuser_attonly_、[UNIT_TEST]）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  attachmentRow,
  cleanupAttachmentScenario,
  createThreadWorld,
  insertAttachmentRow,
  type ThreadWorld,
} from "../../test/attachment-fixtures";
import {
  STORED_EMPTY_BODY,
  cleanupAttachmentOnlyLeftovers,
  emptyPostsWithoutAttachments,
  messagesInRoom,
  rowCount,
  storedBodyOf,
} from "../../test/attachment-only-fixtures";
import {
  cleanupCaseRoomWorld,
  setupCaseRoomWorld,
} from "../../test/case-room-fixtures";
import {
  TEST_TAG,
  insertChannel,
  insertMember,
} from "../../test/department-fixtures";
import { insertDm } from "../../test/dm-fixtures";
import { cleanupSearchIndex } from "../../test/search-fixtures";
import {
  getReplies,
  postReply,
  roomItems,
  seedParent,
} from "../../test/thread-fixtures";

let world: ThreadWorld;
let n = 0;

const post = (roomId: string, payload: unknown, token: string) =>
  apiRequest("POST", `/api/rooms/${roomId}/messages`, { token, body: payload });

/** 未投稿の添付（本人・その部屋・通常の投稿の文脈） */
const pending = (
  roomId: string,
  uploaderId: string,
  threadParentId: string | null = null,
) => {
  n += 1;
  return insertAttachmentRow({
    roomId,
    uploaderId,
    threadParentId,
    originalName: `[UNIT_TEST]添付だけ${n}.txt`,
  });
};

type ErrorBody = { code: string; message: string; fields?: string[] };
const errorOf = async (response: Response) =>
  (await response.json()) as ErrorBody;

/** 書き込みが残っていないことの確かめに使う件数 */
const snapshot = async () => ({
  messages: await rowCount("messages"),
  mentions: await rowCount("message_mentions"),
  notifications: await rowCount("notifications"),
  documents: await rowCount("search_documents"),
});

const listedBody = async (roomId: string, messageId: string, token: string) =>
  (await roomItems(roomId, "?limit=100", token)).items.find(
    (item) => item.id === messageId,
  )?.body;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  world = await createThreadWorld("attonly");
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

describe("#270 AC-1 添付だけの投稿（チャンネル・DM）", () => {
  it.each([
    ["空文字", ""],
    ["半角の空白1文字", " "],
    ["空白と改行と全角の空白だけ", " \n　\t"],
  ])(
    "#270 AC-1（決定1）: チャンネルで、本文が%sでも添付が1件あれば 201。DB の本文は目印、一覧の body は空文字、添付は結び付く",
    async (_label, body) => {
      const attachment = await pending(world.channel, world.alice.userId);
      const response = await post(
        world.channel,
        { body, attachmentIds: [attachment] },
        world.alice.token,
      );
      expect(response.status).toBe(201);
      const { id } = (await response.json()) as { id: string };
      expect(await storedBodyOf(id)).toBe(STORED_EMPTY_BODY);
      expect((await attachmentRow(attachment))?.message_id).toBe(id);
      expect(await listedBody(world.channel, id, world.bob.token)).toBe("");
      expect(await emptyPostsWithoutAttachments()).toEqual([]);
    },
  );

  it("#270 AC-1: DM でも、本文が空で添付が1件あれば 201。相手の一覧の body は空文字", async () => {
    const dm = await insertDm(world.alice.userId, world.bob.userId);
    const attachment = await pending(dm, world.alice.userId);
    const response = await post(
      dm,
      { body: "", attachmentIds: [attachment] },
      world.alice.token,
    );
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    expect(await storedBodyOf(id)).toBe(STORED_EMPTY_BODY);
    expect(await listedBody(dm, id, world.bob.token)).toBe("");
  });

  it("#270 AC-1（計画 2.1）: 添付つきで、前後に空白のある本文は送られたまま保存し、そのまま返す（目印にしない）", async () => {
    const attachment = await pending(world.channel, world.alice.userId);
    const body = " [UNIT_TEST]前後に空白 ";
    const response = await post(
      world.channel,
      { body, attachmentIds: [attachment] },
      world.alice.token,
    );
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    expect(await storedBodyOf(id)).toBe(body);
    expect(await listedBody(world.channel, id, world.bob.token)).toBe(body);
  });

  it("#270 AC-1（計画 2.1）: 添付つきで、空白2文字の本文も「本文なし」として目印1文字で保存する（送った空白は保存しない）", async () => {
    const attachment = await pending(world.channel, world.alice.userId);
    const response = await post(
      world.channel,
      { body: "  ", attachmentIds: [attachment] },
      world.alice.token,
    );
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    expect(await storedBodyOf(id)).toBe(STORED_EMPTY_BODY);
  });
});

describe("#270 AC-1 本文も添付もないときは、これまでどおり 422（Controller が先）", () => {
  it.each([
    ["空文字・attachmentIds なし", { body: "" }],
    ["空文字・attachmentIds が空", { body: "", attachmentIds: [] }],
    ["半角の空白1文字・添付なし", { body: " " }],
    ["空白と改行だけ・添付なし", { body: " \n " }],
  ])(
    "#270 AC-1: %s は 422 VALIDATION_ERROR（fields: body）で、メッセージは増えない",
    async (_label, payload) => {
      const before = await messagesInRoom(world.channel);
      const response = await post(world.channel, payload, world.alice.token);
      expect(response.status).toBe(422);
      const error = await errorOf(response);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.fields).toContain("body");
      expect(await messagesInRoom(world.channel)).toBe(before);
    },
  );

  it("#270 AC-1（判定の順は変えない）: 見えない部屋（非公開・未参加）でも、本文も添付もない投稿は Controller の 422 が先", async () => {
    const secret = await insertChannel({
      name: `${TEST_TAG}添付だけの見えない部屋`,
      purpose: "normal",
      departmentId: world.dept.id,
      visibility: "private",
    });
    await insertMember(secret, world.bob.userId);
    const response = await post(secret, { body: "" }, world.alice.token);
    expect(response.status).toBe(422);
    expect((await errorOf(response)).fields).toContain("body");
  });
});

describe("#270 AC-1（計画 2.2 の11）指名と通知", () => {
  it("#270 AC-1: 本文が空で指名の範囲を付けると 422（fields: mentions）で、メッセージも通知も増えない", async () => {
    const attachment = await pending(world.channel, world.alice.userId);
    const before = await snapshot();
    const response = await post(
      world.channel,
      {
        body: "",
        mentions: [{ userId: world.bob.userId, start: 0, end: 1 }],
        attachmentIds: [attachment],
      },
      world.alice.token,
    );
    expect(response.status).toBe(422);
    const fields = (await errorOf(response)).fields ?? [];
    // 指名の誤りの項目名は、いまの形（"mentions.0"）。本文の誤り（body）は含めない
    expect(fields.some((field) => field.startsWith("mentions"))).toBe(true);
    expect(fields).not.toContain("body");
    expect(await snapshot()).toEqual(before);
    expect((await attachmentRow(attachment))?.message_id).toBeNull();
  });

  it("#270 AC-1: 本文なしの投稿では、指名も通知も増えない", async () => {
    const attachment = await pending(world.channel, world.alice.userId);
    const mentions = await rowCount("message_mentions");
    const notifications = await rowCount("notifications");
    const response = await post(
      world.channel,
      { body: "", attachmentIds: [attachment] },
      world.alice.token,
    );
    expect(response.status).toBe(201);
    expect(await rowCount("message_mentions")).toBe(mentions);
    expect(await rowCount("notifications")).toBe(notifications);
  });
});

describe("#270 AC-3 空の本文で、添付が結び付かないときは、これまでの応答で、何も残らない（代表）", () => {
  it.each<[string, () => Promise<string>, number]>([
    ["他人の添付", () => pending(world.channel, world.bob.userId), 404],
    ["存在しない添付", async () => "01JZZZZZZZZZZZZZZZZZZZZZZZ", 404],
    [
      "別の部屋の添付",
      async () => {
        const dm = await insertDm(world.alice.userId, world.bob.userId);
        return pending(dm, world.alice.userId);
      },
      404,
    ],
    [
      "使用済み（別の投稿に結び付いた）添付",
      async () => {
        const used = await seedParent(world.channel, world.alice.userId, 1);
        return insertAttachmentRow({
          roomId: world.channel,
          uploaderId: world.alice.userId,
          messageId: used,
        });
      },
      409,
    ],
  ])(
    "#270 AC-3: %s を指定すると、これまでの応答（404／409）で、メッセージ・指名・通知・索引のどれも増えない",
    async (_label, make, status) => {
      const attachment = await make();
      const before = await snapshot();
      const response = await post(
        world.channel,
        { body: "", attachmentIds: [attachment] },
        world.alice.token,
      );
      expect(response.status).toBe(status);
      expect(await snapshot()).toEqual(before);
      expect(await emptyPostsWithoutAttachments()).toEqual([]);
    },
  );

  it("#270 AC-3: 正しい添付と他人の添付を混ぜると 404 で、正しい添付も未投稿のまま", async () => {
    const mine = await pending(world.channel, world.alice.userId);
    const theirs = await pending(world.channel, world.bob.userId);
    const before = await snapshot();
    const response = await post(
      world.channel,
      { body: "", attachmentIds: [mine, theirs] },
      world.alice.token,
    );
    expect(response.status).toBe(404);
    expect(await snapshot()).toEqual(before);
    expect((await attachmentRow(mine))?.message_id).toBeNull();
  });
});

describe("#270 AC-2 添付だけの返信", () => {
  it("#270 AC-2: チャンネルのスレッドに、本文が空で添付1件の返信は 201。DB の本文は目印、返信の一覧の body は空文字", async () => {
    const parent = await seedParent(world.channel, world.bob.userId, 2);
    const attachment = await pending(world.channel, world.alice.userId, parent);
    const response = await postReply(
      parent,
      { body: " \n", attachmentIds: [attachment] },
      world.alice.token,
    );
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    expect(await storedBodyOf(id)).toBe(STORED_EMPTY_BODY);
    const page = (await (
      await getReplies(parent, "", world.bob.token)
    ).json()) as {
      items: { id: string; body: string | null }[];
    };
    expect(page.items.find((item) => item.id === id)?.body).toBe("");
  });

  it("#270 AC-2: DM のスレッドにも、本文が空で添付1件の返信ができる（201）", async () => {
    const dm = await insertDm(world.alice.userId, world.bob.userId);
    const parent = await seedParent(dm, world.bob.userId, 3);
    const attachment = await pending(dm, world.alice.userId, parent);
    const response = await postReply(
      parent,
      { body: "", attachmentIds: [attachment] },
      world.alice.token,
    );
    expect(response.status).toBe(201);
  });

  it.each([
    ["空文字・添付なし", { body: "" }],
    ["空白だけ・attachmentIds が空", { body: "  ", attachmentIds: [] }],
  ])(
    "#270 AC-2: 返信で %s は 422（fields: body）で、返信は増えない",
    async (_label, payload) => {
      const parent = await seedParent(world.channel, world.bob.userId, 4);
      const before = await messagesInRoom(world.channel);
      const response = await postReply(parent, payload, world.alice.token);
      expect(response.status).toBe(422);
      expect((await errorOf(response)).fields).toContain("body");
      expect(await messagesInRoom(world.channel)).toBe(before);
    },
  );

  it("#270 AC-3（返信）: 空の本文で他人の添付を指定した返信は 404 で、何も増えない", async () => {
    const parent = await seedParent(world.channel, world.bob.userId, 5);
    const theirs = await pending(world.channel, world.bob.userId, parent);
    const before = await snapshot();
    const response = await postReply(
      parent,
      { body: "", attachmentIds: [theirs] },
      world.alice.token,
    );
    expect(response.status).toBe(404);
    expect(await snapshot()).toEqual(before);
  });
});

describe("#270 AC-1・AC-2 案件の部屋（案件専用チャンネル）", () => {
  it("#270 AC-1・AC-2: 進行中の案件の部屋で、本文が空で添付1件の投稿と返信が 201。本文は目印で保存する", async () => {
    // この describe だけ、案件の世界を作る（ThreadWorld とは別の利用者。後始末は案件の世界の手順で行う）
    const cw = await setupCaseRoomWorld(2701);
    try {
      const member = cw.w.memberS1;
      const roomId = cw.open.roomId;
      const first = await insertAttachmentRow({
        roomId,
        uploaderId: member.id,
        originalName: "[UNIT_TEST]案件の添付だけ.txt",
      });
      const posted = await post(
        roomId,
        { body: "", attachmentIds: [first] },
        member.token,
      );
      expect(posted.status).toBe(201);
      const { id: parentId } = (await posted.json()) as { id: string };
      expect(await storedBodyOf(parentId)).toBe(STORED_EMPTY_BODY);

      const second = await insertAttachmentRow({
        roomId,
        uploaderId: member.id,
        threadParentId: parentId,
        originalName: "[UNIT_TEST]案件の返信の添付だけ.txt",
      });
      const replied = await postReply(
        parentId,
        { body: "", attachmentIds: [second] },
        member.token,
      );
      expect(replied.status).toBe(201);
      const { id: replyId } = (await replied.json()) as { id: string };
      expect(await storedBodyOf(replyId)).toBe(STORED_EMPTY_BODY);

      const none = await post(roomId, { body: "" }, member.token);
      expect(none.status).toBe(422);
    } finally {
      await cleanupAttachmentOnlyLeftovers();
      await cleanupCaseRoomWorld();
    }
  });
});
