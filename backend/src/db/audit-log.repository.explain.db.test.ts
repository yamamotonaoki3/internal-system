// #156（0-6 AC-3）: 監査ログの検索の SQL が、絞り込み・並びに合う索引を使い（表を頭から読まない・並べ替えの一時表を作らない）、
// 件数に比例して SQL の数が増えない（N+1 にしない）ことを、隔離 D1 の EXPLAIN QUERY PLAN で確かめる（Skill「backend」）。
// 方法：実行した SQL と値を記録する D1（threads.explain.db.test.ts と同じ形）を withAuditLogReader に渡して search を呼び、
//   記録した audit_logs の SELECT を EXPLAIN QUERY PLAN にかける。Repository の関数名・SQL の書き方に依存しない（search の呼び出しだけで確かめる）。
// 期待（計画 #156「索引」）：
//   操作者の絞り込み → audit_logs_actor_occurred_idx、操作の絞り込み → audit_logs_action_occurred_idx、
//   対象（種類と ID）の絞り込み → audit_logs_target_occurred_idx、絞り込みなし・期間だけ → 既存の audit_logs_occurred_at_id_idx。
//   どれも、監査ログの表を索引なしで全件走査せず、ORDER BY のための一時の B-TREE を作らない。
// データは架空（testuser_156x_）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AUDIT_TRACE_PREFIX,
  auditId,
  cleanupAuditLogTestData,
  insertAuditLog,
  remainingAuditTestRows,
} from "../../test/audit-log-fixtures";
import { insertSession } from "../../test/auth-fixtures";
import { cleanupMessageScenario } from "../../test/message-fixtures";
import {
  insertAssignment,
  insertDepartment,
  insertUser,
} from "../../test/role-fixtures";
import { ROLE_IDS } from "../lib/permissions";
import { withAuditLogReader } from "./audit-log.repository";

type Recorded = { sql: string; params: unknown[] };

/** 実行した SQL（prepare）と値（bind）を記録する D1 */
function recordingDb(statements: Recorded[]): D1Database {
  return new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "prepare")
        return (query: string) => {
          const entry: Recorded = { sql: query, params: [] };
          statements.push(entry);
          const prepared = target.prepare(query);
          return new Proxy(prepared, {
            get(stmt, key) {
              if (key === "bind")
                return (...values: unknown[]) => {
                  entry.params = values;
                  return stmt.bind(...values);
                };
              const value: unknown = Reflect.get(stmt, key, stmt);
              return typeof value === "function" ? value.bind(stmt) : value;
            },
          });
        };
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

let viewer: string;
let sessionId: string;
let actor: string;

async function recordedSearch(filter: Record<string, string>) {
  const statements: Recorded[] = [];
  await withAuditLogReader(
    { ...env, DB: recordingDb(statements) } as Env,
    (reader) =>
      reader.search({
        viewer: {
          userId: viewer,
          sessionId,
          traceId: `${AUDIT_TRACE_PREFIX}explain`,
        },
        now: new Date(),
        filter,
        limit: 20,
      }),
  );
  return statements;
}

/** 記録した文のうち、監査ログの一覧の SELECT（audit_logs を FROM に持つ SELECT） */
function listSelect(statements: Recorded[]): Recorded {
  const found = statements.filter(
    (s) => /^\s*select/i.test(s.sql) && /from\s+"?audit_logs"?/i.test(s.sql),
  );
  expect(found).toHaveLength(1);
  return found[0] as Recorded;
}

async function planOf(select: Recorded): Promise<string[]> {
  const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${select.sql}`)
    .bind(...select.params)
    .all<{ detail: string }>();
  return results.map((r) => r.detail);
}

beforeEach(async () => {
  const dept = await insertDepartment("156索引");
  viewer = await insertUser("testuser_156x_viewer", dept);
  actor = await insertUser("testuser_156x_actor", dept);
  await insertAssignment(viewer, ROLE_IDS.globalAdmin, "company", null);
  sessionId = (
    await insertSession(viewer, { createdAt: new Date().toISOString() })
  ).id;
  await insertAuditLog({
    id: auditId(1),
    occurredAt: "2031-03-04T01:00:00.000Z",
    actorId: actor,
    action: "account.create",
    targetType: "user",
    targetId: actor,
  });
});

afterEach(async () => {
  await cleanupAuditLogTestData();
  await cleanupMessageScenario();
  expect(await remainingAuditTestRows()).toBe(0);
});

describe("#156 0-6 AC-3: 検索の SQL の実行計画（EXPLAIN QUERY PLAN）", () => {
  const cases: [string, Record<string, string>, string][] = [
    ["操作者", { actorId: "ACTOR" }, "audit_logs_actor_occurred_idx"],
    [
      "操作の種類",
      { action: "account.create" },
      "audit_logs_action_occurred_idx",
    ],
    [
      "対象（種類と ID）",
      { targetType: "user", targetId: "ACTOR" },
      "audit_logs_target_occurred_idx",
    ],
    [
      "期間だけ",
      { from: "2031-03-04", to: "2031-03-04" },
      "audit_logs_occurred_at_id_idx",
    ],
    ["絞り込みなし", {}, "audit_logs_occurred_at_id_idx"],
  ];

  it.each(cases)(
    "#156 0-6 AC-3: %sの絞り込みは、索引 %s を使い、全件走査も並べ替えの一時表も使わない",
    async (_label, filter, index) => {
      const resolved = Object.fromEntries(
        Object.entries(filter).map(([k, v]) => [k, v === "ACTOR" ? actor : v]),
      );
      const plan = await planOf(listSelect(await recordedSearch(resolved)));
      const text = plan.join("\n");
      expect(text).toContain(`INDEX ${index}`);
      expect(text).not.toContain("USE TEMP B-TREE FOR ORDER BY");
      // 監査ログの表を、索引なしで頭から読む計画（「SCAN a」「SCAN audit_logs」のあとに USING INDEX が続かないもの）
      const unindexedScan = plan.filter(
        (line) => /^SCAN (a|audit_logs)\b/.test(line) && !/USING/.test(line),
      );
      expect(unindexedScan).toEqual([]);
    },
  );

  it("#156 0-6 AC-3: 名前の解決は、結合1回で行う（行の数が増えても SQL の数は同じ。N+1 にしない）", async () => {
    const small = (await recordedSearch({ actorId: actor })).length;
    for (let n = 2; n <= 30; n += 1)
      await insertAuditLog({
        id: auditId(n),
        occurredAt: `2031-03-04T01:00:${String(n).padStart(2, "0")}.000Z`,
        actorId: actor,
        action: "account.create",
        targetType: "user",
        targetId: actor,
      });
    const large = (await recordedSearch({ actorId: actor })).length;
    expect(large).toBe(small);
    expect(small).toBeLessThanOrEqual(3);
  });

  it("#156 0-6 AC-3: 一覧の SELECT は件数を LIMIT で切り、OFFSET を使わない", async () => {
    const { sql } = listSelect(await recordedSearch({ actorId: actor }));
    expect(sql).toMatch(/limit/i);
    expect(sql).not.toMatch(/offset/i);
  });
});
