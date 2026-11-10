// #196: 部署の API（EP-2-01・EP-2-03・EP-2-23・EP-0-21・オーナー候補）を、実際のアプリ入口と隔離 D1 で確かめる。
// 処理の順：認証 → 認可（403。存在を漏らさない）→ 形式（422）→ 再認証（403 REAUTH_REQUIRED）→ 存在（404）→ 状態（409・422）→ batch。
// 形式の422は route で先に返すため、再認証より先でもよい（計画 5章）。ここでは形式が正しい要求で再認証を確かめる。
// データは架空のもの（testuser_dept_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_TRACE_PREFIX,
  SESSION_COOKIE,
  TEST_IP,
  cleanupAuthTestData,
  insertSession,
  newThrottleKey,
} from "../../test/auth-fixtures";
import {
  TEST_TAG,
  autoChannelsOf,
  cleanupDepartmentTestData,
  departmentAudits,
  departmentInvariantViolations,
  departmentOf,
  departmentSnapshot,
  insertChannel,
  insertDepartmentWithChannels,
  joinDepartmentChannels,
  makeGlobalAdmin,
  makeOwner,
  membersOf,
  ownersOf,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { newPiiKey, newSetupToken } from "../../test/random-secrets";
import { insertUser, testId } from "../../test/role-fixtures";
import { REAUTH_VALIDITY_MS } from "../../../shared/reauth-policy";
import { loadConfig } from "../config";
import { app } from "../index";

const ORIGIN = loadConfig(env).allowedOrigins[0] ?? "";
const CONFLICT_MESSAGE =
  "同じ名前の部署またはチャンネルがあります。別の部署名を入力してください";
let throttleKey: string;
let deptA: SeededDepartment;
let deptB: SeededDepartment;
let deptC: SeededDepartment;
let admin: string;
let ownerB: string;
let memberB1: string;
let memberB2: string;
let inactiveB: string;
let ownerC: string;
let memberC1: string;
let adminToken: string;
let ownerToken: string;
let memberToken: string;

async function request(
  method: string,
  path: string,
  options: { token?: string; body?: unknown; origin?: string } = {},
) {
  const headers: Record<string, string> = {
    Origin: options.origin ?? ORIGIN,
    "CF-Connecting-IP": TEST_IP,
    "X-Request-Id": `${AUTH_TRACE_PREFIX}${crypto.randomUUID()}`,
  };
  if (options.token) headers.Cookie = `${SESSION_COOKIE}=${options.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(
    path,
    {
      method,
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    },
    {
      ...env,
      LOGIN_THROTTLE_KEY: throttleKey,
      SETUP_TOKEN: newSetupToken(),
      PII_ENCRYPTION_KEY: newPiiKey(),
    } as unknown as Env,
  );
}

/** 再認証の時刻を入れたセッション。ms は現在からの経過（既定は1分前） */
async function sessionFor(userId: string, reauthAgoMs: number | null = 60_000) {
  const now = new Date();
  const session = await insertSession(userId, { createdAt: now.toISOString() });
  if (reauthAgoMs !== null)
    await env.DB.prepare(
      "UPDATE sessions SET reauthenticated_at = ? WHERE id = ?",
    )
      .bind(new Date(now.getTime() - reauthAgoMs).toISOString(), session.id)
      .run();
  return session.token;
}

const createBody = (overrides: Record<string, unknown> = {}) => ({
  name: `${TEST_TAG}新部署`,
  ...overrides,
});

beforeEach(async () => {
  throttleKey = newThrottleKey();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  deptA = await insertDepartmentWithChannels("本部");
  deptB = await insertDepartmentWithChannels("営業");
  deptC = await insertDepartmentWithChannels("開発");
  admin = await insertUser("testuser_dept_admin", deptA.id);
  ownerB = await insertUser("testuser_dept_owner_b", deptB.id);
  memberB1 = await insertUser("testuser_dept_b1", deptB.id);
  memberB2 = await insertUser("testuser_dept_b2", deptB.id);
  inactiveB = await insertUser("testuser_dept_b_inactive", deptB.id, {
    isActive: false,
  });
  ownerC = await insertUser("testuser_dept_owner_c", deptC.id);
  memberC1 = await insertUser("testuser_dept_c1", deptC.id);
  await env.DB.prepare(
    "UPDATE users SET must_change_password = 0 WHERE login_id LIKE 'testuser!_dept!_%' ESCAPE '!'",
  ).run();
  await makeGlobalAdmin(admin);
  await makeOwner(admin, deptA.id);
  await makeOwner(ownerB, deptB.id);
  await makeOwner(ownerC, deptC.id);
  await joinDepartmentChannels(deptA, admin);
  for (const user of [ownerB, memberB1, memberB2])
    await joinDepartmentChannels(deptB, user);
  for (const user of [ownerC, memberC1])
    await joinDepartmentChannels(deptC, user);
  adminToken = await sessionFor(admin);
  ownerToken = await sessionFor(ownerB);
  memberToken = await sessionFor(memberB1);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupAuthTestData();
  await cleanupDepartmentTestData();
});

describe("#196 POST /api/departments（EP-2-01）", () => {
  it("#196 AC-1（2-1 AC-2・7-1 AC-1）: 指名なしは作った全体管理者がオーナーになり、201 で最小限の項目を返す", async () => {
    const response = await request("POST", "/api/departments", {
      token: adminToken,
      body: createBody({ name: `  ${TEST_TAG}新部署  `, description: "説明" }),
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      "announcementChannelId",
      "createdAt",
      "dedicatedChannelId",
      "description",
      "id",
      "name",
      "ownerUserId",
      "version",
    ]);
    expect(body).toMatchObject({
      name: `${TEST_TAG}新部署`,
      description: "説明",
      ownerUserId: admin,
      version: 1,
    });
    const id = String(body.id);
    expect(await ownersOf(id)).toEqual([admin]);
    expect((await autoChannelsOf(id)).map((c) => c.room_id).sort()).toEqual(
      [
        String(body.dedicatedChannelId),
        String(body.announcementChannelId),
      ].sort(),
    );
    expect(
      (await departmentAudits()).filter(
        (a) => a.action === "department.create",
      ),
    ).toHaveLength(1);
  });

  it("#206 AC-1: 全体管理者が作ると、201 の後、自分が新部署の専用チャンネル2つのメンバーになり、所属は変わらない。監査は department.create の1件だけ", async () => {
    const response = await request("POST", "/api/departments", {
      token: adminToken,
      body: createBody(),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      id: string;
      dedicatedChannelId: string;
      announcementChannelId: string;
    };
    expect(await membersOf(body.dedicatedChannelId)).toEqual([admin]);
    expect(await membersOf(body.announcementChannelId)).toEqual([admin]);
    expect(await departmentOf(admin)).toBe(deptA.id);
    expect((await departmentAudits()).map((a) => a.action)).toEqual([
      "department.create",
    ]);
  });

  it("#196 AC-1・AC-2（2-1 AC-2・0-8 AC-7）: 一般社員を指名すると、その人がオーナーになり所属が移る", async () => {
    const response = await request("POST", "/api/departments", {
      token: adminToken,
      body: createBody({ ownerUserId: memberB1 }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; ownerUserId: string };
    expect(body.ownerUserId).toBe(memberB1);
    expect(await departmentOf(memberB1)).toBe(body.id);
    expect(await departmentInvariantViolations()).toEqual([]);
  });

  it("#196 AC-2（2-1 AC-18・0-8 AC-10）: 別部署の現オーナーを指名し、元部署の後任を付けると両方が一括で反映される", async () => {
    const response = await request("POST", "/api/departments", {
      token: adminToken,
      body: createBody({
        ownerUserId: ownerB,
        previousDepartmentSuccessorUserId: memberB1,
      }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string };
    expect(await ownersOf(body.id)).toEqual([ownerB]);
    expect(await ownersOf(deptB.id)).toEqual([memberB1]);
    expect(await departmentOf(ownerB)).toBe(body.id);
    expect(await departmentInvariantViolations()).toEqual([]);
  });

  it("#196 AC-1: 未認証は401で何も作らない", async () => {
    const before = await departmentSnapshot();
    const response = await request("POST", "/api/departments", {
      body: createBody(),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(await departmentSnapshot()).toEqual(before);
  });

  it.each([
    ["オーナー", () => ownerToken],
    ["一般社員", () => memberToken],
  ])(
    "#196 AC-4（2-1 AC-4・7-1 AC-3）: %sは再認証済みでも403 FORBIDDENで何も作らない",
    async (_label, token) => {
      const before = await departmentSnapshot();
      const response = await request("POST", "/api/departments", {
        token: token(),
        body: createBody(),
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
      expect(await departmentSnapshot()).toEqual(before);
    },
  );

  it("#196 AC-4: 権限のない社員には、再認証が無くても REAUTH_REQUIRED ではなく FORBIDDEN を返す（認可が先）", async () => {
    const token = await sessionFor(memberB2, null);
    const response = await request("POST", "/api/departments", {
      token,
      body: createBody(),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
  });

  it("#196 AC-4: 許可外の Origin は403で何も作らない", async () => {
    const before = await departmentSnapshot();
    const response = await request("POST", "/api/departments", {
      token: adminToken,
      body: createBody(),
      origin: "https://origin.invalid",
    });
    expect(response.status).toBe(403);
    expect(await departmentSnapshot()).toEqual(before);
  });

  it.each([
    ["再認証していない", null],
    ["再認証から5分を過ぎた", REAUTH_VALIDITY_MS + 1_000],
  ])(
    "#196 AC-1（2-1 AC-1・0-5）: %s全体管理者は403 REAUTH_REQUIREDで、部署・チャンネル・ロール・所属・参加・監査が変わらない",
    async (_label, ago) => {
      const token = await sessionFor(admin, ago);
      const before = await departmentSnapshot();
      const response = await request("POST", "/api/departments", {
        token,
        body: createBody({ ownerUserId: memberB1 }),
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "REAUTH_REQUIRED" });
      expect(await departmentSnapshot()).toEqual(before);
    },
  );

  it.each([
    ["空", ""],
    ["空白だけ", "   "],
    ["51文字", "A".repeat(51)],
    ["制御文字を含む", `${TEST_TAG}営業\u0007`],
  ])(
    "#196 AC-1（2-1 AC-12・S-10）: 部署名が%sなら422",
    async (_label, name) => {
      const before = await departmentSnapshot();
      const response = await request("POST", "/api/departments", {
        token: adminToken,
        body: { name },
      });
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
      expect(await departmentSnapshot()).toEqual(before);
    },
  );

  it("#196 AC-1（2-1 AC-12）: 部署名は50文字まで、説明は500文字まで受け付け、501文字は422", async () => {
    const name = `${TEST_TAG}${"A".repeat(50 - TEST_TAG.length)}`;
    const ok = await request("POST", "/api/departments", {
      token: adminToken,
      body: { name, description: "あ".repeat(500) },
    });
    expect(ok.status).toBe(201);
    const ng = await request("POST", "/api/departments", {
      token: adminToken,
      body: { name: `${TEST_TAG}説明超過`, description: "あ".repeat(501) },
    });
    expect(ng.status).toBe(422);
  });

  it.each([
    ["大文字・小文字だけが違う", `${TEST_TAG}営業`.toUpperCase()],
    ["前後に空白がある", `  ${TEST_TAG}営業  `],
  ])(
    "#196 AC-1（2-1 AC-12・C-49）: 既存の部署名と%s名前は409で、案内の文言を返し何も変わらない",
    async (_label, name) => {
      const before = await departmentSnapshot();
      const response = await request("POST", "/api/departments", {
        token: adminToken,
        body: { name, ownerUserId: memberB1 },
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: "CONFLICT",
        message: CONFLICT_MESSAGE,
      });
      expect(await departmentSnapshot()).toEqual(before);
    },
  );

  it("#196 AC-3（7-1 2026-11-08承認）: アーカイブ済みのチャンネル名と衝突すると409で、全体が取り消される", async () => {
    await insertChannel({
      name: `${TEST_TAG}衝突のお知らせ`,
      purpose: "normal",
      departmentId: null,
      archived: true,
    });
    const before = await departmentSnapshot();
    const response = await request("POST", "/api/departments", {
      token: adminToken,
      body: { name: `${TEST_TAG}衝突`, ownerUserId: memberB1 },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "CONFLICT",
      message: CONFLICT_MESSAGE,
    });
    expect(await departmentSnapshot()).toEqual(before);
  });

  it("#196 AC-2: 指名した社員がいなければ404で何も変わらない", async () => {
    const before = await departmentSnapshot();
    const response = await request("POST", "/api/departments", {
      token: adminToken,
      body: createBody({ ownerUserId: testId("NOUSER") }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
    expect(await departmentSnapshot()).toEqual(before);
  });

  it.each([
    ["無効な社員を指名した", () => ({ ownerUserId: inactiveB })],
    ["別部署の現オーナーの後任が無い", () => ({ ownerUserId: ownerB })],
    [
      "後任が無効な社員",
      () => ({
        ownerUserId: ownerB,
        previousDepartmentSuccessorUserId: inactiveB,
      }),
    ],
    [
      "後任が元部署以外の社員",
      () => ({
        ownerUserId: ownerB,
        previousDepartmentSuccessorUserId: memberC1,
      }),
    ],
    [
      "後任が全体管理者",
      () => ({
        ownerUserId: ownerB,
        previousDepartmentSuccessorUserId: admin,
      }),
    ],
    [
      "後任が不要なのに付いている（一般社員の指名）",
      () => ({
        ownerUserId: memberB1,
        previousDepartmentSuccessorUserId: memberB2,
      }),
    ],
    [
      "後任が不要なのに付いている（全体管理者の指名）",
      () => ({
        ownerUserId: admin,
        previousDepartmentSuccessorUserId: memberB2,
      }),
    ],
  ])(
    "#196 AC-2（0-8 AC-7・AC-10）: %sなら422で、部署・チャンネル・ロール・所属・参加・監査が変わらない",
    async (_label, extra) => {
      const before = await departmentSnapshot();
      const response = await request("POST", "/api/departments", {
        token: adminToken,
        body: createBody(extra()),
      });
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
      expect(await departmentSnapshot()).toEqual(before);
    },
  );

  it("#196 AC-5（計画レビュー 6）: 未知のDBエラーは409・422に変えず500にし、何も残さない", async () => {
    await env.DB.exec(
      "CREATE TRIGGER unit_fail_department_audit BEFORE INSERT ON audit_logs WHEN NEW.action LIKE 'department.%' BEGIN SELECT RAISE(ABORT, 'unit_fail_department_audit'); END",
    );
    try {
      const before = await departmentSnapshot();
      const response = await request("POST", "/api/departments", {
        token: adminToken,
        body: createBody({ ownerUserId: memberB1 }),
      });
      expect(response.status).toBe(500);
      const text = await response.text();
      expect(text).not.toContain("unit_fail_department_audit");
      expect(await departmentSnapshot()).toEqual(before);
    } finally {
      await env.DB.exec("DROP TRIGGER IF EXISTS unit_fail_department_audit");
    }
  });
});

describe("#196 GET /api/admin/departments（EP-2-03）", () => {
  it("#196 AC-4: 全体管理者は一覧を取得でき、項目は最小限（本名・メール・社員IDを含まない）", async () => {
    const response = await request("GET", "/api/admin/departments?limit=100", {
      token: adminToken,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const text = await response.text();
    const body = JSON.parse(text) as {
      items: Record<string, unknown>[];
      nextCursor: string | null;
    };
    const item = body.items.find((i) => i.id === deptB.id);
    expect(item).toBeDefined();
    expect(Object.keys(item ?? {}).sort()).toEqual([
      "id",
      "isActive",
      "memberCount",
      "name",
      "ownerDisplayName",
      "ownerUserId",
      "version",
    ]);
    expect(item).toMatchObject({
      name: `${TEST_TAG}営業`,
      isActive: true,
      ownerUserId: ownerB,
      ownerDisplayName: "テスト太郎",
      // 所属人数は有効な社員だけ（ownerB・memberB1・memberB2。無効の inactiveB は数えない）
      memberCount: 3,
      version: 1,
    });
    expect(text).not.toContain("@example.com");
    expect(text).not.toContain("testuser_dept_");
    expect(text).not.toContain("v1:");
  });

  it("#196 AC-4: limit で区切り、nextCursor で続きを重複なく取れる", async () => {
    const first = await request("GET", "/api/admin/departments?limit=1", {
      token: adminToken,
    });
    expect(first.status).toBe(200);
    const page = (await first.json()) as {
      items: { id: string }[];
      nextCursor: string | null;
    };
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const second = await request(
      "GET",
      `/api/admin/departments?limit=1&cursor=${encodeURIComponent(page.nextCursor ?? "")}`,
      { token: adminToken },
    );
    const next = (await second.json()) as { items: { id: string }[] };
    expect(next.items).toHaveLength(1);
    expect(next.items[0]?.id).not.toBe(page.items[0]?.id);
  });

  it("#196 AC-4: 壊れたカーソルは422", async () => {
    const response = await request("GET", "/api/admin/departments?cursor=%%%", {
      token: adminToken,
    });
    expect(response.status).toBe(422);
  });

  it.each([
    ["オーナー", () => ownerToken],
    ["一般社員", () => memberToken],
  ])("#196 AC-4: %sは403で一覧を返さない", async (_label, token) => {
    const response = await request("GET", "/api/admin/departments", {
      token: token(),
    });
    expect(response.status).toBe(403);
    const text = await response.text();
    expect(text).not.toContain(TEST_TAG);
  });

  it("#196 AC-4: 未認証は401", async () => {
    expect((await request("GET", "/api/admin/departments")).status).toBe(401);
  });

  it("#196 AC-4: 一覧の取得には再認証を求めない", async () => {
    const token = await sessionFor(admin, null);
    expect(
      (await request("GET", "/api/admin/departments", { token })).status,
    ).toBe(200);
  });
});

describe("#196 PATCH /api/admin/departments/:id（EP-2-23）", () => {
  const path = () => `/api/admin/departments/${deptB.id}`;

  it("#196 AC-1・AC-3（2-1 AC-13・7-1）: 改名で両チャンネル名が追従し、200 で最小限の項目を返す", async () => {
    const response = await request("PATCH", path(), {
      token: adminToken,
      body: { name: ` ${TEST_TAG}営業改 `, version: 1 },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      "id",
      "name",
      "updatedAt",
      "version",
    ]);
    expect(body).toMatchObject({
      id: deptB.id,
      name: `${TEST_TAG}営業改`,
      version: 2,
    });
    expect((await autoChannelsOf(deptB.id)).map((c) => c.name)).toEqual([
      `${TEST_TAG}営業改のお知らせ`,
      `${TEST_TAG}営業改`,
    ]);
    expect(
      (await departmentAudits()).filter(
        (a) => a.action === "department.rename",
      ),
    ).toHaveLength(1);
  });

  it("#196 AC-3（計画レビュー 1）: 「Xのお知らせ」を「X」に変える改名は409にならない", async () => {
    const dept = await insertDepartmentWithChannels("案内のお知らせ");
    const owner = await insertUser("testuser_dept_self_route", dept.id);
    await makeOwner(owner, dept.id);
    const response = await request(
      "PATCH",
      `/api/admin/departments/${dept.id}`,
      {
        token: adminToken,
        body: { name: `${TEST_TAG}案内`, version: 1 },
      },
    );
    expect(response.status).toBe(200);
  });

  it.each([
    ["オーナー", () => ownerToken],
    ["一般社員", () => memberToken],
  ])(
    "#196 AC-1（2-1 AC-13）: %sは403で何も変わらない",
    async (_label, token) => {
      const before = await departmentSnapshot();
      const response = await request("PATCH", path(), {
        token: token(),
        body: { name: `${TEST_TAG}改名`, version: 1 },
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
      expect(await departmentSnapshot()).toEqual(before);
    },
  );

  it("#196 AC-1（2-1 AC-13）: 再認証なしは403 REAUTH_REQUIREDで何も変わらない", async () => {
    const token = await sessionFor(admin, null);
    const before = await departmentSnapshot();
    const response = await request("PATCH", path(), {
      token,
      body: { name: `${TEST_TAG}改名`, version: 1 },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "REAUTH_REQUIRED" });
    expect(await departmentSnapshot()).toEqual(before);
  });

  it("#196 AC-1: 存在しない部署は404", async () => {
    const response = await request(
      "PATCH",
      `/api/admin/departments/${testId("NODEPT")}`,
      { token: adminToken, body: { name: `${TEST_TAG}改名`, version: 1 } },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
  });

  it.each([
    ["版の不一致", () => ({ name: `${TEST_TAG}改名`, version: 9 })],
    [
      "他の部署名と大小文字違いで重複",
      () => ({ name: `${TEST_TAG}開発`.toUpperCase(), version: 1 }),
    ],
  ])("#196 AC-1・AC-5: %sは409で何も変わらない", async (_label, body) => {
    const before = await departmentSnapshot();
    const response = await request("PATCH", path(), {
      token: adminToken,
      body: body(),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "CONFLICT" });
    expect(await departmentSnapshot()).toEqual(before);
  });

  it("#196 AC-3（計画レビュー 6）: 名前の衝突と版の不一致は、案内の文言で区別する", async () => {
    const duplicate = await request("PATCH", path(), {
      token: adminToken,
      body: { name: `${TEST_TAG}開発`, version: 1 },
    });
    expect(await duplicate.json()).toMatchObject({ message: CONFLICT_MESSAGE });
    const stale = await request("PATCH", path(), {
      token: adminToken,
      body: { name: `${TEST_TAG}改名`, version: 9 },
    });
    const staleBody = (await stale.json()) as { message?: string };
    expect(staleBody.message).not.toBe(CONFLICT_MESSAGE);
  });

  it.each([
    ["名前が51文字", { name: "A".repeat(51), version: 1 }],
    ["版がない", { name: `${TEST_TAG}改名` }],
    ["版が0", { name: `${TEST_TAG}改名`, version: 0 }],
    ["版が小数", { name: `${TEST_TAG}改名`, version: 1.5 }],
  ])("#196 AC-1: %sは422", async (_label, body) => {
    const response = await request("PATCH", path(), {
      token: adminToken,
      body,
    });
    expect(response.status).toBe(422);
  });

  it("#196 AC-4（2-1 AC-14）: 部署の削除APIはない", async () => {
    const response = await request("DELETE", path(), { token: adminToken });
    expect([404, 405]).toContain(response.status);
    expect((await departmentSnapshot()).departments).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: deptB.id })]),
    );
  });
});

describe("#196 PUT /api/departments/:id/owner（EP-0-21）", () => {
  const path = (id = deptB.id) => `/api/departments/${id}/owner`;

  it("#196 AC-2（0-8 AC-4）: 一般社員を任命すると交代し、200 で最小限の項目を返す。前のオーナーは一般メンバー", async () => {
    const response = await request("PUT", path(), {
      token: adminToken,
      body: { ownerUserId: memberB1, version: 1 },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      "departmentId",
      "ownerUserId",
      "updatedAt",
      "version",
    ]);
    expect(body).toMatchObject({
      departmentId: deptB.id,
      ownerUserId: memberB1,
      version: 2,
    });
    expect(await ownersOf(deptB.id)).toEqual([memberB1]);
    expect(await departmentOf(ownerB)).toBe(deptB.id);
    expect(
      (await departmentAudits()).filter(
        (a) => a.action === "department.owner_change",
      ),
    ).toHaveLength(1);
  });

  it("#196 AC-2（0-8 AC-10）: 別部署の現オーナーを任命し、元部署の後任を付けると両部署の交代・所属・参加が一括で反映される", async () => {
    const response = await request("PUT", path(deptC.id), {
      token: adminToken,
      body: {
        ownerUserId: ownerB,
        previousDepartmentSuccessorUserId: memberB1,
        version: 1,
      },
    });
    expect(response.status).toBe(200);
    expect(await ownersOf(deptC.id)).toEqual([ownerB]);
    expect(await ownersOf(deptB.id)).toEqual([memberB1]);
    expect(await departmentOf(ownerB)).toBe(deptC.id);
    expect(await membersOf(deptC.dedicatedChannelId)).toContain(ownerB);
    expect(await membersOf(deptB.dedicatedChannelId)).not.toContain(ownerB);
    expect(await departmentInvariantViolations()).toEqual([]);
  });

  it("#196 AC-2（0-8 AC-5）: 全体管理者を任命すると所属は動かない", async () => {
    const response = await request("PUT", path(), {
      token: adminToken,
      body: { ownerUserId: admin, version: 1 },
    });
    expect(response.status).toBe(200);
    expect(await departmentOf(admin)).toBe(deptA.id);
    expect(await ownersOf(deptA.id)).toEqual([admin]);
    expect(await ownersOf(deptB.id)).toEqual([admin]);
  });

  it("#206 AC-2: 全体管理者を任命すると、200 の後、その部署の専用チャンネル2つに参加する。兼任中の他部署の参加は変わらず、監査は department.owner_change の1件だけ", async () => {
    const aMembersBefore = await membersOf(deptA.dedicatedChannelId);
    const response = await request("PUT", path(), {
      token: adminToken,
      body: { ownerUserId: admin, version: 1 },
    });
    expect(response.status).toBe(200);
    expect(await membersOf(deptB.dedicatedChannelId)).toContain(admin);
    expect(await membersOf(deptB.announcementChannelId)).toContain(admin);
    expect(await membersOf(deptA.dedicatedChannelId)).toEqual(aMembersBefore);
    expect((await departmentAudits()).map((a) => a.action)).toEqual([
      "department.owner_change",
    ]);
  });

  it("#206 AC-3: オーナーを外れた全体管理者は、専用チャンネルに残る", async () => {
    // 全体管理者を部署Cのオーナーにしたあと、部署Cの一般社員に交代する
    const response = await request("PUT", path(deptC.id), {
      token: adminToken,
      body: { ownerUserId: admin, version: 1 },
    });
    expect(response.status).toBe(200);
    const back = await request("PUT", path(deptC.id), {
      token: adminToken,
      body: { ownerUserId: memberC1, version: 2 },
    });
    expect(back.status).toBe(200);
    expect(await ownersOf(deptC.id)).toEqual([memberC1]);
    expect(await membersOf(deptC.dedicatedChannelId)).toContain(admin);
    expect(await membersOf(deptC.announcementChannelId)).toContain(admin);
  });

  it.each([
    ["オーナー", () => ownerToken],
    ["一般社員", () => memberToken],
  ])(
    "#196 AC-2（0-8 AC-1）: %sは403で何も変わらない",
    async (_label, token) => {
      const before = await departmentSnapshot();
      const response = await request("PUT", path(), {
        token: token(),
        body: { ownerUserId: memberB2, version: 1 },
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
      expect(await departmentSnapshot()).toEqual(before);
    },
  );

  it.each([
    ["再認証していない", null],
    ["再認証から5分を過ぎた", REAUTH_VALIDITY_MS + 1_000],
  ])(
    "#196 AC-2（0-8 AC-2）: %sなら403 REAUTH_REQUIREDで、ロール・所属・参加・監査が変わらない",
    async (_label, ago) => {
      const token = await sessionFor(admin, ago);
      const before = await departmentSnapshot();
      const response = await request("PUT", path(deptC.id), {
        token,
        body: {
          ownerUserId: ownerB,
          previousDepartmentSuccessorUserId: memberB1,
          version: 1,
        },
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "REAUTH_REQUIRED" });
      expect(await departmentSnapshot()).toEqual(before);
    },
  );

  it.each([
    ["部署がない", () => path(testId("NODEPT")), () => memberB1],
    ["任命する社員がいない", () => path(), () => testId("NOUSER")],
  ])("#196 AC-2: %sなら404", async (_label, target, owner) => {
    const response = await request("PUT", target(), {
      token: adminToken,
      body: { ownerUserId: owner(), version: 1 },
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
  });

  it("#196 AC-2: すでにその部署のオーナーである人の任命は409で何も変わらない", async () => {
    const before = await departmentSnapshot();
    const response = await request("PUT", path(), {
      token: adminToken,
      body: { ownerUserId: ownerB, version: 1 },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "CONFLICT" });
    expect(await departmentSnapshot()).toEqual(before);
  });

  it("#196 AC-5: 版の不一致は409で何も変わらない", async () => {
    const before = await departmentSnapshot();
    const response = await request("PUT", path(), {
      token: adminToken,
      body: { ownerUserId: memberB1, version: 5 },
    });
    expect(response.status).toBe(409);
    expect(await departmentSnapshot()).toEqual(before);
  });

  it("#196 AC-5: 無効な部署のオーナーは交代できず409", async () => {
    const inactive = await insertDepartmentWithChannels("無効部署", {
      isActive: false,
    });
    const response = await request("PUT", path(inactive.id), {
      token: adminToken,
      body: { ownerUserId: memberB1, version: 1 },
    });
    expect(response.status).toBe(409);
  });

  it.each([
    ["無効な社員の任命", () => ({ ownerUserId: inactiveB })],
    ["別部署の現オーナーで後任なし", () => ({ ownerUserId: ownerC })],
    [
      "後任が無効な社員",
      () => ({
        ownerUserId: ownerC,
        previousDepartmentSuccessorUserId: inactiveB,
      }),
    ],
    [
      "後任が元部署以外の社員",
      () => ({
        ownerUserId: ownerC,
        previousDepartmentSuccessorUserId: memberB1,
      }),
    ],
    [
      "後任が全体管理者",
      () => ({ ownerUserId: ownerC, previousDepartmentSuccessorUserId: admin }),
    ],
    [
      "不要な後任",
      () => ({
        ownerUserId: memberB1,
        previousDepartmentSuccessorUserId: memberB2,
      }),
    ],
  ])(
    "#196 AC-2（0-8 AC-10）: %sは422で、ロール・所属・参加・監査が変わらない",
    async (_label, extra) => {
      const before = await departmentSnapshot();
      const response = await request("PUT", path(), {
        token: adminToken,
        body: { version: 1, ...extra() },
      });
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
      expect(await departmentSnapshot()).toEqual(before);
    },
  );

  it("#196 AC-5: 同じ版で2回送ると片方だけ成功し、もう片方は409", async () => {
    const [first, second] = await Promise.all([
      request("PUT", path(), {
        token: adminToken,
        body: { ownerUserId: memberB1, version: 1 },
      }),
      request("PUT", path(), {
        token: adminToken,
        body: { ownerUserId: memberB2, version: 1 },
      }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(await ownersOf(deptB.id)).toHaveLength(1);
    expect(await departmentInvariantViolations()).toEqual([]);
  });
});

describe("#196 GET /api/admin/departments/owner-candidates（S-5・計画レビュー 5）", () => {
  const base = "/api/admin/departments/owner-candidates";

  it("#196 AC-2: 有効な社員だけを、最小限の項目で返す", async () => {
    const response = await request("GET", `${base}?limit=50`, {
      token: adminToken,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const text = await response.text();
    const body = JSON.parse(text) as {
      items: Record<string, unknown>[];
      nextCursor: string | null;
    };
    const ids = body.items.map((i) => i.id);
    expect(ids).toContain(memberB1);
    expect(ids).not.toContain(inactiveB);
    for (const item of body.items)
      expect(Object.keys(item).sort()).toEqual([
        "departmentId",
        "displayName",
        "id",
        "isGlobalAdmin",
        "ownedDepartmentId",
      ]);
    expect(text).not.toContain("@example.com");
    expect(text).not.toContain("testuser_dept_");
    expect(text).not.toContain("v1:");
  });

  it("#196 AC-2: q は表示名の部分一致で、% と _ を文字どおりに扱う", async () => {
    await env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?")
      .bind("候補%太郎", memberB1)
      .run();
    const response = await request(
      "GET",
      `${base}?q=${encodeURIComponent("%")}`,
      { token: adminToken },
    );
    const body = (await response.json()) as { items: { id: string }[] };
    expect(body.items.map((i) => i.id)).toEqual([memberB1]);
  });

  it.each([
    ["0", 422],
    ["50", 200],
    ["51", 422],
  ])("#196 AC-2: limit=%s は %i", async (limit, status) => {
    const response = await request("GET", `${base}?limit=${limit}`, {
      token: adminToken,
    });
    expect(response.status).toBe(status);
  });

  it.each([
    ["オーナー", () => ownerToken],
    ["一般社員", () => memberToken],
  ])("#196 AC-4: %sは403で候補を返さない", async (_label, token) => {
    const response = await request("GET", base, { token: token() });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(memberB1);
  });
});

describe("#196 セッションの部署管理の権限", () => {
  it("#196 AC-4: 全体管理者のセッションは perm.workspace.create を返し、オーナー・一般社員は返さない", async () => {
    const read = async (token: string) => {
      const response = await request("GET", "/api/auth/session", { token });
      expect(response.status).toBe(200);
      return ((await response.json()) as { permissions: string[] }).permissions;
    };
    expect(await read(adminToken)).toContain("perm.workspace.create");
    expect(await read(ownerToken)).not.toContain("perm.workspace.create");
    expect(await read(memberToken)).not.toContain("perm.workspace.create");
  });
});

describe("#196 一覧・候補のクエリの既定値（ミューテーションの補強）", () => {
  it("#196 AC-2: 候補の q は前後の空白を除く（空白だけなら、絞り込みなしと同じ結果）", async () => {
    const read = async (query: string) => {
      const response = await request(
        "GET",
        `/api/admin/departments/owner-candidates${query}`,
        { token: adminToken },
      );
      expect(response.status).toBe(200);
      return ((await response.json()) as { items: { id: string }[] }).items
        .map((i) => i.id)
        .sort();
    };
    const all = await read("?limit=50");
    expect(all.length).toBeGreaterThan(0);
    expect(await read(`?limit=50&q=${encodeURIComponent("   ")}`)).toEqual(all);
  });

  it("#196 AC-4: 一覧は limit を省くと20件ずつ返す", async () => {
    for (let i = 0; i < 20; i += 1)
      await insertDepartmentWithChannels(
        `既定件数${String(i).padStart(2, "0")}`,
      );
    const response = await request("GET", "/api/admin/departments", {
      token: adminToken,
    });
    const body = (await response.json()) as {
      items: unknown[];
      nextCursor: string | null;
    };
    expect(body.items).toHaveLength(20);
    expect(body.nextCursor).not.toBeNull();
  });

  it("#196 AC-2: 候補は limit を省くと50件ずつ返す", async () => {
    for (let i = 0; i < 50; i += 1)
      await insertUser(
        `testuser_dept_many_${String(i).padStart(2, "0")}`,
        deptC.id,
      );
    const response = await request(
      "GET",
      "/api/admin/departments/owner-candidates",
      { token: adminToken },
    );
    const body = (await response.json()) as {
      items: unknown[];
      nextCursor: string | null;
    };
    expect(body.items).toHaveLength(50);
    expect(body.nextCursor).not.toBeNull();
  });
});
