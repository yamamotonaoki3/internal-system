// #136 AC-1（1-2 AC-1・AC-2・AC-4・AC-5・AC-6）・AC-2（6-1 AC-1）・AC-3（C-168(4)・(5)・(7)）:
// DM の開始（EP-1-05 POST /api/dms）・一覧（EP-1-06 GET /api/dms）・詳細（GET /api/dms/:roomId）を、実際のアプリ入口（index.ts の app）と隔離 D1 で確かめる。
// 公開形の仮定（契約。計画 3章・改訂2 指摘6・指摘10、レビュー2回目(3)）：
//  - POST /api/dms 本文 { partnerUserId }（strict）→ 200 { roomId, partner: { id, displayName } }（新規・既存とも 200）
//    判定の順：形の誤り 422 → perm.dm.message.send → 自分宛て 422（fields に partnerUserId）→ 相手なし 404 → 相手が無効 422 → 既存を返す／作る
//  - GET /api/dms?limit&cursor（strict。limit 既定20・1〜100）→ 200 { items: [{ roomId, partner: { id, displayName, isActive, status: { kind, returnAt } | null }, lastMessageAt }], nextCursor }
//    自分が当事者の DM だけを、最終活動（最後のメッセージ、なければ部屋の作成）の新しい順。相手が無効なら status は null
//  - GET /api/dms/:roomId → 200 { roomId, partner: { id, displayName, department, isActive, status: { kind, returnAt, message } | null }, canPost }
//    判定の順：ULID の形でなければ 422（fields に roomId）→ 当事者でなければ 404（存在しない・チャンネルの部屋と区別しない）→ perm.dm.message.view
// 方針：振る舞い（ステータス・code・行の有無・順序・件数）で確かめる。エラーの文言は見ない（404 は「存在しない部屋」と同じ本文であることで、区別がつかないことを確かめる）。
// 403（権限の拒否）は固定ロールがすべて DM の権限を持つため API では起こせない。Service の単体（services/dm.service.test.ts）で偽の authorizer を使って確かめる。
// データは架空（testuser_dm_、[UNIT_TEST]、@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupDmScenario,
  deactivateUser,
  dmApi,
  dmCounts,
  dmMembersOf,
  dmRoomIdOf,
  insertDm,
  insertDmAt,
  insertDmUser,
  roomKindOf,
  type DmUser,
} from "../../test/dm-fixtures";
import {
  insertDepartmentWithChannels,
  insertMember,
  makeGlobalAdmin,
  makeOwner,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { insertMessage, ulidAt } from "../../test/message-fixtures";
import { newProfileContext, profileRequest } from "../../test/profile-fixtures";
import { insertUser, testId } from "../../test/role-fixtures";
import { isUlid } from "../lib/ulid";

type Partner = { id: string; displayName: string };
type StartResult = { roomId: string; partner: Partner };
type ListItem = {
  roomId: string;
  partner: {
    id: string;
    displayName: string;
    isActive: boolean;
    status: { kind: string; returnAt: string | null } | null;
  };
  lastMessageAt: string | null;
};
type ListPage = { items: ListItem[]; nextCursor: string | null };
type Detail = {
  roomId: string;
  partner: {
    id: string;
    displayName: string;
    department: { id: string; name: string } | null;
    isActive: boolean;
    status: {
      kind: string;
      returnAt: string | null;
      message: string | null;
    } | null;
  };
  canPost: boolean;
};

// 形式は正しい（ULID）が、存在しない利用者・部屋のID
const MISSING_ID = "01JTESTDM0N0NE000000000000";

let deptA: SeededDepartment;
let deptB: SeededDepartment;
let alice: DmUser;
let bob: DmUser;
let carol: DmUser;
let stranger: DmUser;
let ownerB: DmUser;
let admin: DmUser;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  deptA = await insertDepartmentWithChannels("DM営業");
  deptB = await insertDepartmentWithChannels("DM開発");
  alice = await insertDmUser("testuser_dm_alice", deptA.id, "テストDMアリス");
  bob = await insertDmUser("testuser_dm_bob", deptB.id, "テストDMボブ");
  carol = await insertDmUser("testuser_dm_carol", deptA.id, "テストDMキャロル");
  stranger = await insertDmUser(
    "testuser_dm_stranger",
    deptA.id,
    "テストDM第三者",
  );
  ownerB = await insertDmUser(
    "testuser_dm_owner_b",
    deptB.id,
    "テストDM他部署長",
  );
  admin = await insertDmUser("testuser_dm_admin", deptA.id, "テストDM管理者");
  await makeOwner(ownerB.userId, deptB.id);
  await makeGlobalAdmin(admin.userId);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupDmScenario();
});

async function startOk(partnerUserId: string, token: string) {
  const response = await dmApi.start({ partnerUserId }, token);
  expect(response.status).toBe(200);
  return (await response.json()) as StartResult;
}

async function listOk(token: string, query = "") {
  const response = await dmApi.list(query, token);
  expect(response.status).toBe(200);
  return (await response.json()) as ListPage;
}

/** 存在しない部屋の 404 の本文（DM の詳細で「区別がつかない」ことの比較に使う） */
async function missingDetailBody(token: string) {
  const response = await dmApi.detail(MISSING_ID, token);
  expect(response.status).toBe(404);
  return response.json();
}

describe("#136 AC-1（1-2 AC-1・AC-4）・C-168(5) DM の開始（POST /api/dms）", () => {
  it("#136 AC-1・C-168(5): 新しい相手とは DM を作り、200 で roomId と相手（id・表示名）だけを返す。部屋は direct で、当事者は2人", async () => {
    const before = await dmCounts();
    const response = await dmApi.start(
      { partnerUserId: bob.userId },
      alice.token,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as StartResult;
    expect(Object.keys(body).sort()).toEqual(["partner", "roomId"]);
    expect(body.partner).toEqual({
      id: bob.userId,
      displayName: "テストDMボブ",
    });
    expect(isUlid(body.roomId)).toBe(true);
    expect(await roomKindOf(body.roomId)).toBe("direct");
    expect(await dmMembersOf(body.roomId)).toEqual(
      [alice.userId, bob.userId].sort(),
    );
    expect(await dmRoomIdOf(alice.userId, bob.userId)).toBe(body.roomId);
    const after = await dmCounts();
    expect(after.directRooms - before.directRooms).toBe(1);
    expect(after.conversations - before.conversations).toBe(1);
    expect(after.members - before.members).toBe(2);
    expect(after.messages).toBe(before.messages);
  });

  it("#136 C-168(5): 2回目も、逆向き（相手から）の開始も 200 で同じ roomId を返し、行は増えない", async () => {
    const first = await startOk(bob.userId, alice.token);
    const counts = await dmCounts();
    const again = await startOk(bob.userId, alice.token);
    const reverse = await startOk(alice.userId, bob.token);
    expect(again.roomId).toBe(first.roomId);
    expect(reverse.roomId).toBe(first.roomId);
    expect(reverse.partner).toEqual({
      id: alice.userId,
      displayName: "テストDMアリス",
    });
    expect(await dmCounts()).toEqual(counts);
  });

  it("#136 C-168(5): 既存の DM（メッセージあり）があれば、その部屋を返す", async () => {
    const roomId = await insertDm(alice.userId, bob.userId);
    await insertMessage({ roomId, senderId: alice.userId });
    expect((await startOk(bob.userId, alice.token)).roomId).toBe(roomId);
  });

  it("#136 C-168(5): 同じ2人が同時に何度開始しても、DM は1つだけで、全員が同じ roomId を受け取る", async () => {
    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        i % 2 === 0
          ? dmApi.start({ partnerUserId: bob.userId }, alice.token)
          : dmApi.start({ partnerUserId: alice.userId }, bob.token),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(6).fill(200));
    const ids = await Promise.all(
      responses.map(async (r) => ((await r.json()) as StartResult).roomId),
    );
    expect(new Set(ids).size).toBe(1);
    const counts = await dmCounts();
    expect(counts.conversations).toBe(1);
    expect(counts.members).toBe(2);
    expect(counts.directRooms).toBe(1);
  });

  it("#136 AC-1（1-2 AC-4）: 部署・役割に関係なく、他部署の社員とも DM を始められる", async () => {
    expect((await startOk(ownerB.userId, carol.token)).partner.id).toBe(
      ownerB.userId,
    );
    expect((await startOk(bob.userId, admin.token)).partner.id).toBe(
      bob.userId,
    );
  });

  it("#136 C-168(5)（C-55）: 自分宛ては 422（fields に partnerUserId）で、行は増えない", async () => {
    const before = await dmCounts();
    const response = await dmApi.start(
      { partnerUserId: alice.userId },
      alice.token,
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { code: string; fields: string[] };
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.fields).toContain("partnerUserId");
    expect(await dmCounts()).toEqual(before);
  });

  it("#136 AC-1: 存在しない相手は 404 NOT_FOUND で、行は増えない", async () => {
    const before = await dmCounts();
    const response = await dmApi.start(
      { partnerUserId: MISSING_ID },
      alice.token,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
    expect(await dmCounts()).toEqual(before);
  });

  it("#136 C-168(5)（C-24）: 無効な相手は 422 VALIDATION_ERROR で、新しい DM を作らない", async () => {
    await deactivateUser(bob.userId);
    const before = await dmCounts();
    const response = await dmApi.start(
      { partnerUserId: bob.userId },
      alice.token,
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await dmCounts()).toEqual(before);
  });

  it("#136 C-168(5)（C-24）: 既存の DM があっても、相手が無効になった後の開始は 422（既存の部屋を返さない）", async () => {
    await insertDm(alice.userId, bob.userId);
    await deactivateUser(bob.userId);
    const before = await dmCounts();
    const response = await dmApi.start(
      { partnerUserId: bob.userId },
      alice.token,
    );
    expect(response.status).toBe(422);
    expect(await dmCounts()).toEqual(before);
  });

  it.each([
    ["partnerUserId がない", {}],
    ["partnerUserId が文字列でない", { partnerUserId: 123 }],
    ["partnerUserId が null", { partnerUserId: null }],
    ["partnerUserId が空文字", { partnerUserId: "" }],
    [
      "partnerUserId が小文字の ULID",
      { partnerUserId: MISSING_ID.toLowerCase() },
    ],
    ["partnerUserId が27文字", { partnerUserId: `${MISSING_ID}0` }],
    [
      "partnerUserId が SQL の断片",
      { partnerUserId: "'; DROP TABLE conversations; --" },
    ],
    ["partnerUserId が OR 1=1", { partnerUserId: "' OR 1=1 --" }],
    ["余分な項目（userIds）", { partnerUserId: "PLACEHOLDER", userIds: [] }],
    [
      "当事者を指定する項目（userId）",
      { partnerUserId: "PLACEHOLDER", userId: "x" },
    ],
  ])("#136 AC-1: %s は 422 で、行は増えない", async (_label, payload) => {
    const body = Object.fromEntries(
      Object.entries(payload).map(([k, v]) => [
        k,
        v === "PLACEHOLDER" ? bob.userId : v,
      ]),
    );
    const before = await dmCounts();
    const response = await dmApi.start(body, alice.token);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await dmCounts()).toEqual(before);
  });

  it("#136 AC-1: 壊れた JSON の本文は 422 で、500 にならない", async () => {
    const response = await profileRequest(
      newProfileContext(),
      "POST",
      "/api/dms",
      {
        token: alice.token,
        rawBody: '{"partnerUserId":',
      },
    );
    expect(response.status).toBe(422);
  });

  it("#136 AC-1（認可）: 未認証は 401 で、行は増えない", async () => {
    const before = await dmCounts();
    expect(
      (await dmApi.start({ partnerUserId: bob.userId }, null)).status,
    ).toBe(401);
    expect(await dmCounts()).toEqual(before);
  });

  it("#136 AC-1（認可）: 許可されていない Origin・Origin なしは 403 FORBIDDEN_ORIGIN で、行は増えない", async () => {
    const before = await dmCounts();
    const wrong = await dmApi.start(
      { partnerUserId: bob.userId },
      alice.token,
      "https://origin.invalid",
    );
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
    const none = await profileRequest(newProfileContext(), "POST", "/api/dms", {
      token: alice.token,
      origin: null,
      body: { partnerUserId: bob.userId },
    });
    expect(none.status).toBe(403);
    expect(await none.json()).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
    expect(await dmCounts()).toEqual(before);
  });
});

describe("#136 AC-1（1-2 AC-2）・AC-2（6-1 AC-1）DM の一覧（GET /api/dms）", () => {
  it("#136 AC-1（1-2 AC-2）: 自分が当事者の DM だけが出る。第三者・他部署のオーナー・全体管理者には、他人の DM は出ない", async () => {
    const ab = await insertDm(alice.userId, bob.userId);
    const ac = await insertDm(alice.userId, carol.userId);
    expect(
      (await listOk(alice.token)).items.map((i) => i.roomId).sort(),
    ).toEqual([ab, ac].sort());
    expect((await listOk(bob.token)).items.map((i) => i.roomId)).toEqual([ab]);
    for (const who of [stranger, ownerB, admin]) {
      const page = await listOk(who.token);
      expect(page.items).toEqual([]);
      expect(page.nextCursor).toBeNull();
    }
  });

  it("#136 AC-2（6-1 AC-1）: 各行は roomId・相手（id・表示名・有効か・ステータス）・最後のメッセージの日時だけ。相手のステータスが出る", async () => {
    const roomId = await insertDm(alice.userId, bob.userId);
    await env.DB.prepare(
      "UPDATE users SET status_kind = 'away', status_return_at = ?, status_message = 'テスト外出' WHERE id = ?",
    )
      .bind("2026-11-12T03:00:00.000Z", bob.userId)
      .run();
    const page = await listOk(alice.token);
    expect(Object.keys(page).sort()).toEqual(["items", "nextCursor"]);
    expect(page.items).toEqual([
      {
        roomId,
        partner: {
          id: bob.userId,
          displayName: "テストDMボブ",
          isActive: true,
          status: { kind: "away", returnAt: "2026-11-12T03:00:00.000Z" },
        },
        lastMessageAt: null,
      },
    ]);
    // 相手の本名・メール・一言は一覧に出さない
    const text = JSON.stringify(page);
    expect(text).not.toContain("legalName");
    expect(text).not.toContain("@example.com");
    expect(text).not.toContain("テスト外出");
  });

  it("#136 AC-1（1-2 AC-6）・C-168(2): 相手が無効なら isActive が偽、status が null で、一覧には残る", async () => {
    const roomId = await insertDm(alice.userId, bob.userId);
    await deactivateUser(bob.userId);
    const item = (await listOk(alice.token)).items[0];
    expect(item?.roomId).toBe(roomId);
    expect(item?.partner).toEqual({
      id: bob.userId,
      displayName: "テストDMボブ",
      isActive: false,
      status: null,
    });
  });

  it("#136 C-168(7): 並びは最終活動（最後のメッセージ、なければ作成）の新しい順で、lastMessageAt は最後のメッセージの日時", async () => {
    const older = await insertDmAt(alice.userId, bob.userId, 1_800_000_001_000);
    const middle = await insertDmAt(
      alice.userId,
      carol.userId,
      1_800_000_002_000,
    );
    const newer = await insertDmAt(
      alice.userId,
      ownerB.userId,
      1_800_000_003_000,
    );
    // 一番古い DM に、最も新しいメッセージが届く → 先頭へ
    await insertMessage({
      roomId: older,
      senderId: bob.userId,
      id: ulidAt(1_800_000_005_000),
    });
    const createdAt = (
      await env.DB.prepare("SELECT created_at FROM messages WHERE room_id = ?")
        .bind(older)
        .first<{ created_at: string }>()
    )?.created_at;
    const page = await listOk(alice.token);
    expect(page.items.map((i) => i.roomId)).toEqual([older, newer, middle]);
    expect(page.items[0]?.lastMessageAt).toBe(createdAt);
    expect(page.items[1]?.lastMessageAt).toBeNull();
  });

  it("#136 C-168(7): limit=1 で辿ると、全件を重複・欠落なく、同じ並びで得られ、最後は nextCursor が null", async () => {
    const rooms = [
      await insertDmAt(alice.userId, bob.userId, 1_800_000_001_000),
      await insertDmAt(alice.userId, carol.userId, 1_800_000_002_000),
      await insertDmAt(alice.userId, ownerB.userId, 1_800_000_003_000),
    ];
    await insertMessage({
      roomId: rooms[0] ?? "",
      senderId: alice.userId,
      id: ulidAt(1_800_000_004_000),
    });
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 5; i += 1) {
      const query: string =
        cursor === null
          ? "?limit=1"
          : `?limit=1&cursor=${encodeURIComponent(cursor)}`;
      const page = await listOk(alice.token, query);
      seen.push(...page.items.map((item) => item.roomId));
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
    expect(seen).toEqual([rooms[0], rooms[2], rooms[1]]);
    expect(cursor).toBeNull();
  });

  it("#136 C-168(7): limit を省くと既定の20件で、21件目は nextCursor の先に出る", async () => {
    const partners: string[] = [];
    for (let i = 0; i < 21; i += 1) {
      const id = await insertUser(
        `testuser_dm_many_${String(i).padStart(2, "0")}`,
        deptA.id,
      );
      partners.push(id);
      await insertDmAt(alice.userId, id, 1_800_000_000_000 + i * 1000);
    }
    const first = await listOk(alice.token);
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).not.toBeNull();
    const second = await listOk(
      alice.token,
      `?cursor=${encodeURIComponent(first.nextCursor ?? "")}`,
    );
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items].map((i) => i.partner.id);
    expect(new Set(all).size).toBe(21);
    expect([...all].sort()).toEqual([...partners].sort());
  });

  it("#136 C-168(7): limit=100 は受け付ける", async () => {
    await insertDm(alice.userId, bob.userId);
    expect((await listOk(alice.token, "?limit=100")).items).toHaveLength(1);
  });

  it.each([
    ["limit=0", "?limit=0"],
    ["limit=101", "?limit=101"],
    ["limit=abc", "?limit=abc"],
    ["limit=-1", "?limit=-1"],
    ["壊れたカーソル", "?cursor=%25%25%25"],
    ["形は正しいが中身が壊れたカーソル", "?cursor=eyJ2IjoxfQ"],
    [
      "改ざんしたカーソル（id が ULID でない）",
      `?cursor=${encodeURIComponent(btoa('{"v":"x","id":"abc"}'))}`,
    ],
    ["余分なクエリ", "?userId=someone"],
    ["余分なクエリ（q）", "?q=test"],
  ])("#136 C-168(7): %s は 422 VALIDATION_ERROR", async (_label, query) => {
    const response = await dmApi.list(query, alice.token);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("#136 AC-1（認可）: 未認証は 401", async () => {
    expect((await dmApi.list("", null)).status).toBe(401);
  });
});

describe("#136 AC-1（1-2 AC-2）・AC-2（6-1 AC-1）・C-168(4) DM の詳細（GET /api/dms/:roomId）", () => {
  it("#136 C-168(4)・AC-2（6-1 AC-1）: 当事者には、相手の表示名・部署・有効か・ステータス（戻り予定・一言）と、投稿できるかを返す", async () => {
    const roomId = await insertDm(alice.userId, bob.userId);
    await env.DB.prepare(
      "UPDATE users SET status_kind = 'away', status_return_at = ?, status_message = 'テスト外出' WHERE id = ?",
    )
      .bind("2026-11-12T03:00:00.000Z", bob.userId)
      .run();
    const response = await dmApi.detail(roomId, alice.token);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      roomId,
      partner: {
        id: bob.userId,
        displayName: "テストDMボブ",
        department: { id: deptB.id, name: deptB.name },
        isActive: true,
        status: {
          kind: "away",
          returnAt: "2026-11-12T03:00:00.000Z",
          message: "テスト外出",
        },
      },
      canPost: true,
    } satisfies Detail);
  });

  it("#136 C-168(4): 相手から見ると、相手（自分でない方）が partner になる", async () => {
    const roomId = await insertDm(alice.userId, bob.userId);
    const response = await dmApi.detail(roomId, bob.token);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Detail;
    expect(body.partner.id).toBe(alice.userId);
    expect(body.partner.department).toEqual({ id: deptA.id, name: deptA.name });
    expect(body.partner.status).toEqual({
      kind: "available",
      returnAt: null,
      message: null,
    });
  });

  it("#136 AC-1（1-2 AC-6）・C-168(2): 相手が無効なら 200 で isActive が偽・status が null・canPost が偽", async () => {
    const roomId = await insertDm(alice.userId, bob.userId);
    await deactivateUser(bob.userId);
    const response = await dmApi.detail(roomId, alice.token);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Detail;
    expect(body.partner).toMatchObject({
      id: bob.userId,
      displayName: "テストDMボブ",
      isActive: false,
      status: null,
    });
    expect(body.canPost).toBe(false);
  });

  it.each([
    ["第三者", () => stranger],
    ["他部署（相手の部署）のオーナー", () => ownerB],
    ["全体管理者", () => admin],
  ])(
    "#136 AC-1（1-2 AC-2）: %s には 404 で、存在しない部屋と区別がつかない",
    async (_label, who) => {
      const roomId = await insertDm(alice.userId, bob.userId);
      const response = await dmApi.detail(roomId, who().token);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual(
        await missingDetailBody(who().token),
      );
    },
  );

  it("#136 C-168(4): 参加しているチャンネルの部屋のIDを渡しても 404 で、存在しない部屋と区別がつかない", async () => {
    await insertMember(deptA.dedicatedChannelId, alice.userId);
    const response = await dmApi.detail(deptA.dedicatedChannelId, alice.token);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(await missingDetailBody(alice.token));
  });

  it("#136 C-168(4): 会話の行がない direct の部屋も 404", async () => {
    const id = testId("BAREDM");
    await env.DB.prepare(
      "INSERT INTO rooms (id, kind, created_at) VALUES (?, 'direct', ?)",
    )
      .bind(id, "2026-11-12T00:00:00.000Z")
      .run();
    try {
      expect((await dmApi.detail(id, alice.token)).status).toBe(404);
    } finally {
      await env.DB.prepare("DELETE FROM rooms WHERE id = ?").bind(id).run();
    }
  });

  it.each([
    ["小文字", MISSING_ID.toLowerCase()],
    ["27文字", `${MISSING_ID}0`],
    ["25文字", MISSING_ID.slice(0, 25)],
    ["SQL の断片", encodeURIComponent("'; --")],
    ["OR 1=1", encodeURIComponent("' OR 1=1 --")],
  ])(
    "#136 C-168(4)（指摘6）: roomId が%sなら 422（fields に roomId）",
    async (_label, roomId) => {
      const response = await dmApi.detail(roomId, alice.token);
      expect(response.status).toBe(422);
      const body = (await response.json()) as {
        code: string;
        fields: string[];
      };
      expect(body.code).toBe("VALIDATION_ERROR");
      expect(body.fields).toContain("roomId");
    },
  );

  it("#136 AC-1（認可）: 未認証は 401", async () => {
    const roomId = await insertDm(alice.userId, bob.userId);
    expect((await dmApi.detail(roomId, null)).status).toBe(401);
  });
});
