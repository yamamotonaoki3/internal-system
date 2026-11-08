// #192: 検索、状態、版競合をアプリ入口と隔離 D1 で検証する。
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
let token: string;
let throttleKey: string;
const createdIds = new Set<string>();
type Client = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  version: number;
};
type Page = { items: Client[]; nextCursor: string | null };

function call(method: string, path: string, body?: unknown) {
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
async function create(code: string, name: string): Promise<Client> {
  const response = await call("POST", BASE, { code, name });
  expect(response.status).toBe(201);
  const client = (await response.json()) as Client;
  createdIds.add(client.id);
  return client;
}
async function page(query = ""): Promise<Page> {
  const response = await call("GET", `${BASE}${query}`);
  expect(response.status).toBe(200);
  return (await response.json()) as Page;
}
beforeEach(async () => {
  throttleKey = newThrottleKey();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const department = await insertDepartment("取引先検索テスト部署");
  const admin = await insertUser("testuser_client_search_admin", department);
  await env.DB.prepare("UPDATE users SET must_change_password = 0 WHERE id = ?")
    .bind(admin)
    .run();
  await insertAssignment(admin, ROLE_IDS.globalAdmin, "company", null);
  token = (await insertSession(admin, { createdAt: new Date().toISOString() }))
    .token;
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

describe("#192 取引先検索と競合", () => {
  it("#192 AC-5（5-7 AC-11）: 名前とコードの途中を大小文字非区別で検索する", async () => {
    const first = await create("ABC", "[UNIT_TEST]Alpha_One");
    await create("DEF", "[UNIT_TEST]Beta");
    expect((await page("?q=lPhA")).items.map((item) => item.id)).toEqual([
      first.id,
    ]);
    expect((await page("?q=bC")).items.map((item) => item.id)).toEqual([
      first.id,
    ]);
  });

  it("#192 AC-5（5-7 AC-11）: 空・空白検索は無検索、100文字は許可し101文字は422", async () => {
    const first = await create("ABC", "[UNIT_TEST]Alpha");
    for (const q of ["", "   "]) {
      const result = await page(`?q=${encodeURIComponent(q)}`);
      expect(result.items.map((item) => item.id)).toContain(first.id);
    }
    const hundred = await call("GET", `${BASE}?q=${"a".repeat(100)}`);
    expect(hundred.status).toBe(200);
    const tooLong = await call("GET", `${BASE}?q=${"a".repeat(101)}`);
    expect(tooLong.status).toBe(422);
    expect(await tooLong.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["q"],
    });
  });

  it("#192 AC-5（5-7 AC-11）: %と_は検索の通常文字で、SQL攻撃入力は結果を広げない", async () => {
    const underscore = await create("ABC", "[UNIT_TEST]A_B");
    const percent = await create("DEF", "[UNIT_TEST]A%B");
    await create("GHI", "[UNIT_TEST]AXB");
    expect((await page("?q=%25")).items.map((item) => item.id)).toEqual([
      percent.id,
    ]);
    expect((await page("?q=A_B")).items.map((item) => item.id)).toEqual([
      underscore.id,
    ]);
    const attack = await page(`?q=${encodeURIComponent("' OR 1=1 --")}`);
    expect(attack.items).toEqual([]);
  });

  it("#192 AC-5（5-7 AC-11・AC-12）: 初期allから有効・無効を絞れ、無効行を保持する", async () => {
    const first = await create("ABC", "[UNIT_TEST]Alpha");
    const second = await create("DEF", "[UNIT_TEST]Beta");
    const changed = await call("PATCH", `${BASE}/${second.id}/status`, {
      active: false,
      version: second.version,
    });
    expect(changed.status).toBe(200);
    expect((await page()).items.map((item) => item.id)).toEqual(
      expect.arrayContaining([first.id, second.id]),
    );
    expect(
      (await page("?status=active")).items.map((item) => item.id),
    ).toContain(first.id);
    expect(
      (await page("?status=active")).items.map((item) => item.id),
    ).not.toContain(second.id);
    expect(
      (await page("?status=inactive")).items.map((item) => item.id),
    ).toEqual([second.id]);
    const invalid = await call("GET", `${BASE}?status=unknown`);
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["status"],
    });
  });

  it("#192 AC-3・AC-7（5-7 AC-3）: 古い版の改名は409で名前・版・監査が増えない", async () => {
    const first = await create("ABC", "[UNIT_TEST]Alpha");
    const changed = await call("PATCH", `${BASE}/${first.id}`, {
      name: "[UNIT_TEST]Beta",
      version: first.version,
    });
    expect(changed.status).toBe(200);
    const auditBefore = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE target_id = ?",
    )
      .bind(first.id)
      .first<{ n: number }>();
    const stale = await call("PATCH", `${BASE}/${first.id}`, {
      name: "[UNIT_TEST]Gamma",
      version: first.version,
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "CONFLICT" });
    const current = (await page("?q=ABC")).items.find(
      (item) => item.id === first.id,
    );
    expect(current).toMatchObject({
      code: "ABC",
      name: "[UNIT_TEST]Beta",
      version: first.version + 1,
    });
    const auditAfter = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE target_id = ?",
    )
      .bind(first.id)
      .first<{ n: number }>();
    expect(auditAfter?.n).toBe(auditBefore?.n);
  });

  it("#192 AC-2・AC-3（5-7 AC-7）: 2社を同名へ並行改名しても一方だけ成功する", async () => {
    const first = await create("ABC", "[UNIT_TEST]Alpha");
    const second = await create("DEF", "[UNIT_TEST]Beta");
    const results = await Promise.all([
      call("PATCH", `${BASE}/${first.id}`, {
        name: "[UNIT_TEST]Same",
        version: 1,
      }),
      call("PATCH", `${BASE}/${second.id}`, {
        name: "[UNIT_TEST]Same",
        version: 1,
      }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const current = await page();
    const matching = current.items.filter(
      (item) => item.name === "[UNIT_TEST]Same",
    );
    expect(matching).toHaveLength(1);
    const loser = current.items.find(
      (item) =>
        [first.id, second.id].includes(item.id) && item.id !== matching[0]?.id,
    );
    expect(loser?.version).toBe(1);
    expect(loser?.name).toMatch(/^\[UNIT_TEST\](Alpha|Beta)$/);
  });
});

describe("#192 AC-5・AC-6（5-7 AC-11）: 3つの一覧のcursor境界", () => {
  it("#192 AC-5・AC-6: 管理・全社員・候補の2件ページを最後まで辿り、検索と状態条件を維持する", async () => {
    const alpha = await create("AAA", "[UNIT_TEST_192_PAGE]Alpha");
    const inactive = await create("BBB", "[UNIT_TEST_192_PAGE]Inactive");
    const charlie = await create("CCC", "[UNIT_TEST_192_PAGE]Charlie");
    const delta = await create("DDD", "[UNIT_TEST_192_PAGE]Delta");
    const disabled = await call("PATCH", `${BASE}/${inactive.id}/status`, {
      active: false,
      version: 1,
    });
    expect(disabled.status).toBe(200);
    const cases = [
      {
        path: BASE,
        status: "active",
        expected: [alpha.id, charlie.id, delta.id],
      },
      {
        path: "/api/clients",
        status: null,
        expected: [alpha.id, inactive.id, charlie.id, delta.id],
      },
      {
        path: "/api/clients/candidates",
        status: null,
        expected: [alpha.id, charlie.id, delta.id],
      },
    ];
    for (const item of cases) {
      const params = new URLSearchParams({
        q: "UNIT_TEST_192_PAGE",
        limit: "2",
      });
      if (item.status) params.set("status", item.status);
      const firstResponse = await call("GET", `${item.path}?${params}`);
      expect(firstResponse.status, item.path).toBe(200);
      const first = (await firstResponse.json()) as Page;
      expect(first.items.map((client) => client.id)).toEqual(
        item.expected.slice(0, 2),
      );
      expect(first.nextCursor, item.path).toEqual(expect.any(String));
      params.set("cursor", first.nextCursor!);
      const secondResponse = await call("GET", `${item.path}?${params}`);
      expect(secondResponse.status, item.path).toBe(200);
      const second = (await secondResponse.json()) as Page;
      expect(second.items.map((client) => client.id)).toEqual(
        item.expected.slice(2),
      );
      expect(second.nextCursor, item.path).toBeNull();
      const ids = [...first.items, ...second.items].map((client) => client.id);
      expect(ids).toEqual(item.expected);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
describe("#192 AC-3・AC-4・AC-8: 対象と版の失敗境界", () => {
  it("#192 AC-3・AC-4: 正しいULIDでも未登録なら改名と無効化は404", async () => {
    const missing = "00000000000000000000000001";
    const cases = [
      {
        path: `${BASE}/${missing}`,
        body: { name: "[UNIT_TEST_192_MISSING]Name", version: 1 },
      },
      {
        path: `${BASE}/${missing}/status`,
        body: { active: false, version: 1 },
      },
    ];
    for (const item of cases) {
      const response = await call("PATCH", item.path, item.body);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("#192 AC-3・AC-4・AC-8: version2更新は成功し、旧版と無効化後操作は409で状態と監査を変えない", async () => {
    const renamed = await create("AAA", "[UNIT_TEST_192_VERSION]Alpha");
    const status = await create("BBB", "[UNIT_TEST_192_VERSION]Beta");
    const firstRename = await call("PATCH", `${BASE}/${renamed.id}`, {
      name: "[UNIT_TEST_192_VERSION]Alpha2",
      version: 1,
    });
    expect(firstRename.status).toBe(200);
    const secondRename = await call("PATCH", `${BASE}/${renamed.id}`, {
      name: "[UNIT_TEST_192_VERSION]Alpha3",
      version: 2,
    });
    expect(secondRename.status).toBe(200);
    expect(await secondRename.json()).toMatchObject({
      id: renamed.id,
      name: "[UNIT_TEST_192_VERSION]Alpha3",
      active: true,
      version: 3,
    });
    const prepared = await call("PATCH", `${BASE}/${status.id}`, {
      name: "[UNIT_TEST_192_VERSION]Beta2",
      version: 1,
    });
    expect(prepared.status).toBe(200);
    const auditBefore = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE target_id = ?",
    )
      .bind(status.id)
      .first<{ n: number }>();
    const stale = await call("PATCH", `${BASE}/${status.id}/status`, {
      active: false,
      version: 1,
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "CONFLICT" });
    expect(
      (await page("?q=BBB")).items.find((item) => item.id === status.id),
    ).toMatchObject({
      name: "[UNIT_TEST_192_VERSION]Beta2",
      active: true,
      version: 2,
    });
    const auditAfterStale = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE target_id = ?",
    )
      .bind(status.id)
      .first<{ n: number }>();
    expect(auditAfterStale?.n).toBe(auditBefore?.n);
    const disabled = await call("PATCH", `${BASE}/${status.id}/status`, {
      active: false,
      version: 2,
    });
    expect(disabled.status).toBe(200);
    expect(await disabled.json()).toMatchObject({
      id: status.id,
      name: "[UNIT_TEST_192_VERSION]Beta2",
      active: false,
      version: 3,
    });
    const auditBeforeInactive = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE target_id = ?",
    )
      .bind(status.id)
      .first<{ n: number }>();
    const renameInactive = await call("PATCH", `${BASE}/${status.id}`, {
      name: "[UNIT_TEST_192_VERSION]Beta3",
      version: 3,
    });
    const disableAgain = await call("PATCH", `${BASE}/${status.id}/status`, {
      active: false,
      version: 3,
    });
    for (const response of [renameInactive, disableAgain]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "CONFLICT" });
    }
    expect(
      (await page("?q=BBB")).items.find((item) => item.id === status.id),
    ).toMatchObject({
      name: "[UNIT_TEST_192_VERSION]Beta2",
      active: false,
      version: 3,
    });
    const auditAfterInactive = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE target_id = ?",
    )
      .bind(status.id)
      .first<{ n: number }>();
    expect(auditAfterInactive?.n).toBe(auditBeforeInactive?.n);
  });
});

describe("#192 AC-8: 非UNIQUE DB障害の安全な失敗", () => {
  it("#192 AC-2・AC-8: 登録の非UNIQUE障害は500で保存・成功監査・入力を漏らさない", async () => {
    const trigger = "unit_test_192_client_create_abort";
    const name = "[UNIT_TEST_192_FAIL]Create";
    const before = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE target_type = 'client' AND action = 'client.create'",
    ).first<{ n: number }>();
    await env.DB.prepare(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON clients
       WHEN NEW.code = 'QQQ'
       BEGIN SELECT RAISE(ABORT, 'unit_test_192_nonunique_create'); END`,
    ).run();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await call("POST", BASE, { code: "QQQ", name });
      const row = await env.DB.prepare(
        "SELECT id FROM clients WHERE code = 'QQQ'",
      ).first<{ id: string }>();
      if (row) createdIds.add(row.id);
      expect(response.status).toBe(500);
      const body = await response.text();
      expect(body).not.toContain("CONFLICT");
      expect(body).not.toContain("unit_test_192_nonunique_create");
      expect(body).not.toContain(name);
      expect(row).toBeNull();
      const after = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM audit_logs WHERE target_type = 'client' AND action = 'client.create'",
      ).first<{ n: number }>();
      expect(after?.n).toBe(before?.n);
      const logged = errorSpy.mock.calls.flat().map(String).join("\n");
      expect(logged).not.toContain(name);
      expect(logged).not.toMatch(/INSERT INTO clients/i);
    } finally {
      await env.DB.prepare(`DROP TRIGGER ${trigger}`).run();
    }
  });

  it("#192 AC-3・AC-8: 改名の非UNIQUE障害は500で名前・版・監査を戻し入力を漏らさない", async () => {
    const client = await create("QQQ", "[UNIT_TEST_192_FAIL]Original");
    expect(client.id).toMatch(/^[0-9A-Z]{26}$/);
    const trigger = "unit_test_192_client_rename_abort";
    const name = "[UNIT_TEST_192_FAIL]Changed";
    const before = await env.DB.prepare(
      "SELECT name, name_normalized, is_active, version FROM clients WHERE id = ?",
    )
      .bind(client.id)
      .first();
    const auditBefore = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE target_id = ?",
    )
      .bind(client.id)
      .first<{ n: number }>();
    await env.DB.prepare(
      `CREATE TRIGGER ${trigger} BEFORE UPDATE ON clients
       WHEN OLD.id = '${client.id}'
       BEGIN SELECT RAISE(ABORT, 'unit_test_192_nonunique_rename'); END`,
    ).run();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await call("PATCH", `${BASE}/${client.id}`, {
        name,
        version: 1,
      });
      expect(response.status).toBe(500);
      const body = await response.text();
      expect(body).not.toContain("CONFLICT");
      expect(body).not.toContain("unit_test_192_nonunique_rename");
      expect(body).not.toContain(name);
      const after = await env.DB.prepare(
        "SELECT name, name_normalized, is_active, version FROM clients WHERE id = ?",
      )
        .bind(client.id)
        .first();
      expect(after).toEqual(before);
      const auditAfter = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM audit_logs WHERE target_id = ?",
      )
        .bind(client.id)
        .first<{ n: number }>();
      expect(auditAfter?.n).toBe(auditBefore?.n);
      const logged = errorSpy.mock.calls.flat().map(String).join("\n");
      expect(logged).not.toContain(name);
      expect(logged).not.toMatch(/UPDATE clients/i);
    } finally {
      await env.DB.prepare(`DROP TRIGGER ${trigger}`).run();
    }
  });
  it.each([
    ["ゼロ", { name: "[UNIT_TEST_192_VERSION]Changed", version: 0 }],
    ["小数", { name: "[UNIT_TEST_192_VERSION]Changed", version: 1.5 }],
    ["欠落", { name: "[UNIT_TEST_192_VERSION]Changed" }],
  ])(
    "#192 AC-3・AC-8: 改名versionのゼロ・小数・欠落（%s）は422で状態と監査を変えない",
    async (_label, body) => {
      const client = await create("ABC", "[UNIT_TEST_192_VERSION]Original");
      const before = await env.DB.prepare(
        "SELECT name, name_normalized, is_active, version FROM clients WHERE id = ?",
      )
        .bind(client.id)
        .first();
      const auditBefore = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM audit_logs WHERE target_id = ?",
      )
        .bind(client.id)
        .first<{ n: number }>();
      const response = await call("PATCH", BASE + "/" + client.id, body);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        code: "VALIDATION_ERROR",
        fields: ["version"],
      });
      const after = await env.DB.prepare(
        "SELECT name, name_normalized, is_active, version FROM clients WHERE id = ?",
      )
        .bind(client.id)
        .first();
      expect(after).toEqual(before);
      const auditAfter = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM audit_logs WHERE target_id = ?",
      )
        .bind(client.id)
        .first<{ n: number }>();
      expect(auditAfter?.n).toBe(auditBefore?.n);
    },
  );
});
