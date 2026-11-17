// #156（0-6 AC-1〜AC-6・S-25）: 監査ログの閲覧の API を、実際の入口（index.ts の app）と隔離 D1 で確かめる。
// 契約（実装前の仮置き。計画 #156）：
//   POST /api/admin/audit-logs/search（本文は .strict()：from・to（JST の日付 YYYY-MM-DD。暦にない日付は 422。from > to は fields: ["to"]）・actorId（ULID）・
//     action（AUDIT_ACTIONS のどれか）・targetType（user・department・client・channel・channel_request・message・source）と targetId（ULID。組で指定。片方だけは 422）・
//     result（success・failure）・cursor・limit（1〜100。既定 20））
//   → 200（Cache-Control: no-store）{ items: AuditLogItem[], nextCursor: string | null }。AuditLogItem の形は services/audit-log.service.test.ts の契約。
//   判定の順：認証（401）→ 送信元の確認（403）→ 全体管理者のミドルウェア（403。入力の検証より先）→ 入力の検証（422）→ 閲覧の記録と取得（同じ batch）。
//   変更・削除・書き出しの API は作らない（PUT・PATCH・DELETE、GET /export は 404。0-6 AC-4・R-16）。429 は作らない。
// 判定の順の細部は Service・DB のテストで確かめる。ここでは HTTP の認可・応答の形・非開示・閲覧の記録だけを確かめる。
// データは架空（testuser_156r_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUDIT_TRACE_PREFIX,
  auditId,
  cleanupAuditLogTestData,
  insertAuditLog,
  remainingAuditTestRows,
  viewRecords,
} from "../../test/audit-log-fixtures";
import { apiRequest, insertReadyUser } from "../../test/api-request";
import {
  AUTH_TRACE_PREFIX,
  cleanupAuthTestData,
} from "../../test/auth-fixtures";
import {
  cleanupDepartmentTestData,
  makeGlobalAdmin,
  makeOwner,
} from "../../test/department-fixtures";
import { insertDepartment, insertUser } from "../../test/role-fixtures";

const PATH = "/api/admin/audit-logs/search";
const SECRET = "[UNIT_TEST]plain-secret-value";
const ROOM_ID = "01JTEST156RT00M1D000000001";

let deptId: string;
let admin: { userId: string; token: string };
let owner: { userId: string; token: string };
let member: { userId: string; token: string };
let actorA: string;
let targetUser: string;

const search = (token: string | null, body: unknown = {}) =>
  apiRequest("POST", PATH, { token, body });

function seed(
  n: number,
  occurredAt: string,
  extra: Record<string, unknown> = {},
) {
  return insertAuditLog({
    id: auditId(n),
    occurredAt,
    actorId: actorA,
    action: "account.create",
    targetType: "user",
    targetId: targetUser,
    ...extra,
  });
}

beforeEach(async () => {
  const capture = () => undefined;
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  deptId = await insertDepartment("156結合");
  admin = await insertReadyUser("testuser_156r_admin", deptId);
  owner = await insertReadyUser("testuser_156r_owner", deptId);
  member = await insertReadyUser("testuser_156r_member", deptId);
  await makeGlobalAdmin(admin.userId);
  await makeOwner(owner.userId, deptId);
  actorA = await insertUser("testuser_156r_actora", deptId);
  targetUser = await insertUser("testuser_156r_target", deptId);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupAuditLogTestData();
  await cleanupAuthTestData();
  await cleanupDepartmentTestData();
  expect(await remainingAuditTestRows()).toBe(0);
});

describe("#156 0-6 AC-1: 閲覧できるのは全体管理者だけ（HTTP）", () => {
  it("#156 0-6 AC-1: 全体管理者は 200 で { items, nextCursor } を受け取り、no-store", async () => {
    await seed(1, "2031-03-04T01:00:00.000Z");
    const res = await search(admin.token, { actorId: actorA });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as {
      items: unknown[];
      nextCursor: unknown;
    };
    expect(Object.keys(body).sort()).toEqual(["items", "nextCursor"]);
    expect(body.items).toHaveLength(1);
    expect(body.nextCursor).toBeNull();
  });

  it("#156 0-6 AC-1: 未ログインは 401 UNAUTHENTICATED で、何も記録しない", async () => {
    const res = await search(null);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(await viewRecords()).toEqual([]);
  });

  it.each([
    ["部署のオーナー", () => owner],
    ["一般メンバー", () => member],
  ])(
    "#156 0-6 AC-1: %sは 403 FORBIDDEN で、一覧を返さず、閲覧の記録も残らない",
    async (_label, who) => {
      await seed(1, "2031-03-04T01:00:00.000Z");
      const res = await search(who().token, { actorId: actorA });
      expect(res.status).toBe(403);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ code: "FORBIDDEN" });
      expect(body).not.toHaveProperty("items");
      expect(JSON.stringify(body)).not.toContain("testuser_156r_");
      expect(await viewRecords()).toEqual([]);
    },
  );

  it.each([
    ["暦にない日付", { from: "2026-02-30" }],
    ["未知の項目", { unknown: 1 }],
    ["未知の操作", { action: "account.hack" }],
    ["片方だけの対象", { targetType: "user" }],
    ["範囲外の件数", { limit: 1000 }],
    ["壊れたカーソル", { cursor: "broken!!" }],
  ])(
    "#156 0-6 AC-1: 入力が不正（%s）でも、全体管理者でなければ 422 ではなく 403（権限のない人に入力の規則を教えない）",
    async (_label, body) => {
      for (const who of [owner, member]) {
        const res = await search(who.token, body);
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ code: "FORBIDDEN" });
      }
      expect(await viewRecords()).toEqual([]);
    },
  );

  it("#156 0-6 AC-1: 許可されていない送信元からの要求は、全体管理者でも 403 で、記録も取得もしない", async () => {
    const res = await apiRequest("POST", PATH, {
      token: admin.token,
      origin: "https://origin.invalid",
      body: {},
    });
    expect(res.status).toBe(403);
    expect(await res.json()).not.toHaveProperty("items");
    expect(await viewRecords()).toEqual([]);
  });
});

describe("#156 0-6 AC-2・AC-5: 応答の形と、出さないもの（HTTP）", () => {
  it("#156 0-6 AC-2: 行は、日時・操作・結果・操作した人・対象を持ち、新しい順に並ぶ", async () => {
    await env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?")
      .bind("testuser_156r_表示A", actorA)
      .run();
    await seed(1, "2031-03-04T01:00:00.000Z");
    await seed(2, "2031-03-04T02:00:00.000Z", { result: "failure" });
    const res = await search(admin.token, { actorId: actorA });
    const { items } = (await res.json()) as {
      items: Record<string, unknown>[];
    };
    expect(items.map((i) => i.id)).toEqual([auditId(2), auditId(1)]);
    expect(items[1]).toMatchObject({
      id: auditId(1),
      occurredAt: "2031-03-04T01:00:00.000Z",
      action: "account.create",
      result: "success",
      actor: { id: actorA, displayName: "testuser_156r_表示A", isActive: true },
      target: { type: "user", id: targetUser },
    });
    expect(items[0]).toMatchObject({ result: "failure" });
  });

  it("#156 0-6 AC-2・AC-7: アカウント登録の失敗の行は、対象の社員を出さず、エラー分類と対象件数を出す", async () => {
    await seed(1, "2031-03-04T01:00:00.000Z", {
      result: "failure",
      targetId: null,
      detail: JSON.stringify({
        failureCategory: "validation",
        affectedCount: 4,
      }),
    });
    const { items } = (await (
      await search(admin.token, { actorId: actorA })
    ).json()) as { items: Record<string, unknown>[] };
    expect(items[0]).toMatchObject({
      action: "account.create",
      result: "failure",
      target: null,
      failureCategory: "validation",
      affectedCount: 4,
    });
  });

  it("#156 0-6 AC-2・AC-5: 応答に、本名・メール・社員ID・trace_id・detail の原文・秘密の値・ほかの項目（roomId）を含めない", async () => {
    await seed(1, "2031-03-04T01:00:00.000Z", {
      action: "message.delete",
      targetType: "message",
      targetId: "01JTEST156RTMSG00000000001",
      detail: JSON.stringify({
        reason: "policy",
        roomId: ROOM_ID,
        password: SECRET,
        newPassword: SECRET,
      }),
    });
    const res = await search(admin.token, { actorId: actorA });
    const text = await res.text();
    for (const forbidden of [
      SECRET,
      ROOM_ID,
      "@example.com",
      "testuser_156r_actora", // 社員ID（login_id）
      "v1:", // 本名の暗号文
      AUDIT_TRACE_PREFIX,
      '"detail"',
      '"traceId"',
      '"legalName"',
      '"email"',
      '"loginId"',
    ])
      expect(text, forbidden).not.toContain(forbidden);
    expect(text).toContain("policy"); // 決めた項目（reason）は出す
  });
});

describe("#156 0-6 AC-3: 入力の検証（HTTP。全体管理者）", () => {
  it.each<[string, Record<string, unknown>, string[] | null]>([
    ["暦にない日付（from）", { from: "2026-02-30" }, ["from"]],
    ["日付の形が違う（from）", { from: "2026-1-1" }, ["from"]],
    ["日付ではない値（to）", { to: "2026-13-01" }, ["to"]],
    ["時刻つきの値（to）", { to: "2026-11-16T00:00:00Z" }, ["to"]],
    ["from が to より後", { from: "2026-11-17", to: "2026-11-16" }, ["to"]],
    ["未知の操作（action）", { action: "account.hack" }, ["action"]],
    [
      "未知の対象の種類",
      { targetType: "table", targetId: "01JTEST156RTTGT00000000001" },
      ["targetType"],
    ],
    [
      "対象の ID が ULID でない",
      { targetType: "user", targetId: "x" },
      ["targetId"],
    ],
    ["操作者の ID が ULID でない", { actorId: "x" }, ["actorId"]],
    ["未知の結果（result）", { result: "unknown" }, ["result"]],
    ["件数が0", { limit: 0 }, ["limit"]],
    ["件数が上限（100）を超える", { limit: 101 }, ["limit"]],
    ["件数が数でない", { limit: "abc" }, ["limit"]],
    ["壊れたカーソル", { cursor: "broken!!" }, ["cursor"]],
    ["対象の種類だけ", { targetType: "user" }, null],
    ["対象の ID だけ", { targetId: "01JTEST156RTTGT00000000001" }, null],
    ["余分な項目", { unknown: 1 }, null],
  ])(
    "#156 0-6 AC-3: %sは 422 VALIDATION_ERROR で、閲覧の記録を残さない",
    async (_label, body, fields) => {
      const res = await search(admin.token, body);
      expect(res.status).toBe(422);
      const json = (await res.json()) as { code: string; fields?: string[] };
      expect(json.code).toBe("VALIDATION_ERROR");
      if (fields !== null) expect(json.fields).toEqual(fields);
      expect(json).not.toHaveProperty("items");
      expect(await viewRecords()).toEqual([]);
    },
  );

  it("#156 0-6 AC-3: 境界の値（from と to が同じ日・件数 1 と 100・存在する操作）は受け付ける", async () => {
    for (const body of [
      {},
      { from: "2026-11-16", to: "2026-11-16" },
      { limit: 1 },
      { limit: 100 },
      { action: "audit_log.view" },
      { result: "failure" },
      { targetType: "source", targetId: "01JTEST156RTTGT00000000001" },
    ])
      expect(
        (await search(admin.token, body)).status,
        JSON.stringify(body),
      ).toBe(200);
  });

  it("#156 0-6 AC-3: 続き（nextCursor）で、重複も抜けもなく読め、ページごとに閲覧の記録が残る（first・next・next）", async () => {
    for (let n = 1; n <= 25; n += 1)
      await seed(n, `2031-03-04T01:00:${String(n).padStart(2, "0")}.000Z`);
    const read = async (cursor?: string) =>
      (await (
        await search(admin.token, { actorId: actorA, limit: 10, cursor })
      ).json()) as { items: { id: string }[]; nextCursor: string | null };
    const p1 = await read();
    const p2 = await read(p1.nextCursor ?? "");
    const p3 = await read(p2.nextCursor ?? "");
    expect([p1.items.length, p2.items.length, p3.items.length]).toEqual([
      10, 10, 5,
    ]);
    expect(p3.nextCursor).toBeNull();
    const all = [...p1.items, ...p2.items, ...p3.items].map((i) => i.id);
    expect(all).toEqual(Array.from({ length: 25 }, (_, i) => auditId(25 - i)));
    const pages = (await viewRecords(admin.userId)).map(
      (r) => (JSON.parse(r.detail ?? "{}") as { page: string }).page,
    );
    expect(pages).toEqual(["first", "next", "next"]);
  });
});

describe("#156 0-6 AC-4: 変更・削除・書き出しの API がない（HTTP）", () => {
  const routes: [string, string][] = [
    ["PUT", "/api/admin/audit-logs"],
    ["PATCH", "/api/admin/audit-logs"],
    ["DELETE", "/api/admin/audit-logs"],
    ["PUT", `/api/admin/audit-logs/${auditId(1)}`],
    ["PATCH", `/api/admin/audit-logs/${auditId(1)}`],
    ["DELETE", `/api/admin/audit-logs/${auditId(1)}`],
    ["PUT", PATH],
    ["PATCH", PATH],
    ["DELETE", PATH],
    ["GET", "/api/admin/audit-logs/export"],
    ["POST", "/api/admin/audit-logs/export"],
    ["GET", "/api/admin/audit-logs"],
    ["GET", PATH],
  ];

  it.each(routes)(
    "#156 0-6 AC-4: %s %s は、全体管理者でも 404（ルートがない）で、監査ログは変わらない",
    async (method, path) => {
      await seed(1, "2031-03-04T01:00:00.000Z", {
        detail: '{"reason":"keep"}',
      });
      const before = await env.DB.prepare(
        "SELECT * FROM audit_logs WHERE id = ?",
      )
        .bind(auditId(1))
        .first();
      const res = await apiRequest(method, path, {
        token: admin.token,
        body: method === "GET" ? undefined : {},
      });
      expect(res.status).toBe(404);
      expect(
        await env.DB.prepare("SELECT * FROM audit_logs WHERE id = ?")
          .bind(auditId(1))
          .first(),
      ).toEqual(before);
    },
  );

  it.each(routes)(
    "#156 0-6 AC-4（R-16）: %s %s は、オーナー・一般メンバーでも成功せず（403 か 404）、監査ログは変わらない",
    async (method, path) => {
      await seed(1, "2031-03-04T01:00:00.000Z");
      for (const who of [owner, member]) {
        const res = await apiRequest(method, path, {
          token: who.token,
          body: method === "GET" ? undefined : {},
        });
        expect([403, 404]).toContain(res.status);
      }
      const count = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM audit_logs WHERE id = ?",
      )
        .bind(auditId(1))
        .first<{ n: number }>();
      expect(count?.n).toBe(1);
    },
  );
});

describe("#156 0-6 AC-6: 閲覧の記録（HTTP）", () => {
  it("#156 0-6 AC-6: 検索に成功すると、閲覧した人・操作（audit_log.view）・成功・絞り込みの種類と期間が、平らな detail で1件記録される。絞り込みの ID は残らない", async () => {
    const res = await search(admin.token, {
      from: "2031-03-04",
      to: "2031-03-05",
      action: "account.create",
      result: "success",
      actorId: actorA,
    });
    expect(res.status).toBe(200);
    const records = await viewRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      actor_id: admin.userId,
      action: "audit_log.view",
      target_type: "audit_log",
      target_id: null,
      result: "success",
    });
    // 要求の X-Request-Id（apiRequest が AUTH_TRACE_PREFIX を付ける）
    expect(records[0]?.trace_id.startsWith(AUTH_TRACE_PREFIX)).toBe(true);
    expect(JSON.parse(records[0]?.detail ?? "null")).toEqual({
      page: "first",
      filterAction: "account.create",
      filterResult: "success",
      filterTargetType: null,
      hasActor: true,
      hasTarget: false,
      from: "2031-03-04",
      to: "2031-03-05",
    });
    expect(records[0]?.detail).not.toContain(actorA);
  });

  it("#156 0-6 AC-6: 自分の閲覧も一覧に出る（操作 audit_log.view で絞り込むと、いまの閲覧の記録が見える）", async () => {
    const res = await search(admin.token, { action: "audit_log.view" });
    const { items } = (await res.json()) as {
      items: { action: string; actor: { id: string } | null; result: string }[];
    };
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      action: "audit_log.view",
      result: "success",
      actor: { id: admin.userId },
    });
  });

  it("#156 0-6 AC-6: 閲覧の記録は、検索のたびに1件ずつ増える（同じ検索を2回で2件）", async () => {
    await search(admin.token);
    await search(admin.token);
    expect(await viewRecords(admin.userId)).toHaveLength(2);
  });
});
