// #149（149-C）5-4 AC-9・AC-10・AC-12・AC-13、計画 plan-149c 5.2・5.4・6節・9.4（S1〜S6）：
// 復元・履歴・削除済みの一覧の Service（case-todo.service.ts）の、最初の判定・読み直し・ID の作り直し・503 を、Repository を差し替えて確かめる。
// この層で確かめるもの：最初の判定で拒否したとき「書き込み・読み取りの関数を呼ばない」こと／未削除なら何も書かずに 200／
//   取り消し（CaseStateChangedError）の後の読み直しで、復元済み→200・理由→そのエラー（やり直さない）／理由に当たらない取り消しが続くと
//   合計4回（最初の1回＋MAX_ID_RETRIES＝3）で 503・logger.warn 1回、ID は毎回「記録の表の全体の最大」より大きく autoUnassignEventId < eventId／
//   読み取りの not_visible→403・not_found→404（認可の後の資格の喪失）。
// Repository は差し替える（材料は TodoWriteFacts を直接作る）。権限の判定は、許すときは本物（隔離 D1 の世界の memberS1。全員の役割で
//   perm.case.view・perm.case.todo.edit を持つ）、許さないときは「利用者が見つからない」役割の Repository（何も持たない）にする。
// 契約（実装前の仮置き。テストが決めたもの。実装の担当へ）：backend/src/services/case-todo.service.ts の createCaseTodoService(repository, roles) に
//   service.restoreTodo(actor, caseId, todoId): Promise<TodoItem & { progress: TodoProgress }>（EP-5-26。版は送らない）
//   service.listTodoEvents(actor, caseId, todoId, { limit, cursor }): Promise<{ items; nextCursor }>（EP-5-24）
//   service.listDeletedTodos(actor, caseId, { limit, cursor }): Promise<{ items; nextCursor }>（EP-5-25）
//   門は findTodoWriteFacts（履歴・復元は todoId を渡す）。拒否の logger.audit の操作名は case.todo.restore・case.todo.history・case.todo.deleted_list。
//   Repository の関数の名前は restoreTodo・listTodoEvents・listDeletedTodos・maxEventIdOverall（db/case-todo.repository.history.db.test.ts と同じ）。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupCaseTestData, MISSING_CASE_ID } from "../../test/case-fixtures";
import {
  casereqTraceId,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { futureIdAt, todoIdAt } from "../../test/case-todo-fixtures";
import {
  withCaseTodos,
  type CaseTodoRepository,
  type TodoItem,
  type TodoWriteFacts,
} from "../db/case-todo.repository";
import { CaseStateChangedError } from "../db/case.repository";
import type { RoleAssignmentRepository } from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import { BUSY_MESSAGE, createCaseTodoService } from "./case-todo.service";

const CASE_ID = MISSING_CASE_ID;
const TODO_ID = todoIdAt(1);
/** 記録の表の全体の最大の ID（作り直しの基準） */
const MAX_EVENT_ID = futureIdAt(1);

const ITEM: TodoItem = {
  id: TODO_ID,
  title: "[UNIT_TEST]149C見積書の作成",
  completed: false,
  version: 3,
  assignee: null,
  previousAssignee: null,
  completedAssignee: null,
};
const PROGRESS = { done: 1, total: 4 };

type Todo = NonNullable<TodoWriteFacts["todo"]>;

function factsOf(
  todo: Partial<Todo> | null,
  overrides: Partial<Omit<TodoWriteFacts, "todo">> = {},
): TodoWriteFacts {
  return {
    status: "active",
    actorIsParticipant: true,
    todo:
      todo === null
        ? null
        : {
            deleted: true,
            completed: false,
            version: 3,
            title: ITEM.title,
            assigneeId: null,
            item: ITEM,
            ...todo,
          },
    assigneeIsParticipant: null,
    progress: PROGRESS,
    ...overrides,
  };
}

type RestoreArgs = {
  caseId: string;
  actorId: string;
  todoId: string;
  autoUnassignEventId: string;
  eventId: string;
};

/** 差し替えの Repository。facts は呼ばれた順に返す（最後のものを繰り返す） */
function fakeRepository(options: {
  facts: (TodoWriteFacts | null)[];
  restore?: (args: RestoreArgs) => Promise<unknown>;
  events?: () => Promise<unknown>;
  deleted?: () => Promise<unknown>;
}) {
  let read = 0;
  const calls = {
    findTodoWriteFacts: [] as unknown[],
    restoreTodo: [] as RestoreArgs[],
    listTodoEvents: [] as unknown[],
    listDeletedTodos: [] as unknown[],
    maxEventIdOverall: 0,
  };
  const repository = {
    findTodoWriteFacts: async (input: unknown) => {
      calls.findTodoWriteFacts.push(input);
      const facts =
        options.facts[Math.min(read, options.facts.length - 1)] ?? null;
      read += 1;
      return facts;
    },
    restoreTodo: async (args: RestoreArgs) => {
      calls.restoreTodo.push(args);
      if (options.restore === undefined)
        return { item: ITEM, progress: PROGRESS };
      return options.restore(args);
    },
    listTodoEvents: async (input: unknown) => {
      calls.listTodoEvents.push(input);
      if (options.events === undefined) return { items: [], nextCursor: null };
      return options.events();
    },
    listDeletedTodos: async (input: unknown) => {
      calls.listDeletedTodos.push(input);
      if (options.deleted === undefined) return { items: [], nextCursor: null };
      return options.deleted();
    },
    maxEventIdOverall: async () => {
      calls.maxEventIdOverall += 1;
      return MAX_EVENT_ID;
    },
    maxTodoId: async () => null,
  };
  return { repository: repository as unknown as CaseTodoRepository, calls };
}

/** 何の権限も持たない役割（利用者が見つからない） */
const NO_ROLES = {
  findByUserId: async () => null,
} as unknown as RoleAssignmentRepository;

let w: CaseWorld;
let logLines: string[];

const actor = () => ({ userId: w.memberS1.id, traceId: casereqTraceId() });

type Service = ReturnType<typeof createCaseTodoService>;

/** 本物の役割（D1）か、何も持たない役割で Service を作って op を走らせる。成功・失敗を値で返す */
async function runService(
  repository: CaseTodoRepository,
  op: (service: Service) => Promise<unknown>,
  roles: "real" | "none" = "real",
): Promise<{ ok: true; value: unknown } | { ok: false; error: unknown }> {
  try {
    const value = await withCaseTodos(env, (_r, realRoles) =>
      op(
        createCaseTodoService(
          repository,
          roles === "real" ? realRoles : NO_ROLES,
        ),
      ),
    );
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  }
}

const auditsOf = (action: string, reason: string) =>
  logLines.filter(
    (line) =>
      line.includes(action) &&
      line.includes("failure") &&
      line.includes(reason),
  );

const warnsOf = () =>
  logLines
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as { severity_text?: string })
    .filter((record) => record.severity_text === "WARN");

function expectError(
  result: { ok: boolean; error?: unknown },
  expected: { code: string; status: number; reason?: string },
) {
  expect(result.ok).toBe(false);
  const error = (result as { error: unknown }).error;
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({ code: expected.code, status: expected.status });
  if (expected.reason !== undefined)
    expect((error as AppError).details.reason).toBe(expected.reason);
}

beforeEach(async () => {
  logLines = [];
  const capture = (...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  w = await setupCaseWorld();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseTestData();
});

const restoreOf = (s: Service) => s.restoreTodo(actor(), CASE_ID, TODO_ID);

describe("#149 149-C 計画 9.4 S1・S2 復元の最初の判定", () => {
  it.each([
    [
      "案件がない（404）",
      [null],
      "real",
      { code: "NOT_FOUND", status: 404 },
      "not_found",
    ],
    [
      "有効な参加者でない（403。TODO がなくても）",
      [factsOf(null, { actorIsParticipant: false })],
      "real",
      { code: "FORBIDDEN", status: 403 },
      "not_participant",
    ],
    [
      "TODO がない・ほかの案件の TODO（404）",
      [factsOf(null)],
      "real",
      { code: "NOT_FOUND", status: 404 },
      "todo_not_found",
    ],
  ] as const)(
    "#149 149-C 5-4 AC-13 S1: %s なら restoreTodo を呼ばず、logger.audit（case.todo.restore・failure・理由）が1回",
    async (_l, facts, roles, expected, reason) => {
      const { repository, calls } = fakeRepository({ facts: [...facts] });
      const result = await runService(repository, restoreOf, roles);
      expectError(result, expected);
      expect(calls.restoreTodo).toEqual([]);
      expect(auditsOf("case.todo.restore", reason)).toHaveLength(1);
    },
  );

  it("#149 149-C 5-4 AC-13 S1: perm.case.todo.edit を持たなければ 403 で、restoreTodo を呼ばない", async () => {
    const { repository, calls } = fakeRepository({ facts: [factsOf({})] });
    const result = await runService(repository, restoreOf, "none");
    expectError(result, { code: "FORBIDDEN", status: 403 });
    expect(calls.restoreTodo).toEqual([]);
  });

  it("#149 149-C 5-4 AC-9 S1: 終了中なら 409 closed で、restoreTodo を呼ばない（logger.audit の拒否にはしない）", async () => {
    const { repository, calls } = fakeRepository({
      facts: [factsOf({}, { status: "closed" })],
    });
    const result = await runService(repository, restoreOf);
    expectError(result, { code: "CONFLICT", status: 409, reason: "closed" });
    expect(calls.restoreTodo).toEqual([]);
  });

  it("#149 149-C 決定 Q2 S2: 削除されていない（すでに復元済み）なら、restoreTodo を呼ばずに、いまの項目と進捗を返す", async () => {
    const { repository, calls } = fakeRepository({
      facts: [factsOf({ deleted: false })],
    });
    const result = await runService(repository, restoreOf);
    expect(result).toEqual({
      ok: true,
      value: { ...ITEM, progress: PROGRESS },
    });
    expect(calls.restoreTodo).toEqual([]);
  });

  it("#149 149-C 5-4 AC-13 S2: 削除済み・進行中なら restoreTodo を1回呼び、その項目と進捗を返す。ID は autoUnassignEventId < eventId", async () => {
    const { repository, calls } = fakeRepository({ facts: [factsOf({})] });
    const result = await runService(repository, restoreOf);
    expect(result).toEqual({
      ok: true,
      value: { ...ITEM, progress: PROGRESS },
    });
    expect(calls.restoreTodo).toHaveLength(1);
    const [args] = calls.restoreTodo;
    expect(args).toMatchObject({
      caseId: CASE_ID,
      actorId: w.memberS1.id,
      todoId: TODO_ID,
    });
    expect(args!.autoUnassignEventId < args!.eventId).toBe(true);
  });
});

describe("#149 149-C 計画 9.4 S3〜S5 復元の読み直しとやり直し", () => {
  const changed = async () => {
    throw new CaseStateChangedError();
  };

  it("#149 149-C 計画 6節 S3: restoreTodo が取り消され、読み直しで復元済みなら、200（読み直したいまの項目と進捗）。2回目の restoreTodo は呼ばない", async () => {
    const restored = {
      ...ITEM,
      version: 4,
      title: "[UNIT_TEST]149C相手が復元",
    };
    const { repository, calls } = fakeRepository({
      facts: [
        factsOf({}),
        factsOf(
          { deleted: false, item: restored },
          { progress: { done: 2, total: 5 } },
        ),
      ],
      restore: changed,
    });
    const result = await runService(repository, restoreOf);
    expect(result).toEqual({
      ok: true,
      value: { ...restored, progress: { done: 2, total: 5 } },
    });
    expect(calls.restoreTodo).toHaveLength(1);
  });

  it.each([
    [
      "終了した（409 closed）",
      factsOf({}, { status: "closed" }),
      { code: "CONFLICT", status: 409, reason: "closed" },
    ],
    [
      "操作者が参加者でなくなった（403）",
      factsOf(null, { actorIsParticipant: false }),
      { code: "FORBIDDEN", status: 403 },
    ],
    ["案件が見えない（404）", null, { code: "NOT_FOUND", status: 404 }],
  ] as const)(
    "#149 149-C 計画 6節 S4: 取り消しの後の読み直しで %s なら、そのエラーを返し、やり直さない（restoreTodo は1回）",
    async (_l, reread, expected) => {
      const { repository, calls } = fakeRepository({
        facts: [factsOf({}), reread],
        restore: changed,
      });
      const result = await runService(repository, restoreOf);
      expectError(result, expected);
      expect(calls.restoreTodo).toHaveLength(1);
    },
  );

  it("#149 149-C 計画 6節 S5: 理由に当たらない取り消しが続くと、restoreTodo を合計4回呼び、503（BUSY_MESSAGE）と logger.warn が1回。作り直した ID は毎回、記録の表の全体の最大より大きく、autoUnassignEventId < eventId", async () => {
    const { repository, calls } = fakeRepository({
      facts: [factsOf({})],
      restore: changed,
    });
    const result = await runService(repository, restoreOf);
    expectError(result, { code: "SERVICE_UNAVAILABLE", status: 503 });
    expect((result as { error: AppError }).error.message).toBe(BUSY_MESSAGE);
    expect(calls.restoreTodo).toHaveLength(4);
    expect(warnsOf()).toHaveLength(1);
    for (const [i, args] of calls.restoreTodo.entries()) {
      expect(args.autoUnassignEventId < args.eventId, `${i + 1}回目`).toBe(
        true,
      );
      if (i > 0)
        expect(args.autoUnassignEventId > MAX_EVENT_ID, `${i + 1}回目`).toBe(
          true,
        );
    }
    expect(calls.maxEventIdOverall).toBeGreaterThanOrEqual(3);
  });

  it("#149 149-C 計画 6節 S5: 3回目まで取り消され、4回目で成功すれば、その結果を返す（503 にしない）", async () => {
    let n = 0;
    const { repository, calls } = fakeRepository({
      facts: [factsOf({})],
      restore: async () => {
        n += 1;
        if (n < 4) throw new CaseStateChangedError();
        return { item: ITEM, progress: PROGRESS };
      },
    });
    const result = await runService(repository, restoreOf);
    expect(result).toEqual({
      ok: true,
      value: { ...ITEM, progress: PROGRESS },
    });
    expect(calls.restoreTodo).toHaveLength(4);
    expect(warnsOf()).toHaveLength(0);
  });
});

describe("#149 149-C 計画 9.4 S6 履歴・削除済みの一覧の門", () => {
  const options = { limit: 100, cursor: null };
  const historyOf = (s: Service) =>
    s.listTodoEvents(actor(), CASE_ID, TODO_ID, options);
  const deletedOf = (s: Service) =>
    s.listDeletedTodos(actor(), CASE_ID, options);

  it.each([
    ["案件がない（404）", null, "real", { code: "NOT_FOUND", status: 404 }],
    [
      "有効な参加者でない（403）",
      factsOf(null, { actorIsParticipant: false }),
      "real",
      { code: "FORBIDDEN", status: 403 },
    ],
    [
      "perm.case.view を持たない（403）",
      factsOf({}),
      "none",
      { code: "FORBIDDEN", status: 403 },
    ],
    [
      "TODO がない（404）",
      factsOf(null),
      "real",
      { code: "NOT_FOUND", status: 404 },
    ],
  ] as const)(
    "#149 149-C 5-4 AC-10 S6: 履歴で %s なら、listTodoEvents を呼ばない",
    async (_l, facts, roles, expected) => {
      const { repository, calls } = fakeRepository({ facts: [facts] });
      const result = await runService(repository, historyOf, roles);
      expectError(result, expected);
      expect(calls.listTodoEvents).toEqual([]);
    },
  );

  it("#149 149-C 5-4 AC-10 S6: 履歴の 403（非参加）は「参加者だけが見られます（非公開）」で、logger.audit（case.todo.history）が1回", async () => {
    const { repository } = fakeRepository({
      facts: [factsOf(null, { actorIsParticipant: false })],
    });
    const result = await runService(repository, historyOf);
    expect((result as { error: AppError }).error.message).toBe(
      "参加者だけが見られます（非公開）",
    );
    expect(auditsOf("case.todo.history", "not_participant")).toHaveLength(1);
  });

  it("#149 149-C 5-4 AC-10・AC-12 S6: 削除済みの TODO の履歴は 404 にせず、listTodoEvents を呼ぶ", async () => {
    const { repository, calls } = fakeRepository({
      facts: [factsOf({ deleted: true })],
    });
    const result = await runService(repository, historyOf);
    expect(result.ok).toBe(true);
    expect(calls.listTodoEvents).toHaveLength(1);
    expect(calls.listTodoEvents[0]).toMatchObject({
      caseId: CASE_ID,
      todoId: TODO_ID,
      viewerId: w.memberS1.id,
    });
  });

  it.each([
    ["案件がない（404）", null, "real", { code: "NOT_FOUND", status: 404 }],
    [
      "有効な参加者でない（403）",
      factsOf(null, { actorIsParticipant: false }),
      "real",
      { code: "FORBIDDEN", status: 403 },
    ],
    [
      "perm.case.view を持たない（403）",
      factsOf(null),
      "none",
      { code: "FORBIDDEN", status: 403 },
    ],
  ] as const)(
    "#149 149-C 5-4 AC-12 S6: 削除済みの一覧で %s なら、listDeletedTodos を呼ばない",
    async (_l, facts, roles, expected) => {
      const { repository, calls } = fakeRepository({ facts: [facts] });
      const result = await runService(repository, deletedOf, roles);
      expectError(result, expected);
      expect(calls.listDeletedTodos).toEqual([]);
    },
  );

  it("#149 149-C 5-4 AC-12 S6: 削除済みの一覧の 403 は logger.audit（case.todo.deleted_list）が1回", async () => {
    const { repository } = fakeRepository({
      facts: [factsOf(null, { actorIsParticipant: false })],
    });
    await runService(repository, deletedOf);
    expect(auditsOf("case.todo.deleted_list", "not_participant")).toHaveLength(
      1,
    );
  });

  it.each([
    ["not_visible", { code: "FORBIDDEN", status: 403 }],
    ["not_found", { code: "NOT_FOUND", status: 404 }],
  ] as const)(
    "#149 149-C 5-4 AC-10・AC-12 S6（認可の後の資格の喪失）: 読み取りが %s なら、履歴・削除済みの一覧のどちらも、その応答にする",
    async (outcome, expected) => {
      const { repository } = fakeRepository({
        facts: [factsOf({})],
        events: async () => outcome,
        deleted: async () => outcome,
      });
      expectError(await runService(repository, historyOf), expected);
      expectError(await runService(repository, deletedOf), expected);
    },
  );
});
