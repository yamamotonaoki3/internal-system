// #128（128-c）0-1 AC-20・3-4 AC-1〜3・C-177（U-1〜U-3・U-8）: 退職処理の申請の API を、実際の入口（index.ts の app）と隔離 D1 で確かめる。
// 契約（計画 5.2・5.4。実装前の仮置き）：
//   POST /api/retirement-requests { targetUserId } → 201 { id, targetUserId, departmentId, status: "pending", createdAt }
//   GET  /api/retirement-requests/mine → 200 { items: [{ id, status, target: { id, displayName }, department: { id, name }, decisionReason, createdAt, decidedAt }], nextCursor }
//   POST /api/retirement-requests/:id/withdraw → 200 { id, status: "withdrawn" }
//   GET  /api/admin/retirement-requests?status=pending → 200 { items: [{ id, status, target: { id, displayName }, department: { id, name },
//          requester: { id, displayName }, decisionReason, createdAt, decidedAt }], nextCursor }
//   POST /api/admin/retirement-requests/:id/reject { reason }（前後の空白を除いて 1〜200 文字。channel_requests の rejectReasonSchema と同じ定義）→ 200 { id, status: "rejected" }
//   承認は専用の API を作らず、POST /api/admin/accounts/:targetId/deactivate（128-a）で申請を完了にする。
//   GET /api/users の各行に canRequestRetirement（表示の制御。対象が自分の部署の有効な社員で、オーナー・全体管理者・自分自身でないとき真。申請中の申請があっても真）を足す。
//   作成・却下は再認証が必要（期限切れ・なしは 403 REAUTH_REQUIRED）。取り下げは不要。
//   作成の対象がない → 404、無効・所属なし・ほかの部署 → 403、オーナー（自身を含む）→ 409 department_owner、全体管理者 → 409 global_admin。
//   エラーの応答は { code, message, reason? }（reason は最上位）。
// 判定の順は Service、SQL の条件は DB のテストで確かめる。ここでは HTTP の認可・応答の形・通知の宛先・存在の非開示だけを確かめる。
// データは架空（testuser_128c_r_・[UNIT_TEST]・@example.com）。
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
  cleanupDepartmentTestData,
  insertDepartmentWithChannels,
  makeGlobalAdmin,
  makeOwner,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { newPiiKey, newSetupToken } from "../../test/random-secrets";
import {
  cleanupRetirementRequestTestData,
  insertRetirementRequest,
  retirementNotifications,
  retirementRow,
  retirementRows,
} from "../../test/retirement-request-fixtures";
import { insertUser } from "../../test/role-fixtures";
import { loadConfig } from "../config";
import { app } from "../index";

const ORIGIN = loadConfig(env).allowedOrigins[0] ?? "";
const BASE = "/api/retirement-requests";
const ADMIN_BASE = "/api/admin/retirement-requests";
const MISSING_ID = "01JTEST128CN0NE00000000001";
const REASON = "[UNIT_TEST]在籍の確認がとれたため却下";

let throttleKey: string;
let deptA: SeededDepartment;
let deptB: SeededDepartment;
let admin: string;
let ownerA: string;
let ownerB: string;
let member: string;
let target: string;
let gone: string;

async function request(
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {
    Origin: ORIGIN,
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

/** 再認証の時刻を入れたセッション。reauthAgoMs が null なら再認証なし（既定は1分前。作成・却下・無効化に要る） */
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

const submit = (token: string, targetUserId: string) =>
  request("POST", BASE, { token, body: { targetUserId } });
const reject = (token: string, id: string, reason: unknown = REASON) =>
  request("POST", `${ADMIN_BASE}/${id}/reject`, { token, body: { reason } });
const withdraw = (token: string, id: string) =>
  request("POST", `${BASE}/${id}/withdraw`, { token });

async function stateOf(id: string) {
  return env.DB.prepare(
    "SELECT is_active, department_id FROM users WHERE id = ?",
  )
    .bind(id)
    .first<{ is_active: number; department_id: string | null }>();
}

beforeEach(async () => {
  throttleKey = newThrottleKey();
  const capture = () => undefined;
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  deptA = await insertDepartmentWithChannels("128c結合A");
  deptB = await insertDepartmentWithChannels("128c結合B");
  admin = await insertUser("testuser_128c_r_admin", deptB.id);
  ownerA = await insertUser("testuser_128c_r_ownera", deptA.id);
  ownerB = await insertUser("testuser_128c_r_ownerb", deptB.id);
  member = await insertUser("testuser_128c_r_member", deptA.id);
  target = await insertUser("testuser_128c_r_target", deptA.id);
  gone = await insertUser("testuser_128c_r_gone", deptA.id, {
    isActive: false,
  });
  await env.DB.prepare(
    "UPDATE users SET must_change_password = 0, department_id = CASE WHEN is_active = 0 THEN NULL ELSE department_id END WHERE login_id LIKE 'testuser!_128c!_r!_%' ESCAPE '!'",
  ).run();
  await makeGlobalAdmin(admin);
  await makeOwner(ownerA, deptA.id);
  await makeOwner(ownerB, deptB.id);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupRetirementRequestTestData();
  await cleanupAuthTestData();
  await cleanupDepartmentTestData();
});

describe("#128（128-c）0-1 AC-20 申請の作成（HTTP）", () => {
  it("#128 0-1 AC-20: 自分の部署のオーナーが申請すると 201 で pending の申請を返し、応答に本名・メールがなく、対象は有効で所属も変わらない", async () => {
    const token = await sessionFor(ownerA);
    const before = await stateOf(target);
    const res = await submit(token, target);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      id: expect.any(String) as string,
      targetUserId: target,
      departmentId: deptA.id,
      status: "pending",
    });
    const text = JSON.stringify(body);
    expect(text).not.toContain("@example.com");
    expect(text).not.toContain("legalName");
    expect(text).not.toContain("v1:");
    expect(await stateOf(target)).toEqual(before);
    expect(await retirementRows()).toHaveLength(1);
  });

  it.each([
    ["ほかの部署のオーナー", () => ownerB],
    ["一般社員", () => member],
    ["その部署のオーナーでない全体管理者", () => admin],
  ])(
    "#128 0-1 AC-20: %sは 403 FORBIDDEN で、申請も通知もできない",
    async (_label, who) => {
      const token = await sessionFor(who());
      const res = await submit(token, target);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "FORBIDDEN" });
      expect(await retirementRows()).toEqual([]);
      expect(await retirementNotifications()).toEqual([]);
    },
  );

  it("#128 0-1 AC-20: 存在しない社員は 404、無効（所属なし）の社員は 403", async () => {
    const token = await sessionFor(ownerA);
    expect((await submit(token, MISSING_ID)).status).toBe(404);
    const inactive = await submit(token, gone);
    expect(inactive.status).toBe(403);
    expect(await inactive.json()).toMatchObject({ code: "FORBIDDEN" });
    expect(await retirementRows()).toEqual([]);
  });

  it("#128 0-1 AC-20（0-1 AC-9）: 対象が部署のオーナー（申請者自身を含む）なら 409 department_owner、全体管理者なら 409 global_admin で、何も残らない", async () => {
    // ほかの部署のオーナーが、この部署に所属している（部署のオーナーは1部署に1人のため）
    await env.DB.prepare("UPDATE users SET department_id = ? WHERE id = ?")
      .bind(deptA.id, ownerB)
      .run();
    const tokenA = await sessionFor(ownerA);
    for (const who of [ownerA, ownerB]) {
      const res = await submit(tokenA, who);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        code: "CONFLICT",
        reason: "department_owner",
      });
    }
    await env.DB.prepare("UPDATE users SET department_id = ? WHERE id = ?")
      .bind(deptB.id, ownerB)
      .run();
    const res = await submit(await sessionFor(ownerB), admin);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: "CONFLICT",
      reason: "global_admin",
    });
    expect(await retirementRows()).toEqual([]);
    expect(await retirementNotifications()).toEqual([]);
  });

  it.each([
    ["再認証していない", null],
    ["再認証から11分経った", 11 * 60_000],
  ])(
    "#128 0-1 AC-20: %sオーナーの申請は 403 REAUTH_REQUIRED で、申請も通知も残らない",
    async (_label, ago) => {
      const res = await submit(await sessionFor(ownerA, ago), target);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "REAUTH_REQUIRED" });
      expect(await retirementRows()).toEqual([]);
      expect(await retirementNotifications()).toEqual([]);
    },
  );

  it.each([
    ["targetUserId がない", {}],
    ["targetUserId が ULID でない", { targetUserId: "not-a-ulid" }],
    [
      "知らない項目がある",
      { targetUserId: "01JTEST128CN0NE00000000001", extra: 1 },
    ],
  ])("#128 0-1 AC-20: 本文の形が違えば（%s）422", async (_label, body) => {
    const token = await sessionFor(ownerA);
    const res = await request("POST", BASE, { token, body });
    expect(res.status).toBe(422);
    expect(await retirementRows()).toEqual([]);
  });

  it("#128 C-177（U-2）: 同じ対象への申請中の申請があると、2件目は 409 CONFLICT（reason は最上位で duplicate_pending）", async () => {
    const token = await sessionFor(ownerA);
    expect((await submit(token, target)).status).toBe(201);
    const second = await submit(token, target);
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({
      code: "CONFLICT",
      reason: "duplicate_pending",
    });
    expect(await retirementRows()).toHaveLength(1);
  });

  it("#128 0-1 AC-20: ログインしていなければ、作成・自分の申請・取り下げ・管理の一覧・却下はすべて 401", async () => {
    expect(
      (await request("POST", BASE, { body: { targetUserId: target } })).status,
    ).toBe(401);
    expect((await request("GET", `${BASE}/mine`)).status).toBe(401);
    expect(
      (await request("POST", `${BASE}/${MISSING_ID}/withdraw`)).status,
    ).toBe(401);
    expect((await request("GET", `${ADMIN_BASE}?status=pending`)).status).toBe(
      401,
    );
    expect(
      (
        await request("POST", `${ADMIN_BASE}/${MISSING_ID}/reject`, {
          body: { reason: REASON },
        })
      ).status,
    ).toBe(401);
  });
});

describe("#128（128-c）3-4 AC-1〜3 通知の宛先（HTTP）", () => {
  it("#128 3-4 AC-1・AC-3: 申請の提出は全体管理者だけに retirement_request.submitted が届き、申請者・対象・一般社員・ほかの部署のオーナーには届かない", async () => {
    const token = await sessionFor(ownerA);
    const res = await submit(token, target);
    const { id } = (await res.json()) as { id: string };
    expect(await retirementNotifications()).toEqual([
      {
        user_id: admin,
        kind: "retirement_request.submitted",
        room_id: null,
        message_id: null,
        target_id: id,
      },
    ]);
  });

  it("#128 3-4 AC-2・AC-3: 却下は申請者だけに retirement_request.rejected が届く", async () => {
    const requestId = await insertRetirementRequest({
      targetUserId: target,
      requestedBy: ownerA,
      departmentId: deptA.id,
    });
    const res = await reject(await sessionFor(admin), requestId);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: requestId,
      status: "rejected",
    });
    expect(await retirementNotifications()).toEqual([
      {
        user_id: ownerA,
        kind: "retirement_request.rejected",
        room_id: null,
        message_id: null,
        target_id: requestId,
      },
    ]);
  });

  it("#128 0-1 AC-20・3-4 AC-2・C-177（U-3）: 全体管理者が無効化すると、申請は完了になり、申請者だけに retirement_request.approved が届く。対象は無効になる", async () => {
    const requestId = await insertRetirementRequest({
      targetUserId: target,
      requestedBy: ownerA,
      departmentId: deptA.id,
    });
    const res = await request(
      "POST",
      `/api/admin/accounts/${target}/deactivate`,
      { token: await sessionFor(admin) },
    );
    expect(res.status).toBe(204);
    expect((await retirementRow(requestId)).status).toBe("approved");
    expect(await stateOf(target)).toMatchObject({ is_active: 0 });
    expect(await retirementNotifications()).toEqual([
      {
        user_id: ownerA,
        kind: "retirement_request.approved",
        room_id: null,
        message_id: null,
        target_id: requestId,
      },
    ]);
  });

  it("#128 C-177（U-1）: 取り下げは通知しない", async () => {
    const requestId = await insertRetirementRequest({
      targetUserId: target,
      requestedBy: ownerA,
      departmentId: deptA.id,
    });
    const res = await withdraw(await sessionFor(ownerA), requestId);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: requestId,
      status: "withdrawn",
    });
    expect(await retirementNotifications()).toEqual([]);
  });
});

describe("#128（128-c）C-177（U-1・U-8）一覧・却下・取り下げの認可と存在の非開示（HTTP）", () => {
  let requestId: string;
  beforeEach(async () => {
    requestId = await insertRetirementRequest({
      targetUserId: target,
      requestedBy: ownerA,
      departmentId: deptA.id,
    });
  });

  it("#128 C-177（U-8）: 全体管理者の一覧は、pending の申請の対象の表示名・部署・申請者・日時を返し、本名・メールを含まない", async () => {
    const res = await request("GET", `${ADMIN_BASE}?status=pending`, {
      token: await sessionFor(admin),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Record<string, unknown>[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: requestId,
      status: "pending",
      target: { id: target, displayName: "テスト太郎" },
      department: { id: deptA.id },
      requester: { id: ownerA },
      createdAt: expect.any(String) as string,
    });
    const text = JSON.stringify(body);
    expect(text).not.toContain("@example.com");
    expect(text).not.toContain("legalName");
    expect(text).not.toContain("v1:");
  });

  it.each([
    ["申請したオーナー", () => ownerA],
    ["ほかの部署のオーナー", () => ownerB],
    ["一般社員", () => member],
  ])(
    "#128 C-177（U-8）: %sは管理の一覧が 403 で、却下も、申請があってもなくても同じ 403",
    async (_label, who) => {
      const token = await sessionFor(who());
      expect(
        (await request("GET", `${ADMIN_BASE}?status=pending`, { token }))
          .status,
      ).toBe(403);
      const existing = await reject(token, requestId);
      const missing = await reject(token, MISSING_ID);
      expect(existing.status).toBe(403);
      expect(missing.status).toBe(403);
      expect(await existing.json()).toEqual(await missing.json());
      expect((await retirementRow(requestId)).status).toBe("pending");
    },
  );

  it("#128 C-177（U-1）: 自分の申請の一覧は申請者だけに見え、ほかの部署のオーナー・全体管理者の「自分の申請」には出ない", async () => {
    const mine = await request("GET", `${BASE}/mine`, {
      token: await sessionFor(ownerA),
    });
    expect(mine.status).toBe(200);
    const items = ((await mine.json()) as { items: { id: string }[] }).items;
    expect(items.map((i) => i.id)).toEqual([requestId]);
    for (const who of [ownerB, admin]) {
      const other = await request("GET", `${BASE}/mine`, {
        token: await sessionFor(who),
      });
      expect(((await other.json()) as { items: unknown[] }).items).toEqual([]);
    }
  });

  it("#128 C-177（U-1）: 却下の理由は、申請者の「自分の申請」と全体管理者の一覧で見られる", async () => {
    await reject(await sessionFor(admin), requestId);
    const mine = await request("GET", `${BASE}/mine`, {
      token: await sessionFor(ownerA),
    });
    expect(
      ((await mine.json()) as { items: Record<string, unknown>[] }).items[0],
    ).toMatchObject({ status: "rejected", decisionReason: REASON });
    const list = await request("GET", `${ADMIN_BASE}?status=rejected`, {
      token: await sessionFor(admin),
    });
    expect(
      ((await list.json()) as { items: Record<string, unknown>[] }).items[0],
    ).toMatchObject({ id: requestId, decisionReason: REASON });
  });

  it("#128 C-177（U-1）: 他人の申請の取り下げは、存在しない申請と同じ 404 で、申請は変わらない", async () => {
    for (const who of [ownerB, admin]) {
      const token = await sessionFor(who);
      const existing = await withdraw(token, requestId);
      const missing = await withdraw(token, MISSING_ID);
      expect(existing.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(await existing.json()).toEqual(await missing.json());
    }
    expect((await retirementRow(requestId)).status).toBe("pending");
  });

  it.each([
    ["再認証していない", null],
    ["再認証から11分経った", 11 * 60_000],
  ])(
    "#128 C-177（U-1）: %s全体管理者の却下は 403 REAUTH_REQUIRED で、申請は変わらず通知もない",
    async (_label, ago) => {
      const res = await reject(await sessionFor(admin, ago), requestId);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "REAUTH_REQUIRED" });
      expect((await retirementRow(requestId)).status).toBe("pending");
      expect(await retirementNotifications()).toEqual([]);
    },
  );

  it("#128 C-177（U-1）: 取り下げは再認証していなくてもできる", async () => {
    const res = await withdraw(await sessionFor(ownerA, null), requestId);
    expect(res.status).toBe(200);
    expect((await retirementRow(requestId)).status).toBe("withdrawn");
  });

  it("#128 C-177（U-1）: 処理済みの申請の取り下げ・却下は 409 CONFLICT（reason＝not_pending）", async () => {
    expect((await withdraw(await sessionFor(ownerA), requestId)).status).toBe(
      200,
    );
    const again = await withdraw(await sessionFor(ownerA), requestId);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({
      code: "CONFLICT",
      reason: "not_pending",
    });
    const rejected = await reject(await sessionFor(admin), requestId);
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({ reason: "not_pending" });
  });

  it.each<[string, number, unknown]>([
    ["空", 422, ""],
    ["空白だけ", 422, "   "],
    ["201文字", 422, "あ".repeat(201)],
    ["文字列でない", 422, 1],
    ["200文字（上限）", 200, "あ".repeat(200)],
    ["1文字（下限）", 200, "あ"],
  ])(
    "#128 C-177（U-1）: 却下の理由が%sなら %i",
    async (_label, status, reason) => {
      const res = await reject(await sessionFor(admin), requestId, reason);
      expect(res.status).toBe(status);
      expect((await retirementRow(requestId)).status).toBe(
        status === 200 ? "rejected" : "pending",
      );
    },
  );
});

describe("#128（128-c）C-177（U-8）社員一覧の申請ボタンの出し分けの値（HTTP）", () => {
  // ほかのテストのデータに左右されないよう、このテストの2部署に絞って読む
  async function flags(userId: string) {
    const token = await sessionFor(userId);
    const map = new Map<string, boolean>();
    for (const dept of [deptA, deptB]) {
      const res = await request(
        "GET",
        `/api/users?limit=100&departmentId=${dept.id}`,
        { token },
      );
      expect(res.status).toBe(200);
      const items = (
        (await res.json()) as {
          items: { id: string; canRequestRetirement: boolean }[];
        }
      ).items;
      for (const i of items) map.set(i.id, i.canRequestRetirement);
    }
    return map;
  }

  it("#128 C-177（U-8）: 自分の部署のオーナーには、自部署の他の社員の行だけ canRequestRetirement が true（自分・ほかの部署の行は false）", async () => {
    const map = await flags(ownerA);
    expect(map.get(target)).toBe(true);
    expect(map.get(member)).toBe(true);
    expect(map.get(ownerA)).toBe(false);
    expect(map.get(ownerB)).toBe(false);
    expect(map.get(admin)).toBe(false);
    // 無効な社員は一覧に出ない
    expect(map.has(gone)).toBe(false);
  });

  it("#128 C-177（U-8）: 申請中の申請がある社員の行も true のまま（押すと 409）。自部署に所属するオーナーの行は false", async () => {
    await insertRetirementRequest({
      targetUserId: target,
      requestedBy: ownerA,
      departmentId: deptA.id,
    });

    await env.DB.prepare("UPDATE users SET department_id = ? WHERE id = ?")
      .bind(deptA.id, ownerB)
      .run();
    const map = await flags(ownerA);
    expect(map.get(target)).toBe(true);
    expect(map.get(ownerB)).toBe(false);
  });

  it.each([
    ["一般社員", () => member],
    ["その部署のオーナーでない全体管理者", () => admin],
  ])(
    "#128 C-177（U-8）: %sには、どの行も canRequestRetirement が false",
    async (_label, who) => {
      const map = await flags(who());
      expect(map.size).toBeGreaterThan(0);
      expect([...map.values()].every((v) => v === false)).toBe(true);
    },
  );
});
