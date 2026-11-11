// #124 AC-1（3-4 AC-3・R-57・3-4 AC-5）・AC-2：通知の API（/api/me/notifications）を、実際のアプリ入口と隔離 D1 で確かめる。
// 時刻は vi.useFakeTimers（Date だけ）で NOTIFICATION_NOW に固定する。通知の種類は本 Issue では 0 件のため、行は任意の文字列の種類で直接入れる。
// 契約（実装者へ。計画「HTTP API」）：
//  - GET  /api/me/notifications?cursor&limit → 200 { items: [{ id, kind, roomId, messageId, targetId, createdAt, readAt }], nextCursor }
//      created_at 降順・id 降順。limit 既定 20（PAGE_LIMIT.default）、1〜100。範囲外・壊れた cursor は 422 VALIDATION_ERROR（fields に limit / cursor）。Cache-Control: no-store
//  - GET  /api/me/notifications/unread-count → 200 { count }（100 で打ち切り）。no-store
//  - POST /api/me/notifications/:notificationId/read → 204（本文なし）。既読済みも 204 で read_at は最初の時刻のまま。
//      不存在・他人宛て・ULID でない ID は 404 NOT_FOUND（存在を漏らさない）で、何も変えない
//  - POST /api/me/notifications/read-all → 204。本人の未読だけを既読にする
//  - 共通：未認証 401 UNAUTHENTICATED、許可外の Origin の POST は 403 FORBIDDEN_ORIGIN（何も変わらない）
//  - 作成・既読の監査ログは残さない（既定の方針 4）。/api/me（プロフィール等）と重ならない。docs/api/openapi.json に 4 操作が書かれている
// データは架空（testuser_notif_・@example.com・[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import spec from "../../../docs/api/openapi.json";
import { apiRequest, insertReadyUser } from "../../test/api-request";
import {
  NOTIFICATION_NOW,
  cleanupNotificationScenario,
  insertNotification,
  insertNotifications,
  notificationIdAt,
  notificationRow,
} from "../../test/notification-fixtures";
import {
  cleanupRoleTestData,
  insertDepartment,
  testId,
} from "../../test/role-fixtures";

type Item = {
  id: string;
  kind: string;
  roomId: string | null;
  messageId: string | null;
  targetId: string | null;
  createdAt: string;
  readAt: string | null;
};
type Page = { items: Item[]; nextCursor: string | null };
type User = { userId: string; token: string };

const BAD_ORIGIN = "https://origin.invalid";
const BASE = "/api/me/notifications";

let alice: User;
let bob: User;

const get = (path: string, user: User | null = alice) =>
  apiRequest("GET", path, { token: user?.token ?? null });
const post = (
  path: string,
  user: User | null = alice,
  options: { origin?: string } = {},
) => apiRequest("POST", path, { token: user?.token ?? null, ...options });

async function allIds(user: User, limit = 100): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 20; i += 1) {
    const query: string =
      cursor === null ? `limit=${limit}` : `limit=${limit}&cursor=${cursor}`;
    const res = await get(`${BASE}?${query}`, user);
    expect(res.status).toBe(200);
    const page = (await res.json()) as Page;
    ids.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
    if (cursor === null) return ids;
  }
  throw new Error("一覧のページが終わりませんでした");
}

const unreadCount = async (user: User) =>
  (
    (await (await get(`${BASE}/unread-count`, user)).json()) as {
      count: number;
    }
  ).count;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOTIFICATION_NOW));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const deptId = await insertDepartment("通知API営業");
  alice = await insertReadyUser("testuser_notif_alice", deptId);
  bob = await insertReadyUser("testuser_notif_bob", deptId);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupNotificationScenario(cleanupRoleTestData);
});

describe("#124 AC-1 共通：認証と Origin", () => {
  it.each([
    ["GET", BASE],
    ["GET", `${BASE}/unread-count`],
    ["POST", `${BASE}/${testId("NOTIF")}/read`],
    ["POST", `${BASE}/read-all`],
  ])(
    "#124 AC-1: 未認証の %s %s は 401 UNAUTHENTICATED",
    async (method, path) => {
      const res = await apiRequest(method, path, { token: null });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    },
  );

  it("#124 AC-1: 許可外の Origin の既読は 403 FORBIDDEN_ORIGIN で、何も変わらない", async () => {
    const [id] = await insertNotifications(alice.userId, 1);
    const res = await post(`${BASE}/${id}/read`, alice, { origin: BAD_ORIGIN });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
    expect((await notificationRow(id ?? ""))?.read_at).toBeNull();
  });

  it("#124 AC-1: 許可外の Origin の read-all は 403 FORBIDDEN_ORIGIN で、何も変わらない", async () => {
    const ids = await insertNotifications(alice.userId, 2);
    const res = await post(`${BASE}/read-all`, alice, { origin: BAD_ORIGIN });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
    for (const id of ids)
      expect((await notificationRow(id))?.read_at).toBeNull();
  });

  it("#124 AC-1: /api/me のほかの API（プロフィールの変更）と重ならず、これまでどおり動く", async () => {
    const res = await apiRequest("PATCH", "/api/me/profile", {
      token: alice.token,
      body: { displayName: "テスト改名" },
    });
    expect(res.status).toBe(200);
  });
});

describe("#124 AC-1（3-4 AC-3・R-57）一覧：本人宛てだけが、新しい順に出る", () => {
  it("#124 AC-1（R-57）: 他人宛ての通知は一覧に出ない。自分宛てが新しい順に並ぶ", async () => {
    const aliceIds = await insertNotifications(alice.userId, 3);
    await insertNotifications(bob.userId, 4);
    const res = await get(BASE);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const page = (await res.json()) as Page;
    expect(page.items.map((item) => item.id)).toEqual([...aliceIds].reverse());
    expect(page.nextCursor).toBeNull();
  });

  it("#124 AC-1（R-57）: 自分宛てが 0 件なら、他人宛てがあっても空の配列と nextCursor が null", async () => {
    await insertNotifications(bob.userId, 1);
    expect(await (await get(BASE)).json()).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("#124 AC-1: 項目は決めた 7 項目だけで、宛先の利用者 ID・本名・メールを返さない", async () => {
    await insertNotification({
      userId: alice.userId,
      kind: "test_kind",
      roomId: "01JTESTNOTIFROOM0000000001",
      messageId: "01JTESTNOTIFMESSAGE00000001",
      targetId: "01JTESTNOTIFTARGET00000001",
    });
    const text = JSON.stringify(await (await get(BASE)).json());
    const page = JSON.parse(text) as Page;
    expect(Object.keys(page.items[0] ?? {}).sort()).toEqual(
      [
        "createdAt",
        "id",
        "kind",
        "messageId",
        "readAt",
        "roomId",
        "targetId",
      ].sort(),
    );
    expect(page.items[0]).toMatchObject({
      kind: "test_kind",
      roomId: "01JTESTNOTIFROOM0000000001",
      messageId: "01JTESTNOTIFMESSAGE00000001",
      targetId: "01JTESTNOTIFTARGET00000001",
      readAt: null,
    });
    expect(text).not.toContain(alice.userId);
    expect(text).not.toContain("@example.com");
    expect(text).not.toContain("テスト太郎");
  });

  it("#124 AC-1: limit の既定は 20 件。21 件あれば nextCursor が付く", async () => {
    await insertNotifications(alice.userId, 21);
    const page = (await (await get(BASE)).json()) as Page;
    expect(page.items).toHaveLength(20);
    expect(page.nextCursor).not.toBeNull();
  });

  it.each([
    [1, 1],
    [100, 100],
  ])("#124 AC-1: limit=%i は可（%i 件まで返す）", async (limit, expected) => {
    await insertNotifications(alice.userId, 101);
    const res = await get(`${BASE}?limit=${limit}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Page).items).toHaveLength(expected);
  });

  it.each([["0"], ["101"], ["-1"], ["abc"], ["1.5"]])(
    "#124 AC-1: limit=%s は 422 VALIDATION_ERROR（fields は limit）",
    async (limit) => {
      const res = await get(`${BASE}?limit=${limit}`);
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        code: "VALIDATION_ERROR",
        fields: ["limit"],
      });
    },
  );

  it.each([["!!"], ["abc"], ["e30"]])(
    "#124 AC-1: 壊れた cursor（%s）は 422 VALIDATION_ERROR（fields は cursor）",
    async (cursor) => {
      const res = await get(`${BASE}?cursor=${cursor}`);
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        code: "VALIDATION_ERROR",
        fields: ["cursor"],
      });
    },
  );

  it("#124 AC-1: nextCursor でたどると、重複も欠落もなく新しい順に全件取れる（同じ作成日時の行が続いても）", async () => {
    const sameTime = "2026-11-05T00:00:00.000Z";
    const sameIds = Array.from({ length: 6 }, (_v, i) =>
      notificationIdAt(1_800_000_000_000 + i),
    );
    for (const id of sameIds)
      await insertNotification({
        userId: alice.userId,
        id,
        createdAt: sameTime,
      });
    const older = await insertNotification({
      userId: alice.userId,
      id: notificationIdAt(1_700_000_000_000),
      createdAt: "2026-11-01T00:00:00.000Z",
    });
    const newer = await insertNotification({
      userId: alice.userId,
      id: notificationIdAt(1_900_000_000_000),
      createdAt: "2026-11-09T00:00:00.000Z",
    });
    const seen = await allIds(alice, 2);
    expect(seen).toEqual([newer, ...[...sameIds].reverse(), older]);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("#124 AC-1: 本人の通知を取る手段に、他人の ID を指定するクエリはない（user などを付けても本人の分だけ）", async () => {
    await insertNotifications(alice.userId, 1);
    await insertNotifications(bob.userId, 2);
    for (const query of [
      `userId=${bob.userId}`,
      `user_id=${bob.userId}`,
      `recipientId=${bob.userId}`,
    ]) {
      const res = await get(`${BASE}?${query}`);
      expect(res.status === 200 || res.status === 422).toBe(true);
      if (res.status === 200)
        expect(((await res.json()) as Page).items).toHaveLength(1);
    }
  });
});

describe("#124 AC-1 未読数", () => {
  it("#124 AC-1: 本人の未読だけを数える。既読と他人宛ては数えない。no-store", async () => {
    await insertNotifications(alice.userId, 5, { readCount: 2 });
    await insertNotifications(bob.userId, 7);
    const res = await get(`${BASE}/unread-count`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ count: 3 });
    expect(await unreadCount(bob)).toBe(7);
  });

  it("#124 AC-1: 通知がなければ 0", async () => {
    expect(await (await get(`${BASE}/unread-count`)).json()).toEqual({
      count: 0,
    });
  });

  it("#124 AC-1: 100 件を超えても 100 で打ち切る。既読にすると減る（100 以下になるまで）", async () => {
    const ids = await insertNotifications(alice.userId, 105);
    expect(await unreadCount(alice)).toBe(100);
    const first = ids[0] ?? "";
    expect((await post(`${BASE}/${first}/read`)).status).toBe(204);
    expect(await unreadCount(alice)).toBe(100);
    for (const id of ids.slice(1, 7))
      expect((await post(`${BASE}/${id}/read`)).status).toBe(204);
    expect(await unreadCount(alice)).toBe(98);
  });
});

describe("#124 AC-1（R-57・3-4 AC-5）1 件を既読にする", () => {
  it("#124 AC-1: 本人の未読は 204（本文なし）で既読になり、固定した時刻が read_at に入る。未読数が 1 減る", async () => {
    const [id] = await insertNotifications(alice.userId, 2);
    const res = await post(`${BASE}/${id}/read`);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect((await notificationRow(id ?? ""))?.read_at).toBe(NOTIFICATION_NOW);
    expect(await unreadCount(alice)).toBe(1);
  });

  it("#124 AC-1: 既読にしても行は消えず、一覧に readAt つきで残る（3-4 AC-5：通知は消さない）", async () => {
    const [id] = await insertNotifications(alice.userId, 1);
    await post(`${BASE}/${id}/read`);
    const page = (await (await get(BASE)).json()) as Page;
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id,
      readAt: NOTIFICATION_NOW,
    });
  });

  it("#124 AC-1: 既読済みへの既読も 204 で、read_at は最初の時刻のまま", async () => {
    const [id] = await insertNotifications(alice.userId, 1);
    await post(`${BASE}/${id}/read`);
    vi.setSystemTime(new Date("2026-11-11T00:10:00.000Z"));
    const again = await post(`${BASE}/${id}/read`);
    expect(again.status).toBe(204);
    expect((await notificationRow(id ?? ""))?.read_at).toBe(NOTIFICATION_NOW);
  });

  it("#124 AC-1（R-57）: 他人宛ての通知の ID は 404 NOT_FOUND で、相手の read_at は変わらない（存在を漏らさない）", async () => {
    const [bobId] = await insertNotifications(bob.userId, 1);
    const res = await post(`${BASE}/${bobId}/read`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
    expect((await notificationRow(bobId ?? ""))?.read_at).toBeNull();
    expect(await unreadCount(bob)).toBe(1);
  });

  it("#124 AC-1（R-57）: 他人宛てと存在しない ID の応答は同じ（ステータスと code）", async () => {
    const [bobId] = await insertNotifications(bob.userId, 1);
    const other = await post(`${BASE}/${bobId}/read`);
    const missing = await post(`${BASE}/${testId("NOTIF")}/read`);
    expect(other.status).toBe(missing.status);
    expect(((await other.json()) as { code: string }).code).toBe(
      ((await missing.json()) as { code: string }).code,
    );
  });

  it.each([["not-a-ulid"], ["123"], ["01JTESTNOTIF"], ["%20"]])(
    "#124 AC-1: ULID でない ID（%s）は 404 NOT_FOUND",
    async (id) => {
      const res = await post(`${BASE}/${id}/read`);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
    },
  );
});

describe("#124 AC-1（R-57）すべて既読にする", () => {
  it("#124 AC-1: 本人の未読がすべて既読になり 204。既読の時刻は変えず、行は消えない", async () => {
    const ids = await insertNotifications(alice.userId, 4, { readCount: 1 });
    const res = await post(`${BASE}/read-all`);
    expect(res.status).toBe(204);
    expect(await unreadCount(alice)).toBe(0);
    expect(await allIds(alice)).toHaveLength(4);
    expect((await notificationRow(ids[0] ?? ""))?.read_at).toBe(
      "2026-11-02T00:00:00.000Z",
    );
    expect((await notificationRow(ids[1] ?? ""))?.read_at).toBe(
      NOTIFICATION_NOW,
    );
  });

  it("#124 AC-1（R-57）: 他人宛ての未読は既読にならない", async () => {
    await insertNotifications(alice.userId, 2);
    const bobIds = await insertNotifications(bob.userId, 3);
    await post(`${BASE}/read-all`);
    expect(await unreadCount(bob)).toBe(3);
    for (const id of bobIds)
      expect((await notificationRow(id))?.read_at).toBeNull();
  });

  it("#124 AC-1: 未読がなくても 204（エラーにしない）", async () => {
    expect((await post(`${BASE}/read-all`)).status).toBe(204);
  });
});

describe("#124 AC-1 監査ログ（既定の方針 4：作成・既読は残さない）", () => {
  it("#124 AC-1: 既読にしても、その利用者を操作者とする監査ログは増えない", async () => {
    const [id] = await insertNotifications(alice.userId, 2);
    await post(`${BASE}/${id}/read`);
    await post(`${BASE}/read-all`);
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE actor_id = ?",
    )
      .bind(alice.userId)
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});

describe("#124 AC-1 API 仕様書（docs/api/openapi.json）", () => {
  it("#124 AC-1: 通知の 4 操作と応答コードが書かれている", () => {
    const expected: Record<string, string[]> = {
      "/api/me/notifications": ["get:200,401,422"],
      "/api/me/notifications/unread-count": ["get:200,401"],
      "/api/me/notifications/{notificationId}/read": ["post:204,401,403,404"],
      "/api/me/notifications/read-all": ["post:204,401,403"],
    };
    const paths = spec.paths as unknown as Record<
      string,
      Record<string, { responses: Record<string, unknown> }>
    >;
    for (const [path, entries] of Object.entries(expected)) {
      for (const entry of entries) {
        const [method, codes] = entry.split(":");
        const operation = paths[path]?.[method ?? ""];
        expect(operation, `${method} ${path}`).toBeDefined();
        for (const code of (codes ?? "").split(","))
          expect(
            Object.keys(operation?.responses ?? {}),
            `${method} ${path}`,
          ).toContain(code);
      }
    }
  });
});
