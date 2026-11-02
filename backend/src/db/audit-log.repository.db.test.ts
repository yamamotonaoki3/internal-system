// #118 AC-3：監査ログの書き込み部品が、db.batch の中に入れて業務の更新と同時に確定・失敗できる。
// 結合のテスト：本物と同じ実行エンジン（workerd）のローカルの D1 で確かめる。
import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { integer, sqliteTable } from "drizzle-orm/sqlite-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { isUlid } from "../lib/ulid";
import { auditLogInsert } from "./audit-log.repository";

// 業務の表の代わりのテスト専用テーブル。CHECK 制約で、業務の文を意図的に失敗させる
const accounts = sqliteTable("unit_audit_accounts", {
  id: integer("id").primaryKey(),
  balance: integer("balance").notNull(),
});
const db = drizzle(env.DB);

type TestAction = "test.example.update";
const base = {
  actorId: "testuser_001",
  action: "test.example.update" as TestAction,
  targetType: "account",
  targetId: "1",
  result: "success" as const,
  traceId: "trace-unit-audit",
};
const TARGET_TYPE = "[UNIT_TEST]account";

async function auditRows() {
  const { results } = await env.DB.prepare(
    "SELECT id, actor_id, action, target_type, target_id, result, trace_id, detail, occurred_at FROM audit_logs WHERE target_type = ?",
  )
    .bind(TARGET_TYPE)
    .all<Record<string, string | null>>();
  return results;
}

beforeAll(async () => {
  await env.DB.exec("DROP TABLE IF EXISTS unit_audit_accounts");
  await env.DB.exec(
    "CREATE TABLE unit_audit_accounts (id INTEGER PRIMARY KEY, balance INTEGER NOT NULL CHECK (balance >= 0))",
  );
});

afterEach(async () => {
  // このテストが足した行だけを、識別子で消す
  await env.DB.prepare("DELETE FROM audit_logs WHERE target_type = ?")
    .bind(TARGET_TYPE)
    .run();
  await env.DB.exec("DELETE FROM unit_audit_accounts");
});

afterAll(async () => {
  await env.DB.exec("DROP TABLE IF EXISTS unit_audit_accounts");
});

describe("監査ログの書き込み部品（D1）", () => {
  it("#118 AC-3: 業務の更新と同じ batch で、両方が確定する", async () => {
    await db.insert(accounts).values({ id: 1, balance: 100 });
    await db.batch([
      db
        .update(accounts)
        .set({ balance: sql`${accounts.balance} - 30` })
        .where(sql`${accounts.id} = 1`),
      auditLogInsert<TestAction>(db, { ...base, targetType: TARGET_TYPE }),
    ]);
    const [row] = await db.select().from(accounts);
    expect(row?.balance).toBe(70);
    const logs = await auditRows();
    expect(logs).toHaveLength(1);
    expect(isUlid(logs[0]?.id)).toBe(true);
    expect(logs[0]).toMatchObject({
      actor_id: "testuser_001",
      action: "test.example.update",
      target_id: "1",
      result: "success",
      trace_id: "trace-unit-audit",
    });
    expect(logs[0]?.occurred_at).toBeTruthy();
  });

  it("#118 AC-3: 業務の文が失敗すると、監査ログも残らない", async () => {
    await db.insert(accounts).values({ id: 1, balance: 10 });
    await expect(
      db.batch([
        auditLogInsert<TestAction>(db, { ...base, targetType: TARGET_TYPE }),
        db
          .update(accounts)
          .set({ balance: sql`${accounts.balance} - 30` })
          .where(sql`${accounts.id} = 1`),
      ]),
    ).rejects.toThrow();
    expect(await auditRows()).toHaveLength(0);
    const [row] = await db.select().from(accounts);
    expect(row?.balance).toBe(10);
  });

  it("#118 AC-3: 監査ログの文が失敗すると、業務の更新も残らない", async () => {
    await db.insert(accounts).values({ id: 1, balance: 100 });
    await expect(
      db.batch([
        db
          .update(accounts)
          .set({ balance: sql`${accounts.balance} - 30` })
          .where(sql`${accounts.id} = 1`),
        // result は success / failure のみ。表の制約か型の外の値で、監査ログの文を失敗させる
        auditLogInsert<TestAction>(db, {
          ...base,
          targetType: TARGET_TYPE,
          result: "invalid" as unknown as "success",
        }),
      ]),
    ).rejects.toThrow();
    const [row] = await db.select().from(accounts);
    expect(row?.balance).toBe(100);
    expect(await auditRows()).toHaveLength(0);
  });

  it("#118 AC-3: 操作者が null（ログイン失敗など）でも保存できる", async () => {
    await db.batch([
      auditLogInsert<TestAction>(db, {
        ...base,
        targetType: TARGET_TYPE,
        actorId: null,
        targetId: null,
        result: "failure",
      }),
    ]);
    const logs = await auditRows();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.actor_id).toBeNull();
    expect(logs[0]?.target_id).toBeNull();
    expect(logs[0]?.result).toBe("failure");
  });

  it("#118 AC-3: detail は概要として保存し、秘密情報・個人情報の項目名は伏せ字になる", async () => {
    await db.batch([
      auditLogInsert<TestAction>(db, {
        ...base,
        targetType: TARGET_TYPE,
        detail: {
          affectedCount: 3,
          failureCategory: "validation",
          email: "testuser_001@example.com",
          token: "dummy-token-value",
        },
      }),
    ]);
    const logs = await auditRows();
    const detail = JSON.parse(logs[0]?.detail ?? "{}") as Record<
      string,
      unknown
    >;
    expect(detail.affectedCount).toBe(3);
    expect(detail.failureCategory).toBe("validation");
    expect(detail.email).toBe("[REDACTED]");
    expect(detail.token).toBe("[REDACTED]");
    expect(logs[0]?.detail).not.toContain("testuser_001@example.com");
  });

  it("#118 AC-3: detail を省くと null で保存される", async () => {
    await db.batch([
      auditLogInsert<TestAction>(db, { ...base, targetType: TARGET_TYPE }),
    ]);
    const logs = await auditRows();
    expect(logs[0]?.detail).toBeNull();
  });
});
