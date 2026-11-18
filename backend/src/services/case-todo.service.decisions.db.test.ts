// #149（149-A）ミューテーションの生き残り（資格・状態・存在の非開示）を倒すための、Service の判定の細部のテスト。
// 期待は計画 149-A 6.3（判定の順・logger.audit）・6.10（ID の作り直し・503）と、受け入れ条件から決める。
// 確かめること：
//   拒否（404・403）の応答と logger.audit の行（操作名・対象・理由・利用者。題名などの中身が入っていないこと）を完全一致で。409・422 は監査に残さない。
//   拒否・409 のときは、書き込み（Repository の addTodo・completeTodo・uncompleteTodo）・一覧の読み取りを呼ばない。
//   一覧の読み取り自体が not_found・not_visible を返したとき（判定の後に変わった）の 404・403。
//   権限の判定（authorize）が拒んだら 403 で、書き込まない。
//   CaseStateChangedError 以外の例外はそのまま伝える（やり直さない）。確定済みの最大がないときの作り直し。上限を超えたときの記録と 503 の文言。
// 時刻は CASEREQ_NOW に固定する。データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MISSING_CASE_ID,
  cleanupCaseTestData,
  joinedAt,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import { setCaseStatus } from "../../test/case-participant-fixtures";
import {
  CASEREQ_NOW,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import {
  CASE_TODO_MESSAGES,
  MISSING_TODO_ID,
  futureIdAt,
  insertTodo,
  todoIdAt,
  todoRowsOf,
} from "../../test/case-todo-fixtures";
import {
  withCaseTodos,
  type CaseTodoRepository,
} from "../db/case-todo.repository";
import { CaseStateChangedError } from "../db/case.repository";
import type { RoleAssignmentRepository } from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import { createCaseTodoService } from "./case-todo.service";

const TRACE = "unit-149a-decisions";
const SECRET_TITLE = "[UNIT_TEST]149A監査に出さない題名";

let w: CaseWorld;
let room: SeededCase;
let logs: string[];
let warns: string[];

type Calls = { writes: number; lists: number };
type Wrap = (r: CaseTodoRepository, calls: Calls) => CaseTodoRepository;

/** 書き込みと一覧の読み取りの回数を数える（差し替えも受け付ける） */
const counting: Wrap = (r, calls) => ({
  ...r,
  addTodo: (input) => {
    calls.writes += 1;
    return r.addTodo(input);
  },
  completeTodo: (input) => {
    calls.writes += 1;
    return r.completeTodo(input);
  },
  uncompleteTodo: (input) => {
    calls.writes += 1;
    return r.uncompleteTodo(input);
  },
  listTodos: (input) => {
    calls.lists += 1;
    return r.listTodos(input);
  },
});

async function run<T>(
  operation: (s: ReturnType<typeof createCaseTodoService>) => Promise<T>,
  options: {
    wrap?: Wrap;
    roles?: (r: RoleAssignmentRepository) => RoleAssignmentRepository;
  } = {},
): Promise<{ result: T | undefined; error: unknown; calls: Calls }> {
  const calls: Calls = { writes: 0, lists: 0 };
  try {
    const result = await withCaseTodos(env, (repository, roles) =>
      operation(
        createCaseTodoService(
          counting(
            options.wrap ? options.wrap(repository, calls) : repository,
            calls,
          ),
          options.roles ? options.roles(roles) : roles,
        ),
      ),
    );
    return { result, error: undefined, calls };
  } catch (error) {
    return { result: undefined, error, calls };
  }
}

const actor = (userId: string) => ({ userId, traceId: TRACE });

type LogRecord = {
  body: string;
  trace_id?: string;
  user_id?: string;
  attributes: Record<string, unknown>;
};
const parse = (lines: string[]) =>
  lines
    .map((line) => {
      try {
        return JSON.parse(line) as LogRecord;
      } catch {
        return null;
      }
    })
    .filter((r): r is LogRecord => r !== null);
const audits = () =>
  parse(logs).filter((r) => r.attributes.log_type === "audit");

function expectAppError(error: unknown, code: string, message?: string) {
  expect(error, String(error)).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  if (message !== undefined) expect((error as AppError).message).toBe(message);
}

/** 拒否の監査の行が、ちょうど1件で、決めた形であること */
function expectDenyAudit(
  action: string,
  target: string,
  reason: string,
  userId: string,
) {
  expect(
    audits().map((r) => ({
      body: r.body,
      user_id: r.user_id,
      trace_id: r.trace_id,
      attributes: r.attributes,
    })),
  ).toEqual([
    {
      body: action,
      user_id: userId,
      trace_id: TRACE,
      attributes: { reason, log_type: "audit", target, result: "failure" },
    },
  ]);
  expect(logs.join("\n")).not.toContain(SECRET_TITLE);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(CASEREQ_NOW));
  w = await setupCaseWorld();
  room = await seedCase({
    n: 1499,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]149A判定",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
    ],
  });
  logs = [];
  warns = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  });
  vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => {
    warns.push(a.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupCaseTestData();
});

const seedTodo = (
  n: number,
  extra: Partial<Parameters<typeof insertTodo>[0]> = {},
) =>
  insertTodo({
    id: todoIdAt(n),
    caseId: room.id,
    title: SECRET_TITLE,
    createdBy: w.memberS1.id,
    ...extra,
  });

describe("#149 AC-1 計画 6.3 拒否の応答と logger.audit（完全一致）", () => {
  it("#149 AC-1: 一覧：案件がなければ 404・監査 case.todo.view／not_found。一覧を読まない", async () => {
    const { error, calls } = await run((s) =>
      s.listTodos(actor(w.memberS1.id), MISSING_CASE_ID, {
        limit: 100,
        cursor: null,
      }),
    );
    expectAppError(error, "NOT_FOUND", CASE_TODO_MESSAGES.caseNotFound);
    expect(calls.lists).toBe(0);
    expectDenyAudit(
      "case.todo.view",
      MISSING_CASE_ID,
      "not_found",
      w.memberS1.id,
    );
  });

  it("#149 AC-1 R-76: 一覧：非参加者は 403・監査 case.todo.view／not_participant。一覧を読まない", async () => {
    const { error, calls } = await run((s) =>
      s.listTodos(actor(w.memberS2.id), room.id, { limit: 100, cursor: null }),
    );
    expectAppError(error, "FORBIDDEN", CASE_TODO_MESSAGES.participantsOnlyView);
    expect(calls.lists).toBe(0);
    expectDenyAudit(
      "case.todo.view",
      room.id,
      "not_participant",
      w.memberS2.id,
    );
  });

  it.each([
    ["not_found", "NOT_FOUND", CASE_TODO_MESSAGES.caseNotFound, "not_found"],
    [
      "not_visible",
      "FORBIDDEN",
      CASE_TODO_MESSAGES.participantsOnlyView,
      "not_participant",
    ],
  ] as const)(
    "#149 AC-1: 一覧：判定の後に、読み取りが %s を返したら %s・監査の理由は決めた値",
    async (returned, code, message, reason) => {
      const { error } = await run(
        (s) =>
          s.listTodos(actor(w.memberS1.id), room.id, {
            limit: 100,
            cursor: null,
          }),
        { wrap: (r) => ({ ...r, listTodos: () => Promise.resolve(returned) }) },
      );
      expectAppError(error, code, message);
      expectDenyAudit("case.todo.view", room.id, reason, w.memberS1.id);
    },
  );

  it("#149 AC-1 R-76: 追加：非参加者は 403・監査 case.todo.add／not_participant（題名は監査に出さない）。書き込まない", async () => {
    const { error, calls } = await run((s) =>
      s.addTodo(actor(w.memberS2.id), room.id, { title: SECRET_TITLE }),
    );
    expectAppError(error, "FORBIDDEN", CASE_TODO_MESSAGES.participantsOnlyEdit);
    expect(calls.writes).toBe(0);
    expectDenyAudit("case.todo.add", room.id, "not_participant", w.memberS2.id);
  });

  it("#149 AC-1: 追加：案件がなければ 404・監査 case.todo.add／not_found", async () => {
    const { error } = await run((s) =>
      s.addTodo(actor(w.memberS1.id), MISSING_CASE_ID, { title: SECRET_TITLE }),
    );
    expectAppError(error, "NOT_FOUND", CASE_TODO_MESSAGES.caseNotFound);
    expectDenyAudit(
      "case.todo.add",
      MISSING_CASE_ID,
      "not_found",
      w.memberS1.id,
    );
  });

  it("#149 AC-1 5-4 AC-9: 追加：終了中は 409 で、書き込まず、監査に残さない（拒否ではない）", async () => {
    await setCaseStatus(room.id, "closed");
    const { error, calls } = await run((s) =>
      s.addTodo(actor(w.memberS1.id), room.id, { title: SECRET_TITLE }),
    );
    expectAppError(error, "CONFLICT", CASE_TODO_MESSAGES.closed);
    expect(calls.writes).toBe(0);
    expect(audits()).toEqual([]);
  });

  it("#149 AC-1 5-4 AC-6: 追加：担当者の誤りは 422 で、書き込まず、監査に残さない", async () => {
    const { error, calls } = await run((s) =>
      s.addTodo(actor(w.memberS1.id), room.id, {
        title: SECRET_TITLE,
        assigneeUserId: w.memberS2.id,
      }),
    );
    expectAppError(
      error,
      "VALIDATION_ERROR",
      CASE_TODO_MESSAGES.assigneeInvalid,
    );
    expect(calls.writes).toBe(0);
    expect(audits()).toEqual([]);
  });

  it("#149 AC-1: 追加：本文の形の誤りは 422「入力内容を確かめてください」", async () => {
    const { error } = await run((s) =>
      s.addTodo(actor(w.memberS1.id), room.id, { title: "" }),
    );
    expectAppError(error, "VALIDATION_ERROR", "入力内容を確かめてください");
  });

  it.each([
    ["completeTodo", "case.todo.complete"],
    ["uncompleteTodo", "case.todo.uncomplete"],
  ] as const)(
    "#149 AC-1 security: %s：ない TODO は 404・監査 %s／todo_not_found。書き込まない",
    async (method, action) => {
      const { error, calls } = await run((s) =>
        s[method](actor(w.memberS1.id), room.id, MISSING_TODO_ID),
      );
      expectAppError(error, "NOT_FOUND", CASE_TODO_MESSAGES.todoNotFound);
      expect(calls.writes).toBe(0);
      expectDenyAudit(action, room.id, "todo_not_found", w.memberS1.id);
    },
  );

  it.each([
    ["completeTodo", "case.todo.complete"],
    ["uncompleteTodo", "case.todo.uncomplete"],
  ] as const)(
    "#149 AC-1 R-76: %s：非参加者は 403・監査 %s／not_participant",
    async (method, action) => {
      await seedTodo(1);
      const { error, calls } = await run((s) =>
        s[method](actor(w.memberS2.id), room.id, todoIdAt(1)),
      );
      expectAppError(
        error,
        "FORBIDDEN",
        CASE_TODO_MESSAGES.participantsOnlyEdit,
      );
      expect(calls.writes).toBe(0);
      expectDenyAudit(action, room.id, "not_participant", w.memberS2.id);
    },
  );

  it.each([
    ["completeTodo", false, "todoDeleted"],
    ["uncompleteTodo", true, "todoDeleted"],
    ["completeTodo", false, "closed"],
    ["uncompleteTodo", true, "closed"],
  ] as const)(
    "#149 AC-1: %s（完了済み=%s）：409 %s は書き込まず、監査に残さない",
    async (method, done, kind) => {
      await seedTodo(1, {
        isDone: done,
        deletedBy: kind === "todoDeleted" ? w.memberS1.id : null,
      });
      if (kind === "closed") await setCaseStatus(room.id, "closed");
      const { error, calls } = await run((s) =>
        s[method](actor(w.memberS1.id), room.id, todoIdAt(1)),
      );
      expectAppError(
        error,
        "CONFLICT",
        kind === "closed"
          ? CASE_TODO_MESSAGES.closed
          : CASE_TODO_MESSAGES.todoDeleted,
      );
      expect(calls.writes).toBe(0);
      expect(audits()).toEqual([]);
    },
  );
});

describe("#149 AC-1 権限の判定（authorize）", () => {
  const noRoles = (r: RoleAssignmentRepository): RoleAssignmentRepository => ({
    ...r,
    findByUserId: () => Promise.resolve(null),
  });

  it.each([
    [
      "追加",
      (s: ReturnType<typeof createCaseTodoService>) =>
        s.addTodo(actor(w.memberS1.id), room.id, { title: SECRET_TITLE }),
    ],
    [
      "完了",
      (s: ReturnType<typeof createCaseTodoService>) =>
        s.completeTodo(actor(w.memberS1.id), room.id, todoIdAt(1)),
    ],
    [
      "一覧",
      (s: ReturnType<typeof createCaseTodoService>) =>
        s.listTodos(actor(w.memberS1.id), room.id, {
          limit: 100,
          cursor: null,
        }),
    ],
  ] as const)(
    "#149 AC-1: %s：権限の判定が拒めば 403 で、書き込み・一覧の読み取りをしない",
    async (_label, operation) => {
      await seedTodo(1);
      const { error, calls } = await run(
        (s) => operation(s) as Promise<unknown>,
        { roles: noRoles },
      );
      expectAppError(error, "FORBIDDEN");
      expect(calls.writes).toBe(0);
      expect(calls.lists).toBe(0);
      expect(await todoRowsOf(room.id)).toHaveLength(1);
    },
  );
});

describe("#149 AC-1 計画 6.10 書き込みのやり直し", () => {
  it("#149 AC-1: CaseStateChangedError 以外の例外は、やり直さずにそのまま伝える", async () => {
    await seedTodo(1);
    const boom = new Error("unit-149a-boom");
    const { error, calls } = await run(
      (s) => s.completeTodo(actor(w.memberS1.id), room.id, todoIdAt(1)),
      {
        wrap: (r) => ({ ...r, completeTodo: () => Promise.reject(boom) }),
      },
    );
    expect(error).toBe(boom);
    expect(calls.writes).toBe(1);
  });

  it("#149 AC-1 計画 6.9(3): 確定済みの TODO がない案件で batch が取り消されても、新しい ID で作り直して追加できる", async () => {
    const ids: string[] = [];
    const { result, error } = await run(
      (s) => s.addTodo(actor(w.memberS1.id), room.id, { title: SECRET_TITLE }),
      {
        wrap: (r) => ({
          ...r,
          addTodo: (input) => {
            ids.push(input.todoId);
            if (ids.length === 1)
              return Promise.reject(new CaseStateChangedError());
            return r.addTodo(input);
          },
        }),
      },
    );
    expect(error).toBeUndefined();
    expect(ids).toHaveLength(2);
    expect((result as { id: string }).id).toBe(ids[1]);
    expect((await todoRowsOf(room.id)).map((t) => t.id)).toEqual([ids[1]]);
  });

  it("#149 AC-1 計画 6.10: 上限を超えたら 503「混み合っています…」で、WARN の記録（文言と案件の ID）を1件残す", async () => {
    let n = 0;
    const { error } = await run(
      (s) => s.addTodo(actor(w.memberS1.id), room.id, { title: SECRET_TITLE }),
      {
        wrap: (r) => ({
          ...r,
          addTodo: async (input) => {
            n += 1;
            await seedTodo(900 + n, { id: futureIdAt(n) });
            return r.addTodo(input);
          },
        }),
      },
    );
    expectAppError(
      error,
      "SERVICE_UNAVAILABLE",
      "混み合っています。しばらくしてからもう一度お試しください",
    );
    const records = parse(warns);
    expect(
      records.map((r) => ({
        body: r.body,
        user_id: r.user_id,
        attributes: r.attributes,
      })),
    ).toEqual([
      {
        body: "TODO・記録の ID の作り直しが上限を超えた",
        user_id: w.memberS1.id,
        attributes: { caseId: room.id },
      },
    ]);
  });
});
