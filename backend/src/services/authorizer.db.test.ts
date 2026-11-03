// #119 AC-3：第1段階のロールが、#118 の権限判定の枠（createAuthorizer）で使える。
// createAppAuthorizer（createAuthorizer を呼ぶ唯一の場所）に、本物の Repository（D1）をつないで確かめる。データは架空（testuser_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import {
  cleanupRoleTestData,
  insertAssignment,
  insertDepartment,
  insertUser,
} from "../../test/role-fixtures";
import { createRoleAssignmentRepository } from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import type { Scope } from "../lib/authorization";
import type { Logger } from "../lib/logger/logger";
import { ROLE_IDS } from "../lib/permissions";
import { createAppAuthorizer } from "./authorizer";

afterEach(cleanupRoleTestData);

/** D1 のバインディングを包み、発行した SQL の文の数を数える（N+1 の検出） */
function countingDatabase() {
  const statements: string[] = [];
  const wrapped = new Proxy(env.DB, {
    get(target, prop, receiver) {
      if (prop === "prepare")
        return (query: string) => {
          statements.push(query);
          return target.prepare(query);
        };
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db: drizzle(wrapped, { schema }), statements };
}

function setup() {
  const audit = vi.fn();
  const logger = { audit } as unknown as Logger;
  const { db, statements } = countingDatabase();
  const authorizer = createAppAuthorizer(createRoleAssignmentRepository(db), {
    logger,
  });
  return { authorizer, audit, statements };
}

const errorOf = (p: Promise<unknown>) => p.catch((e: unknown) => e);
const company: Scope = { type: "company" };

describe("ロールの権限判定（createAppAuthorizer × D1）", () => {
  it("#119 AC-3: 未ログイン（principal が null）は 401 で、logger.audit に失敗を記録する", async () => {
    const { authorizer, audit } = setup();
    const err = await errorOf(
      authorizer.authorize(null, "perm.account.create", company),
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(401);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[0]?.[2]).toBe("failure");
  });

  it("#119 AC-3: 全体管理者は会社範囲で perm.account.create を持つ", async () => {
    const dept = await insertDepartment("部署A");
    const admin = await insertUser("testuser_001", dept);
    await insertAssignment(admin, ROLE_IDS.globalAdmin, "company", null);
    const { authorizer, audit } = setup();
    await expect(
      authorizer.authorize({ userId: admin }, "perm.account.create", company),
    ).resolves.toBeUndefined();
    expect(audit).not.toHaveBeenCalled();
  });

  it("#119 AC-3: 割り当てのない一般メンバーは、管理の操作が 403 で、logger.audit に記録する。全員の権限は持つ", async () => {
    const dept = await insertDepartment("部署A");
    const member = await insertUser("testuser_002", dept);
    const { authorizer, audit } = setup();
    const err = await errorOf(
      authorizer.authorize({ userId: member }, "perm.account.create", company),
    );
    expect((err as AppError).status).toBe(403);
    expect((err as AppError).code).toBe("FORBIDDEN");
    expect(audit).toHaveBeenCalledTimes(1);
    expect(
      await authorizer.can({ userId: member }, "perm.auth.login", company),
    ).toBe(true);
  });

  it("#119 AC-3: 部署Aのオーナーは部署Aで perm.workspace.manage を持ち、部署Bでは 403", async () => {
    const deptA = await insertDepartment("部署A");
    const deptB = await insertDepartment("部署B");
    const owner = await insertUser("testuser_003", deptA);
    await insertAssignment(owner, ROLE_IDS.owner, "department", deptA);
    const { authorizer } = setup();
    expect(
      await authorizer.can({ userId: owner }, "perm.workspace.manage", {
        type: "department",
        departmentId: deptA,
      }),
    ).toBe(true);
    const err = await errorOf(
      authorizer.authorize({ userId: owner }, "perm.workspace.manage", {
        type: "department",
        departmentId: deptB,
      }),
    );
    expect((err as AppError).status).toBe(403);
  });

  it("#119 AC-3: 無効化した利用者は、割り当てが残っていても、全員の権限を含めてすべて拒否する", async () => {
    const dept = await insertDepartment("部署A");
    const admin = await insertUser("testuser_004", dept, { isActive: false });
    await insertAssignment(admin, ROLE_IDS.globalAdmin, "company", null);
    const { authorizer } = setup();
    expect(
      await authorizer.can({ userId: admin }, "perm.account.create", company),
    ).toBe(false);
    expect(
      await authorizer.can({ userId: admin }, "perm.auth.login", company),
    ).toBe(false);
    const err = await errorOf(
      authorizer.authorize({ userId: admin }, "perm.auth.login", company),
    );
    expect((err as AppError).status).toBe(403);
  });

  it("#119 AC-3: 存在しない利用者は、全員の権限を含めてすべて拒否する", async () => {
    const { authorizer } = setup();
    expect(
      await authorizer.can(
        { userId: "01JNOUSER00000000000000000" },
        "perm.auth.login",
        company,
      ),
    ).toBe(false);
  });

  it("#119 AC-3: 1回の判定で、DBへの問い合わせは1文だけ（割り当ての取得は1回のJOIN）", async () => {
    const deptA = await insertDepartment("部署A");
    const deptB = await insertDepartment("部署B");
    const admin = await insertUser("testuser_005", deptA);
    await insertAssignment(admin, ROLE_IDS.globalAdmin, "company", null);
    await insertAssignment(admin, ROLE_IDS.owner, "department", deptA);
    await insertAssignment(admin, ROLE_IDS.owner, "department", deptB);
    const { authorizer, statements } = setup();
    await authorizer.can({ userId: admin }, "perm.workspace.manage", {
      type: "department",
      departmentId: deptA,
    });
    expect(statements).toHaveLength(1);
  });

  it("#119 AC-3: 拒否の記録に、利用者のIDや権限の集合を含めない", async () => {
    const dept = await insertDepartment("部署A");
    const member = await insertUser("testuser_006", dept);
    const { authorizer, audit } = setup();
    await errorOf(
      authorizer.authorize({ userId: member }, "perm.audit_log.view", company),
    );
    const logged = JSON.stringify(audit.mock.calls);
    expect(logged).not.toContain(member);
    expect(logged).not.toContain("perm.auth.login");
  });
});
