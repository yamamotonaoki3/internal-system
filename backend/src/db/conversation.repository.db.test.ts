// #136 AC-1（1-2 AC-1・AC-2）・AC-3（C-168(5)・(7)）: DM の Repository（conversation.repository.ts）と一覧の DAO を、隔離 D1 で確かめる。
// 契約（実装前の仮定。計画 2章・3章）：
//  - createConversationRepository(db) / withConversations(env, run)
//  - create({ roomId, directKey, userIds: [a, b] })：rooms(kind='direct')・conversations・conversation_members×2 を1つの db.batch で作る（全部か無しか）
//      direct_key の一意違反は DirectConversationExistsError に変える。それ以外の DB エラーはそのまま伝える
//  - findRoomIdByDirectKey(directKey)：部屋のID か null
//  - listForUser(userId, { limit, cursor? })：{ items: [{ roomId, ... }], nextCursor }。自分が当事者の DM だけ、最終活動の新しい順
//      クエリの数は DM の件数に比例しない（N+1 にしない）
// direct_key は本番の directKeyOf から作らず、dm-fixtures の expectedDirectKey（計画の決まりを独立に書いたもの）で作る。
// データは架空（testuser_dm_repo_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../db/schema";
import {
  cleanupDmScenario,
  dmCounts,
  dmMembersOf,
  expectedDirectKey,
  insertDmAt,
  roomKindOf,
} from "../../test/dm-fixtures";
import {
  insertDepartmentWithChannels,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { insertMessage, ulidAt } from "../../test/message-fixtures";
import { insertUser, testId } from "../../test/role-fixtures";
import {
  DirectConversationExistsError,
  createConversationRepository,
  withConversations,
} from "./conversation.repository";

let dept: SeededDepartment;
let userA: string;
let userB: string;
let userC: string;
const createdRooms: string[] = [];

beforeEach(async () => {
  dept = await insertDepartmentWithChannels("DMリポジトリ");
  userA = await insertUser("testuser_dm_repo_a", dept.id);
  userB = await insertUser("testuser_dm_repo_b", dept.id);
  userC = await insertUser("testuser_dm_repo_c", dept.id);
});
afterEach(async () => {
  try {
    // 作ろうとした部屋を消す。作成に成功した部屋は会話・当事者が参照しているため、外部キーの順
    // （会話のメッセージ → 当事者 → 会話 → 部屋）に消す。作成に失敗した部屋の残りがあれば、それも消える
    for (const id of createdRooms.splice(0))
      await env.DB.batch([
        env.DB.prepare("DELETE FROM messages WHERE room_id = ?").bind(id),
        env.DB.prepare(
          "DELETE FROM conversation_members WHERE conversation_id = ?",
        ).bind(id),
        env.DB.prepare("DELETE FROM conversations WHERE room_id = ?").bind(id),
        env.DB.prepare(
          "DELETE FROM rooms WHERE id = ? AND kind = 'direct'",
        ).bind(id),
      ]);
  } finally {
    await cleanupDmScenario();
  }
});

function newRoomId() {
  const id = testId("REPOROOM");
  createdRooms.push(id);
  return id;
}

async function countWhere(sql: string, id: string) {
  return (await env.DB.prepare(sql).bind(id).first<{ n: number }>())?.n ?? -1;
}

/** prepare（実行した SQL の文）の数を数える D1 で、Repository を作る */
function countingRepository() {
  let prepares = 0;
  const client = new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "prepare")
        return (query: string) => {
          prepares += 1;
          return target.prepare(query);
        };
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    repository: createConversationRepository(drizzle(client, { schema })),
    count: () => prepares,
    reset: () => {
      prepares = 0;
    },
  };
}

describe("#136 AC-1（1-2 AC-1）・C-168(5) DM の作成（create）", () => {
  it("#136 AC-1・C-168(1): direct の部屋・会話・当事者2人を作り、direct_key で引ける", async () => {
    const roomId = newRoomId();
    const key = expectedDirectKey(userA, userB);
    await withConversations(env, async (repository) => {
      expect(await repository.findRoomIdByDirectKey(key)).toBeNull();
      await repository.create({
        roomId,
        directKey: key,
        userIds: [userA, userB],
      });
      expect(await repository.findRoomIdByDirectKey(key)).toBe(roomId);
    });
    expect(await roomKindOf(roomId)).toBe("direct");
    expect(await dmMembersOf(roomId)).toEqual([userA, userB].sort());
  });

  it("#136 C-168(5): 同じ direct_key で2つ目を作ると DirectConversationExistsError になり、2つ目の部屋・会話・当事者は残らない", async () => {
    const key = expectedDirectKey(userA, userB);
    const first = newRoomId();
    const second = newRoomId();
    await withConversations(env, (r) =>
      r.create({ roomId: first, directKey: key, userIds: [userA, userB] }),
    );
    const before = await dmCounts();
    await expect(
      withConversations(env, (r) =>
        r.create({ roomId: second, directKey: key, userIds: [userB, userA] }),
      ),
    ).rejects.toBeInstanceOf(DirectConversationExistsError);
    expect(await dmCounts()).toEqual(before);
    expect(
      await countWhere("SELECT COUNT(*) AS n FROM rooms WHERE id = ?", second),
    ).toBe(0);
  });

  it("#136 C-168(5)（原子性）: 途中の文（当事者の追加）が失敗したら、部屋・会話も残さず、一意違反以外のエラーはそのまま伝える", async () => {
    const roomId = newRoomId();
    const before = await dmCounts();
    const error = await withConversations(env, (r) =>
      r.create({
        roomId,
        directKey: expectedDirectKey(userA, "01JTESTDMN0SUCHUSER0000000"),
        // 存在しない社員：最後の当事者の追加が外部キーで失敗する
        userIds: [userA, "01JTESTDMN0SUCHUSER0000000"],
      }),
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DirectConversationExistsError);
    expect(await dmCounts()).toEqual(before);
    expect(
      await countWhere("SELECT COUNT(*) AS n FROM rooms WHERE id = ?", roomId),
    ).toBe(0);
    expect(
      await countWhere(
        "SELECT COUNT(*) AS n FROM conversations WHERE room_id = ?",
        roomId,
      ),
    ).toBe(0);
  });
});

describe("#136 AC-1（1-2 AC-2）・C-168(7) 自分の DM の一覧（listForUser）", () => {
  it("#136 AC-1（1-2 AC-2）: 自分が当事者の DM だけを、最終活動の新しい順に返す", async () => {
    const ab = await insertDmAt(userA, userB, 1_800_000_001_000);
    const ac = await insertDmAt(userA, userC, 1_800_000_002_000);
    const bc = await insertDmAt(userB, userC, 1_800_000_003_000);
    await insertMessage({
      roomId: ab,
      senderId: userB,
      id: ulidAt(1_800_000_009_000),
    });
    const page = await withConversations(env, (r) =>
      r.listForUser(userA, { limit: 20 }),
    );
    expect(page.items.map((i) => i.roomId)).toEqual([ab, ac]);
    expect(page.items.map((i) => i.roomId)).not.toContain(bc);
    expect(page.nextCursor).toBeNull();
  });

  it("#136 C-168(7)（N+1 にしない）: 一覧のクエリの数は、DM の件数・メッセージの件数に比例しない", async () => {
    const few = await insertUser("testuser_dm_repo_few", dept.id);
    const many = await insertUser("testuser_dm_repo_many", dept.id);
    const fewRoom = await insertDmAt(few, userA, 1_800_000_001_000);
    await insertMessage({
      roomId: fewRoom,
      senderId: few,
      id: ulidAt(1_800_000_001_500),
    });
    for (let i = 0; i < 6; i += 1) {
      const partner = await insertUser(`testuser_dm_repo_p${i}`, dept.id);
      const room = await insertDmAt(
        many,
        partner,
        1_800_000_010_000 + i * 1000,
      );
      await insertMessage({
        roomId: room,
        senderId: partner,
        id: ulidAt(1_800_000_010_500 + i * 1000),
      });
    }
    const counted = countingRepository();
    const fewPage = await counted.repository.listForUser(few, { limit: 20 });
    const fewQueries = counted.count();
    counted.reset();
    const manyPage = await counted.repository.listForUser(many, { limit: 20 });
    const manyQueries = counted.count();
    expect(fewPage.items).toHaveLength(1);
    expect(manyPage.items).toHaveLength(6);
    expect(fewQueries).toBeGreaterThan(0);
    expect(manyQueries).toBe(fewQueries);
  });
});
