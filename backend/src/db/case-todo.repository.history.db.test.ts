// #149（149-C）5-4 AC-6・AC-9・AC-10・AC-11・AC-12・AC-13・AC-14、計画 plan-149c 5.3・5.4・6節・9.1（D1〜D19）、計画レビュー1回目の軽微1・軽微2：
// TODO の履歴（listTodoEvents）・削除済みの一覧（listDeletedTodos）・復元（restoreTodo）の Repository を、マイグレーション済みの D1（本物の db.batch）で確かめる。
// この層で確かめるもの：SQL の結果と前提（読み取りの資格・ほかの TODO／案件の記録が混ざらない・ページ送り・復元の書き込みの中身と順・
//   前提を1つずつ崩すと何も残らない・記録の ID の全体の新しさ・記録と更新の直後の件数の確認〔軽微1〕・149-D との順の2通り〔軽微2〕）。
// 判定の順・応答コードは routes/case-todos.history.test.ts、読み直し・やり直しは services/case-todo.restore.service.test.ts、
// 割り込みは services/case-todo.restore.interleave.test.ts、実行計画は case-todo.explain.db.test.ts で確かめ、ここでは重ねない。
// 契約（実装前の仮置き。テストが決めたもの。実装の担当へ）：backend/src/db/case-todo.repository.ts
//   repository.listTodoEvents({ caseId, todoId, viewerId, limit, cursor: string | null })
//     : Promise<{ items: TodoEvent[]; nextCursor: string | null } | "not_found" | "not_visible">
//     TodoEvent = { id, kind, createdAt, actor: TodoPerson, title: string | null, previousTitle: string | null,
//       assignee: TodoPerson | null, previousAssignee: TodoPerson | null }
//     assignee・previousAssignee の displayName は記録した名前（C-74）、isActive は本人のいまの状態。actor の displayName はいまの表示名（計画 5.1）。
//     並びは記録の ID の昇順（古い順。決定 Q5）。todoId がほかの案件の TODO なら items は空。
//   repository.listDeletedTodos({ caseId, viewerId, limit, cursor: string | null })
//     : Promise<{ items: DeletedTodoItem[]; nextCursor: string | null } | "not_found" | "not_visible">
//     DeletedTodoItem = TodoItem（一覧と同じ形）＋ deletedAt: string ＋ deletedBy: TodoPerson（いまの表示名）。並びは TODO の ID の昇順（追加した順）。
//   repository.restoreTodo({ caseId, actorId, todoId, autoUnassignEventId, eventId }): Promise<{ item: TodoItem; progress: TodoProgress }>
//     autoUnassignEventId < eventId。前提・確認が崩れたら CaseStateChangedError（batch 全体が取り消される）。
//   export function buildRestoreTodoStatements(db: Database, input: TodoRestoreInput): BatchItem[]（軽微1。149-D の buildRemoveParticipantStatements と同じ形）
//     restoreTodo の書き込みの文の列（計画 5.4 の順：前提 → 記録 auto_unassign → 確認 → 記録 restore → 確認 → TODO の UPDATE → 確認。
//     後ろに項目・進捗の読み取りを足してもよい）。restoreTodo はこれを db.batch に渡す。テストは文の SQL で
//     「insert into "case_todo_events"」（1つ目＝auto_unassign、2つ目＝restore）と「update "case_todos"」を見つけて差し替える。
// 世界の対応：A＝memberS1（操作者）・B＝memberD1（担当）・C＝ownerD（別の担当）・D＝inactive（無効・参加の行あり）・E＝memberS2（非参加）。
// 時刻は CASEREQ_NOW から固定で進める。データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { caseTodos } from "../../db/schema";
import {
  MISSING_CASE_ID,
  addCaseMember,
  cleanupCaseTestData,
  joinedAt,
  removeCaseMember,
  seedCase,
  setDisplayName,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  casereqTraceId,
  CASEREQ_NOW,
  setUserActive,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import {
  auditLogCount,
  eventIdAt,
  insertTodo,
  insertTodoEvent,
  todoEventsOf,
  todoIdAt,
  todoRow,
  todoSnapshot,
  type TodoRow,
} from "../../test/case-todo-fixtures";
import { withAccounts } from "./account.repository";
import {
  buildRestoreTodoStatements,
  withCaseTodos,
  type CaseTodoRepository,
} from "./case-todo.repository";
import {
  CaseStateChangedError,
  runWriteBatch,
  withCases,
} from "./case.repository";
import { withDatabase, type Database } from "./database";

const NAME_A = "テスト操作者149C";
const NAME_B = "テスト担当149C";
const NAME_C = "テスト別担当149C";
const T1_TITLE = "[UNIT_TEST]149C見積書の作成";

let w: CaseWorld;
/** K：進行中。A・B・C・D（無効）が参加 */
let room: SeededCase;
/** K2：進行中の別の案件。A・B が参加 */
let other: SeededCase;
/** K3：終了。A が参加 */
let closed: SeededCase;

const A = () => w.memberS1.id;
const B = () => w.memberD1.id;
const C = () => w.ownerD.id;

/** CASEREQ_NOW から n 分後の時刻 */
const at = (n: number) =>
  new Date(Date.parse(CASEREQ_NOW) + n * 60_000).toISOString();

const person = (userId: string, displayName: string, isActive = true) => ({
  userId,
  displayName,
  isActive,
});

type RestoreInput = {
  caseId?: string;
  actorId?: string;
  todoId?: string;
  autoUnassignEventId?: string;
  eventId?: string;
};

const restoreInputOf = (input: RestoreInput = {}) => ({
  caseId: input.caseId ?? room.id,
  actorId: input.actorId ?? A(),
  todoId: input.todoId ?? todoIdAt(1),
  autoUnassignEventId: input.autoUnassignEventId ?? eventIdAt(500),
  eventId: input.eventId ?? eventIdAt(501),
});

const restore = (input: RestoreInput = {}) =>
  withCaseTodos(env, (r) => r.restoreTodo(restoreInputOf(input)));

const history = (
  input: {
    caseId?: string;
    todoId?: string;
    viewerId?: string;
    limit?: number;
    cursor?: string | null;
  } = {},
) =>
  withCaseTodos(env, (r) =>
    r.listTodoEvents({
      caseId: input.caseId ?? room.id,
      todoId: input.todoId ?? todoIdAt(1),
      viewerId: input.viewerId ?? A(),
      limit: input.limit ?? 100,
      cursor: input.cursor ?? null,
    }),
  );

const deletedList = (
  input: {
    caseId?: string;
    viewerId?: string;
    limit?: number;
    cursor?: string | null;
  } = {},
) =>
  withCaseTodos(env, (r) =>
    r.listDeletedTodos({
      caseId: input.caseId ?? room.id,
      viewerId: input.viewerId ?? A(),
      limit: input.limit ?? 100,
      cursor: input.cursor ?? null,
    }),
  );

/** 失敗が CaseStateChangedError で、何も変わっていないこと（TODO・記録・案件の版・参加・監査ログの件数） */
async function expectNothingChanged(run: () => Promise<unknown>) {
  const before = await todoSnapshot();
  await expect(run()).rejects.toBeInstanceOf(CaseStateChangedError);
  expect(await todoSnapshot()).toEqual(before);
}

/** 文字列でなければページ（not_found・not_visible なら失敗） */
function pageOf<T>(result: T | "not_found" | "not_visible"): T {
  if (typeof result === "string") throw new Error(`ページではない：${result}`);
  return result;
}

/** 削除済みの TODO（T1）を1件入れる。既定は未完了・担当 B（参加者） */
async function seedDeleted(
  overrides: Partial<Parameters<typeof insertTodo>[0]> = {},
) {
  await insertTodo({
    id: todoIdAt(1),
    caseId: room.id,
    title: T1_TITLE,
    createdBy: A(),
    assigneeId: B(),
    recordedAssigneeName: NAME_B,
    deletedBy: A(),
    version: 2,
    ...overrides,
  });
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(CASEREQ_NOW));
  w = await setupCaseWorld();
  await setDisplayName(A(), NAME_A);
  await setDisplayName(B(), NAME_B);
  await setDisplayName(C(), NAME_C);
  room = await seedCase({
    n: 1541,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]149C履歴",
    createdBy: A(),
    departmentIds: [w.deptS.id],
    members: [
      { userId: A(), joinedAt: joinedAt(1) },
      { userId: B(), joinedAt: joinedAt(2) },
      { userId: C(), joinedAt: joinedAt(3) },
      { userId: w.inactive.id, joinedAt: joinedAt(4) },
    ],
  });
  other = await seedCase({
    n: 1542,
    clientId: w.clientB.id,
    code: "QZB",
    title: "[UNIT_TEST]149C別の案件",
    createdBy: A(),
    departmentIds: [w.deptS.id],
    members: [
      { userId: A(), joinedAt: joinedAt(1) },
      { userId: B(), joinedAt: joinedAt(2) },
    ],
  });
  closed = await seedCase({
    n: 1543,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]149C終了",
    createdBy: A(),
    departmentIds: [w.deptS.id],
    status: "closed",
    members: [{ userId: A(), joinedAt: joinedAt(1) }],
  });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupCaseTestData();
});

describe("#149 149-C 5-4 AC-10・AC-11・AC-14 TODO の履歴（計画 9.1 D1〜D5）", () => {
  it("#149 149-C 5-4 AC-10・AC-11・AC-14 D1: 追加 → 題名の変更 → 担当の変更 → 完了 → 取り消し → 再完了 → 削除 → 復元の記録が、古い順に kind・操作した人・日時・題名と前の題名・担当と前の担当（記録した名前）で並ぶ。再完了は別の行", async () => {
    const repo = <T>(run: (r: CaseTodoRepository) => Promise<T>) =>
      withCaseTodos(env, run);
    const base = { caseId: room.id, actorId: A(), todoId: todoIdAt(1) };
    vi.setSystemTime(new Date(at(1)));
    await repo((r) =>
      r.addTodo({
        ...base,
        eventId: eventIdAt(1),
        title: T1_TITLE,
        assigneeId: B(),
      }),
    );
    vi.setSystemTime(new Date(at(2)));
    await repo((r) =>
      r.editTodo({
        ...base,
        version: 1,
        eventIds: [eventIdAt(2), eventIdAt(102)],
        title: "[UNIT_TEST]149C改題",
      }),
    );
    vi.setSystemTime(new Date(at(3)));
    await repo((r) =>
      r.editTodo({
        ...base,
        version: 2,
        eventIds: [eventIdAt(3), eventIdAt(103)],
        assignee: { id: C() },
      }),
    );
    vi.setSystemTime(new Date(at(4)));
    await repo((r) => r.completeTodo({ ...base, eventId: eventIdAt(104) }));
    vi.setSystemTime(new Date(at(5)));
    await repo((r) =>
      r.uncompleteTodo({
        ...base,
        autoUnassignEventId: eventIdAt(105),
        eventId: eventIdAt(106),
      }),
    );
    vi.setSystemTime(new Date(at(6)));
    await repo((r) => r.completeTodo({ ...base, eventId: eventIdAt(107) }));
    vi.setSystemTime(new Date(at(7)));
    await repo((r) => r.deleteTodo({ ...base, eventId: eventIdAt(108) }));
    vi.setSystemTime(new Date(at(8)));
    await restore({
      autoUnassignEventId: eventIdAt(109),
      eventId: eventIdAt(110),
    });

    const page = pageOf(await history());
    expect(page.nextCursor).toBeNull();
    const actor = person(A(), NAME_A);
    const noOne = {
      previousTitle: null,
      assignee: null,
      previousAssignee: null,
    };
    expect(page.items).toEqual([
      {
        id: eventIdAt(1),
        kind: "create",
        createdAt: at(1),
        actor,
        title: T1_TITLE,
        previousTitle: null,
        assignee: person(B(), NAME_B),
        previousAssignee: null,
      },
      {
        id: eventIdAt(2),
        kind: "title_change",
        createdAt: at(2),
        actor,
        title: "[UNIT_TEST]149C改題",
        previousTitle: T1_TITLE,
        assignee: null,
        previousAssignee: null,
      },
      {
        id: eventIdAt(3),
        kind: "assignee_change",
        createdAt: at(3),
        actor,
        title: null,
        previousTitle: null,
        assignee: person(C(), NAME_C),
        previousAssignee: person(B(), NAME_B),
      },
      {
        id: eventIdAt(104),
        kind: "complete",
        createdAt: at(4),
        actor,
        title: null,
        previousTitle: null,
        assignee: person(C(), NAME_C),
        previousAssignee: null,
      },
      {
        id: eventIdAt(106),
        kind: "uncomplete",
        createdAt: at(5),
        actor,
        title: null,
        ...noOne,
      },
      {
        id: eventIdAt(107),
        kind: "complete",
        createdAt: at(6),
        actor,
        title: null,
        previousTitle: null,
        assignee: person(C(), NAME_C),
        previousAssignee: null,
      },
      {
        id: eventIdAt(108),
        kind: "delete",
        createdAt: at(7),
        actor,
        title: "[UNIT_TEST]149C改題",
        ...noOne,
      },
      {
        id: eventIdAt(110),
        kind: "restore",
        createdAt: at(8),
        actor,
        title: "[UNIT_TEST]149C改題",
        ...noOne,
      },
    ]);
  });

  it("#149 149-C 5-4 AC-10 D2: 同じ案件の別の TODO・別の案件の TODO の記録は混ざらない", async () => {
    await insertTodo({
      id: todoIdAt(1),
      caseId: room.id,
      title: T1_TITLE,
      createdBy: A(),
    });
    await insertTodo({
      id: todoIdAt(2),
      caseId: room.id,
      title: "[UNIT_TEST]149C別のTODO",
      createdBy: A(),
    });
    await insertTodo({
      id: todoIdAt(9),
      caseId: other.id,
      title: "[UNIT_TEST]149C別の案件のTODO",
      createdBy: A(),
    });
    await insertTodoEvent({
      id: eventIdAt(1),
      todoId: todoIdAt(1),
      caseId: room.id,
      kind: "create",
      actorId: A(),
    });
    await insertTodoEvent({
      id: eventIdAt(2),
      todoId: todoIdAt(2),
      caseId: room.id,
      kind: "create",
      actorId: A(),
    });
    await insertTodoEvent({
      id: eventIdAt(3),
      todoId: todoIdAt(9),
      caseId: other.id,
      kind: "create",
      actorId: A(),
    });
    await insertTodoEvent({
      id: eventIdAt(4),
      todoId: todoIdAt(1),
      caseId: room.id,
      kind: "uncomplete",
      actorId: A(),
    });
    const page = pageOf(await history());
    expect(page.items.map((e) => e.id)).toEqual([eventIdAt(1), eventIdAt(4)]);
  });

  it("#149 149-C 5-4 AC-10 決定 Q5 D3: 記録が101件なら、1ページ目は100件（古い順）と nextCursor、続きは1件で nextCursor は null", async () => {
    await insertTodo({
      id: todoIdAt(1),
      caseId: room.id,
      title: T1_TITLE,
      createdBy: A(),
    });
    for (let i = 1; i <= 101; i += 1)
      await insertTodoEvent({
        id: eventIdAt(i),
        todoId: todoIdAt(1),
        caseId: room.id,
        kind: "uncomplete",
        actorId: A(),
      });
    const first = pageOf(await history());
    expect(first.items).toHaveLength(100);
    expect(first.items[0]?.id).toBe(eventIdAt(1));
    expect(first.items[99]?.id).toBe(eventIdAt(100));
    expect(first.nextCursor).not.toBeNull();
    const second = pageOf(await history({ cursor: first.nextCursor }));
    expect(second.items.map((e) => e.id)).toEqual([eventIdAt(101)]);
    expect(second.nextCursor).toBeNull();
  });

  it("#149 149-C 5-4 AC-10 D3: ちょうど100件なら nextCursor は null", async () => {
    await insertTodo({
      id: todoIdAt(1),
      caseId: room.id,
      title: T1_TITLE,
      createdBy: A(),
    });
    for (let i = 1; i <= 100; i += 1)
      await insertTodoEvent({
        id: eventIdAt(i),
        todoId: todoIdAt(1),
        caseId: room.id,
        kind: "uncomplete",
        actorId: A(),
      });
    const page = pageOf(await history());
    expect(page.items).toHaveLength(100);
    expect(page.nextCursor).toBeNull();
  });

  it.each([
    ["非参加の社員（E）", async () => w.memberS2.id],
    [
      "外された参加者（B）",
      async () => {
        await removeCaseMember(room.roomId, B());
        return B();
      },
    ],
    [
      "無効になった参加者（B）",
      async () => {
        await setUserActive(B(), false);
        return B();
      },
    ],
    ["参加の行が残る無効な社員（D）", async () => w.inactive.id],
  ])(
    "#149 149-C 5-4 AC-10 R-76 D4: 閲覧者が %s なら not_visible（中身を返さない）",
    async (_l, viewerOf) => {
      await insertTodo({
        id: todoIdAt(1),
        caseId: room.id,
        title: T1_TITLE,
        createdBy: A(),
      });
      await insertTodoEvent({
        id: eventIdAt(1),
        todoId: todoIdAt(1),
        caseId: room.id,
        kind: "create",
        actorId: A(),
      });
      const viewerId = await viewerOf();
      expect(await history({ viewerId })).toBe("not_visible");
    },
  );

  it("#149 149-C 5-4 AC-10 D4: 案件がなければ not_found。todoId がほかの案件の TODO なら記録は0件", async () => {
    await insertTodo({
      id: todoIdAt(9),
      caseId: other.id,
      title: "[UNIT_TEST]149C別の案件のTODO",
      createdBy: A(),
    });
    await insertTodoEvent({
      id: eventIdAt(1),
      todoId: todoIdAt(9),
      caseId: other.id,
      kind: "create",
      actorId: A(),
    });
    expect(await history({ caseId: MISSING_CASE_ID })).toBe("not_found");
    const page = pageOf(await history({ todoId: todoIdAt(9) }));
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it("#149 149-C 5-4 AC-6・C-74 D5: 担当・前の担当の名前は記録した名前で、本人がいま無効なら isActive は false。操作した人はいまの表示名で、いま無効なら isActive は false", async () => {
    await insertTodo({
      id: todoIdAt(1),
      caseId: room.id,
      title: T1_TITLE,
      createdBy: A(),
      assigneeId: B(),
      recordedAssigneeName: NAME_B,
    });
    await withCaseTodos(env, (r) =>
      r.editTodo({
        caseId: room.id,
        actorId: C(),
        todoId: todoIdAt(1),
        version: 1,
        eventIds: [eventIdAt(1), eventIdAt(2)],
        assignee: { id: A() },
      }),
    );
    // 記録の後に、B の表示名を変え、B と操作した C を無効にする
    await setDisplayName(B(), "テスト担当149C改名");
    await setDisplayName(C(), "テスト別担当149C改名");
    await setUserActive(B(), false);
    await setUserActive(C(), false);
    const page = pageOf(await history());
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      kind: "assignee_change",
      assignee: person(A(), NAME_A, true),
      previousAssignee: person(B(), NAME_B, false),
      actor: person(C(), "テスト別担当149C改名", false),
    });
  });
});

describe("#149 149-C 5-4 AC-12 削除済みの一覧（計画 9.1 D6〜D8）", () => {
  it("#149 149-C 5-4 AC-12 決定 Q5 D6: 削除済みだけが追加した順で出る（題名・担当・完了・deletedAt・deletedBy）。未削除は出ない", async () => {
    vi.setSystemTime(new Date(at(1)));
    await insertTodo({
      id: todoIdAt(1),
      caseId: room.id,
      title: "[UNIT_TEST]149C消した未完了",
      createdBy: A(),
      assigneeId: B(),
      recordedAssigneeName: NAME_B,
      deletedBy: A(),
      createdAt: at(1),
    });
    await insertTodo({
      id: todoIdAt(2),
      caseId: room.id,
      title: "[UNIT_TEST]149C残っている",
      createdBy: A(),
    });
    await insertTodo({
      id: todoIdAt(3),
      caseId: room.id,
      title: "[UNIT_TEST]149C消した完了済み",
      createdBy: A(),
      assigneeId: C(),
      recordedAssigneeName: NAME_C,
      isDone: true,
      completedAssigneeId: C(),
      completedAssigneeName: NAME_C,
      deletedBy: C(),
      createdAt: at(2),
    });
    await insertTodo({
      id: todoIdAt(9),
      caseId: other.id,
      title: "[UNIT_TEST]149C別の案件の消したもの",
      createdBy: A(),
      deletedBy: A(),
    });
    const page = pageOf(await deletedList());
    expect(page.nextCursor).toBeNull();
    expect(page.items).toEqual([
      {
        id: todoIdAt(1),
        title: "[UNIT_TEST]149C消した未完了",
        completed: false,
        version: 1,
        assignee: person(B(), NAME_B),
        previousAssignee: null,
        completedAssignee: null,
        deletedAt: at(1),
        deletedBy: person(A(), NAME_A),
      },
      {
        id: todoIdAt(3),
        title: "[UNIT_TEST]149C消した完了済み",
        completed: true,
        version: 1,
        assignee: person(C(), NAME_C),
        previousAssignee: null,
        completedAssignee: person(C(), NAME_C),
        deletedAt: at(2),
        deletedBy: person(C(), NAME_C),
      },
    ]);
  });

  it("#149 149-C 5-4 AC-6・AC-12 D6: 削除した人がいま無効なら isActive は false", async () => {
    await insertTodo({
      id: todoIdAt(1),
      caseId: room.id,
      title: T1_TITLE,
      createdBy: A(),
      deletedBy: B(),
    });
    await setUserActive(B(), false);
    const page = pageOf(await deletedList());
    expect(page.items[0]?.deletedBy).toEqual(person(B(), NAME_B, false));
  });

  it.each([
    ["非参加の社員（E）", async () => w.memberS2.id],
    [
      "外された参加者（B）",
      async () => {
        await removeCaseMember(room.roomId, B());
        return B();
      },
    ],
    [
      "無効になった参加者（B）",
      async () => {
        await setUserActive(B(), false);
        return B();
      },
    ],
  ])(
    "#149 149-C 5-4 AC-12 R-76 D7: 閲覧者が %s なら not_visible",
    async (_l, viewerOf) => {
      await seedDeleted();
      const viewerId = await viewerOf();
      expect(await deletedList({ viewerId })).toBe("not_visible");
    },
  );

  it("#149 149-C 5-4 AC-12 D7: 案件がなければ not_found", async () => {
    expect(await deletedList({ caseId: MISSING_CASE_ID })).toBe("not_found");
  });

  it("#149 149-C 5-4 AC-12 決定 Q5 D7: 削除済みが101件なら、1ページ目は100件と nextCursor、続きは1件で nextCursor は null。未削除はページの件数に数えない", async () => {
    for (let i = 1; i <= 101; i += 1)
      await insertTodo({
        id: todoIdAt(i * 2),
        caseId: room.id,
        title: `[UNIT_TEST]149C消したもの${i}`,
        createdBy: A(),
        deletedBy: A(),
      });
    // 未削除を間に挟む（ページの件数・境界に入れない）
    for (let i = 1; i <= 5; i += 1)
      await insertTodo({
        id: todoIdAt(i * 2 + 1),
        caseId: room.id,
        title: `[UNIT_TEST]149C残るもの${i}`,
        createdBy: A(),
      });
    const first = pageOf(await deletedList());
    expect(first.items).toHaveLength(100);
    expect(first.items[0]?.id).toBe(todoIdAt(2));
    expect(first.nextCursor).not.toBeNull();
    const second = pageOf(await deletedList({ cursor: first.nextCursor }));
    expect(second.items.map((t) => t.id)).toEqual([todoIdAt(202)]);
    expect(second.nextCursor).toBeNull();
  });

  it("#149 149-C 5-4 AC-9・AC-12 D8: 終了中の案件でも、履歴・削除済みの一覧を読める", async () => {
    await insertTodo({
      id: todoIdAt(4),
      caseId: closed.id,
      title: "[UNIT_TEST]149C終了中の消したもの",
      createdBy: A(),
      deletedBy: A(),
    });
    await insertTodoEvent({
      id: eventIdAt(1),
      todoId: todoIdAt(4),
      caseId: closed.id,
      kind: "delete",
      actorId: A(),
    });
    const events = pageOf(
      await history({ caseId: closed.id, todoId: todoIdAt(4) }),
    );
    expect(events.items.map((e) => e.id)).toEqual([eventIdAt(1)]);
    const deleted = pageOf(await deletedList({ caseId: closed.id }));
    expect(deleted.items.map((t) => t.id)).toEqual([todoIdAt(4)]);
  });
});

describe("#149 149-C 5-4 AC-13 復元の書き込み（計画 5.4・9.1 D9〜D15）", () => {
  it("#149 149-C 5-4 AC-13 D9: 未完了・担当がいま有効な参加者なら、担当はそのまま・auto_unassign なし・記録 restore（操作した人・日時・題名）が1件・版+1・deleted_* が NULL", async () => {
    await seedDeleted();
    const before = await todoRow(todoIdAt(1));
    vi.setSystemTime(new Date(at(10)));
    await restore();
    expect(await todoRow(todoIdAt(1))).toEqual({
      ...before,
      deleted_at: null,
      deleted_by: null,
      version: before.version + 1,
      updated_at: at(10),
    });
    expect(await todoEventsOf(todoIdAt(1))).toEqual([
      {
        id: eventIdAt(501),
        todo_id: todoIdAt(1),
        case_id: room.id,
        kind: "restore",
        actor_id: A(),
        title: T1_TITLE,
        previous_title: null,
        assignee_id: null,
        assignee_name: null,
        previous_assignee_id: null,
        previous_assignee_name: null,
        created_at: at(10),
      },
    ]);
  });

  it.each([
    [
      "参加者から外れている",
      async () => {
        await removeCaseMember(room.roomId, B());
      },
    ],
    [
      "無効になっている",
      async () => {
        await setUserActive(B(), false);
      },
    ],
  ])(
    "#149 149-C 5-4 AC-13 D10・D11: 未完了で、担当が %s なら、担当なし（recorded_assignee_* は残る）・記録 auto_unassign（外れた人・記録した名前・操作した人）→ restore の順",
    async (_l, makeGone) => {
      await seedDeleted();
      await makeGone();
      const before = await todoRow(todoIdAt(1));
      vi.setSystemTime(new Date(at(10)));
      await restore();
      expect(await todoRow(todoIdAt(1))).toEqual({
        ...before,
        assignee_id: null,
        deleted_at: null,
        deleted_by: null,
        version: before.version + 1,
        updated_at: at(10),
      } satisfies TodoRow);
      const events = await todoEventsOf(todoIdAt(1));
      expect(events.map((e) => [e.id, e.kind])).toEqual([
        [eventIdAt(500), "auto_unassign"],
        [eventIdAt(501), "restore"],
      ]);
      expect(events[0]).toMatchObject({
        actor_id: A(),
        assignee_id: B(),
        assignee_name: NAME_B,
        created_at: at(10),
      });
    },
  );

  it("#149 149-C 決定（U2 の案 A。AC-13 の原文）: 削除している間に一度外れて、もう一度参加した担当は、復元の時点で有効な参加者なので担当が残り、auto_unassign はない", async () => {
    await seedDeleted();
    await removeCaseMember(room.roomId, B());
    await addCaseMember(room.roomId, B(), joinedAt(40));
    await restore();
    expect((await todoRow(todoIdAt(1))).assignee_id).toBe(B());
    expect((await todoEventsOf(todoIdAt(1))).map((e) => e.kind)).toEqual([
      "restore",
    ]);
  });

  it("#149 149-C 5-4 AC-11・AC-13 D12: 完了済みで担当が外れていても、担当・completed_*・is_done は変わらず、auto_unassign はない", async () => {
    await seedDeleted({
      isDone: true,
      completedAssigneeId: B(),
      completedAssigneeName: NAME_B,
    });
    await removeCaseMember(room.roomId, B());
    const before = await todoRow(todoIdAt(1));
    await restore();
    const after = await todoRow(todoIdAt(1));
    expect(after).toMatchObject({
      assignee_id: B(),
      recorded_assignee_id: B(),
      recorded_assignee_name: NAME_B,
      completed_assignee_id: B(),
      completed_assignee_name: NAME_B,
      is_done: 1,
      deleted_at: null,
      version: before.version + 1,
    });
    expect((await todoEventsOf(todoIdAt(1))).map((e) => e.kind)).toEqual([
      "restore",
    ]);
  });

  it("#149 149-C 5-4 AC-13 D13: 担当なしの TODO は担当なしのまま、auto_unassign はない", async () => {
    await seedDeleted({ assigneeId: null, recordedAssigneeName: null });
    await restore();
    expect(await todoRow(todoIdAt(1))).toMatchObject({
      assignee_id: null,
      recorded_assignee_id: null,
      deleted_at: null,
    });
    expect((await todoEventsOf(todoIdAt(1))).map((e) => e.kind)).toEqual([
      "restore",
    ]);
  });

  it("#149 149-C 5-4 AC-4・AC-13 D14: 復元の後、一覧に元の位置（ID 順）で戻り、進捗の全体数・完了数に入る。応答の項目・進捗は、その後の一覧と一致する", async () => {
    await insertTodo({
      id: todoIdAt(0),
      caseId: room.id,
      title: "[UNIT_TEST]149C先頭",
      createdBy: A(),
      isDone: true,
    });
    await seedDeleted();
    await insertTodo({
      id: todoIdAt(2),
      caseId: room.id,
      title: "[UNIT_TEST]149C末尾",
      createdBy: A(),
    });
    const before = pageOf(
      await withCaseTodos(env, (r) =>
        r.listTodos({
          caseId: room.id,
          viewerId: A(),
          limit: 100,
          cursor: null,
        }),
      ),
    );
    expect(before.items.map((t) => t.id)).toEqual([todoIdAt(0), todoIdAt(2)]);
    expect(before.progress).toEqual({ done: 1, total: 2 });
    const result = await restore();
    const after = pageOf(
      await withCaseTodos(env, (r) =>
        r.listTodos({
          caseId: room.id,
          viewerId: A(),
          limit: 100,
          cursor: null,
        }),
      ),
    );
    expect(after.items.map((t) => t.id)).toEqual([
      todoIdAt(0),
      todoIdAt(1),
      todoIdAt(2),
    ]);
    expect(after.progress).toEqual({ done: 1, total: 3 });
    expect(result.progress).toEqual({ done: 1, total: 3 });
    expect(result.item).toEqual(after.items[1]);
    expect(result.item).toMatchObject({
      id: todoIdAt(1),
      title: T1_TITLE,
      completed: false,
      version: 3,
      assignee: person(B(), NAME_B),
    });
  });

  it("#149 149-C 決定（監査ログに残さない）D15: 復元しても audit_logs の件数は増えない", async () => {
    await seedDeleted();
    const audits = await auditLogCount();
    await restore();
    expect(await auditLogCount()).toBe(audits);
  });
});

describe("#149 149-C 5-4 AC-13 復元の前提を1つずつ崩す（計画 9.1 D16〜D18）", () => {
  it.each([
    [
      "削除済みでない TODO",
      async () => {
        await insertTodo({
          id: todoIdAt(1),
          caseId: room.id,
          title: T1_TITLE,
          createdBy: A(),
        });
      },
      {},
    ],
    [
      "終了中の案件",
      async () => {
        await insertTodo({
          id: todoIdAt(4),
          caseId: closed.id,
          title: "[UNIT_TEST]149C終了中の消したもの",
          createdBy: A(),
          deletedBy: A(),
        });
      },
      { caseIdOf: () => closed.id, todoId: todoIdAt(4) },
    ],
    [
      "操作者が非参加（E）",
      async () => {
        await seedDeleted();
      },
      { actorIdOf: () => w.memberS2.id },
    ],
    [
      "ほかの案件の TODO",
      async () => {
        await insertTodo({
          id: todoIdAt(9),
          caseId: other.id,
          title: "[UNIT_TEST]149C別の案件の消したもの",
          createdBy: A(),
          deletedBy: A(),
        });
      },
      { todoId: todoIdAt(9) },
    ],
  ] as const)(
    "#149 149-C 5-4 AC-9・AC-13 D16（古い材料で前提が崩れる側）: %s を restoreTodo に直接渡すと CaseStateChangedError で、記録・TODO・案件の版が変わらない",
    async (_l, seed, options) => {
      await seed();
      const o = options as {
        caseIdOf?: () => string;
        actorIdOf?: () => string;
        todoId?: string;
      };
      await expectNothingChanged(() =>
        restore({
          ...(o.caseIdOf === undefined ? {} : { caseId: o.caseIdOf() }),
          ...(o.actorIdOf === undefined ? {} : { actorId: o.actorIdOf() }),
          ...(o.todoId === undefined ? {} : { todoId: o.todoId }),
        }),
      );
    },
  );

  it("#149 149-C D16: 操作者が外された参加者・無効な参加者でも、前提が崩れて何も残らない", async () => {
    await seedDeleted();
    await removeCaseMember(room.roomId, C());
    await expectNothingChanged(() => restore({ actorId: C() }));
    await expectNothingChanged(() => restore({ actorId: w.inactive.id }));
  });

  it.each([
    ["最初の ID と同じ", eventIdAt(500)],
    ["最初の ID より大きい", eventIdAt(700)],
  ])(
    "#149 149-C 計画 6節 D17: 記録の表の全体に、渡した最初の ID 以上の記録（%s。別の TODO の記録）があると CaseStateChangedError で、何も残らない",
    async (_l, usedId) => {
      await seedDeleted();
      await insertTodo({
        id: todoIdAt(2),
        caseId: room.id,
        title: "[UNIT_TEST]149C別のTODO",
        createdBy: A(),
      });
      await insertTodoEvent({
        id: usedId,
        todoId: todoIdAt(2),
        caseId: room.id,
        kind: "create",
        actorId: A(),
      });
      await expectNothingChanged(() => restore());
    },
  );

  it("#149 149-C 計画 6節 D17: ほかの案件の記録が全体の最大でも、同じく取り消される（記録の表の全体で確かめる）", async () => {
    await seedDeleted();
    await insertTodo({
      id: todoIdAt(9),
      caseId: other.id,
      title: "[UNIT_TEST]149C別の案件のTODO",
      createdBy: A(),
    });
    await insertTodoEvent({
      id: eventIdAt(600),
      todoId: todoIdAt(9),
      caseId: other.id,
      kind: "create",
      actorId: A(),
    });
    await expectNothingChanged(() => restore());
  });

  it("#149 149-C 計画 6節 D18: 2回続けて復元すると、2回目は前提（削除済み）が崩れて CaseStateChangedError で、記録 restore は1件のまま", async () => {
    await seedDeleted();
    await restore();
    await expectNothingChanged(() =>
      restore({ autoUnassignEventId: eventIdAt(510), eventId: eventIdAt(511) }),
    );
    expect(
      (await todoEventsOf(todoIdAt(1))).filter((e) => e.kind === "restore"),
    ).toHaveLength(1);
  });
});

describe("#149 149-C 計画 6節 D19・軽微2 担当者が外れることとの順の2通り", () => {
  const removeB = () =>
    withCases(env, (r) =>
      r.removeParticipant({
        caseId: room.id,
        actorId: A(),
        userId: B(),
        traceId: casereqTraceId(),
      }),
    );
  const deactivateB = () =>
    withAccounts(env, (r) =>
      r.deactivate({
        targetId: B(),
        actorId: w.admin.id,
        now: at(20),
        traceId: casereqTraceId(),
      }),
    );
  const autoUnassigns = async () =>
    (await todoEventsOf(todoIdAt(1))).filter((e) => e.kind === "auto_unassign");

  it.each([
    ["参加者からの削除", removeB],
    ["無効化", deactivateB],
  ])(
    "#149 149-C 5-4 AC-6・AC-13 D19: 担当者の%s → 復元：担当なし・auto_unassign は1件（復元の側が残す）",
    async (_l, unassign) => {
      await seedDeleted();
      await unassign();
      // 削除済みには 149-D を当てない（決定 Q4）ため、この時点では担当のまま
      expect((await todoRow(todoIdAt(1))).assignee_id).toBe(B());
      await restore({
        autoUnassignEventId: eventIdAt(800),
        eventId: eventIdAt(801),
      });
      expect((await todoRow(todoIdAt(1))).assignee_id).toBeNull();
      const events = await autoUnassigns();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ actor_id: A(), assignee_id: B() });
    },
  );

  it.each([
    ["参加者からの削除", removeB],
    ["無効化", deactivateB],
  ])(
    "#149 149-C 5-4 AC-6・AC-13 D19: 復元 → 担当者の%s：担当なし・auto_unassign は1件（149-D の側が残す）",
    async (_l, unassign) => {
      await seedDeleted();
      await restore();
      expect((await todoRow(todoIdAt(1))).assignee_id).toBe(B());
      await unassign();
      expect((await todoRow(todoIdAt(1))).assignee_id).toBeNull();
      expect(await autoUnassigns()).toHaveLength(1);
    },
  );
});

// ---- 計画レビュー1回目 軽微1：復元の文の列を差し替えて、記録・更新の直後の件数の確認を試す（先例：case-todo-unassign.db.test.ts） ----

type Statements = ReturnType<typeof buildRestoreTodoStatements>;
type Item = Statements[number];

function sqlOf(item: unknown): string {
  const query = item as {
    toSQL?: () => { sql: string };
    getQuery?: () => { sql: string };
  };
  if (typeof query.toSQL === "function") return query.toSQL().sql;
  if (typeof query.getQuery === "function") return query.getQuery().sql;
  return "";
}

const INSERT_EVENTS = /^\s*insert\s+into\s+"?case_todo_events"?/i;
const UPDATE_TODOS = /^\s*update\s+"?case_todos"?/i;

type Target = "auto_unassign" | "restore" | "update";

/** 差し替える文の位置（記録の文は、1つ目＝auto_unassign、2つ目＝restore） */
function indexOf(statements: readonly Item[], target: Target): number {
  const inserts = statements
    .map((item, index) => ({ index, text: sqlOf(item) }))
    .filter((s) => INSERT_EVENTS.test(s.text));
  const updates = statements
    .map((item, index) => ({ index, text: sqlOf(item) }))
    .filter((s) => UPDATE_TODOS.test(s.text));
  if (inserts.length !== 2 || updates.length !== 1)
    throw new Error(
      `計画 5.4 の文（記録の INSERT 2つ・TODO の UPDATE 1つ）が見つかりません：INSERT ${inserts.length}・UPDATE ${updates.length}`,
    );
  const found =
    target === "auto_unassign"
      ? inserts[0]
      : target === "restore"
        ? inserts[1]
        : updates[0];
  if (found === undefined) throw new Error(`${target} の文がありません`);
  return found.index;
}

async function runStatements(db: Database, statements: Item[]) {
  await runWriteBatch(() =>
    db.batch(statements as unknown as Parameters<Database["batch"]>[0]),
  );
}

/** 0行を書く文（同じ TODO の表の、何も変えない UPDATE） */
const zeroRows = (db: Database) =>
  db
    .update(caseTodos)
    .set({ version: sql`${caseTodos.version}` })
    .where(sql`0`) as unknown as Item;

describe("#149 149-C 軽微1 復元の文の列（buildRestoreTodoStatements）を差し替えて、件数の確認を崩す", () => {
  it.each([
    ["担当の自動の解除がある（B が外れている）", true],
    ["担当の自動の解除がない（B が参加者）", false],
  ])(
    "#149 149-C 5.4: %s 場合、文の列をそのまま db.batch に渡すと成り立つ（差し替えの仕組みの確認）",
    async (_l, gone) => {
      await seedDeleted();
      if (gone) await removeCaseMember(room.roomId, B());
      await withDatabase(env, async (db) => {
        await runStatements(db, [
          ...buildRestoreTodoStatements(db, restoreInputOf()),
        ]);
      });
      const row = await todoRow(todoIdAt(1));
      expect(row.deleted_at).toBeNull();
      expect(row.assignee_id).toBe(gone ? null : B());
      expect((await todoEventsOf(todoIdAt(1))).map((e) => e.kind)).toEqual(
        gone ? ["auto_unassign", "restore"] : ["restore"],
      );
    },
  );

  it.each([
    ["記録 auto_unassign", "auto_unassign"],
    ["記録 restore", "restore"],
    ["TODO の UPDATE", "update"],
  ] as const)(
    "#149 149-C 5.4・軽微1（担当の自動の解除がある）: %s を0行の文に差し替えると、直後の件数の確認で取り消され、TODO・版・記録・案件の版が全部前のまま",
    async (_l, target) => {
      await seedDeleted();
      await removeCaseMember(room.roomId, B());
      const before = await todoSnapshot();
      await withDatabase(env, async (db) => {
        const statements = [
          ...buildRestoreTodoStatements(db, restoreInputOf()),
        ];
        statements[indexOf(statements, target)] = zeroRows(db);
        await expect(runStatements(db, statements)).rejects.toBeInstanceOf(
          CaseStateChangedError,
        );
      });
      expect(await todoSnapshot()).toEqual(before);
    },
  );

  it.each([
    ["記録 restore", "restore"],
    ["TODO の UPDATE", "update"],
  ] as const)(
    "#149 149-C 5.4・軽微1（担当の自動の解除がない）: %s を0行の文に差し替えると、直後の件数の確認で取り消され、TODO・版・記録・案件の版が全部前のまま",
    async (_l, target) => {
      await seedDeleted();
      const before = await todoSnapshot();
      await withDatabase(env, async (db) => {
        const statements = [
          ...buildRestoreTodoStatements(db, restoreInputOf()),
        ];
        statements[indexOf(statements, target)] = zeroRows(db);
        await expect(runStatements(db, statements)).rejects.toBeInstanceOf(
          CaseStateChangedError,
        );
      });
      expect(await todoSnapshot()).toEqual(before);
    },
  );

  it("#149 149-C 5.4・軽微1: 文を組み立てた後に担当者が外れても（材料が古い）、batch の時点の状態で担当なし・auto_unassign 1件になる", async () => {
    await seedDeleted();
    await withDatabase(env, async (db) => {
      const statements = [...buildRestoreTodoStatements(db, restoreInputOf())];
      await removeCaseMember(room.roomId, B());
      await runStatements(db, statements);
    });
    expect((await todoRow(todoIdAt(1))).assignee_id).toBeNull();
    expect((await todoEventsOf(todoIdAt(1))).map((e) => e.kind)).toEqual([
      "auto_unassign",
      "restore",
    ]);
  });
});
