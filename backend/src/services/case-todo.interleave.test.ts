// #149（149-A）計画 7章「同時の操作」・6.4：最初の判定（材料の読み取り）の「直後」、書き込みの「前」に状態が変わっても、batch の前提で止まり、
// Service が最初と同じ判定で読み直して、正しい応答にすること（先例：case-participant.interleave.test.ts）。
// 挟み方：
//   - 本物の Repository（隔離 D1）のすべての関数を Proxy で包み、呼ばれた順に数える
//   - 割り込みなしで、書き込みの関数（addTodo・completeTodo・uncompleteTodo）より前に呼ばれた読み取りの回数を数え、
//     k = 1 からその回数まで、k 回目の読み取りが返った直後に状態を変える。各回の前に初期のデータに戻し、割り込めたこと（割り込みが実行されたこと）を確かめる
//   - どの k でも、結果は計画の表の応答で、書き込み（TODO・記録・案件の版）は、割り込みの直後の状態から何も変わらない（決定 Q3 の 200 を含む）
// 一覧は、k 回目の読み取り（最後の読み取りより前）の直後に閲覧者の資格を失わせると 403 で、前の項目を返さない。
// 権限の判定は本物（createCaseTodoService(repository, roles)）。
// 契約（実装前の仮置き。実装の担当へ）：backend/src/services/case-todo.service.ts
//   service.addTodo(actor, caseId, body)・service.completeTodo(actor, caseId, todoId)・service.uncompleteTodo(actor, caseId, todoId)
//   service.listTodos(actor, caseId, { limit: number, cursor: string | null })
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
import { setCaseStatus } from "../../test/case-participant-fixtures";
import {
  CASEREQ_NOW,
  casereqTraceId,
  setUserActive,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import {
  CASE_TODO_REASONS,
  eventIdAt,
  insertTodo,
  todoEventsOf,
  todoIdAt,
  todoSnapshot,
} from "../../test/case-todo-fixtures";
import {
  withCaseTodos,
  type CaseTodoRepository,
} from "../db/case-todo.repository";
import { AppError } from "../lib/app-error";
import { createCaseTodoService } from "./case-todo.service";

const WRITES = new Set(["addTodo", "completeTodo", "uncompleteTodo"]);

let w: CaseWorld;
/** 進行中・deptS 担当：memberS1・memberD1。TODO 1（未完了・担当 memberD1）と TODO 2（完了・担当 memberD1） */
let room: SeededCase;

type Snapshot = Awaited<ReturnType<typeof todoSnapshot>>;
type Recorder = {
  readsBeforeWrite: number;
  wroteAt: number | null;
  calls: number;
  interrupted: boolean;
  afterInterrupt: Snapshot | null;
};
const newRecorder = (): Recorder => ({
  readsBeforeWrite: 0,
  wroteAt: null,
  calls: 0,
  interrupted: false,
  afterInterrupt: null,
});

function interleave(
  repository: CaseTodoRepository,
  interruptAfter: number,
  interrupt: () => Promise<void>,
  recorder: Recorder,
): CaseTodoRepository {
  return new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        const isWrite = WRITES.has(String(property));
        recorder.calls += 1;
        if (isWrite && recorder.wroteAt === null)
          recorder.wroteAt = recorder.calls;
        const result: unknown = await (
          value as (...a: unknown[]) => unknown
        ).apply(target, args);
        if (!isWrite && recorder.wroteAt === null) {
          recorder.readsBeforeWrite += 1;
          if (
            recorder.readsBeforeWrite === interruptAfter &&
            !recorder.interrupted
          ) {
            recorder.interrupted = true;
            await interrupt();
            recorder.afterInterrupt = await todoSnapshot();
          }
        }
        return result;
      };
    },
  }) as CaseTodoRepository;
}

type Service = ReturnType<typeof createCaseTodoService>;
type Operation = (service: Service) => Promise<unknown>;
type Result = { ok: true; value: unknown } | { ok: false; error: unknown };

const actorOf = (userId: string) => ({ userId, traceId: casereqTraceId() });

async function runWith(
  operation: Operation,
  interruptAfter: number,
  interrupt: () => Promise<void>,
  recorder: Recorder,
): Promise<Result> {
  try {
    const value = await withCaseTodos(env, (repository, roles) =>
      operation(
        createCaseTodoService(
          interleave(repository, interruptAfter, interrupt, recorder),
          roles,
        ),
      ),
    );
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  }
}

async function resetWorld() {
  await cleanupCaseTestData();
  w = await setupCaseWorld();
  room = await seedCase({
    n: 1498,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]149A割り込み",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
    ],
  });
  await insertTodo({
    id: todoIdAt(1),
    caseId: room.id,
    title: "[UNIT_TEST]149A未完了",
    createdBy: w.memberS1.id,
    assigneeId: w.memberD1.id,
    recordedAssigneeName: "テスト担当149",
  });
  await insertTodo({
    id: todoIdAt(2),
    caseId: room.id,
    title: "[UNIT_TEST]149A完了",
    createdBy: w.memberS1.id,
    assigneeId: w.memberD1.id,
    recordedAssigneeName: "テスト担当149",
    isDone: true,
    completedAssigneeId: w.memberD1.id,
    completedAssigneeName: "テスト担当149",
  });
}

type Expected =
  | { code: "FORBIDDEN" | "VALIDATION_ERROR" | "NOT_FOUND"; fields?: string[] }
  | { code: "CONFLICT"; reason: string }
  | { ok: { completed: boolean } };

type Scenario = {
  name: string;
  operation: Operation;
  interrupt: () => Promise<void>;
  expected: Expected;
};

function matches(result: Result, expected: Expected): boolean {
  if ("ok" in expected)
    return (
      result.ok &&
      (result.value as { completed?: unknown }).completed ===
        expected.ok.completed
    );
  if (result.ok) return false;
  const { error } = result;
  if (!(error instanceof AppError) || error.code !== expected.code)
    return false;
  if ("reason" in expected) return error.details.reason === expected.reason;
  if ("fields" in expected && expected.fields !== undefined)
    return (
      JSON.stringify(error.details.fields) === JSON.stringify(expected.fields)
    );
  return true;
}

const describeResult = (result: Result) =>
  result.ok
    ? `成功 ${JSON.stringify(result.value)}`
    : result.error instanceof AppError
      ? `${result.error.code} ${JSON.stringify(result.error.details)}`
      : String(result.error);

const add = (assignee: () => string | null) => (s: Service) =>
  s.addTodo(actorOf(w.memberS1.id), room.id, {
    title: "[UNIT_TEST]149A割り込みの追加",
    assigneeUserId: assignee(),
  });
const completeOne = (s: Service) =>
  s.completeTodo(actorOf(w.memberS1.id), room.id, todoIdAt(1));
const uncompleteTwo = (s: Service) =>
  s.uncompleteTodo(actorOf(w.memberS1.id), room.id, todoIdAt(2));

// 表には関数だけを書く（resetWorld で代入する変数は、呼ばれた時点で読む）
const SCENARIOS: Scenario[] = [
  {
    name: "追加：操作者が参加者から外される → 403",
    operation: add(() => null),
    interrupt: () => removeCaseMember(room.roomId, w.memberS1.id),
    expected: { code: "FORBIDDEN" },
  },
  {
    name: "追加：操作者が無効になる → 403",
    operation: add(() => null),
    interrupt: () => setUserActive(w.memberS1.id, false),
    expected: { code: "FORBIDDEN" },
  },
  {
    name: "追加：担当者が参加者から外される → 422 assigneeUserId",
    operation: add(() => w.memberD1.id),
    interrupt: () => removeCaseMember(room.roomId, w.memberD1.id),
    expected: { code: "VALIDATION_ERROR", fields: ["assigneeUserId"] },
  },
  {
    name: "追加：担当者が無効になる → 422 assigneeUserId",
    operation: add(() => w.memberD1.id),
    interrupt: () => setUserActive(w.memberD1.id, false),
    expected: { code: "VALIDATION_ERROR", fields: ["assigneeUserId"] },
  },
  {
    name: "追加：案件が終了する → 409 closed",
    operation: add(() => w.memberD1.id),
    interrupt: () => setCaseStatus(room.id, "closed"),
    expected: { code: "CONFLICT", reason: CASE_TODO_REASONS.closed },
  },
  {
    name: "追加：操作者が外され、案件も終了する → 403（終了を漏らさない）",
    operation: add(() => null),
    interrupt: async () => {
      await removeCaseMember(room.roomId, w.memberS1.id);
      await setCaseStatus(room.id, "closed");
    },
    expected: { code: "FORBIDDEN" },
  },
  {
    name: "完了：操作者が参加者から外される → 403",
    operation: completeOne,
    interrupt: () => removeCaseMember(room.roomId, w.memberS1.id),
    expected: { code: "FORBIDDEN" },
  },
  {
    name: "完了：案件が終了する → 409 closed",
    operation: completeOne,
    interrupt: () => setCaseStatus(room.id, "closed"),
    expected: { code: "CONFLICT", reason: CASE_TODO_REASONS.closed },
  },
  {
    name: "完了：ほかの人が先に完了にする → 決定 Q3 で 200（記録は相手の1件のまま）",
    operation: completeOne,
    interrupt: async () => {
      await withCaseTodos(env, (r) =>
        r.completeTodo({
          caseId: room.id,
          actorId: w.memberD1.id,
          todoId: todoIdAt(1),
          eventId: eventIdAt(900),
        }),
      );
    },
    expected: { ok: { completed: true } },
  },
  {
    name: "完了：TODO が削除される（149-B の前は直接） → 409 todo_deleted",
    operation: completeOne,
    interrupt: async () => {
      await env.DB.prepare(
        "UPDATE case_todos SET deleted_at = ?, deleted_by = ? WHERE id = ?",
      )
        .bind(CASEREQ_NOW, w.memberD1.id, todoIdAt(1))
        .run();
    },
    expected: { code: "CONFLICT", reason: CASE_TODO_REASONS.todoDeleted },
  },
  {
    name: "取り消し：ほかの人が先に取り消す → 決定 Q3 で 200",
    operation: uncompleteTwo,
    interrupt: async () => {
      await withCaseTodos(env, (r) =>
        r.uncompleteTodo({
          caseId: room.id,
          actorId: w.memberD1.id,
          todoId: todoIdAt(2),
          eventId: eventIdAt(902),
          autoUnassignEventId: eventIdAt(901),
        }),
      );
    },
    expected: { ok: { completed: false } },
  },
  {
    name: "取り消し：操作者が無効になる → 403",
    operation: uncompleteTwo,
    interrupt: () => setUserActive(w.memberS1.id, false),
    expected: { code: "FORBIDDEN" },
  },
  {
    name: "取り消し：案件が終了する → 409 closed",
    operation: uncompleteTwo,
    interrupt: () => setCaseStatus(room.id, "closed"),
    expected: { code: "CONFLICT", reason: CASE_TODO_REASONS.closed },
  },
];

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(CASEREQ_NOW));
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupCaseTestData();
});

describe("#149 AC-1 計画 7章 判定の後・書き込みの前の割り込み", () => {
  it.each(SCENARIOS.map((s) => [s.name, s] as const))(
    "#149 AC-1 計画 7章: %s",
    async (_name, scenario) => {
      // 割り込みなしで、書き込みより前の読み取りの回数を数える
      await resetWorld();
      const probe = newRecorder();
      const plain = await runWith(scenario.operation, 0, async () => {}, probe);
      expect(plain.ok, describeResult(plain)).toBe(true);
      expect(probe.wroteAt).not.toBeNull();
      expect(probe.readsBeforeWrite).toBeGreaterThan(0);

      for (let k = 1; k <= probe.readsBeforeWrite; k += 1) {
        await resetWorld();
        const recorder = newRecorder();
        const result = await runWith(
          scenario.operation,
          k,
          scenario.interrupt,
          recorder,
        );
        expect(recorder.interrupted, `k=${k} で割り込めていない`).toBe(true);
        expect(
          matches(result, scenario.expected),
          `k=${k}: ${describeResult(result)}`,
        ).toBe(true);
        // 割り込みの直後の状態から、何も書いていない（決定 Q3 の 200 も、記録を足さない）
        expect(await todoSnapshot(), `k=${k}`).toEqual(recorder.afterInterrupt);
      }
    },
  );

  it("#149 AC-1 決定 Q3・計画 7章: 二重の完了でも、記録 complete は1件だけ（割り込んだ相手の分）", async () => {
    await resetWorld();
    const recorder = newRecorder();
    const result = await runWith(
      completeOne,
      1,
      async () => {
        await withCaseTodos(env, (r) =>
          r.completeTodo({
            caseId: room.id,
            actorId: w.memberD1.id,
            todoId: todoIdAt(1),
            eventId: eventIdAt(900),
          }),
        );
      },
      recorder,
    );
    expect(result.ok, describeResult(result)).toBe(true);
    const completes = (await todoEventsOf(todoIdAt(1))).filter(
      (e) => e.kind === "complete",
    );
    expect(completes.map((e) => e.actor_id)).toEqual([w.memberD1.id]);
  });
});

describe("#149 AC-1 計画 7章 一覧の読み取りと、閲覧者の資格の喪失", () => {
  const listAs = (s: Service) =>
    s.listTodos(actorOf(w.memberS1.id), room.id, { limit: 100, cursor: null });

  it.each([
    ["参加者から外される", () => removeCaseMember(room.roomId, w.memberS1.id)],
    ["無効になる", () => setUserActive(w.memberS1.id, false)],
  ])(
    "#149 AC-1 R-76: 閲覧者が、最後の読み取りより前のどの読み取りの直後に%sても 403 で、項目・進捗を返さない",
    async (_label, lose) => {
      await resetWorld();
      const probe = newRecorder();
      const plain = await runWith(listAs, 0, async () => {}, probe);
      expect(plain.ok, describeResult(plain)).toBe(true);
      const total = probe.readsBeforeWrite;
      expect(total).toBeGreaterThan(0);
      for (let k = 1; k < total; k += 1) {
        await resetWorld();
        const recorder = newRecorder();
        const result = await runWith(listAs, k, lose, recorder);
        expect(recorder.interrupted, `k=${k}`).toBe(true);
        expect(
          matches(result, { code: "FORBIDDEN" }),
          `k=${k}: ${describeResult(result)}`,
        ).toBe(true);
      }
      // 読み取りの前に資格を失っていれば 403（k=0 にあたる）
      await resetWorld();
      await lose();
      const before = await runWith(listAs, 0, async () => {}, newRecorder());
      expect(
        matches(before, { code: "FORBIDDEN" }),
        describeResult(before),
      ).toBe(true);
    },
  );
});
