// #149（149-A）計画 6.9(3)・6.10、5-4 AC-11：ID の順と確定の順（別の Worker の ID の生成は順を保証しない）。
// 同じ案件の TODO・同じ TODO の記録に、より大きい ID がすでに確定していると、最初の試行は batch 全体が取り消される。
// Service は最初と同じ判定で読み直し、理由に当たらなければ ID の順の逆転とみなして、確定済みの最大より大きい ID で作り直し、batch 全体をやり直す。
// やり直しの上限はメッセージと同じ回数（最初の1回＋作り直し3回）。超えたら成功にせず 503 で、何も残らない。
// この層で確かめるもの：やり直しの後に、必要な行（TODO・記録）が1回分だけ残り、ID が確定済みの最大より大きい（一覧の最後に並ぶ）こと。
// 契約（実装前の仮置き。実装の担当へ）：backend/src/services/case-todo.service.ts
//   createCaseTodoService(repository: CaseTodoRepository, roles: RoleAssignmentRepository)
//   service.addTodo(actor, caseId, body: unknown)・service.completeTodo(actor, caseId, todoId)・service.uncompleteTodo(actor, caseId, todoId)
//   actor = { userId, traceId }。Repository の書き込みの関数の名前は addTodo・completeTodo・uncompleteTodo（DB のテストと同じ）。
// 時刻は CASEREQ_NOW に固定する。データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupCaseTestData,
  joinedAt,
  removeCaseMember,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  CASEREQ_NOW,
  casereqTraceId,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import {
  futureIdAt,
  insertTodo,
  insertTodoEvent,
  todoEventsOf,
  todoIdAt,
  todoRow,
  todoRowsOf,
  todoSnapshot,
} from "../../test/case-todo-fixtures";
import {
  withCaseTodos,
  type CaseTodoRepository,
} from "../db/case-todo.repository";
import { AppError } from "../lib/app-error";
import { createCaseTodoService } from "./case-todo.service";

let w: CaseWorld;
let room: SeededCase;

const actorOf = (userId: string) => ({ userId, traceId: casereqTraceId() });

/** 書き込みの関数を包んだ Repository で Service を作って動かす */
function run<T>(
  wrap: (repository: CaseTodoRepository) => CaseTodoRepository,
  operation: (service: ReturnType<typeof createCaseTodoService>) => Promise<T>,
): Promise<T> {
  return withCaseTodos(env, (repository, roles) =>
    operation(createCaseTodoService(wrap(repository), roles)),
  );
}
const asIs = (r: CaseTodoRepository) => r;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(CASEREQ_NOW));
  w = await setupCaseWorld();
  room = await seedCase({
    n: 1497,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]149A ID の順",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
    ],
  });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupCaseTestData();
});

/** room の TODO を入れる（担当 memberD1） */
const seedTodo = (id: string, done = false) =>
  insertTodo({
    id,
    caseId: room.id,
    title: "[UNIT_TEST]149A既存",
    createdBy: w.memberS1.id,
    assigneeId: w.memberD1.id,
    recordedAssigneeName: "テスト担当149",
    isDone: done,
    completedAssigneeId: done ? w.memberD1.id : null,
    completedAssigneeName: done ? "テスト担当149" : null,
  });

describe("#149 AC-1 計画 6.9(3)・6.10 追加の ID の作り直し", () => {
  it("#149 AC-1 計画 6.9(3): 同じ案件に、より大きい ID の TODO が確定していても、作り直して追加でき、TODO と記録 create が1件ずつ、最後に並ぶ", async () => {
    await seedTodo(futureIdAt(1));
    const created = (await run(asIs, (s) =>
      s.addTodo(actorOf(w.memberS1.id), room.id, {
        title: "[UNIT_TEST]149A後の追加",
      }),
    )) as { id: string };
    const rows = await todoRowsOf(room.id);
    expect(rows.map((r) => r.id)).toEqual([futureIdAt(1), created.id]);
    expect(created.id > futureIdAt(1)).toBe(true);
    expect((await todoEventsOf(created.id)).map((e) => e.kind)).toEqual([
      "create",
    ]);
  });

  it("#149 AC-1 計画 6.10: 作り直しが上限（最初の1回＋3回）を超えたら 503 で、試行の TODO・記録は何も残らない", async () => {
    await seedTodo(futureIdAt(1));
    let calls = 0;
    const before = await todoSnapshot();
    const wrap = (r: CaseTodoRepository): CaseTodoRepository => ({
      ...r,
      addTodo: async (input) => {
        calls += 1;
        // 毎回、より大きい ID の TODO が先に確定する
        await seedTodo(futureIdAt(1 + calls));
        return r.addTodo(input);
      },
    });
    const error = await run(wrap, (s) =>
      s.addTodo(actorOf(w.memberS1.id), room.id, { title: "[UNIT_TEST]149A" }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("SERVICE_UNAVAILABLE");
    expect(calls).toBe(4);
    const after = await todoSnapshot();
    // 包みの中で入れた TODO（futureIdAt(2)〜(5)）だけが増え、試行の TODO・記録・案件の版は残らない
    expect(after.todos.map((t) => t.id)).toEqual([
      ...before.todos.map((t) => t.id),
      futureIdAt(2),
      futureIdAt(3),
      futureIdAt(4),
      futureIdAt(5),
    ]);
    expect(after.events).toEqual(before.events);
    expect(after.cases).toEqual(before.cases);
  });
});

describe("#149 AC-1 計画 6.10 完了・取り消しの記録の ID の作り直し", () => {
  it("#149 AC-1 5-4 AC-11 計画 6.10: 同じ TODO に、より大きい ID の記録が確定していても、作り直して完了でき、記録 complete は1件だけ（最後）", async () => {
    await seedTodo(todoIdAt(1));
    await insertTodoEvent({
      id: futureIdAt(1),
      todoId: todoIdAt(1),
      caseId: room.id,
      kind: "create",
      actorId: w.memberS1.id,
    });
    await run(asIs, (s) =>
      s.completeTodo(actorOf(w.memberS1.id), room.id, todoIdAt(1)),
    );
    const events = await todoEventsOf(todoIdAt(1));
    expect(events.map((e) => e.kind)).toEqual(["create", "complete"]);
    expect(events[1]!.id > futureIdAt(1)).toBe(true);
    expect(await todoRow(todoIdAt(1))).toMatchObject({
      is_done: 1,
      version: 2,
    });
  });

  it("#149 AC-1 計画 6.10: 取り消し（記録1件）も、作り直して1回分だけ残る", async () => {
    await seedTodo(todoIdAt(1), true);
    await insertTodoEvent({
      id: futureIdAt(1),
      todoId: todoIdAt(1),
      caseId: room.id,
      kind: "complete",
      actorId: w.memberS1.id,
    });
    await run(asIs, (s) =>
      s.uncompleteTodo(actorOf(w.memberS1.id), room.id, todoIdAt(1)),
    );
    const events = await todoEventsOf(todoIdAt(1));
    expect(events.map((e) => e.kind)).toEqual(["complete", "uncomplete"]);
    expect(await todoRow(todoIdAt(1))).toMatchObject({
      is_done: 0,
      version: 2,
    });
  });

  it("#149 AC-1 計画 6.9(2)・6.10: 取り消し（auto_unassign を含む2件）も、作り直して auto_unassign → uncomplete の順に1件ずつ残る", async () => {
    await seedTodo(todoIdAt(1), true);
    await removeCaseMember(room.roomId, w.memberD1.id);
    await insertTodoEvent({
      id: futureIdAt(1),
      todoId: todoIdAt(1),
      caseId: room.id,
      kind: "complete",
      actorId: w.memberS1.id,
    });
    await run(asIs, (s) =>
      s.uncompleteTodo(actorOf(w.memberS1.id), room.id, todoIdAt(1)),
    );
    const events = await todoEventsOf(todoIdAt(1));
    expect(events.map((e) => e.kind)).toEqual([
      "complete",
      "auto_unassign",
      "uncomplete",
    ]);
    expect(await todoRow(todoIdAt(1))).toMatchObject({
      is_done: 0,
      assignee_id: null,
      recorded_assignee_id: w.memberD1.id,
    });
  });

  it("#149 AC-1 計画 6.10: 完了の作り直しが上限を超えたら 503 で、完了・版・記録は変わらない", async () => {
    await seedTodo(todoIdAt(1));
    let calls = 0;
    const wrap = (r: CaseTodoRepository): CaseTodoRepository => ({
      ...r,
      completeTodo: async (input) => {
        calls += 1;
        await insertTodoEvent({
          id: futureIdAt(calls),
          todoId: todoIdAt(1),
          caseId: room.id,
          kind: "create",
          actorId: w.memberS1.id,
        });
        return r.completeTodo(input);
      },
    });
    const error = await run(wrap, (s) =>
      s.completeTodo(actorOf(w.memberS1.id), room.id, todoIdAt(1)),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("SERVICE_UNAVAILABLE");
    expect(calls).toBe(4);
    expect(await todoRow(todoIdAt(1))).toMatchObject({
      is_done: 0,
      version: 1,
    });
    expect(
      (await todoEventsOf(todoIdAt(1))).filter((e) => e.kind === "complete"),
    ).toEqual([]);
  });
});
