// #192 AC-1・AC-3: 画面に依存せずサーバーの操作ごとの認可を検証する。
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

const BASE = "/api/admin/clients";
const ORIGIN = loadConfig(env).allowedOrigins[0] ?? "";
let throttleKey: string;
let adminToken: string;
let ownerToken: string;
let memberToken: string;
let revokedToken: string;
const createdIds = new Set<string>();
async function call(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
) {
  const headers: Record<string, string> = {
    Origin: ORIGIN,
    "CF-Connecting-IP": TEST_IP,
    "X-Request-Id": `${AUTH_TRACE_PREFIX}${crypto.randomUUID()}`,
  };
  if (token) headers.Cookie = `${SESSION_COOKIE}=${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await app.request(
    path,
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
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
  const department = await insertDepartment("取引先認可テスト部署");
  const admin = await insertUser("testuser_client_access_admin", department);
  const owner = await insertUser("testuser_client_access_owner", department);
  const member = await insertUser("testuser_client_access_member", department);
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
  revokedToken = (
    await insertSession(member, { createdAt: now, revokedAt: now })
  ).token;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupAuthTestData();
  for (const id of createdIds) {
    await env.DB.prepare("DELETE FROM clients WHERE id = ?").bind(id).run();
  }
  createdIds.clear();
  await cleanupRoleTestData();
});
describe("#192 操作ごとの認可と公開範囲", () => {
  it("#192 AC-1（5-7 AC-1）: 管理一覧は管理者だけ、社員読取と申請候補は有効な全社員に許可", async () => {
    expect((await call("GET", BASE, adminToken)).status).toBe(200);
    for (const token of [ownerToken, memberToken]) {
      const denied = await call("GET", BASE, token);
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({ code: "FORBIDDEN" });
      expect((await call("GET", "/api/clients", token)).status).toBe(200);
      expect((await call("GET", "/api/clients/candidates", token)).status).toBe(
        200,
      );
    }
  });

  it("#192 AC-1（5-7 AC-1）: 未認証・失効セッションは社員読取も401", async () => {
    for (const token of [undefined, revokedToken]) {
      for (const path of ["/api/clients", "/api/clients/candidates"]) {
        const response = await call("GET", path, token);
        expect(response.status).toBe(401);
        expect(await response.json()).toMatchObject({
          code: "UNAUTHENTICATED",
        });
        expect(response.headers.get("Cache-Control")).toContain("no-store");
      }
    }
  });

  it("#192 AC-1・AC-3（5-7 AC-1・AC-3）: 管理者以外の改名・無効化は403で状態不変", async () => {
    const created = await call("POST", BASE, adminToken, {
      code: "ABC",
      name: "[UNIT_TEST]取引先",
    });
    expect(created.status).toBe(201);
    const client = (await created.json()) as { id: string; version: number };
    for (const token of [ownerToken, memberToken]) {
      for (const [path, body] of [
        [`${BASE}/${client.id}`, { name: "[UNIT_TEST]不正変更", version: 1 }],
        [`${BASE}/${client.id}/status`, { active: false, version: 1 }],
      ] as const) {
        const denied = await call("PATCH", path, token, body);
        expect(denied.status).toBe(403);
        expect(await denied.json()).toMatchObject({ code: "FORBIDDEN" });
      }
    }
    const listed = await call("GET", BASE, adminToken);
    const page = (await listed.json()) as {
      items: { id: string; name: string; active: boolean; version: number }[];
    };
    expect(page.items.find((item) => item.id === client.id)).toMatchObject({
      name: "[UNIT_TEST]取引先",
      active: true,
      version: 1,
    });
  });

  it("#192 AC-3・AC-4（5-7 AC-3・AC-5）: コード編集ルートは公開されず、再有効化本文も受け付けない", async () => {
    const created = await call("POST", BASE, adminToken, {
      code: "ABC",
      name: "[UNIT_TEST]取引先",
    });
    expect(created.status).toBe(201);
    const client = (await created.json()) as { id: string; version: number };
    const codeEdit = await call(
      "PATCH",
      `${BASE}/${client.id}/code`,
      adminToken,
      {
        code: "DEF",
        version: 1,
      },
    );
    expect(codeEdit.status).toBe(404);
    const activate = await call(
      "PATCH",
      `${BASE}/${client.id}/status`,
      adminToken,
      {
        active: true,
        version: 1,
      },
    );
    expect(activate.status).toBe(422);
    expect(await activate.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    const listed = await call("GET", BASE, adminToken);
    const page = (await listed.json()) as {
      items: { id: string; code: string; active: boolean; version: number }[];
    };
    expect(page.items.find((item) => item.id === client.id)).toMatchObject({
      code: "ABC",
      active: true,
      version: 1,
    });
  });
});
