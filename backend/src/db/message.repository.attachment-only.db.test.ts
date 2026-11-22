// #270（270-B）計画 2.3「Repository の守り」・AC-4「目印の出口」：隔離 D1 で、Repository を直接呼んで確かめる（DB の層）。
// 根拠（実装から写さない）：
//   利用者の決定1：本文なしは DB に目印（半角の空白1文字）を保存し、API の項目（一覧・1件・スレッドの親と返信・スレッド一覧）は body に空文字を返す
//   計画 2.2 の表の 1：本文を返す読み取りは、すべて toItem を通る（listLatest・listAfter・findItem・listRepliesLatest・listRepliesAfter・スレッド一覧）
//   計画 2.3：insertIfOrdered・insertReplyIfOrdered は、本文が目印で attachmentIds が空なら Error を投げ（呼び出し側の誤り。成功に見せない）、DB に行を残さない
// 目印の値は test/attachment-only-fixtures.ts の STORED_EMPTY_BODY（決定の値。本番の定数から作らない）。
// 検索の抜粋（2.2 の表の 6）は、索引が要るため routes/search.attachments.test.ts（結合）で確かめる。
// データは架空（testuser_attonlydb_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupAttachmentScenario,
  createThreadWorld,
  insertAttachmentRow,
  type ThreadWorld,
} from "../../test/attachment-fixtures";
import {
  STORED_EMPTY_BODY,
  cleanupAttachmentOnlyLeftovers,
  insertBodylessMessage,
  rowCount,
} from "../../test/attachment-only-fixtures";
import { ZERO_ID } from "../../test/message-fixtures";
import { idAt, isoAt, parentRow, seedParent } from "../../test/thread-fixtures";
import { withMessages } from "./message.repository";
import { withThreads } from "./thread.repository";

let world: ThreadWorld;

const settle = (promise: Promise<number>) =>
  promise.then(
    (changes) => ({ changes, error: null as unknown }),
    (error: unknown) => ({ changes: null, error }),
  );

beforeEach(async () => {
  world = await createThreadWorld("attonlydb");
});

afterEach(async () => {
  try {
    await cleanupAttachmentOnlyLeftovers();
  } finally {
    await cleanupAttachmentScenario();
  }
});

describe("#270 計画 2.3 Repository の守り：目印で添付なしは、DB に送る前に止める", () => {
  it.each([
    ["attachmentIds が空", { attachmentIds: [] as string[] }],
    ["attachmentIds の指定なし", {}],
  ])(
    "#270 AC-3: insertIfOrdered に目印の本文で %s を渡すと Error で、行は増えない",
    async (_label, extra) => {
      const before = await rowCount("messages");
      const outcome = await settle(
        withMessages(env, (repository) =>
          repository.insertIfOrdered({
            id: idAt(70),
            roomId: world.channel,
            senderId: world.alice.userId,
            senderDisplayName: "テスト太郎",
            body: STORED_EMPTY_BODY,
            createdAt: isoAt(70),
            ...extra,
          }),
        ),
      );
      expect(outcome.error).toBeInstanceOf(Error);
      expect(outcome.changes).toBeNull();
      expect(await rowCount("messages")).toBe(before);
      expect(await parentRow(idAt(70))).toBeNull();
    },
  );

  it("#270 AC-3: insertReplyIfOrdered に目印の本文で添付なしを渡すと Error で、返信は増えない", async () => {
    const parent = await seedParent(world.channel, world.bob.userId, 1);
    const before = await rowCount("messages");
    const outcome = await settle(
      withMessages(env, (repository) =>
        repository.insertReplyIfOrdered({
          id: idAt(71),
          roomId: world.channel,
          parentMessageId: parent,
          senderId: world.alice.userId,
          senderDisplayName: "テスト太郎",
          body: STORED_EMPTY_BODY,
          createdAt: isoAt(71),
          attachmentIds: [],
        }),
      ),
    );
    expect(outcome.error).toBeInstanceOf(Error);
    expect(await rowCount("messages")).toBe(before);
    expect(await parentRow(idAt(71))).toBeNull();
  });

  it("#270 AC-1（対照）: 目印の本文でも、添付が1件あれば insertIfOrdered は 1 を返し、本文は目印のまま保存される", async () => {
    const attachment = await insertAttachmentRow({
      roomId: world.channel,
      uploaderId: world.alice.userId,
    });
    const outcome = await settle(
      withMessages(env, (repository) =>
        repository.insertIfOrdered({
          id: idAt(72),
          roomId: world.channel,
          senderId: world.alice.userId,
          senderDisplayName: "テスト太郎",
          body: STORED_EMPTY_BODY,
          createdAt: isoAt(72),
          attachmentIds: [attachment],
        }),
      ),
    );
    expect(outcome).toEqual({ changes: 1, error: null });
    expect((await parentRow(idAt(72)))?.body).toBe(STORED_EMPTY_BODY);
  });
});

describe("#270 AC-4 目印の出口：本文を返す読み取りは、どれも空文字を返す", () => {
  /** 本文なしの親（添付1件）と、その親への本文なしの返信（添付1件）を直接入れる */
  async function seedBodyless() {
    const parentId = idAt(10);
    await insertBodylessMessage({
      roomId: world.channel,
      senderId: world.alice.userId,
      id: parentId,
      createdAt: isoAt(10),
    });
    await insertAttachmentRow({
      roomId: world.channel,
      uploaderId: world.alice.userId,
      messageId: parentId,
      originalName: "[UNIT_TEST]出口の親の添付.txt",
    });
    const replyId = idAt(11);
    await insertBodylessMessage({
      roomId: world.channel,
      senderId: world.bob.userId,
      id: replyId,
      createdAt: isoAt(11),
      parentMessageId: parentId,
    });
    await insertAttachmentRow({
      roomId: world.channel,
      uploaderId: world.bob.userId,
      messageId: replyId,
      threadParentId: parentId,
      originalName: "[UNIT_TEST]出口の返信の添付.txt",
    });
    return { parentId, replyId };
  }

  it("#270 AC-4: listLatest（部屋の一覧）の body は空文字（目印を返さない）。添付は出る", async () => {
    const { parentId } = await seedBodyless();
    const page = await withMessages(env, (repository) =>
      repository.listLatest(world.channel, 50, undefined, world.bob.userId),
    );
    const item = page.items.find((entry) => entry.id === parentId);
    expect(item?.body).toBe("");
    expect(item?.deleted).toBe(false);
    expect(item?.attachments).toHaveLength(1);
  });

  it("#270 AC-4: listAfter（最後の ID 以降の一覧）の body は空文字", async () => {
    const { parentId } = await seedBodyless();
    const page = await withMessages(env, (repository) =>
      repository.listAfter(world.channel, ZERO_ID, 50, world.bob.userId),
    );
    expect(page.items.find((entry) => entry.id === parentId)?.body).toBe("");
  });

  it("#270 AC-4: findItem（1件。スレッドの親の表示）の body は空文字", async () => {
    const { parentId } = await seedBodyless();
    const item = await withMessages(env, (repository) =>
      repository.findItem(parentId, world.bob.userId),
    );
    expect(item?.body).toBe("");
  });

  it("#270 AC-4: listRepliesLatest・listRepliesAfter（返信の一覧）の body は空文字", async () => {
    const { parentId, replyId } = await seedBodyless();
    const latest = await withMessages(env, (repository) =>
      repository.listRepliesLatest(parentId, 50, undefined, world.alice.userId),
    );
    expect(latest.items.find((entry) => entry.id === replyId)?.body).toBe("");
    const after = await withMessages(env, (repository) =>
      repository.listRepliesAfter(parentId, ZERO_ID, 50, world.alice.userId),
    );
    expect(after.items.find((entry) => entry.id === replyId)?.body).toBe("");
  });

  it("#270 AC-4: スレッド一覧（listThreads）の親の body は空文字", async () => {
    const { parentId } = await seedBodyless();
    const page = await withThreads(env, (repository) =>
      repository.listThreads(world.alice.userId, {
        limit: 20,
        includeDirect: true,
        includeCase: true,
      }),
    );
    const thread = page.items.find((entry) => entry.parent.id === parentId);
    expect(thread).toBeDefined();
    expect(thread?.parent.body).toBe("");
  });

  it("#270 AC-4（境界）: 目印と完全に等しくない本文（空白2文字・前に空白のある本文）は、そのまま返す", async () => {
    await env.DB.prepare(
      "INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at) VALUES (?, ?, ?, 'テスト太郎', ?, ?), (?, ?, ?, 'テスト太郎', ?, ?)",
    )
      .bind(
        idAt(20),
        world.channel,
        world.alice.userId,
        "  ",
        isoAt(20),
        idAt(21),
        world.channel,
        world.alice.userId,
        " a",
        isoAt(21),
      )
      .run();
    const page = await withMessages(env, (repository) =>
      repository.listLatest(world.channel, 50, undefined, world.bob.userId),
    );
    expect(page.items.find((entry) => entry.id === idAt(20))?.body).toBe("  ");
    expect(page.items.find((entry) => entry.id === idAt(21))?.body).toBe(" a");
  });

  it("#270 AC-4: 削除済みの本文なしの投稿は、これまでどおり body が null（空文字にしない）", async () => {
    const { parentId } = await seedBodyless();
    await env.DB.prepare(
      "UPDATE messages SET deleted_at = '2026-11-22T00:00:00.000Z', deleted_by = ? WHERE id = ?",
    )
      .bind(world.alice.userId, parentId)
      .run();
    const item = await withMessages(env, (repository) =>
      repository.findItem(parentId, world.bob.userId),
    );
    expect(item?.body).toBeNull();
    expect(item?.deleted).toBe(true);
  });
});
