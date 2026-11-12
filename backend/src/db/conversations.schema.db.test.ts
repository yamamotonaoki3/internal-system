// #136 AC-3（C-168(1)）・AC-1（1-2 AC-1・AC-2）: migration 0016（rooms の作り直し）と 0017（conversations・conversation_members）の制約を、
// マイグレーション済みの D1 に直接書いて確かめる。
// 0016：kind は 'channel'・'direct' だけ。作り直しの後も外部キーの違反が 0 行で、channels・messages の外部キーは rooms(id) を指したまま強制される。
// 0017：direct_key の一意、(conversation_id, user_id) の複合主キー、外部キー（rooms・conversations・users）、user_id の索引。
// データは架空（testuser_dmschema_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DM_NOW,
  cleanupDmScenario,
  expectedDirectKey,
  insertDm,
} from "../../test/dm-fixtures";
import {
  insertDepartmentWithChannels,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { insertMessage } from "../../test/message-fixtures";
import { insertUser, testId } from "../../test/role-fixtures";

let dept: SeededDepartment;
let userA: string;
let userB: string;
let userC: string;
const createdRooms: string[] = [];

beforeEach(async () => {
  dept = await insertDepartmentWithChannels("DM制約");
  userA = await insertUser("testuser_dmschema_a", dept.id);
  userB = await insertUser("testuser_dmschema_b", dept.id);
  userC = await insertUser("testuser_dmschema_c", dept.id);
});
afterEach(async () => {
  try {
    for (const id of createdRooms.splice(0)) {
      await env.DB.batch([
        env.DB.prepare(
          "DELETE FROM conversation_members WHERE conversation_id = ?",
        ).bind(id),
        env.DB.prepare("DELETE FROM conversations WHERE room_id = ?").bind(id),
        env.DB.prepare("DELETE FROM rooms WHERE id = ?").bind(id),
      ]);
    }
  } finally {
    await cleanupDmScenario();
  }
});

async function insertRoom(kind: string) {
  const id = testId("SCHROOM");
  createdRooms.push(id);
  await env.DB.prepare(
    "INSERT INTO rooms (id, kind, created_at) VALUES (?, ?, ?)",
  )
    .bind(id, kind, DM_NOW)
    .run();
  return id;
}

const insertConversation = (roomId: string, directKey: string) =>
  env.DB.prepare(
    "INSERT INTO conversations (room_id, direct_key, created_at) VALUES (?, ?, ?)",
  )
    .bind(roomId, directKey, DM_NOW)
    .run();

const insertParty = (conversationId: string, userId: string) =>
  env.DB.prepare(
    "INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)",
  )
    .bind(conversationId, userId)
    .run();

async function count(sql: string, ...params: string[]) {
  const row = await env.DB.prepare(sql)
    .bind(...params)
    .first<{ n: number }>();
  return row?.n ?? -1;
}

describe("#136 C-168(1) migration 0016：rooms.kind を direct に変える", () => {
  it("#136 C-168(1): 'channel'・'direct' は保存でき、'conversation'・'other' は CHECK で拒否する", async () => {
    await insertRoom("channel");
    const direct = await insertRoom("direct");
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM rooms WHERE id = ? AND kind = 'direct'",
        direct,
      ),
    ).toBe(1);
    for (const kind of ["conversation", "other"]) {
      const before = await count("SELECT COUNT(*) AS n FROM rooms");
      await expect(insertRoom(kind)).rejects.toThrow(/CHECK/i);
      expect(await count("SELECT COUNT(*) AS n FROM rooms")).toBe(before);
    }
  });

  it("#136 C-168(1): 作り直しの後、外部キーの違反（foreign_key_check）が 0 行", async () => {
    // 既存のチャンネル・メッセージ・DM が入った状態で確かめる
    await insertMessage({ roomId: dept.dedicatedChannelId, senderId: userA });
    const dm = await insertDm(userA, userB);
    await insertMessage({
      roomId: dm,
      senderId: userA,
      id: "01JTESTDMSCHEMAMSG00000000",
    });
    const { results } = await env.DB.prepare(
      "SELECT * FROM pragma_foreign_key_check",
    ).all();
    expect(results).toEqual([]);
  });

  it.each(["channels", "messages"])(
    "#136 C-168(1): %s の room_id の外部キーは、作り直した rooms(id) を指している",
    async (table) => {
      const { results } = await env.DB.prepare(
        `SELECT "table" AS target, "from" AS col, "to" AS ref FROM pragma_foreign_key_list('${table}')`,
      ).all<{ target: string; col: string; ref: string }>();
      expect(results).toContainEqual({
        target: "rooms",
        col: "room_id",
        ref: "id",
      });
      // 作り直しの途中の名前（__new_rooms）を指したまま残っていない
      expect(results.map((r) => r.target)).not.toContain("__new_rooms");
    },
  );

  it("#136 C-168(1): 作り直しの後も外部キーは強制される（存在しない部屋を指すチャンネル・メッセージは保存できない）", async () => {
    const missing = testId("NOROOM");
    await expect(
      env.DB.prepare(
        `INSERT INTO channels (room_id, department_id, name, name_normalized, description, visibility, purpose,
           created_by, version, created_at, updated_at, deleted_at, deleted_by)
         VALUES (?, NULL, ?, ?, '', 'public', 'normal', NULL, 1, ?, ?, NULL, NULL)`,
      )
        .bind(
          missing,
          "[UNIT_TEST]外部キー",
          "[unit_test]外部キー",
          DM_NOW,
          DM_NOW,
        )
        .run(),
    ).rejects.toThrow(/FOREIGN KEY/i);
    await expect(
      insertMessage({ roomId: missing, senderId: userA }),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });

  it("#136 C-168(1): 作り直した rooms は、主キーと created_at の既定値を保っている", async () => {
    const id = testId("SCHROOM");
    createdRooms.push(id);
    await env.DB.prepare("INSERT INTO rooms (id, kind) VALUES (?, 'direct')")
      .bind(id)
      .run();
    const row = await env.DB.prepare(
      "SELECT created_at FROM rooms WHERE id = ?",
    )
      .bind(id)
      .first<{ created_at: string }>();
    expect(row?.created_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    await expect(
      env.DB.prepare("INSERT INTO rooms (id, kind) VALUES (?, 'channel')")
        .bind(id)
        .run(),
    ).rejects.toThrow(/UNIQUE|PRIMARY/i);
  });
});

describe("#136 AC-1（1-2 AC-1・AC-2）migration 0017：conversations・conversation_members", () => {
  it("#136 AC-1: 同じ direct_key の会話は2つ作れない（同じ2人の DM は1つ）", async () => {
    const first = await insertRoom("direct");
    const second = await insertRoom("direct");
    await insertConversation(first, expectedDirectKey(userA, userB));
    await expect(
      insertConversation(second, expectedDirectKey(userA, userB)),
    ).rejects.toThrow(/UNIQUE/i);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM conversations WHERE room_id = ?",
        second,
      ),
    ).toBe(0);
  });

  it("#136 AC-1: 違う2人なら、別の会話を作れる", async () => {
    const first = await insertRoom("direct");
    const second = await insertRoom("direct");
    await insertConversation(first, expectedDirectKey(userA, userB));
    await insertConversation(second, expectedDirectKey(userA, userC));
  });

  it("#136 AC-1: 存在しない部屋を指す会話は、外部キーで拒否する", async () => {
    await expect(
      insertConversation(testId("NOROOM"), expectedDirectKey(userA, userB)),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });

  it("#136 AC-2: 当事者は (conversation_id, user_id) の複合主キー：同じ人を同じ会話に2回入れられず、同じ会話に別の人は入れられる", async () => {
    const room = await insertRoom("direct");
    await insertConversation(room, expectedDirectKey(userA, userB));
    await insertParty(room, userA);
    await insertParty(room, userB);
    await expect(insertParty(room, userA)).rejects.toThrow(/UNIQUE|PRIMARY/i);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM conversation_members WHERE conversation_id = ?",
        room,
      ),
    ).toBe(2);
    const { results } = await env.DB.prepare(
      "SELECT name, pk FROM pragma_table_info('conversation_members') WHERE pk > 0 ORDER BY pk",
    ).all<{ name: string; pk: number }>();
    expect(results.map((r) => r.name)).toEqual(["conversation_id", "user_id"]);
  });

  it("#136 AC-2: 存在しない会話・存在しない社員を指す当事者は、外部キーで拒否する", async () => {
    const room = await insertRoom("direct");
    await insertConversation(room, expectedDirectKey(userA, userB));
    await expect(insertParty(testId("NOCONV"), userA)).rejects.toThrow(
      /FOREIGN KEY/i,
    );
    await expect(insertParty(room, testId("NOUSER"))).rejects.toThrow(
      /FOREIGN KEY/i,
    );
    // 会話の行がない部屋（rooms だけ）を指す当事者も拒否する（当事者は conversations を指す）
    const bare = await insertRoom("direct");
    await expect(insertParty(bare, userA)).rejects.toThrow(/FOREIGN KEY/i);
  });

  it("#136 AC-2: 利用者ごとに自分の DM を引くための索引（conversation_members の user_id）がある", async () => {
    const { results: indexes } = await env.DB.prepare(
      "SELECT name FROM pragma_index_list('conversation_members')",
    ).all<{ name: string }>();
    const columnLists: string[][] = [];
    for (const index of indexes) {
      const { results } = await env.DB.prepare(
        `SELECT name FROM pragma_index_info('${index.name.replace(/'/g, "''")}') ORDER BY seqno`,
      ).all<{ name: string }>();
      columnLists.push(results.map((r) => r.name));
    }
    expect(columnLists).toContainEqual(["user_id"]);
  });

  it("#136 AC-1: 会話の created_at は既定で現在時刻（ISO 8601）が入る", async () => {
    const room = await insertRoom("direct");
    await env.DB.prepare(
      "INSERT INTO conversations (room_id, direct_key) VALUES (?, ?)",
    )
      .bind(room, expectedDirectKey(userA, userB))
      .run();
    const row = await env.DB.prepare(
      "SELECT created_at FROM conversations WHERE room_id = ?",
    )
      .bind(room)
      .first<{ created_at: string }>();
    expect(row?.created_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });
});
