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
  casereqTraceId,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { eventIdAt, insertTodo, todoIdAt } from "../../test/case-todo-fixtures";
import { createAccountRepository } from "./account.repository";
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

  it("#149 AC-1 計画 6.9(3): 完了・取り消しの記録の順の条件は、case_todo_events_todo_id_id_idx を使い、case_todo_events を全件走査しない", async () => {
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
    await expectIndexed(
      statements,
      "case_todo_events",
      "case_todo_events_todo_id_id_idx",
    );
  });

  it("#149 AC-1 計画 6.1: 記録の ID の作り直しの基準（記録の表の全体の最大の ID）は、索引を使い、case_todo_events を全件走査しない", async () => {
    const statements: Recorded[] = [];
    const repository = createCaseTodoRepository(dbOf(statements));
    await repository.maxEventIdOverall();
    const reading = statements.filter((s) =>
      /\bcase_todo_events\b/i.test(s.sql),
    );
    expect(reading.length, "case_todo_events を読む文がない").toBe(1);
    const plan = await planOf(reading[0]!);
    // 実測：SEARCH case_todo_events USING COVERING INDEX sqlite_autoindex_case_todo_events_1（主キー ID の索引で最大を読む）
    expect(plan.length, plan.join(" / ")).toBeGreaterThan(0);
    for (const detail of plan) {
      expect(detail.startsWith("SCAN"), `全件走査している：${detail}`).toBe(
        false,
      );
      expect(detail).toMatch(
        /^SEARCH case_todo_events USING (COVERING )?INDEX/,
      );
    }
  });
});

// ---- #149（149-D）決定 Q6・計画 6.3.2・10節「実行計画」：担当者が外れたときの対象の読み取りと書き換え ----
// 無効化（全案件。assignee_id だけで絞る）は、担当の列の索引（migration 0031。決定 Q6）を使う。索引の名前は実装に任せ、
// 「case_todos の索引で、先頭の列が assignee_id のもの」を PRAGMA で探して使う。
// 参加者の削除・退出（case_id と assignee_id で絞る）は、case_todos を全件走査しない（計画は case_todos_case_id_id_idx。
// 担当の列の索引が加わった後は、どちらを選ぶかは SQLite の判断のため、2つのどちらかを使えばよいとする）。
async function assigneeIndexName(): Promise<string | null> {
  const { results: indexes } = await env.DB.prepare(
    "PRAGMA index_list('case_todos')",
  ).all<{ name: string }>();
  for (const index of indexes) {
    const { results: columns } = await env.DB.prepare(
      `PRAGMA index_info('${index.name}')`,
    ).all<{ seqno: number; name: string }>();
    const first = columns.find((c) => c.seqno === 0);
    if (first?.name === "assignee_id") return index.name;
  }
  return null;
}

describe("#149 149-D 決定 Q6 担当の列の索引と実行計画", () => {
  it("#149 149-D 決定 Q6: case_todos に、先頭の列が assignee_id の索引がある（migration 0031）", async () => {
    expect(await assigneeIndexName()).not.toBeNull();
  });

  it("#149 149-D 決定 Q6: 無効化の、対象の TODO の読み取りと担当の書き換えは、担当の列の索引を使い、case_todos を全件走査しない", async () => {
    await insertTodo({
      id: todoIdAt(21),
      caseId: room.id,
      title: "[UNIT_TEST]149D実行計画の無効化",
      createdBy: w.memberS1.id,
      assigneeId: w.memberD1.id,
    });
    const index = await assigneeIndexName();
    expect(index).not.toBeNull();
    const statements: Recorded[] = [];
    await createAccountRepository(dbOf(statements)).deactivate({
      targetId: w.memberD1.id,
      actorId: w.admin.id,
      now: "2026-11-20T05:00:00.000Z",
      traceId: casereqTraceId(),
    });
    await expectIndexed(statements, "case_todos", index ?? "");
  });

  it("#149 149-D 計画 6.3.2: 参加者の削除の、対象の TODO の読み取りと担当の書き換えは、case_todos を全件走査せず、case_todos の索引を使う", async () => {
    await insertTodo({
      id: todoIdAt(22),
      caseId: room.id,
      title: "[UNIT_TEST]149D実行計画の削除",
      createdBy: w.memberS1.id,
      assigneeId: w.memberD1.id,
    });
    const index = await assigneeIndexName();
    const statements: Recorded[] = [];
    await createCaseRepository(dbOf(statements)).removeParticipant({
      caseId: room.id,
      actorId: w.memberS1.id,
      userId: w.memberD1.id,
      traceId: casereqTraceId(),
    });
    const reading = statements.filter((s) => /\bcase_todos\b/i.test(s.sql));
    expect(reading.length, "case_todos を読む文がない").toBeGreaterThan(0);
    const allowed = ["case_todos_case_id_id_idx", index ?? "(なし)"];
    const searched: string[] = [];
    for (const statement of reading) {
      const plan = await planOf(statement);
      const names = namesOf(statement.sql, "case_todos");
      for (const detail of plan) {
        const scanned = /^SCAN (\S+)/.exec(detail)?.[1]?.replace(/"/g, "");
        if (scanned !== undefined && names.includes(scanned.toLowerCase()))
          expect(
            /USING (COVERING )?INDEX/.test(detail),
            `case_todos を全件走査している：${detail}\n${statement.sql}`,
          ).toBe(true);
      }
      const searchesTodos = plan.filter((d) =>
        names.some((name) => new RegExp(`^SEARCH ${name}\\b`, "i").test(d)),
      );
      searched.push(...searchesTodos);
      for (const detail of searchesTodos)
        expect(
          allowed.some((a) => detail.includes(a)),
          `決めた索引を使っていない：${detail}`,
        ).toBe(true);
    }
    expect(searched.length, "case_todos の SEARCH の行がない").toBeGreaterThan(
      0,
    );
  });
});

// ---- #149（149-C）計画 plan-149c 9.2（X1・X2）：履歴・削除済みの一覧の読み取り ----
// 必要な索引は既にある（計画 4節）。通らない場合は、索引の migration の要否を利用者に決めてもらう（計画 9.2）。
describe("#149 149-C 計画 9.2 履歴・削除済みの一覧の実行計画", () => {
  it("#149 149-C 5-4 AC-10 X1: 履歴の取得（1ページ目・続き）の記録の読み取りは、case_todo_events_todo_id_id_idx を使い、case_todo_events を全件走査しない", async () => {
    for (const n of [1, 2, 3])
      await env.DB.prepare(
        `INSERT INTO case_todo_events (id, todo_id, case_id, kind, actor_id, title, previous_title, assignee_id, assignee_name,
           previous_assignee_id, previous_assignee_name, created_at)
         VALUES (?, ?, ?, 'uncomplete', ?, NULL, NULL, NULL, NULL, NULL, NULL, '2026-11-20T05:00:00.000Z')`,
      )
        .bind(eventIdAt(n), todoIdAt(1), room.id, w.memberS1.id)
        .run();
    const statements: Recorded[] = [];
    const repository = createCaseTodoRepository(dbOf(statements));
    const first = await repository.listTodoEvents({
      caseId: room.id,
      todoId: todoIdAt(1),
      viewerId: w.memberS1.id,
      limit: 2,
      cursor: null,
    });
    if (typeof first === "string") throw new Error(first);
    expect(first.nextCursor).not.toBeNull();
    await repository.listTodoEvents({
      caseId: room.id,
      todoId: todoIdAt(1),
      viewerId: w.memberS1.id,
      limit: 2,
      cursor: first.nextCursor,
    });
    await expectIndexed(
      statements,
      "case_todo_events",
      "case_todo_events_todo_id_id_idx",
    );
  });

  it("#149 149-C 5-4 AC-12 X2: 削除済みの一覧（1ページ目・続き）は、case_todos_case_id_id_idx を使い、case_todos を全件走査しない", async () => {
    await env.DB.prepare(
      "UPDATE case_todos SET deleted_at = '2026-11-20T05:00:00.000Z', deleted_by = ? WHERE case_id = ?",
    )
      .bind(w.memberS1.id, room.id)
      .run();
    const statements: Recorded[] = [];
    const repository = createCaseTodoRepository(dbOf(statements));
    const first = await repository.listDeletedTodos({
      caseId: room.id,
      viewerId: w.memberS1.id,
      limit: 2,
      cursor: null,
    });
    if (typeof first === "string") throw new Error(first);
    expect(first.nextCursor).not.toBeNull();
    await repository.listDeletedTodos({
      caseId: room.id,
      viewerId: w.memberS1.id,
      limit: 2,
      cursor: first.nextCursor,
    });
    await expectIndexed(statements, "case_todos", "case_todos_case_id_id_idx");
  });
});
