// #238 AC-1〜AC-3（1-1 AC-3 の後半・C-74・C-75）：メッセージ一覧（EP-1-01）の各 items[].author に、投稿者が今も有効かを示す isActive（真偽）を足す。
// 契約（実装者へ）：author は { id, displayName, isActive } のキーだけ。displayName は投稿時点の表示名（messages.sender_display_name）のまま、
// isActive は users.is_active の今の値。本名・ログインID・メール・今の表示名は返さない（C-75）。after なし・after あり・DM の部屋のどれでも同じ。
// 実際のアプリ入口（index.ts の app）と隔離 D1 で確かめる。無効化の API（EP-0-10）はまだないため、deactivateUser（is_active=0 の直接更新）で作る。
// データは架空（testuser_dm_ret238_、[UNIT_TEST]、@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  cleanupDmScenario,
  deactivateUser,
  insertDm,
  insertDmUser,
  type DmUser,
} from "../../test/dm-fixtures";
import {
  insertDepartmentWithChannels,
  insertMember,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { ZERO_ID, insertMessage, ulidAt } from "../../test/message-fixtures";

type Item = {
  id: string;
  roomId: string;
  author: Record<string, unknown>;
  body: string;
  createdAt: string;
};
type Page = { items: Item[]; nextCursor?: string | null; hasMore?: boolean };

const POSTED_NAME = "投稿時の退職者名";
const CHANGED_NAME = "後から変えた名前";

let dept: SeededDepartment;
let otherDept: SeededDepartment;
let viewer: DmUser;
let author: DmUser;
let active: DmUser;
let outsider: DmUser;
let roomId: string;

const get = (id: string, token: string, query = "") =>
  apiRequest("GET", `/api/rooms/${id}/messages${query}`, { token });

async function pageOf(id: string, token: string, query = "") {
  const response = await get(id, token, query);
  expect(response.status).toBe(200);
  return (await response.json()) as Page;
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  dept = await insertDepartmentWithChannels("退職者表示A");
  otherDept = await insertDepartmentWithChannels("退職者表示B");
  viewer = await insertDmUser("testuser_dm_ret238_viewer", dept.id, "閲覧者");
  author = await insertDmUser(
    "testuser_dm_ret238_author",
    dept.id,
    POSTED_NAME,
  );
  active = await insertDmUser("testuser_dm_ret238_active", dept.id, "在職者");
  outsider = await insertDmUser(
    "testuser_dm_ret238_outsider",
    otherDept.id,
    "別部署の閲覧者",
  );
  for (const user of [viewer, author, active])
    await insertMember(dept.dedicatedChannelId, user.userId);
  roomId = dept.dedicatedChannelId;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupDmScenario();
});

describe("#238 AC-1 無効な投稿者に isActive: false を返す", () => {
  it("#238 AC-1: 投稿の後に投稿者を無効にすると、一覧（after なし）の author が { id, displayName: 投稿時点, isActive: false } になる", async () => {
    await insertMessage({
      roomId,
      senderId: author.userId,
      displayName: POSTED_NAME,
    });
    await deactivateUser(author.userId);
    const items = (await pageOf(roomId, viewer.token)).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.author).toEqual({
      id: author.userId,
      displayName: POSTED_NAME,
      isActive: false,
    });
  });

  it("#238 AC-1: after ありの一覧（ポーリングの経路）でも、同じ author になる", async () => {
    await insertMessage({
      roomId,
      senderId: author.userId,
      displayName: POSTED_NAME,
    });
    await deactivateUser(author.userId);
    const page = await pageOf(roomId, viewer.token, `?after=${ZERO_ID}`);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.author).toEqual({
      id: author.userId,
      displayName: POSTED_NAME,
      isActive: false,
    });
  });

  it("#238 AC-1: 無効にする前に users.display_name を変えても、displayName は投稿時点のまま、isActive は false", async () => {
    await insertMessage({
      roomId,
      senderId: author.userId,
      displayName: POSTED_NAME,
    });
    await env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?")
      .bind(CHANGED_NAME, author.userId)
      .run();
    await deactivateUser(author.userId);
    for (const query of ["", `?after=${ZERO_ID}`]) {
      const item = (await pageOf(roomId, viewer.token, query)).items[0];
      expect(item?.author, query).toEqual({
        id: author.userId,
        displayName: POSTED_NAME,
        isActive: false,
      });
    }
  });

  it("#238 AC-1: 参加していない公開チャンネルの閲覧者にも、無効な投稿者は isActive: false で返る", async () => {
    await insertMessage({
      roomId,
      senderId: author.userId,
      displayName: POSTED_NAME,
    });
    await deactivateUser(author.userId);
    const items = (await pageOf(roomId, outsider.token)).items;
    expect(items[0]?.author).toEqual({
      id: author.userId,
      displayName: POSTED_NAME,
      isActive: false,
    });
  });

  it("#238 AC-1: 無効にした投稿者を再び有効にすると、isActive は true に戻る", async () => {
    await insertMessage({
      roomId,
      senderId: author.userId,
      displayName: POSTED_NAME,
    });
    await deactivateUser(author.userId);
    expect((await pageOf(roomId, viewer.token)).items[0]?.author).toMatchObject(
      { isActive: false },
    );
    await env.DB.prepare(
      "UPDATE users SET is_active = 1, deactivated_at = NULL WHERE id = ?",
    )
      .bind(author.userId)
      .run();
    expect((await pageOf(roomId, viewer.token)).items[0]?.author).toEqual({
      id: author.userId,
      displayName: POSTED_NAME,
      isActive: true,
    });
  });

  it("#238 AC-1: DM の部屋でも、無効な相手の投稿は isActive: false（履歴は 200 で読める）", async () => {
    const dm = await insertDm(viewer.userId, author.userId);
    await insertMessage({
      roomId: dm,
      senderId: author.userId,
      displayName: POSTED_NAME,
    });
    await deactivateUser(author.userId);
    const items = (await pageOf(dm, viewer.token)).items;
    expect(items[0]?.author).toEqual({
      id: author.userId,
      displayName: POSTED_NAME,
      isActive: false,
    });
  });

  it("#238 AC-1: 無効な投稿者が混ざる50件を超える一覧（60件）で nextCursor を使っても、2ページ目の isActive・件数・重複なしが保たれる", async () => {
    // 無効になる投稿者と有効な投稿者が交互に投稿する60件。新しい順の1ページ目（50件）と2ページ目（10件）の両方に両者が入る
    const ids: string[] = [];
    for (let i = 0; i < 60; i += 1) {
      const isRetiredAuthor = i % 2 === 0;
      ids.push(
        await insertMessage({
          roomId,
          senderId: isRetiredAuthor ? author.userId : active.userId,
          id: ulidAt(1_800_000_000_000 + i),
          displayName: isRetiredAuthor ? POSTED_NAME : "在職者",
        }),
      );
    }
    await deactivateUser(author.userId);
    const first = await pageOf(roomId, viewer.token);
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await pageOf(
      roomId,
      viewer.token,
      `?cursor=${first.nextCursor}`,
    );
    const all = [...first.items, ...second.items];
    expect(all).toHaveLength(ids.length);
    expect(new Set(all.map((i) => i.id)).size).toBe(all.length);
    for (const page of [first.items, second.items]) {
      expect(page.some((i) => i.author.id === author.userId)).toBe(true);
      expect(page.some((i) => i.author.id === active.userId)).toBe(true);
      for (const item of page) {
        expect(item.author.isActive, item.id).toBe(
          item.author.id !== author.userId,
        );
      }
    }
  });
});

describe("#238 AC-1（C-75）応答に個人情報を足さない", () => {
  it("#238 AC-1: author のキーはちょうど id・displayName・isActive で、本名・ログインID・メール・今の表示名が応答に含まれない", async () => {
    await insertMessage({
      roomId,
      senderId: author.userId,
      displayName: POSTED_NAME,
    });
    await env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?")
      .bind(CHANGED_NAME, author.userId)
      .run();
    await deactivateUser(author.userId);
    for (const query of ["", `?after=${ZERO_ID}`]) {
      const response = await get(roomId, viewer.token, query);
      const text = await response.text();
      const page = JSON.parse(text) as Page;
      expect(Object.keys(page.items[0]?.author ?? {}).sort(), query).toEqual([
        "displayName",
        "id",
        "isActive",
      ]);
      expect(text).not.toContain("testuser_dm_ret238_author");
      expect(text).not.toContain("@example.com");
      expect(text).not.toContain(CHANGED_NAME);
      expect(text).not.toContain("v1:AAAAAAAAAAAAAAAA");
    }
  });
});

describe("#238 AC-3 有効な投稿者の表示は変わらない", () => {
  it("#238 AC-3: 有効な投稿者の author は { id, displayName, isActive: true }。無効な人と混ざっても、有効な人は true のまま", async () => {
    await insertMessage({
      roomId,
      senderId: active.userId,
      id: ulidAt(1_800_000_000_001),
      displayName: "在職者",
    });
    await insertMessage({
      roomId,
      senderId: author.userId,
      id: ulidAt(1_800_000_000_002),
      displayName: POSTED_NAME,
    });
    await deactivateUser(author.userId);
    const items = (await pageOf(roomId, viewer.token)).items;
    expect(items.map((i) => i.author)).toEqual([
      { id: author.userId, displayName: POSTED_NAME, isActive: false },
      { id: active.userId, displayName: "在職者", isActive: true },
    ]);
  });
});
