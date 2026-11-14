// #137 AC-1（1-4 AC-1〜4）: migration 0020（messages.parent_message_id・thread_read_positions）の制約を、マイグレーション済みの D1 に直接書いて確かめる。
// 決定（計画 U-1・決めたこと1）：messages に parent_message_id（NULL 可・messages(id) を参照）を最後の列として足し、索引 (parent_message_id, id) を張る。
//   thread_read_positions(user_id → users.id, parent_message_id → messages.id, last_read_message_id（外部キーにしない。C-169(5)）, updated_at)、主キー (user_id, parent_message_id)。
// 「列を足した後も、チャンネル・DM の新しい投稿（insertIfOrdered）が通る」ことも確かめる（挿入の SELECT の列数が合わないと、既存の投稿がすべて失敗する）。
// データは架空（testuser_thrschema_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  insertDepartmentWithChannels,
  insertMember,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { insertDm } from "../../test/dm-fixtures";
import {
  insertMessage,
  insertReply,
  messageIds,
} from "../../test/message-fixtures";
import { insertUser, testId } from "../../test/role-fixtures";
import {
  cleanupThreadScenario,
  idAt,
  insertThreadReadPosition,
  isoAt,
  parentRow,
} from "../../test/thread-fixtures";
import { withMessages } from "./message.repository";

let dept: SeededDepartment;
let alice: string;
let bob: string;
let parent: string;

beforeEach(async () => {
  dept = await insertDepartmentWithChannels("スレッド制約");
  alice = await insertUser("testuser_thrschema_alice", dept.id);
  bob = await insertUser("testuser_thrschema_bob", dept.id);
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

describe("#137 AC-1（1-4 AC-1）messages.parent_message_id（migration 0020）", () => {
  it("#137 AC-1（1-4 AC-1）: messages に parent_message_id 列があり、NULL を許し、最後の列である", async () => {
    const { results } = await env.DB.prepare(
      "SELECT cid, name, \"notnull\" AS not_null FROM pragma_table_info('messages') ORDER BY cid",
    ).all<{ cid: number; name: string; not_null: number }>();
    const last = results[results.length - 1];
    expect(last?.name).toBe("parent_message_id");
    expect(last?.not_null).toBe(0);
  });

  it("#137 AC-1（1-4 AC-1）: parent_message_id は messages(id) への外部キーで、存在しない親を指す行は保存できない", async () => {
    const { results } = await env.DB.prepare(
      'SELECT "from" AS from_column, "table" AS to_table, "to" AS to_column FROM pragma_foreign_key_list(\'messages\')',
    ).all<{ from_column: string; to_table: string; to_column: string }>();
    expect(results).toContainEqual({
      from_column: "parent_message_id",
      to_table: "messages",
      to_column: "id",
    });
    await expect(
      insertReply({
        roomId: dept.dedicatedChannelId,
        senderId: bob,
        id: idAt(2),
        parentMessageId: testId("NOPARENT"),
      }),
    ).rejects.toThrow();
  });

  it("#137 AC-1（1-4 AC-1）: 存在する親を指す返信は保存でき、親の行は変わらない（parent_message_id は NULL のまま）", async () => {
    await insertReply({
      roomId: dept.dedicatedChannelId,
      senderId: bob,
      id: idAt(2),
      parentMessageId: parent,
    });
    expect((await parentRow(idAt(2)))?.parent_message_id).toBe(parent);
    expect((await parentRow(parent))?.parent_message_id).toBeNull();
  });

  it("#137 AC-1（1-4 AC-1）: 返信を持つ親の行は、外部キーで消せない", async () => {
    await insertReply({
      roomId: dept.dedicatedChannelId,
      senderId: bob,
      id: idAt(2),
      parentMessageId: parent,
    });
    await expect(
      env.DB.prepare("DELETE FROM messages WHERE id = ?").bind(parent).run(),
    ).rejects.toThrow();
  });

  it("#137 AC-1（1-4 AC-1）: 索引 messages_parent_message_id_id_idx が (parent_message_id, id) の順である", async () => {
    const { results } = await env.DB.prepare(
      "SELECT seqno, name FROM pragma_index_info('messages_parent_message_id_id_idx') ORDER BY seqno",
    ).all<{ seqno: number; name: string }>();
    expect(results.map((r) => r.name)).toEqual(["parent_message_id", "id"]);
  });
});

describe("#137 AC-1（1-4 AC-4）thread_read_positions（migration 0020）", () => {
  it("#137 AC-4（C-147）: 列は user_id・parent_message_id・last_read_message_id・updated_at で、主キーは (user_id, parent_message_id)", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name, pk FROM pragma_table_info('thread_read_positions') ORDER BY cid",
    ).all<{ name: string; pk: number }>();
    expect(results.map((r) => r.name)).toEqual([
      "user_id",
      "parent_message_id",
      "last_read_message_id",
      "updated_at",
    ]);
    const keys = results
      .filter((r) => r.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((r) => r.name);
    expect(keys).toEqual(["user_id", "parent_message_id"]);
  });

  it("#137 AC-4（C-147）: 同じ (利用者, 親) の行は2つ入れられない。別の利用者・別の親なら入れられる", async () => {
    await insertThreadReadPosition(alice, parent, idAt(5));
    await expect(
      insertThreadReadPosition(alice, parent, idAt(6)),
    ).rejects.toThrow();
    await insertThreadReadPosition(bob, parent, idAt(5));
    const other = idAt(3);
    await insertMessage({
      roomId: dept.dedicatedChannelId,
      senderId: alice,
      id: other,
    });
    await insertThreadReadPosition(alice, other, idAt(5));
  });

  it("#137 AC-4（C-147）: 存在しない利用者・存在しない親を指す行は、外部キーで入れられない", async () => {
    await expect(
      insertThreadReadPosition(testId("NOUSER"), parent, idAt(5)),
    ).rejects.toThrow();
    await expect(
      insertThreadReadPosition(alice, testId("NOPARENT"), idAt(5)),
    ).rejects.toThrow();
  });

  it("#137 AC-4（C-147・C-169(5)）: last_read_message_id は外部キーではない（存在しない ID も入れられる）", async () => {
    await insertThreadReadPosition(alice, parent, testId("GONE"));
    const { results } = await env.DB.prepare(
      "SELECT \"from\" AS from_column FROM pragma_foreign_key_list('thread_read_positions')",
    ).all<{ from_column: string }>();
    expect(results.map((r) => r.from_column).sort()).toEqual([
      "parent_message_id",
      "user_id",
    ]);
  });
});

describe("#137 AC-1（1-4 AC-1）列を足した後も、新しい投稿（insertIfOrdered）が通る", () => {
  const base = {
    senderDisplayName: "テスト太郎",
    body: "[UNIT_TEST]列追加の後",
    createdAt: isoAt(50),
  };

  it("#137 AC-1: チャンネルの新しい投稿は1行入り、parent_message_id は NULL", async () => {
    const id = idAt(50);
    const inserted = await withMessages(env, (repository) =>
      repository.insertIfOrdered({
        ...base,
        id,
        roomId: dept.dedicatedChannelId,
        senderId: alice,
      }),
    );
    expect(inserted).toBe(1);
    expect((await parentRow(id))?.parent_message_id).toBeNull();
  });

  it("#137 AC-1: DM の新しい投稿も1行入り、parent_message_id は NULL", async () => {
    const roomId = await insertDm(alice, bob);
    const id = idAt(51);
    const inserted = await withMessages(env, (repository) =>
      repository.insertIfOrdered({
        ...base,
        id,
        roomId,
        senderId: alice,
      }),
    );
    expect(inserted).toBe(1);
    expect((await parentRow(id))?.parent_message_id).toBeNull();
  });

  it("#137 AC-1（決めたこと2）: 部屋の最大の ID は返信も含める。返信の ID 以下の通常の投稿は挿入されない（0行）", async () => {
    const replyId = idAt(60);
    await insertReply({
      roomId: dept.dedicatedChannelId,
      senderId: bob,
      id: replyId,
      parentMessageId: parent,
    });
    const rows = await withMessages(env, async (repository) => ({
      lower: await repository.insertIfOrdered({
        ...base,
        id: idAt(55),
        roomId: dept.dedicatedChannelId,
        senderId: alice,
      }),
      higher: await repository.insertIfOrdered({
        ...base,
        id: idAt(61),
        roomId: dept.dedicatedChannelId,
        senderId: alice,
      }),
      max: await repository.maxId(dept.dedicatedChannelId),
    }));
    expect(rows.lower).toBe(0);
    expect(rows.higher).toBe(1);
    expect(rows.max).toBe(idAt(61));
    expect(await messageIds(dept.dedicatedChannelId)).not.toContain(idAt(55));
  });
});
