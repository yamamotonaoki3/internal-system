// #149（149-C）5-4 AC-6・AC-9・AC-13、計画 plan-149c 6節・9.6（I1〜I5）、計画レビュー1回目の軽微2：
// 復元の最初の判定（材料の読み取り）の「後」、復元の batch の「直前」に状態が変わっても、batch の前提で止まり、Service が読み直して正しい応答にすること。
// 挟み方：本物の Repository（隔離 D1）を Proxy で包み、書き込みの関数 restoreTodo が最初に呼ばれたとき、本物を呼ぶ前に割り込む
//   （restoreTodo は渡された ID で1回の db.batch を送るだけなので、狙った batch の直前になる。判定の読み取りには割り込まない）。
//   割り込みが実行され、その変更が DB に確定したことを、割り込みの直後に確かめる。
// 軽微2（逆向き）：149-D の参加者の削除が、対象の件数を読んだ「後」・書き込みの batch の「前」に復元が確定する場合は、env.DB の batch を包み、
//   TODO の表・記録の表に書く文を含む batch の直前だけに割り込む（先例：case-todo-unassign.interleave.test.ts の見分け方）。
// 権限の判定は本物（createCaseTodoService(repository, roles)）。
// 契約（実装前の仮置き）：service.restoreTodo(actor, caseId, todoId)。Repository の書き込みの関数の名前は restoreTodo。
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
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import {
  CASE_TODO_REASONS,
  eventIdAt,
  futureIdAt,
  insertTodo,
  insertTodoEvent,
  todoEventsOf,
  todoIdAt,
  todoRow,
  todoSnapshot,
} from "../../test/case-todo-fixtures";
import {
  withCaseTodos,
  type CaseTodoRepository,
} from "../db/case-todo.repository";
import { withCases, type CaseRepository } from "../db/case.repository";
import { AppError } from "../lib/app-error";
import { createCaseService } from "./case.service";
import { createCaseTodoService } from "./case-todo.service";

const NAME_B = "テスト担当149C割り込み";
const T1_TITLE = "[UNIT_TEST]149C割り込みの元";

let w: CaseWorld;
/** 進行中：A＝memberS1（操作者）・B＝memberD1（T1 の担当）・C＝ownerD。T1＝削除済み・未完了・担当 B・版2 */
let room: SeededCase;

type Snapshot = Awaited<ReturnType<typeof todoSnapshot>>;
type Recorder = {
  writes: number;
  interrupted: boolean;
  afterInterrupt: Snapshot | null;
};

/** restoreTodo の最初の呼び出しで、本物を呼ぶ前に interrupt を実行する */
function interleave(
  repository: CaseTodoRepository,
  interrupt: () => Promise<unknown>,
  recorder: Recorder,
): CaseTodoRepository {
  return new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        if (property === "restoreTodo") {
          recorder.writes += 1;
          if (!recorder.interrupted) {
            recorder.interrupted = true;
            await interrupt();
            recorder.afterInterrupt = await todoSnapshot();
          }
        }
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as CaseTodoRepository;
}

type Result = { ok: true; value: unknown } | { ok: false; error: unknown };

async function restoreWith(
  interrupt: () => Promise<unknown>,
  recorder: Recorder,
  actorId = w.memberS1.id,
): Promise<Result> {
  try {
    const value = await withCaseTodos(env, (repository, roles) =>
      createCaseTodoService(
        interleave(repository, interrupt, recorder),
        roles,
      ).restoreTodo(
        { userId: actorId, traceId: casereqTraceId() },
        room.id,
        todoIdAt(1),
      ),
    );
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  }
}

const newRecorder = (): Recorder => ({
  writes: 0,
  interrupted: false,
  afterInterrupt: null,
});

/** ほかの人（C）の操作。Repository を直接呼ぶ（Service の判定を通さない） */
const othersRestore = () =>
  withCaseTodos(env, (r) =>
    r.restoreTodo({
      caseId: room.id,
      actorId: w.ownerD.id,
      todoId: todoIdAt(1),
      autoUnassignEventId: eventIdAt(900),
      eventId: eventIdAt(901),
    }),
  );
const othersEdit = () =>
  withCaseTodos(env, (r) =>
    r.editTodo({
      caseId: room.id,
      actorId: w.ownerD.id,
      todoId: todoIdAt(1),
      version: 3,
      eventIds: [eventIdAt(910), eventIdAt(911)],
      title: "[UNIT_TEST]149C相手の改題",
    }),
  );
const othersComplete = () =>
  withCaseTodos(env, (r) =>
    r.completeTodo({
      caseId: room.id,
      actorId: w.ownerD.id,
      todoId: todoIdAt(1),
      eventId: eventIdAt(920),
    }),
  );
const othersDelete = () =>
  withCaseTodos(env, (r) =>
    r.deleteTodo({
      caseId: room.id,
      actorId: w.ownerD.id,
      todoId: todoIdAt(1),
      eventId: eventIdAt(930),
    }),
  );
const removeParticipant = (userId: string) =>
  withCases(env, (r) =>
    r.removeParticipant({
      caseId: room.id,
      actorId: w.ownerD.id,
      userId,
      traceId: casereqTraceId(),
    }),
  );

const kinds = async () => (await todoEventsOf(todoIdAt(1))).map((e) => e.kind);

function expectAppError(result: Result, code: string, reason?: string) {
  expect(result.ok, JSON.stringify(result)).toBe(false);
  const error = (result as { error: unknown }).error;
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  if (reason !== undefined)
    expect((error as AppError).details.reason).toBe(reason);
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(CASEREQ_NOW));
  w = await setupCaseWorld();
  room = await seedCase({
    n: 1561,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]149C割り込み",
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
    title: T1_TITLE,
    createdBy: w.memberS1.id,
    assigneeId: w.memberD1.id,
    recordedAssigneeName: NAME_B,
    deletedBy: w.memberS1.id,
    version: 2,
  });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupCaseTestData();
});

describe("#149 149-C 計画 6節・9.6 判定の後・復元の batch の直前の割り込み", () => {
  it("#149 149-C 5-4 AC-13 I1: 判定の後に別の人が復元を確定すると、200（復元済みのいまの項目）で、記録 restore は1件", async () => {
    const recorder = newRecorder();
    const result = await restoreWith(othersRestore, recorder);
    expect(recorder.interrupted).toBe(true);
    expect(recorder.afterInterrupt?.events).toHaveLength(1);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect((result as { value: unknown }).value).toMatchObject({
      id: todoIdAt(1),
      version: 3,
    });
    expect(await kinds()).toEqual(["restore"]);
    expect((await todoEventsOf(todoIdAt(1)))[0]?.actor_id).toBe(w.ownerD.id);
  });

  it("#149 149-C 5-4 AC-9 I2: 判定の後に案件が終了すると、409 closed で、記録・TODO は割り込みの直後から変わらない", async () => {
    const recorder = newRecorder();
    const result = await restoreWith(
      () => setCaseStatus(room.id, "closed"),
      recorder,
    );
    expect(recorder.interrupted).toBe(true);
    expectAppError(result, "CONFLICT", CASE_TODO_REASONS.closed);
    expect(await todoSnapshot()).toEqual(recorder.afterInterrupt);
    expect((await todoRow(todoIdAt(1))).deleted_at).not.toBeNull();
  });

  it("#149 149-C 5-4 AC-6・AC-13 I3: 判定の後に担当者（B）が参加者から削除されると、判定の材料では有効でも、復元は担当なし・auto_unassign 1件になる", async () => {
    const recorder = newRecorder();
    const result = await restoreWith(
      () => removeParticipant(w.memberD1.id),
      recorder,
    );
    expect(recorder.interrupted).toBe(true);
    // 削除済みには 149-D を当てないため、割り込みの直後は担当のまま
    expect(
      recorder.afterInterrupt?.todos.find((t) => t.id === todoIdAt(1)),
    ).toMatchObject({ assignee_id: w.memberD1.id });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect((result as { value: unknown }).value).toMatchObject({
      assignee: null,
      previousAssignee: { userId: w.memberD1.id, displayName: NAME_B },
    });
    expect((await todoRow(todoIdAt(1))).assignee_id).toBeNull();
    expect(await kinds()).toEqual(["auto_unassign", "restore"]);
  });

  it("#149 149-C I4: 判定の後に操作者（A）が参加者から外されると、403 で、何も残らない", async () => {
    const recorder = newRecorder();
    const result = await restoreWith(
      () => removeCaseMember(room.roomId, w.memberS1.id),
      recorder,
    );
    expect(recorder.interrupted).toBe(true);
    expectAppError(result, "FORBIDDEN");
    expect(await todoSnapshot()).toEqual(recorder.afterInterrupt);
  });

  it("#149 149-C 計画 6節 I5: 判定の後に別の TODO の記録が確定し、全体の最大が渡した ID 以上になると、ID を作り直して成功する。記録の ID は昇順で、作り直した ID はその記録より大きい", async () => {
    await insertTodo({
      id: todoIdAt(2),
      caseId: room.id,
      title: "[UNIT_TEST]149C別のTODO",
      createdBy: w.memberS1.id,
    });
    const recorder = newRecorder();
    const later = futureIdAt(1);
    const result = await restoreWith(
      () =>
        insertTodoEvent({
          id: later,
          todoId: todoIdAt(2),
          caseId: room.id,
          kind: "create",
          actorId: w.memberS1.id,
        }),
      recorder,
    );
    expect(recorder.interrupted).toBe(true);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(recorder.writes).toBe(2);
    const events = await todoEventsOf(todoIdAt(1));
    expect(events.map((e) => e.kind)).toEqual(["restore"]);
    expect(events[0]!.id > later).toBe(true);
    const all = (
      await env.DB.prepare(
        "SELECT id FROM case_todo_events ORDER BY rowid",
      ).all<{
        id: string;
      }>()
    ).results.map((r) => r.id);
    expect(all).toEqual([...all].sort());
  });
});

describe("#149 149-C 軽微2 ほかの人の復元の後に、さらに操作された場合", () => {
  it.each([
    [
      "題名を編集した",
      async () => {
        await othersRestore();
        await othersEdit();
      },
      { title: "[UNIT_TEST]149C相手の改題", completed: false, version: 4 },
    ],
    [
      "完了にした",
      async () => {
        await othersRestore();
        await othersComplete();
      },
      { title: T1_TITLE, completed: true, version: 4 },
    ],
  ] as const)(
    "#149 149-C 6節: 判定の後に別の人が復元して%s場合、遅れた復元は何も書かずに、いまの値で 200（記録 restore は1件）",
    async (_l, interrupt, current) => {
      const recorder = newRecorder();
      const result = await restoreWith(interrupt, recorder);
      expect(recorder.interrupted).toBe(true);
      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect((result as { value: unknown }).value).toMatchObject({
        id: todoIdAt(1),
        ...current,
      });
      expect(await todoSnapshot()).toEqual(recorder.afterInterrupt);
      expect((await kinds()).filter((k) => k === "restore")).toHaveLength(1);
    },
  );

  it("#149 149-C 6節 決定 Q2: 判定の後に別の人が復元して、さらに削除した場合、遅れた復元は前提どおり削除済みなので、もう一度復元される（記録 restore は2件）", async () => {
    const recorder = newRecorder();
    const result = await restoreWith(async () => {
      await othersRestore();
      await othersDelete();
    }, recorder);
    expect(recorder.interrupted).toBe(true);
    expect(
      recorder.afterInterrupt?.todos.find((t) => t.id === todoIdAt(1)),
    ).toMatchObject({ deleted_by: w.ownerD.id });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const row = await todoRow(todoIdAt(1));
    expect(row.deleted_at).toBeNull();
    expect(await kinds()).toEqual(["restore", "delete", "restore"]);
  });
});

// ---- 軽微2（逆向き）：149-D の参加者の削除が件数を読んだ後に、復元が確定する ----

/** TODO の表・記録の表に書く文（149-D の書き込みの batch を見分けるため） */
const WRITES_TODOS =
  /^\s*(update\s+"?case_todos"?|insert\s+into\s+"?case_todo_events"?)/i;

/** TODO の表・記録の表に書く文を含む batch の直前に、1回だけ interrupt を実行する D1 */
function envInterruptingWriteBatch(
  interrupt: () => Promise<unknown>,
  state: { done: boolean },
): Env {
  const writing = new WeakSet<object>();
  const tag = (statement: D1PreparedStatement, query: string) => {
    if (WRITES_TODOS.test(query)) writing.add(statement);
    return new Proxy(statement, {
      get(stmt, key) {
        if (key === "bind")
          return (...values: unknown[]) => {
            const bound = stmt.bind(...values);
            if (WRITES_TODOS.test(query)) writing.add(bound);
            return bound;
          };
        const value: unknown = Reflect.get(stmt, key, stmt);
        return typeof value === "function" ? value.bind(stmt) : value;
      },
    });
  };
  const proxy = new Proxy(env.DB, {
    get(target, property) {
      if (property === "prepare")
        return (query: string) => tag(target.prepare(query), query);
      if (property === "batch")
        return async (statements: D1PreparedStatement[]) => {
          if (!state.done && statements.some((s) => writing.has(s))) {
            state.done = true;
            await interrupt();
          }
          return target.batch(statements);
        };
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { ...env, DB: proxy } as Env;
}

describe("#149 149-C 軽微2 149-D の側が件数を読んだ後に、復元が確定する", () => {
  it("#149 149-C 5-4 AC-6・AC-13 6節: B を参加者から削除する処理が対象を読んだ後（削除済みの T1 は対象外）・batch の前に、T1 の復元（B はまだ参加者なので担当のまま）が確定すると、やり直しの後、T1 は担当なし・auto_unassign は1件", async () => {
    const state = { done: false };
    const counter = { calls: 0 };
    await withCases(
      envInterruptingWriteBatch(
        () =>
          withCaseTodos(env, (r) =>
            r.restoreTodo({
              caseId: room.id,
              actorId: w.memberS1.id,
              todoId: todoIdAt(1),
              autoUnassignEventId: eventIdAt(940),
              eventId: eventIdAt(941),
            }),
          ),
        state,
      ),
      (repository, roles) =>
        createCaseService(
          new Proxy(repository, {
            get(target, property, receiver) {
              const value = Reflect.get(target, property, receiver) as unknown;
              if (
                property !== "removeParticipant" ||
                typeof value !== "function"
              )
                return value;
              return async (...args: unknown[]) => {
                counter.calls += 1;
                return (value as (...a: unknown[]) => unknown).apply(
                  target,
                  args,
                );
              };
            },
          }) as CaseRepository,
          roles,
        ).removeParticipant(
          { userId: w.memberS1.id, traceId: casereqTraceId() },
          room.id,
          w.memberD1.id,
        ),
    );
    expect(state.done).toBe(true);
    expect(counter.calls).toBeGreaterThanOrEqual(2);
    const row = await todoRow(todoIdAt(1));
    expect(row.deleted_at).toBeNull();
    expect(row.assignee_id).toBeNull();
    const events = await todoEventsOf(todoIdAt(1));
    expect(events.map((e) => e.kind)).toEqual(["restore", "auto_unassign"]);
    expect(events[1]).toMatchObject({
      assignee_id: w.memberD1.id,
      actor_id: w.memberS1.id,
    });
  });
});
