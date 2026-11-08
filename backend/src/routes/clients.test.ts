// #192: 5-7 の管理 API を実際のアプリ入口と隔離 D1 で検証する。
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
import { newPiiKey, newSetupToken } from "../../test/random-secrets";
import {
  cleanupRoleTestData,
  insertAssignment,
  insertDepartment,
  insertUser,
} from "../../test/role-fixtures";
import { loadConfig } from "../config";
import { app } from "../index";
import { ROLE_IDS } from "../lib/permissions";

const ORIGIN = loadConfig(env).allowedOrigins[0] ?? "";
const BASE = "/api/admin/clients";
const valid = { code: "ABC", name: "[UNIT_TEST]取引先A" };
let throttleKey: string;
let adminToken: string;
let ownerToken: string;
let memberToken: string;
const createdIds = new Set<string>();

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
  const response = await app.request(
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
  if (method === "POST" && path === BASE && response.status === 201) {
    const dto = (await response.clone().json()) as { id?: unknown };
    if (typeof dto.id === "string") createdIds.add(dto.id);
  }
  return response;
}

beforeEach(async () => {
  throttleKey = newThrottleKey();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const department = await insertDepartment("取引先テスト部署");
  const admin = await insertUser("testuser_client_admin", department);
  const owner = await insertUser("testuser_client_owner", department);
  const member = await insertUser("testuser_client_member", department);
  await env.DB.prepare(
    "UPDATE users SET must_change_password = 0 WHERE id IN (?, ?, ?)",
  )
    .bind(admin, owner, member)
    .run();
  await insertAssignment(admin, ROLE_IDS.globalAdmin, "company", null);
  await insertAssignment(owner, ROLE_IDS.owner, "department", department);
  await insertAssignment(member, ROLE_IDS.member, "company", null);
  const now = new Date().toISOString();
  adminToken = (await insertSession(admin, { createdAt: now })).token;
  ownerToken = (await insertSession(owner, { createdAt: now })).token;
  memberToken = (await insertSession(member, { createdAt: now })).token;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupAuthTestData();
  for (const id of createdIds) {
    await env.DB.prepare("DELETE FROM audit_logs WHERE target_id = ?")
      .bind(id)
      .run();
    await env.DB.prepare("DELETE FROM clients WHERE id = ?").bind(id).run();
  }
  createdIds.clear();
  await cleanupRoleTestData();
});

describe("#192 取引先管理 API", () => {
  it("#192 AC-1（5-7 AC-1）: 未認証の登録は401で何も登録しない", async () => {
    const response = await request("POST", BASE, { body: valid });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it.each([
    ["オーナー", () => ownerToken],
    ["一般社員", () => memberToken],
  ])("#192 AC-1（5-7 AC-1）: %sは登録できず403", async (_label, token) => {
    const response = await request("POST", BASE, {
      token: token(),
      body: valid,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
  });

  it("#192 AC-1（5-7 AC-1）: 許可外Originの登録は403", async () => {
    const response = await request("POST", BASE, {
      token: adminToken,
      body: valid,
      origin: "https://origin.invalid",
    });
    expect(response.status).toBe(403);
  });

  it("#192 AC-2（5-7 AC-2・AC-6）: 英大文字3文字のコードと1文字の名前を登録できる", async () => {
    const response = await request("POST", BASE, {
      token: adminToken,
      body: { code: "ABC", name: "A" },
    });
    expect(response.status).toBe(201);
  });

  it.each([
    ["2文字", "AB"],
    ["4文字", "ABCD"],
    ["小文字", "AbC"],
    ["数字", "AB1"],
  ])("#192 AC-2（5-7 AC-2）: コード%sは422", async (_label, code) => {
    const response = await request("POST", BASE, {
      token: adminToken,
      body: { code, name: valid.name },
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["code"],
    });
  });

  it.each([
    ["空", ""],
    ["空白のみ", "   "],
    ["51文字", "A".repeat(51)],
  ])("#192 AC-2（5-7 AC-6）: 名前%sは422", async (_label, name) => {
    const response = await request("POST", BASE, {
      token: adminToken,
      body: { code: "ABC", name },
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["name"],
    });
  });

  it("#192 AC-2（5-7 AC-6）: 50文字の名前を登録できる", async () => {
    const response = await request("POST", BASE, {
      token: adminToken,
      body: { code: "ABC", name: "A".repeat(50) },
    });
    expect(response.status).toBe(201);
  });

  it("#192 AC-2（5-7 AC-7）: 前後空白と大小文字だけが違う名前は重複409", async () => {
    expect(
      (
        await request("POST", BASE, {
          token: adminToken,
          body: { code: "ABC", name: " Sample " },
        })
      ).status,
    ).toBe(201);
    const response = await request("POST", BASE, {
      token: adminToken,
      body: { code: "DEF", name: "sample" },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "CONFLICT" });
  });

  it("#192 AC-3（5-7 AC-3）: 名前変更にcodeを混ぜると422でコードを変更しない", async () => {
    const created = await request("POST", BASE, {
      token: adminToken,
      body: valid,
    });
    expect(created.status).toBe(201);
    const client = (await created.json()) as { id: string; version: number };
    const response = await request("PATCH", `${BASE}/${client.id}`, {
      token: adminToken,
      body: { name: "変更後", version: client.version, code: "DEF" },
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["code"],
    });
  });

  it("#192 AC-4（5-7 AC-10）: INTの無効化は拒否する", async () => {
    const list = await request("GET", BASE, { token: adminToken });
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      items: { id: string; code: string; version: number }[];
    };
    const internal = body.items.find((client) => client.code === "INT");
    expect(internal).toBeDefined();
    const response = await request("PATCH", `${BASE}/${internal!.id}/status`, {
      token: adminToken,
      body: { active: false, version: internal!.version },
    });
    expect(response.status).toBe(409);
  });
});

describe("#192 取引先の読取契約", () => {
  it("#192 AC-2・AC-3（5-7 AC-2・AC-3）: 登録は管理DTOを返し、改名はコード不変で版を進める", async () => {
    const created = await request("POST", BASE, {
      token: adminToken,
      body: valid,
    });
    expect(created.status).toBe(201);
    const first = (await created.json()) as {
      id: string;
      code: string;
      name: string;
      active: boolean;
      version: number;
    };
    expect(first).toEqual({
      id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
      code: "ABC",
      name: valid.name,
      active: true,
      version: 1,
    });
    const changed = await request("PATCH", `${BASE}/${first.id}`, {
      token: adminToken,
      body: { name: "[UNIT_TEST]改名後", version: 1 },
    });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toEqual({
      ...first,
      name: "[UNIT_TEST]改名後",
      version: 2,
    });
  });

  it("#192 AC-1・AC-6（5-7 AC-1・AC-4）: 社員の一覧には無効行もあり、申請候補には有効行だけがある", async () => {
    const created = await request("POST", BASE, {
      token: adminToken,
      body: valid,
    });
    expect(created.status).toBe(201);
    const first = (await created.json()) as {
      id: string;
      code: string;
      name: string;
      active: boolean;
      version: number;
    };
    const deactivated = await request("PATCH", `${BASE}/${first.id}/status`, {
      token: adminToken,
      body: { active: false, version: first.version },
    });
    expect(deactivated.status).toBe(200);
    expect(await deactivated.json()).toEqual({
      ...first,
      active: false,
      version: 2,
    });

    const visible = await request("GET", "/api/clients", {
      token: memberToken,
    });
    expect(visible.status).toBe(200);
    const visibleBody = (await visible.json()) as {
      items: { id: string; code: string; name: string; active: boolean }[];
      nextCursor: string | null;
    };
    expect(visibleBody).toEqual({
      items: expect.arrayContaining([
        { id: first.id, code: first.code, name: first.name, active: false },
      ]),
      nextCursor: null,
    });

    const candidates = await request("GET", "/api/clients/candidates", {
      token: memberToken,
    });
    expect(candidates.status).toBe(200);
    const candidateBody = (await candidates.json()) as {
      items: { id: string; code: string; name: string }[];
      nextCursor: string | null;
    };
    expect(candidateBody.items).not.toContainEqual({
      id: first.id,
      code: first.code,
      name: first.name,
    });
    expect(candidateBody.items).toContainEqual({
      id: expect.any(String),
      code: "INT",
      name: expect.any(String),
    });
  });
  it("#192 AC-2・AC-3・AC-4・AC-8: 成功した登録・改名・無効化の監査に主体と追跡IDと版を記録する", async () => {
    const created = await request("POST", BASE, {
      token: adminToken,
      body: valid,
    });
    expect(created.status).toBe(201);
    const first = (await created.json()) as { id: string; version: number };
    const renamed = await request("PATCH", BASE + "/" + first.id, {
      token: adminToken,
      body: { name: "[UNIT_TEST]監査後の名前", version: first.version },
    });
    expect(renamed.status).toBe(200);
    const second = (await renamed.json()) as { version: number };
    const deactivated = await request(
      "PATCH",
      BASE + "/" + first.id + "/status",
      {
        token: adminToken,
        body: { active: false, version: second.version },
      },
    );
    expect(deactivated.status).toBe(200);
    const rows = await env.DB.prepare(
      "SELECT action, actor_id AS actorId, target_type AS targetType, target_id AS targetId, result, trace_id AS traceId, detail FROM audit_logs WHERE target_id = ? AND action IN ('client.create', 'client.rename', 'client.deactivate')",
    )
      .bind(first.id)
      .all<{
        action: string;
        actorId: string | null;
        targetType: string;
        targetId: string | null;
        result: string;
        traceId: string;
        detail: string | null;
      }>();
    expect(rows.results).toHaveLength(3);
    const byAction = new Map(rows.results.map((row) => [row.action, row]));
    for (const action of [
      "client.create",
      "client.rename",
      "client.deactivate",
    ]) {
      expect(byAction.get(action)).toMatchObject({
        action,
        actorId: expect.any(String),
        targetType: "client",
        targetId: first.id,
        result: "success",
        traceId: expect.stringContaining(AUTH_TRACE_PREFIX),
      });
    }
    expect(new Set(rows.results.map((row) => row.actorId)).size).toBe(1);
    expect(new Set(rows.results.map((row) => row.traceId)).size).toBe(3);
    expect(
      JSON.parse(byAction.get("client.rename")?.detail ?? "{}"),
    ).toMatchObject({
      previousVersion: 1,
      nextVersion: 2,
    });
    expect(
      JSON.parse(byAction.get("client.deactivate")?.detail ?? "{}"),
    ).toMatchObject({
      previousVersion: 2,
      nextVersion: 3,
    });
    const auditContent = JSON.stringify(rows.results);
    expect(auditContent).not.toContain(valid.name);
    expect(auditContent).not.toContain("[UNIT_TEST]監査後の名前");
    expect(auditContent).not.toContain(adminToken);
  });
});
