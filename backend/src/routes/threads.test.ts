// #137 AC-1（1-4 AC-4・U-4・U-7）: スレッド一覧（EP-3-08 GET /api/me/threads）を、実際のアプリ入口（index.ts の app）と隔離 D1 で確かめる。
// 契約（実装者へ。計画 決めたこと7）：
//  - GET /api/me/threads?limit&cursor → 200 { items, nextCursor }。limit は既定20・1〜100（範囲外は 422）、壊れた cursor は 422 VALIDATION_ERROR。権限 perm.notification.own。
//  - items[] = { parent, room, lastReplyAt, unreadCount }
//      parent：親の1件（MessageItem の項目＋ parentMessageId: null・replyCount。親が削除済みでも含め、deleted: true・body: null）
//      room：チャンネルは { kind: "channel", id, name }、DM は { kind: "direct", id, partner: { id, displayName, isActive } }（相手が無効でも含める）
//      lastReplyAt：最後の返信の日時。unreadCount：0〜100（自分の返信・削除済みの返信は数えない。上限 100。下限はスレッドの既読位置とチャンネルの参加の時刻の遅い方）
//  - 含めるのは、返信が1件以上あり、自分が親の投稿者か、自分が返信したスレッドで、部屋は参加中で未アーカイブのチャンネル・当事者の DM だけ（U-4）。
//    参加していない公開チャンネル・抜けたチャンネル・アーカイブ済み・他人の DM は出さない。並びは最後の返信の ID の降順（削除済みの返信も含める）。
//  - GET で DB は変わらない。未認証は 401。
// データは架空（testuser_thrlist_、[UNIT_TEST]、@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import { insertChannel, insertMember } from "../../test/department-fixtures";
import { deactivateUser, insertDm } from "../../test/dm-fixtures";
import { insertReplies } from "../../test/message-fixtures";
import {
  archiveChannel,
  leaveChannel,
  markDeleted,
} from "../../test/message-modify-fixtures";
import { setJoinedAt } from "../../test/read-position-fixtures";
import {
  ISO,
  TEST_TAG,
  allThreads,
  cleanupThreadScenario,
  codeOf,
  createThreadWorld,
  getThreads,
  idAt,
  insertThreadReadPosition,
  isoAt,
  seedParent,
  seedReply,
  tableCount,
  threadsOk,
  type ThreadWorld,
} from "../../test/thread-fixtures";

let world: ThreadWorld;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  world = await createThreadWorld("thrlist");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupThreadScenario();
});

const parentsOf = async (token: string, query = "?limit=100") =>
  (await threadsOk(query, token)).items.map((item) => item.parent.id);

describe("#137 AC-1（1-4 AC-4）一覧に含む・含まない", () => {
  it("#137 AC-4: 自分が親の投稿者のスレッド・自分が返信したスレッドを含み、無関係のスレッド・返信が0件のスレッドは含まない", async () => {
    const mineParent = await seedParent(world.channel, world.alice.userId, 1);
    await seedReply(world.channel, mineParent, world.bob.userId, 2);
    const repliedParent = await seedParent(world.channel, world.bob.userId, 3);
    await seedReply(world.channel, repliedParent, world.alice.userId, 4);
    const unrelated = await seedParent(world.channel, world.bob.userId, 5);
    await seedReply(world.channel, unrelated, world.dave.userId, 6);
    await seedParent(world.channel, world.alice.userId, 7);
    const ids = await parentsOf(world.alice.token);
    expect(ids).toEqual([repliedParent, mineParent]);
    expect(ids).not.toContain(unrelated);
  });

  it("#137 AC-4: 項目は { parent, room, lastReplyAt, unreadCount } で、チャンネルの room は { kind, id, name }。parent は親の1件と replyCount", async () => {
    const parent = await seedParent(world.channel, world.alice.userId, 1);
    await seedReply(world.channel, parent, world.bob.userId, 2);
    await seedReply(world.channel, parent, world.dave.userId, 3);
    const page = await threadsOk("", world.alice.token);
    expect(page.nextCursor).toBeNull();
    expect(page.items).toHaveLength(1);
    const [item] = page.items;
    expect(Object.keys(item ?? {}).sort()).toEqual([
      "lastReplyAt",
      "parent",
      "room",
      "unreadCount",
    ]);
    expect(item?.room).toEqual({
      kind: "channel",
      id: world.channel,
      name: `${TEST_TAG}スレッド通常thrlist`,
    });
    expect(item?.parent).toMatchObject({
      id: parent,
      roomId: world.channel,
      parentMessageId: null,
      replyCount: 2,
      body: `${TEST_TAG}親1`,
      deleted: false,
      author: { id: world.alice.userId },
    });
    expect(item?.lastReplyAt).toBe(isoAt(3));
    expect(item?.lastReplyAt).toMatch(ISO);
  });

  it("#137 AC-4: 非公開チャンネルの参加者のスレッドも含む", async () => {
    const room = await insertChannel({
      name: `${TEST_TAG}一覧の非公開`,
      purpose: "normal",
      departmentId: world.dept.id,
      visibility: "private",
    });
    await insertMember(room, world.alice.userId);
    await insertMember(room, world.bob.userId);
    const parent = await seedParent(room, world.bob.userId, 1);
    await seedReply(room, parent, world.alice.userId, 2);
    expect(await parentsOf(world.alice.token)).toEqual([parent]);
  });

  it("#137 AC-4（C-168）: 当事者の DM のスレッドを含み、room は { kind: direct, id, partner }。相手が無効でも含める（isActive: false）", async () => {
    const dm = await insertDm(world.alice.userId, world.bob.userId);
    const parent = await seedParent(dm, world.bob.userId, 1);
    await seedReply(dm, parent, world.alice.userId, 2);
    await deactivateUser(world.bob.userId);
    const page = await threadsOk("", world.alice.token);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.room).toEqual({
      kind: "direct",
      id: dm,
      partner: {
        id: world.bob.userId,
        displayName: "テスト太郎",
        isActive: false,
      },
    });
    expect(page.items[0]?.parent.id).toBe(parent);
  });

  it("#137 AC-2・AC-4: 親が削除済みでも一覧に含め、親は deleted: true・body: null（本文は返さない）", async () => {
    const parent = await seedParent(world.channel, world.alice.userId, 1);
    await seedReply(world.channel, parent, world.bob.userId, 2);
    await markDeleted(parent, world.alice.userId);
    const page = await threadsOk("", world.bob.token);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.parent).toMatchObject({
      id: parent,
      deleted: true,
      body: null,
      replyCount: 1,
    });
    expect(JSON.stringify(page)).not.toContain(`${TEST_TAG}親1`);
  });

  it("#137 AC-4（U-4）: 抜けたチャンネル・アーカイブ済みのチャンネル・他人の DM・一度も参加していない公開チャンネルのスレッドは、関わっていても含めない", async () => {
    const left = await insertChannel({
      name: `${TEST_TAG}抜けた`,
      purpose: "normal",
      departmentId: world.dept.id,
    });
    const archived = await insertChannel({
      name: `${TEST_TAG}アーカイブ済み`,
      purpose: "normal",
      departmentId: world.dept.id,
    });
    const neverJoined = await insertChannel({
      name: `${TEST_TAG}未参加の公開`,
      purpose: "normal",
      departmentId: world.dept.id,
    });
    for (const room of [left, archived]) {
      await insertMember(room, world.alice.userId);
      await insertMember(room, world.bob.userId);
    }
    await insertMember(neverJoined, world.bob.userId);
    let n = 1;
    for (const room of [left, archived, neverJoined]) {
      const parent = await seedParent(room, world.alice.userId, n);
      await seedReply(room, parent, world.bob.userId, n + 1);
      const second = await seedParent(room, world.bob.userId, n + 2);
      await seedReply(room, second, world.alice.userId, n + 3);
      n += 4;
    }
    const othersDm = await insertDm(world.bob.userId, world.dave.userId);
    const dmParent = await seedParent(othersDm, world.bob.userId, n);
    await seedReply(othersDm, dmParent, world.dave.userId, n + 1);
    // 含まれる確認の対照（参加中・未アーカイブの通常のスレッド）
    const kept = await seedParent(world.channel, world.alice.userId, n + 2);
    await seedReply(world.channel, kept, world.bob.userId, n + 3);
    expect(await parentsOf(world.alice.token)).toHaveLength(5);
    await leaveChannel(left, world.alice.userId);
    await archiveChannel(archived);
    expect(await parentsOf(world.alice.token)).toEqual([kept]);
  });

  it("#137 AC-4（U-4・情報漏えいの防止）: どの部屋にも参加していない利用者（carol）には、公開チャンネルのスレッドがあっても空の一覧", async () => {
    const parent = await seedParent(world.channel, world.alice.userId, 1);
    await seedReply(world.channel, parent, world.bob.userId, 2);
    const page = await threadsOk("", world.carol.token);
    expect(page).toEqual({ items: [], nextCursor: null });
  });

  it("#137 AC-4: スレッドが1つもなければ { items: [], nextCursor: null }", async () => {
    expect(await threadsOk("", world.alice.token)).toEqual({
      items: [],
      nextCursor: null,
    });
  });
});

describe("#137 AC-4 並びとカーソル", () => {
  it("#137 AC-4: 並びは最後の返信が新しい順。削除済みの返信も、並びの最後の返信に含める", async () => {
    const t1 = await seedParent(world.channel, world.alice.userId, 1);
    const t2 = await seedParent(world.channel, world.alice.userId, 2);
    const t3 = await seedParent(world.channel, world.alice.userId, 3);
    await seedReply(world.channel, t1, world.bob.userId, 10);
    await seedReply(world.channel, t2, world.bob.userId, 20);
    await seedReply(world.channel, t3, world.bob.userId, 15);
    expect(await parentsOf(world.alice.token)).toEqual([t2, t3, t1]);
    const lastOfT1 = await seedReply(world.channel, t1, world.bob.userId, 30);
    expect(await parentsOf(world.alice.token)).toEqual([t1, t2, t3]);
    await markDeleted(lastOfT1, world.bob.userId);
    expect(await parentsOf(world.alice.token)).toEqual([t1, t2, t3]);
  });

  it("#137 AC-4: 親が古くても、返信が新しければ先頭に出る（親の ID の順ではない）", async () => {
    const oldParent = await seedParent(world.channel, world.alice.userId, 1);
    const newParent = await seedParent(world.channel, world.alice.userId, 5);
    await seedReply(world.channel, newParent, world.bob.userId, 6);
    await seedReply(world.channel, oldParent, world.bob.userId, 7);
    expect(await parentsOf(world.alice.token)).toEqual([oldParent, newParent]);
  });

  it("#137 AC-4（改訂1 軽微4）: 並びが変わらない間は、limit で区切って辿ると、全件を重複も欠落もなく、区切らない場合と同じ順で得られる", async () => {
    for (let i = 0; i < 7; i += 1) {
      const parent = await seedParent(
        world.channel,
        world.alice.userId,
        1 + i * 2,
      );
      await seedReply(world.channel, parent, world.bob.userId, 2 + i * 2);
    }
    const whole = (await allThreads(world.alice.token, 100)).map(
      (item) => item.parent.id,
    );
    expect(whole).toHaveLength(7);
    for (const limit of [1, 3, 7]) {
      const paged = (await allThreads(world.alice.token, limit)).map(
        (item) => item.parent.id,
      );
      expect(paged, `limit=${limit}`).toEqual(whole);
      expect(new Set(paged).size).toBe(paged.length);
    }
    const first = await threadsOk("?limit=3", world.alice.token);
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).toEqual(expect.any(String));
    const last = await threadsOk("?limit=7", world.alice.token);
    expect(last.nextCursor).toBeNull();
  });

  it("#137 AC-4: limit を省略すると 20 件。limit=100 まで受け付け、101・0・数字でない値は 422 VALIDATION_ERROR", async () => {
    const seeds: Parameters<typeof insertReplies>[0] = [];
    for (let i = 0; i < 22; i += 1) {
      await seedParent(world.channel, world.alice.userId, 1 + i * 2);
      seeds.push({
        id: idAt(2 + i * 2),
        roomId: world.channel,
        senderId: world.bob.userId,
        parentMessageId: idAt(1 + i * 2),
        createdAt: isoAt(2 + i * 2),
        body: `${TEST_TAG}返信${i}`,
      });
    }
    await insertReplies(seeds);
    const byDefault = await threadsOk("", world.alice.token);
    expect(byDefault.items).toHaveLength(20);
    expect(byDefault.nextCursor).toEqual(expect.any(String));
    expect(
      (await threadsOk("?limit=100", world.alice.token)).items,
    ).toHaveLength(22);
    for (const query of ["?limit=101", "?limit=0", "?limit=-1", "?limit=abc"]) {
      const response = await getThreads(query, world.alice.token);
      expect(response.status, query).toBe(422);
      expect(await codeOf(response)).toBe("VALIDATION_ERROR");
    }
  });

  it("#137 AC-4: 壊れた cursor は 422 VALIDATION_ERROR", async () => {
    for (const cursor of [
      "not-a-cursor",
      "%E3%81%93%E3%82%8F%E3%82%8C%E3%81%9F",
      "e30",
      "' OR 1=1 --",
    ]) {
      const response = await getThreads(
        `?cursor=${encodeURIComponent(cursor)}`,
        world.alice.token,
      );
      expect(response.status, cursor).toBe(422);
      expect(await codeOf(response)).toBe("VALIDATION_ERROR");
    }
  });
});

describe("#137 AC-4（C-169・U-7）スレッドの未読", () => {
  it("#137 AC-4: unreadCount は他人の返信だけを数え、自分の返信・削除済みの返信は数えない", async () => {
    const parent = await seedParent(world.channel, world.alice.userId, 1);
    await seedReply(world.channel, parent, world.bob.userId, 2);
    await seedReply(world.channel, parent, world.alice.userId, 3);
    await seedReply(world.channel, parent, world.dave.userId, 4);
    const gone = await seedReply(world.channel, parent, world.bob.userId, 5);
    await seedReply(world.channel, parent, world.dave.userId, 6);
    await markDeleted(gone, world.bob.userId);
    const [item] = (await threadsOk("", world.alice.token)).items;
    expect(item?.unreadCount).toBe(3);
    // 返信した本人（bob）の側から見ると、自分の返信 2 件（削除済みを含む）を除く、他人の返信が未読
    const bobItem = (await threadsOk("", world.bob.token)).items[0];
    expect(bobItem?.unreadCount).toBe(3);
  });

  it("#137 AC-4: スレッドの既読位置より後の他人の返信だけを数える。位置が最後の返信なら 0", async () => {
    const parent = await seedParent(world.channel, world.alice.userId, 1);
    const r1 = await seedReply(world.channel, parent, world.bob.userId, 2);
    await seedReply(world.channel, parent, world.bob.userId, 3);
    const r3 = await seedReply(world.channel, parent, world.dave.userId, 4);
    await insertThreadReadPosition(world.alice.userId, parent, r1);
    expect((await threadsOk("", world.alice.token)).items[0]?.unreadCount).toBe(
      2,
    );
    await env.DB.prepare(
      "UPDATE thread_read_positions SET last_read_message_id = ? WHERE user_id = ? AND parent_message_id = ?",
    )
      .bind(r3, world.alice.userId, parent)
      .run();
    expect((await threadsOk("", world.alice.token)).items[0]?.unreadCount).toBe(
      0,
    );
  });

  it("#137 AC-4: スレッドの既読位置は利用者ごと（bob の既読は alice の未読を変えない）", async () => {
    const parent = await seedParent(world.channel, world.alice.userId, 1);
    const r1 = await seedReply(world.channel, parent, world.dave.userId, 2);
    await insertThreadReadPosition(world.bob.userId, parent, r1);
    expect((await threadsOk("", world.alice.token)).items[0]?.unreadCount).toBe(
      1,
    );
  });

  it("#137 AC-4: チャンネルの参加より前の返信は数えない（既読位置がないとき）。参加より後の返信は数える", async () => {
    const parent = await seedParent(world.channel, world.alice.userId, 1);
    await seedReply(world.channel, parent, world.bob.userId, 2);
    await seedReply(world.channel, parent, world.bob.userId, 3);
    // 参加を 2026-11-13 に直す：n=2・3（2026-11-12）は参加の前
    await setJoinedAt(
      world.channel,
      world.alice.userId,
      "2026-11-13T00:00:00.000Z",
    );
    await seedReply(world.channel, parent, world.bob.userId, 86_400 + 60);
    expect((await threadsOk("", world.alice.token)).items[0]?.unreadCount).toBe(
      1,
    );
  });

  it("#137 AC-4（C-169）: 数える上限は 100（それ以上の返信があっても 100）", async () => {
    const parent = await seedParent(world.channel, world.alice.userId, 1);
    const seeds = Array.from({ length: 105 }, (_, i) => ({
      id: idAt(2 + i),
      roomId: world.channel,
      senderId: world.bob.userId,
      parentMessageId: parent,
      createdAt: isoAt(2 + i),
      body: `${TEST_TAG}多数${i}`,
    }));
    await insertReplies(seeds);
    const [item] = (await threadsOk("", world.alice.token)).items;
    expect(item?.unreadCount).toBe(100);
    expect(item?.parent.replyCount).toBe(105);
  });

  it("#137 AC-4: DM のスレッドの未読は、参加の時刻の下限がなく、既読位置より後の相手の返信を数える", async () => {
    const dm = await insertDm(world.alice.userId, world.bob.userId);
    const parent = await seedParent(dm, world.alice.userId, 1);
    await seedReply(dm, parent, world.bob.userId, 2);
    await seedReply(dm, parent, world.alice.userId, 3);
    await seedReply(dm, parent, world.bob.userId, 4);
    expect((await threadsOk("", world.alice.token)).items[0]?.unreadCount).toBe(
      2,
    );
  });
});

describe("#137 AC-4 認証・応答", () => {
  it("#137 AC-4: 未認証は 401 UNAUTHENTICATED", async () => {
    const response = await getThreads("", null);
    expect(response.status).toBe(401);
    expect(await codeOf(response)).toBe("UNAUTHENTICATED");
  });

  it("#137 AC-4: GET で DB は変わらない（メッセージ・スレッドの既読位置の行が増減しない）", async () => {
    const parent = await seedParent(world.channel, world.alice.userId, 1);
    await seedReply(world.channel, parent, world.bob.userId, 2);
    const before = [
      await tableCount("messages"),
      await tableCount("thread_read_positions"),
      await tableCount("read_positions"),
    ];
    await getThreads("", world.alice.token);
    await getThreads("?limit=1", world.bob.token);
    expect([
      await tableCount("messages"),
      await tableCount("thread_read_positions"),
      await tableCount("read_positions"),
    ]).toEqual(before);
  });

  it("#137 AC-4: /api/me の別の API（/api/me/unread・/api/me/notifications）と重ならず、これまでどおり動く", async () => {
    for (const path of ["/api/me/unread", "/api/me/notifications"]) {
      const response = await apiRequest("GET", path, {
        token: world.alice.token,
      });
      expect(response.status, path).toBe(200);
    }
  });
});
