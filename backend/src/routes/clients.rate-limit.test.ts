// #192 AC-1・AC-6（X-8）: 取引先APIの利用者単位レート制限を隔離D1で検証する。
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
let adminId: string;
let adminToken: string;
let throttleKey: string;
const createdIds = new Set<string>();
const rateUserIds = new Set<string>();

function request(method: string, path: string, token: string, body?: unknown) {
  const headers: Record<string, string> = {
    Origin: ORIGIN,
    "CF-Connecting-IP": TEST_IP,
    "X-Request-Id": `${AUTH_TRACE_PREFIX}${crypto.randomUUID()}`,
    Cookie: `${SESSION_COOKIE}=${token}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(
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
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-08T00:00:10.000Z"));
  throttleKey = newThrottleKey();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const department = await insertDepartment("取引先API制限テスト部署");
  adminId = await insertUser("testuser_client_rate_admin", department);
  rateUserIds.add(adminId);
  await env.DB.prepare("UPDATE users SET must_change_password = 0 WHERE id = ?")
    .bind(adminId)
    .run();
  await insertAssignment(adminId, ROLE_IDS.globalAdmin, "company", null);
  adminToken = (
    await insertSession(adminId, { createdAt: new Date().toISOString() })
  ).token;
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupAuthTestData();
  const table = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'client_api_rate_limits'",
  ).first();
  if (table) {
    for (const id of rateUserIds) {
      await env.DB.prepare(
        "DELETE FROM client_api_rate_limits WHERE user_id = ?",
      )
        .bind(id)
        .run();
    }
  }
  rateUserIds.clear();
  for (const id of createdIds) {
    await env.DB.prepare(
      "DELETE FROM audit_logs WHERE target_type = 'client' AND target_id = ?",
    )
      .bind(id)
      .run();
    await env.DB.prepare("DELETE FROM clients WHERE id = ?").bind(id).run();
  }
  createdIds.clear();
  await cleanupRoleTestData();
});

describe("#192 AC-1・AC-6（X-8）: 取引先APIの利用者別制限", () => {
  it(
    "#192 AC-1・AC-6（X-8）: 管理・社員・候補GETの合計120回は通し121回目を429とRetry-Afterで拒否する",
    { timeout: 45_000 },
    async () => {
      const paths = [
        "/api/admin/clients",
        "/api/clients",
        "/api/clients/candidates",
      ];
      for (let i = 0; i < 120; i += 1) {
        const response = await request(
          "GET",
          paths[i % paths.length]!,
          adminToken,
        );
        expect(response.status, `${i + 1}回目`).toBe(200);
      }
      const auditSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const blocked = await request(
        "GET",
        "/api/clients/candidates",
        adminToken,
      );
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("Retry-After")).toBe("50");
      expect(blocked.headers.get("Cache-Control")).toBe("no-store");
      expect(await blocked.json()).toMatchObject({ code: "RATE_LIMITED" });
      const auditRecord = auditSpy.mock.calls
        .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
        .find((record) => record.body === "client.rate_limited");
      expect(auditRecord).toMatchObject({
        severity_text: "INFO",
        user_id: adminId,
        trace_id: expect.any(String),
        attributes: {
          log_type: "audit",
          target: "read",
          result: "failure",
        },
      });
    },
  );
});

describe("#192 AC-1・AC-6（X-8）: 取引先APIの更新・独立性", () => {
  it(
    "#192 AC-1・AC-6（X-8）: POST・名前PATCH・状態PATCHの合計30回は422でも課金し31回目は業務変更せず429",
    { timeout: 45_000 },
    async () => {
      for (let i = 0; i < 28; i += 1) {
        const response = await request(
          "POST",
          "/api/admin/clients",
          adminToken,
          {},
        );
        expect(response.status, `${i + 1}回目`).toBe(422);
      }
      expect(
        (await request("PATCH", "/api/admin/clients/not-an-id", adminToken, {}))
          .status,
      ).toBe(422);
      expect(
        (
          await request(
            "PATCH",
            "/api/admin/clients/not-an-id/status",
            adminToken,
            {},
          )
        ).status,
      ).toBe(422);
      const before = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM audit_logs WHERE actor_id = ? AND action LIKE 'client.%'",
      )
        .bind(adminId)
        .first<{ n: number }>();
      const blocked = await request("POST", "/api/admin/clients", adminToken, {
        code: "EQA",
        name: "[UNIT_TEST_192_RATE]Blocked",
      });
      if (blocked.status === 201) {
        const body = (await blocked.clone().json()) as { id: string };
        createdIds.add(body.id);
      }
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("Retry-After")).toBe("50");
      expect(await blocked.json()).toMatchObject({ code: "RATE_LIMITED" });
      expect(
        await env.DB.prepare(
          "SELECT id FROM clients WHERE code = 'EQA'",
        ).first(),
      ).toBeNull();
      const after = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM audit_logs WHERE actor_id = ? AND action LIKE 'client.%'",
      )
        .bind(adminId)
        .first<{ n: number }>();
      expect(after?.n).toBe(before?.n);
    },
  );

  it(
    "#192 AC-1・AC-6（X-8）: read枠超過でもwrite枠は独立し別利用者も取得できる",
    { timeout: 45_000 },
    async () => {
      const department = await insertDepartment("取引先rate別利用者部署");
      const otherId = await insertUser(
        "testuser_client_rate_other",
        department,
      );
      rateUserIds.add(otherId);
      await env.DB.prepare(
        "UPDATE users SET must_change_password = 0 WHERE id = ?",
      )
        .bind(otherId)
        .run();
      const otherToken = (
        await insertSession(otherId, { createdAt: new Date().toISOString() })
      ).token;
      for (let i = 0; i < 120; i += 1)
        expect((await request("GET", "/api/clients", adminToken)).status).toBe(
          200,
        );
      expect((await request("GET", "/api/clients", adminToken)).status).toBe(
        429,
      );
      expect(
        (await request("POST", "/api/admin/clients", adminToken, {})).status,
      ).toBe(422);
      expect((await request("GET", "/api/clients", otherToken)).status).toBe(
        200,
      );
    },
  );

  it(
    "#192 AC-1・AC-6（X-8）: 固定分窓の末尾で429になり次のUTC分に自動解除する",
    { timeout: 45_000 },
    async () => {
      vi.setSystemTime(new Date("2026-11-08T00:00:59.500Z"));
      for (let i = 0; i < 120; i += 1)
        expect((await request("GET", "/api/clients", adminToken)).status).toBe(
          200,
        );
      const blocked = await request("GET", "/api/clients", adminToken);
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("Retry-After")).toBe("1");
      vi.setSystemTime(new Date("2026-11-08T00:01:00.000Z"));
      expect((await request("GET", "/api/clients", adminToken)).status).toBe(
        200,
      );
    },
  );

  it(
    "#192 AC-1・AC-6（X-8）: 未認証401は利用者のread枠に課金しない",
    { timeout: 45_000 },
    async () => {
      for (let i = 0; i < 121; i += 1)
        expect((await request("GET", "/api/clients", "")).status).toBe(401);
      for (let i = 0; i < 120; i += 1)
        expect((await request("GET", "/api/clients", adminToken)).status).toBe(
          200,
        );
      expect((await request("GET", "/api/clients", adminToken)).status).toBe(
        429,
      );
    },
  );
});

describe("#192 AC-1・AC-6（X-8）: 認可と障害時の課金", () => {
  it(
    "#192 AC-1・AC-6（X-8）: 認証済み一般社員の403もwriteに課金し31回目は429",
    { timeout: 45_000 },
    async () => {
      const department = await insertDepartment("取引先rate認可テスト部署");
      const employeeId = await insertUser(
        "testuser_client_rate_employee",
        department,
      );
      rateUserIds.add(employeeId);
      await env.DB.prepare(
        "UPDATE users SET must_change_password = 0 WHERE id = ?",
      )
        .bind(employeeId)
        .run();
      const token = (
        await insertSession(employeeId, { createdAt: new Date().toISOString() })
      ).token;
      for (let i = 0; i < 30; i += 1) {
        const response = await request("POST", "/api/admin/clients", token, {
          code: "EQA",
          name: "[UNIT_TEST_192_RATE]Denied",
        });
        expect(response.status, `${i + 1}回目`).toBe(403);
      }
      const blocked = await request("POST", "/api/admin/clients", token, {
        code: "EQA",
        name: "[UNIT_TEST_192_RATE]Denied",
      });
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("Retry-After")).toBe("50");
      expect(await blocked.json()).toMatchObject({ code: "RATE_LIMITED" });
      expect(
        await env.DB.prepare(
          "SELECT id FROM clients WHERE code = 'EQA'",
        ).first(),
      ).toBeNull();
    },
  );

  it("#192 AC-1・AC-6（X-8）: rate保存DB失敗は503で取引先・監査を部分実行しない", async () => {
    const trigger = "unit_test_192_client_rate_abort";
    expect(adminId).toMatch(/^[0-9A-Z]{26}$/);
    await env.DB.prepare(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON client_api_rate_limits
       WHEN NEW.user_id = '${adminId}' AND NEW.bucket_type = 'write'
       BEGIN SELECT RAISE(ABORT, 'unit_test_192_rate_failure'); END`,
    ).run();
    try {
      const before = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM audit_logs WHERE actor_id = ? AND action LIKE 'client.%'",
      )
        .bind(adminId)
        .first<{ n: number }>();
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const response = await request("POST", "/api/admin/clients", adminToken, {
        code: "EQA",
        name: "[UNIT_TEST_192_RATE]DbFailure",
      });
      if (response.status === 201) {
        const body = (await response.clone().json()) as { id: string };
        createdIds.add(body.id);
      }
      expect(response.status).toBe(503);
      const errorRecord = errorSpy.mock.calls
        .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
        .find(
          (record) =>
            record.severity_text === "ERROR" && record.user_id === adminId,
        );
      expect(errorRecord).toMatchObject({
        severity_text: "ERROR",
        trace_id: expect.any(String),
        user_id: adminId,
        attributes: { bucket: "write", error: expect.anything() },
      });
      const safeLog = JSON.stringify(errorRecord);
      expect(safeLog).not.toContain("INSERT INTO client_api_rate_limits");
      expect(safeLog).not.toContain("unit_test_192_rate_failure");
      expect(safeLog).not.toContain(adminToken);
      expect(await response.json()).toMatchObject({
        code: "SERVICE_UNAVAILABLE",
      });
      expect(
        await env.DB.prepare(
          "SELECT id FROM clients WHERE code = 'EQA'",
        ).first(),
      ).toBeNull();
      const after = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM audit_logs WHERE actor_id = ? AND action LIKE 'client.%'",
      )
        .bind(adminId)
        .first<{ n: number }>();
      expect(after?.n).toBe(before?.n);
    } finally {
      await env.DB.prepare(`DROP TRIGGER ${trigger}`).run();
    }
  });
});
