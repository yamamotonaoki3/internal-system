// #138 AC-1（1-7 AC-1〜AC-3）・AC-2（1-4 AC-6）: 投稿の一覧・単体・スレッドの取得（message.repository.ts・thread.repository.ts）で、
// 投稿ごとの reactions（と mentions）が正しく対応することを、隔離 D1 で確かめる。
// 期待：リアクション・指名のない投稿は reactions・mentions が厳密に []。ある投稿とない投稿が混ざる一覧で、取り違えない（他の投稿の値が混ざらない・落ちない）。
// 期待値は、DB に入れた行（dave が 👍、bob が 👏、見ている人は alice／bob）から独立に書く。
// データは架空（testuser_rxlst_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupReactionScenario,
  createThreadWorld,
  insertReactionRow,
  reactionIsoAt,
  type ThreadWorld,
} from "../../test/reaction-fixtures";
import { seedParent, seedReply } from "../../test/thread-fixtures";
import { toItem, withMessages } from "./message.repository";
import { withThreads } from "./thread.repository";

let world: ThreadWorld;

const SHOWN_NAME = "テスト太郎";

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  world = await createThreadWorld("rxlst");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await env.DB.prepare(
    "DELETE FROM message_mentions WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!')",
  ).run();
  await cleanupReactionScenario();
});

const react = (messageId: string, userId: string, value: string, n = 1) =>
  insertReactionRow({
    messageId,
    userId,
    kind: "emoji",
    value,
    createdAt: reactionIsoAt(n),
  });

const mention = (messageId: string, userId: string) =>
  env.DB.prepare(
    "INSERT INTO message_mentions (message_id, user_id, start, end) VALUES (?, ?, 0, 3)",
  )
    .bind(messageId, userId)
    .run();

/** dave が 👍 を付けた投稿を、alice が見たときの reactions */
const daveThumbsUp = () => [
  {
    kind: "emoji",
    value: "👍",
    count: 1,
    reactedByMe: false,
    users: [{ id: world.dave.userId, displayName: SHOWN_NAME, isActive: true }],
  },
];
/** bob が 👏 を付けた投稿を、alice が見たときの reactions */
const bobClap = () => [
  {
    kind: "emoji",
    value: "👏",
    count: 1,
    reactedByMe: false,
    users: [{ id: world.bob.userId, displayName: SHOWN_NAME, isActive: true }],
  },
];

type Shown = { id: string; reactions: unknown; mentions: unknown };
const view = (items: Shown[]) =>
  items.map((item) => [item.id, item.reactions, item.mentions] as const);

describe("#138 AC-1（1-7 AC-3）部屋の一覧（listLatest・listAfter）：投稿ごとの reactions", () => {
  async function seedRoom() {
    const plain1 = await seedParent(world.channel, world.alice.userId, 1);
    const reacted = await seedParent(world.channel, world.alice.userId, 2);
    const plain2 = await seedParent(world.channel, world.alice.userId, 3);
    const other = await seedParent(world.channel, world.alice.userId, 4);
    await react(reacted, world.dave.userId, "👍");
    await react(other, world.bob.userId, "👏");
    await mention(reacted, world.bob.userId);
    return { plain1, reacted, plain2, other };
  }

  it("#138 AC-1: listLatest：ない投稿は reactions・mentions が厳密に []、ある投稿はその投稿の分だけを持つ（新しい順）", async () => {
    const ids = await seedRoom();
    const page = await withMessages(env, (repository) =>
      repository.listLatest(world.channel, 10, undefined, world.alice.userId),
    );
    expect(view(page.items as Shown[])).toEqual([
      [ids.other, bobClap(), []],
      [ids.plain2, [], []],
      [
        ids.reacted,
        daveThumbsUp(),
        [{ userId: world.bob.userId, start: 0, end: 3 }],
      ],
      [ids.plain1, [], []],
    ]);
  });

  it("#138 AC-1: listAfter：ない投稿は厳密に []、ある投稿はその投稿の分だけを持つ（古い順）", async () => {
    const ids = await seedRoom();
    const page = await withMessages(env, (repository) =>
      repository.listAfter(
        world.channel,
        "00000000000000000000000000",
        10,
        world.alice.userId,
      ),
    );
    expect(view(page.items as Shown[])).toEqual([
      [ids.plain1, [], []],
      [
        ids.reacted,
        daveThumbsUp(),
        [{ userId: world.bob.userId, start: 0, end: 3 }],
      ],
      [ids.plain2, [], []],
      [ids.other, bobClap(), []],
    ]);
  });

  it("#138 AC-1: 見ている人から reactedByMe が決まる（bob が見ると、自分の 👏 は true）", async () => {
    const ids = await seedRoom();
    const page = await withMessages(env, (repository) =>
      repository.listLatest(world.channel, 10, undefined, world.bob.userId),
    );
    const other = page.items.find((item) => item.id === ids.other);
    expect(other?.reactions).toEqual([{ ...bobClap()[0], reactedByMe: true }]);
  });
});

describe("#138 AC-2（1-4 AC-6）スレッドの返信の一覧（listRepliesLatest・listRepliesAfter）", () => {
  async function seedReplies() {
    const parent = await seedParent(world.channel, world.alice.userId, 1);
    const plain1 = await seedReply(world.channel, parent, world.bob.userId, 2);
    const reacted = await seedReply(world.channel, parent, world.bob.userId, 3);
    const plain2 = await seedReply(world.channel, parent, world.bob.userId, 4);
    const other = await seedReply(world.channel, parent, world.bob.userId, 5);
    await react(reacted, world.dave.userId, "👍");
    await react(other, world.bob.userId, "👏");
    await mention(reacted, world.alice.userId);
    return { parent, plain1, reacted, plain2, other };
  }

  it("#138 AC-2: listRepliesLatest：ない返信は厳密に []、ある返信はその返信の分だけを持つ", async () => {
    const ids = await seedReplies();
    const page = await withMessages(env, (repository) =>
      repository.listRepliesLatest(
        ids.parent,
        10,
        undefined,
        world.alice.userId,
      ),
    );
    expect(view(page.items as Shown[])).toEqual([
      [ids.other, bobClap(), []],
      [ids.plain2, [], []],
      [
        ids.reacted,
        daveThumbsUp(),
        [{ userId: world.alice.userId, start: 0, end: 3 }],
      ],
      [ids.plain1, [], []],
    ]);
  });

  it("#138 AC-2: listRepliesAfter：ない返信は厳密に []、ある返信はその返信の分だけを持つ", async () => {
    const ids = await seedReplies();
    const page = await withMessages(env, (repository) =>
      repository.listRepliesAfter(
        ids.parent,
        "00000000000000000000000000",
        10,
        world.alice.userId,
      ),
    );
    expect(view(page.items as Shown[])).toEqual([
      [ids.plain1, [], []],
      [
        ids.reacted,
        daveThumbsUp(),
        [{ userId: world.alice.userId, start: 0, end: 3 }],
      ],
      [ids.plain2, [], []],
      [ids.other, bobClap(), []],
    ]);
  });
});

describe("#138 AC-1・AC-2 単体の取得（findItem）", () => {
  it("#138 AC-1: リアクションも指名もない投稿は、reactions・mentions が厳密に []", async () => {
    const plain = await seedParent(world.channel, world.alice.userId, 1);
    const item = await withMessages(env, (repository) =>
      repository.findItem(plain, world.alice.userId),
    );
    expect(item?.reactions).toEqual([]);
    expect(item?.mentions).toEqual([]);
  });

  it("#138 AC-1: ある投稿は、その投稿の集計と指名を持ち、他の投稿の集計は混ざらない", async () => {
    const reacted = await seedParent(world.channel, world.alice.userId, 1);
    const other = await seedParent(world.channel, world.alice.userId, 2);
    await react(reacted, world.dave.userId, "👍");
    await react(other, world.bob.userId, "👏");
    await mention(reacted, world.bob.userId);
    const item = await withMessages(env, (repository) =>
      repository.findItem(reacted, world.alice.userId),
    );
    expect(item?.reactions).toEqual(daveThumbsUp());
    expect(item?.mentions).toEqual([
      { userId: world.bob.userId, start: 0, end: 3 },
    ]);
  });

  it("#138 AC-1: 見ている人から reactedByMe が決まる", async () => {
    const reacted = await seedParent(world.channel, world.alice.userId, 1);
    await react(reacted, world.dave.userId, "👍");
    const item = await withMessages(env, (repository) =>
      repository.findItem(reacted, world.dave.userId),
    );
    expect(item?.reactions).toEqual([
      { ...daveThumbsUp()[0], reactedByMe: true },
    ]);
  });
});

describe("#138 AC-2（1-4 AC-6）スレッド一覧（listThreads）の親の reactions", () => {
  it("#138 AC-2: リアクション・指名のない親は厳密に []、ある親はその親の分だけを持つ（混在する一覧）", async () => {
    const plainParent = await seedParent(world.channel, world.alice.userId, 1);
    await seedReply(world.channel, plainParent, world.bob.userId, 2);
    const reactedParent = await seedParent(
      world.channel,
      world.alice.userId,
      3,
    );
    await seedReply(world.channel, reactedParent, world.bob.userId, 4);
    const otherParent = await seedParent(world.channel, world.alice.userId, 5);
    await seedReply(world.channel, otherParent, world.bob.userId, 6);
    await react(reactedParent, world.dave.userId, "👍");
    await react(otherParent, world.bob.userId, "👏");
    await mention(reactedParent, world.bob.userId);

    const page = await withThreads(env, (repository) =>
      repository.listThreads(world.alice.userId, {
        limit: 10,
        includeDirect: false,
        includeCase: true,
      }),
    );
    const byId = new Map(
      page.items.map((item) => [item.parent.id, item.parent] as const),
    );
    expect(byId.size).toBe(3);
    expect(byId.get(plainParent)?.reactions).toEqual([]);
    expect(byId.get(plainParent)?.mentions).toEqual([]);
    expect(byId.get(reactedParent)?.reactions).toEqual(daveThumbsUp());
    expect(byId.get(reactedParent)?.mentions).toEqual([
      { userId: world.bob.userId, start: 0, end: 3 },
    ]);
    expect(byId.get(otherParent)?.reactions).toEqual(bobClap());
    expect(byId.get(otherParent)?.mentions).toEqual([]);
  });
});

describe("#138 AC-1 項目への変換（toItem）", () => {
  it("#138 AC-1: リアクションを渡さないと、reactions は厳密に []（既定値）", () => {
    const item = toItem({
      id: "01JTESTITEM000000000000000",
      roomId: "01JTESTROOM000000000000000",
      senderId: "01JTESTUSER000000000000000",
      senderDisplayName: "テスト太郎",
      body: "[UNIT_TEST]本文",
      createdAt: "2026-11-16T00:00:00.000Z",
      editedAt: null,
      deletedAt: null,
      parentMessageId: null,
      replyCount: 0,
      authorIsActive: true,
    });
    expect(item.reactions).toEqual([]);
  });
});
