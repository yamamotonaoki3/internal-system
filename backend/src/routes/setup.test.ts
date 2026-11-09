// #119 AC-1・AC-2・AC-4：初代全体管理者の初回セットアップの API（GET /api/setup/status・POST /api/setup）。
// 結合のテスト：実際の入口（index.ts の app）を、本物と同じ実行エンジン（workerd）のローカルの D1 に対して呼ぶ。
// SETUP_TOKEN・PII_ENCRYPTION_KEY は、テストの中で乱数から作り、要求ごとの環境（env）に入れる（実際の値をファイルに書かない）。
// データは架空のもの（testuser_、[UNIT_TEST]、@example.com、テスト太郎）。
import { SCRYPT_TEST_TIMEOUT_MS } from "../../test/auth-fixtures";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  newPiiKey,
  newSetupToken,
  randomBase64Url,
} from "../../test/random-secrets";
import {
  TEST_TAG,
  countRows,
  insertDepartment,
  insertUser,
} from "../../test/role-fixtures";
import { loadConfig } from "../config";
import { app } from "../index";
import { decryptLegalName } from "../lib/pii-crypto";
import { verifyPassword } from "../lib/password";
import { ROLE_IDS } from "../lib/permissions";

const SETUP_ACTION = "setup.initial_admin.create";
const ALLOWED_ORIGIN = loadConfig(env).allowedOrigins[0] ?? "";

let token: string;
let piiKey: string;
let throttleKey: string;
let logLines: string[];

/** 要求ごとの環境。既定では、乱数のトークンと鍵を入れる */
function envWith(overrides: Record<string, unknown> = {}) {
  return {
    ...env,
    SETUP_TOKEN: token,
    PII_ENCRYPTION_KEY: piiKey,
    // #120：試行制限の鍵も、テストの中の乱数（.env.test の値に頼らない）
    LOGIN_THROTTLE_KEY: throttleKey,
    ...overrides,
  } as unknown as Env;
}

/** 指定した欄を除いた本文（欄の欠落を確かめる） */
function omit(body: Record<string, unknown>, ...keys: string[]) {
  return Object.fromEntries(
    Object.entries(body).filter(([k]) => !keys.includes(k)),
  );
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    setupToken: token,
    companyName: `${TEST_TAG}テスト株式会社`,
    departmentName: `${TEST_TAG}経営企画部`,
    loginId: "testuser_001",
    legalName: "テスト太郎",
    email: "testuser_001@example.com",
    emailConfirmed: true,
    extension: "0000",
    jobTitle: "代表取締役社長",
    ...overrides,
  };
}

// #120：POST /api/setup には接続元ごとの受付制限（setup_source）がある。制限そのものは setup-throttle.test.ts で確かめるため、
// ここでは要求ごとに別の接続元（文書用の範囲 192.0.2.0/24）を付けて、制限に当たらないようにする
let ipSequence = 0;
function nextTestIp() {
  ipSequence += 1;
  return `192.0.2.${(ipSequence % 254) + 1}`;
}

function post(
  body: unknown,
  options: { env?: Env; origin?: string | null } = {},
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const origin = options.origin === undefined ? ALLOWED_ORIGIN : options.origin;
  if (origin !== null) headers.Origin = origin;
  headers["CF-Connecting-IP"] = nextTestIp();
  return app.request(
    "/api/setup",
    { method: "POST", headers, body: JSON.stringify(body) },
    options.env ?? envWith(),
  );
}

const getStatus = (e: Env = envWith()) =>
  app.request("/api/setup/status", {}, e);

type SetupResponse = {
  user: { id: string; loginId: string; displayName: string };
  initialPassword: string;
};

/** セットアップで作られる表の件数（DB が変わっていないことを確かめる） */
async function snapshot() {
  const audit = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM audit_logs WHERE action = ?",
  )
    .bind(SETUP_ACTION)
    .first<{ n: number }>();
  return {
    companySettings: await countRows("company_settings"),
    departments: await countRows("departments"),
    users: await countRows("users"),
    assignments: await countRows("user_role_assignments"),
    auditLogs: audit?.n,
    // #196 AC-3（S-4 のB・S-12で承認）：初代部署の自動専用チャンネル2つと参加者も、同じ batch で作られ・取り消される
    rooms: await countRows("rooms"),
    channels: await countRows("channels"),
    channelMembers: await countRows("channel_members"),
  };
}
const EMPTY = {
  companySettings: 0,
  departments: 0,
  users: 0,
  assignments: 0,
  auditLogs: 0,
  rooms: 0,
  channels: 0,
  channelMembers: 0,
};

/** 出力されたログのうち、監査（log_type: audit）の記録 */
const auditLogLines = () =>
  // 共通ロガーは1行1件の JSON を出す。JSON でない行（ほかの出力）は対象外
  logLines
    .filter((l) => l.startsWith("{"))
    .map(
      (l) =>
        JSON.parse(l) as {
          body?: string;
          attributes?: Record<string, unknown>;
        },
    )
    .filter((l) => l.attributes?.log_type === "audit");

beforeEach(() => {
  token = newSetupToken();
  piiKey = newPiiKey();
  throttleKey = randomBase64Url(32);
  logLines = [];
  const capture = (...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await env.DB.exec("DROP TRIGGER IF EXISTS unit_fail_setup_assignment");
  await env.DB.exec("DROP TRIGGER IF EXISTS unit_fail_setup_audit");
  // このテストのデータだけを、識別子（[UNIT_TEST] の部署・会社名、セットアップの監査ログ）で消す（C-05）
  const testUsers = `SELECT id FROM users WHERE department_id IN (SELECT id FROM departments WHERE name LIKE '${TEST_TAG}%')`;
  // #196（S-4 のB）：初代部署の自動専用チャンネルとルーム・参加者を、外部キーの順で先に消す
  const testChannels = `SELECT room_id FROM channels WHERE department_id IN (SELECT id FROM departments WHERE name LIKE '${TEST_TAG}%')`;
  const { results: testRooms } = await env.DB.prepare(testChannels).all<{
    room_id: string;
  }>();
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM channel_members WHERE channel_id IN (${testChannels})`,
    ),
    env.DB.prepare(`DELETE FROM channels WHERE room_id IN (${testChannels})`),
    ...testRooms.map((room) =>
      env.DB.prepare("DELETE FROM rooms WHERE id = ?").bind(room.room_id),
    ),
  ]);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM audit_logs WHERE action = ?").bind(
      SETUP_ACTION,
    ),
    env.DB.prepare(
      `DELETE FROM user_role_assignments WHERE user_id IN (${testUsers})`,
    ),
    env.DB.prepare(`DELETE FROM users WHERE id IN (${testUsers})`),
    env.DB.prepare("DELETE FROM departments WHERE name LIKE ?").bind(
      `${TEST_TAG}%`,
    ),
    env.DB.prepare(
      "DELETE FROM company_settings WHERE company_name LIKE ?",
    ).bind(`${TEST_TAG}%`),
  ]);
  expect(await snapshot()).toEqual(EMPTY);
});

describe("GET /api/setup/status", { timeout: SCRYPT_TEST_TIMEOUT_MS }, () => {
  it("#119 AC-4: 全体管理者がいない間は setupRequired: true、no-store。未認証で呼べる", async () => {
    const res = await getStatus();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ setupRequired: true });
  });

  it("#119 AC-4: セットアップの後は setupRequired: false", async () => {
    expect((await post(validBody())).status).toBe(201);
    expect(await (await getStatus()).json()).toEqual({ setupRequired: false });
  });

  it("#119 AC-4: SETUP_TOKEN が未設定でも、状態は返す（setupRequired: true）", async () => {
    const res = await getStatus(envWith({ SETUP_TOKEN: undefined }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ setupRequired: true });
  });
});

describe("POST /api/setup：正常", { timeout: SCRYPT_TEST_TIMEOUT_MS }, () => {
  it("#119 AC-1・AC-4: 正しいトークンで 201、no-store。利用者・初期パスワードを一度だけ返し、トークン・本名・メールを返さない", async () => {
    const res = await post(validBody());
    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const text = await res.text();
    const body = JSON.parse(text) as SetupResponse;
    expect(Object.keys(body).sort()).toEqual(["initialPassword", "user"]);
    expect(Object.keys(body.user).sort()).toEqual([
      "displayName",
      "id",
      "loginId",
    ]);
    expect(body.user.loginId).toBe("testuser_001");
    // 初期表示名は本名と同じ値（0-4 AC-11）
    expect(body.user.displayName).toBe("テスト太郎");
    expect(text).not.toContain(token);
    expect(text).not.toContain(piiKey);
    expect(text).not.toContain("testuser_001@example.com");
    // 初期パスワードの要件（16文字・大小英数記号・紛らわしい文字なし）
    expect(body.initialPassword).toHaveLength(16);
    expect(body.initialPassword).toMatch(/[A-Z]/);
    expect(body.initialPassword).toMatch(/[a-z]/);
    expect(body.initialPassword).toMatch(/[0-9]/);
    expect(body.initialPassword).toMatch(/[^A-Za-z0-9]/);
    expect(body.initialPassword).not.toMatch(/[0Oo1lI]/);
  });

  it("#119 AC-1: 利用者の行：パスワードは PHC 形式のハッシュで初期パスワードと照合でき、初回変更が必要。本名は暗号化して保存する", async () => {
    const body = (await (await post(validBody())).json()) as SetupResponse;
    const row = await env.DB.prepare(
      "SELECT login_id, login_id_normalized, display_name, legal_name, email, email_normalized, password_hash, must_change_password, is_active, extension, job_title FROM users WHERE id = ?",
    )
      .bind(body.user.id)
      .first<Record<string, string | number | null>>();
    expect(row).not.toBeNull();
    expect(row?.login_id).toBe("testuser_001");
    expect(row?.login_id_normalized).toBe("testuser_001");
    expect(row?.email_normalized).toBe("testuser_001@example.com");
    expect(row?.must_change_password).toBe(1);
    expect(row?.is_active).toBe(1);
    expect(row?.extension).toBe("0000");
    expect(row?.job_title).toBe("代表取締役社長");
    const hash = String(row?.password_hash);
    expect(hash).toMatch(/^\$scrypt\$ln=16,r=8,p=2\$/);
    expect(hash).not.toContain(body.initialPassword);
    expect(await verifyPassword(body.initialPassword, hash)).toBe(true);
    const legal = String(row?.legal_name);
    expect(legal).toMatch(/^v1:/);
    expect(legal).not.toContain("テスト太郎");
    expect(await decryptLegalName(legal, piiKey, body.user.id)).toBe(
      "テスト太郎",
    );
  });

  it("#119 AC-2: 会社名を1件保存し、部署を作り、管理者はその部署に所属して、全体管理者（会社範囲）とその部署のオーナー（部署範囲）の両方の割り当てを持つ", async () => {
    const body = (await (await post(validBody())).json()) as SetupResponse;
    const company = await env.DB.prepare(
      "SELECT id, company_name FROM company_settings",
    ).all<{ id: string; company_name: string }>();
    expect(company.results).toEqual([
      { id: "company", company_name: `${TEST_TAG}テスト株式会社` },
    ]);
    const dept = await env.DB.prepare(
      "SELECT d.id, d.name, d.is_active FROM departments d JOIN users u ON u.department_id = d.id WHERE u.id = ?",
    )
      .bind(body.user.id)
      .first<{ id: string; name: string; is_active: number }>();
    expect(dept?.name).toBe(`${TEST_TAG}経営企画部`);
    expect(dept?.is_active).toBe(1);
    const { results } = await env.DB.prepare(
      "SELECT role_id, scope_type, department_id FROM user_role_assignments WHERE user_id = ? ORDER BY role_id",
    )
      .bind(body.user.id)
      .all();
    expect(results).toEqual([
      {
        role_id: ROLE_IDS.globalAdmin,
        scope_type: "company",
        department_id: null,
      },
      {
        role_id: ROLE_IDS.owner,
        scope_type: "department",
        department_id: dept?.id,
      },
    ]);
  });

  it("#196 AC-3（S-4 のB・7-1 AC-1）: セットアップで、初代部署の公開の通常とお知らせのチャンネルができ、所属する初代管理者が両方に参加する", async () => {
    const body = (await (await post(validBody())).json()) as SetupResponse;
    const department = await env.DB.prepare(
      "SELECT department_id FROM users WHERE id = ?",
    )
      .bind(body.user.id)
      .first<{ department_id: string }>();
    const { results } = await env.DB.prepare(
      "SELECT room_id, name, name_normalized, description, visibility, purpose, deleted_at FROM channels WHERE department_id = ? ORDER BY purpose",
    )
      .bind(department?.department_id)
      .all<Record<string, string | null>>();
    expect(
      results.map((row) =>
        Object.fromEntries(
          Object.entries(row).filter(([key]) => key !== "room_id"),
        ),
      ),
    ).toEqual([
      {
        name: `${TEST_TAG}経営企画部のお知らせ`,
        name_normalized: `${TEST_TAG}経営企画部のお知らせ`.toLowerCase(),
        description: "",
        visibility: "public",
        purpose: "announcement",
        deleted_at: null,
      },
      {
        name: `${TEST_TAG}経営企画部`,
        name_normalized: `${TEST_TAG}経営企画部`.toLowerCase(),
        description: "",
        visibility: "public",
        purpose: "department",
        deleted_at: null,
      },
    ]);
    for (const channel of results) {
      const rooms = await env.DB.prepare("SELECT kind FROM rooms WHERE id = ?")
        .bind(channel.room_id)
        .all<{ kind: string }>();
      expect(rooms.results).toEqual([{ kind: "channel" }]);
      const members = await env.DB.prepare(
        "SELECT user_id FROM channel_members WHERE channel_id = ?",
      )
        .bind(channel.room_id)
        .all<{ user_id: string }>();
      expect(members.results).toEqual([{ user_id: body.user.id }]);
    }
  });

  it("#119 AC-1: メールアドレスは自己確認：email_verified_by は作った利用者のID、email_verified_at は created_at と同じ値（改訂版 3.5）", async () => {
    const body = (await (await post(validBody())).json()) as SetupResponse;
    const row = await env.DB.prepare(
      "SELECT email_verified_by, email_verified_at, created_at FROM users WHERE id = ?",
    )
      .bind(body.user.id)
      .first<{
        email_verified_by: string;
        email_verified_at: string;
        created_at: string;
      }>();
    expect(row?.email_verified_by).toBe(body.user.id);
    expect(row?.email_verified_at).toBeTruthy();
    expect(row?.email_verified_at).toBe(row?.created_at);
  });

  it("#119 AC-1: 監査ログに成功を1件記録する。操作者は作った利用者、detail に emailVerification: self、本名・メール・パスワード・トークンを含めない", async () => {
    const body = (await (await post(validBody())).json()) as SetupResponse;
    const { results } = await env.DB.prepare(
      "SELECT actor_id, action, result, detail FROM audit_logs WHERE action = ?",
    )
      .bind(SETUP_ACTION)
      .all<{
        actor_id: string;
        action: string;
        result: string;
        detail: string | null;
      }>();
    expect(results).toHaveLength(1);
    expect(results[0]?.actor_id).toBe(body.user.id);
    expect(results[0]?.result).toBe("success");
    const detail = JSON.parse(results[0]?.detail ?? "{}") as Record<
      string,
      unknown
    >;
    expect(detail.emailVerification).toBe("self");
    const raw = results[0]?.detail ?? "";
    for (const secret of [
      "テスト太郎",
      "testuser_001@example.com",
      body.initialPassword,
      token,
      piiKey,
    ])
      expect(raw).not.toContain(secret);
  });

  it("#119 AC-1: ログに、トークン・初期パスワード・本名・メール・暗号鍵が出ない", async () => {
    const body = (await (await post(validBody())).json()) as SetupResponse;
    const out = logLines.join("\n");
    for (const secret of [
      token,
      piiKey,
      body.initialPassword,
      "テスト太郎",
      "testuser_001@example.com",
    ])
      expect(out).not.toContain(secret);
  });

  it("#119 AC-1: 内線・役職は省略できる", async () => {
    const rest = omit(validBody(), "extension", "jobTitle");
    expect((await post(rest)).status).toBe(201);
  });
});

describe(
  "POST /api/setup：一度だけ",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it("#119 AC-1: 成功の後は、正しいトークンでも 409（CONFLICT）で、利用者の件数は変わらない", async () => {
      expect((await post(validBody())).status).toBe(201);
      const before = await snapshot();
      const res = await post(
        validBody({
          loginId: "testuser_002",
          email: "testuser_002@example.com",
        }),
      );
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "CONFLICT" });
      expect(await snapshot()).toEqual(before);
    });

    it("#119 AC-1: 5件を同時に送ると、201 は1件だけで、残りは 409。全体管理者・会社の設定・成功の監査ログは各1件", async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          post(
            validBody({
              loginId: `testuser_10${i}`,
              email: `testuser_10${i}@example.com`,
              departmentName: `${TEST_TAG}部署${i}`,
            }),
          ),
        ),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409]);
      expect(await snapshot()).toEqual({
        companySettings: 1,
        departments: 1,
        users: 1,
        assignments: 2,
        auditLogs: 1,
        rooms: 2,
        channels: 2,
        channelMembers: 2,
      });
      const admins = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM user_role_assignments WHERE role_id = ?",
      )
        .bind(ROLE_IDS.globalAdmin)
        .first<{ n: number }>();
      expect(admins?.n).toBe(1);
    });
  },
);

describe(
  "POST /api/setup：db.batch の原子性",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it("#119 AC-1: 途中の文（割り当て）が失敗すると、会社の設定・部署・利用者・監査ログもすべて残らない", async () => {
      // 割り当ての挿入だけを、テスト専用のトリガーで失敗させる
      await env.DB.exec(
        "CREATE TRIGGER unit_fail_setup_assignment BEFORE INSERT ON user_role_assignments BEGIN SELECT RAISE(ABORT, 'unit test failure'); END",
      );
      const res = await post(validBody());
      expect(res.status).not.toBe(201);
      expect(await snapshot()).toEqual(EMPTY);
    });

    it("#119 AC-1: 最後の文（監査ログ）が失敗すると、全件残らず、500 で詳細を返さない", async () => {
      await env.DB.exec(
        `CREATE TRIGGER unit_fail_setup_audit BEFORE INSERT ON audit_logs WHEN NEW.action = '${SETUP_ACTION}' BEGIN SELECT RAISE(ABORT, 'unit test failure'); END`,
      );
      const res = await post(validBody());
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(JSON.parse(text)).toMatchObject({ code: "INTERNAL" });
      expect(text).not.toContain("unit test failure");
      expect(text).not.toContain("audit_logs");
      expect(text).not.toMatch(/initialPassword/);
      expect(await snapshot()).toEqual(EMPTY);
      // 失敗のあとも、セットアップは未完了のまま
      expect(await (await getStatus()).json()).toEqual({ setupRequired: true });
    });
  },
);

describe(
  "POST /api/setup：初回専用の認証",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    const wrongTokens: [string, () => unknown][] = [
      ["別のトークン", () => newSetupToken()],
      ["42文字", () => token.slice(0, 42)],
      ["44文字", () => `${token}A`],
      ["空", () => ""],
    ];

    it.each(wrongTokens)(
      "#119 AC-1: トークンが誤り（%s）は 403（FORBIDDEN）で、DB は変わらず、logger.audit に失敗を記録し、ログに値が出ない",
      async (_label, make) => {
        const wrong = make();
        const res = await post(validBody({ setupToken: wrong }));
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ code: "FORBIDDEN" });
        expect(await snapshot()).toEqual(EMPTY);
        const audits = auditLogLines();
        expect(audits.some((a) => a.attributes?.result === "failure")).toBe(
          true,
        );
        const out = logLines.join("\n");
        expect(out).not.toContain(token);
        if (typeof wrong === "string" && wrong !== "")
          expect(out).not.toContain(wrong);
      },
    );

    it("#119 AC-1: トークンの欄がない要求は 403 で、DB は変わらない", async () => {
      const rest = omit(validBody(), "setupToken");
      const res = await post(rest);
      expect(res.status).toBe(403);
      expect(await snapshot()).toEqual(EMPTY);
    });

    it("#119 AC-1: トークンの誤りは、監査ログのテーブル（audit_logs）には書かない（logger.audit のみ。D-6・D-9）", async () => {
      await post(validBody({ setupToken: newSetupToken() }));
      expect(await countRows("audit_logs")).toBe(0);
    });

    it.each<[string, Record<string, unknown>]>([
      ["SETUP_TOKEN が未設定", { SETUP_TOKEN: undefined }],
      ["SETUP_TOKEN が空", { SETUP_TOKEN: "" }],
      [
        "SETUP_TOKEN が42文字",
        { SETUP_TOKEN: randomBase64Url(32).slice(0, 42) },
      ],
      [
        "SETUP_TOKEN に使えない文字",
        { SETUP_TOKEN: `+${randomBase64Url(32).slice(1)}` },
      ],
      ["PII_ENCRYPTION_KEY が未設定", { PII_ENCRYPTION_KEY: undefined }],
      [
        "PII_ENCRYPTION_KEY が32バイトでない",
        { PII_ENCRYPTION_KEY: randomBase64Url(16) },
      ],
    ])(
      "#119 AC-1: %s のときは 503（SERVICE_UNAVAILABLE）で、DB は変わらない",
      async (_label, overrides) => {
        const e = envWith(overrides);
        const res = await post(validBody(), { env: e });
        expect(res.status).toBe(503);
        expect(await res.json()).toMatchObject({ code: "SERVICE_UNAVAILABLE" });
        expect(await snapshot()).toEqual(EMPTY);
      },
    );

    it("#119 AC-1: 完了後に誤ったトークンを送っても 403（完了済みかどうかを、トークンなしで知らせない）", async () => {
      expect((await post(validBody())).status).toBe(201);
      const res = await post(
        validBody({
          setupToken: newSetupToken(),
          loginId: "testuser_002",
          email: "testuser_002@example.com",
        }),
      );
      expect(res.status).toBe(403);
    });
  },
);

describe(
  "POST /api/setup：送信元（Origin）の確認（実際の index.ts の app）",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it.each<[string, string | null]>([
      ["許可していない送信元", "https://origin.invalid"],
      ["Origin なし", null],
      ["Origin が null", "null"],
    ])(
      "#119 AC-1: %s は 403（FORBIDDEN_ORIGIN）で、DB は変わらない",
      async (_label, origin) => {
        const res = await post(validBody(), { origin });
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
        expect(await snapshot()).toEqual(EMPTY);
      },
    );
  },
);

describe(
  "POST /api/setup：入力の検証（422）と境界値",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    const field = (name: string, value: unknown) =>
      validBody({ [name]: value });

    it.each<[string, string, unknown]>([
      ["社員IDが2文字", "loginId", "ab"],
      ["社員IDが33文字", "loginId", `testuser_${"a".repeat(24)}`],
      ["社員IDに空白", "loginId", "testuser 001"],
      ["社員IDに使えない記号", "loginId", "testuser_001'--"],
      ["社員IDに日本語", "loginId", "テストユーザー"],
      ["本名が31文字", "legalName", "あ".repeat(31)],
      ["本名が空白だけ", "legalName", "   "],
      ["本名に制御文字", "legalName", "テスト\u0000太郎"],
      [
        "会社名が101文字",
        "companyName",
        `${TEST_TAG}${"あ".repeat(101 - TEST_TAG.length)}`,
      ],
      ["会社名が空白だけ", "companyName", "　 　"],
      ["会社名が制御文字だけ", "companyName", "\u0001\u0002"],
      [
        "部署名が51文字",
        "departmentName",
        `${TEST_TAG}${"あ".repeat(51 - TEST_TAG.length)}`,
      ],
      ["部署名が空", "departmentName", ""],
      ["メールに@がない", "email", "testuser_001.example.com"],
      [
        "メールが255文字",
        "email",
        `${"a".repeat(255 - "@example.com".length)}@example.com`,
      ],
      ["メールの確認が false", "emailConfirmed", false],
      ["メールの確認が文字列", "emailConfirmed", "true"],
      ["内線に英字", "extension", "12a4"],
      ["内線が11文字", "extension", "0".repeat(11)],
      ["役職が31文字", "jobTitle", "あ".repeat(31)],
    ])(
      "#119 AC-1: %s は 422 で fields に %s を含み、DB は変わらない",
      async (_label, name, value) => {
        const res = await post(field(name, value));
        expect(res.status).toBe(422);
        const body = (await res.json()) as { code: string; fields: string[] };
        expect(body.code).toBe("VALIDATION_ERROR");
        expect(body.fields).toContain(name);
        expect(await snapshot()).toEqual(EMPTY);
      },
    );

    it("#119 AC-1: メールの確認（emailConfirmed）の欄がないと 422", async () => {
      const rest = omit(validBody(), "emailConfirmed");
      const res = await post(rest);
      expect(res.status).toBe(422);
      expect(((await res.json()) as { fields: string[] }).fields).toContain(
        "emailConfirmed",
      );
    });

    it("#119 AC-1: 422 の応答に、入力したトークン・本名を含めない", async () => {
      const res = await post(validBody({ loginId: "ab" }));
      const text = await res.text();
      expect(text).not.toContain(token);
      expect(text).not.toContain("テスト太郎");
    });

    it.each<[string, Record<string, unknown>]>([
      ["社員IDが3文字", { loginId: "t_1", email: "t_1@example.com" }],
      ["社員IDが32文字", { loginId: `testuser_${"a".repeat(23)}` }],
      ["社員IDに . _ - を含む", { loginId: "testuser_0.0-1" }],
      ["本名が30文字", { legalName: "あ".repeat(30) }],
      ["本名が1文字", { legalName: "あ" }],
      [
        "会社名が100文字（前後の空白を除いて）",
        { companyName: `  ${TEST_TAG}${"あ".repeat(100 - TEST_TAG.length)}  ` },
      ],
      [
        "部署名が50文字",
        { departmentName: `${TEST_TAG}${"あ".repeat(50 - TEST_TAG.length)}` },
      ],
      [
        "メールが254文字",
        { email: `${"a".repeat(254 - "@example.com".length)}@example.com` },
      ],
      ["内線が10文字", { extension: "090-000000" }],
      ["役職が30文字", { jobTitle: "あ".repeat(30) }],
    ])("#119 AC-1: 境界値（%s）は 201", async (_label, overrides) => {
      const res = await post(validBody(overrides));
      expect(res.status).toBe(201);
    });

    it("#119 AC-1: 会社名・部署名・本名は前後の空白を除いて保存する", async () => {
      const body = (await (
        await post(
          validBody({
            companyName: `  ${TEST_TAG}テスト株式会社  `,
            departmentName: ` ${TEST_TAG}経営企画部 `,
            legalName: " テスト太郎 ",
          }),
        )
      ).json()) as SetupResponse;
      expect(body.user.displayName).toBe("テスト太郎");
      const company = await env.DB.prepare(
        "SELECT company_name FROM company_settings",
      ).first<{ company_name: string }>();
      expect(company?.company_name).toBe(`${TEST_TAG}テスト株式会社`);
      const dept = await env.DB.prepare("SELECT name FROM departments").first<{
        name: string;
      }>();
      expect(dept?.name).toBe(`${TEST_TAG}経営企画部`);
    });

    it("#119 AC-1: SQL のような文字列も、そのまま値として保存し、表は壊れない", async () => {
      const companyName = `${TEST_TAG}Robert'); DROP TABLE users;--`;
      const res = await post(
        validBody({ companyName, legalName: "'; DROP TABLE users; --" }),
      );
      expect(res.status).toBe(201);
      const company = await env.DB.prepare(
        "SELECT company_name FROM company_settings",
      ).first<{ company_name: string }>();
      expect(company?.company_name).toBe(companyName);
      expect(await countRows("users")).toBe(1);
    });

    it("#119 AC-1: 壊れた JSON の本文は 422 で、DB は変わらない", async () => {
      const res = await app.request(
        "/api/setup",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: ALLOWED_ORIGIN,
            "CF-Connecting-IP": nextTestIp(),
          },
          body: "{",
        },
        envWith(),
      );
      expect(res.status).toBe(422);
      expect(await snapshot()).toEqual(EMPTY);
    });
  },
);

describe(
  "POST /api/setup：既存のアカウントへの自動照合をしない（0-1 AC-10）",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it("#119 AC-1: 同じ社員ID（大文字小文字違いを含む）の利用者がすでにあれば 409 で、既存の利用者に全体管理者を付けない", async () => {
      const dept = await insertDepartment("既存の部署");
      const existing = await insertUser("testuser_001", dept);
      const res = await post(
        validBody({
          loginId: "TESTUSER_001",
          email: "testuser_900@example.com",
        }),
      );
      expect(res.status).toBe(409);
      const { results } = await env.DB.prepare(
        "SELECT role_id FROM user_role_assignments WHERE user_id = ?",
      )
        .bind(existing)
        .all();
      expect(results).toEqual([]);
      expect(await countRows("company_settings")).toBe(0);
    });

    it("#119 AC-1: 同じ氏名の利用者がいても、その利用者に紐付けず、入力した社員IDで新しく作る", async () => {
      const dept = await insertDepartment("既存の部署");
      // insertUser の表示名は「テスト太郎」
      const existing = await insertUser("testuser_800", dept);
      const res = await post(validBody());
      expect(res.status).toBe(201);
      const body = (await res.json()) as SetupResponse;
      expect(body.user.id).not.toBe(existing);
      const { results } = await env.DB.prepare(
        "SELECT role_id FROM user_role_assignments WHERE user_id = ?",
      )
        .bind(existing)
        .all();
      expect(results).toEqual([]);
    });

    it("#119 AC-1: 同じメールアドレス（大文字小文字違い）の利用者がいれば 409", async () => {
      const dept = await insertDepartment("既存の部署");
      await insertUser("testuser_700", dept);
      const res = await post(validBody({ email: "TESTUSER_700@EXAMPLE.COM" }));
      expect(res.status).toBe(409);
      expect(await countRows("company_settings")).toBe(0);
    });
  },
);

describe(
  "#181 AC-2 共通化前のAPI入力契約",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it.each<[string, string, string]>([
      ["社員IDの先頭空白は除去しない", "loginId", " testuser_181"],
      ["社員IDの末尾空白は除去しない", "loginId", "testuser_181 "],
      [
        "新規社員IDはログイン受付の64文字まで拡張しない",
        "loginId",
        `testuser_${"a".repeat(55)}`,
      ],
      ["メールの前後空白は除去しない", "email", " testuser_181@example.com "],
      ["内線の空文字は省略と異なる", "extension", ""],
      ["内線の前後空白は除去しない", "extension", " 123 "],
      ["役職の空文字は省略と異なる", "jobTitle", ""],
      ["役職の空白だけも拒否する", "jobTitle", "　 "],
    ])("#181 AC-2/3: %s", async (_name, field, value) => {
      const res = await post(validBody({ [field]: value }));
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        code: "VALIDATION_ERROR",
        fields: [field],
      });
      expect(await snapshot()).toEqual(EMPTY);
    });

    it("#181 AC-2: 内線1文字を許可し、役職は前後空白を除いた値を保存する", async () => {
      const res = await post(
        validBody({ extension: "0", jobTitle: "　 test_role_181  " }),
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as SetupResponse;
      const row = await env.DB.prepare(
        "SELECT extension, job_title FROM users WHERE id = ?",
      )
        .bind(body.user.id)
        .first<{ extension: string; job_title: string }>();
      expect(row).toEqual({ extension: "0", job_title: "test_role_181" });
    });

    it("#181 AC-2: 複数違反のfieldsは重複せず既存の欄順で返す", async () => {
      const res = await post(
        validBody({
          companyName: "",
          departmentName: "",
          loginId: "",
          legalName: "",
          email: "invalid",
          emailConfirmed: false,
          extension: "",
          jobTitle: "",
        }),
      );
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        code: "VALIDATION_ERROR",
        message: "入力内容を確かめてください",
        fields: [
          "companyName",
          "departmentName",
          "loginId",
          "legalName",
          "email",
          "emailConfirmed",
          "extension",
          "jobTitle",
        ],
      });
      expect(await snapshot()).toEqual(EMPTY);
    });

    it.each(["前", "後"])(
      "#181 AC-2: 正しいトークンの%sの空白も照合値の一部として403にする",
      async (position) => {
        const input = position === "前" ? ` ${token}` : `${token} `;
        const res = await post(validBody({ setupToken: input }));
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ code: "FORBIDDEN" });
        expect(await snapshot()).toEqual(EMPTY);
        expect(logLines.join("\n")).not.toContain(token);
      },
    );
  },
);
