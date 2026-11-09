// #200 AC-1（Q-5・Q-10）: アカウント発行（POST /api/admin/accounts）が、全社連絡と所属部署の専用チャンネル2つへ参加させること、
// 全社連絡がないときは 503 SERVICE_UNAVAILABLE で何も残さないことを、実際のアプリ入口と隔離 D1 で確かめる。
// 既存の accounts.test.ts は変更せず、#200 の確認だけをこのファイルに置く。データは架空（testuser_、[UNIT_TEST]、@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_TRACE_PREFIX,
  SCRYPT_TEST_TIMEOUT_MS,
  SESSION_COOKIE,
  TEST_IP,
  cleanupAuthTestData,
  hmacHex,
  insertSession,
  newThrottleKey,
} from "../../test/auth-fixtures";
import {
  companyGeneralRoomId,
  removeCompanyGeneral,
  restoreCompanyGeneral,
} from "../../test/company-general-fixtures";
import {
  cleanupDepartmentTestData,
  insertDepartmentWithChannels,
  makeGlobalAdmin,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { newPiiKey, newSetupToken } from "../../test/random-secrets";
import { countRows, insertUser } from "../../test/role-fixtures";
import { loadConfig } from "../config";
import { app } from "../index";

const ORIGIN = loadConfig(env).allowedOrigins[0] ?? "";
const BASE = "/api/admin/accounts";

let throttleKey: string;
let piiKey: string;
let dept: SeededDepartment;
let adminToken: string;
let companyGeneralRemoved = false;

function body(overrides: Record<string, unknown> = {}) {
  return {
    loginId: "testuser_accch_101",
    legalName: "テスト太郎",
    displayName: "テスト太郎",
    email: "testuser_accch_101@example.com",
    emailConfirmed: true,
    departmentId: dept.id,
    ...overrides,
  };
}

function post(payload: unknown) {
  return app.request(
    BASE,
    {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        "CF-Connecting-IP": TEST_IP,
        "Content-Type": "application/json",
        "X-Request-Id": `${AUTH_TRACE_PREFIX}${crypto.randomUUID()}`,
        Cookie: `${SESSION_COOKIE}=${adminToken}`,
      },
      body: JSON.stringify(payload),
    },
    {
      ...env,
      LOGIN_THROTTLE_KEY: throttleKey,
      SETUP_TOKEN: newSetupToken(),
      PII_ENCRYPTION_KEY: piiKey,
    } as unknown as Env,
  );
}

async function memberRows(loginId: string) {
  const { results } = await env.DB.prepare(
    `SELECT channel_id FROM channel_members
     WHERE user_id IN (SELECT id FROM users WHERE login_id_normalized = ?) ORDER BY channel_id`,
  )
    .bind(loginId.toLowerCase())
    .all<{ channel_id: string }>();
  return results.map((r) => r.channel_id);
}

beforeEach(async () => {
  throttleKey = newThrottleKey();
  piiKey = newPiiKey();
  for (const method of ["log", "warn", "error"] as const)
    vi.spyOn(console, method).mockImplementation(() => {});
  dept = await insertDepartmentWithChannels("発行チャンネル");
  const admin = await insertUser("testuser_accch_admin", dept.id);
  await env.DB.prepare("UPDATE users SET must_change_password = 0 WHERE id = ?")
    .bind(admin)
    .run();
  await makeGlobalAdmin(admin);
  adminToken = (
    await insertSession(admin, { createdAt: new Date().toISOString() })
  ).token;
});

afterEach(async () => {
  vi.restoreAllMocks();
  const bucketKeys = await Promise.all(
    [TEST_IP, "testuser_accch_101"].map((v) => hmacHex(throttleKey, v)),
  );
  await env.DB.prepare(
    "DELETE FROM audit_logs WHERE action = 'account.create' AND target_id IN (SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!')",
  ).run();
  await cleanupAuthTestData(bucketKeys);
  await cleanupDepartmentTestData();
  if (companyGeneralRemoved) {
    await restoreCompanyGeneral();
    companyGeneralRemoved = false;
  }
});

describe(
  "#200 POST /api/admin/accounts：チャンネルへの参加",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it("#200 AC-1（Q-10）: 発行に成功すると201で、全社連絡と所属部署の専用チャンネル2つに参加している", async () => {
      const res = await post(body());
      expect(res.status).toBe(201);
      const general = await companyGeneralRoomId();
      expect(await memberRows("testuser_accch_101")).toEqual(
        [general, dept.dedicatedChannelId, dept.announcementChannelId].sort(),
      );
    });

    it("#200 AC-1（Q-5）: 全社連絡がないと503 SERVICE_UNAVAILABLE と決めた文言で、利用者も参加も残らず、初期パスワードを返さない", async () => {
      await removeCompanyGeneral();
      companyGeneralRemoved = true;
      const before = await countRows("users");
      const res = await post(body());
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(JSON.parse(text)).toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        message:
          "初期チャンネルが準備されていないため、アカウントを発行できません。システム管理者へ連絡してください。",
      });
      expect(text).not.toMatch(/initialPassword/);
      expect(await countRows("users")).toBe(before);
      expect(await memberRows("testuser_accch_101")).toEqual([]);
    });
  },
);
