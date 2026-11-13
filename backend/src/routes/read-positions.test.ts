// #237 AC-2（3-1 AC-2）：既読の API（PUT /api/rooms/:roomId/read-position。EP-3-02）を、実際のアプリ入口と隔離 D1 で確かめる。
// 契約（実装者へ。計画「1. 表・索引・既読にする操作」）：
//  - PUT /api/rooms/:roomId/read-position 本文 { lastReadMessageId: ULID } → 204（本文なし）。既読位置を後戻りさせない（古い ID も 204 で位置は変わらない）
//  - 形（422 VALIDATION_ERROR。Controller）：roomId が ULID でない、本文が { lastReadMessageId: ULID } だけでない（空・ULID でない・余分な項目・欠落）
//  - 未参加の公開チャンネル：403 FORBIDDEN（読めるが未読の対象ではない）
//  - 見えないチャンネル（非公開で未参加・アーカイブ済み）・他人の DM・存在しない部屋・別の部屋のメッセージ・存在しないメッセージ：404 NOT_FOUND（全体管理者も同じ）
//  - 未認証 401。許可外の Origin・Origin なしは 403 FORBIDDEN_ORIGIN で何も変わらない。応答は no-store
//  - 既読は本人の閲覧の記録で、監査ログに残さない（既定の方針 4）
// データは架空（testuser_rpapi_・@example.com・[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest, insertReadyUser } from "../../test/api-request";
import {
  DEPT_NOW,
  insertChannel,
  insertMember,
  makeGlobalAdmin,
} from "../../test/department-fixtures";
import { cleanupDmScenario, insertDm } from "../../test/dm-fixtures";
import {
  insertMessagesAt,
  readPositionOf,
  readPositionRows,
  setArchived,
  ulidAtMs,
} from "../../test/read-position-fixtures";
import { TEST_TAG, insertDepartment, testId } from "../../test/role-fixtures";

type User = { userId: string; token: string };
type Page = {
  items: { roomId: string; count: number }[];
  nextCursor: string | null;
};

const BAD_ORIGIN = "https://origin.invalid";
const AFTER_JOIN_MS = Date.parse(DEPT_NOW) + 60_000;

let deptId: string;
let alice: User;
let bob: User;
let carol: User;

const pathOf = (roomId: string) => `/api/rooms/${roomId}/read-position`;

const put = (
  roomId: string,
  body: unknown,
  user: User | null = alice,
  options: { origin?: string } = {},
) =>
  apiRequest("PUT", pathOf(roomId), {
    token: user?.token ?? null,
    body,
    ...options,
  });

const markRead = (
  roomId: string,
  lastReadMessageId: string,
  user: User = alice,
) => put(roomId, { lastReadMessageId }, user);

async function unreadOf(user: User) {
  const res = await apiRequest("GET", "/api/me/unread?limit=100", {
    token: user.token,
  });
  expect(res.status).toBe(200);
  const page = (await res.json()) as Page;
  return new Map(page.items.map((item) => [item.roomId, item.count]));
}

async function channel(
  label: string,
  options: { visibility?: "public" | "private"; members?: User[] } = {},
) {
  const roomId = await insertChannel({
    name: `${TEST_TAG}既読API${label}`,
    purpose: "normal",
    departmentId: deptId,
    visibility: options.visibility ?? "public",
  });
  for (const member of options.members ?? [alice])
    await insertMember(roomId, member.userId);
  return roomId;
}

async function codeOf(res: Response) {
  return ((await res.json()) as { code?: string }).code;
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  deptId = await insertDepartment("既読API");
  alice = await insertReadyUser("testuser_rpapi_alice", deptId);
  bob = await insertReadyUser("testuser_rpapi_bob", deptId);
  carol = await insertReadyUser("testuser_rpapi_carol", deptId);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupDmScenario();
});

describe("#237 AC-2（3-1 AC-2）開くと既読になり、未読の一覧が更新される", () => {
  it("#237 AC-2: 204（本文なし・no-store）で既読になり、その後の GET /api/me/unread から消える", async () => {
    const roomId = await channel("既読");
    const ids = await insertMessagesAt(roomId, bob.userId, AFTER_JOIN_MS, 3);
    expect((await unreadOf(alice)).get(roomId)).toBe(3);
    const res = await markRead(roomId, ids[2] ?? "");
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
    expect(await readPositionOf(alice.userId, roomId)).toBe(ids[2]);
    expect((await unreadOf(alice)).has(roomId)).toBe(false);
  });

  it("#237 AC-2: 既読の後の新着だけが数えられる", async () => {
    const roomId = await channel("既読の後の新着");
    const ids = await insertMessagesAt(roomId, bob.userId, AFTER_JOIN_MS, 5);
    await markRead(roomId, ids[4] ?? "");
    await insertMessagesAt(roomId, bob.userId, AFTER_JOIN_MS + 10_000, 2);
    expect((await unreadOf(alice)).get(roomId)).toBe(2);
  });

  it("#237 AC-2: 途中までの既読では、その後ろだけが残る", async () => {
    const roomId = await channel("途中まで");
    const ids = await insertMessagesAt(roomId, bob.userId, AFTER_JOIN_MS, 5);
    expect((await markRead(roomId, ids[1] ?? "")).status).toBe(204);
    expect((await unreadOf(alice)).get(roomId)).toBe(3);
  });

  it("#237 AC-2: 古い ID は 204 で、既読位置は戻らない（ほかのタブの古い送信）", async () => {
    const roomId = await channel("後戻りなし");
    const ids = await insertMessagesAt(roomId, bob.userId, AFTER_JOIN_MS, 3);
    await markRead(roomId, ids[2] ?? "");
    const res = await markRead(roomId, ids[0] ?? "");
    expect(res.status).toBe(204);
    expect(await readPositionOf(alice.userId, roomId)).toBe(ids[2]);
    expect((await unreadOf(alice)).has(roomId)).toBe(false);
  });

  it("#237 AC-2: 同じ ID を2回送っても 204", async () => {
    const roomId = await channel("同じID");
    const [id] = await insertMessagesAt(roomId, bob.userId, AFTER_JOIN_MS, 1);
    expect((await markRead(roomId, id ?? "")).status).toBe(204);
    expect((await markRead(roomId, id ?? "")).status).toBe(204);
  });

  it("#237 AC-2: 当事者の DM も既読にでき、ほかの当事者の未読は変わらない", async () => {
    const dm = await insertDm(alice.userId, bob.userId);
    await insertMessagesAt(dm, bob.userId, AFTER_JOIN_MS, 2);
    const aliceIds = await insertMessagesAt(
      dm,
      alice.userId,
      AFTER_JOIN_MS + 1000,
      1,
    );
    const last = aliceIds[0] ?? "";
    expect((await markRead(dm, last)).status).toBe(204);
    expect((await unreadOf(alice)).has(dm)).toBe(false);
    expect((await unreadOf(bob)).get(dm)).toBe(1);
  });

  it("#237 AC-2: 自分の投稿の ID まで既読にすると、それより前の他人の投稿も既読になる", async () => {
    const roomId = await channel("自分の投稿まで");
    await insertMessagesAt(roomId, bob.userId, AFTER_JOIN_MS, 3);
    const [own] = await insertMessagesAt(
      roomId,
      alice.userId,
      AFTER_JOIN_MS + 1000,
      1,
    );
    expect((await markRead(roomId, own ?? "")).status).toBe(204);
    expect((await unreadOf(alice)).has(roomId)).toBe(false);
  });
});

describe("#237 AC-2 既読にできない部屋（認可。1-1 AC-2・C-94）", () => {
  it("#237 AC-2: 未参加の公開チャンネルは 403 FORBIDDEN で、行を作らない", async () => {
    const roomId = await channel("未参加の公開", { members: [bob] });
    const [id] = await insertMessagesAt(roomId, bob.userId, AFTER_JOIN_MS, 1);
    const res = await markRead(roomId, id ?? "");
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("FORBIDDEN");
    expect(await readPositionRows()).toEqual([]);
  });

  it("#237 AC-2: 非公開で未参加・アーカイブ済み（参加中でも）・他人の DM・存在しない部屋は 404 NOT_FOUND で、行を作らない", async () => {
    const privateUnjoined = await channel("非公開の未参加", {
      visibility: "private",
      members: [bob],
    });
    const archived = await channel("アーカイブ");
    const othersDm = await insertDm(bob.userId, carol.userId);
    const targets: [string, string][] = [];
    for (const roomId of [privateUnjoined, archived, othersDm]) {
      const [id] = await insertMessagesAt(roomId, bob.userId, AFTER_JOIN_MS, 1);
      targets.push([roomId, id ?? ""]);
    }
    await setArchived(archived, true);
    targets.push([testId("NOROOM"), ulidAtMs(AFTER_JOIN_MS)]);
    for (const [roomId, id] of targets) {
      const res = await markRead(roomId, id);
      expect(res.status, roomId).toBe(404);
      expect(await codeOf(res)).toBe("NOT_FOUND");
    }
    expect(await readPositionRows()).toEqual([]);
  });

  it("#237 AC-2: 全体管理者でも、非公開で未参加のチャンネルと他人の DM は 404（存在を区別しない）", async () => {
    await makeGlobalAdmin(alice.userId);
    const privateUnjoined = await channel("管理者の非公開", {
      visibility: "private",
      members: [bob],
    });
    const othersDm = await insertDm(bob.userId, carol.userId);
    for (const roomId of [privateUnjoined, othersDm]) {
      const [id] = await insertMessagesAt(roomId, bob.userId, AFTER_JOIN_MS, 1);
      expect((await markRead(roomId, id ?? "")).status, roomId).toBe(404);
    }
    expect(await readPositionRows()).toEqual([]);
  });

  it("#237 AC-2: 別の部屋のメッセージ・存在しないメッセージ（ULID の形）は 404 NOT_FOUND で、位置は変わらない", async () => {
    const roomId = await channel("別の部屋のメッセージ");
    const elsewhere = await channel("別の部屋");
    const [foreign] = await insertMessagesAt(
      elsewhere,
      bob.userId,
      AFTER_JOIN_MS,
      1,
    );
    const [own] = await insertMessagesAt(
      roomId,
      bob.userId,
      AFTER_JOIN_MS + 1000,
      1,
    );
    await markRead(roomId, own ?? "");
    for (const id of [foreign ?? "", ulidAtMs(AFTER_JOIN_MS + 99_000)]) {
      const res = await markRead(roomId, id);
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("NOT_FOUND");
    }
    expect(await readPositionOf(alice.userId, roomId)).toBe(own);
  });
});

describe("#237 AC-2 入力の形（422。500 にならない）", () => {
  const ATTACKS = [
    "' OR 1=1 --",
    "1; DROP TABLE read_positions",
    '"--',
    "OR 1=1",
  ];

  it.each([
    ["ULID でない", "not-a-ulid"],
    ["小文字の ULID", "01jtestxnrdap0000000000001"],
    ["25文字", "01JTESTXNRDAP000000000001"],
    ...ATTACKS.map((text): [string, string] => [
      `攻撃的な文字列（${text}）`,
      text,
    ]),
  ])("#237 AC-2: roomId が %s なら 422", async (_label, roomId) => {
    const res = await put(encodeURIComponent(roomId), {
      lastReadMessageId: ulidAtMs(AFTER_JOIN_MS),
    });
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe("VALIDATION_ERROR");
  });

  it.each<[string, unknown]>([
    ["本文が空のオブジェクト", {}],
    ["lastReadMessageId が空文字", { lastReadMessageId: "" }],
    ["lastReadMessageId が ULID でない", { lastReadMessageId: "not-a-ulid" }],
    ["lastReadMessageId が数値", { lastReadMessageId: 1 }],
    ["lastReadMessageId が null", { lastReadMessageId: null }],
    [
      "余分な項目（利用者の指定）",
      {
        lastReadMessageId: "01JTESTXNRDAP0000000000001",
        userId: "01JTESTXNRDAP0000000000002",
      },
    ],
    ["配列", ["01JTESTXNRDAP0000000000001"]],
    ...ATTACKS.map((text): [string, unknown] => [
      `攻撃的な文字列（${text}）`,
      { lastReadMessageId: text },
    ]),
  ])("#237 AC-2: 本文が %s なら 422 で、行を作らない", async (_label, body) => {
    const roomId = await channel("形");
    await insertMessagesAt(roomId, bob.userId, AFTER_JOIN_MS, 1);
    const res = await put(roomId, body);
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe("VALIDATION_ERROR");
    expect(await readPositionRows()).toEqual([]);
  });
});

describe("#237 AC-2 認証・送信元（CSRF）・監査", () => {
  it("#237 AC-2: 未認証は 401 UNAUTHENTICATED", async () => {
    const roomId = await channel("未認証");
    const [id] = await insertMessagesAt(roomId, bob.userId, AFTER_JOIN_MS, 1);
    const res = await put(roomId, { lastReadMessageId: id }, null);
    expect(res.status).toBe(401);
    expect(await codeOf(res)).toBe("UNAUTHENTICATED");
  });

  it.each([
    ["許可外の Origin", BAD_ORIGIN],
    ["Origin なし", ""],
  ])(
    "#237 AC-2: %s は 403 FORBIDDEN_ORIGIN で、何も変わらない",
    async (_label, origin) => {
      const roomId = await channel(`送信元${origin.length}`);
      const [id] = await insertMessagesAt(roomId, bob.userId, AFTER_JOIN_MS, 1);
      const res = await put(roomId, { lastReadMessageId: id }, alice, {
        origin,
      });
      expect(res.status).toBe(403);
      expect(await codeOf(res)).toBe("FORBIDDEN_ORIGIN");
      expect(await readPositionRows()).toEqual([]);
    },
  );

  it("#237 AC-2（既定の方針 4）: 既読にしても、その利用者を操作者とする監査ログは増えない", async () => {
    const roomId = await channel("監査");
    const [id] = await insertMessagesAt(roomId, bob.userId, AFTER_JOIN_MS, 1);
    await markRead(roomId, id ?? "");
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE actor_id = ?",
    )
      .bind(alice.userId)
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});
