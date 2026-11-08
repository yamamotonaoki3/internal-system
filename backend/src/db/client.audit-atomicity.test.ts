// #192 AC-3: 実D1の監査挿入失敗で取引先更新が部分確定しないことを検証する。
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { testId } from "../../test/role-fixtures";
import { createClientRepository } from "./client.repository";
import { withDatabase } from "./database";

const trigger = "unit_test_192_client_rename_audit_abort";
const initialName = "[UNIT_TEST_192_ATOMIC]Alpha";
const changedName = "[UNIT_TEST_192_ATOMIC]Beta";

async function snapshot(id: string) {
  const client = await env.DB.prepare(
    "SELECT id, code, name, name_normalized, is_active, version, updated_at FROM clients WHERE id = ?",
  )
    .bind(id)
    .first();
  const audit = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM audit_logs WHERE target_type = 'client' AND target_id = ?",
  )
    .bind(id)
    .first<{ count: number }>();
  return { client, auditCount: audit?.count };
}

describe("#192 取引先更新と監査の原子性（D1）", () => {
  it("#192 AC-3（5-7 AC-3）: 改名監査の挿入失敗で名前・状態・版・監査が一切変わらない", async () => {
    const id = testId("CLIENT");
    const now = "2026-11-08T00:00:00.000Z";
    await env.DB.prepare(
      "INSERT INTO clients (id, code, name, name_normalized, is_active, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)",
    )
      .bind(id, "ABC", initialName, initialName.toLowerCase(), now, now)
      .run();
    let triggerCreated = false;
    try {
      const before = await snapshot(id);
      // この隔離D1で、このテストの対象行に対する改名監査だけを失敗させる。
      expect(id).toMatch(/^[0-9A-Z]{26}$/);
      await env.DB.prepare(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs
         WHEN NEW.action = 'client.rename' AND NEW.target_id = '${id}'
         BEGIN SELECT RAISE(ABORT, 'unit_test_192_audit_failure'); END`,
      ).run();
      triggerCreated = true;
      await expect(
        withDatabase(env, (db) =>
          createClientRepository(db).rename(
            id,
            1,
            changedName,
            changedName.toLowerCase(),
            { actorId: "testuser_192_atomic", traceId: "unit_test_192_atomic" },
          ),
        ),
      ).rejects.toThrow();
      expect(await snapshot(id)).toEqual(before);
    } finally {
      if (triggerCreated) {
        await env.DB.prepare(`DROP TRIGGER ${trigger}`).run();
      }
      await env.DB.prepare(
        "DELETE FROM audit_logs WHERE target_type = 'client' AND target_id = ?",
      )
        .bind(id)
        .run();
      await env.DB.prepare("DELETE FROM clients WHERE id = ?").bind(id).run();
    }
  });
});
