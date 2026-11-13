// #237 AC-1・AC-3・AC-4（3-1 AC-1・AC-3・1-1 AC-2・C-94）：未読の一覧の API（GET /api/me/unread。EP-3-01）を、実際のアプリ入口と隔離 D1 で確かめる。
// 契約（実装者へ。計画「2. 未読数の取得」・改訂2 C・改訂4-3）：
//  - GET /api/me/unread?limit&cursor → 200 { items: [{ roomId, count }], nextCursor }
//      未読が1件以上の部屋だけ、room_id の昇順。count は 1〜100（100 で打ち切り）。名前・種類は返さない。
//      limit は既定 20・1〜100（範囲外は 422）。壊れた cursor・余分なクエリは 422 VALIDATION_ERROR。Cache-Control: no-store。
//      items は limit より少なく、空でも nextCursor がありうる（対象の部屋の room_id でページを送る）。
//  - 未認証 401 UNAUTHENTICATED。perm.notification.own の拒否は 403（固定ロールはすべて持つため、API では作れない。unread.service.test.ts で確かめる）
//  - /api/me（プロフィール等）・/api/me/notifications と重ならない。GET で DB が変わらない
// データは架空（testuser_unread_api_・@example.com・[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest, insertReadyUser } from "../../test/api-request";
import {
  DEPT_NOW,
  insertChannel,
  insertMember,
  makeGlobalAdmin,
  makeOwner,
} from "../../test/department-fixtures";
import { cleanupDmScenario, insertDm } from "../../test/dm-fixtures";
import {
  insertMessagesAt,
  readPositionRows,
  removeMember,
  setArchived,
} from "../../test/read-position-fixtures";
import { TEST_TAG, insertDepartment } from "../../test/role-fixtures";

type Unread = { roomId: string; count: number };
type Page = { items: Unread[]; nextCursor: string | null };
type User = { userId: string; token: string };

const BASE = "/api/me/unread";
const AFTER_JOIN_MS = Date.parse(DEPT_NOW) + 60_000;

let deptId: string;
let alice: User;
let bob: User;
let carol: User;

const get = (path: string, user: User | null = alice) =>
  apiRequest("GET", path, { token: user?.token ?? null });

async function allItems(user: User, limit: number): Promise<Unread[]> {
  const items: Unread[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 30; i += 1) {
    const query: string =
      cursor === null ? `limit=${limit}` : `limit=${limit}&cursor=${cursor}`;
    const res = await get(`${BASE}?${query}`, user);
    expect(res.status).toBe(200);
    const page = (await res.json()) as Page;
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor === null) return items;
  }
  throw new Error("未読の一覧のページが終わりませんでした");
}

async function joinedChannel(label: string, user: User, id?: string) {
  const roomId = await insertChannel({
    name: `${TEST_TAG}未読API${label}`,
    purpose: "normal",
    departmentId: deptId,
    ...(id === undefined ? {} : { id }),
  });
  await insertMember(roomId, user.userId);
  return roomId;
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  deptId = await insertDepartment("未読API");
  alice = await insertReadyUser("testuser_unread_api_alice", deptId);
  bob = await insertReadyUser("testuser_unread_api_bob", deptId);
  carol = await insertReadyUser("testuser_unread_api_carol", deptId);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupDmScenario();
});

describe("#237 AC-1 共通：認証・応答の形", () => {
  it("#237 AC-1: 未認証は 401 UNAUTHENTICATED", async () => {
    const res = await get(BASE, null);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("#237 AC-1: 200 で { items: [{ roomId, count }], nextCursor } を返し、項目は roomId と count だけ。応答は no-store", async () => {
    const roomId = await joinedChannel("形", alice);
    await insertMessagesAt(roomId, bob.userId, AFTER_JOIN_MS, 3);
    const res = await get(BASE);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
    const body = (await res.json()) as Page;
    expect(body).toEqual({ items: [{ roomId, count: 3 }], nextCursor: null });
    expect(Object.keys(body.items[0] ?? {}).sort()).toEqual([
      "count",
      "roomId",
    ]);
  });

  it("#237 AC-1: 未読がなければ空の items", async () => {
    await joinedChannel("未読なし", alice);
    expect(await (await get(BASE)).json()).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("#237 AC-1: /api/me のほかの API（プロフィール・通知の未読数）と重ならず、これまでどおり動く", async () => {
    const profile = await apiRequest("PATCH", "/api/me/profile", {
      token: alice.token,
      body: { displayName: "テスト改名" },
    });
    expect(profile.status).toBe(200);
    expect((await get("/api/me/notifications/unread-count")).status).toBe(200);
  });
});

describe("#237 AC-1（3-1 AC-1）件数と並び", () => {
  it("#237 AC-1: 99件は 99、100件と101件は 100（100で打ち切り）。並びは room_id の昇順", async () => {
    const ids = [
      "01JTESTXNRDAP1000000000003",
      "01JTESTXNRDAP1000000000001",
      "01JTESTXNRDAP1000000000002",
    ];
    const counts = [99, 100, 101];
    for (const [i, id] of ids.entries()) {
      await joinedChannel(`件数${i}`, alice, id);
      await insertMessagesAt(
        id,
        bob.userId,
        AFTER_JOIN_MS + i * 1000,
        counts[i] ?? 0,
      );
    }
    const body = (await (await get(`${BASE}?limit=100`)).json()) as Page;
    expect(body.items).toEqual([
      { roomId: "01JTESTXNRDAP1000000000001", count: 100 },
      { roomId: "01JTESTXNRDAP1000000000002", count: 100 },
      { roomId: "01JTESTXNRDAP1000000000003", count: 99 },
    ]);
  });

  it("#237 AC-1（C-169 (3)）: 自分の投稿は数えない", async () => {
    const roomId = await joinedChannel("自分の投稿", alice);
    await insertMessagesAt(roomId, alice.userId, AFTER_JOIN_MS, 4);
    await insertMessagesAt(roomId, bob.userId, AFTER_JOIN_MS + 1000, 1);
    expect(((await (await get(BASE)).json()) as Page).items).toEqual([
      { roomId, count: 1 },
    ]);
  });
});

describe("#237 AC-1（1-1 AC-2・C-94）未読の対象は、参加中のチャンネルと当事者の DM だけ", () => {
  it("#237 AC-1: 未参加の公開チャンネル（メッセージあり）・他人同士の DM・参加中でもアーカイブ済みのチャンネルは出ない", async () => {
    const publicUnjoined = await joinedChannel("未参加の公開", bob);
    const othersDm = await insertDm(bob.userId, carol.userId);
    const archived = await joinedChannel("アーカイブ済み", alice);
    await setArchived(archived, true);
    for (const roomId of [publicUnjoined, othersDm, archived])
      await insertMessagesAt(roomId, bob.userId, AFTER_JOIN_MS, 2);
    const ownDm = await insertDm(alice.userId, bob.userId);
    await insertMessagesAt(ownDm, bob.userId, AFTER_JOIN_MS, 2);
    expect(((await (await get(BASE)).json()) as Page).items).toEqual([
      { roomId: ownDm, count: 2 },
    ]);
  });

  it("#237 AC-1: 全体管理者・部署のオーナーでも、参加していない非公開・公開のチャンネルと他人の DM は出ない", async () => {
    await makeGlobalAdmin(alice.userId);
    await makeOwner(alice.userId, deptId);
    const privateUnjoined = await insertChannel({
      name: `${TEST_TAG}未読API管理者の非公開`,
      purpose: "normal",
      departmentId: deptId,
      visibility: "private",
    });
    await insertMember(privateUnjoined, bob.userId);
    const publicUnjoined = await joinedChannel("管理者の未参加の公開", bob);
    const othersDm = await insertDm(bob.userId, carol.userId);
    for (const roomId of [privateUnjoined, publicUnjoined, othersDm])
      await insertMessagesAt(roomId, bob.userId, AFTER_JOIN_MS, 2);
    expect(((await (await get(BASE)).json()) as Page).items).toEqual([]);
  });
});

describe("#237 AC-3（3-1 AC-3）閲覧権限を失った部屋は、未読の一覧から外れる", () => {
  it("#237 AC-3: 参加を外れると消え、アーカイブで消え、アーカイブを戻すと再び出る", async () => {
    const left = await joinedChannel("外れる", alice);
    const archived = await joinedChannel("アーカイブ", alice);
    for (const roomId of [left, archived])
      await insertMessagesAt(roomId, bob.userId, AFTER_JOIN_MS, 2);
    const roomIds = async () =>
      ((await (await get(`${BASE}?limit=100`)).json()) as Page).items
        .map((item) => item.roomId)
        .sort();
    expect(await roomIds()).toEqual([left, archived].sort());
    await removeMember(left, alice.userId);
    await setArchived(archived, true);
    expect(await roomIds()).toEqual([]);
    await setArchived(archived, false);
    expect(await roomIds()).toEqual([archived]);
  });
});

describe("#237 AC-1 ページ送り（limit・cursor）", () => {
  it("#237 AC-1: limit と cursor で続きを取り、全ページで欠け・重なりがない", async () => {
    const expected: Unread[] = [];
    for (let n = 1; n <= 5; n += 1) {
      const id = `01JTESTXNRDAP2${String(n).padStart(12, "0")}`;
      await joinedChannel(`頁${n}`, alice, id);
      if (n !== 3) {
        await insertMessagesAt(id, bob.userId, AFTER_JOIN_MS + n * 1000, n);
        expected.push({ roomId: id, count: n });
      }
    }
    for (const limit of [1, 2, 100])
      expect(await allItems(alice, limit), `limit=${limit}`).toEqual(expected);
  });

  it("#237 AC-1（改訂4-3）: 1ページ目の部屋に未読がなくても、空の items と nextCursor を返し、続きで未読の部屋が出る", async () => {
    await joinedChannel("頁の未読なし", alice, "01JTESTXNRDAP3000000000001");
    const unread = await joinedChannel(
      "頁の未読あり",
      alice,
      "01JTESTXNRDAP3000000000002",
    );
    await insertMessagesAt(unread, bob.userId, AFTER_JOIN_MS, 1);
    const first = (await (await get(`${BASE}?limit=1`)).json()) as Page;
    expect(first.items).toEqual([]);
    expect(first.nextCursor).not.toBeNull();
    const second = (await (
      await get(`${BASE}?limit=1&cursor=${first.nextCursor}`)
    ).json()) as Page;
    expect(second).toEqual({
      items: [{ roomId: unread, count: 1 }],
      nextCursor: null,
    });
  });

  it.each([
    ["0", 422],
    ["1", 200],
    ["100", 200],
    ["101", 422],
    ["-1", 422],
    ["1.5", 422],
    ["abc", 422],
  ])("#237 AC-1: limit=%s は %i", async (limit, status) => {
    const res = await get(`${BASE}?limit=${limit}`);
    expect(res.status).toBe(status);
    if (status === 422)
      expect(await res.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it.each([
    ["壊れたカーソル", "cursor=!!!"],
    ["JSON でないカーソル", "cursor=bm90LWpzb24"],
    [
      "攻撃的な文字列のカーソル",
      `cursor=${encodeURIComponent("' OR 1=1 --;")}`,
    ],
    ["余分なクエリ", "roomId=01JTESTXNRDAP0000000000001"],
    ["余分なクエリ（利用者の指定）", "userId=01JTESTXNRDAP0000000000001"],
  ])(
    "#237 AC-1: %s は 422 VALIDATION_ERROR（500 にならない）",
    async (_label, query) => {
      const res = await get(`${BASE}?${query}`);
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    },
  );
});

describe("#237 AC-1 GET で状態を変えない", () => {
  it("#237 AC-1: 未読の一覧を取っても、既読位置の行は作られず、変わらない", async () => {
    const roomId = await joinedChannel("GET", alice);
    await insertMessagesAt(roomId, bob.userId, AFTER_JOIN_MS, 3);
    const before = await readPositionRows();
    for (let i = 0; i < 3; i += 1) expect((await get(BASE)).status).toBe(200);
    expect(await readPositionRows()).toEqual(before);
    expect(((await (await get(BASE)).json()) as Page).items).toEqual([
      { roomId, count: 3 },
    ]);
  });

  it("#237 AC-1: 未読の一覧を取っても、その利用者を操作者とする監査ログは増えない", async () => {
    await get(BASE);
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE actor_id = ?",
    )
      .bind(alice.userId)
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});
