// #137 AC-1・AC-2（1-4 AC-1・AC-2）: 返信の条件付きの INSERT（Repository の insertReplyIfOrdered。DAO reply-insert.sql.ts）を、隔離 D1 で確かめる。
// 契約（実装者へ。計画 決めたこと2・4⑦）：insertReplyIfOrdered({ id, roomId, parentMessageId, senderId, senderDisplayName, body, createdAt }) は、
//   次のすべてを満たすときだけ1行を挿入し、挿入した行数（1 か 0）を返す。条件を破る行は残さない（確認から書き込みまでに状態が変わっても）。
//   ① ID が部屋の最大（返信を含む）より大きい ② 親が存在し、同じ部屋にあり、返信ではなく（parent_message_id が NULL）、削除済みでない
//   ③ チャンネル：未アーカイブで、投稿者が今も参加者（お知らせ専用でも参加者なら可。U-6）／DM：投稿者が当事者で、当事者に無効な社員がいない
// データは架空（testuser_replyins_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  insertChannel,
  insertDepartmentWithChannels,
  insertMember,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { deactivateUser, insertDm } from "../../test/dm-fixtures";
import { insertMessage } from "../../test/message-fixtures";
import {
  archiveChannel,
  leaveChannel,
  markDeleted,
} from "../../test/message-modify-fixtures";
import { insertUser } from "../../test/role-fixtures";
import {
  cleanupThreadScenario,
  idAt,
  isoAt,
  replyRows,
} from "../../test/thread-fixtures";
import { withMessages, type MessageRepository } from "./message.repository";

let dept: SeededDepartment;
let alice: string;
let bob: string;
let parent: string;

type ReplyInput = Parameters<MessageRepository["insertReplyIfOrdered"]>[0];

function replyInput(overrides: Partial<ReplyInput> = {}): ReplyInput {
  return {
    id: idAt(10),
    roomId: dept.dedicatedChannelId,
    parentMessageId: parent,
    senderId: bob,
    senderDisplayName: "テスト太郎",
    body: "[UNIT_TEST]返信",
    createdAt: isoAt(10),
    ...overrides,
  } as ReplyInput;
}

const insertReply = (input: ReplyInput) =>
  withMessages(env, (repository) => repository.insertReplyIfOrdered(input));

beforeEach(async () => {
  dept = await insertDepartmentWithChannels("返信INSERT");
  alice = await insertUser("testuser_replyins_alice", dept.id);
  bob = await insertUser("testuser_replyins_bob", dept.id);
  await insertMember(dept.dedicatedChannelId, alice);
  await insertMember(dept.dedicatedChannelId, bob);
  parent = idAt(1);
  await insertMessage({
    roomId: dept.dedicatedChannelId,
    senderId: alice,
    id: parent,
  });
});
afterEach(async () => {
  await cleanupThreadScenario();
});

describe("#137 AC-1（1-4 AC-1）返信の条件付きの INSERT", () => {
  it("#137 AC-1: 条件を満たすと1行入り、parent_message_id・部屋・投稿者・本文が入る", async () => {
    expect(await insertReply(replyInput())).toBe(1);
    expect(await replyRows(parent)).toMatchObject([
      {
        id: idAt(10),
        room_id: dept.dedicatedChannelId,
        sender_id: bob,
        body: "[UNIT_TEST]返信",
        parent_message_id: parent,
      },
    ]);
  });

  it("#137 AC-1（決めたこと2）: ID が部屋の最大（返信を含む）以下なら 0 行。最大より大きければ1行", async () => {
    await insertMessage({
      roomId: dept.dedicatedChannelId,
      senderId: alice,
      id: idAt(20),
    });
    expect(await insertReply(replyInput({ id: idAt(15) }))).toBe(0);
    expect(await insertReply(replyInput({ id: idAt(20) }))).toBe(0);
    expect(await replyRows(parent)).toEqual([]);
    expect(await insertReply(replyInput({ id: idAt(21) }))).toBe(1);
    // 返信が最大のときは、返信の ID 以下も 0 行
    expect(await insertReply(replyInput({ id: idAt(21) }))).toBe(0);
    expect(await insertReply(replyInput({ id: idAt(18) }))).toBe(0);
  });

  it("#137 AC-1（返信は1段）: 親が返信なら 0 行（返信への返信は入らない）", async () => {
    expect(await insertReply(replyInput())).toBe(1);
    expect(
      await insertReply(
        replyInput({ id: idAt(11), parentMessageId: idAt(10) }),
      ),
    ).toBe(0);
    expect(await replyRows(idAt(10))).toEqual([]);
  });

  it("#137 AC-1: 親が存在しない・別の部屋の親なら 0 行", async () => {
    const otherRoom = await insertChannel({
      name: "[UNIT_TEST]別の部屋",
      purpose: "normal",
      departmentId: dept.id,
    });
    await insertMember(otherRoom, bob);
    const otherParent = idAt(2);
    await insertMessage({
      roomId: otherRoom,
      senderId: alice,
      id: otherParent,
    });
    expect(await insertReply(replyInput({ parentMessageId: idAt(999) }))).toBe(
      0,
    );
    // 親は otherRoom にあるのに、部屋は dedicated を指す
    expect(
      await insertReply(replyInput({ parentMessageId: otherParent })),
    ).toBe(0);
    expect(await replyRows(otherParent)).toEqual([]);
  });

  it("#137 AC-2（C-59）: 親が削除済みなら 0 行（確認の後に親が削除されても、返信は残らない）", async () => {
    await markDeleted(parent, alice);
    expect(await insertReply(replyInput())).toBe(0);
    expect(await replyRows(parent)).toEqual([]);
  });

  it("#137 AC-1: 投稿者が参加者でない（抜けた）・チャンネルがアーカイブ済みなら 0 行", async () => {
    await leaveChannel(dept.dedicatedChannelId, bob);
    expect(await insertReply(replyInput())).toBe(0);
    await insertMember(dept.dedicatedChannelId, bob);
    await archiveChannel(dept.dedicatedChannelId);
    expect(await insertReply(replyInput({ id: idAt(11) }))).toBe(0);
    expect(await replyRows(parent)).toEqual([]);
  });

  it("#137 AC-1（U-6）: お知らせ専用チャンネルでは、投稿権限のない参加者も返信でき（1行）、参加者でなければ 0 行", async () => {
    const announcementParent = idAt(3);
    await insertMember(dept.announcementChannelId, alice);
    await insertMember(dept.announcementChannelId, bob);
    await insertMessage({
      roomId: dept.announcementChannelId,
      senderId: alice,
      id: announcementParent,
    });
    const input = replyInput({
      roomId: dept.announcementChannelId,
      parentMessageId: announcementParent,
    });
    expect(await insertReply(input)).toBe(1);
    await leaveChannel(dept.announcementChannelId, bob);
    expect(await insertReply({ ...input, id: idAt(11) })).toBe(0);
  });

  it("#137 AC-1: DM の当事者の返信は1行入り、当事者でない人・相手が無効な DM は 0 行", async () => {
    const roomId = await insertDm(alice, bob);
    const dmParent = idAt(4);
    await insertMessage({ roomId, senderId: alice, id: dmParent });
    const stranger = await insertUser("testuser_replyins_stranger", dept.id);
    const input = replyInput({ roomId, parentMessageId: dmParent });
    expect(await insertReply({ ...input, senderId: stranger })).toBe(0);
    expect(await insertReply(input)).toBe(1);
    await deactivateUser(alice);
    expect(await insertReply({ ...input, id: idAt(11) })).toBe(0);
    expect(await replyRows(dmParent)).toHaveLength(1);
  });
});
