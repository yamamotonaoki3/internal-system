// #200 AC-1（Q-5）: アカウントの Repository が DB のエラーを変換する規則を、マイグレーション済みの D1 で確かめる。
// 全社連絡がないときの専用エラー（名前・文言・原因）と、変換してはいけないエラー（それ以外の制約違反・未知のDBエラー）をそのまま返すこと。
// データは架空（testuser_、[UNIT_TEST]、@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AUTH_TRACE_PREFIX,
  cleanupAuthTestData,
} from "../../test/auth-fixtures";
import {
  removeCompanyGeneral,
  restoreCompanyGeneral,
} from "../../test/company-general-fixtures";
import {
  cleanupDepartmentTestData,
  insertDepartmentWithChannels,
} from "../../test/department-fixtures";
import {
  cleanupRoleTestData,
  insertUser,
  testId,
} from "../../test/role-fixtures";
import {
  AccountConflictError,
  CompanyGeneralChannelMissingError,
  withAccounts,
  type AccountCreateInput,
} from "./account.repository";

const DUMMY_HASH =
  "$scrypt$ln=16,r=8,p=2$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA";
const DUMMY_LEGAL = "v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAA";
const NOW = "2026-11-09T00:00:00.000Z";

let departmentId: string;
let adminId: string;
let removed = false;

function input(
  overrides: Partial<AccountCreateInput> = {},
): AccountCreateInput {
  return {
    id: testId("ERRS"),
    loginId: "testuser_acct_err001",
    displayName: "テスト太郎",
    legalNameEncrypted: DUMMY_LEGAL,
    email: "testuser_acct_err001@example.com",
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

beforeEach(async () => {
  departmentId = (await insertDepartmentWithChannels("エラー変換部署")).id;
  adminId = await insertUser("testuser_acct_erradmin", departmentId);
});

afterEach(async () => {
  await cleanupAuthTestData();
  await cleanupDepartmentTestData();
  await cleanupRoleTestData();
  if (removed) {
    await restoreCompanyGeneral();
    removed = false;
  }
});

describe("#200 AC-1 アカウントの Repository のエラー変換", () => {
  it("#200 AC-1（Q-5）: 全社連絡がないときは、名前・文言を決めた CompanyGeneralChannelMissingError を、原因（cause）つきで投げる", async () => {
    await removeCompanyGeneral();
    removed = true;
    const error = await create(input()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CompanyGeneralChannelMissingError);
    expect(error).not.toBeInstanceOf(AccountConflictError);
    const missing = error as CompanyGeneralChannelMissingError;
    expect(missing.name).toBe("CompanyGeneralChannelMissingError");
    expect(missing.message).toBe("全社連絡のチャンネルがありません");
    // 原因の DB エラーを残す（調査のため）。入力値は文言に含めない
    expect(missing.cause).toBeInstanceOf(Error);
    expect(missing.message).not.toContain("testuser_acct_err001");
  });

  it("#200 AC-1: 社員ID・メールの重複は AccountConflictError（名前・文言・理由・原因つき）", async () => {
    await create(input());
    const error = await create(
      input({
        id: testId("ERRS"),
        loginId: "TESTUSER_ACCT_ERR001",
        email: "testuser_acct_err002@example.com",
      }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AccountConflictError);
    const conflict = error as AccountConflictError;
    expect(conflict.reason).toBe("login_id");
    expect(conflict.name).toBe("AccountConflictError");
    expect(conflict.cause).toBeInstanceOf(Error);
    const byEmail = await create(
      input({
        id: testId("ERRS"),
        loginId: "testuser_acct_err003",
        email: "TESTUSER_ACCT_ERR001@example.com",
      }),
    ).catch((e: unknown) => e);
    expect((byEmail as AccountConflictError).reason).toBe("email");
  });

  it("#200 AC-1: 競合の対象でない一意制約（主キーの重複）は、AccountConflictError に変えず、元のエラーのまま投げる", async () => {
    const first = input();
    await create(first);
    const error = await create(
      input({
        id: first.id,
        loginId: "testuser_acct_err004",
        email: "testuser_acct_err004@example.com",
      }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AccountConflictError);
    expect(error).not.toBeInstanceOf(CompanyGeneralChannelMissingError);
    expect(error).not.toBeInstanceOf(TypeError);
    expect((error as Error).message).toMatch(/UNIQUE constraint failed/i);
  });

  it("#200 AC-1: 全社連絡の確認でない NOT NULL 違反は、CompanyGeneralChannelMissingError に変えず、元のエラーのまま投げる。何も残らない", async () => {
    const value = input({
      passwordHash: null as unknown as string,
    });
    const error = await create(value).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(CompanyGeneralChannelMissingError);
    expect(error).not.toBeInstanceOf(AccountConflictError);
    expect((error as Error).message).toMatch(/NOT NULL constraint failed/i);
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE id = ?",
    )
      .bind(value.id)
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("#200 AC-1: 制約違反でない DB エラー（存在しない部署への外部キー違反）は、変換せず元のエラーのまま投げる", async () => {
    const error = await create(input({ departmentId: testId("NODEPT") })).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(CompanyGeneralChannelMissingError);
    expect(error).not.toBeInstanceOf(AccountConflictError);
    // 変換処理が壊れたときの TypeError ではなく、DB のエラーそのもの
    expect(error).not.toBeInstanceOf(TypeError);
    expect((error as Error).message).toMatch(/FOREIGN KEY|constraint|SQLITE/i);
  });
});
