// #128（128-b）0-1 AC-16・AC-18: 部署異動（即時）の管理API を、実際の入口（index.ts の app）と隔離 D1 で確かめる。
// 契約（計画 4.2。実装前の仮置き）：
//   POST /api/admin/accounts/:id/transfer { departmentId } → 204（本文なし）
// ここでは HTTP の認可・再認証・本文の形・応答の形（エラーの reason は最上位）だけを確かめる
// （判定の順は Service、SQL の前提と同時の操作は DB のテスト）。データは架空（testuser_128_rx_・[UNIT_TEST]・@example.com）。
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
import { insertUser } from "../../test/role-fixtures";
import { loadConfig } from "../config";
import { app } from "../index";

const ORIGIN = loadConfig(env).allowedOrigins[0] ?? "";
const BASE = "/api/admin/accounts";

let throttleKey: string;
let deptA: SeededDepartment;
let deptB: SeededDepartment;
let admin: string;
let owner: string;
let member: string;
let target: string;
let gone: string;

async function request(
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
      method: "POST",
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

/** 再認証の時刻を入れたセッション。reauthAgoMs が null なら再認証なし（既定は1分前） */
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

const transfer = (id: string, token: string | undefined, body: unknown) =>
  request(`${BASE}/${id}/transfer`, {
    ...(token === undefined ? {} : { token }),
    body,
  });

async function departmentIdOf(id: string) {
  const row = await env.DB.prepare(
    "SELECT department_id FROM users WHERE id = ?",
  )
    .bind(id)
    .first<{ department_id: string | null }>();
  return row?.department_id;
}

async function transferAuditCount() {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'account.transfer'",
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

beforeEach(async () => {
  throttleKey = newThrottleKey();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  deptA = await insertDepartmentWithChannels("128結合異動A");
  deptB = await insertDepartmentWithChannels("128結合異動B");
  admin = await insertUser("testuser_128_rx_admin", deptA.id);
  owner = await insertUser("testuser_128_rx_owner", deptA.id);
  member = await insertUser("testuser_128_rx_member", deptA.id);
  target = await insertUser("testuser_128_rx_target", deptA.id);
  gone = await insertUser("testuser_128_rx_gone", deptA.id, {
    isActive: false,
  });
  await env.DB.prepare(
    "UPDATE users SET must_change_password = 0, department_id = CASE WHEN is_active = 0 THEN NULL ELSE department_id END WHERE login_id LIKE 'testuser!_128!_rx!_%' ESCAPE '!'",
  ).run();
  await makeGlobalAdmin(admin);
  await makeOwner(owner, deptA.id);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupAuthTestData();
  await cleanupDepartmentTestData();
});

describe("#128 AC-16: 全体管理者以外は使えない", () => {
  it.each([
    ["部署のオーナー", () => owner],
    ["一般社員", () => member],
  ])(
    "#128 AC-16: %sは 403 FORBIDDEN で、所属も監査も変わらない",
    async (_label, who) => {
      const res = await transfer(target, await sessionFor(who()), {
        departmentId: deptB.id,
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "FORBIDDEN" });
      expect(await departmentIdOf(target)).toBe(deptA.id);
      expect(await transferAuditCount()).toBe(0);
    },
  );

  it("#128 AC-16: ログインしていなければ 401", async () => {
    const res = await transfer(target, undefined, { departmentId: deptB.id });
    expect(res.status).toBe(401);
    expect(await departmentIdOf(target)).toBe(deptA.id);
  });
});

describe("#128 AC-16: 再認証が切れていると所属が変わらない", () => {
  it.each([
    ["再認証していない", null],
    ["再認証から11分経った", 11 * 60_000],
  ])(
    "#128 AC-16: %s全体管理者は 403 REAUTH_REQUIRED で何も変わらない",
    async (_label, ago) => {
      const res = await transfer(target, await sessionFor(admin, ago), {
        departmentId: deptB.id,
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "REAUTH_REQUIRED" });
      expect(await departmentIdOf(target)).toBe(deptA.id);
      expect(await transferAuditCount()).toBe(0);
    },
  );
});

describe("#128 AC-16: 異動の応答", () => {
  it("#128 AC-16: 204 で本文がなく、所属が新しい部署に変わる", async () => {
    const res = await transfer(target, await sessionFor(admin), {
      departmentId: deptB.id,
    });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(await departmentIdOf(target)).toBe(deptB.id);
    expect(await transferAuditCount()).toBe(1);
  });

  it.each([
    ["departmentId がない", {}],
    ["departmentId が ULID でない", { departmentId: "not-a-ulid" }],
    ["余分な項目がある", { departmentId: "", extra: 1 }],
  ])(
    "#128 AC-16: 本文の形が不正（%s）なら 422 で何も変えない",
    async (_label, body) => {
      const res = await transfer(target, await sessionFor(admin), body);
      expect(res.status).toBe(422);
      expect(await departmentIdOf(target)).toBe(deptA.id);
    },
  );

  it("#128 AC-16: 今の部署と同じ部署なら 422（fields: departmentId を最上位に）", async () => {
    const res = await transfer(target, await sessionFor(admin), {
      departmentId: deptA.id,
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["departmentId"],
    });
  });

  it("#128 AC-16・AC-18: 今の部署のオーナーは 409（reason: department_owner）、無効な社員は 409（reason: inactive）、ない社員は 404 で、どれも何も変えない", async () => {
    const token = await sessionFor(admin);
    const ownerRes = await transfer(owner, token, { departmentId: deptB.id });
    expect(ownerRes.status).toBe(409);
    expect(await ownerRes.json()).toMatchObject({
      code: "CONFLICT",
      reason: "department_owner",
    });
    const goneRes = await transfer(gone, token, { departmentId: deptB.id });
    expect(goneRes.status).toBe(409);
    expect(await goneRes.json()).toMatchObject({
      code: "CONFLICT",
      reason: "inactive",
    });
    const missing = await transfer("01JTEST128XNOTFOUND0000001", token, {
      departmentId: deptB.id,
    });
    expect(missing.status).toBe(404);
    expect(await departmentIdOf(owner)).toBe(deptA.id);
    expect(await departmentIdOf(gone)).toBeNull();
    expect(await transferAuditCount()).toBe(0);
  });
});
