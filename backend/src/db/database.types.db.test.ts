// #118 AC-5：db.batch を使うDBの型が定義され、後続のIssueが同じ型で書ける（型テスト）。
// returning() 付きの insert・update と auditLogInsert を混ぜた配列を、そのまま db.batch() に渡せる。
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  expectTypeOf,
  it,
} from "vitest";
import { auditLogInsert } from "./audit-log.repository";
import type { BatchItem } from "./database";

const things = sqliteTable("unit_batch_things", {
  id: integer("id").primaryKey(),
  label: text("label").notNull(),
});
const db = drizzle(env.DB);

type TestAction = "test.example.update";
const TARGET_TYPE = "[UNIT_TEST]batch_type";

beforeAll(async () => {
  await env.DB.exec("DROP TABLE IF EXISTS unit_batch_things");
  await env.DB.exec(
    "CREATE TABLE unit_batch_things (id INTEGER PRIMARY KEY, label TEXT NOT NULL)",
  );
});

afterAll(async () => {
  await env.DB.prepare("DELETE FROM audit_logs WHERE target_type = ?")
    .bind(TARGET_TYPE)
    .run();
  await env.DB.exec("DROP TABLE IF EXISTS unit_batch_things");
});

describe("db.batch の型", () => {
  it("#118 AC-5: BatchItem を再公開している", () => {
    expectTypeOf<BatchItem>().not.toBeAny();
  });

  it("#118 AC-5: insert・update・auditLogInsert を混ぜた配列をそのまま渡せ、結果の型が推論される", async () => {
    const [inserted, updated, audit] = await db.batch([
      db
        .insert(things)
        .values({ id: 1, label: "[UNIT_TEST] before" })
        .returning(),
      db
        .update(things)
        .set({ label: "[UNIT_TEST] after" })
        .returning({ label: things.label }),
      auditLogInsert<TestAction>(db, {
        actorId: "testuser_001",
        action: "test.example.update",
        targetType: TARGET_TYPE,
        targetId: "1",
        result: "success",
        traceId: "trace-unit-batch",
      }),
    ]);

    expectTypeOf(inserted).toEqualTypeOf<{ id: number; label: string }[]>();
    expectTypeOf(updated).toEqualTypeOf<{ label: string }[]>();
    expect(inserted).toEqual([{ id: 1, label: "[UNIT_TEST] before" }]);
    expect(updated).toEqual([{ label: "[UNIT_TEST] after" }]);
    expect(audit).toBeDefined();
  });
});
