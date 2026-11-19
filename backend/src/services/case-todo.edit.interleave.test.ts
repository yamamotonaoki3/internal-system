// #149（149-B）計画 7章「同時の操作」・10節 #28〜#34：編集・削除の最初の判定（材料の読み取り）の「直後」、書き込みの「前」に状態が変わっても、
// batch の前提で止まり、Service が最初と同じ判定で読み直して、正しい応答にすること（先例：services/case-todo.interleave.test.ts）。
// 挟み方：
//   - 本物の Repository（隔離 D1）のすべての関数を Proxy で包み、呼ばれた順に数える
//   - 割り込みなしで、書き込みの関数（editTodo・deleteTodo）より前に呼ばれた読み取りの回数を数え、k = 1 からその回数まで、
//     k 回目の読み取りが返った直後に状態を変える。各回の前に初期のデータに戻し、割り込めたこと（割り込みが実行され、その変更が DB に確定したこと）を確かめる
//   - 失敗・何も書かない結果のときは、書き込み（TODO・記録・案件の版）が割り込みの直後の状態から何も変わらない
// 権限の判定は本物（createCaseTodoService(repository, roles)）。
// 契約（実装前の仮置き。実装の担当へ）：backend/src/services/case-todo.service.ts
//   service.editTodo(actor, caseId, todoId, body: unknown)・service.deleteTodo(actor, caseId, todoId)
//   Repository の書き込みの関数の名前は editTodo・deleteTodo（db/case-todo.repository.edit.db.test.ts と同じ）
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
  todoRow,
  todoSnapshot,
} from "../../test/case-todo-fixtures";
import {
  withCaseTodos,
  type CaseTodoRepository,
} from "../db/case-todo.repository";
import { AppError } from "../lib/app-error";
import { createCaseTodoService } from "./case-todo.service";

const WRITES = new Set(["editTodo", "deleteTodo"]);

let w: CaseWorld;
/** 進行中：A＝memberS1・B＝memberD1・C＝ownerD。T1（未完了・担当 B・版1） */
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
  interrupt: () => Promise<unknown>,
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
  interrupt: () => Promise<unknown>,
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
    n: 1506,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]149B割り込み",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
      { userId: w.ownerD.id, joinedAt: joinedAt(3) },
    ],
  });
  await insertTodo({
    id: todoIdAt(1),
    caseId: room.id,
    title: "[UNIT_TEST]149B未完了",
    createdBy: w.memberS1.id,
    assigneeId: w.memberD1.id,
    recordedAssigneeName: "テスト担当149B",
  });
}

type Expected =
  | { code: "FORBIDDEN" | "VALIDATION_ERROR" | "NOT_FOUND"; fields?: string[] }
  | { code: "CONFLICT"; reason: string }
  | { ok: "unchanged" };

type Scenario = {
  name: string;
  operation: Operation;
  interrupt: () => Promise<unknown>;
  /** 割り込みが確定したことを DB で確かめる */
  landed: () => Promise<void>;
  expected: Expected;
};

function matches(result: Result, expected: Expected): boolean {
  if ("ok" in expected) return result.ok;
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

const editTitle = (s: Service) =>
  s.editTodo(actorOf(w.memberS1.id), room.id, todoIdAt(1), {
    version: 1,
    title: "[UNIT_TEST]149B割り込みの改題",
  });
const editAssigneeToC = (s: Service) =>
  s.editTodo(actorOf(w.memberS1.id), room.id, todoIdAt(1), {
    version: 1,
    assigneeUserId: w.ownerD.id,
  });
const deleteOne = (s: Service) =>
  s.deleteTodo(actorOf(w.memberS1.id), room.id, todoIdAt(1));

/** ほかの人（B）の操作。Repository を直接呼ぶ（Service の判定を通さない） */
const othersEdit = () =>
  withCaseTodos(env, (r) =>
    r.editTodo({
      caseId: room.id,
      actorId: w.memberD1.id,
      todoId: todoIdAt(1),
      version: 1,
      eventIds: [eventIdAt(900), eventIdAt(901)],
      title: "[UNIT_TEST]149B相手の改題",
    }),
  );
const othersComplete = () =>
  withCaseTodos(env, (r) =>
    r.completeTodo({
      caseId: room.id,
      actorId: w.memberD1.id,
      todoId: todoIdAt(1),
      eventId: eventIdAt(910),
    }),
  );
const othersCompleteThenUncomplete = async () => {
  await othersComplete();
  await withCaseTodos(env, (r) =>
    r.uncompleteTodo({
      caseId: room.id,
      actorId: w.memberD1.id,
      todoId: todoIdAt(1),
      eventId: eventIdAt(912),
      autoUnassignEventId: eventIdAt(911),
    }),
  );
};
const othersDelete = () =>
  withCaseTodos(env, (r) =>
    r.deleteTodo({
      caseId: room.id,
      actorId: w.memberD1.id,
      todoId: todoIdAt(1),
      eventId: eventIdAt(920),
    }),
  );

async function membersOf(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT user_id FROM channel_members WHERE channel_id = ?",
  )
    .bind(room.roomId)
    .all<{ user_id: string }>();
  return results.map((r) => r.user_id);
}
async function isActive(userId: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT is_active FROM users WHERE id = ?")
    .bind(userId)
    .first<{ is_active: number }>();
  return row?.is_active === 1;
}
async function statusOf(): Promise<string | undefined> {
  const row = await env.DB.prepare("SELECT status FROM cases WHERE id = ?")
    .bind(room.id)
    .first<{ status: string }>();
  return row?.status;
}

// 表には関数だけを書く（resetWorld で代入する変数は、呼ばれた時点で読む）
const SCENARIOS: Scenario[] = [
  {
    name: "計画 10節 #28 編集：ほかの人が T1 を編集する → 409 todo_changed（記録はほかの人の分だけ）",
    operation: editTitle,
    interrupt: othersEdit,
    landed: async () => {
      expect((await todoRow(todoIdAt(1))).version).toBe(2);
    },
    expected: { code: "CONFLICT", reason: CASE_TODO_REASONS.todoChanged },
  },
  {
    name: "計画 10節 #29 編集：ほかの人が T1 を完了 → 取り消し（状態は元に戻り、版は+2）→ 409 todo_changed",
    operation: editTitle,
    interrupt: othersCompleteThenUncomplete,
    landed: async () => {
      expect(await todoRow(todoIdAt(1))).toMatchObject({
        is_done: 0,
        version: 3,
      });
    },
    expected: { code: "CONFLICT", reason: CASE_TODO_REASONS.todoChanged },
  },
  {
    name: "計画 10節 #30 編集：ほかの人が T1 を削除する → 409 todo_deleted",
    operation: editTitle,
    interrupt: othersDelete,
    landed: async () => {
      expect((await todoRow(todoIdAt(1))).deleted_by).toBe(w.memberD1.id);
    },
    expected: { code: "CONFLICT", reason: CASE_TODO_REASONS.todoDeleted },
  },
  {
    name: "計画 10節 #31 編集：新しい担当 C が参加者から外される → 422 assigneeUserId",
    operation: editAssigneeToC,
    interrupt: () => removeCaseMember(room.roomId, w.ownerD.id),
    landed: async () => {
      expect(await membersOf()).not.toContain(w.ownerD.id);
    },
    expected: { code: "VALIDATION_ERROR", fields: ["assigneeUserId"] },
  },
  {
    name: "計画 10節 #31 編集：新しい担当 C が無効になる → 422 assigneeUserId",
    operation: editAssigneeToC,
    interrupt: () => setUserActive(w.ownerD.id, false),
    landed: async () => {
      expect(await isActive(w.ownerD.id)).toBe(false);
    },
    expected: { code: "VALIDATION_ERROR", fields: ["assigneeUserId"] },
  },
  {
    name: "計画 10節 #32 編集：操作者 A が参加者から外される → 403（409・422 より先）",
    operation: editAssigneeToC,
    interrupt: async () => {
      await removeCaseMember(room.roomId, w.memberS1.id);
      await removeCaseMember(room.roomId, w.ownerD.id);
      await setCaseStatus(room.id, "closed");
    },
    landed: async () => {
      expect(await membersOf()).not.toContain(w.memberS1.id);
    },
    expected: { code: "FORBIDDEN" },
  },
  {
    name: "計画 10節 #32 編集：操作者 A が無効になる → 403",
    operation: editTitle,
    interrupt: () => setUserActive(w.memberS1.id, false),
    landed: async () => {
      expect(await isActive(w.memberS1.id)).toBe(false);
    },
    expected: { code: "FORBIDDEN" },
  },
  {
    name: "計画 10節 #33 編集：案件が終了する → 409 closed",
    operation: editTitle,
    interrupt: () => setCaseStatus(room.id, "closed"),
    landed: async () => {
      expect(await statusOf()).toBe("closed");
    },
    expected: { code: "CONFLICT", reason: CASE_TODO_REASONS.closed },
  },
  {
    name: "計画 10節 #34 編集：A が担当を変えようとしている間に、ほかの人が T1 を完了する → 409 todo_completed（todo_changed より先）",
    operation: editAssigneeToC,
    interrupt: othersComplete,
    landed: async () => {
      expect((await todoRow(todoIdAt(1))).is_done).toBe(1);
    },
    expected: { code: "CONFLICT", reason: CASE_TODO_REASONS.todoCompleted },
  },
  {
    name: "計画 7章 削除：ほかの人が先に削除する → 何も書かずに成功（204）。記録 delete は相手の1件だけ",
    operation: deleteOne,
    interrupt: othersDelete,
    landed: async () => {
      expect((await todoRow(todoIdAt(1))).deleted_by).toBe(w.memberD1.id);
    },
    expected: { ok: "unchanged" },
  },
  {
    name: "計画 7章 削除：案件が終了する → 409 closed",
    operation: deleteOne,
    interrupt: () => setCaseStatus(room.id, "closed"),
    landed: async () => {
      expect(await statusOf()).toBe("closed");
    },
    expected: { code: "CONFLICT", reason: CASE_TODO_REASONS.closed },
  },
  {
    name: "計画 7章 削除：操作者 A が参加者から外され、案件も終了する → 403（終了を漏らさない）",
    operation: deleteOne,
    interrupt: async () => {
      await removeCaseMember(room.roomId, w.memberS1.id);
      await setCaseStatus(room.id, "closed");
    },
    landed: async () => {
      expect(await membersOf()).not.toContain(w.memberS1.id);
    },
    expected: { code: "FORBIDDEN" },
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

describe("#149 AC-1 149-B 計画 7章 判定の後・書き込みの前の割り込み", () => {
  it.each(SCENARIOS.map((s) => [s.name, s] as const))(
    "#149 AC-1 %s",
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
        await scenario.landed();
        expect(
          matches(result, scenario.expected),
          `k=${k}: ${describeResult(result)}`,
        ).toBe(true);
        // 割り込みの直後の状態から、何も書いていない（何も書かない成功も、記録を足さない）
        expect(await todoSnapshot(), `k=${k}`).toEqual(recorder.afterInterrupt);
      }
    },
  );

  it("#149 AC-1 計画 7章: 削除の判定の後に、ほかの人が T1 を編集しても（版が進む）、削除は版を見ないので成功し、記録は相手の title_change と自分の delete", async () => {
    await resetWorld();
    const recorder = newRecorder();
    const result = await runWith(deleteOne, 1, othersEdit, recorder);
    expect(recorder.interrupted).toBe(true);
    expect(result.ok, describeResult(result)).toBe(true);
    expect(await todoRow(todoIdAt(1))).toMatchObject({
      title: "[UNIT_TEST]149B相手の改題",
      deleted_by: w.memberS1.id,
      version: 3,
    });
    expect(
      (await todoEventsOf(todoIdAt(1))).map((e) => [e.kind, e.actor_id]),
    ).toEqual([
      ["title_change", w.memberD1.id],
      ["delete", w.memberS1.id],
    ]);
  });

  it("#149 AC-1 計画 7章: 同じ版で2人が同時に編集すると、先が確定し、後は 409 todo_changed。記録は先の分だけ", async () => {
    await resetWorld();
    const recorder = newRecorder();
    const result = await runWith(editTitle, 1, othersEdit, recorder);
    expect(
      matches(result, {
        code: "CONFLICT",
        reason: CASE_TODO_REASONS.todoChanged,
      }),
      describeResult(result),
    ).toBe(true);
    expect(
      (await todoEventsOf(todoIdAt(1))).map((e) => [e.kind, e.actor_id]),
    ).toEqual([["title_change", w.memberD1.id]]);
  });
});
