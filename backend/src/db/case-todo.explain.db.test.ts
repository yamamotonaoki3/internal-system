// #149（149-A）計画 6.9(6)「負荷の確認」：TODO の一覧・進捗、概要・案件の一覧の進捗、完了・取り消しの記録の SQL が、
// 索引（case_todos_case_id_id_idx・case_todo_events_todo_id_id_idx）を使い、TODO の表・記録の表を索引なしで全件走査（SCAN）しないことを、
// 隔離 D1 の EXPLAIN QUERY PLAN で確かめる（先例：audit-log.repository.explain.db.test.ts）。
// 方法：実行した SQL と値を記録する D1 を Repository に渡して呼び、記録した文のうち TODO の表・記録の表を読むものを EXPLAIN QUERY PLAN にかける。
//   表の別名は、記録した SQL の文から読み取る（実装の別名に依存しない）。主キーでの検索（SEARCH … USING … INDEX）は許す。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../db/schema";
import {
  cleanupCaseTestData,
  joinedAt,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { eventIdAt, insertTodo, todoIdAt } from "../../test/case-todo-fixtures";
import { createCaseTodoRepository } from "./case-todo.repository";
import { createCaseRepository } from "./case.repository";

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

const dbOf = (statements: Recorded[]) =>
  drizzle(recordingDb(statements), { schema });

/** その表の名前と、SQL の中で付けた別名 */
function namesOf(sqlText: string, table: string): string[] {
  const names = new Set([table]);
  const re = new RegExp(
    `"?${table}"?\\s+(?:as\\s+)?"?([a-z_][a-z0-9_]*)"?`,
    "gi",
  );
  const keywords = new Set([
    "where",
    "on",
    "inner",
    "left",
    "join",
    "order",
    "group",
    "limit",
    "set",
    "select",
    "values",
    "and",
    "or",
  ]);
  for (const match of sqlText.matchAll(re)) {
    const alias = match[1]?.toLowerCase();
    if (alias !== undefined && !keywords.has(alias)) names.add(alias);
  }
  return [...names];
}

async function planOf(statement: Recorded): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `EXPLAIN QUERY PLAN ${statement.sql}`,
  )
    .bind(...statement.params)
    .all<{ detail: string }>();
  return results.map((r) => r.detail);
}

/** TODO の表（または記録の表）を読む文の実行計画で、その表を全件走査せず、決めた索引を使うこと */
async function expectIndexed(
  statements: Recorded[],
  table: "case_todos" | "case_todo_events",
  index: string,
) {
  const reading = statements.filter((s) =>
    new RegExp(`\\b${table}\\b`, "i").test(s.sql),
  );
  expect(reading.length, `${table} を読む文がない`).toBeGreaterThan(0);
  let usedIndex = false;
  for (const statement of reading) {
    const plan = await planOf(statement);
    const names = namesOf(statement.sql, table);
    for (const detail of plan) {
      const scanned = /^SCAN (\S+)/.exec(detail)?.[1]?.replace(/"/g, "");
      if (scanned !== undefined && names.includes(scanned.toLowerCase()))
        expect(
          /USING (COVERING )?INDEX/.test(detail),
          `${table} を全件走査している：${detail}\n${statement.sql}\n${plan.join("\n")}`,
        ).toBe(true);
    }
    if (plan.some((d) => d.includes(index))) usedIndex = true;
  }
  expect(usedIndex, `${index} を使う文がない`).toBe(true);
}

let w: CaseWorld;
let room: SeededCase;
let other: SeededCase;

beforeEach(async () => {
  w = await setupCaseWorld();
  room = await seedCase({
    n: 1500,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]149A実行計画",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
    ],
  });
  other = await seedCase({
    n: 1501,
    clientId: w.clientB.id,
    code: "QZB",
    title: "[UNIT_TEST]149A実行計画の別案件",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [{ userId: w.memberS1.id, joinedAt: joinedAt(1) }],
  });
  for (const n of [1, 2, 3])
    await insertTodo({
      id: todoIdAt(n),
      caseId: room.id,
      title: `[UNIT_TEST]149A計画${n}`,
      createdBy: w.memberS1.id,
    });
  await insertTodo({
    id: todoIdAt(9),
    caseId: other.id,
    title: "[UNIT_TEST]149A計画の別案件",
    createdBy: w.memberS1.id,
  });
});

afterEach(async () => {
  await cleanupCaseTestData();
});

describe("#149 計画 6.9(6) 実行計画（EXPLAIN QUERY PLAN）", () => {
  it("#149 AC-1: TODO の一覧（1ページ目・続き）と進捗は、case_todos_case_id_id_idx を使い、case_todos を全件走査しない", async () => {
    const statements: Recorded[] = [];
    const repository = createCaseTodoRepository(dbOf(statements));
    const first = await repository.listTodos({
      caseId: room.id,
      viewerId: w.memberS1.id,
      limit: 2,
      cursor: null,
    });
    if (typeof first === "string") throw new Error(first);
    await repository.listTodos({
      caseId: room.id,
      viewerId: w.memberS1.id,
      limit: 2,
      cursor: first.nextCursor,
    });
    await expectIndexed(statements, "case_todos", "case_todos_case_id_id_idx");
  });

  it("#149 AC-1 5-1 AC-2: 概要と案件の一覧の進捗は、case_todos_case_id_id_idx を使い、case_todos を全件走査しない", async () => {
    const statements: Recorded[] = [];
    const repository = createCaseRepository(dbOf(statements));
    await repository.findSummary({ actorId: w.memberS2.id, caseId: room.id });
    await repository.list({
      actorId: w.memberS2.id,
      scope: "all",
      status: "active",
      limit: 20,
    });
    await expectIndexed(statements, "case_todos", "case_todos_case_id_id_idx");
  });

  it("#149 AC-1 計画 6.9(3): 完了・取り消しの記録の順の条件と、記録の最大の ID は、case_todo_events_todo_id_id_idx を使い、case_todo_events を全件走査しない", async () => {
    const statements: Recorded[] = [];
    const repository = createCaseTodoRepository(dbOf(statements));
    await repository.completeTodo({
      caseId: room.id,
      actorId: w.memberS1.id,
      todoId: todoIdAt(1),
      eventId: eventIdAt(1),
    });
    await repository.uncompleteTodo({
      caseId: room.id,
      actorId: w.memberS1.id,
      todoId: todoIdAt(1),
      eventId: eventIdAt(3),
      autoUnassignEventId: eventIdAt(2),
    });
    await repository.maxEventId(todoIdAt(1));
    await expectIndexed(
      statements,
      "case_todo_events",
      "case_todo_events_todo_id_id_idx",
    );
  });
});
