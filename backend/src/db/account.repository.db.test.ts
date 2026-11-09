// #199 AC-1・AC-2・AC-3・AC-5: アカウントの Repository を、マイグレーション済みの D1 で確かめる。
// データは架空（testuser_、[UNIT_TEST]、@example.com）。監査ログは trace_id の接頭辞で、利用者・部署は識別子で消す。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AUTH_TRACE_PREFIX,
  cleanupAuthTestData,
} from "../../test/auth-fixtures";
import {
  cleanupRoleTestData,
  insertDepartment,
  insertUser,
  testId,
} from "../../test/role-fixtures";
import { decodeCursor } from "../lib/cursor";
import {
  AccountConflictError,
  withAccounts,
  type AccountCreateInput,
} from "./account.repository";

// ハッシュ・暗号文の形だけを持つダミー（本物の認証情報・本名ではない）
const DUMMY_HASH =
  "$scrypt$ln=16,r=8,p=2$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA";
const DUMMY_LEGAL = "v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAA";
const NOW = "2026-11-09T00:00:00.000Z";

let departmentId: string;
let adminId: string;

function input(
  overrides: Partial<AccountCreateInput> = {},
): AccountCreateInput {
  return {
    id: testId("ACCT"),
    loginId: "testuser_acct_001",
    displayName: "テスト太郎",
    legalNameEncrypted: DUMMY_LEGAL,
    email: "testuser_acct_001@example.com",
    departmentId,
    extension: null,
    jobTitle: null,
    passwordHash: DUMMY_HASH,
    actorId: adminId,
    now: NOW,
    traceId: `${AUTH_TRACE_PREFIX}${crypto.randomUUID()}`,
    ...overrides,
  };
}

const create = (value: AccountCreateInput) =>
  withAccounts(env, (repository) => repository.createAccount(value));

async function auditCount(targetId: string) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'account.create' AND target_id = ?",
  )
    .bind(targetId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function userCount(loginIdNormalized: string) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE login_id_normalized = ?",
  )
    .bind(loginIdNormalized)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

beforeEach(async () => {
  departmentId = await insertDepartment("アカウントDBテスト部署");
  adminId = await insertUser("testuser_acct_admin", departmentId);
});

afterEach(async () => {
  await env.DB.exec("DROP TRIGGER IF EXISTS unit_fail_account_audit");
  await cleanupAuthTestData();
  await cleanupRoleTestData();
});

describe("#199 アカウントの Repository（D1）", () => {
  it("#199 AC-3: 利用者と監査ログ account.create を1件ずつ作る。正規化列・確認者・初回変更の印を保存する", async () => {
    const value = input({
      loginId: "TestUser_Acct_001",
      email: "TestUser_Acct_001@Example.com",
      extension: "0000",
      jobTitle: "課長",
    });
    await create(value);
    const row = await env.DB.prepare("SELECT * FROM users WHERE id = ?")
      .bind(value.id)
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({
      login_id: "TestUser_Acct_001",
      login_id_normalized: "testuser_acct_001",
      email_normalized: "testuser_acct_001@example.com",
      display_name: "テスト太郎",
      legal_name: DUMMY_LEGAL,
      department_id: departmentId,
      extension: "0000",
      job_title: "課長",
      password_hash: DUMMY_HASH,
      email_verified_by: adminId,
      email_verified_at: NOW,
      must_change_password: 1,
      is_active: 1,
    });
    const audit = await env.DB.prepare(
      "SELECT actor_id, target_type, target_id, result, trace_id, detail FROM audit_logs WHERE action = 'account.create' AND target_id = ?",
    )
      .bind(value.id)
      .all<Record<string, string>>();
    expect(audit.results).toHaveLength(1);
    expect(audit.results[0]).toMatchObject({
      actor_id: adminId,
      target_type: "user",
      target_id: value.id,
      result: "success",
      trace_id: value.traceId,
    });
    expect(JSON.parse(audit.results[0]?.detail ?? "{}")).toEqual({
      departmentId,
      emailVerification: "admin",
    });
  });

  it("#199 AC-2（V-01）: 大小だけが違うユーザーIDは AccountConflictError('login_id') で、利用者も監査も残らない", async () => {
    await create(input({ loginId: "testuser_acct_dup" }));
    const second = input({
      loginId: "TESTUSER_ACCT_DUP",
      email: "testuser_acct_other@example.com",
    });
    const error = await create(second).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AccountConflictError);
    expect((error as AccountConflictError).reason).toBe("login_id");
    expect((error as Error).name).toBe("AccountConflictError");
    expect((error as Error).message).toBe(
      "アカウントの内容が、すでにあるデータと競合しました",
    );
    // 調査のため、D1 の元のエラーを cause に残す（入力値は持たない）
    expect((error as Error).cause).toBeInstanceOf(Error);
    expect(JSON.stringify(error)).not.toContain("TESTUSER_ACCT_DUP");
    expect(await userCount("testuser_acct_dup")).toBe(1);
    expect(await auditCount(second.id)).toBe(0);
  });

  it("#199 AC-2（V-06）: 大小だけが違うメールは AccountConflictError('email')", async () => {
    await create(
      input({ loginId: "testuser_acct_m1", email: "testuser_m@example.com" }),
    );
    const second = input({
      loginId: "testuser_acct_m2",
      email: "TestUser_M@EXAMPLE.com",
    });
    const error = await create(second).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AccountConflictError);
    expect((error as AccountConflictError).reason).toBe("email");
    expect(await userCount("testuser_acct_m2")).toBe(0);
    expect(await auditCount(second.id)).toBe(0);
  });

  it("#199 AC-2（V-01）: 無効化済みのアカウントと同じユーザーID・メールも拒否する", async () => {
    await insertUser("testuser_acct_gone", departmentId, { isActive: false });
    const byId = await create(
      input({
        loginId: "TestUser_Acct_Gone",
        email: "testuser_acct_new@example.com",
      }),
    ).catch((e: unknown) => e);
    expect((byId as AccountConflictError).reason).toBe("login_id");
    const byEmail = await create(
      input({
        loginId: "testuser_acct_new",
        email: "testuser_acct_gone@example.com",
      }),
    ).catch((e: unknown) => e);
    expect((byEmail as AccountConflictError).reason).toBe("email");
  });

  it("#199 AC-2: 同じユーザーIDを同時に2件発行すると、片方だけ成功し、監査は1件", async () => {
    const a = input({
      loginId: "testuser_acct_race",
      email: "testuser_race_a@example.com",
    });
    const b = input({
      loginId: "TestUser_Acct_Race",
      email: "testuser_race_b@example.com",
    });
    const results = await Promise.allSettled([create(a), create(b)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      AccountConflictError,
    );
    expect(await userCount("testuser_acct_race")).toBe(1);
    expect((await auditCount(a.id)) + (await auditCount(b.id))).toBe(1);
  });

  it("#199 AC-3: 監査ログの書き込みが失敗すると、利用者も残らない（同じ db.batch）", async () => {
    await env.DB.exec(
      "CREATE TRIGGER unit_fail_account_audit BEFORE INSERT ON audit_logs WHEN NEW.action = 'account.create' BEGIN SELECT RAISE(ABORT, 'unit test failure'); END",
    );
    const value = input({ loginId: "testuser_acct_atomic" });
    await expect(create(value)).rejects.toThrow();
    expect(await userCount("testuser_acct_atomic")).toBe(0);
  });

  it("#199 AC-1（V-12）: 有効な部署だけを見つけ、候補は有効な部署を名前順で返す", async () => {
    const inactive = await insertDepartment("アカウントDBテスト無効部署");
    await env.DB.prepare("UPDATE departments SET is_active = 0 WHERE id = ?")
      .bind(inactive)
      .run();
    const other = await insertDepartment("あアカウントDBテスト部署");
    await withAccounts(env, async (repository) => {
      expect(await repository.findActiveDepartment(departmentId)).toEqual({
        id: departmentId,
        name: "[UNIT_TEST]アカウントDBテスト部署",
      });
      expect(await repository.findActiveDepartment(inactive)).toBeNull();
      expect(await repository.findActiveDepartment(testId("NONE"))).toBeNull();
      const options = await repository.listActiveDepartments();
      const ids = options.map((o) => o.id);
      expect(ids).toContain(departmentId);
      expect(ids).toContain(other);
      expect(ids).not.toContain(inactive);
      const names = options.map((o) => o.name);
      expect([...names].sort()).toEqual(names);
    });
  });

  it("#199 AC-5: 一覧は loginId の正規化順で、本名を含まず、カーソルで重複も欠落もなく送れる", async () => {
    for (const n of ["003", "001", "002"])
      await create(
        input({
          loginId: `testuser_acct_list_${n}`,
          email: `testuser_acct_list_${n}@example.com`,
        }),
      );
    await withAccounts(env, async (repository) => {
      const seen: string[] = [];
      let cursor: Parameters<typeof repository.listAdmin>[0]["cursor"];
      let pages = 0;
      for (;;) {
        const page = await repository.listAdmin({ limit: 2, cursor });
        pages += 1;
        for (const item of page.items) {
          expect(item).not.toHaveProperty("legalName");
          expect(JSON.stringify(item)).not.toContain(DUMMY_LEGAL);
          seen.push(item.loginId);
        }
        if (page.nextCursor === null) break;
        cursor = decodeCursor(page.nextCursor);
        if (pages > 50) throw new Error("ページ送りが終わりません");
      }
      const listed = seen.filter((id) => id.startsWith("testuser_acct_list_"));
      expect(listed).toEqual([
        "testuser_acct_list_001",
        "testuser_acct_list_002",
        "testuser_acct_list_003",
      ]);
      expect(new Set(seen).size).toBe(seen.length);
      const lower = seen.map((s) => s.toLowerCase());
      expect([...lower].sort()).toEqual(lower);
    });
  });
  it("#199 AC-5: 所属部署のない利用者は、一覧で department が null になる", async () => {
    const id = await insertUser("testuser_acct_nodept", departmentId);
    await env.DB.prepare("UPDATE users SET department_id = NULL WHERE id = ?")
      .bind(id)
      .run();
    await withAccounts(env, async (repository) => {
      const page = await repository.listAdmin({ limit: 100 });
      const item = page.items.find((i) => i.id === id);
      expect(item?.department).toBeNull();
      const admin = page.items.find((i) => i.id === adminId);
      expect(admin?.department).toEqual({
        id: departmentId,
        name: "[UNIT_TEST]アカウントDBテスト部署",
      });
    });
  });

  it("#199 AC-5: 次のページのカーソルを作れない利用者ID（ULIDでない）は、壊れたカーソルを返さず失敗する", async () => {
    // 並びの最後になる正規化ID・ULIDでないID（架空）
    await insertUser("testuser_zzzz_badid", departmentId, {
      id: "testuser-not-a-ulid-000001",
    });
    await insertUser("testuser_zzzz_badid_next", departmentId);
    await withAccounts(env, async (repository) => {
      let cursor: Parameters<typeof repository.listAdmin>[0]["cursor"];
      let failure: unknown = null;
      for (let i = 0; i < 100 && failure === null; i += 1) {
        try {
          const page = await repository.listAdmin({ limit: 1, cursor });
          if (page.nextCursor === null) break;
          cursor = decodeCursor(page.nextCursor);
        } catch (error) {
          failure = error;
        }
      }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe("利用者IDが不正です");
    });
  });
});
