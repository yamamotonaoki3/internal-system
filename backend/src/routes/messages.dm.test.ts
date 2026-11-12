// #136 AC-1（1-2 AC-1・AC-2・AC-3・AC-6）・AC-3（C-168(2)・(7)）: メッセージの一覧・投稿（EP-1-01・EP-1-02）の DM の枝を、
// 実際のアプリ入口（index.ts の app）と隔離 D1 で確かめる。
// 判定の順（計画 改訂2 指摘2）：当事者か（違えば 404。文言はチャンネルの 404 と同じ）→ perm.dm.message.view／send（403）→（投稿だけ）相手が無効なら 409 CONFLICT。
// 一覧は相手が無効でも 200（履歴は読める）。本文の形の誤り 422 は既存どおり Controller が先。
// 応答の形はチャンネルと同じ（#201）：一覧 { items: [{ id, roomId, author: { id, displayName }, body, createdAt }], nextCursor } ／ after あり { items, hasMore }、投稿 201 { id, roomId, createdAt }。
// 403（権限の拒否）は固定ロールがすべて DM の権限を持つため API では起こせない。Service の単体（services/message.dm-authorize.test.ts）で確かめる。
// データは架空（testuser_dm_、[UNIT_TEST]、@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  cleanupDmScenario,
  deactivateUser,
  dmCounts,
  insertDm,
  insertDmUser,
  type DmUser,
} from "../../test/dm-fixtures";
import {
  insertDepartmentWithChannels,
  makeGlobalAdmin,
  makeOwner,
  type SeededDepartment,
} from "../../test/department-fixtures";
import {
  ZERO_ID,
  insertMessage,
  messageIds,
} from "../../test/message-fixtures";
import { testId } from "../../test/role-fixtures";

type Item = {
  id: string;
  roomId: string;
  author: { id: string; displayName: string };
  body: string;
  createdAt: string;
};
type Page = { items: Item[]; nextCursor?: string | null; hasMore?: boolean };

let deptA: SeededDepartment;
let deptB: SeededDepartment;
let alice: DmUser;
let bob: DmUser;
let stranger: DmUser;
let ownerA: DmUser;
let ownerB: DmUser;
let admin: DmUser;
let roomId: string;

const path = (id: string) => `/api/rooms/${id}/messages`;
const get = (id: string, token: string | null, query = "") =>
  apiRequest("GET", `${path(id)}${query}`, { token });
const send = (id: string, text: string, token: string | null) =>
  apiRequest("POST", path(id), { token, body: { body: text } });

async function pageOf(id: string, token: string, query = "") {
  const response = await get(id, token, query);
  expect(response.status).toBe(200);
  return (await response.json()) as Page;
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  deptA = await insertDepartmentWithChannels("DMメッセージA");
  deptB = await insertDepartmentWithChannels("DMメッセージB");
  alice = await insertDmUser(
    "testuser_dm_msg_alice",
    deptA.id,
    "テストDMアリス",
  );
  bob = await insertDmUser("testuser_dm_msg_bob", deptB.id, "テストDMボブ");
  stranger = await insertDmUser(
    "testuser_dm_msg_stranger",
    deptA.id,
    "テストDM第三者",
  );
  ownerA = await insertDmUser(
    "testuser_dm_msg_owner_a",
    deptA.id,
    "テストDM自部署長",
  );
  ownerB = await insertDmUser(
    "testuser_dm_msg_owner_b",
    deptB.id,
    "テストDM他部署長",
  );
  admin = await insertDmUser(
    "testuser_dm_msg_admin",
    deptA.id,
    "テストDM管理者",
  );
  await makeOwner(ownerA.userId, deptA.id);
  await makeOwner(ownerB.userId, deptB.id);
  await makeGlobalAdmin(admin.userId);
  roomId = await insertDm(alice.userId, bob.userId);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupDmScenario();
});

describe("#136 AC-1（1-2 AC-1・AC-3）当事者のやり取り", () => {
  it("#136 AC-1（1-2 AC-1）: 当事者が DM に投稿でき（201）、相手の一覧に、投稿時の表示名で出る", async () => {
    const response = await send(roomId, "[UNIT_TEST]こんにちは", alice.token);
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string; roomId: string };
    expect(created.roomId).toBe(roomId);
    const items = (await pageOf(roomId, bob.token)).items;
    expect(items.map((i) => i.id)).toEqual([created.id]);
    expect(items[0]).toMatchObject({
      roomId,
      author: { id: alice.userId, displayName: "テストDMアリス" },
      body: "[UNIT_TEST]こんにちは",
    });
  });

  it("#136 AC-1（1-2 AC-3）: 相手がログインしていない間に送ったメッセージを、相手が後でログインして読める。返信も届く", async () => {
    // 相手（bob）のセッションを使わずに送る。読むときに初めて bob のトークンを使う
    const first = await send(roomId, "[UNIT_TEST]不在の間に", alice.token);
    expect(first.status).toBe(201);
    const second = await send(roomId, "[UNIT_TEST]二通目", alice.token);
    expect(second.status).toBe(201);
    const page = await pageOf(roomId, bob.token, `?after=${ZERO_ID}`);
    expect(page.items.map((i) => i.body)).toEqual([
      "[UNIT_TEST]不在の間に",
      "[UNIT_TEST]二通目",
    ]);
    const reply = await send(roomId, "[UNIT_TEST]返信", bob.token);
    expect(reply.status).toBe(201);
    const latest = (await pageOf(roomId, alice.token)).items;
    expect(latest[0]?.author).toEqual({
      id: bob.userId,
      displayName: "テストDMボブ",
    });
  });

  it("#136 AC-1（1-2 AC-3）: DM でも「最後のID以降」（after）が使え、境界を含まずに新着だけを返す", async () => {
    const one = (await (await send(roomId, "一", alice.token)).json()) as {
      id: string;
    };
    const two = (await (await send(roomId, "二", bob.token)).json()) as {
      id: string;
    };
    const page = await pageOf(roomId, alice.token, `?after=${one.id}`);
    expect(page.items.map((i) => i.id)).toEqual([two.id]);
    expect(page.hasMore).toBe(false);
  });

  it("#136 AC-1（1-2 AC-6）: 後で表示名を変えても、過去の DM の投稿の表示名は変わらない", async () => {
    expect((await send(roomId, "[UNIT_TEST]前", alice.token)).status).toBe(201);
    await env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?")
      .bind("テスト変更後", alice.userId)
      .run();
    const item = (await pageOf(roomId, bob.token)).items[0];
    expect(item?.author.displayName).toBe("テストDMアリス");
  });

  it("#136 AC-1: DM の本文も、チャンネルと同じ規則で検証する（空白だけ・4,001文字は 422 で、行は増えない）", async () => {
    for (const text of ["  \n ", "a".repeat(4001)]) {
      const response = await send(roomId, text, alice.token);
      expect(response.status).toBe(422);
    }
    expect(await messageIds(roomId)).toEqual([]);
  });
});

describe("#136 AC-1（1-2 AC-2）当事者だけが閲覧・投稿できる", () => {
  it.each([
    ["第三者（同じ部署）", () => stranger],
    ["自部署（当事者の部署）のオーナー", () => ownerA],
    ["他部署のオーナー", () => ownerB],
    ["全体管理者", () => admin],
  ])(
    "#136 AC-1（1-2 AC-2）: %s は、一覧も投稿も 404 で、存在しない部屋と区別がつかず、行は増えない",
    async (_label, who) => {
      const existing = await insertMessage({ roomId, senderId: alice.userId });
      const token = who().token;
      const missing = testId("NOROOM");
      const read = await get(roomId, token);
      const write = await send(roomId, "[UNIT_TEST]のぞき見", token);
      const missingRead = await get(missing, token);
      const missingWrite = await send(missing, "[UNIT_TEST]x", token);
      expect(read.status).toBe(404);
      expect(write.status).toBe(404);
      expect(await read.json()).toEqual(await missingRead.json());
      expect(await write.json()).toEqual(await missingWrite.json());
      expect(await messageIds(roomId)).toEqual([existing]);
    },
  );

  it("#136 AC-1（1-2 AC-2）: 第三者は after つきの一覧でも 404", async () => {
    await insertMessage({ roomId, senderId: alice.userId });
    expect(
      (await get(roomId, stranger.token, `?after=${ZERO_ID}`)).status,
    ).toBe(404);
  });

  it("#136 AC-1（認可）: 未認証は一覧も投稿も 401 で、行は増えない", async () => {
    expect((await get(roomId, null)).status).toBe(401);
    expect((await send(roomId, "[UNIT_TEST]x", null)).status).toBe(401);
    expect(await messageIds(roomId)).toEqual([]);
  });

  it("#136 AC-1（認可）: 許可されていない Origin からの投稿は 403 FORBIDDEN_ORIGIN で、行は増えない", async () => {
    const response = await apiRequest("POST", path(roomId), {
      token: alice.token,
      body: { body: "[UNIT_TEST]x" },
      origin: "https://origin.invalid",
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
    expect(await messageIds(roomId)).toEqual([]);
  });
});

describe("#136 AC-1（1-2 AC-6）・C-168(2) 相手が無効な DM", () => {
  it("#136 C-168(2): 相手が無効になった DM への投稿は 409 CONFLICT で、行は増えない", async () => {
    await deactivateUser(bob.userId);
    const before = await dmCounts();
    const response = await send(roomId, "[UNIT_TEST]届かない", alice.token);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "CONFLICT" });
    expect(await dmCounts()).toEqual(before);
    expect(await messageIds(roomId)).toEqual([]);
  });

  it("#136 C-168(2): 相手が無効になっても、履歴は 200 で読め、相手の過去の投稿も出る", async () => {
    const fromBob = await insertMessage({
      roomId,
      senderId: bob.userId,
      displayName: "テストDMボブ",
    });
    await deactivateUser(bob.userId);
    const page = await pageOf(roomId, alice.token);
    expect(page.items.map((i) => i.id)).toEqual([fromBob]);
    expect(page.items[0]?.author).toEqual({
      id: bob.userId,
      displayName: "テストDMボブ",
    });
  });

  it("#136 C-168(2): 判定の順：相手が無効でも、第三者には 409 ではなく 404（当事者かが先）", async () => {
    await deactivateUser(bob.userId);
    expect((await send(roomId, "[UNIT_TEST]x", stranger.token)).status).toBe(
      404,
    );
  });

  it("#136 C-168(2): 判定の順：相手が無効でも、本文の形の誤りは 422（Controller が先）", async () => {
    await deactivateUser(bob.userId);
    expect((await send(roomId, "", alice.token)).status).toBe(422);
  });
});
