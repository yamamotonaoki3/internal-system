// #140 AC-1（1-6 AC-2・AC-3・AC-7）: 添付の可視性の条件（attachment-visibility.sql.ts）と、投稿・返信の batch の中の結び付け（条件付きの UPDATE）を、隔離 D1 で確かめる。
// 計画「方式」4・5、「情報漏えいの経路と対策」、「同時の操作」。
//   可視性：非公開チャンネルは参加者だけ／公開チャンネルは未参加でも見える／DM は当事者だけ／messages.deleted_at IS NULL／未投稿はアップロードした本人だけ。
//   同じ事例表を、一覧（routes/messages.attachments.test.ts）と配信（ここと routes/attachments.test.ts）に当てる。
//   結び付け：id IN (...) AND uploader_id=本人 AND room_id=部屋 AND message_id IS NULL、通常の投稿は thread_parent_id IS NULL、返信は thread_parent_id = 親。
//   件数（10件）と合計（200,000,000バイト）を CASE WHEN … NULL で確かめ、合わなければ batch 全体が失敗する（メッセージも作られない）。
//
// 実装が前提とする約束（このテストが固定する）：
//   attachment.repository.ts：withAttachments(env, run: (repository) => Promise<T>)
//     repository.findVisible(attachmentId, viewerId): Promise<{ id; storageKey; originalName; kind; contentType; sizeBytes } | null>
//   message.repository.ts：insertIfOrdered(input) と insertReplyIfOrdered(input) の input に attachmentIds?: readonly string[] を足す。
//     結び付けの条件が崩れたら、メッセージを作らず（戻り値は 1 以外か、例外）、添付の行も変えない。
// データは架空（testuser_attdb_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TEST_TAG,
  attachmentIdsOf,
  attachmentRow,
  cleanupAttachmentScenario,
  createThreadWorld,
  insertAttachmentRow,
  type ThreadWorld,
} from "../../test/attachment-fixtures";
import {
  ATTACHMENT_UPDATE,
  interleavingDb,
  markAttachmentDeleted,
} from "../../test/attachment-delete-fixtures";
import {
  STORED_EMPTY_BODY,
  cleanupAttachmentOnlyLeftovers,
  emptyPostsWithoutAttachments,
  rowCount,
} from "../../test/attachment-only-fixtures";
import { insertChannel, insertMember } from "../../test/department-fixtures";
import { insertDm } from "../../test/dm-fixtures";
import { leaveChannel, markDeleted } from "../../test/message-modify-fixtures";
import { idAt, isoAt, parentRow, seedParent } from "../../test/thread-fixtures";
import { withAttachments } from "./attachment.repository";
import { withMessages, type MessageRepository } from "./message.repository";

let world: ThreadWorld;

const findVisible = (attachmentId: string, viewerId: string) =>
  withAttachments(env, (repository) =>
    repository.findVisible(attachmentId, viewerId),
  );

type PostInput = Parameters<MessageRepository["insertIfOrdered"]>[0] & {
  attachmentIds?: readonly string[];
};
type ReplyInput = Parameters<MessageRepository["insertReplyIfOrdered"]>[0] & {
  attachmentIds?: readonly string[];
};

/** 結果：挿入した行数、または例外（どちらでも「メッセージがないこと」を別に確かめる） */
const settle = (promise: Promise<number>) =>
  promise.then(
    (changes) => ({ changes }),
    (error: unknown) => ({ error }),
  );

const post = (
  input: Partial<PostInput> & { attachmentIds: readonly string[] },
) =>
  settle(
    withMessages(env, (repository) =>
      repository.insertIfOrdered({
        id: idAt(50),
        roomId: world.channel,
        senderId: world.alice.userId,
        senderDisplayName: "テスト太郎",
        body: `${TEST_TAG}添付つき`,
        createdAt: isoAt(50),
        ...input,
      } as PostInput),
    ),
  );

const reply = (
  parentId: string,
  input: Partial<ReplyInput> & { attachmentIds: readonly string[] },
) =>
  settle(
    withMessages(env, (repository) =>
      repository.insertReplyIfOrdered({
        id: idAt(60),
        roomId: world.channel,
        parentMessageId: parentId,
        senderId: world.alice.userId,
        senderDisplayName: "テスト太郎",
        body: `${TEST_TAG}返信の添付つき`,
        createdAt: isoAt(60),
        ...input,
      } as ReplyInput),
    ),
  );

beforeEach(async () => {
  world = await createThreadWorld("attdb");
});

afterEach(async () => {
  try {
    await cleanupAttachmentOnlyLeftovers();
  } finally {
    await cleanupAttachmentScenario();
  }
});

describe("#140 AC-1（1-6 AC-2・AC-7）可視性の事例表（配信の条件）", () => {
  it("#140 AC-1（1-6 AC-2）: 公開チャンネルの投稿の添付は、参加者にも未参加者（carol）にも見える", async () => {
    const message = await seedParent(world.channel, world.alice.userId, 1);
    const id = await insertAttachmentRow({
      roomId: world.channel,
      uploaderId: world.alice.userId,
      messageId: message,
      originalName: "公開.txt",
    });
    expect(await findVisible(id, world.bob.userId)).toMatchObject({
      id,
      originalName: "公開.txt",
      kind: "document",
      contentType: "text/plain; charset=utf-8",
      sizeBytes: 10,
    });
    expect(await findVisible(id, world.carol.userId)).toMatchObject({ id });
  });

  it("#140 AC-1（1-6 AC-2）: 非公開チャンネルの添付は参加者だけに見え、未参加者には見えない。脱退した後は見えない", async () => {
    const secret = await insertChannel({
      name: `${TEST_TAG}添付の非公開`,
      purpose: "normal",
      departmentId: world.dept.id,
      visibility: "private",
    });
    await insertMember(secret, world.alice.userId);
    await insertMember(secret, world.bob.userId);
    const message = await seedParent(secret, world.alice.userId, 2);
    const id = await insertAttachmentRow({
      roomId: secret,
      uploaderId: world.alice.userId,
      messageId: message,
    });
    expect(await findVisible(id, world.bob.userId)).toMatchObject({ id });
    expect(await findVisible(id, world.carol.userId)).toBeNull();
    await leaveChannel(secret, world.bob.userId);
    expect(await findVisible(id, world.bob.userId)).toBeNull();
  });

  it("#140 AC-1（1-6 AC-2）: DM の添付は当事者だけに見え、第三者には見えない", async () => {
    const dm = await insertDm(world.alice.userId, world.bob.userId);
    const message = await seedParent(dm, world.alice.userId, 3);
    const id = await insertAttachmentRow({
      roomId: dm,
      uploaderId: world.alice.userId,
      messageId: message,
    });
    expect(await findVisible(id, world.bob.userId)).toMatchObject({ id });
    expect(await findVisible(id, world.alice.userId)).toMatchObject({ id });
    expect(await findVisible(id, world.carol.userId)).toBeNull();
  });

  it("#140 AC-1（1-6 AC-2）: メッセージを削除した後の添付は、投稿者本人にも見えない", async () => {
    const message = await seedParent(world.channel, world.alice.userId, 4);
    const id = await insertAttachmentRow({
      roomId: world.channel,
      uploaderId: world.alice.userId,
      messageId: message,
    });
    await markDeleted(message, world.alice.userId);
    expect(await findVisible(id, world.alice.userId)).toBeNull();
    expect(await findVisible(id, world.bob.userId)).toBeNull();
  });

  it("#140 AC-1（1-6 AC-2）: 未投稿の添付は、アップロードした本人だけに見え、同じ部屋の参加者にも見えない", async () => {
    const id = await insertAttachmentRow({
      roomId: world.channel,
      uploaderId: world.alice.userId,
    });
    expect(await findVisible(id, world.alice.userId)).toMatchObject({ id });
    expect(await findVisible(id, world.bob.userId)).toBeNull();
  });

  it("#140 AC-1（1-6 AC-2）: 存在しない添付は null", async () => {
    expect(
      await findVisible("01ZZZZZZZZZZZZZZZZZZZZZZZZ", world.alice.userId),
    ).toBeNull();
  });

  it("#140 AC-1（1-6 AC-3）: 保存名（storageKey）は元の名前を含まない", async () => {
    const message = await seedParent(world.channel, world.alice.userId, 5);
    const id = await insertAttachmentRow({
      roomId: world.channel,
      uploaderId: world.alice.userId,
      messageId: message,
      originalName: "秘密の名前.txt",
    });
    const found = await findVisible(id, world.alice.userId);
    expect(found?.storageKey).not.toContain("秘密の名前");
  });
});

describe("#140 AC-1（1-6 AC-1・AC-3）通常の投稿への結び付け", () => {
  it("#140 AC-1: 本人・同じ部屋・通常の投稿用の未投稿の添付は、投稿と同じ batch で結び付く", async () => {
    const a = await insertAttachmentRow({
      roomId: world.channel,
      uploaderId: world.alice.userId,
    });
    const b = await insertAttachmentRow({
      roomId: world.channel,
      uploaderId: world.alice.userId,
    });
    expect(await post({ attachmentIds: [a, b] })).toEqual({ changes: 1 });
    expect(await attachmentIdsOf(idAt(50))).toEqual([a, b].sort());
  });

  it("#140 AC-1: 添付なし（空の配列）の投稿は従来どおり作られる", async () => {
    expect(await post({ attachmentIds: [] })).toEqual({ changes: 1 });
    expect(await parentRow(idAt(50))).not.toBeNull();
  });

  const rejected = async (
    label: string,
    ids: () => Promise<string[]>,
  ): Promise<void> => {
    const attachmentIds = await ids();
    const before = await Promise.all(attachmentIds.map(attachmentRow));
    const outcome = await post({ attachmentIds });
    expect(outcome, label).not.toEqual({ changes: 1 });
    expect(await parentRow(idAt(50)), label).toBeNull();
    expect(await Promise.all(attachmentIds.map(attachmentRow)), label).toEqual(
      before,
    );
  };

  it("#140 AC-1: 他人がアップロードした添付を含むと、batch 全体が失敗し、メッセージも作られない", async () => {
    await rejected("他人", async () => [
      await insertAttachmentRow({
        roomId: world.channel,
        uploaderId: world.alice.userId,
      }),
      await insertAttachmentRow({
        roomId: world.channel,
        uploaderId: world.bob.userId,
      }),
    ]);
  });

  it("#140 AC-1: 別の部屋の添付を含むと失敗する", async () => {
    const other = await insertChannel({
      name: `${TEST_TAG}添付の別の部屋`,
      purpose: "normal",
      departmentId: world.dept.id,
    });
    await insertMember(other, world.alice.userId);
    await rejected("別の部屋", async () => [
      await insertAttachmentRow({
        roomId: other,
        uploaderId: world.alice.userId,
      }),
    ]);
  });

  it("#140 AC-1（お知らせ専用の回避の防止）: 返信用にアップロードした添付（thread_parent_id あり）は、通常の投稿に結び付かない", async () => {
    const parent = await seedParent(world.channel, world.bob.userId, 1);
    await rejected("別の文脈", async () => [
      await insertAttachmentRow({
        roomId: world.channel,
        uploaderId: world.alice.userId,
        threadParentId: parent,
      }),
    ]);
  });

  it("#140 AC-1: 使用済み（別のメッセージに結び付いた）の添付は失敗する（同じ添付を2つの投稿が使うと、後の方は作られない）", async () => {
    const id = await insertAttachmentRow({
      roomId: world.channel,
      uploaderId: world.alice.userId,
    });
    expect(
      await post({ id: idAt(40), createdAt: isoAt(40), attachmentIds: [id] }),
    ).toEqual({ changes: 1 });
    const outcome = await post({ attachmentIds: [id] });
    expect(outcome).not.toEqual({ changes: 1 });
    expect(await parentRow(idAt(50))).toBeNull();
    expect((await attachmentRow(id))?.message_id).toBe(idAt(40));
  });

  it("#140 AC-1: 存在しない添付を含むと失敗する", async () => {
    await rejected("存在しない", async () => [
      await insertAttachmentRow({
        roomId: world.channel,
        uploaderId: world.alice.userId,
      }),
      "01ZZZZZZZZZZZZZZZZZZZZZZZZ",
    ]);
  });

  it("#140 AC-1（1-6 AC-1）: 10件は結び付き、11件は失敗する", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 11; i += 1)
      ids.push(
        await insertAttachmentRow({
          roomId: world.channel,
          uploaderId: world.alice.userId,
          sizeBytes: 1,
        }),
      );
    await rejected("11件", async () => ids);
    expect(await post({ attachmentIds: ids.slice(0, 10) })).toEqual({
      changes: 1,
    });
    expect(await attachmentIdsOf(idAt(50))).toHaveLength(10);
  });

  it("#140 AC-1（1-6 AC-3）: 合計がちょうど200,000,000バイトは結び付き、1バイト超えると失敗する", async () => {
    const make = (sizeBytes: number) =>
      insertAttachmentRow({
        roomId: world.channel,
        uploaderId: world.alice.userId,
        kind: "video",
        contentType: "video/mp4",
        sizeBytes,
      });
    const over = [
      await make(100_000_000),
      await make(100_000_000),
      await make(1),
    ];
    await rejected("合計の超過", async () => over);
    expect(await post({ attachmentIds: over.slice(0, 2) })).toEqual({
      changes: 1,
    });
  });
});

describe("#140 AC-1（1-6 AC-9）・AC-2（1-4 AC-5）返信への結び付け", () => {
  it("#140 AC-2（1-4 AC-5）: 同じ親の返信用にアップロードした添付は、その親への返信に結び付く", async () => {
    const parent = await seedParent(world.channel, world.bob.userId, 1);
    const id = await insertAttachmentRow({
      roomId: world.channel,
      uploaderId: world.alice.userId,
      threadParentId: parent,
    });
    expect(await reply(parent, { attachmentIds: [id] })).toEqual({
      changes: 1,
    });
    expect(await attachmentIdsOf(idAt(60))).toEqual([id]);
  });

  it.each([
    ["通常の投稿用（thread_parent_id が NULL）", "none"],
    ["別の親の返信用", "other"],
  ] as const)(
    "#140 AC-2（1-4 AC-5）: %sの添付は返信に結び付かず、返信も作られない",
    async (_label, context) => {
      const parent = await seedParent(world.channel, world.bob.userId, 1);
      const otherParent = await seedParent(world.channel, world.bob.userId, 2);
      const id = await insertAttachmentRow({
        roomId: world.channel,
        uploaderId: world.alice.userId,
        threadParentId: context === "none" ? null : otherParent,
      });
      const outcome = await reply(parent, { attachmentIds: [id] });
      expect(outcome).not.toEqual({ changes: 1 });
      expect(await parentRow(idAt(60))).toBeNull();
      expect((await attachmentRow(id))?.message_id).toBeNull();
    },
  );
});

// ---- #270（270-B）AC-3：本文が目印（本文なし）の投稿・返信の結び付けの原子性（計画 6章「AC-3（原子性。対応の表）」の「足すもの」）----
// 根拠：計画 AC-3（指定した添付が1件でも結び付かなければ、メッセージ・指名・通知・索引のどれも残らない。本文も添付もないメッセージは DB に残らない）・
//   計画 2.4（投稿・返信の batch に新しい不変条件の文は足さず、結び付けの件数の確かめで守る）・F-3（削除済みの添付は結び付き済み）。
// 既存の事例（他人・別の部屋・別の文脈・使用済み・存在しない・11件・合計の超過）は上の describe のまま（本文の有無に依らない batch の SQL）。
// ここは、本文が目印のときにも同じく取り消されることと、付随の行（指名・通知・索引）が残らないことを足す。
// 掃除で消えた添付（c）は、結び付けの UPDATE を含む batch の直前に、未投稿の掃除（deletePendingBefore）を確定させる（interleavingDb）。
describe("#270 AC-3 本文が目印の投稿・返信の結び付けの原子性", () => {
  const MENTION = () => [{ userId: world.bob.userId, start: 0, end: 1 }];

  const counts = async () => ({
    messages: await rowCount("messages"),
    mentions: await rowCount("message_mentions"),
    notifications: await rowCount("notifications"),
    documents: await rowCount("search_documents"),
  });

  it("#270 AC-3 (a): 正しい添付1件と他人の添付1件を混ぜた、本文なしの投稿は、メッセージ・指名・通知・索引のどれも残らず、正しい添付は未投稿のまま", async () => {
    const mine = await insertAttachmentRow({
      roomId: world.channel,
      uploaderId: world.alice.userId,
    });
    const theirs = await insertAttachmentRow({
      roomId: world.channel,
      uploaderId: world.bob.userId,
    });
    const before = await counts();
    const outcome = await post({
      body: STORED_EMPTY_BODY,
      mentions: MENTION(),
      attachmentIds: [mine, theirs],
    });
    expect(outcome).not.toEqual({ changes: 1 });
    expect(await parentRow(idAt(50))).toBeNull();
    expect(await counts()).toEqual(before);
    expect((await attachmentRow(mine))?.message_id).toBeNull();
    expect(await emptyPostsWithoutAttachments()).toEqual([]);
  });

  it("#270 AC-3 (a)（返信）: 正しい添付と他人の添付を混ぜた、本文なしの返信も、何も残らない", async () => {
    const parent = await seedParent(world.channel, world.bob.userId, 1);
    const mine = await insertAttachmentRow({
      roomId: world.channel,
      uploaderId: world.alice.userId,
      threadParentId: parent,
    });
    const theirs = await insertAttachmentRow({
      roomId: world.channel,
      uploaderId: world.bob.userId,
      threadParentId: parent,
    });
    const before = await counts();
    const outcome = await reply(parent, {
      body: STORED_EMPTY_BODY,
      mentions: MENTION(),
      attachmentIds: [mine, theirs],
    });
    expect(outcome).not.toEqual({ changes: 1 });
    expect(await parentRow(idAt(60))).toBeNull();
    expect(await counts()).toEqual(before);
    expect((await attachmentRow(mine))?.message_id).toBeNull();
  });

  it("#270 AC-3 (b): 削除済みの添付（別のメッセージに結び付いて削除の印のある行）を指定した、本文なしの投稿は失敗し、何も残らない", async () => {
    const other = await seedParent(world.channel, world.alice.userId, 2);
    const deleted = await insertAttachmentRow({
      roomId: world.channel,
      uploaderId: world.alice.userId,
      messageId: other,
    });
    await markAttachmentDeleted(deleted, world.alice.userId);
    const before = await counts();
    const outcome = await post({
      body: STORED_EMPTY_BODY,
      attachmentIds: [deleted],
    });
    expect(outcome).not.toEqual({ changes: 1 });
    expect(await parentRow(idAt(50))).toBeNull();
    expect(await counts()).toEqual(before);
    expect((await attachmentRow(deleted))?.message_id).toBe(other);
  });

  it.each(["post", "reply"] as const)(
    "#270 AC-3 (c): 結び付けの batch の直前に、未投稿の掃除で添付が消えると、本文なしの %s は失敗し、メッセージと付随のデータが残らない",
    async (kind) => {
      const parent =
        kind === "reply"
          ? await seedParent(world.channel, world.bob.userId, 3)
          : null;
      const attachment = await insertAttachmentRow({
        roomId: world.channel,
        uploaderId: world.alice.userId,
        threadParentId: parent,
      });
      const before = await counts();
      const interleaved = interleavingDb(
        env.DB,
        async () => {
          const removed = await withAttachments(env, (repository) =>
            repository.deletePendingBefore("2999-01-01T00:00:00.000Z"),
          );
          expect(removed.length).toBeGreaterThanOrEqual(1);
        },
        ATTACHMENT_UPDATE,
      );
      const wrappedEnv = { ...env, DB: interleaved.db } as unknown as Env;
      const outcome = await settle(
        withMessages(wrappedEnv, (repository) =>
          kind === "post"
            ? repository.insertIfOrdered({
                id: idAt(50),
                roomId: world.channel,
                senderId: world.alice.userId,
                senderDisplayName: "テスト太郎",
                body: STORED_EMPTY_BODY,
                createdAt: isoAt(50),
                mentions: MENTION(),
                attachmentIds: [attachment],
              })
            : repository.insertReplyIfOrdered({
                id: idAt(60),
                roomId: world.channel,
                parentMessageId: parent ?? "",
                senderId: world.alice.userId,
                senderDisplayName: "テスト太郎",
                body: STORED_EMPTY_BODY,
                createdAt: isoAt(60),
                mentions: MENTION(),
                attachmentIds: [attachment],
              }),
        ),
      );
      expect(interleaved.state.ran).toBe(true);
      expect(outcome).not.toEqual({ changes: 1 });
      expect(await parentRow(kind === "post" ? idAt(50) : idAt(60))).toBeNull();
      expect(await attachmentRow(attachment)).toBeNull();
      expect(await counts()).toEqual(before);
      expect(await emptyPostsWithoutAttachments()).toEqual([]);
    },
  );
});
