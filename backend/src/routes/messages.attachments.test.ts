// #140 AC-1（1-6 AC-1〜AC-3・AC-9）・AC-2（1-4 AC-5）: 投稿・返信への添付の結び付けと、一覧（部屋の一覧・返信の一覧）への付与を、
// 実際のアプリ入口（index.ts の app）・隔離 D1・手元の R2 で確かめる。
// 契約（計画「方式」4・「判定の順」・「API」。このテストが固定する）：
//   POST /api/rooms/:roomId/messages・POST /api/messages/:messageId/replies の入力に attachmentIds（最大10件、重複不可、ULID）を足す。
//     形の誤り（11件・重複・ULID でない）は 422 VALIDATION_ERROR。
//     既存の判定の後に、添付が他人の・別の部屋の・別の文脈の・存在しないなら 404 NOT_FOUND、使用済みなら 409 CONFLICT。どれもメッセージは作られない。
//     合計が200,000,000バイトを超えると 422 VALIDATION_ERROR（報告の「確認が必要な点」）で、メッセージは作られない。
//   一覧の項目に attachments: [{ id, name, kind, contentType, size }]（ID の昇順）。削除済みのメッセージは []。
// 条件の網羅（他人・別の部屋・文脈・件数・合計の境界）は db/attachment.repository.db.test.ts。ここは入口と応答の形の代表（#271）。
// データは架空（testuser_attmsg_、[UNIT_TEST]）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import { TEXT_BYTES, buildPng } from "../../test/attachment-files";
import {
  TEST_TAG,
  attachmentIdsOf,
  attachmentRow,
  cleanupAttachmentScenario,
  createThreadWorld,
  downloadAttachment,
  insertAttachmentRow,
  uploadFile,
  uploadedOk,
  type ThreadWorld,
} from "../../test/attachment-fixtures";
import { insertChannel, insertMember } from "../../test/department-fixtures";
import { markDeleted } from "../../test/message-modify-fixtures";
import {
  codeOf,
  postReply,
  repliesOk,
  roomItems,
  roomRowCount,
  seedParent,
  seedReply,
} from "../../test/thread-fixtures";

type AttachmentView = {
  id: string;
  name: string;
  kind: string;
  contentType: string;
  size: number;
};
type WithAttachments = { id: string; attachments: AttachmentView[] };

let world: ThreadWorld;

const post = (roomId: string, payload: unknown, token: string) =>
  apiRequest("POST", `/api/rooms/${roomId}/messages`, { token, body: payload });

const pending = (
  overrides: Partial<Parameters<typeof insertAttachmentRow>[0]> = {},
) =>
  insertAttachmentRow({
    roomId: world.channel,
    uploaderId: world.alice.userId,
    ...overrides,
  });

const itemsOf = async (roomId: string, token: string) =>
  (await roomItems(roomId, "", token)).items as unknown as WithAttachments[];

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  world = await createThreadWorld("attmsg");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupAttachmentScenario();
});

describe("#140 AC-1（1-6 AC-1・AC-3）通常の投稿への添付", () => {
  it("#140 AC-1: アップロードした添付を attachmentIds で投稿に付けると 201。一覧の項目に attachments が入り、ほかの参加者が取得できる", async () => {
    const png = await buildPng();
    const uploaded = await uploadedOk(
      await uploadFile(
        { kind: "room", roomId: world.channel },
        "画像.png",
        png,
        world.alice.token,
      ),
    );
    const response = await post(
      world.channel,
      { body: `${TEST_TAG}添付つき`, attachmentIds: [uploaded.id] },
      world.alice.token,
    );
    expect(response.status).toBe(201);
    const { id: messageId } = (await response.json()) as { id: string };
    expect((await attachmentRow(uploaded.id))?.message_id).toBe(messageId);
    const item = (await itemsOf(world.channel, world.bob.token)).find(
      (entry) => entry.id === messageId,
    );
    expect(item?.attachments).toEqual([
      {
        id: uploaded.id,
        name: "画像.png",
        kind: "image",
        contentType: "image/png",
        size: png.length,
      },
    ]);
    expect(
      (await downloadAttachment(uploaded.id, world.bob.token)).status,
    ).toBe(200);
  });

  it("#140 AC-1: 添付のない項目の attachments は []、複数の添付は ID の昇順", async () => {
    await seedParent(world.channel, world.bob.userId, 1);
    const a = await pending({ originalName: "a.txt" });
    const b = await pending({ originalName: "b.txt" });
    const response = await post(
      world.channel,
      { body: `${TEST_TAG}2件`, attachmentIds: [b, a] },
      world.alice.token,
    );
    expect(response.status).toBe(201);
    const items = await itemsOf(world.channel, world.alice.token);
    const plain = items.find((item) => item.attachments.length === 0);
    expect(plain).toBeDefined();
    const withTwo = items.find((item) => item.attachments.length === 2);
    expect(withTwo?.attachments.map((entry) => entry.id)).toEqual(
      [a, b].sort(),
    );
  });

  it("#140 AC-1（1-6 AC-2）: 削除したメッセージの項目の attachments は []", async () => {
    const message = await seedParent(world.channel, world.alice.userId, 1);
    await pending({ messageId: message });
    await markDeleted(message, world.alice.userId);
    const item = (await itemsOf(world.channel, world.bob.token)).find(
      (entry) => entry.id === message,
    );
    expect(item?.attachments).toEqual([]);
  });

  it("#140 AC-1（1-6 AC-2）: 公開チャンネルの未参加者（carol）の一覧にも attachments が入る", async () => {
    const message = await seedParent(world.channel, world.alice.userId, 1);
    const id = await pending({ messageId: message });
    const item = (await itemsOf(world.channel, world.carol.token)).find(
      (entry) => entry.id === message,
    );
    expect(item?.attachments.map((entry) => entry.id)).toEqual([id]);
  });

  it.each([
    ["他人の添付", "other"],
    ["別の部屋の添付", "room"],
    ["返信用にアップロードした添付", "context"],
    ["存在しない添付", "missing"],
  ] as const)(
    "#140 AC-1: %sを付けると 404 NOT_FOUND で、メッセージは作られず、添付は未投稿のまま",
    async (_label, kind) => {
      let id = "01ZZZZZZZZZZZZZZZZZZZZZZZZ";
      if (kind === "other")
        id = await pending({ uploaderId: world.bob.userId });
      else if (kind === "room") {
        const other = await insertChannel({
          name: `${TEST_TAG}添付の別の部屋`,
          purpose: "normal",
          departmentId: world.dept.id,
        });
        await insertMember(other, world.alice.userId);
        id = await pending({ roomId: other });
      } else if (kind === "context") {
        const parent = await seedParent(world.channel, world.bob.userId, 1);
        id = await pending({ threadParentId: parent });
      }
      const before = await roomRowCount(world.channel);
      const response = await post(
        world.channel,
        { body: `${TEST_TAG}付けられない`, attachmentIds: [id] },
        world.alice.token,
      );
      expect(response.status).toBe(404);
      expect(await codeOf(response)).toBe("NOT_FOUND");
      expect(await roomRowCount(world.channel)).toBe(before);
      if (kind !== "missing")
        expect((await attachmentRow(id))?.message_id).toBeNull();
    },
  );

  it("#140 AC-1（同時の操作）: 使用済みの添付を別の投稿に付けると 409 CONFLICT で、後の投稿は作られない", async () => {
    const id = await pending();
    const first = await post(
      world.channel,
      { body: `${TEST_TAG}先`, attachmentIds: [id] },
      world.alice.token,
    );
    expect(first.status).toBe(201);
    const { id: firstId } = (await first.json()) as { id: string };
    const before = await roomRowCount(world.channel);
    const second = await post(
      world.channel,
      { body: `${TEST_TAG}後`, attachmentIds: [id] },
      world.alice.token,
    );
    expect(second.status).toBe(409);
    expect(await codeOf(second)).toBe("CONFLICT");
    expect(await roomRowCount(world.channel)).toBe(before);
    expect(await attachmentIdsOf(firstId)).toEqual([id]);
  });

  it("#140 AC-1（同時の操作）: 同じ未投稿の添付を2つの投稿が同時に使うと、片方だけが 201 で、もう片方は 409", async () => {
    const id = await pending();
    const statuses = (
      await Promise.all([
        post(
          world.channel,
          { body: `${TEST_TAG}同時1`, attachmentIds: [id] },
          world.alice.token,
        ),
        post(
          world.channel,
          { body: `${TEST_TAG}同時2`, attachmentIds: [id] },
          world.alice.token,
        ),
      ])
    )
      .map((response) => response.status)
      .sort();
    expect(statuses).toEqual([201, 409]);
  });

  it("#140 AC-1（1-6 AC-3）: 合計が200,000,000バイトを超える添付の組は 422 VALIDATION_ERROR で、メッセージは作られない", async () => {
    const ids = [
      await pending({
        kind: "video",
        contentType: "video/mp4",
        sizeBytes: 100_000_000,
      }),
      await pending({
        kind: "video",
        contentType: "video/mp4",
        sizeBytes: 100_000_000,
      }),
      await pending({ sizeBytes: 1 }),
    ];
    const before = await roomRowCount(world.channel);
    const response = await post(
      world.channel,
      { body: `${TEST_TAG}合計超過`, attachmentIds: ids },
      world.alice.token,
    );
    expect(response.status).toBe(422);
    expect(await codeOf(response)).toBe("VALIDATION_ERROR");
    expect(await roomRowCount(world.channel)).toBe(before);
  });

  it.each([
    ["11件", "eleven"],
    ["重複", "duplicate"],
    ["ULID でない", "invalid"],
  ] as const)(
    "#140 AC-1（1-6 AC-1）: attachmentIds が%sだと 422 VALIDATION_ERROR",
    async (_label, kind) => {
      let ids: string[];
      if (kind === "eleven") {
        ids = [];
        for (let i = 0; i < 11; i += 1)
          ids.push(await pending({ sizeBytes: 1 }));
      } else if (kind === "duplicate") {
        const id = await pending();
        ids = [id, id];
      } else ids = ["not-a-ulid"];
      const before = await roomRowCount(world.channel);
      const response = await post(
        world.channel,
        { body: `${TEST_TAG}形の誤り`, attachmentIds: ids },
        world.alice.token,
      );
      expect(response.status).toBe(422);
      expect(await codeOf(response)).toBe("VALIDATION_ERROR");
      expect(await roomRowCount(world.channel)).toBe(before);
    },
  );

  it("#140 AC-1: 10件ちょうどは投稿できる", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i += 1) ids.push(await pending({ sizeBytes: 1 }));
    const response = await post(
      world.channel,
      { body: `${TEST_TAG}10件`, attachmentIds: ids },
      world.alice.token,
    );
    expect(response.status).toBe(201);
  });
});

// #140 ミューテーション（絞った診断）への対応：結び付けの失敗の分け方（使用済みの判定は「1件でも使われていれば」）、合計の境界、応答の形。
// 期待（計画「方式」4・「判定の順」）：使用済みが1件でも含まれれば 409「添付はすでに使われています」（利用者に見える文）、メッセージは作られない。
//   合計がちょうど200,000,000バイトは成功、1バイト多いと 422 VALIDATION_ERROR・fields ["attachmentIds"]。
describe("#140 AC-1 結び付けの失敗の分け方", () => {
  const bodyOf = async (response: Response) =>
    (await response.json()) as {
      code?: string;
      message?: string;
      fields?: unknown;
    };

  const usedOne = async () => {
    const id = await pending();
    const first = await post(
      world.channel,
      { body: `${TEST_TAG}先`, attachmentIds: [id] },
      world.alice.token,
    );
    expect(first.status).toBe(201);
    return id;
  };

  it.each([
    ["複数のうち1件だけが使用済み", "mixed"],
    ["全部が使用済み", "all"],
  ] as const)(
    "#140 AC-1: %sだと 409 CONFLICT・「添付はすでに使われています」で、メッセージは作られない",
    async (_label, kind) => {
      const used = await usedOne();
      const other = kind === "mixed" ? await pending() : await usedOne();
      const before = await roomRowCount(world.channel);
      const response = await post(
        world.channel,
        { body: `${TEST_TAG}使用済み`, attachmentIds: [other, used] },
        world.alice.token,
      );
      expect(response.status).toBe(409);
      expect(await bodyOf(response)).toMatchObject({
        code: "CONFLICT",
        message: "添付はすでに使われています",
      });
      expect(await roomRowCount(world.channel)).toBe(before);
      if (kind === "mixed")
        expect((await attachmentRow(other))?.message_id).toBeNull();
    },
  );

  it("#140 AC-1: 全部が未使用なら 201 で、全部が結び付く", async () => {
    const ids = [await pending(), await pending()];
    const response = await post(
      world.channel,
      { body: `${TEST_TAG}未使用`, attachmentIds: ids },
      world.alice.token,
    );
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    expect(await attachmentIdsOf(id)).toEqual([...ids].sort());
  });

  it("#140 AC-1（1-6 AC-3）: 合計がちょうど200,000,000バイトは 201", async () => {
    const ids = [
      await pending({
        kind: "video",
        contentType: "video/mp4",
        sizeBytes: 100_000_000,
      }),
      await pending({
        kind: "video",
        contentType: "video/mp4",
        sizeBytes: 100_000_000,
      }),
    ];
    const response = await post(
      world.channel,
      { body: `${TEST_TAG}合計ちょうど`, attachmentIds: ids },
      world.alice.token,
    );
    expect(response.status).toBe(201);
  });

  it('#140 AC-1（1-6 AC-3）: 合計が1バイト多いと 422・fields ["attachmentIds"]', async () => {
    const ids = [
      await pending({
        kind: "video",
        contentType: "video/mp4",
        sizeBytes: 100_000_000,
      }),
      await pending({
        kind: "video",
        contentType: "video/mp4",
        sizeBytes: 100_000_001,
      }),
    ];
    const response = await post(
      world.channel,
      { body: `${TEST_TAG}合計超過`, attachmentIds: ids },
      world.alice.token,
    );
    expect(response.status).toBe(422);
    expect(await bodyOf(response)).toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["attachmentIds"],
    });
  });
});

// #140 ミューテーション（絞った診断）への対応：一覧の attachments は、その投稿の添付だけ。添付のない投稿は厳密に []。
describe("#140 AC-1 一覧の attachments（添付のある投稿とない投稿の混在）", () => {
  const view = (id: string, name: string) => ({
    id,
    name,
    kind: "document",
    contentType: "text/plain; charset=utf-8",
    size: 10,
  });

  it("#140 AC-1: 部屋の一覧で、添付のない投稿は []、ある投稿には自分の添付だけが入る", async () => {
    const withA = await seedParent(world.channel, world.alice.userId, 1);
    const plain = await seedParent(world.channel, world.alice.userId, 2);
    const withB = await seedParent(world.channel, world.alice.userId, 3);
    const a = await pending({ messageId: withA, originalName: "a.txt" });
    const b = await pending({ messageId: withB, originalName: "b.txt" });
    const items = await itemsOf(world.channel, world.bob.token);
    const byId = new Map(items.map((item) => [item.id, item.attachments]));
    expect(byId.get(withA)).toEqual([view(a, "a.txt")]);
    expect(byId.get(plain)).toEqual([]);
    expect(byId.get(withB)).toEqual([view(b, "b.txt")]);
  });

  it("#140 AC-2（1-4 AC-5）: 返信の一覧とスレッドの親で、添付のない投稿は []、ある投稿には自分の添付だけが入る", async () => {
    const parent = await seedParent(world.channel, world.alice.userId, 1);
    const p = await pending({ messageId: parent, originalName: "親.txt" });
    const withR = await seedReply(world.channel, parent, world.bob.userId, 2);
    const plainR = await seedReply(world.channel, parent, world.bob.userId, 3);
    const r = await pending({
      messageId: withR,
      uploaderId: world.bob.userId,
      threadParentId: parent,
      originalName: "返信.txt",
    });
    const page = await repliesOk(parent, "", world.alice.token);
    expect((page.parent as unknown as WithAttachments).attachments).toEqual([
      view(p, "親.txt"),
    ]);
    const byId = new Map(
      (page.items as unknown as WithAttachments[]).map((item) => [
        item.id,
        item.attachments,
      ]),
    );
    expect(byId.get(withR)).toEqual([view(r, "返信.txt")]);
    expect(byId.get(plainR)).toEqual([]);
  });
});

describe("#140 AC-1（1-6 AC-9）・AC-2（1-4 AC-5）返信への添付", () => {
  it("#140 AC-2（1-4 AC-5）: 返信用にアップロードした添付を返信に付けると 201。返信の一覧の項目に attachments が入る", async () => {
    const parent = await seedParent(world.channel, world.bob.userId, 1);
    const uploaded = await uploadedOk(
      await uploadFile(
        { kind: "reply", parentId: parent },
        "memo.txt",
        TEXT_BYTES,
        world.alice.token,
      ),
    );
    const response = await postReply(
      parent,
      { body: `${TEST_TAG}返信の添付`, attachmentIds: [uploaded.id] },
      world.alice.token,
    );
    expect(response.status).toBe(201);
    const page = await repliesOk(parent, "", world.bob.token);
    const items = page.items as unknown as WithAttachments[];
    expect(items.at(-1)?.attachments).toEqual([
      {
        id: uploaded.id,
        name: "memo.txt",
        kind: "document",
        contentType: "text/plain; charset=utf-8",
        size: TEXT_BYTES.length,
      },
    ]);
    expect((page.parent as unknown as WithAttachments).attachments).toEqual([]);
  });

  it("#140 AC-2（1-4 AC-5）: 通常の投稿用にアップロードした添付を返信に付けると 404 で、返信は作られない", async () => {
    const parent = await seedParent(world.channel, world.bob.userId, 1);
    const id = await pending();
    const before = await roomRowCount(world.channel);
    const response = await postReply(
      parent,
      { body: `${TEST_TAG}文脈違い`, attachmentIds: [id] },
      world.alice.token,
    );
    expect(response.status).toBe(404);
    expect(await roomRowCount(world.channel)).toBe(before);
  });

  it("#140 AC-1（1-6 AC-9）: 返信でも attachmentIds が11件なら 422", async () => {
    const parent = await seedParent(world.channel, world.bob.userId, 1);
    const ids: string[] = [];
    for (let i = 0; i < 11; i += 1)
      ids.push(await pending({ threadParentId: parent, sizeBytes: 1 }));
    const response = await postReply(
      parent,
      { body: `${TEST_TAG}11件`, attachmentIds: ids },
      world.alice.token,
    );
    expect(response.status).toBe(422);
  });
});
