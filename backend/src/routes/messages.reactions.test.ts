// #138 AC-1（1-7 AC-1〜AC-5）・AC-2（1-4 AC-6）: リアクションの API（EP-1-12 POST /api/messages/:messageId/reactions・EP-1-13 DELETE /api/messages/:messageId/reactions/:kind/:value）を、
// 実際のアプリ入口（index.ts の app）と隔離 D1 で確かめる。
// 契約（計画「API」。このテストが固定する）：
//   - 成功は、付けるときも取り消すときも、すでに付いている・すでに外れているときも 200 { messageId, reactions }（reactions はその投稿の最新の集計。冪等）
//   - 入力：POST は { kind: "emoji" | "stamp", value }。kind・value が固定の一覧（shared/reaction-rules.ts）にない値は 422 VALIDATION_ERROR。DELETE はパスを同じ規則で確かめ、違えば 422
//   - 404：見えない（存在しない・非公開で未参加・当事者でない DM・アーカイブ済み）／403：参加していない公開チャンネル・権限／
//     409：削除済み・部署が無効・DM の相手が無効・20種類の上限／422：入力
//   - 他人の行は触れない（R-36）。取り消しは本人の行だけを消し、他人の種類を指定しても 200 で他人の行は残る
//   - 一覧（EP-1-01・返信の一覧・スレッドの親・スレッド一覧）の項目に reactions が入る。削除済みは []。見えない部屋の集計・付けた人の名前は返らない
//   - 通知・未読・スレッド一覧の並びには関係しない（U-9・U-11）
// データは架空（testuser_rxapi_、[UNIT_TEST]、@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import { insertChannel, insertMember } from "../../test/department-fixtures";
import { deactivateUser, insertDm } from "../../test/dm-fixtures";
import {
  archiveChannel,
  deactivateDepartment,
  markDeleted,
} from "../../test/message-modify-fixtures";
import {
  TEST_TAG,
  cleanupReactionScenario,
  createThreadWorld,
  deleteReaction,
  insertReactionRow,
  postReaction,
  reactionIsoAt,
  reactionItemPath,
  reactionRows,
  reactionsOk,
  seedTwentyTypes,
  type ThreadWorld,
} from "../../test/reaction-fixtures";
import {
  BAD_ORIGIN,
  ZERO,
  codeOf,
  repliesOk,
  roomItems,
  seedParent,
  seedReply,
  threadsOk,
} from "../../test/thread-fixtures";

let world: ThreadWorld;
let message: string;

const SECRET_NAME = "テスト秘密名";

const seedRow = (
  userId: string,
  value = "👍",
  kind: "emoji" | "stamp" = "emoji",
  n = 1,
  messageId = message,
) =>
  insertReactionRow({
    messageId,
    userId,
    kind,
    value,
    createdAt: reactionIsoAt(n),
  });

const setDisplayName = (userId: string, name: string) =>
  env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?")
    .bind(name, userId)
    .run();

const notificationTotal = async () =>
  (
    await env.DB.prepare("SELECT COUNT(*) AS n FROM notifications").first<{
      n: number;
    }>()
  )?.n;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  world = await createThreadWorld("rxapi");
  message = await seedParent(world.channel, world.alice.userId, 1);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupReactionScenario();
});

describe("#138 AC-1（1-7 AC-1〜AC-3）POST・DELETE の成功", () => {
  it("#138 AC-1（1-7 AC-1）: POST で絵文字を付けると 200 で { messageId, reactions }。チップ1つ・件数1・reactedByMe・付けた人が返り、行が1つ入る", async () => {
    const response = await postReaction(
      message,
      { kind: "emoji", value: "👍" },
      world.bob.token,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      messageId: message,
      reactions: [
        {
          kind: "emoji",
          value: "👍",
          count: 1,
          reactedByMe: true,
          users: [
            { id: world.bob.userId, displayName: "テスト太郎", isActive: true },
          ],
        },
      ],
    });
    expect(await reactionRows(message)).toHaveLength(1);
  });

  it("#138 AC-1（1-7 AC-2）: 「了解」のスタンプ（stamp・ok）を付けられる", async () => {
    const body = await reactionsOk(
      await postReaction(
        message,
        { kind: "stamp", value: "ok" },
        world.bob.token,
      ),
    );
    expect(body.reactions[0]).toMatchObject({
      kind: "stamp",
      value: "ok",
      count: 1,
    });
  });

  it("#138 AC-1（1-7 AC-3）: 2人目が付けると件数2。付けた人は付けた順に並び、reactedByMe は見ている人から決まる", async () => {
    await setDisplayName(world.bob.userId, "テスト花子");
    await postReaction(
      message,
      { kind: "emoji", value: "👍" },
      world.bob.token,
    );
    const second = await reactionsOk(
      await postReaction(
        message,
        { kind: "emoji", value: "👍" },
        world.dave.token,
      ),
    );
    expect(second.reactions[0]?.count).toBe(2);
    expect(second.reactions[0]?.users.map((user) => user.displayName)).toEqual([
      "テスト花子",
      "テスト太郎",
    ]);
    expect(second.reactions[0]?.reactedByMe).toBe(true);
  });

  it("#138 AC-1（1-7 AC-3）: DELETE で自分の分を取り消すと 200 で最新の集計（残った人の件数）が返り、本人の行だけが消える", async () => {
    await seedRow(world.bob.userId, "👍", "emoji", 1);
    await seedRow(world.dave.userId, "👍", "emoji", 2);
    const body = await reactionsOk(
      await deleteReaction(message, "emoji", "👍", world.bob.token),
    );
    expect(body.messageId).toBe(message);
    expect(body.reactions).toHaveLength(1);
    expect(body.reactions[0]).toMatchObject({ count: 1, reactedByMe: false });
    expect((await reactionRows(message)).map((r) => r.user_id)).toEqual([
      world.dave.userId,
    ]);
  });

  it("#138 AC-1（1-7 AC-3）: スタンプも DELETE で取り消せる。最後の1人が取り消すと reactions は空", async () => {
    await seedRow(world.bob.userId, "ok", "stamp");
    const body = await reactionsOk(
      await deleteReaction(message, "stamp", "ok", world.bob.token),
    );
    expect(body.reactions).toEqual([]);
    expect(await reactionRows(message)).toEqual([]);
  });

  it("#138 AC-1（URL エンコード）: 絵文字の value は URL エンコードしたパスで取り消せる（異体字セレクタつきの ❤️ も）", async () => {
    await seedRow(world.bob.userId, "❤️");
    expect(reactionItemPath(message, "emoji", "❤️")).toContain(
      encodeURIComponent("❤️"),
    );
    const body = await reactionsOk(
      await deleteReaction(message, "emoji", "❤️", world.bob.token),
    );
    expect(body.reactions).toEqual([]);
    expect(await reactionRows(message)).toEqual([]);
  });

  it("#138 AC-1（自分の投稿）: 自分の投稿にも付けられる", async () => {
    expect(
      (
        await postReaction(
          message,
          { kind: "emoji", value: "🎉" },
          world.alice.token,
        )
      ).status,
    ).toBe(200);
  });
});

describe("#138 AC-1（U-12）冪等", () => {
  it("#138 AC-1（1-7 AC-4）: 同じものを続けて POST しても、どちらも 200 で同じ集計。行は1つのまま", async () => {
    const first = await reactionsOk(
      await postReaction(
        message,
        { kind: "emoji", value: "👍" },
        world.bob.token,
      ),
    );
    const second = await reactionsOk(
      await postReaction(
        message,
        { kind: "emoji", value: "👍" },
        world.bob.token,
      ),
    );
    expect(second).toEqual(first);
    expect(await reactionRows(message)).toHaveLength(1);
  });

  it("#138 AC-1（U-12）: 同時に同じものを2回 POST しても、どちらも 200 で、行は1つ", async () => {
    const responses = await Promise.all([
      postReaction(message, { kind: "emoji", value: "👍" }, world.bob.token),
      postReaction(message, { kind: "emoji", value: "👍" }, world.bob.token),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(await reactionRows(message)).toHaveLength(1);
  });

  it("#138 AC-1（U-12）: 付けていないものを DELETE しても 200 で最新の集計（エラーにしない）", async () => {
    await seedRow(world.dave.userId, "👏");
    const response = await deleteReaction(
      message,
      "emoji",
      "👍",
      world.bob.token,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      reactions: { value: string; count: number }[];
    };
    expect(body.reactions.map((r) => [r.value, r.count])).toEqual([["👏", 1]]);
  });

  it("#138 AC-1（R-36）: 他人が付けた種類を指定して DELETE しても 200 で、他人の行は残る（自分の行がないだけ）", async () => {
    await seedRow(world.dave.userId);
    const body = await reactionsOk(
      await deleteReaction(message, "emoji", "👍", world.bob.token),
    );
    expect(body.reactions[0]).toMatchObject({ count: 1, reactedByMe: false });
    expect((await reactionRows(message)).map((r) => r.user_id)).toEqual([
      world.dave.userId,
    ]);
  });

  it("#138 AC-1（U-12）: 取り消した後にもう一度取り消しても 200（2つのタブで同じ操作をしても、どちらも最新の集計）", async () => {
    await seedRow(world.bob.userId);
    const first = await reactionsOk(
      await deleteReaction(message, "emoji", "👍", world.bob.token),
    );
    const second = await reactionsOk(
      await deleteReaction(message, "emoji", "👍", world.bob.token),
    );
    expect(second).toEqual(first);
  });
});

describe("#138 AC-1（1-7 AC-2）入力の検査（422）", () => {
  const bad: [string, unknown][] = [
    ["一覧にないスタンプの id", { kind: "stamp", value: "stamp-unknown" }],
    ["一覧にない絵文字", { kind: "emoji", value: "🐱" }],
    ["肌の色つきの絵文字", { kind: "emoji", value: "👍🏻" }],
    ["空の value", { kind: "emoji", value: "" }],
    ["65文字の value", { kind: "stamp", value: "a".repeat(65) }],
    ["kind の取り違え（絵文字を stamp に）", { kind: "stamp", value: "👍" }],
    [
      "kind の取り違え（スタンプの id を emoji に）",
      { kind: "emoji", value: "like" },
    ],
    ["知らない kind", { kind: "sticker", value: "like" }],
    ["kind がない", { value: "👍" }],
    ["value がない", { kind: "emoji" }],
    ["value が文字列でない", { kind: "emoji", value: 1 }],
    ["本文が空のオブジェクト", {}],
    ["配列", []],
  ];

  it.each(bad)(
    "#138 AC-1（1-7 AC-2）: POST：%s は 422 VALIDATION_ERROR で、行は増えない",
    async (_label, payload) => {
      const response = await postReaction(message, payload, world.bob.token);
      expect(response.status).toBe(422);
      expect(await codeOf(response)).toBe("VALIDATION_ERROR");
      expect(await reactionRows(message)).toEqual([]);
    },
  );

  it("#138 AC-1: POST：本文がオブジェクトでない（文字列）ときも 422 で、行は増えない", async () => {
    const response = await apiRequest(
      "POST",
      `/api/messages/${message}/reactions`,
      {
        token: world.bob.token,
        body: "オブジェクトではない本文",
      },
    );
    expect(response.status).toBe(422);
    expect(await reactionRows(message)).toEqual([]);
  });

  it.each([
    ["知らない kind", "sticker", "like"],
    ["一覧にない絵文字", "emoji", "🐱"],
    ["一覧にないスタンプの id", "stamp", "stamp-unknown"],
    ["kind の取り違え", "stamp", "👍"],
  ])(
    "#138 AC-1: DELETE：パスの %s は 422 VALIDATION_ERROR で、行は変わらない",
    async (_label, kind, value) => {
      await seedRow(world.bob.userId);
      const response = await deleteReaction(
        message,
        kind,
        value,
        world.bob.token,
      );
      expect(response.status).toBe(422);
      expect(await codeOf(response)).toBe("VALIDATION_ERROR");
      expect(await reactionRows(message)).toHaveLength(1);
    },
  );

  it("#138 AC-1: 422 の応答に、入力した値そのものを含めない（エラー応答の形）", async () => {
    const response = await postReaction(
      message,
      { kind: "emoji", value: "🐱" },
      world.bob.token,
    );
    expect(JSON.stringify(await response.json())).not.toContain("🐱");
  });
});

describe("#138 AC-1 認証・送信元", () => {
  it("#138 AC-1: ログインしていないと POST・DELETE とも 401 で、行は変わらない", async () => {
    await seedRow(world.bob.userId);
    const post = await postReaction(
      message,
      { kind: "emoji", value: "👏" },
      null,
    );
    const del = await deleteReaction(message, "emoji", "👍", null);
    expect([post.status, del.status]).toEqual([401, 401]);
    expect(await reactionRows(message)).toHaveLength(1);
  });

  it.each([
    ["許可外の Origin", BAD_ORIGIN],
    ["Origin なし", ""],
  ])(
    "#138 AC-1: %s なら POST・DELETE とも 403 FORBIDDEN_ORIGIN で、行は変わらない",
    async (_label, origin) => {
      await seedRow(world.bob.userId);
      const post = await postReaction(
        message,
        { kind: "emoji", value: "👏" },
        world.bob.token,
        origin,
      );
      const del = await deleteReaction(
        message,
        "emoji",
        "👍",
        world.bob.token,
        origin,
      );
      expect([post.status, del.status]).toEqual([403, 403]);
      expect(await codeOf(post)).toBe("FORBIDDEN_ORIGIN");
      expect(await codeOf(del)).toBe("FORBIDDEN_ORIGIN");
      expect(await reactionRows(message)).toHaveLength(1);
    },
  );
});

describe("#138 AC-1 認可と拒否の応答（404・403・409）", () => {
  const OPERATIONS = ["POST", "DELETE"] as const;
  const send = (
    op: (typeof OPERATIONS)[number],
    messageId: string,
    token: string,
    value = "👍",
  ) =>
    op === "POST"
      ? postReaction(messageId, { kind: "emoji", value }, token)
      : deleteReaction(messageId, "emoji", value, token);

  it.each(OPERATIONS)(
    "#138 AC-1: %s：存在しない投稿は 404 NOT_FOUND",
    async (op) => {
      const response = await send(
        op,
        "01JNOMESSAGE0000000000000",
        world.bob.token,
      );
      expect(response.status).toBe(404);
      expect(await codeOf(response)).toBe("NOT_FOUND");
    },
  );

  it.each(OPERATIONS)(
    "#138 AC-1: %s：非公開チャンネルに参加していない人は 404 で、存在しない投稿と同じ応答（存在を隠す）。行は変わらない",
    async (op) => {
      const room = await insertChannel({
        name: `${TEST_TAG}非公開rxapi`,
        purpose: "normal",
        departmentId: world.dept.id,
        visibility: "private",
      });
      await insertMember(room, world.alice.userId);
      const target = await seedParent(room, world.alice.userId, 2);
      await seedRow(world.alice.userId, "👍", "emoji", 1, target);
      const hidden = await send(op, target, world.carol.token);
      const missing = await send(
        op,
        "01JNOMESSAGE0000000000000",
        world.carol.token,
      );
      expect(hidden.status).toBe(404);
      expect(await hidden.json()).toEqual(await missing.json());
      expect(await reactionRows(target)).toHaveLength(1);
    },
  );

  it.each(OPERATIONS)(
    "#138 AC-1: %s：他人の DM（当事者でない）は 404。行は変わらない",
    async (op) => {
      const dm = await insertDm(world.alice.userId, world.bob.userId);
      const target = await seedParent(dm, world.alice.userId, 2);
      await seedRow(world.bob.userId, "👍", "emoji", 1, target);
      const response = await send(op, target, world.dave.token);
      expect(response.status).toBe(404);
      expect(await reactionRows(target)).toHaveLength(1);
    },
  );

  it.each(OPERATIONS)(
    "#138 AC-1（U-8）: %s：参加していない公開チャンネルは 403 FORBIDDEN（読めるが付けられない）。行は変わらない",
    async (op) => {
      await seedRow(world.bob.userId);
      const response = await send(op, message, world.carol.token);
      expect(response.status).toBe(403);
      expect(await codeOf(response)).toBe("FORBIDDEN");
      expect(await reactionRows(message)).toHaveLength(1);
    },
  );

  it.each(OPERATIONS)(
    "#138 AC-1（U-7）: %s：削除済みの投稿は 409 CONFLICT。行は残る（消さない）",
    async (op) => {
      await seedRow(world.bob.userId);
      await markDeleted(message, world.alice.userId);
      const response = await send(op, message, world.bob.token);
      expect(response.status).toBe(409);
      expect(await codeOf(response)).toBe("CONFLICT");
      expect(await reactionRows(message)).toHaveLength(1);
    },
  );

  it.each(OPERATIONS)(
    "#138 AC-1（U-8）: %s：部署が無効（読み取り専用）のチャンネルは 409。行は変わらない",
    async (op) => {
      await seedRow(world.bob.userId);
      await deactivateDepartment(world.dept.id);
      const response = await send(op, message, world.bob.token);
      expect(response.status).toBe(409);
      expect(await reactionRows(message)).toHaveLength(1);
    },
  );

  it.each(OPERATIONS)(
    "#138 AC-1（U-8）: %s：DM の相手が無効なら 409。行は変わらない",
    async (op) => {
      const dm = await insertDm(world.alice.userId, world.bob.userId);
      const target = await seedParent(dm, world.alice.userId, 2);
      await seedRow(world.bob.userId, "👍", "emoji", 1, target);
      await deactivateUser(world.alice.userId);
      const response = await send(op, target, world.bob.token);
      expect(response.status).toBe(409);
      expect(await reactionRows(target)).toHaveLength(1);
    },
  );

  it.each(OPERATIONS)(
    "#138 AC-1: %s：アーカイブ済みのチャンネルは 404",
    async (op) => {
      await archiveChannel(world.channel);
      const response = await send(op, message, world.bob.token);
      expect(response.status).toBe(404);
    },
  );

  it("#138 AC-1（1-7 AC-4）: 20種類に達していて新しい種類を付けると 409 CONFLICT「リアクションは20種類までです」。すでにある種類には付けられる", async () => {
    await seedTwentyTypes(message, world.dave.userId);
    const rejected = await postReaction(
      message,
      { kind: "emoji", value: "😀" },
      world.bob.token,
    );
    expect(rejected.status).toBe(409);
    const body = (await rejected.json()) as { code: string; message: string };
    expect(body.code).toBe("CONFLICT");
    expect(body.message).toBe("リアクションは20種類までです");
    expect(await reactionRows(message)).toHaveLength(20);
    const existing = await postReaction(
      message,
      { kind: "emoji", value: "👍" },
      world.bob.token,
    );
    expect(existing.status).toBe(200);
  });

  it("#138 AC-1（お知らせ専用）: お知らせ専用チャンネルでは、投稿権限のない参加者も付けられる", async () => {
    await insertMember(world.dept.announcementChannelId, world.alice.userId);
    await insertMember(world.dept.announcementChannelId, world.bob.userId);
    const announcement = await seedParent(
      world.dept.announcementChannelId,
      world.alice.userId,
      3,
    );
    const response = await postReaction(
      announcement,
      { kind: "emoji", value: "👍" },
      world.bob.token,
    );
    expect(response.status).toBe(200);
  });

  it("#138 AC-1（1-7 AC-5）: 拒否の応答（403・404・409）に、付けた人の名前・集計を含めない", async () => {
    await setDisplayName(world.bob.userId, SECRET_NAME);
    await seedRow(world.bob.userId);
    const hiddenRoom = await insertChannel({
      name: `${TEST_TAG}非公開rxapi2`,
      purpose: "normal",
      departmentId: world.dept.id,
      visibility: "private",
    });
    await insertMember(hiddenRoom, world.alice.userId);
    const target = await seedParent(hiddenRoom, world.alice.userId, 4);
    await seedRow(world.bob.userId, "👍", "emoji", 1, target);
    for (const response of [
      await postReaction(
        target,
        { kind: "emoji", value: "👍" },
        world.carol.token,
      ),
      await deleteReaction(target, "emoji", "👍", world.carol.token),
      await postReaction(
        message,
        { kind: "emoji", value: "👍" },
        world.carol.token,
      ),
    ]) {
      expect([403, 404]).toContain(response.status);
      const text = await response.text();
      expect(text).not.toContain(SECRET_NAME);
      expect(text).not.toContain("reactions");
    }
  });
});

describe("#138 AC-2（1-4 AC-6）返信に付ける", () => {
  it("#138 AC-2（1-4 AC-6・1-7 AC-5）: 返信にも付けられ、取り消せる。上限は返信ごとに数える", async () => {
    const reply = await seedReply(world.channel, message, world.dave.userId, 2);
    await seedTwentyTypes(message, world.dave.userId);
    const added = await reactionsOk(
      await postReaction(
        reply,
        { kind: "emoji", value: "😀" },
        world.bob.token,
      ),
    );
    expect(added.messageId).toBe(reply);
    expect(added.reactions).toHaveLength(1);
    const removed = await reactionsOk(
      await deleteReaction(reply, "emoji", "😀", world.bob.token),
    );
    expect(removed.reactions).toEqual([]);
  });

  it("#138 AC-2（C-59）: 親が削除済みでも、未削除の返信には付けられる。削除済みの返信には 409", async () => {
    const reply = await seedReply(world.channel, message, world.dave.userId, 2);
    const deleted = await seedReply(
      world.channel,
      message,
      world.dave.userId,
      3,
    );
    await markDeleted(message, world.alice.userId);
    await markDeleted(deleted, world.dave.userId);
    expect(
      (
        await postReaction(
          reply,
          { kind: "emoji", value: "👍" },
          world.bob.token,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await postReaction(
          deleted,
          { kind: "emoji", value: "👍" },
          world.bob.token,
        )
      ).status,
    ).toBe(409);
  });

  it("#138 AC-2（1-4 AC-6）: 付けたリアクションは、返信の一覧を取り直しても残る（親・返信の両方）", async () => {
    const reply = await seedReply(world.channel, message, world.dave.userId, 2);
    await postReaction(reply, { kind: "emoji", value: "👍" }, world.bob.token);
    await postReaction(
      message,
      { kind: "stamp", value: "ok" },
      world.bob.token,
    );
    const page = await repliesOk(message, "", world.alice.token);
    expect(page.items.find((i) => i.id === reply)).toMatchObject({
      reactions: [{ kind: "emoji", value: "👍", count: 1, reactedByMe: false }],
    });
    expect(page.parent).toMatchObject({
      reactions: [{ kind: "stamp", value: "ok", count: 1 }],
    });
  });
});

describe("#138 AC-1 一覧の応答の reactions", () => {
  it("#138 AC-1: 部屋の一覧（最新・after の両方）の項目に reactions が入る。付いていない投稿は []、付いた投稿は集計（reactedByMe は見ている人から）", async () => {
    const plain = await seedParent(world.channel, world.alice.userId, 2);
    await seedRow(world.bob.userId, "👍", "emoji", 1);
    await seedRow(world.dave.userId, "👍", "emoji", 2);
    await seedRow(world.bob.userId, "ok", "stamp", 3);
    for (const query of ["?limit=100", `?after=${ZERO}&limit=100`]) {
      const forBob = await roomItems(world.channel, query, world.bob.token);
      const item = forBob.items.find((i) => i.id === message);
      expect(item?.reactions, query).toEqual([
        {
          kind: "emoji",
          value: "👍",
          count: 2,
          reactedByMe: true,
          users: [
            { id: world.bob.userId, displayName: "テスト太郎", isActive: true },
            {
              id: world.dave.userId,
              displayName: "テスト太郎",
              isActive: true,
            },
          ],
        },
        {
          kind: "stamp",
          value: "ok",
          count: 1,
          reactedByMe: true,
          users: [
            { id: world.bob.userId, displayName: "テスト太郎", isActive: true },
          ],
        },
      ]);
      expect(
        forBob.items.find((i) => i.id === plain)?.reactions,
        query,
      ).toEqual([]);
      const forAlice = await roomItems(world.channel, query, world.alice.token);
      expect(
        forAlice.items
          .find((i) => i.id === message)
          ?.reactions.map((r) => r.reactedByMe),
        query,
      ).toEqual([false, false]);
    }
  });

  it("#138 AC-1（U-7）: 削除済みの投稿は reactions が []（行は DB に残る）。部屋の一覧・返信の一覧の両方", async () => {
    const reply = await seedReply(world.channel, message, world.dave.userId, 2);
    await seedRow(world.bob.userId, "👍", "emoji", 1, message);
    await seedRow(world.bob.userId, "👍", "emoji", 2, reply);
    await markDeleted(message, world.alice.userId);
    await markDeleted(reply, world.dave.userId);
    const room = await roomItems(world.channel, "?limit=100", world.bob.token);
    expect(room.items.find((i) => i.id === message)).toMatchObject({
      deleted: true,
      reactions: [],
    });
    const page = await repliesOk(message, "", world.bob.token);
    expect(page.parent).toMatchObject({ deleted: true, reactions: [] });
    expect(page.items.find((i) => i.id === reply)).toMatchObject({
      deleted: true,
      reactions: [],
    });
    expect(await reactionRows(message)).toHaveLength(1);
    expect(await reactionRows(reply)).toHaveLength(1);
  });

  it("#138 AC-1（U-6）: 退職者のリアクションも数え、users の isActive は false", async () => {
    await seedRow(world.bob.userId, "👍", "emoji", 1);
    await seedRow(world.dave.userId, "👍", "emoji", 2);
    await deactivateUser(world.dave.userId);
    const room = await roomItems(
      world.channel,
      "?limit=100",
      world.alice.token,
    );
    const reaction = room.items.find((i) => i.id === message)?.reactions[0];
    expect(reaction?.count).toBe(2);
    expect(reaction?.users.map((u) => [u.id, u.isActive])).toEqual([
      [world.bob.userId, true],
      [world.dave.userId, false],
    ]);
  });

  it("#138 AC-1（U-5）: 付けた人は最大50人まで。51人が付けても count は51", async () => {
    // 51人分の行を直接入れる（外部キーのため、利用者は実在させる）
    const statements = [];
    for (let i = 0; i < 51; i += 1) {
      const id = `01JTESTRXAPIMANY${String(i).padStart(10, "0")}`;
      statements.push(
        env.DB.prepare(
          `INSERT INTO users (id, login_id, login_id_normalized, display_name, legal_name, email, email_normalized,
             email_verified_by, email_verified_at, department_id, extension, job_title, password_hash,
             must_change_password, is_active, deactivated_at, created_at)
           SELECT ?1, ?2, ?2, ?3, legal_name, ?4, ?4, ?1, created_at, department_id, NULL, NULL, password_hash, 0, 1, NULL, created_at
           FROM users WHERE id = ?5`,
        ).bind(
          id,
          `testuser_rxapi_many${i}`,
          `テスト${i}`,
          `testuser_rxapi_many${i}@example.com`,
          world.alice.userId,
        ),
        env.DB.prepare(
          "INSERT INTO message_reactions (message_id, user_id, kind, value, created_at) VALUES (?, ?, 'emoji', '👍', ?)",
        ).bind(message, id, reactionIsoAt(i)),
      );
    }
    await env.DB.batch(statements);
    const room = await roomItems(
      world.channel,
      "?limit=100",
      world.alice.token,
    );
    const reaction = room.items.find((i) => i.id === message)?.reactions[0];
    expect(reaction?.count).toBe(51);
    expect(reaction?.users).toHaveLength(50);
    expect(reaction?.users[0]?.displayName).toBe("テスト0");
  });

  it("#138 AC-1（U-8）: 参加していない公開チャンネルでも、集計は読める（付けられないだけ）", async () => {
    await seedRow(world.bob.userId);
    const room = await roomItems(
      world.channel,
      "?limit=100",
      world.carol.token,
    );
    expect(room.items.find((i) => i.id === message)?.reactions).toMatchObject([
      { count: 1, reactedByMe: false },
    ]);
  });

  it("#138 AC-1（1-7 AC-5）: スレッドの親（返信の一覧の parent）と、スレッド一覧の親に reactions が入る", async () => {
    await seedReply(world.channel, message, world.bob.userId, 2);
    await seedRow(world.dave.userId, "👏", "emoji", 1);
    const page = await repliesOk(message, "", world.alice.token);
    expect(page.parent.reactions).toMatchObject([
      { value: "👏", count: 1, reactedByMe: false },
    ]);
    const threads = await threadsOk("?limit=100", world.alice.token);
    const item = threads.items.find((i) => i.parent.id === message);
    expect(item?.parent.reactions).toMatchObject([
      { value: "👏", count: 1, reactedByMe: false },
    ]);
  });

  it("#138 AC-1（スレッド一覧・U-7）: スレッド一覧の削除済みの親は reactions が []", async () => {
    await seedReply(world.channel, message, world.bob.userId, 2);
    await seedRow(world.dave.userId, "👏", "emoji", 1);
    await markDeleted(message, world.alice.userId);
    const threads = await threadsOk("?limit=100", world.bob.token);
    expect(
      threads.items.find((i) => i.parent.id === message)?.parent,
    ).toMatchObject({ deleted: true, reactions: [] });
  });

  it("#138 AC-1（1-7 AC-5）: 見えない部屋の一覧・返信の一覧は 404 で、集計・付けた人の名前は返らない", async () => {
    await setDisplayName(world.bob.userId, SECRET_NAME);
    const room = await insertChannel({
      name: `${TEST_TAG}非公開rxapi3`,
      purpose: "normal",
      departmentId: world.dept.id,
      visibility: "private",
    });
    await insertMember(room, world.alice.userId);
    await insertMember(room, world.bob.userId);
    const target = await seedParent(room, world.alice.userId, 5);
    await seedReply(room, target, world.bob.userId, 6);
    await seedRow(world.bob.userId, "👍", "emoji", 1, target);
    const dm = await insertDm(world.alice.userId, world.bob.userId);
    const dmMessage = await seedParent(dm, world.alice.userId, 7);
    await seedRow(world.bob.userId, "👍", "emoji", 1, dmMessage);
    const responses = [
      await apiRequest("GET", `/api/rooms/${room}/messages?limit=100`, {
        token: world.carol.token,
      }),
      await apiRequest("GET", `/api/messages/${target}/replies`, {
        token: world.carol.token,
      }),
      await apiRequest("GET", `/api/rooms/${dm}/messages?limit=100`, {
        token: world.carol.token,
      }),
      await apiRequest("GET", `/api/messages/${dmMessage}/replies`, {
        token: world.carol.token,
      }),
    ];
    for (const response of responses) {
      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).not.toContain(SECRET_NAME);
      expect(text).not.toContain("reactions");
    }
    // スレッド一覧にも、見えない部屋のスレッドは出ない
    const threads = JSON.stringify(
      await threadsOk("?limit=100", world.carol.token),
    );
    expect(threads).not.toContain(SECRET_NAME);
  });
});

describe("#138 AC-1（U-9・U-11）通知・未読・スレッド一覧の並びに関係しない", () => {
  type Unread = { items: { roomId: string; count: number }[] };
  const unreadOf = async (token: string) => {
    const response = await apiRequest("GET", "/api/me/unread?limit=100", {
      token,
    });
    expect(response.status).toBe(200);
    return (await response.json()) as Unread;
  };
  const threadOrder = async (token: string) =>
    (await threadsOk("?limit=100", token)).items.map((item) => ({
      parent: item.parent.id,
      lastReplyAt: item.lastReplyAt,
      unreadCount: item.unreadCount,
    }));

  it("#138 AC-1（U-9）: 付ける・取り消すで、通知は作られない（作者にも、ほかの人にも）", async () => {
    const before = await notificationTotal();
    await postReaction(
      message,
      { kind: "emoji", value: "👍" },
      world.bob.token,
    );
    await postReaction(
      message,
      { kind: "stamp", value: "thanks" },
      world.dave.token,
    );
    await deleteReaction(message, "emoji", "👍", world.bob.token);
    expect(await notificationTotal()).toBe(before);
  });

  it("#138 AC-1（U-11）: 付けても、部屋の未読・スレッドの未読・スレッド一覧の並びと最終返信の時刻は変わらない", async () => {
    // 古いスレッド（message）と新しいスレッド。alice が親で、bob・dave が返信（alice に未読がある）
    const older = message;
    await seedReply(world.channel, older, world.bob.userId, 2);
    const newer = await seedParent(world.channel, world.alice.userId, 10);
    await seedReply(world.channel, newer, world.dave.userId, 11);
    await seedParent(world.channel, world.bob.userId, 20);
    const unreadBefore = await unreadOf(world.alice.token);
    const orderBefore = await threadOrder(world.alice.token);
    expect(orderBefore.length).toBeGreaterThanOrEqual(2);

    // 古いスレッドの親・返信に付ける
    const reply = (await repliesOk(older, "", world.alice.token)).items[0]?.id;
    expect(reply).toBeDefined();
    await postReaction(older, { kind: "emoji", value: "👍" }, world.bob.token);
    await postReaction(
      reply ?? "",
      { kind: "emoji", value: "🎉" },
      world.dave.token,
    );
    await postReaction(
      older,
      { kind: "stamp", value: "ok" },
      world.alice.token,
    );

    expect(await unreadOf(world.alice.token)).toEqual(unreadBefore);
    expect(await threadOrder(world.alice.token)).toEqual(orderBefore);
  });
});
