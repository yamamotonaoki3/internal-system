// #137 AC-1・AC-4（1-4 AC-1・AC-4・U-2・U-3）: 返信が、部屋の一覧（EP-1-01）・部屋の未読（EP-3-01）・DM の一覧（EP-1-06）に与える影響を、実際のアプリ入口と隔離 D1 で確かめる。
// 契約（実装者へ。計画 決めたこと2・3、U-2、U-3）：
//  - EP-1-01（最新の一覧・after の両方）に、返信（parent_message_id が NULL でない行）は出ない。項目に parentMessageId（通常の投稿は常に null）と replyCount（その投稿への返信の件数。削除済みの返信も数える）が付く。
//  - 返信と通常の投稿が交互に入っても、部屋の after は通常の投稿を取りこぼさない（返信も同じ部屋の ID の並びに入る）。
//  - 部屋の未読（GET /api/me/unread）に返信を数えない（U-2）。DM 一覧の並び・lastMessageAt（最終活動）に返信を含めない（U-3）。
// データは架空（testuser_threffect_、[UNIT_TEST]、@example.com）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import { dmApi, insertDm } from "../../test/dm-fixtures";
import {
  insertReadPosition,
  insertMessagesAt,
} from "../../test/read-position-fixtures";
import { markDeleted } from "../../test/message-modify-fixtures";
import {
  TEST_TAG,
  ZERO,
  cleanupThreadScenario,
  createThreadWorld,
  isoAt,
  postReply,
  repliesOk,
  roomItems,
  seedParent,
  seedReply,
  type ThreadWorld,
} from "../../test/thread-fixtures";

let world: ThreadWorld;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  world = await createThreadWorld("threffect");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupThreadScenario();
});

describe("#137 AC-1（1-4 AC-1）部屋の一覧（EP-1-01）に返信は出ない", () => {
  it("#137 AC-1: 最新の一覧・after のどちらにも返信は出ず、通常の投稿だけが出る（parentMessageId は null）", async () => {
    const p1 = await seedParent(world.channel, world.alice.userId, 1);
    await seedReply(world.channel, p1, world.bob.userId, 2);
    const p2 = await seedParent(world.channel, world.bob.userId, 3);
    await seedReply(world.channel, p2, world.alice.userId, 4);
    await seedReply(world.channel, p1, world.dave.userId, 5);
    const latest = await roomItems(
      world.channel,
      "?limit=100",
      world.alice.token,
    );
    expect(latest.items.map((item) => item.id)).toEqual([p2, p1]);
    const after = await roomItems(
      world.channel,
      `?after=${ZERO}&limit=100`,
      world.alice.token,
    );
    expect(after.items.map((item) => item.id)).toEqual([p1, p2]);
    for (const item of [...latest.items, ...after.items])
      expect(item.parentMessageId, item.id).toBeNull();
  });

  it("#137 AC-1: 最新の一覧の nextCursor（limit で区切ったページ）にも返信は混ざらず、通常の投稿を重複・欠落なく辿れる", async () => {
    const parents: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const parent = await seedParent(
        world.channel,
        world.alice.userId,
        1 + i * 2,
      );
      parents.push(parent);
      await seedReply(world.channel, parent, world.bob.userId, 2 + i * 2);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i += 1) {
      const query: string =
        cursor === null ? "?limit=2" : `?limit=2&cursor=${cursor}`;
      const page = await roomItems(world.channel, query, world.alice.token);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? null;
      if (cursor === null) break;
    }
    expect(seen).toEqual([...parents].reverse());
  });

  it("#137 AC-1（replyCount）: 通常の投稿に replyCount が付き、返信の件数（削除済みも数える）を返す。返信のない投稿は 0", async () => {
    const withReplies = await seedParent(world.channel, world.alice.userId, 1);
    const without = await seedParent(world.channel, world.alice.userId, 2);
    await seedReply(world.channel, withReplies, world.bob.userId, 3);
    const gone = await seedReply(
      world.channel,
      withReplies,
      world.dave.userId,
      4,
    );
    await seedReply(world.channel, withReplies, world.bob.userId, 5);
    await markDeleted(gone, world.dave.userId);
    for (const query of ["?limit=100", `?after=${ZERO}&limit=100`]) {
      const page = await roomItems(world.channel, query, world.alice.token);
      const byId = new Map(page.items.map((item) => [item.id, item]));
      expect(byId.get(withReplies)?.replyCount, query).toBe(3);
      expect(byId.get(without)?.replyCount, query).toBe(0);
    }
  });

  it("#137 AC-1（replyCount）: 親を削除しても、一覧の削除済みの親の replyCount は返信の件数のまま", async () => {
    const parent = await seedParent(world.channel, world.alice.userId, 1);
    await seedReply(world.channel, parent, world.bob.userId, 2);
    await markDeleted(parent, world.alice.userId);
    const page = await roomItems(world.channel, "?limit=100", world.bob.token);
    expect(page.items[0]).toMatchObject({
      id: parent,
      deleted: true,
      body: null,
      replyCount: 1,
    });
  });

  it("#137 AC-1: 返信を API で投稿すると、親の replyCount が増え、部屋の一覧の項目は増えない", async () => {
    const parent = await seedParent(world.channel, world.alice.userId, 1);
    expect(
      (await roomItems(world.channel, "", world.alice.token)).items[0]
        ?.replyCount,
    ).toBe(0);
    for (const user of [world.bob, world.dave]) {
      expect(
        (await postReply(parent, { body: `${TEST_TAG}件数` }, user.token))
          .status,
      ).toBe(201);
    }
    const page = await roomItems(world.channel, "", world.alice.token);
    expect(page.items.map((item) => item.id)).toEqual([parent]);
    expect(page.items[0]?.replyCount).toBe(2);
    expect(
      (await repliesOk(parent, "", world.alice.token)).parent.replyCount,
    ).toBe(2);
  });

  it("#137 AC-1: 一覧の項目のキーは、これまでの項目に parentMessageId・replyCount を足したものだけ", async () => {
    await seedParent(world.channel, world.alice.userId, 1);
    const page = await roomItems(world.channel, "", world.alice.token);
    expect(Object.keys(page.items[0] ?? {}).sort()).toEqual(
      [
        "author",
        "body",
        "createdAt",
        "deleted",
        "editedAt",
        "id",
        "mentions",
        "parentMessageId",
        "replyCount",
        "roomId",
      ].sort(),
    );
  });
});

describe("#137 AC-1（決めたこと2）返信と通常の投稿が交互でも、部屋の after は取りこぼさない", () => {
  it("#137 AC-1: 投稿 → 返信 → 投稿 → 返信 → 投稿 を API で入れると、最初の投稿の ID を after にして、残りの通常の投稿が順に全部取れる", async () => {
    const posted: string[] = [];
    const replies: string[] = [];
    const post = async (user: typeof world.alice, text: string) => {
      const response = await apiRequest(
        "POST",
        `/api/rooms/${world.channel}/messages`,
        { token: user.token, body: { body: `${TEST_TAG}${text}` } },
      );
      expect(response.status).toBe(201);
      const id = ((await response.json()) as { id: string }).id;
      posted.push(id);
      return id;
    };
    const reply = async (parentId: string, user: typeof world.alice) => {
      const response = await postReply(
        parentId,
        { body: `${TEST_TAG}返信` },
        user.token,
      );
      expect(response.status).toBe(201);
      replies.push(((await response.json()) as { id: string }).id);
    };
    const first = await post(world.alice, "一つ目");
    await reply(first, world.bob);
    await post(world.bob, "二つ目");
    await reply(first, world.dave);
    await post(world.dave, "三つ目");
    const page = await roomItems(
      world.channel,
      `?after=${first}&limit=100`,
      world.alice.token,
    );
    expect(page.items.map((item) => item.id)).toEqual(posted.slice(1));
    // 返信の ID も、同じ部屋の ID の並びの中（通常の投稿の間）にあり、すべて昇順
    const all = [...posted, ...replies].sort();
    expect(all[0]).toBe(first);
    expect(replies.every((id) => id > first)).toBe(true);
  });

  it("#137 AC-1: 返信の ID を挟んだ部屋でも、直前の通常の投稿の ID を after にすると、その後の通常の投稿だけが返る", async () => {
    const p1 = await seedParent(world.channel, world.alice.userId, 1);
    await seedReply(world.channel, p1, world.bob.userId, 2);
    const p2 = await seedParent(world.channel, world.bob.userId, 3);
    await seedReply(world.channel, p1, world.dave.userId, 4);
    const p3 = await seedParent(world.channel, world.dave.userId, 5);
    const page = await roomItems(
      world.channel,
      `?after=${p1}&limit=100`,
      world.alice.token,
    );
    expect(page.items.map((item) => item.id)).toEqual([p2, p3]);
    expect(page.hasMore).toBe(false);
    const limited = await roomItems(
      world.channel,
      `?after=${p1}&limit=1`,
      world.alice.token,
    );
    expect(limited.items.map((item) => item.id)).toEqual([p2]);
    expect(limited.hasMore).toBe(true);
  });
});

describe("#137 AC-4（U-2）部屋の未読に返信を数えない", () => {
  async function unread(token: string) {
    const response = await apiRequest("GET", "/api/me/unread?limit=100", {
      token,
    });
    expect(response.status).toBe(200);
    const page = (await response.json()) as {
      items: { roomId: string; count: number }[];
    };
    return new Map(page.items.map((item) => [item.roomId, item.count]));
  }

  it("#137 AC-4（U-2）: チャンネルの未読は、通常の投稿だけを数え、返信（他人のもの・削除済みも）は数えない", async () => {
    await seedParent(world.channel, world.bob.userId, 1);
    const second = await seedParent(world.channel, world.bob.userId, 2);
    await seedReply(world.channel, second, world.dave.userId, 3);
    await seedReply(world.channel, second, world.bob.userId, 4);
    await seedReply(world.channel, second, world.dave.userId, 5);
    expect((await unread(world.alice.token)).get(world.channel)).toBe(2);
  });

  it("#137 AC-4（U-2）: 既読位置より後に返信だけが付いても、部屋の未読は増えず、部屋の項目が出ない", async () => {
    const parent = await seedParent(world.channel, world.bob.userId, 1);
    await insertReadPosition(world.alice.userId, world.channel, parent);
    await seedReply(world.channel, parent, world.bob.userId, 2);
    await seedReply(world.channel, parent, world.dave.userId, 3);
    expect((await unread(world.alice.token)).has(world.channel)).toBe(false);
  });

  it("#137 AC-4（U-2）: DM の未読も、通常の投稿だけを数える", async () => {
    const dm = await insertDm(world.alice.userId, world.bob.userId);
    const [first] = await insertMessagesAt(
      dm,
      world.bob.userId,
      Date.parse("2026-11-12T00:00:00.000Z"),
      1,
    );
    await seedReply(dm, first ?? "", world.bob.userId, 10);
    await seedReply(dm, first ?? "", world.bob.userId, 11);
    expect((await unread(world.alice.token)).get(dm)).toBe(1);
  });
});

describe("#137 AC-4（U-3）DM 一覧の並び・最終活動に返信を含めない", () => {
  type ListItem = { roomId: string; lastMessageAt: string | null };

  async function dmList(token: string): Promise<ListItem[]> {
    const response = await dmApi.list("?limit=100", token);
    expect(response.status).toBe(200);
    return ((await response.json()) as { items: ListItem[] }).items;
  }

  it("#137 AC-4（U-3）: 古い側の DM の親に新しい返信が付いても、DM 一覧の順は変わらず、lastMessageAt は最後の通常の投稿のまま", async () => {
    const older = await insertDm(world.alice.userId, world.bob.userId);
    const newer = await insertDm(world.alice.userId, world.dave.userId);
    const olderParent = await seedParent(older, world.bob.userId, 1);
    await seedParent(newer, world.dave.userId, 5);
    expect((await dmList(world.alice.token)).map((i) => i.roomId)).toEqual([
      newer,
      older,
    ]);
    await seedReply(older, olderParent, world.alice.userId, 10);
    await seedReply(older, olderParent, world.bob.userId, 11);
    const list = await dmList(world.alice.token);
    expect(list.map((i) => i.roomId)).toEqual([newer, older]);
    expect(list.find((i) => i.roomId === older)?.lastMessageAt).toBe(isoAt(1));
  });
});
