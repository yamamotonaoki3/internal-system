// #138 AC-1（1-7 AC-1〜AC-5）・AC-2（1-4 AC-6）: リアクションの DB 側（migration 0022・条件付きの INSERT・DELETE・集計）を、隔離 D1 で確かめる。
// - 表 message_reactions：主キー (message_id, kind, value, user_id)、kind は emoji か stamp、value の長さは 1〜64
// - 追加・取り消しは、部屋の条件 reactable（メッセージが未削除で、部屋が「チャンネル：参加中・未アーカイブ・部署が有効（部署なしは有効）」か
//   「DM：当事者で、当事者に無効な社員がいない」）を SQL の WHERE に持つ。本人の投稿かどうか・お知らせ専用の投稿権限は条件に入れない
// - 追加は、重複（同じ人が同じものを2回）なら0行、すでにある種類には付けられ、新しい種類は20種類までなら付けられる（21種類目は0行）
// - 取り消しは本人の行だけを消す。書き込みと同じ batch で、同じ条件の集計を読む（条件が崩れていれば集計は0行）
// - 集計は種類ごとの count（全数）・reactedByMe・付けた人（付けた時刻の順に最大50人）。並びは種類ごとに最初に付けられた時刻の順
//
// 実装が前提とする約束（計画「DB」。このテストが固定する）：
//   repository.addReactionIfReactable({ messageId, userId, kind, value }): Promise<{ changes: number; reactions: Reaction[] }>
//   repository.removeReactionIfReactable({ messageId, userId, kind, value }): Promise<{ changes: number; reactions: Reaction[] }>
//     … changes は書き込みの行数（1 か 0）。reactions は同じ batch の中で、同じ部屋の条件を付けて読んだ、その投稿の最新の集計（userId から見た reactedByMe）。条件が崩れていれば []
//   backend/src/db/message-reactions.sql.ts の loadMessageReactions(db, messageIds, viewerId): Promise<Map<string, Reaction[]>>
//   Reaction = { kind, value, count, reactedByMe, users: { id, displayName, isActive }[] }（users は最大50人）
// データは架空（testuser_rxdb_、[UNIT_TEST]、@example.com）。
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import { companyGeneralRows } from "../../test/company-general-fixtures";
import { insertMember } from "../../test/department-fixtures";
import { deactivateUser, insertDm } from "../../test/dm-fixtures";
import {
  archiveChannel,
  deactivateDepartment,
  leaveChannel,
  markDeleted,
} from "../../test/message-modify-fixtures";
import {
  TWENTY_REACTIONS,
  cleanupReactionScenario,
  createThreadWorld,
  insertReactionRow,
  reactionIsoAt,
  reactionRows,
  seedTwentyTypes,
  type ThreadWorld,
} from "../../test/reaction-fixtures";
import { insertUser } from "../../test/role-fixtures";
import { seedParent, seedReply } from "../../test/thread-fixtures";
import { withDatabase } from "./database";
import { withMessages } from "./message.repository";
import { loadMessageReactions } from "./message-reactions.sql";

let world: ThreadWorld;
let message: string;

type Input = {
  messageId: string;
  userId: string;
  kind: "emoji" | "stamp";
  value: string;
};

const add = (input: Input) =>
  withMessages(env, (repository) => repository.addReactionIfReactable(input));
const remove = (input: Input) =>
  withMessages(env, (repository) =>
    repository.removeReactionIfReactable(input),
  );
const input = (
  userId: string,
  value = "👍",
  kind: Input["kind"] = "emoji",
) => ({
  messageId: message,
  userId,
  kind,
  value,
});

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  world = await createThreadWorld("rxdb");
  message = await seedParent(world.channel, world.alice.userId, 1);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupReactionScenario();
});

describe("#138 AC-1 migration 0022：message_reactions の形", () => {
  it("#138 AC-1: 列と主キー（message_id, kind, value, user_id）・外部キー（messages.id・users.id）がある", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name, \"notnull\" AS not_null, pk FROM pragma_table_info('message_reactions')",
    ).all<{ name: string; not_null: number; pk: number }>();
    const columns = new Map(results.map((r) => [r.name, r]));
    for (const name of ["message_id", "user_id", "kind", "value", "created_at"])
      expect(columns.get(name)?.not_null, name).toBe(1);
    const keyOrder = results
      .filter((r) => r.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((r) => r.name);
    expect(keyOrder).toEqual(["message_id", "kind", "value", "user_id"]);
    const { results: foreign } = await env.DB.prepare(
      'SELECT "from" AS from_column, "table" AS to_table, "to" AS to_column FROM pragma_foreign_key_list(\'message_reactions\')',
    ).all<{ from_column: string; to_table: string; to_column: string }>();
    expect(foreign).toContainEqual({
      from_column: "message_id",
      to_table: "messages",
      to_column: "id",
    });
    expect(foreign).toContainEqual({
      from_column: "user_id",
      to_table: "users",
      to_column: "id",
    });
  });

  it("#138 AC-1: user_id の索引 message_reactions_user_id_idx がある", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM pragma_index_list('message_reactions')",
    ).all<{ name: string }>();
    expect(results.map((r) => r.name)).toContain(
      "message_reactions_user_id_idx",
    );
  });

  it.each([
    ["kind が emoji・stamp 以外", "sticker", "👍"],
    ["value が空", "emoji", ""],
    ["value が65文字", "emoji", "a".repeat(65)],
  ])(
    "#138 AC-1: %s の行は CHECK で入れられない",
    async (_label, kind, value) => {
      await expect(
        env.DB.prepare(
          "INSERT INTO message_reactions (message_id, user_id, kind, value) VALUES (?, ?, ?, ?)",
        )
          .bind(message, world.bob.userId, kind, value)
          .run(),
      ).rejects.toThrow();
      expect(await reactionRows(message)).toEqual([]);
    },
  );

  it("#138 AC-1: value は1文字と64文字を入れられる（境界）", async () => {
    await env.DB.prepare(
      "INSERT INTO message_reactions (message_id, user_id, kind, value) VALUES (?, ?, 'emoji', ?), (?, ?, 'emoji', ?)",
    )
      .bind(
        message,
        world.bob.userId,
        "a",
        message,
        world.bob.userId,
        "b".repeat(64),
      )
      .run();
    expect(await reactionRows(message)).toHaveLength(2);
  });

  it("#138 AC-1: 存在しないメッセージ・利用者は外部キーで入れられない", async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO message_reactions (message_id, user_id, kind, value) VALUES (?, ?, 'emoji', '👍')",
      )
        .bind("01JNOMESSAGE0000000000000", world.bob.userId)
        .run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        "INSERT INTO message_reactions (message_id, user_id, kind, value) VALUES (?, ?, 'emoji', '👍')",
      )
        .bind(message, "01JNOUSER00000000000000000")
        .run(),
    ).rejects.toThrow();
  });
});

describe("#138 AC-1（1-7 AC-1・AC-2）追加（addReactionIfReactable）", () => {
  it("#138 AC-1（1-7 AC-1）: 部屋の参加者は絵文字を付けられ、changes は1、行が1つ入り、集計に件数1・reactedByMe・付けた人が出る", async () => {
    const result = await add(input(world.bob.userId));
    expect(result.changes).toBe(1);
    const rows = await reactionRows(message);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      message_id: message,
      user_id: world.bob.userId,
      kind: "emoji",
      value: "👍",
    });
    expect(rows[0]?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    expect(result.reactions).toEqual([
      {
        kind: "emoji",
        value: "👍",
        count: 1,
        reactedByMe: true,
        users: [
          { id: world.bob.userId, displayName: "テスト太郎", isActive: true },
        ],
      },
    ]);
  });

  it("#138 AC-1（1-7 AC-2）: スタンプも付けられる", async () => {
    const result = await add(input(world.bob.userId, "ok", "stamp"));
    expect(result.changes).toBe(1);
    expect(result.reactions[0]).toMatchObject({
      kind: "stamp",
      value: "ok",
      count: 1,
      reactedByMe: true,
    });
  });

  it("#138 AC-1（1-7 AC-4）: 同じ人が同じものをもう一度付けると changes は0で、行は1つのまま。集計は最新（件数1）", async () => {
    await add(input(world.bob.userId));
    const again = await add(input(world.bob.userId));
    expect(again.changes).toBe(0);
    expect(await reactionRows(message)).toHaveLength(1);
    expect(again.reactions).toHaveLength(1);
    expect(again.reactions[0]).toMatchObject({ count: 1, reactedByMe: true });
  });

  it("#138 AC-1（1-7 AC-3）: 別の人が同じものを付けると件数2になり、付けた順に2人が並ぶ。reactedByMe は付けた本人から見た値", async () => {
    await add(input(world.bob.userId));
    const second = await add(input(world.dave.userId));
    expect(second.changes).toBe(1);
    expect(second.reactions[0]).toMatchObject({ count: 2, reactedByMe: true });
    expect(second.reactions[0]?.users.map((user) => user.id).sort()).toEqual(
      [world.bob.userId, world.dave.userId].sort(),
    );
  });

  it("#138 AC-1（同じ batch を続けて送っても1行）: 同じ追加を続けて送っても、同時に送っても、行は1つで changes の合計は1", async () => {
    const sequential = [
      await add(input(world.bob.userId)),
      await add(input(world.bob.userId)),
      await add(input(world.bob.userId)),
    ];
    expect(sequential.map((r) => r.changes)).toEqual([1, 0, 0]);
    expect(await reactionRows(message)).toHaveLength(1);
    await remove(input(world.bob.userId));
    const parallel = await Promise.all([
      add(input(world.bob.userId)),
      add(input(world.bob.userId)),
    ]);
    expect(parallel.map((r) => r.changes).sort()).toEqual([0, 1]);
    expect(await reactionRows(message)).toHaveLength(1);
  });

  it("#138 AC-1（返信）: 返信にも付けられる。上限は返信ごとに数える", async () => {
    const reply = await seedReply(world.channel, message, world.dave.userId, 2);
    const result = await add({ ...input(world.bob.userId), messageId: reply });
    expect(result.changes).toBe(1);
    await seedTwentyTypes(message, world.alice.userId);
    // 親は20種類だが、返信は別の投稿として数える
    const second = await add({
      ...input(world.bob.userId, "😀"),
      messageId: reply,
    });
    expect(second.changes).toBe(1);
  });

  it("#138 AC-1（返信・C-59）: 親が削除済みでも、未削除の返信には付けられる", async () => {
    const reply = await seedReply(world.channel, message, world.dave.userId, 2);
    await markDeleted(message, world.alice.userId);
    const result = await add({ ...input(world.bob.userId), messageId: reply });
    expect(result.changes).toBe(1);
  });

  it("#138 AC-1（お知らせ専用）: お知らせ専用チャンネルでは、投稿権限のない参加者も付けられる", async () => {
    await insertMember(world.dept.announcementChannelId, world.alice.userId);
    await insertMember(world.dept.announcementChannelId, world.bob.userId);
    const announcement = await seedParent(
      world.dept.announcementChannelId,
      world.alice.userId,
      3,
    );
    const result = await add({
      ...input(world.bob.userId),
      messageId: announcement,
    });
    expect(result.changes).toBe(1);
  });

  it("#138 AC-1（部署なし）: 部署のない会社直属のチャンネルは有効として扱い、参加者は付けられる", async () => {
    // 全社連絡は migration が作る初期データで1件だけ（purpose は一意）。作り直さず、既存の部屋を使う（後始末でも消さない）
    const [row] = await companyGeneralRows();
    expect(row?.department_id).toBeNull();
    const company = row?.room_id ?? "";
    expect(company).not.toBe("");
    await insertMember(company, world.alice.userId);
    await insertMember(company, world.bob.userId);
    const target = await seedParent(company, world.alice.userId, 4);
    expect(
      (await add({ ...input(world.bob.userId), messageId: target })).changes,
    ).toBe(1);
  });

  it("#138 AC-1（DM）: DM の当事者は、相手の投稿にも自分の投稿にも付けられる", async () => {
    const dm = await insertDm(world.alice.userId, world.bob.userId);
    const target = await seedParent(dm, world.alice.userId, 5);
    expect(
      (await add({ ...input(world.bob.userId), messageId: target })).changes,
    ).toBe(1);
    expect(
      (await add({ ...input(world.alice.userId, "🎉"), messageId: target }))
        .changes,
    ).toBe(1);
  });

  it("#138 AC-1（削除済み・U-7）: 削除済みの投稿には付けられない（changes は0で、行は増えない）", async () => {
    await markDeleted(message, world.alice.userId);
    const result = await add(input(world.bob.userId));
    expect(result.changes).toBe(0);
    expect(await reactionRows(message)).toEqual([]);
  });

  it("#138 AC-1（存在しない投稿）: 存在しない投稿には付けられない（changes は0）", async () => {
    const result = await add({
      ...input(world.bob.userId),
      messageId: "01JNOMESSAGE0000000000000",
    });
    expect(result.changes).toBe(0);
    expect(result.reactions).toEqual([]);
  });
});

describe("#138 AC-1（1-7 AC-4・U-4）20種類の上限", () => {
  it("#138 AC-1（1-7 AC-4）: 20種類に達していると、21種類目は changes 0 で、行は増えない", async () => {
    await seedTwentyTypes(message, world.alice.userId);
    const result = await add(input(world.bob.userId, "😀"));
    expect(result.changes).toBe(0);
    expect(await reactionRows(message)).toHaveLength(20);
  });

  it("#138 AC-1（1-7 AC-4）: 20種類に達していても、すでにある種類には別の人が付けられる（絵文字もスタンプも）", async () => {
    await seedTwentyTypes(message, world.alice.userId);
    expect((await add(input(world.bob.userId, "👍"))).changes).toBe(1);
    expect((await add(input(world.bob.userId, "like", "stamp"))).changes).toBe(
      1,
    );
    expect(await reactionRows(message)).toHaveLength(22);
  });

  it("#138 AC-1（1-7 AC-4）: 19種類なら、20種類目を付けられる（境界）", async () => {
    for (const [index, reaction] of TWENTY_REACTIONS.slice(0, 19).entries())
      await insertReactionRow({
        messageId: message,
        userId: world.alice.userId,
        ...reaction,
        createdAt: reactionIsoAt(index),
      });
    expect((await add(input(world.bob.userId, "😀"))).changes).toBe(1);
    expect((await add(input(world.bob.userId, "😄"))).changes).toBe(0);
  });

  it("#138 AC-1（1-7 AC-4）: 上限は『種類』で数える。行が20を超えても、種類が少なければ新しい種類を付けられる", async () => {
    // 3種類を、3人が付けた（9行）
    for (const [i, value] of ["👍", "👏", "🙏"].entries())
      for (const user of [world.alice, world.bob, world.dave])
        await insertReactionRow({
          messageId: message,
          userId: user.userId,
          kind: "emoji",
          value,
          createdAt: reactionIsoAt(i),
        });
    expect((await add(input(world.carol.userId, "😀"))).changes).toBe(0); // carol は未参加（上限と別の理由）
    expect((await add(input(world.dave.userId, "😀"))).changes).toBe(1);
  });

  it("#138 AC-1（1-7 AC-4）: 上限は投稿ごと。別の投稿には、同じ種類を付けられる", async () => {
    await seedTwentyTypes(message, world.alice.userId);
    const other = await seedParent(world.channel, world.alice.userId, 6);
    expect(
      (await add({ ...input(world.bob.userId, "😀"), messageId: other }))
        .changes,
    ).toBe(1);
  });

  it("#138 AC-1（同時の操作）: 19種類のとき、別の新しい種類を2人が同時に付けても、20種類を超えない（1つだけ成功）", async () => {
    for (const [index, reaction] of TWENTY_REACTIONS.slice(0, 19).entries())
      await insertReactionRow({
        messageId: message,
        userId: world.alice.userId,
        ...reaction,
        createdAt: reactionIsoAt(index),
      });
    const results = await Promise.all([
      add(input(world.bob.userId, "😀")),
      add(input(world.dave.userId, "😄")),
    ]);
    expect(results.map((r) => r.changes).sort()).toEqual([0, 1]);
    const types = new Set(
      (await reactionRows(message)).map((row) => `${row.kind}:${row.value}`),
    );
    expect(types.size).toBe(20);
  });
});

describe("#138 AC-1 部屋の条件（reactable）：確認の後に状態が崩れたとき、追加・取り消しとも0行で、行は変わらない", () => {
  type Break = {
    label: string;
    /** 崩す（bob が操作する。メッセージは alice の投稿） */
    run: (target: { message: string; room: string }) => Promise<void>;
    /** 部屋。省略すると world.channel */
    dm?: boolean;
  };

  const breaks: Break[] = [
    {
      label: "チャンネルの参加を外す",
      run: async ({ room }) => leaveChannel(room, world.bob.userId),
    },
    {
      label: "チャンネルをアーカイブする",
      run: async ({ room }) => archiveChannel(room),
    },
    {
      label: "部署を無効にする",
      run: async () => deactivateDepartment(world.dept.id),
    },
  ];

  it.each(breaks.map((b) => [b.label, b] as const))(
    "#138 AC-1（指摘1）: %s と、追加は changes 0・集計 []・行が変わらない",
    async (_label, broken) => {
      await insertReactionRow({
        messageId: message,
        userId: world.dave.userId,
        kind: "emoji",
        value: "👏",
        createdAt: reactionIsoAt(1),
      });
      const before = await reactionRows(message);
      await broken.run({ message, room: world.channel });
      const result = await add(input(world.bob.userId));
      expect(result.changes).toBe(0);
      expect(result.reactions).toEqual([]);
      expect(await reactionRows(message)).toEqual(before);
    },
  );

  it.each(breaks.map((b) => [b.label, b] as const))(
    "#138 AC-1（指摘1）: %s と、取り消しは changes 0・集計 []・本人の行も残る",
    async (_label, broken) => {
      await insertReactionRow({
        messageId: message,
        userId: world.bob.userId,
        kind: "emoji",
        value: "👍",
        createdAt: reactionIsoAt(1),
      });
      const before = await reactionRows(message);
      await broken.run({ message, room: world.channel });
      const result = await remove(input(world.bob.userId));
      expect(result.changes).toBe(0);
      expect(result.reactions).toEqual([]);
      expect(await reactionRows(message)).toEqual(before);
    },
  );

  it("#138 AC-1（指摘1）: DM の相手を無効にすると、追加・取り消しとも0行で、行は変わらない", async () => {
    const dm = await insertDm(world.alice.userId, world.bob.userId);
    const target = await seedParent(dm, world.alice.userId, 7);
    await insertReactionRow({
      messageId: target,
      userId: world.bob.userId,
      kind: "emoji",
      value: "👍",
      createdAt: reactionIsoAt(1),
    });
    const before = await reactionRows(target);
    await deactivateUser(world.alice.userId);
    const added = await add({
      ...input(world.bob.userId, "👏"),
      messageId: target,
    });
    const removed = await remove({
      ...input(world.bob.userId),
      messageId: target,
    });
    expect([added.changes, removed.changes]).toEqual([0, 0]);
    expect([added.reactions, removed.reactions]).toEqual([[], []]);
    expect(await reactionRows(target)).toEqual(before);
  });

  it("#138 AC-1（指摘1）: DM の当事者でない人は、追加も取り消しもできず、行は変わらない", async () => {
    const dm = await insertDm(world.alice.userId, world.bob.userId);
    const target = await seedParent(dm, world.alice.userId, 8);
    await insertReactionRow({
      messageId: target,
      userId: world.bob.userId,
      kind: "emoji",
      value: "👍",
      createdAt: reactionIsoAt(1),
    });
    const before = await reactionRows(target);
    const added = await add({
      ...input(world.dave.userId, "👏"),
      messageId: target,
    });
    const removed = await remove({
      ...input(world.dave.userId),
      messageId: target,
    });
    expect([added.changes, removed.changes]).toEqual([0, 0]);
    expect(await reactionRows(target)).toEqual(before);
  });

  it("#138 AC-1（参加していない公開チャンネル・U-8）: 一度も参加していない人は追加できない", async () => {
    const result = await add(input(world.carol.userId));
    expect(result.changes).toBe(0);
    expect(await reactionRows(message)).toEqual([]);
  });

  it("#138 AC-1（削除済み・U-7）: 削除済みの投稿の取り消しも0行で、行は残る", async () => {
    await insertReactionRow({
      messageId: message,
      userId: world.bob.userId,
      kind: "emoji",
      value: "👍",
      createdAt: reactionIsoAt(1),
    });
    await markDeleted(message, world.alice.userId);
    const result = await remove(input(world.bob.userId));
    expect(result.changes).toBe(0);
    expect(await reactionRows(message)).toHaveLength(1);
  });
});

describe("#138 AC-1（1-7 AC-3）取り消し（removeReactionIfReactable）", () => {
  it("#138 AC-1（1-7 AC-3）: 本人の行を消せる（changes 1）。集計は、残った人の件数になり、reactedByMe は false", async () => {
    await add(input(world.bob.userId));
    await add(input(world.dave.userId));
    const result = await remove(input(world.bob.userId));
    expect(result.changes).toBe(1);
    expect(result.reactions).toHaveLength(1);
    expect(result.reactions[0]).toMatchObject({
      count: 1,
      reactedByMe: false,
    });
    expect(result.reactions[0]?.users.map((user) => user.id)).toEqual([
      world.dave.userId,
    ]);
    expect((await reactionRows(message)).map((row) => row.user_id)).toEqual([
      world.dave.userId,
    ]);
  });

  it("#138 AC-1（1-7 AC-3）: 最後の1人が取り消すと、その種類は集計から消える", async () => {
    await add(input(world.bob.userId));
    const result = await remove(input(world.bob.userId));
    expect(result.changes).toBe(1);
    expect(result.reactions).toEqual([]);
  });

  it("#138 AC-1（R-36）: 他人が付けた種類を指定して取り消しても、changes は0で、他人の行は残る", async () => {
    await add(input(world.dave.userId));
    const result = await remove(input(world.bob.userId));
    expect(result.changes).toBe(0);
    expect(await reactionRows(message)).toHaveLength(1);
    expect(result.reactions[0]).toMatchObject({ count: 1, reactedByMe: false });
  });

  it("#138 AC-1（冪等）: 付けていないものを取り消すと changes は0（行は変わらない）", async () => {
    const result = await remove(input(world.bob.userId));
    expect(result.changes).toBe(0);
    expect(await reactionRows(message)).toEqual([]);
  });

  it("#138 AC-1: 取り消しは kind・value の両方が一致する行だけを消す（同じ value でも別の kind は残る）", async () => {
    await insertReactionRow({
      messageId: message,
      userId: world.bob.userId,
      kind: "emoji",
      value: "like",
      createdAt: reactionIsoAt(1),
    });
    await insertReactionRow({
      messageId: message,
      userId: world.bob.userId,
      kind: "stamp",
      value: "like",
      createdAt: reactionIsoAt(2),
    });
    const result = await remove(input(world.bob.userId, "like", "stamp"));
    expect(result.changes).toBe(1);
    const rows = await reactionRows(message);
    expect(rows.map((row) => `${row.kind}:${row.value}`)).toEqual([
      "emoji:like",
    ]);
  });

  it("#138 AC-1: 取り消しても、付けたものは別の投稿の同じ種類には影響しない", async () => {
    const other = await seedParent(world.channel, world.alice.userId, 9);
    await add(input(world.bob.userId));
    await add({ ...input(world.bob.userId), messageId: other });
    await remove(input(world.bob.userId));
    expect(await reactionRows(other)).toHaveLength(1);
  });
});

describe("#138 AC-1（1-7 AC-3・U-5・U-6）集計（loadMessageReactions）", () => {
  const load = (ids: string[], viewer: string) =>
    withDatabase(env, (db) => loadMessageReactions(db, ids, viewer));

  it("#138 AC-1: ID が空なら空の結果（エラーにしない）", async () => {
    expect((await load([], world.alice.userId)).size).toBe(0);
  });

  it("#138 AC-1: 付いていない投稿は空（取り出し側は ?? [] で扱える）", async () => {
    const result = await load([message], world.alice.userId);
    expect(result.get(message) ?? []).toEqual([]);
  });

  it("#138 AC-1（細部4）: 種類は最初に付けられた時刻の順、付けた人も付けた時刻の順に並ぶ", async () => {
    // 種類 A（👏）は最初に dave が、その後に bob が付ける。種類 B（👍）は間に bob が付ける
    await insertReactionRow({
      messageId: message,
      userId: world.dave.userId,
      kind: "emoji",
      value: "👏",
      createdAt: reactionIsoAt(1),
    });
    await insertReactionRow({
      messageId: message,
      userId: world.bob.userId,
      kind: "emoji",
      value: "👍",
      createdAt: reactionIsoAt(2),
    });
    await insertReactionRow({
      messageId: message,
      userId: world.bob.userId,
      kind: "emoji",
      value: "👏",
      createdAt: reactionIsoAt(3),
    });
    await insertReactionRow({
      messageId: message,
      userId: world.alice.userId,
      kind: "stamp",
      value: "ok",
      createdAt: reactionIsoAt(4),
    });
    const reactions = (await load([message], world.bob.userId)).get(message);
    expect(reactions?.map((r) => `${r.kind}:${r.value}`)).toEqual([
      "emoji:👏",
      "emoji:👍",
      "stamp:ok",
    ]);
    expect(reactions?.[0]?.users.map((u) => u.id)).toEqual([
      world.dave.userId,
      world.bob.userId,
    ]);
    expect(reactions?.map((r) => r.count)).toEqual([2, 1, 1]);
    expect(reactions?.map((r) => r.reactedByMe)).toEqual([true, true, false]);
  });

  it("#138 AC-1: reactedByMe は見ている人から決まる（同じ投稿を別の人が見ると変わる）", async () => {
    await insertReactionRow({
      messageId: message,
      userId: world.bob.userId,
      kind: "emoji",
      value: "👍",
      createdAt: reactionIsoAt(1),
    });
    const forBob = (await load([message], world.bob.userId)).get(message);
    const forDave = (await load([message], world.dave.userId)).get(message);
    expect(forBob?.[0]?.reactedByMe).toBe(true);
    expect(forDave?.[0]?.reactedByMe).toBe(false);
    expect(forDave?.[0]?.count).toBe(1);
  });

  it("#138 AC-1（Q-93・U-5）: 51人が付けても count は51（全数）、users は付けた時刻の順の最初の50人。51人目が見ている人なら reactedByMe は true", async () => {
    const users: string[] = [];
    for (let i = 0; i < 51; i += 1)
      users.push(
        await insertUser(
          `testuser_rxdb_many${String(i).padStart(2, "0")}`,
          world.dept.id,
        ),
      );
    for (const [index, userId] of users.entries())
      await insertReactionRow({
        messageId: message,
        userId,
        kind: "emoji",
        value: "👍",
        createdAt: reactionIsoAt(index),
      });
    const last = users[50] as string;
    const reactions = (await load([message], last)).get(message);
    expect(reactions).toHaveLength(1);
    expect(reactions?.[0]?.count).toBe(51);
    expect(reactions?.[0]?.users).toHaveLength(50);
    expect(reactions?.[0]?.users.map((u) => u.id)).toEqual(users.slice(0, 50));
    expect(reactions?.[0]?.reactedByMe).toBe(true);
    // 50人目までの人が見ると、reactedByMe も true で count は同じ
    const first = (await load([message], users[0] as string)).get(message);
    expect(first?.[0]?.count).toBe(51);
  });

  it("#138 AC-1（境界）: ちょうど50人なら users は50人、count は50", async () => {
    const users: string[] = [];
    for (let i = 0; i < 50; i += 1)
      users.push(
        await insertUser(
          `testuser_rxdb_fifty${String(i).padStart(2, "0")}`,
          world.dept.id,
        ),
      );
    for (const [index, userId] of users.entries())
      await insertReactionRow({
        messageId: message,
        userId,
        kind: "emoji",
        value: "👏",
        createdAt: reactionIsoAt(index),
      });
    const reactions = (await load([message], world.alice.userId)).get(message);
    expect(reactions?.[0]?.count).toBe(50);
    expect(reactions?.[0]?.users).toHaveLength(50);
  });

  it("#138 AC-1（U-6）: 退職者（無効な社員）のリアクションも数え、isActive は false。表示名は今の users の値", async () => {
    await insertReactionRow({
      messageId: message,
      userId: world.bob.userId,
      kind: "emoji",
      value: "👍",
      createdAt: reactionIsoAt(1),
    });
    await insertReactionRow({
      messageId: message,
      userId: world.dave.userId,
      kind: "emoji",
      value: "👍",
      createdAt: reactionIsoAt(2),
    });
    await env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?")
      .bind("テスト花子", world.dave.userId)
      .run();
    await deactivateUser(world.dave.userId);
    const reactions = (await load([message], world.bob.userId)).get(message);
    expect(reactions?.[0]?.count).toBe(2);
    expect(reactions?.[0]?.users).toEqual([
      { id: world.bob.userId, displayName: "テスト太郎", isActive: true },
      { id: world.dave.userId, displayName: "テスト花子", isActive: false },
    ]);
  });

  it("#138 AC-1: 複数の投稿をまとめて読むと、投稿ごとに分かれる（他の投稿の集計は混ざらない）", async () => {
    const second = await seedParent(world.channel, world.alice.userId, 10);
    const third = await seedParent(world.channel, world.alice.userId, 11);
    await insertReactionRow({
      messageId: message,
      userId: world.bob.userId,
      kind: "emoji",
      value: "👍",
      createdAt: reactionIsoAt(1),
    });
    await insertReactionRow({
      messageId: second,
      userId: world.bob.userId,
      kind: "stamp",
      value: "ok",
      createdAt: reactionIsoAt(2),
    });
    await insertReactionRow({
      messageId: second,
      userId: world.dave.userId,
      kind: "stamp",
      value: "ok",
      createdAt: reactionIsoAt(3),
    });
    const result = await load([message, second, third], world.bob.userId);
    expect(result.get(message)?.map((r) => r.value)).toEqual(["👍"]);
    expect(result.get(second)?.map((r) => [r.value, r.count])).toEqual([
      ["ok", 2],
    ]);
    expect(result.get(third) ?? []).toEqual([]);
  });

  it("#138 AC-1（SQL の数）: 投稿の数が増えても、読み込みの問い合わせは1回（IDは JSON の1パラメータで渡す）", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 30; i += 1)
      ids.push(await seedParent(world.channel, world.alice.userId, 20 + i));
    let prepared = 0;
    const counting = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "prepare")
          return (query: string) => {
            prepared += 1;
            return target.prepare(query);
          };
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await loadMessageReactions(
      drizzle(counting, { schema }),
      ids,
      world.bob.userId,
    );
    expect(prepared).toBe(1);
  });
});

describe("#138 コードレビュー1回目（重大）：再判定用の読み取り（repository.loadReactions）は reactable の条件付き", () => {
  // 契約（実装の役割が合わせる）：loadReactions(messageId, viewerId) は、reactable(messageId, viewerId) が成り立つときだけ集計（Reaction[]。付いていなければ []）を返し、
  //   成り立たないときは null を返す（空の集計と区別できる。付けた人の表示名を一切返さない）。
  const load = (viewer: string, id = message) =>
    withMessages(env, (repository) => repository.loadReactions(id, viewer));

  beforeEach(async () => {
    await env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?")
      .bind("テスト秘密名レビュー", world.dave.userId)
      .run();
    await insertReactionRow({
      messageId: message,
      userId: world.dave.userId,
      kind: "emoji",
      value: "👏",
      createdAt: reactionIsoAt(1),
    });
  });

  it("#138 AC-1: 条件が成り立つとき（参加者）は、集計を返す。付いていない投稿は []（null ではない）", async () => {
    const reactions = await load(world.bob.userId);
    expect(reactions).toMatchObject([
      { kind: "emoji", value: "👏", count: 1, reactedByMe: false },
    ]);
    const other = await seedParent(world.channel, world.alice.userId, 50);
    expect(await load(world.bob.userId, other)).toEqual([]);
  });

  it.each([
    [
      "チャンネルの参加を外す",
      () => leaveChannel(world.channel, world.bob.userId),
    ],
    ["チャンネルをアーカイブする", () => archiveChannel(world.channel)],
    ["部署を無効にする", () => deactivateDepartment(world.dept.id)],
    ["投稿を削除する", () => markDeleted(message, world.alice.userId)],
  ])(
    "#138 コードレビュー1回目（重大）: %s と、null を返す（名前・集計を返さない）",
    async (_label, change) => {
      await change();
      expect(await load(world.bob.userId)).toBeNull();
    },
  );

  it("#138 コードレビュー1回目（重大）: 一度も参加していない人（公開チャンネル）には null を返す", async () => {
    expect(await load(world.carol.userId)).toBeNull();
  });

  it("#138 コードレビュー1回目（重大）: DM の相手が無効になると null。当事者でない人にも null", async () => {
    const dm = await insertDm(world.alice.userId, world.bob.userId);
    const target = await seedParent(dm, world.alice.userId, 51);
    await insertReactionRow({
      messageId: target,
      userId: world.alice.userId,
      kind: "emoji",
      value: "👏",
      createdAt: reactionIsoAt(1),
    });
    expect(await load(world.bob.userId, target)).toMatchObject([
      { value: "👏" },
    ]);
    expect(await load(world.dave.userId, target)).toBeNull();
    await deactivateUser(world.alice.userId);
    expect(await load(world.bob.userId, target)).toBeNull();
  });

  it("#138 コードレビュー1回目（重大）: 存在しない投稿は null", async () => {
    expect(
      await load(world.bob.userId, "01JNOMESSAGE0000000000000"),
    ).toBeNull();
  });
});
