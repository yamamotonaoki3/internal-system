// #199: アカウントの個別発行と一覧の管理API（/api/admin/accounts）を、実際の入口（index.ts の app）と隔離 D1 で確かめる。
// PII_ENCRYPTION_KEY・LOGIN_THROTTLE_KEY はテストの中で乱数から作る（実際の値をファイルに書かない）。
// データは架空（testuser_、[UNIT_TEST]、@example.com、テスト太郎）。
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
import { newPiiKey, newSetupToken } from "../../test/random-secrets";
import {
  cleanupRoleTestData,
  countRows,
  insertAssignment,
  insertDepartment,
  insertUser,
  testId,
} from "../../test/role-fixtures";
import { loadConfig } from "../config";
import { app } from "../index";
import { decryptLegalName } from "../lib/pii-crypto";
import { verifyPassword } from "../lib/password";
import { ROLE_IDS } from "../lib/permissions";

const ORIGIN = loadConfig(env).allowedOrigins[0] ?? "";
const BASE = "/api/admin/accounts";
const ACTION = "account.create";
const LEGAL = "テスト太郎";

let throttleKey: string;
let piiKey: string;
let logLines: string[];
let departmentId: string;
let inactiveDepartmentId: string;
let adminId: string;
let adminToken: string;
let ownerToken: string;
let memberToken: string;

type CreatedAccount = {
  id: string;
  loginId: string;
  displayName: string;
  departmentId: string;
  mustChangePassword: boolean;
  createdAt: string;
  initialPassword: string;
};

type ListItem = Record<string, unknown> & { loginId: string };

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    loginId: "testuser_acct_101",
    legalName: LEGAL,
    displayName: LEGAL,
    email: "testuser_acct_101@example.com",
    emailConfirmed: true,
    departmentId,
    extension: "0000",
    jobTitle: "課長",
    ...overrides,
  };
}

function omit(body: Record<string, unknown>, ...keys: string[]) {
  return Object.fromEntries(
    Object.entries(body).filter(([k]) => !keys.includes(k)),
  );
}

function envWith(overrides: Record<string, unknown> = {}) {
  return {
    ...env,
    LOGIN_THROTTLE_KEY: throttleKey,
    SETUP_TOKEN: newSetupToken(),
    PII_ENCRYPTION_KEY: piiKey,
    ...overrides,
  } as unknown as Env;
}

async function request(
  method: string,
  path: string,
  options: {
    token?: string;
    body?: unknown;
    origin?: string;
    env?: Env;
  } = {},
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
    options.env ?? envWith(),
  );
}

const post = (body: unknown, token = adminToken, extra = {}) =>
  request("POST", BASE, { token, body, ...extra });

async function createOk(overrides: Record<string, unknown> = {}) {
  const res = await post(validBody(overrides));
  expect(res.status).toBe(201);
  return (await res.json()) as CreatedAccount;
}

async function snapshot() {
  const audit = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM audit_logs WHERE action = ?",
  )
    .bind(ACTION)
    .first<{ n: number }>();
  return { users: await countRows("users"), audits: audit?.n ?? 0 };
}

beforeEach(async () => {
  throttleKey = newThrottleKey();
  piiKey = newPiiKey();
  logLines = [];
  const capture = (...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  departmentId = await insertDepartment("アカウント発行テスト部署");
  inactiveDepartmentId = await insertDepartment("アカウント発行テスト無効部署");
  await env.DB.prepare("UPDATE departments SET is_active = 0 WHERE id = ?")
    .bind(inactiveDepartmentId)
    .run();
  adminId = await insertUser("testuser_acct_admin", departmentId);
  const owner = await insertUser("testuser_acct_owner", departmentId);
  const member = await insertUser("testuser_acct_member", departmentId);
  await env.DB.prepare(
    "UPDATE users SET must_change_password = 0 WHERE id IN (?, ?, ?)",
  )
    .bind(adminId, owner, member)
    .run();
  await insertAssignment(adminId, ROLE_IDS.globalAdmin, "company", null);
  await insertAssignment(owner, ROLE_IDS.owner, "department", departmentId);
  await insertAssignment(member, ROLE_IDS.member, "company", null);
  const now = new Date().toISOString();
  adminToken = (await insertSession(adminId, { createdAt: now })).token;
  ownerToken = (await insertSession(owner, { createdAt: now })).token;
  memberToken = (await insertSession(member, { createdAt: now })).token;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await env.DB.exec("DROP TRIGGER IF EXISTS unit_fail_account_audit_route");
  const bucketKeys = await Promise.all(
    [TEST_IP, "testuser_acct_101", "testuser_acct_login"].map((v) =>
      hmacHex(throttleKey, v),
    ),
  );
  // 子テーブル（sessions・audit_logs・login_attempts）を先に消し、利用者・部署を識別子で消す
  await env.DB.prepare(
    "DELETE FROM audit_logs WHERE action = ? AND target_id IN (SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!')",
  )
    .bind(ACTION)
    .run();
  await cleanupAuthTestData(bucketKeys);
  await cleanupRoleTestData();
});

describe("#199 POST /api/admin/accounts：認可", () => {
  it("#199 AC-1: 未ログインは401で、何も作らない", async () => {
    const before = await snapshot();
    const res = await request("POST", BASE, { body: validBody() });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    ["オーナー", () => ownerToken],
    ["一般社員", () => memberToken],
  ])(
    "#199 AC-1: %sは発行できず403 FORBIDDEN、DBは変わらない",
    async (_l, token) => {
      const before = await snapshot();
      const res = await post(validBody(), token());
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "FORBIDDEN" });
      expect(await snapshot()).toEqual(before);
    },
  );

  it.each([
    ["オーナー", () => ownerToken],
    ["一般社員", () => memberToken],
  ])(
    "#199 AC-1: %sが不正な本文を送っても、422ではなく403（認可が入力検証より先）",
    async (_l, token) => {
      for (const body of [{}, { loginId: "x" }, validBody({ extra: 1 })]) {
        const res = await post(body, token());
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ code: "FORBIDDEN" });
      }
    },
  );

  it("#199 AC-1: 許可していないOriginは403 FORBIDDEN_ORIGIN で、何も作らない", async () => {
    const before = await snapshot();
    const res = await post(validBody(), adminToken, {
      origin: "https://origin.test.invalid",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
    expect(await snapshot()).toEqual(before);
  });
});

describe(
  "#199 POST /api/admin/accounts：発行の成功",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it("#199 AC-3: 201・no-store。決めた項目と初期パスワードだけを返し、本名・メールを返さない", async () => {
      const res = await post(validBody());
      expect(res.status).toBe(201);
      expect(res.headers.get("Cache-Control")).toContain("no-store");
      const text = await res.text();
      const body = JSON.parse(text) as CreatedAccount;
      expect(Object.keys(body).sort()).toEqual([
        "createdAt",
        "departmentId",
        "displayName",
        "id",
        "initialPassword",
        "loginId",
        "mustChangePassword",
      ]);
      expect(body).toMatchObject({
        loginId: "testuser_acct_101",
        displayName: LEGAL,
        departmentId,
        mustChangePassword: true,
      });
      expect(text).not.toContain("testuser_acct_101@example.com");
      expect(text).not.toContain("legalName");
      expect(text).not.toContain(piiKey);
      // 初期パスワードの要件（setup と同じ generateInitialPassword）
      expect(body.initialPassword).toHaveLength(16);
      expect(body.initialPassword).toMatch(/[A-Z]/);
      expect(body.initialPassword).toMatch(/[a-z]/);
      expect(body.initialPassword).toMatch(/[0-9]/);
      expect(body.initialPassword).toMatch(/[^A-Za-z0-9]/);
    });

    it("#199 AC-1・AC-2・AC-4: 表示名は本名と別に入力でき、所属は指定した1部署", async () => {
      const body = await createOk({ displayName: "テスト表示名" });
      const row = await env.DB.prepare(
        "SELECT display_name, department_id FROM users WHERE id = ?",
      )
        .bind(body.id)
        .first<{ display_name: string; department_id: string }>();
      expect(row).toEqual({
        display_name: "テスト表示名",
        department_id: departmentId,
      });
    });

    it("#199 AC-3: password_hash は平文と違い照合でき、初回変更が必要。本名は暗号文で、復号すると元に戻る", async () => {
      const body = await createOk();
      const row = await env.DB.prepare(
        "SELECT password_hash, legal_name, must_change_password, is_active FROM users WHERE id = ?",
      )
        .bind(body.id)
        .first<Record<string, string | number>>();
      const hash = String(row?.password_hash);
      expect(hash).toMatch(/^\$scrypt\$/);
      expect(hash).not.toBe(body.initialPassword);
      expect(hash).not.toContain(body.initialPassword);
      expect(await verifyPassword(body.initialPassword, hash)).toBe(true);
      expect(row?.must_change_password).toBe(1);
      expect(row?.is_active).toBe(1);
      const legal = String(row?.legal_name);
      expect(legal).not.toContain(LEGAL);
      expect(await decryptLegalName(legal, piiKey, body.id)).toBe(LEGAL);
    });

    it("#199 AC-3（0-1 AC-3）: email_verified_by は操作した管理者、email_verified_at を記録する", async () => {
      const before = Date.now();
      const body = await createOk();
      const row = await env.DB.prepare(
        "SELECT email_verified_by, email_verified_at FROM users WHERE id = ?",
      )
        .bind(body.id)
        .first<{ email_verified_by: string; email_verified_at: string }>();
      expect(row?.email_verified_by).toBe(adminId);
      const at = Date.parse(row?.email_verified_at ?? "");
      expect(at).toBeGreaterThanOrEqual(before - 1000);
      expect(at).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it("#199 AC-3（0-1 AC-5）: 監査ログ account.create を1件。detail に本名・メール・初期パスワードを含めない", async () => {
      const body = await createOk();
      const { results } = await env.DB.prepare(
        "SELECT actor_id, target_type, target_id, result, detail FROM audit_logs WHERE action = ? AND target_id = ?",
      )
        .bind(ACTION, body.id)
        .all<Record<string, string | null>>();
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        actor_id: adminId,
        target_type: "user",
        result: "success",
      });
      const raw = results[0]?.detail ?? "";
      expect(JSON.parse(raw || "{}")).toEqual({
        departmentId,
        emailVerification: "admin",
      });
      for (const secret of [
        LEGAL,
        "testuser_acct_101@example.com",
        body.initialPassword,
      ])
        expect(raw).not.toContain(secret);
    });

    it("#199 AC-3: 初期パスワードは、ログ・audit_logs の全行・users の全列のどこにも平文で出ない", async () => {
      // 表示名を本名と別の値にし、本名が users のどの列にも平文で入らないことを確かめる
      const body = await createOk({ displayName: "テスト表示" });
      const out = logLines.join("\n");
      for (const secret of [
        body.initialPassword,
        LEGAL,
        "testuser_acct_101@example.com",
        piiKey,
      ])
        expect(out).not.toContain(secret);
      const audits = await env.DB.prepare("SELECT * FROM audit_logs").all();
      expect(JSON.stringify(audits.results)).not.toContain(
        body.initialPassword,
      );
      const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?")
        .bind(body.id)
        .first();
      const userText = JSON.stringify(user);
      expect(userText).not.toContain(body.initialPassword);
      expect(userText).not.toContain(LEGAL);
    });

    it("#199 AC-3: 発行したユーザーIDと初期パスワードでログインでき、mustChangePassword が true", async () => {
      const body = await createOk({
        loginId: "testuser_acct_login",
        email: "testuser_acct_login@example.com",
      });
      const res = await app.request(
        "/api/auth/login",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: ORIGIN,
            "CF-Connecting-IP": TEST_IP,
            "X-Request-Id": `${AUTH_TRACE_PREFIX}${crypto.randomUUID()}`,
          },
          body: JSON.stringify({
            loginId: "testuser_acct_login",
            password: body.initialPassword,
          }),
        },
        envWith(),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ mustChangePassword: true });
    });

    it("#199 AC-2: 内線・役職は省略できる", async () => {
      const res = await post(omit(validBody(), "extension", "jobTitle"));
      expect(res.status).toBe(201);
    });

    it("#199 AC-3: 監査の書き込みが失敗すると500で、利用者も残らず、初期パスワードを返さない", async () => {
      await env.DB.exec(
        `CREATE TRIGGER unit_fail_account_audit_route BEFORE INSERT ON audit_logs WHEN NEW.action = '${ACTION}' BEGIN SELECT RAISE(ABORT, 'unit test failure'); END`,
      );
      const before = await snapshot();
      const res = await post(validBody());
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(text).not.toMatch(/initialPassword/);
      expect(text).not.toContain("unit test failure");
      expect(await snapshot()).toEqual(before);
    });

    it("#199 AC-3: PII_ENCRYPTION_KEY が使えないときは503で、何も作らない", async () => {
      const before = await snapshot();
      const res = await post(validBody(), adminToken, {
        env: envWith({ PII_ENCRYPTION_KEY: undefined }),
      });
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        message:
          "アカウントの登録は現在使えません。運用担当者に連絡してください",
      });
      expect(await snapshot()).toEqual(before);
    });
  },
);

describe(
  "#199 POST /api/admin/accounts：入力の検証",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it.each<[string, Record<string, unknown>, string]>([
      ["ユーザーID 2文字", { loginId: "ab" }, "loginId"],
      ["ユーザーID 33文字", { loginId: "a".repeat(33) }, "loginId"],
      ["ユーザーIDの記号", { loginId: "test@user" }, "loginId"],
      ["本名 空", { legalName: "" }, "legalName"],
      ["本名 51文字", { legalName: "テ".repeat(51) }, "legalName"],
      ["本名の制御文字", { legalName: "テスト\n太郎" }, "legalName"],
      ["表示名 空", { displayName: "  " }, "displayName"],
      ["表示名 31文字", { displayName: "テ".repeat(31) }, "displayName"],
      ["メールの形式", { email: "testuser_acct_101" }, "email"],
      ["内線 11文字", { extension: "0".repeat(11) }, "extension"],
      ["内線の英字", { extension: "12a" }, "extension"],
      ["内線 空", { extension: "" }, "extension"],
      ["役職 31文字", { jobTitle: "課".repeat(31) }, "jobTitle"],
      ["部署IDの形式", { departmentId: "not-a-ulid" }, "departmentId"],
    ])("#199 AC-2: %sは422 VALIDATION_ERROR", async (_l, override, field) => {
      const before = await snapshot();
      const res = await post(validBody(override));
      expect(res.status).toBe(422);
      const body = (await res.json()) as { code: string; fields: string[] };
      expect(body.code).toBe("VALIDATION_ERROR");
      expect(body.fields).toContain(field);
      expect(await snapshot()).toEqual(before);
    });

    it("#199 AC-2: 本名50文字・表示名30文字・ユーザーID 32文字は発行できる（3文字の境界は単体で確かめる）", async () => {
      // ユーザーIDは testuser_ の接頭辞を保つため、32文字の境界で確かめる
      const body = await createOk({
        loginId: "testuser_".padEnd(32, "a"),
        email: "testuser_b2@example.com",
        legalName: "テ".repeat(50),
        displayName: "テ".repeat(30),
      });
      expect(body.loginId).toHaveLength(32);
    });

    it.each([
      [
        "emailConfirmed なし",
        (b: Record<string, unknown>) => omit(b, "emailConfirmed"),
      ],
      [
        "emailConfirmed false",
        (b: Record<string, unknown>) => ({ ...b, emailConfirmed: false }),
      ],
    ])("#199 AC-3: %sは422（fields に emailConfirmed）", async (_l, make) => {
      const res = await post(make(validBody()));
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        code: "VALIDATION_ERROR",
        fields: expect.arrayContaining(["emailConfirmed"]) as unknown,
      });
    });

    it("#199 AC-2: 余分な項目は422", async () => {
      const res = await post(validBody({ role: "global_admin" }));
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it.each([
      ["部署なし", () => omit(validBody(), "departmentId")],
      ["存在しない部署", () => validBody({ departmentId: testId("NODEPT") })],
      ["無効な部署", () => validBody({ departmentId: inactiveDepartmentId })],
    ])(
      "#199 AC-1（V-12）: %sは422（fields に departmentId）で、何も作らない",
      async (_l, make) => {
        const before = await snapshot();
        const res = await post(make());
        expect(res.status).toBe(422);
        expect(await res.json()).toMatchObject({
          code: "VALIDATION_ERROR",
          fields: ["departmentId"],
        });
        expect(await snapshot()).toEqual(before);
      },
    );
  },
);

describe(
  "#199 POST /api/admin/accounts：重複",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it("#199 AC-2（V-01）: 大小だけが違うユーザーIDは409 CONFLICT。値をエコーしない", async () => {
      await createOk();
      const before = await snapshot();
      const res = await post(
        validBody({
          loginId: "TESTUSER_ACCT_101",
          email: "testuser_acct_other@example.com",
        }),
      );
      expect(res.status).toBe(409);
      const text = await res.text();
      expect(JSON.parse(text)).toMatchObject({
        code: "CONFLICT",
        message: "そのユーザーIDはすでに使われています",
      });
      expect(text).not.toContain("TESTUSER_ACCT_101");
      expect(text).not.toMatch(/initialPassword/);
      expect(await snapshot()).toEqual(before);
    });

    it("#199 AC-2（V-06・A-2）: 大小だけが違うメールも409 CONFLICT。値をエコーしない", async () => {
      await createOk();
      const res = await post(
        validBody({
          loginId: "testuser_acct_102",
          email: "TestUser_Acct_101@Example.COM",
        }),
      );
      expect(res.status).toBe(409);
      const text = await res.text();
      expect(JSON.parse(text)).toMatchObject({
        code: "CONFLICT",
        message: "そのメールアドレスはすでに使われています",
      });
      expect(text.toLowerCase()).not.toContain("testuser_acct_101@example.com");
    });

    it("#199 AC-2（V-01）: 無効化済みのアカウントのユーザーIDも409", async () => {
      await insertUser("testuser_acct_gone", departmentId, { isActive: false });
      const res = await post(
        validBody({
          loginId: "TestUser_Acct_Gone",
          email: "testuser_acct_new@example.com",
        }),
      );
      expect(res.status).toBe(409);
    });

    it("#199 AC-2: 同じユーザーIDを同時に2件送ると、201と409が1件ずつで、監査は1件", async () => {
      const before = await snapshot();
      const results = await Promise.all([
        post(validBody({ email: "testuser_race_a@example.com" })),
        post(
          validBody({
            loginId: "TestUser_Acct_101",
            email: "testuser_race_b@example.com",
          }),
        ),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await snapshot()).toEqual({
        users: before.users + 1,
        audits: before.audits + 1,
      });
    });
  },
);

describe(
  "#199 GET /api/admin/accounts（一覧）",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it("#199 AC-5: limit を省略すると1ページ20件（PAGE_LIMIT.default）で、続きのカーソルを返す", async () => {
      for (let i = 0; i < 20; i += 1)
        await insertUser(
          `testuser_acct_page_${String(i).padStart(2, "0")}`,
          departmentId,
        );
      const res = await request("GET", BASE, { token: adminToken });
      expect(res.status).toBe(200);
      const page = (await res.json()) as {
        items: ListItem[];
        nextCursor: string | null;
      };
      expect(page.items).toHaveLength(20);
      expect(page.nextCursor).not.toBeNull();
    });

    it("#199 AC-1: 管理者以外は、/api/admin/accounts の下のどのパスにも403（存在しないパスでも404で教えない）", async () => {
      for (const token of [ownerToken, memberToken]) {
        const res = await request("GET", `${BASE}/unknown-path`, { token });
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ code: "FORBIDDEN" });
      }
    });

    it("#199 AC-5: 未ログインは401、オーナー・一般社員は403", async () => {
      expect((await request("GET", BASE)).status).toBe(401);
      for (const token of [ownerToken, memberToken]) {
        const res = await request("GET", BASE, { token });
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ code: "FORBIDDEN" });
      }
    });

    it("#199 AC-5（A-3）: 管理者は一覧を読め、項目はメールを含み本名を含まない", async () => {
      const created = await createOk();
      const res = await request("GET", `${BASE}?limit=100`, {
        token: adminToken,
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      const body = JSON.parse(text) as {
        items: ListItem[];
        nextCursor: string | null;
      };
      const item = body.items.find((i) => i.id === created.id);
      expect(item).toBeDefined();
      expect(Object.keys(item ?? {}).sort()).toEqual([
        "active",
        "createdAt",
        "department",
        "displayName",
        "email",
        "extension",
        "id",
        "jobTitle",
        "loginId",
        "mustChangePassword",
      ]);
      expect(item).toMatchObject({
        loginId: "testuser_acct_101",
        email: "testuser_acct_101@example.com",
        department: {
          id: departmentId,
          name: "[UNIT_TEST]アカウント発行テスト部署",
        },
        extension: "0000",
        jobTitle: "課長",
        active: true,
        mustChangePassword: true,
      });
      expect(text).not.toContain("legalName");
      expect(text).not.toContain("v1:");
      expect(text).not.toContain(created.initialPassword);
    });

    it("#199 AC-5: limit とカーソルで、重複も欠落もなく送れる", async () => {
      for (const n of ["3", "1", "2"])
        await createOk({
          loginId: `testuser_acct_l${n}`,
          email: `testuser_acct_l${n}@example.com`,
        });
      const seen: string[] = [];
      let url = `${BASE}?limit=1`;
      for (let i = 0; i < 100; i += 1) {
        const res = await request("GET", url, { token: adminToken });
        expect(res.status).toBe(200);
        const page = (await res.json()) as {
          items: ListItem[];
          nextCursor: string | null;
        };
        expect(page.items.length).toBeLessThanOrEqual(1);
        seen.push(...page.items.map((x) => x.loginId));
        if (page.nextCursor === null) break;
        url = `${BASE}?limit=1&cursor=${encodeURIComponent(page.nextCursor)}`;
      }
      expect(seen.filter((s) => s.startsWith("testuser_acct_l"))).toEqual([
        "testuser_acct_l1",
        "testuser_acct_l2",
        "testuser_acct_l3",
      ]);
      expect(new Set(seen).size).toBe(seen.length);
    });

    it.each([
      ["壊れたカーソル", "?cursor=!!!"],
      ["limit 0", "?limit=0"],
      ["limit 101", "?limit=101"],
    ])("#199 AC-5: %sは422", async (_l, query) => {
      const res = await request("GET", `${BASE}${query}`, {
        token: adminToken,
      });
      expect(res.status).toBe(422);
    });
  },
);

describe("#199 GET /api/admin/accounts/department-options", () => {
  it("#199 AC-1: 未ログインは401、オーナー・一般社員は403", async () => {
    expect((await request("GET", `${BASE}/department-options`)).status).toBe(
      401,
    );
    for (const token of [ownerToken, memberToken])
      expect(
        (await request("GET", `${BASE}/department-options`, { token })).status,
      ).toBe(403);
  });

  it("#199 AC-1（V-12）: 管理者には有効な部署の id・name だけを返し、無効な部署は出さない", async () => {
    const res = await request("GET", `${BASE}/department-options`, {
      token: adminToken,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { id: string; name: string }[];
    };
    const ids = body.items.map((i) => i.id);
    expect(ids).toContain(departmentId);
    expect(ids).not.toContain(inactiveDepartmentId);
    for (const item of body.items)
      expect(Object.keys(item).sort()).toEqual(["id", "name"]);
  });
});
