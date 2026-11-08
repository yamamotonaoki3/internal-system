// #192 AC-2・AC-4: 実際のマイグレーション済み D1 で初期値と一意制約を検証する。
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { testId } from "../../test/role-fixtures";
import { withClients } from "./client.repository";

const NOW = "2026-11-07T00:00:00.000Z";
const TAG = "[UNIT_TEST]";
const createdIds = new Set<string>();
async function insert(code: string, name: string, key: string) {
  const id = testId("CLIENT");
  await env.DB.prepare(
    "INSERT INTO clients (id, code, name, name_normalized, is_active, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)",
  )
    .bind(id, code, name, key, NOW, NOW)
    .run();
  createdIds.add(id);
  return id;
}
afterEach(async () => {
  for (const id of createdIds) {
    await env.DB.prepare("DELETE FROM audit_logs WHERE target_id = ?")
      .bind(id)
      .run();
    await env.DB.prepare("DELETE FROM clients WHERE id = ?").bind(id).run();
  }
  createdIds.clear();
});
describe("#192 取引先の永続制約（D1）", () => {
  it("#192 AC-4（5-7 AC-5・AC-9・AC-10）: 空DBのマイグレーション後に有効なINTがちょうど1件ある", async () => {
    const rows = await env.DB.prepare(
      "SELECT code, name, is_active FROM clients WHERE code = 'INT'",
    ).all<{ code: string; name: string; is_active: number }>();
    expect(rows.results).toEqual([{ code: "INT", name: "社内", is_active: 1 }]);
  });

  it("#192 AC-2（5-7 AC-2）: 無効行と同じコードもDB一意制約が拒否する", async () => {
    const id = await insert("ABC", `${TAG}Alpha`, `${TAG}alpha`.toLowerCase());
    await env.DB.prepare("UPDATE clients SET is_active = 0 WHERE id = ?")
      .bind(id)
      .run();
    await expect(
      insert("ABC", `${TAG}Beta`, `${TAG}beta`.toLowerCase()),
    ).rejects.toThrow();
    const result = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM clients WHERE code = ?",
    )
      .bind("ABC")
      .first<{ n: number }>();
    expect(result?.n).toBe(1);
  });

  it("#192 AC-2（5-7 AC-7）: 無効行と同じ比較キーもDB一意制約が拒否する", async () => {
    const key = `${TAG}sample`.toLowerCase();
    const id = await insert("ABC", `${TAG}Sample`, key);
    await env.DB.prepare("UPDATE clients SET is_active = 0 WHERE id = ?")
      .bind(id)
      .run();
    await expect(insert("DEF", `${TAG}sample`, key)).rejects.toThrow();
    const result = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM clients WHERE name_normalized = ?",
    )
      .bind(key)
      .first<{ n: number }>();
    expect(result?.n).toBe(1);
  });

  it("#192 AC-2（5-7 AC-2・AC-7）: 同じ名前の並行登録は1件だけ確定する", async () => {
    const key = `${TAG}same`.toLowerCase();
    const results = await Promise.allSettled([
      insert("ABC", `${TAG}Same`, key),
      insert("DEF", `${TAG}same`, key),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const stored = await env.DB.prepare(
      "SELECT code FROM clients WHERE name_normalized = ?",
    )
      .bind(key)
      .all<{ code: string }>();
    expect(stored.results).toHaveLength(1);
  });
  it("#192 AC-3・AC-8: 同じ版の並行改名は一方だけ確定し敗者監査を残さない", async () => {
    const id = await insert(
      "ABC",
      "[UNIT_TEST]Concurrent",
      "[unit_test]concurrent",
    );
    const write = { actorId: "testuser_192_cas", traceId: "unit_test_192_cas" };
    try {
      const results = await withClients(env, async (repository) =>
        Promise.all([
          repository.rename(
            id,
            1,
            "[UNIT_TEST]First",
            "[unit_test]first",
            write,
          ),
          repository.rename(
            id,
            1,
            "[UNIT_TEST]Second",
            "[unit_test]second",
            write,
          ),
        ]),
      );
      expect(results.filter((result) => result !== null)).toHaveLength(1);
      expect(results.filter((result) => result === null)).toHaveLength(1);
      const stored = await env.DB.prepare(
        "SELECT name, version FROM clients WHERE id = ?",
      )
        .bind(id)
        .first<{ name: string; version: number }>();
      expect(stored?.version).toBe(2);
      expect(["[UNIT_TEST]First", "[UNIT_TEST]Second"]).toContain(stored?.name);
      const audits = await env.DB.prepare(
        "SELECT action, target_id AS targetId, detail FROM audit_logs WHERE target_id = ? AND action = 'client.rename'",
      )
        .bind(id)
        .all<{ action: string; targetId: string; detail: string | null }>();
      expect(audits.results).toHaveLength(1);
      expect(audits.results[0]).toMatchObject({
        action: "client.rename",
        targetId: id,
      });
      expect(JSON.parse(audits.results[0]?.detail ?? "{}")).toMatchObject({
        previousVersion: 1,
        nextVersion: 2,
      });
    } finally {
      await env.DB.prepare(
        "DELETE FROM audit_logs WHERE target_id = ? AND action = 'client.rename'",
      )
        .bind(id)
        .run();
    }
  });
});
