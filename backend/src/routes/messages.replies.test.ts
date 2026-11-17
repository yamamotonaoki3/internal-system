// #137 AC-1（1-4 AC-1）: 返信の投稿（EP-1-08 POST /api/messages/:messageId/replies）と取得（EP-1-07 GET 同じパス）を、実際のアプリ入口（index.ts の app）と隔離 D1 で確かめる。
// 契約（実装者へ。計画 決めたこと1・3・4・5）：
//  - POST 本文 { body }（strict。messageBodySchema：空・空白だけ・4,001文字以上・余分な項目は 422 VALIDATION_ERROR。4,000文字は通る）
//      → 201 { id, roomId, parentMessageId, createdAt }。返信は親と同じ部屋に、parent_message_id つきで入る。返信への返信・存在しない親は 404 NOT_FOUND。
//  - GET ?after=<ID>&limit（ID昇順で after より後。応答は EP-1-01 と同じ { items, hasMore }）／?cursor&limit（新しい順。{ items, nextCursor }。既定50・最大100）。
//      どちらにも応答に parent（親の1件。MessageItem と同じ項目＋ parentMessageId: null・replyCount。削除済みなら deleted: true・body: null）と
//      replyBlockedReason（返信できない理由。できるなら null）が付く。after と cursor の同時指定・limit 101 は 422。
//  - 項目（items[]）は MessageItem と同じ項目に parentMessageId（親の ID）・replyCount（返信には 0）を足したもの。削除済みの返信は deleted: true・body: null で、一覧に残る。
//  - 返信の取得は他のスレッドの返信・通常の投稿を含まない。GET で DB は変わらない。
// 認可の各場合・削除済みの親・競合は messages.replies.authz.test.ts・services/message.reply-*.test.ts。
// データは架空（testuser_reply_、[UNIT_TEST]、@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertReplies } from "../../test/message-fixtures";
import {
  TEST_TAG,
  ISO,
  ZERO,
  cleanupThreadScenario,
  codeOf,
  createThreadWorld,
  getReplies,
  idAt,
  isoAt,
  postReply,
  replyRows,
  repliesOk,
  roomRowCount,
  seedParent,
  seedReply,
  type ThreadWorld,
} from "../../test/thread-fixtures";
import { markDeleted } from "../../test/message-modify-fixtures";

let world: ThreadWorld;
let parent: string;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  world = await createThreadWorld("reply");
  parent = await seedParent(world.channel, world.alice.userId, 1);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupThreadScenario();
});

describe("#137 AC-1（1-4 AC-1）返信の投稿", () => {
  it("#137 AC-1（1-4 AC-1）: 参加者の返信は 201 で { id, roomId, parentMessageId, createdAt } を返し、親と同じ部屋に parent_message_id つきで入る", async () => {
    const response = await postReply(
      parent,
      { body: `${TEST_TAG}最初の返信` },
      world.bob.token,
    );
    expect(response.status).toBe(201);
    const created = (await response.json()) as Record<string, unknown>;
    expect(created).toEqual({
      id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/) as string,
      roomId: world.channel,
      parentMessageId: parent,
      createdAt: expect.stringMatching(ISO) as string,
    });
    const rows = await replyRows(parent);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: created.id,
      room_id: world.channel,
      sender_id: world.bob.userId,
      body: `${TEST_TAG}最初の返信`,
      parent_message_id: parent,
    });
  });

  it("#137 AC-1: 親の投稿者本人も、自分の投稿に返信できる", async () => {
    const response = await postReply(
      parent,
      { body: `${TEST_TAG}自分の投稿への返信` },
      world.alice.token,
    );
    expect(response.status).toBe(201);
  });

  it("#137 AC-1（EP-1-07）: 返信は after で ID昇順に取れ、最新の取得では新しい順に取れる。2回目の返信の ID は1回目より大きい", async () => {
    const ids: string[] = [];
    for (const [i, user] of [world.bob, world.dave, world.bob].entries()) {
      const response = await postReply(
        parent,
        { body: `${TEST_TAG}返信${i}` },
        user.token,
      );
      expect(response.status).toBe(201);
      ids.push(((await response.json()) as { id: string }).id);
    }
    expect([...ids].sort()).toEqual(ids);
    const after = await repliesOk(parent, `?after=${ZERO}`, world.alice.token);
    expect(after.items.map((item) => item.id)).toEqual(ids);
    expect(after.hasMore).toBe(false);
    const latest = await repliesOk(parent, "", world.alice.token);
    expect(latest.items.map((item) => item.id)).toEqual([...ids].reverse());
    expect(latest.nextCursor).toBeNull();
    expect(latest.items[0]).toMatchObject({
      parentMessageId: parent,
      roomId: world.channel,
      author: { id: world.bob.userId, isActive: true },
      deleted: false,
      editedAt: null,
      replyCount: 0,
    });
  });

  it("#137 AC-1（EP-1-07）: after は「最後の ID より後」だけを返す。返信がなければ空", async () => {
    const first = await seedReply(world.channel, parent, world.bob.userId, 2);
    const second = await seedReply(world.channel, parent, world.dave.userId, 3);
    const page = await repliesOk(parent, `?after=${first}`, world.alice.token);
    expect(page.items.map((item) => item.id)).toEqual([second]);
    const empty = await repliesOk(
      parent,
      `?after=${second}`,
      world.alice.token,
    );
    expect(empty.items).toEqual([]);
    expect(empty.hasMore).toBe(false);
  });

  it("#137 AC-1（EP-1-07）: limit と hasMore（after）・nextCursor（最新）でページを送れ、全件を重複・欠落なく辿れる", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1)
      ids.push(await seedReply(world.channel, parent, world.bob.userId, 2 + i));
    const afterFirst = await repliesOk(
      parent,
      `?after=${ZERO}&limit=2`,
      world.alice.token,
    );
    expect(afterFirst.items.map((i) => i.id)).toEqual(ids.slice(0, 2));
    expect(afterFirst.hasMore).toBe(true);
    const seen: string[] = [];
    let cursor: string | null | undefined = undefined;
    for (let i = 0; i < 10; i += 1) {
      const query: string =
        cursor === undefined ? "?limit=2" : `?limit=2&cursor=${cursor}`;
      const page = await repliesOk(parent, query, world.alice.token);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      if (cursor === null || cursor === undefined) break;
    }
    expect(seen).toEqual([...ids].reverse());
  });

  it("#137 AC-1（EP-1-07）: 既定は50件・limit 100 まで、101 と after・cursor の同時指定は 422", async () => {
    const seeds = Array.from({ length: 55 }, (_, i) => ({
      id: idAt(2 + i),
      roomId: world.channel,
      senderId: world.bob.userId,
      parentMessageId: parent,
      body: `${TEST_TAG}多数${i}`,
      createdAt: isoAt(2 + i),
    }));
    await insertReplies(seeds);
    const byDefault = await repliesOk(parent, "", world.alice.token);
    expect(byDefault.items).toHaveLength(50);
    expect(byDefault.nextCursor).toEqual(expect.any(String));
    const all = await repliesOk(parent, "?limit=100", world.alice.token);
    expect(all.items).toHaveLength(55);
    for (const query of [
      "?limit=101",
      "?limit=0",
      `?after=${ZERO}&limit=101`,
      `?after=${ZERO}&cursor=abc`,
      "?cursor=%E3%81%93%E3%82%8F%E3%82%8C%E3%81%9F",
      "?after=not-a-ulid",
    ]) {
      const response = await getReplies(parent, query, world.alice.token);
      expect(response.status, query).toBe(422);
      expect(await codeOf(response)).toBe("VALIDATION_ERROR");
    }
  });

  it("#137 AC-1（EP-1-07）: 取得に含まれるのは、そのスレッドの返信だけ（別のスレッドの返信・通常の投稿・親そのものは含まない）", async () => {
    const otherParent = await seedParent(world.channel, world.bob.userId, 2);
    const mine = await seedReply(world.channel, parent, world.bob.userId, 3);
    await seedReply(world.channel, otherParent, world.dave.userId, 4);
    await seedParent(world.channel, world.dave.userId, 5);
    const page = await repliesOk(parent, "", world.alice.token);
    expect(page.items.map((item) => item.id)).toEqual([mine]);
    expect(page.parent).toMatchObject({ id: parent, replyCount: 1 });
  });

  it("#137 AC-1（EP-1-07）: parent は親の1件（MessageItem の項目＋ parentMessageId: null・replyCount）で、返信できるなら replyBlockedReason は null", async () => {
    await seedReply(world.channel, parent, world.bob.userId, 2);
    await seedReply(world.channel, parent, world.bob.userId, 3);
    const page = await repliesOk(parent, "", world.bob.token);
    expect(page.replyBlockedReason).toBeNull();
    expect(page.parent).toMatchObject({
      id: parent,
      roomId: world.channel,
      parentMessageId: null,
      replyCount: 2,
      author: { id: world.alice.userId, isActive: true },
      body: `${TEST_TAG}親1`,
      deleted: false,
      editedAt: null,
    });
    expect(Object.keys(page.parent).sort()).toEqual(
      [
        "attachments",
        "author",
        "body",
        "createdAt",
        "deleted",
        "editedAt",
        "id",
        "mentions",
        "parentMessageId",
        "reactions",
        "replyCount",
        "roomId",
      ].sort(),
    );
  });

  it("#137 AC-1（EP-1-07）: 取得は DB を変えない（行も既読位置も増えない）", async () => {
    await seedReply(world.channel, parent, world.bob.userId, 2);
    const before = await roomRowCount(world.channel);
    const positions = (
      await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM thread_read_positions",
      ).first<{
        n: number;
      }>()
    )?.n;
    await getReplies(parent, "", world.alice.token);
    await getReplies(parent, `?after=${ZERO}`, world.alice.token);
    expect(await roomRowCount(world.channel)).toBe(before);
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM thread_read_positions",
        ).first<{ n: number }>()
      )?.n,
    ).toBe(positions);
  });

  it("#137 AC-1: 削除済みの返信は一覧に残り、deleted: true・body: null（投稿者と日時は残す）。replyCount にも数える", async () => {
    const kept = await seedReply(world.channel, parent, world.bob.userId, 2);
    const gone = await seedReply(world.channel, parent, world.dave.userId, 3);
    await markDeleted(gone, world.dave.userId);
    const page = await repliesOk(parent, `?after=${ZERO}`, world.alice.token);
    expect(page.items.map((item) => item.id)).toEqual([kept, gone]);
    expect(page.items[1]).toMatchObject({
      id: gone,
      body: null,
      deleted: true,
      editedAt: null,
      author: { id: world.dave.userId },
      createdAt: isoAt(3),
    });
    expect(page.parent.replyCount).toBe(2);
  });
});

describe("#137 AC-1（1-4 AC-1）返信の本文の入力", () => {
  it.each<[string, unknown]>([
    ["空文字", { body: "" }],
    ["空白だけ", { body: "   " }],
    ["改行・タブだけ", { body: "\n\t \n" }],
    ["4,001文字", { body: "あ".repeat(4001) }],
    ["body がない", {}],
    ["body が数値", { body: 1 }],
    ["body が null", { body: null }],
    ["余分な項目（親の指定）", { body: `${TEST_TAG}x`, parentMessageId: "x" }],
    ["余分な項目（投稿者の指定）", { body: `${TEST_TAG}x`, senderId: "x" }],
    ["配列", [`${TEST_TAG}x`]],
  ])(
    "#137 AC-1（1-4 AC-1）: %s は 422 VALIDATION_ERROR で、行は増えない",
    async (_label, payload) => {
      const before = await roomRowCount(world.channel);
      const response = await postReply(parent, payload, world.bob.token);
      expect(response.status).toBe(422);
      expect(await codeOf(response)).toBe("VALIDATION_ERROR");
      expect(await roomRowCount(world.channel)).toBe(before);
    },
  );

  it("#137 AC-1（1-4 AC-1）: ちょうど4,000文字は 201 で、そのまま保存される", async () => {
    const text = "あ".repeat(4000);
    const response = await postReply(parent, { body: text }, world.bob.token);
    expect(response.status).toBe(201);
    expect((await replyRows(parent))[0]?.body).toBe(text);
  });

  it("#137 AC-1: 前後の空白・SQL の特殊文字・HTML を含む本文は、そのまま保存され、そのまま返る", async () => {
    const text = " ' ; -- OR 1=1 --\n<script>x</script> ";
    const response = await postReply(parent, { body: text }, world.bob.token);
    expect(response.status).toBe(201);
    expect((await replyRows(parent))[0]?.body).toBe(text);
    const page = await repliesOk(parent, "", world.alice.token);
    expect(page.items[0]?.body).toBe(text);
  });
});

describe("#137 AC-1（1-4 AC-1）返信できない親", () => {
  it("#137 AC-1（返信は1段）: 返信への返信は 404 NOT_FOUND で、行は増えない。返信の取得（GET）も 404", async () => {
    const reply = await seedReply(world.channel, parent, world.bob.userId, 2);
    const before = await roomRowCount(world.channel);
    const post = await postReply(
      reply,
      { body: `${TEST_TAG}孫` },
      world.alice.token,
    );
    expect(post.status).toBe(404);
    expect(await codeOf(post)).toBe("NOT_FOUND");
    const get = await getReplies(reply, "", world.alice.token);
    expect(get.status).toBe(404);
    expect(await roomRowCount(world.channel)).toBe(before);
  });

  it("#137 AC-1: 存在しない ID（ULID の形）は 404 NOT_FOUND", async () => {
    const missing = idAt(999);
    const post = await postReply(
      missing,
      { body: `${TEST_TAG}x` },
      world.alice.token,
    );
    expect(post.status).toBe(404);
    expect(await codeOf(post)).toBe("NOT_FOUND");
    expect((await getReplies(missing, "", world.alice.token)).status).toBe(404);
  });
});
