// #139 AC-2・AC-3：メンション付き条件付きINSERTの0行・ID衝突時の原子性を隔離D1で確認する。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  insertChannel,
  insertDepartmentWithChannels,
  insertMember,
  type SeededDepartment,
} from "../../test/department-fixtures";
import {
  cleanupMessageScenario,
  insertMessage,
  messageCount,
  ulidAt,
} from "../../test/message-fixtures";
import { cleanupNotificationTestData } from "../../test/notification-fixtures";
import { insertUser, testId } from "../../test/role-fixtures";
import { withMessages } from "./message.repository";

let department: SeededDepartment;
let senderId: string;
let memberId: string;
const room = () => department.dedicatedChannelId;
const notificationsFor = async (userId: string) => {
  const { results } = await env.DB.prepare(
    "SELECT user_id, room_id, message_id FROM notifications WHERE user_id = ? ORDER BY id",
  )
    .bind(userId)
    .all<{
      user_id: string;
      room_id: string | null;
      message_id: string | null;
    }>();
  return results;
};

beforeEach(async () => {
  department = await insertDepartmentWithChannels("指名原子性");
  senderId = await insertUser("testuser_mentions_atomic_sender", department.id);
  memberId = await insertUser("testuser_mentions_atomic_member", department.id);
  await insertMember(room(), senderId);
  await insertMember(room(), memberId);
});

afterEach(async () => {
  try {
    await env.DB.prepare("DELETE FROM message_mentions WHERE user_id IN (?, ?)")
      .bind(senderId, memberId)
      .run();
    await cleanupNotificationTestData();
  } finally {
    await cleanupMessageScenario();
  }
});

describe("#139 AC-2・AC-3（条件付きINSERTと通知の原子性）", () => {
  const candidate = (id: string, roomId: string) => ({
    id,
    roomId,
    senderId: senderId,
    senderDisplayName: "本人",
    body: "@同名",
    mentions: [{ userId: memberId, start: 0, end: 3 }],
  });
  const mentionRows = async (id: string) => {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM message_mentions WHERE message_id = ?",
    )
      .bind(id)
      .first<{ count: number }>();
    return row?.count ?? 0;
  };

  it("#139 AC-2: 同じ部屋の既存IDでINSERTが0行なら指名と通知を残さない", async () => {
    const id = await insertMessage({
      roomId: room(),
      senderId: senderId,
      body: "元の本文",
    });
    const changes = await withMessages(env, (repository) =>
      repository.insertIfOrdered(candidate(id, room())),
    );
    expect(changes).toBe(0);
    expect(await mentionRows(id)).toBe(0);
    expect(await notificationsFor(memberId)).toEqual([]);
    const row = await env.DB.prepare("SELECT body FROM messages WHERE id = ?")
      .bind(id)
      .first<{ body: string }>();
    expect(row?.body).toBe("元の本文");
  });

  it("#139 AC-2: 別の部屋の同じグローバルID衝突はエラーを伝え副作用を残さない", async () => {
    const id = await insertMessage({
      roomId: room(),
      senderId: senderId,
      body: "元の本文",
    });
    const otherRoom = await insertChannel({
      name: "[UNIT_TEST]指名別部屋",
      purpose: "normal",
      departmentId: department.id,
    });
    await insertMember(otherRoom, senderId);
    await expect(
      withMessages(env, (repository) =>
        repository.insertIfOrdered(candidate(id, otherRoom)),
      ),
    ).rejects.toThrow();
    expect(await mentionRows(id)).toBe(0);
    expect(await notificationsFor(memberId)).toEqual([]);
    const row = await env.DB.prepare(
      "SELECT room_id, body FROM messages WHERE id = ?",
    )
      .bind(id)
      .first<{ room_id: string; body: string }>();
    expect(row).toEqual({ room_id: room(), body: "元の本文" });
  });

  it("#139 AC-2: 存在しない部屋ではINSERT0行で指名・通知の副作用を残さない", async () => {
    const id = ulidAt(1_800_000_010_000);
    const changes = await withMessages(env, (repository) =>
      repository.insertIfOrdered(candidate(id, testId("ROOM"))),
    );
    expect(changes).toBe(0);
    expect(await mentionRows(id)).toBe(0);
    expect(await notificationsFor(memberId)).toEqual([]);
    const row = await env.DB.prepare("SELECT id FROM messages WHERE id = ?")
      .bind(id)
      .first();
    expect(row).toBeNull();
  });

  it("#139 AC-3: 投稿者の参加資格を失ったINSERT0行は指名・通知を残さない", async () => {
    await env.DB.prepare(
      "DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?",
    )
      .bind(room(), senderId)
      .run();
    const id = ulidAt(1_800_000_010_000);
    const changes = await withMessages(env, (repository) =>
      repository.insertIfOrdered(candidate(id, room())),
    );
    expect(changes).toBe(0);
    expect(await mentionRows(id)).toBe(0);
    expect(await notificationsFor(memberId)).toEqual([]);
    expect(await messageCount(room())).toBe(0);
  });

  it("#139 AC-2: 削除済み親への返信INSERT0行は指名・通知を残さない", async () => {
    const parentMessageId = await insertMessage({
      roomId: room(),
      senderId: senderId,
      body: "親の投稿",
    });
    await env.DB.prepare("UPDATE messages SET deleted_at = ? WHERE id = ?")
      .bind("2026-11-15T00:00:00.000Z", parentMessageId)
      .run();
    const id = ulidAt(1_800_000_010_000);
    const changes = await withMessages(env, (repository) =>
      repository.insertReplyIfOrdered({
        ...candidate(id, room()),
        parentMessageId,
        createdAt: "2026-11-15T00:00:01.000Z",
      }),
    );
    expect(changes).toBe(0);
    expect(await mentionRows(id)).toBe(0);
    expect(await notificationsFor(memberId)).toEqual([]);
    expect(await messageCount(room())).toBe(1);
  });
});
