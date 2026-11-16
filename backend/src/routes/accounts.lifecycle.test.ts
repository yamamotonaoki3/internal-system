// #128（128-a）0-1 AC-9・AC-11・AC-12・AC-14: アカウントの無効化・再有効化の管理API を、実際の入口（index.ts の app）と隔離 D1 で確かめる。
// 契約（計画 3.2。実装前の仮置き）：
//   POST /api/admin/accounts/:id/deactivate（本文なし）→ 204
//   POST /api/admin/accounts/:id/reactivate { departmentId } → 200 { id, initialPassword }（Cache-Control: no-store）
// ここでは HTTP の認可・再認証・応答の形とヘッダー・セッションの経路だけを確かめる（判定の順は Service、SQL の条件は DB のテスト）。
// 一時パスワードの値はテストの出力に出さない（比較だけに使う）。データは架空（testuser_128_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_TRACE_PREFIX,
  SCRYPT_TEST_TIMEOUT_MS,
  SESSION_COOKIE,
  TEST_IP,
  TEST_PASSWORD,
  TEST_PASSWORD_HASH,
  cleanupAuthTestData,
  insertSession,
  newThrottleKey,
  setUserPassword,
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
import { verifyPassword } from "../lib/password";

const ORIGIN = loadConfig(env).allowedOrigins[0] ?? "";
const BASE = "/api/admin/accounts";

let throttleKey: string;
let logLines: string[];
let dept: SeededDepartment;
let admin: string;
let owner: string;
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

const deactivate = (id: string, token: string) =>
  request("POST", `${BASE}/${id}/deactivate`, { token });
const reactivate = (id: string, token: string, body: unknown) =>
  request("POST", `${BASE}/${id}/reactivate`, { token, body });

async function stateOf(id: string) {
  return env.DB.prepare(
    "SELECT is_active, department_id, password_hash, must_change_password FROM users WHERE id = ?",
  )
    .bind(id)
    .first<{
      is_active: number;
      department_id: string | null;
      password_hash: string;
      must_change_password: number;
    }>();
}

async function lifecycleAuditCount() {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM audit_logs WHERE action IN ('account.deactivate', 'account.reactivate')",
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

beforeEach(async () => {
  throttleKey = newThrottleKey();
  logLines = [];
  const capture = (...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  dept = await insertDepartmentWithChannels("128結合部署");
  admin = await insertUser("testuser_128_r_admin", dept.id);
  owner = await insertUser("testuser_128_r_owner", dept.id);
  member = await insertUser("testuser_128_r_member", dept.id);
  target = await insertUser("testuser_128_r_target", dept.id);
  gone = await insertUser("testuser_128_r_gone", dept.id, { isActive: false });
  await env.DB.prepare(
    "UPDATE users SET must_change_password = 0, department_id = CASE WHEN is_active = 0 THEN NULL ELSE department_id END WHERE login_id LIKE 'testuser!_128!_r!_%' ESCAPE '!'",
  ).run();
  await makeGlobalAdmin(admin);
  await makeOwner(owner, dept.id);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupAuthTestData();
  await cleanupDepartmentTestData();
});

describe("#128 AC-11: 全体管理者以外は使えない", () => {
  it.each([
    ["部署のオーナー", () => owner],
    ["一般社員", () => member],
  ])(
    "#128 AC-11: %sは無効化・再有効化とも 403 FORBIDDEN で、状態も監査も変わらない",
    async (_label, who) => {
      const token = await sessionFor(who());
      const before = [await stateOf(target), await stateOf(gone)];
      const d = await deactivate(target, token);
      expect(d.status).toBe(403);
      expect(await d.json()).toMatchObject({ code: "FORBIDDEN" });
      const r = await reactivate(gone, token, { departmentId: dept.id });
      expect(r.status).toBe(403);
      expect(await r.json()).toMatchObject({ code: "FORBIDDEN" });
      expect([await stateOf(target), await stateOf(gone)]).toEqual(before);
      expect(await lifecycleAuditCount()).toBe(0);
    },
  );

  it("#128 AC-11: ログインしていなければ 401", async () => {
    expect((await request("POST", `${BASE}/${target}/deactivate`)).status).toBe(
      401,
    );
    expect(
      (
        await request("POST", `${BASE}/${gone}/reactivate`, {
          body: { departmentId: dept.id },
        })
      ).status,
    ).toBe(401);
  });
});

describe("#128 AC-12: 再認証が切れていると状態が変わらない", () => {
  it.each([
    ["再認証していない", null],
    ["再認証から11分経った", 11 * 60_000],
  ])(
    "#128 AC-9・AC-12: %s全体管理者は、無効化・再有効化とも 403 REAUTH_REQUIRED で何も変わらない",
    async (_label, ago) => {
      const token = await sessionFor(admin, ago);
      const before = [await stateOf(target), await stateOf(gone)];
      const d = await deactivate(target, token);
      expect(d.status).toBe(403);
      expect(await d.json()).toMatchObject({ code: "REAUTH_REQUIRED" });
      const r = await reactivate(gone, token, { departmentId: dept.id });
      expect(r.status).toBe(403);
      expect(await r.json()).toMatchObject({ code: "REAUTH_REQUIRED" });
      expect([await stateOf(target), await stateOf(gone)]).toEqual(before);
      expect(await lifecycleAuditCount()).toBe(0);
    },
  );
});

describe(
  "#128 AC-9: 無効化の応答とセッション",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it("#128 AC-9: 204 で本文がなく、対象の既存のセッションでの次の要求は 401、パスワードでのログインも 401", async () => {
      await setUserPassword(target, TEST_PASSWORD_HASH);
      const targetToken = await sessionFor(target);
      // 無効化の前は使える
      expect(
        (await request("GET", "/api/auth/session", { token: targetToken }))
          .status,
      ).toBe(200);
      const res = await deactivate(target, await sessionFor(admin));
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
      expect(
        (await request("GET", "/api/auth/session", { token: targetToken }))
          .status,
      ).toBe(401);
      expect(
        (await request("GET", "/api/me", { token: targetToken })).status,
      ).toBe(401);
      const login = await request("POST", "/api/auth/login", {
        body: { loginId: "testuser_128_r_target", password: TEST_PASSWORD },
      });
      expect(login.status).toBe(401);
    });

    it("#128 AC-9: 自分自身は 422、オーナーは 409、ない社員は 404 で、どれも何も変えない", async () => {
      const token = await sessionFor(admin);
      const self = await deactivate(admin, token);
      expect(self.status).toBe(422);
      const ownerRes = await deactivate(owner, token);
      expect(ownerRes.status).toBe(409);
      expect(await ownerRes.json()).toMatchObject({
        code: "CONFLICT",
        reason: "department_owner",
      });
      const missing = await deactivate("01JTEST128NOTFOUND00000001", token);
      expect(missing.status).toBe(404);
      expect(await stateOf(admin)).toMatchObject({ is_active: 1 });
      expect(await stateOf(owner)).toMatchObject({ is_active: 1 });
      expect(await lifecycleAuditCount()).toBe(0);
    });
  },
);

describe(
  "#128 AC-14: 再有効化の応答",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it("#128 AC-14（U-7）: 200 で { id, initialPassword } だけを返し、no-store。一時パスワードは発行と同じ形で、保存したハッシュと一致し、ログに出ない", async () => {
      const res = await reactivate(gone, await sessionFor(admin), {
        departmentId: dept.id,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toContain("no-store");
      const body = (await res.json()) as {
        id: string;
        initialPassword: string;
      };
      expect(Object.keys(body).sort()).toEqual(["id", "initialPassword"]);
      expect(body.id).toBe(gone);
      const password = body.initialPassword;
      expect(password).toHaveLength(16);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[^A-Za-z0-9]/);
      const saved = await stateOf(gone);
      expect(saved).toMatchObject({
        is_active: 1,
        department_id: dept.id,
        must_change_password: 1,
      });
      expect(await verifyPassword(password, saved?.password_hash ?? "")).toBe(
        true,
      );
      // 値そのものを出力しないよう、真偽だけで比べる
      expect(logLines.some((line) => line.includes(password))).toBe(false);
      const audit = await env.DB.prepare(
        "SELECT detail FROM audit_logs WHERE action = 'account.reactivate' AND target_id = ?",
      )
        .bind(gone)
        .first<{ detail: string | null }>();
      expect((audit?.detail ?? "").includes(password)).toBe(false);
    });

    it("#128 AC-14: 一時パスワードでログインでき、パスワードの変更を求められる", async () => {
      const res = await reactivate(gone, await sessionFor(admin), {
        departmentId: dept.id,
      });
      const { initialPassword } = (await res.json()) as {
        initialPassword: string;
      };
      const login = await request("POST", "/api/auth/login", {
        body: { loginId: "testuser_128_r_gone", password: initialPassword },
      });
      expect(login.status).toBe(200);
      expect(await login.json()).toMatchObject({ mustChangePassword: true });
    });

    it.each([
      ["departmentId がない", {}],
      ["departmentId が ULID でない", { departmentId: "not-a-ulid" }],
      ["余分な項目がある", { departmentId: "", extra: 1 }],
    ])(
      "#128 AC-14: 本文の形が不正（%s）なら 422 で何も変えない",
      async (_label, body) => {
        const before = await stateOf(gone);
        const res = await reactivate(gone, await sessionFor(admin), body);
        expect(res.status).toBe(422);
        expect(await stateOf(gone)).toEqual(before);
      },
    );

    it("#128 AC-14: 有効な社員は 409 already_active で、パスワードを変えない", async () => {
      const before = await stateOf(target);
      const res = await reactivate(target, await sessionFor(admin), {
        departmentId: dept.id,
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        code: "CONFLICT",
        reason: "already_active",
      });
      expect(body).not.toHaveProperty("initialPassword");
      expect(await stateOf(target)).toEqual(before);
    });
  },
);
