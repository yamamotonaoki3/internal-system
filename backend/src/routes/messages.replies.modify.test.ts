// #137 AC-1（1-4 AC-1・決めたこと6）: 返信の編集・削除は、既存の PATCH・DELETE /api/messages/:messageId（返信もメッセージ）で行える。
// 判定は #134 と同じ（本人だけ・削除済みは 409・見えなければ 404・未参加は 403）。削除は再認証が必要（要件 0-5）。
// 返信を削除しても、行は残り、スレッドの返信の取得では deleted: true・body: null、親の replyCount は変わらない。
// データは架空（testuser_replymod_、[UNIT_TEST]、@example.com）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteMessage,
  editMessage,
  insertModifyUser,
  messageRow,
  type ModifyUser,
} from "../../test/message-modify-fixtures";
import {
  TEST_TAG,
  cleanupThreadScenario,
  createThreadWorld,
  repliesOk,
  roomItems,
  seedParent,
  seedReply,
  type ThreadWorld,
} from "../../test/thread-fixtures";
import { insertMember } from "../../test/department-fixtures";

let world: ThreadWorld;
let aliceFresh: ModifyUser;
let parent: string;
let reply: string;
const EDITED = `${TEST_TAG}直した返信`;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  world = await createThreadWorld("replymod");
  // 削除は直近の再認証が必要なので、再認証済みのセッションを持つ利用者（bob 本人）を別に作る
  aliceFresh = await insertModifyUser(
    "testuser_replymod_fresh",
    world.dept.id,
    60_000,
  );
  await insertMember(world.channel, aliceFresh.userId);
  parent = await seedParent(world.channel, world.alice.userId, 1);
  reply = await seedReply(world.channel, parent, aliceFresh.userId, 2);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupThreadScenario();
});

describe("#137 AC-1（決めたこと6）返信の編集", () => {
  it("#137 AC-1: 本人は自分の返信を編集でき（200 { id, body, editedAt }）、返信の取得に新しい本文と editedAt が出る", async () => {
    const response = await editMessage(
      reply,
      { body: EDITED },
      aliceFresh.token,
    );
    expect(response.status).toBe(200);
    const { editedAt } = (await response.json()) as { editedAt: string };
    const page = await repliesOk(parent, "", world.bob.token);
    expect(page.items[0]).toMatchObject({
      id: reply,
      body: EDITED,
      editedAt,
      parentMessageId: parent,
      deleted: false,
    });
  });

  it("#137 AC-1: 他人の返信は、親の投稿者でも 403 FORBIDDEN で、本文は変わらない", async () => {
    const response = await editMessage(
      reply,
      { body: EDITED },
      world.alice.token,
    );
    expect(response.status).toBe(403);
    expect((await messageRow(reply))?.body).toBe(`${TEST_TAG}返信2`);
  });

  it("#137 AC-1: 親を編集しても、返信・replyCount は変わらない", async () => {
    expect(
      (await editMessage(parent, { body: EDITED }, world.alice.token)).status,
    ).toBe(200);
    const page = await repliesOk(parent, "", world.bob.token);
    expect(page.items.map((item) => item.id)).toEqual([reply]);
    expect(page.parent).toMatchObject({ body: EDITED, replyCount: 1 });
  });
});

describe("#137 AC-1（決めたこと6）返信の削除", () => {
  it("#137 AC-1: 本人は自分の返信を削除でき（204）、取得では deleted: true・body: null で残り、親の replyCount は減らない", async () => {
    expect((await deleteMessage(reply, aliceFresh.token)).status).toBe(204);
    const page = await repliesOk(parent, "", world.bob.token);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: reply,
      body: null,
      deleted: true,
      editedAt: null,
    });
    expect(page.parent.replyCount).toBe(1);
    const room = await roomItems(world.channel, "", world.bob.token);
    expect(room.items.find((item) => item.id === parent)?.replyCount).toBe(1);
    expect((await messageRow(reply))?.body).toBe(`${TEST_TAG}返信2`);
  });

  it("#137 AC-1: 他人の返信は、親の投稿者でも 403 で削除できない。削除済みの返信の再削除・編集は 409", async () => {
    const other = await deleteMessage(reply, world.alice.token);
    expect(other.status).toBe(403);
    expect((await deleteMessage(reply, aliceFresh.token)).status).toBe(204);
    expect((await deleteMessage(reply, aliceFresh.token)).status).toBe(409);
    expect(
      (await editMessage(reply, { body: EDITED }, aliceFresh.token)).status,
    ).toBe(409);
  });

  it("#137 AC-1: 親を削除しても、返信は削除されず、そのまま見える", async () => {
    // 親の削除は親の投稿者（alice）。再認証済みのセッションを新しく作る
    const owner = await insertModifyUser(
      "testuser_replymod_owner",
      world.dept.id,
      60_000,
    );
    await insertMember(world.channel, owner.userId);
    const ownerParent = await seedParent(world.channel, owner.userId, 5);
    const ownerReply = await seedReply(
      world.channel,
      ownerParent,
      aliceFresh.userId,
      6,
    );
    expect((await deleteMessage(ownerParent, owner.token)).status).toBe(204);
    const page = await repliesOk(ownerParent, "", world.bob.token);
    expect(page.parent).toMatchObject({ deleted: true, body: null });
    expect(page.items.map((item) => item.id)).toEqual([ownerReply]);
    expect(page.items[0]?.deleted).toBe(false);
  });
});
