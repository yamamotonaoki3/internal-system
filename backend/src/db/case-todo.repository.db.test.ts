// #149（149-A）5-4 AC-1〜AC-4・AC-6（選べる人）・AC-8（取り消し）・AC-9・AC-11、決定 Q2・Q3・Q4、計画 6.4・6.5・6.9・6.10：
// TODO の Repository（case-todo.repository.ts）の読み取りと書き込み（1操作＝1回の db.batch）を、マイグレーション済みの D1 で確かめる。
// この層で確かめるもの：
//   書き込みの batch の前提（案件が進行中・操作者が有効な参加者・TODO がその案件の未削除のもの・TODO の状態・担当者が有効な参加者）が
//   崩れたら何も残らない（TODO・記録・案件の版・監査ログ）。記録は消さない・書き換えない。監査ログに行が増えない（決定 Q2）。
//   必須の行（本体・記録）が0行なら batch 全体が取り消される（6.10。ID の順の逆転を強制する）。取り消しで担当者の資格を確かめる（6.9(2)）。
//   読み取りの資格（閲覧者が有効な参加者でなければ not_visible で中身を返さない）、並び（ID 昇順）・ページ送り・進捗・担当の名前の出し分け（6.9(1)）。
// 判定の順・応答コード・読み直し（決定 Q3 の 200 など）は、結合テスト（routes/case-todos.test.ts）・Service のテスト・割り込みのテストで確かめ、ここでは重ねない。
// 契約（実装前の仮置き。実装の担当へ）：backend/src/db/case-todo.repository.ts
//   withCaseTodos(env, (repository, roles) => …)
//   repository.addTodo({ caseId, actorId, todoId, eventId, title, assigneeId: string | null }): Promise<unknown>
//   repository.completeTodo({ caseId, actorId, todoId, eventId }): Promise<unknown>
//   repository.uncompleteTodo({ caseId, actorId, todoId, eventId, autoUnassignEventId }): Promise<unknown>
//     （autoUnassignEventId は担当者が外れていたときだけ使う記録 auto_unassign の ID。eventId より小さい）
//   repository.listTodos({ caseId, viewerId, limit, cursor: string | null }):
//     Promise<"not_found" | "not_visible" | { items: TodoItem[]; nextCursor: string | null; progress: { done: number; total: number } | null }>
//   TodoItem = { id, title, completed, version, assignee: Person | null, previousAssignee: Person | null, completedAssignee: Person | null }
//   Person = { userId, displayName, isActive }
//   前提・確認が崩れたら CaseStateChangedError（case.repository.ts）を投げ、batch 全体が取り消される。
// 時刻は CASEREQ_NOW に固定する。データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupCaseTestData,
  joinedAt,
  removeCaseMember,
  seedCase,
  setDisplayName,
  type SeededCase,
} from "../../test/case-fixtures";
import { setCaseStatus } from "../../test/case-participant-fixtures";
import {
  CASEREQ_NOW,
  setUserActive,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import {
  auditLogCount,
  eventIdAt,
  futureIdAt,
  insertTodo,
  insertTodoEvent,
  todoEventsOf,
  todoIdAt,
  todoRow,
  todoRowsOf,
  todoSnapshot,
} from "../../test/case-todo-fixtures";
import { withCaseTodos } from "./case-todo.repository";
import { CaseStateChangedError } from "./case.repository";

let w: CaseWorld;
/** 進行中・deptS 担当：memberS1・memberD1・inactive（無効・参加の行は残る）。memberS2・ownerS・admin は非参加 */
let room: SeededCase;
/** 進行中の別の案件：memberS1・memberS2 が参加（ほかの案件の TODO を混ぜるため） */
let other: SeededCase;

const NAME_S1 = "テスト操作者149";
const NAME_D1 = "テスト担当149";
const NAME_S2 = "テスト別案件149";

type Person = { userId: string; displayName: string; isActive: boolean };
type TodoItem = {
  id: string;
  title: string;
  completed: boolean;
  version: number;
  assignee: Person | null;
  previousAssignee: Person | null;
  completedAssignee: Person | null;
};
type Listed = {
  items: TodoItem[];
  nextCursor: string | null;
  progress: { done: number; total: number } | null;
};

const add = (input: {
  caseId?: string;
  actorId?: string;
  todoId: string;
  eventId: string;
  title?: string;
  assigneeId?: string | null;
}) =>
  withCaseTodos(env, (r) =>
    r.addTodo({
      caseId: input.caseId ?? room.id,
      actorId: input.actorId ?? w.memberS1.id,
      todoId: input.todoId,
      eventId: input.eventId,
      title: input.title ?? "[UNIT_TEST]149A追加",
      assigneeId: input.assigneeId ?? null,
    }),
  );
const complete = (input: {
  caseId?: string;
  actorId?: string;
  todoId: string;
  eventId: string;
}) =>
  withCaseTodos(env, (r) =>
    r.completeTodo({
      caseId: input.caseId ?? room.id,
      actorId: input.actorId ?? w.memberS1.id,
      todoId: input.todoId,
      eventId: input.eventId,
    }),
  );
const uncomplete = (input: {
  caseId?: string;
  actorId?: string;
  todoId: string;
  eventId: string;
  autoUnassignEventId: string;
}) =>
  withCaseTodos(env, (r) =>
    r.uncompleteTodo({
      caseId: input.caseId ?? room.id,
      actorId: input.actorId ?? w.memberS1.id,
      todoId: input.todoId,
      eventId: input.eventId,
      autoUnassignEventId: input.autoUnassignEventId,
    }),
  );
const list = async (
  viewerId: string,
  options: { caseId?: string; limit?: number; cursor?: string | null } = {},
) =>
  withCaseTodos(env, (r) =>
    r.listTodos({
      caseId: options.caseId ?? room.id,
      viewerId,
      limit: options.limit ?? 100,
      cursor: options.cursor ?? null,
    }),
  );
async function listOk(
  viewerId: string,
  options: { caseId?: string; limit?: number; cursor?: string | null } = {},
): Promise<Listed> {
  const result = await list(viewerId, options);
  if (typeof result === "string") throw new Error(`一覧が ${result}`);
  return result as Listed;
}

/** 失敗が CaseStateChangedError で、何も変わっていないこと（TODO・記録・案件の版・参加・監査ログの件数） */
async function expectNothingChanged(run: () => Promise<unknown>) {
  const before = await todoSnapshot();
  await expect(run()).rejects.toBeInstanceOf(CaseStateChangedError);
  expect(await todoSnapshot()).toEqual(before);
}

/** room の TODO を1件入れる（担当 memberD1。名前は担当した時点の NAME_D1） */
const seedOpenTodo = (
  n: number,
  overrides: Partial<Parameters<typeof insertTodo>[0]> = {},
) =>
  insertTodo({
    id: todoIdAt(n),
    caseId: room.id,
    title: `[UNIT_TEST]149A項目${n}`,
    createdBy: w.memberS1.id,
    assigneeId: w.memberD1.id,
    recordedAssigneeName: NAME_D1,
    ...overrides,
  });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(CASEREQ_NOW));
  w = await setupCaseWorld();
  await setDisplayName(w.memberS1.id, NAME_S1);
  await setDisplayName(w.memberD1.id, NAME_D1);
  await setDisplayName(w.memberS2.id, NAME_S2);
  room = await seedCase({
    n: 1492,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]149A TODO",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
      { userId: w.inactive.id, joinedAt: joinedAt(3) },
    ],
  });
  other = await seedCase({
    n: 1493,
    clientId: w.clientB.id,
    code: "QZB",
    title: "[UNIT_TEST]149A別の案件",
    createdBy: w.memberS2.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberS2.id, joinedAt: joinedAt(2) },
    ],
  });
});

afterEach(async () => {
  vi.useRealTimers();
  await cleanupCaseTestData();
});

describe("#149 AC-1 5-4 AC-2・AC-6 追加", () => {
  it("#149 AC-1 5-4 AC-2・AC-10: 担当者つきで追加すると、未完了・版1の行と、記録 create（題名・担当と担当した時点の表示名・操作した人・日時）が1件残る", async () => {
    await add({
      todoId: todoIdAt(1),
      eventId: eventIdAt(1),
      title: "[UNIT_TEST]149A見積り",
      assigneeId: w.memberD1.id,
    });
    const row = await todoRow(todoIdAt(1));
    expect(row).toMatchObject({
      case_id: room.id,
      title: "[UNIT_TEST]149A見積り",
      assignee_id: w.memberD1.id,
      recorded_assignee_id: w.memberD1.id,
      recorded_assignee_name: NAME_D1,
      completed_assignee_id: null,
      completed_assignee_name: null,
      is_done: 0,
      version: 1,
      created_by: w.memberS1.id,
      created_at: CASEREQ_NOW,
      updated_at: CASEREQ_NOW,
      deleted_at: null,
      deleted_by: null,
    });
    expect(await todoEventsOf(todoIdAt(1))).toEqual([
      {
        id: eventIdAt(1),
        todo_id: todoIdAt(1),
        case_id: room.id,
        kind: "create",
        actor_id: w.memberS1.id,
        title: "[UNIT_TEST]149A見積り",
        previous_title: null,
        assignee_id: w.memberD1.id,
        assignee_name: NAME_D1,
        previous_assignee_id: null,
        previous_assignee_name: null,
        created_at: CASEREQ_NOW,
      },
    ]);
  });

  it("#149 AC-1 5-4 AC-6: 担当者なしで追加すると、現在・保存した担当がどちらも NULL", async () => {
    await add({ todoId: todoIdAt(1), eventId: eventIdAt(1) });
    expect(await todoRow(todoIdAt(1))).toMatchObject({
      assignee_id: null,
      recorded_assignee_id: null,
      recorded_assignee_name: null,
    });
    const [event] = await todoEventsOf(todoIdAt(1));
    expect(event).toMatchObject({
      kind: "create",
      assignee_id: null,
      assignee_name: null,
    });
  });

  it("#149 AC-1 5-4 AC-6: 自分を担当者にできる（操作者も有効な参加者）", async () => {
    await add({
      todoId: todoIdAt(1),
      eventId: eventIdAt(1),
      assigneeId: w.memberS1.id,
    });
    expect((await todoRow(todoIdAt(1))).recorded_assignee_name).toBe(NAME_S1);
  });

  it.each([
    ["非参加の社員（担当部署のオーナー）", () => w.ownerS.id],
    ["無効な参加者（参加の行は残る）", () => w.inactive.id],
    ["ほかの案件だけの参加者", () => w.memberS2.id],
    ["いない利用者の ID", () => futureIdAt(99)],
  ])(
    "#149 AC-1 5-4 AC-6: 担当者が %s なら、何も残らない（CaseStateChangedError）",
    async (_label, assignee) => {
      await expectNothingChanged(() =>
        add({
          todoId: todoIdAt(1),
          eventId: eventIdAt(1),
          assigneeId: assignee(),
        }),
      );
    },
  );
});

describe("#149 AC-1 R-76 操作者の資格（追加・完了・取り消し）", () => {
  const actors: [string, () => string][] = [
    ["非参加の一般社員", () => w.memberS2.id],
    ["無効な参加者（参加の行は残る）", () => w.inactive.id],
    ["非参加の全体管理者", () => w.admin.id],
    ["非参加の担当部署のオーナー", () => w.ownerS.id],
  ];

  it.each(actors)(
    "#149 AC-1 R-76: 操作者が %s なら、追加は何も残さない",
    async (_label, actor) => {
      await expectNothingChanged(() =>
        add({ actorId: actor(), todoId: todoIdAt(1), eventId: eventIdAt(1) }),
      );
    },
  );

  it.each(actors)(
    "#149 AC-1 R-76: 操作者が %s なら、完了は何も残さない",
    async (_label, actor) => {
      await seedOpenTodo(1);
      await expectNothingChanged(() =>
        complete({
          actorId: actor(),
          todoId: todoIdAt(1),
          eventId: eventIdAt(1),
        }),
      );
    },
  );

  it.each(actors)(
    "#149 AC-1 R-76: 操作者が %s なら、取り消しは何も残さない",
    async (_label, actor) => {
      await seedOpenTodo(1, {
        isDone: true,
        completedAssigneeId: w.memberD1.id,
        completedAssigneeName: NAME_D1,
      });
      await expectNothingChanged(() =>
        uncomplete({
          actorId: actor(),
          todoId: todoIdAt(1),
          eventId: eventIdAt(2),
          autoUnassignEventId: eventIdAt(1),
        }),
      );
    },
  );

  it("#149 AC-1 R-76: ほかの案件の参加者でも、この案件の参加者でなければ、ほかの案件の ID を使っても書けない", async () => {
    await expectNothingChanged(() =>
      add({
        caseId: room.id,
        actorId: w.memberS2.id,
        todoId: todoIdAt(1),
        eventId: eventIdAt(1),
      }),
    );
  });
});

describe("#149 AC-1 5-4 AC-9 終了した案件", () => {
  it("#149 AC-1 5-4 AC-9: 終了中は、追加・完了・取り消しのどれも何も残さない", async () => {
    await seedOpenTodo(1);
    await seedOpenTodo(2, {
      isDone: true,
      completedAssigneeId: w.memberD1.id,
      completedAssigneeName: NAME_D1,
    });
    await setCaseStatus(room.id, "closed");
    await expectNothingChanged(() =>
      add({ todoId: todoIdAt(3), eventId: eventIdAt(1) }),
    );
    await expectNothingChanged(() =>
      complete({ todoId: todoIdAt(1), eventId: eventIdAt(2) }),
    );
    await expectNothingChanged(() =>
      uncomplete({
        todoId: todoIdAt(2),
        eventId: eventIdAt(4),
        autoUnassignEventId: eventIdAt(3),
      }),
    );
  });

  it("#149 AC-1 5-4 AC-9: 終了中でも、参加者は一覧と進捗を読める", async () => {
    await seedOpenTodo(1);
    await setCaseStatus(room.id, "closed");
    const page = await listOk(w.memberS1.id);
    expect(page.items.map((i) => i.id)).toEqual([todoIdAt(1)]);
    expect(page.progress).toEqual({ done: 0, total: 1 });
  });
});

describe("#149 AC-1 5-4 AC-3・AC-8・AC-11 完了と完了の取り消し", () => {
  it("#149 AC-1 5-4 AC-3・AC-11: 完了で is_done=1・版+1・完了の時の担当と名前、記録 complete（完了の時点の担当と表示名・操作した人・日時）", async () => {
    await seedOpenTodo(1);
    await complete({
      actorId: w.memberS1.id,
      todoId: todoIdAt(1),
      eventId: eventIdAt(1),
    });
    expect(await todoRow(todoIdAt(1))).toMatchObject({
      is_done: 1,
      version: 2,
      assignee_id: w.memberD1.id,
      completed_assignee_id: w.memberD1.id,
      completed_assignee_name: NAME_D1,
      updated_at: CASEREQ_NOW,
    });
    expect(await todoEventsOf(todoIdAt(1))).toEqual([
      expect.objectContaining({
        id: eventIdAt(1),
        kind: "complete",
        actor_id: w.memberS1.id,
        assignee_id: w.memberD1.id,
        assignee_name: NAME_D1,
        created_at: CASEREQ_NOW,
      }),
    ]);
  });

  it("#149 AC-1 5-4 AC-11: 完了の記録の担当名は、担当した時点ではなく完了の時点の表示名", async () => {
    await seedOpenTodo(1, { recordedAssigneeName: "テスト旧名149" });
    await setDisplayName(w.memberD1.id, "テスト新名149");
    await complete({ todoId: todoIdAt(1), eventId: eventIdAt(1) });
    expect((await todoRow(todoIdAt(1))).completed_assignee_name).toBe(
      "テスト新名149",
    );
    expect((await todoEventsOf(todoIdAt(1)))[0]?.assignee_name).toBe(
      "テスト新名149",
    );
  });

  it("#149 AC-1 5-4 AC-3: 担当なしの TODO も完了にでき、完了の担当は NULL", async () => {
    await seedOpenTodo(1, { assigneeId: null, recordedAssigneeName: null });
    await complete({ todoId: todoIdAt(1), eventId: eventIdAt(1) });
    expect(await todoRow(todoIdAt(1))).toMatchObject({
      is_done: 1,
      completed_assignee_id: null,
      completed_assignee_name: null,
    });
    expect((await todoEventsOf(todoIdAt(1)))[0]).toMatchObject({
      kind: "complete",
      assignee_id: null,
      assignee_name: null,
    });
  });

  it("#149 AC-1 5-4 AC-8・AC-11: 取り消しで未完了・版+1・完了の担当を NULL に戻し、記録 uncomplete を足す。完了の記録は残り、再完了は新しい記録（2件目）", async () => {
    await seedOpenTodo(1);
    await complete({ todoId: todoIdAt(1), eventId: eventIdAt(1) });
    await uncomplete({
      actorId: w.memberD1.id,
      todoId: todoIdAt(1),
      eventId: eventIdAt(3),
      autoUnassignEventId: eventIdAt(2),
    });
    expect(await todoRow(todoIdAt(1))).toMatchObject({
      is_done: 0,
      version: 3,
      assignee_id: w.memberD1.id,
      recorded_assignee_name: NAME_D1,
      completed_assignee_id: null,
      completed_assignee_name: null,
    });
    await complete({ todoId: todoIdAt(1), eventId: eventIdAt(4) });
    const events = await todoEventsOf(todoIdAt(1));
    expect(events.map((e) => [e.id, e.kind, e.actor_id])).toEqual([
      [eventIdAt(1), "complete", w.memberS1.id],
      [eventIdAt(3), "uncomplete", w.memberD1.id],
      [eventIdAt(4), "complete", w.memberS1.id],
    ]);
    // 担当者が有効な参加者のままなので、auto_unassign は記録しない
    expect(events.some((e) => e.kind === "auto_unassign")).toBe(false);
    expect((await todoRow(todoIdAt(1))).version).toBe(4);
  });

  it("#149 AC-1 決定 Q3（DB の層）: すでに完了の TODO の完了、未完了の TODO の取り消しは、前提が崩れて何も残さない", async () => {
    await seedOpenTodo(1, {
      isDone: true,
      completedAssigneeId: w.memberD1.id,
      completedAssigneeName: NAME_D1,
    });
    await seedOpenTodo(2);
    await expectNothingChanged(() =>
      complete({ todoId: todoIdAt(1), eventId: eventIdAt(1) }),
    );
    await expectNothingChanged(() =>
      uncomplete({
        todoId: todoIdAt(2),
        eventId: eventIdAt(3),
        autoUnassignEventId: eventIdAt(2),
      }),
    );
  });

  it("#149 AC-1 security: ほかの案件の TODO・いない TODO・削除済みの TODO は、完了・取り消しできない（何も残さない）", async () => {
    await insertTodo({
      id: todoIdAt(5),
      caseId: other.id,
      title: "[UNIT_TEST]149A別案件の項目",
      createdBy: w.memberS2.id,
    });
    await seedOpenTodo(6, { deletedBy: w.memberS1.id });
    await expectNothingChanged(() =>
      complete({ caseId: room.id, todoId: todoIdAt(5), eventId: eventIdAt(1) }),
    );
    await expectNothingChanged(() =>
      complete({ todoId: todoIdAt(7), eventId: eventIdAt(2) }),
    );
    await expectNothingChanged(() =>
      complete({ todoId: todoIdAt(6), eventId: eventIdAt(3) }),
    );
    await seedOpenTodo(8, {
      isDone: true,
      deletedBy: w.memberS1.id,
      completedAssigneeId: w.memberD1.id,
      completedAssigneeName: NAME_D1,
    });
    await expectNothingChanged(() =>
      uncomplete({
        todoId: todoIdAt(8),
        eventId: eventIdAt(5),
        autoUnassignEventId: eventIdAt(4),
      }),
    );
  });
});

describe("#149 AC-1 計画 6.9(2) 完了の取り消しのときの担当者の資格", () => {
  async function completedByD1() {
    await seedOpenTodo(1);
    await complete({ todoId: todoIdAt(1), eventId: eventIdAt(1) });
  }

  it.each([
    ["参加者から削除", () => removeCaseMember(room.roomId, w.memberD1.id)],
    ["無効化（参加の行は残る）", () => setUserActive(w.memberD1.id, false)],
  ])(
    "#149 AC-1 5-4 AC-6: 完了 → 担当者を%s → 取り消しで、現在の担当は NULL、保存した名前と完了の記録は残り、記録 auto_unassign（変更した人＝取り消した人）が1件、uncomplete より前",
    async (_label, detach) => {
      await completedByD1();
      await detach();
      await uncomplete({
        actorId: w.memberS1.id,
        todoId: todoIdAt(1),
        eventId: eventIdAt(3),
        autoUnassignEventId: eventIdAt(2),
      });
      expect(await todoRow(todoIdAt(1))).toMatchObject({
        is_done: 0,
        assignee_id: null,
        recorded_assignee_id: w.memberD1.id,
        recorded_assignee_name: NAME_D1,
        completed_assignee_id: null,
      });
      const events = await todoEventsOf(todoIdAt(1));
      expect(events.map((e) => [e.id, e.kind, e.actor_id])).toEqual([
        [eventIdAt(1), "complete", w.memberS1.id],
        [eventIdAt(2), "auto_unassign", w.memberS1.id],
        [eventIdAt(3), "uncomplete", w.memberS1.id],
      ]);
      // 外れた担当（計画 6.1：assignee_id・assignee_name に外れた担当を入れる）
      expect(events[1]).toMatchObject({
        assignee_id: w.memberD1.id,
        assignee_name: NAME_D1,
      });
      // 完了の記録は書き換えない
      expect(events[0]).toMatchObject({
        assignee_id: w.memberD1.id,
        assignee_name: NAME_D1,
      });
    },
  );

  it("#149 AC-1 5-4 AC-6: 担当者が有効な参加者のままなら、取り消しの後も担当は残り、auto_unassign の ID は使われない", async () => {
    await completedByD1();
    await uncomplete({
      todoId: todoIdAt(1),
      eventId: eventIdAt(3),
      autoUnassignEventId: eventIdAt(2),
    });
    expect((await todoRow(todoIdAt(1))).assignee_id).toBe(w.memberD1.id);
    expect((await todoEventsOf(todoIdAt(1))).map((e) => e.id)).toEqual([
      eventIdAt(1),
      eventIdAt(3),
    ]);
  });
});

describe("#149 AC-1 計画 6.10 必須の行が0行なら batch 全体を取り消す（ID の順の逆転を強制する）", () => {
  it("#149 AC-1 計画 6.9(3)・6.10: 追加：同じ案件に、より大きい ID の TODO があれば、TODO も記録も案件の版も残らない", async () => {
    await seedOpenTodo(1, { id: futureIdAt(1) });
    await expectNothingChanged(() =>
      add({ todoId: todoIdAt(2), eventId: eventIdAt(1) }),
    );
  });

  it("#149 AC-1 計画 6.9(3): 追加：ほかの案件の、より大きい ID の TODO は妨げない（条件は案件ごと）", async () => {
    await insertTodo({
      id: futureIdAt(1),
      caseId: other.id,
      title: "[UNIT_TEST]149A別案件の項目",
      createdBy: w.memberS2.id,
    });
    await add({ todoId: todoIdAt(2), eventId: eventIdAt(1) });
    expect((await todoRowsOf(room.id)).map((r) => r.id)).toEqual([todoIdAt(2)]);
  });

  it("#149 AC-1 計画 6.10: 完了：同じ TODO に、より大きい ID の記録があれば、完了・版・記録・案件の版のどれも変わらない", async () => {
    await seedOpenTodo(1);
    await insertTodoEvent({
      id: futureIdAt(1),
      todoId: todoIdAt(1),
      caseId: room.id,
      kind: "create",
      actorId: w.memberS1.id,
    });
    await expectNothingChanged(() =>
      complete({ todoId: todoIdAt(1), eventId: eventIdAt(1) }),
    );
  });

  it("#149 AC-1 計画 6.10: 完了：ほかの TODO の、より大きい ID の記録は妨げない（条件は TODO ごと）", async () => {
    await seedOpenTodo(1);
    await seedOpenTodo(2);
    await insertTodoEvent({
      id: futureIdAt(1),
      todoId: todoIdAt(2),
      caseId: room.id,
      kind: "create",
      actorId: w.memberS1.id,
    });
    await complete({ todoId: todoIdAt(1), eventId: eventIdAt(1) });
    expect((await todoRow(todoIdAt(1))).is_done).toBe(1);
  });

  it("#149 AC-1 計画 6.10: 取り消し（記録1件）：同じ TODO に、より大きい ID の記録があれば、何も変わらない", async () => {
    await seedOpenTodo(1);
    await complete({ todoId: todoIdAt(1), eventId: eventIdAt(1) });
    await insertTodoEvent({
      id: futureIdAt(1),
      todoId: todoIdAt(1),
      caseId: room.id,
      kind: "create",
      actorId: w.memberS1.id,
    });
    await expectNothingChanged(() =>
      uncomplete({
        todoId: todoIdAt(1),
        eventId: eventIdAt(3),
        autoUnassignEventId: eventIdAt(2),
      }),
    );
  });

  it("#149 AC-1 計画 6.10: 取り消し（auto_unassign を含む2件）：より大きい ID の記録があれば、担当・完了・記録のどれも変わらない", async () => {
    await seedOpenTodo(1);
    await complete({ todoId: todoIdAt(1), eventId: eventIdAt(1) });
    await removeCaseMember(room.roomId, w.memberD1.id);
    await insertTodoEvent({
      id: futureIdAt(1),
      todoId: todoIdAt(1),
      caseId: room.id,
      kind: "create",
      actorId: w.memberS1.id,
    });
    await expectNothingChanged(() =>
      uncomplete({
        todoId: todoIdAt(1),
        eventId: eventIdAt(3),
        autoUnassignEventId: eventIdAt(2),
      }),
    );
  });

  it("#149 AC-1 計画 6.10: 取り消し（2件）：uncomplete の ID が auto_unassign の ID 以下なら、auto_unassign だけが残ることはなく、全体が取り消される", async () => {
    await seedOpenTodo(1);
    await complete({ todoId: todoIdAt(1), eventId: eventIdAt(1) });
    await removeCaseMember(room.roomId, w.memberD1.id);
    await expectNothingChanged(() =>
      uncomplete({
        todoId: todoIdAt(1),
        eventId: eventIdAt(2),
        autoUnassignEventId: eventIdAt(3),
      }),
    );
  });
});

describe("#149 AC-1 決定 Q2 監査ログ", () => {
  it("#149 AC-1 決定 Q2: 追加・完了・取り消しの後に、監査ログ（audit_logs）の行が増えない", async () => {
    const before = await auditLogCount();
    await add({
      todoId: todoIdAt(1),
      eventId: eventIdAt(1),
      assigneeId: w.memberD1.id,
    });
    await complete({ todoId: todoIdAt(1), eventId: eventIdAt(2) });
    await removeCaseMember(room.roomId, w.memberD1.id);
    await uncomplete({
      todoId: todoIdAt(1),
      eventId: eventIdAt(4),
      autoUnassignEventId: eventIdAt(3),
    });
    expect(await auditLogCount()).toBe(before);
  });
});

describe("#149 AC-1 計画 7章 同時の操作（D1 の直列）", () => {
  it("#149 AC-1 計画 7章: 同じ TODO の完了を2つ同時に送ると、1つだけが完了し、記録は1件、版は+1だけ", async () => {
    await seedOpenTodo(1);
    const results = await Promise.allSettled([
      complete({ todoId: todoIdAt(1), eventId: eventIdAt(1) }),
      complete({
        actorId: w.memberD1.id,
        todoId: todoIdAt(1),
        eventId: eventIdAt(2),
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      CaseStateChangedError,
    );
    expect(await todoRow(todoIdAt(1))).toMatchObject({
      is_done: 1,
      version: 2,
    });
    expect(
      (await todoEventsOf(todoIdAt(1))).filter((e) => e.kind === "complete"),
    ).toHaveLength(1);
  });

  it("#149 AC-1 計画 7章: 担当者つきの追加と、その担当者の参加者からの削除を同時に送ると、TODO と記録は両方あるか両方ないか（片方だけは残らない）", async () => {
    const results = await Promise.allSettled([
      add({
        todoId: todoIdAt(1),
        eventId: eventIdAt(1),
        assigneeId: w.memberD1.id,
      }),
      removeCaseMember(room.roomId, w.memberD1.id),
    ]);
    const todos = await todoRowsOf(room.id);
    const events = await todoEventsOf(todoIdAt(1));
    if (results[0].status === "fulfilled") {
      expect(todos.map((t) => t.assignee_id)).toEqual([w.memberD1.id]);
      expect(events.map((e) => e.kind)).toEqual(["create"]);
    } else {
      expect(results[0].reason).toBeInstanceOf(CaseStateChangedError);
      expect(todos).toEqual([]);
      expect(events).toEqual([]);
    }
  });
});

describe("#149 AC-1 5-4 AC-1・AC-4 決定 Q4 一覧と進捗", () => {
  it("#149 AC-1 5-4 AC-1 決定 Q4: 一覧は追加した順（ID 昇順）。完了にしても位置は変わらず、削除済みは出ない", async () => {
    await seedOpenTodo(3);
    await seedOpenTodo(1);
    await seedOpenTodo(2, { deletedBy: w.memberS1.id });
    await seedOpenTodo(4);
    await complete({ todoId: todoIdAt(1), eventId: eventIdAt(1) });
    const page = await listOk(w.memberS1.id);
    expect(page.items.map((i) => [i.id, i.completed])).toEqual([
      [todoIdAt(1), true],
      [todoIdAt(3), false],
      [todoIdAt(4), false],
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it("#149 AC-1 5-4 AC-1: 項目は題名・担当・完了か・版を持つ", async () => {
    await seedOpenTodo(1);
    const [item] = (await listOk(w.memberS1.id)).items;
    expect(item).toEqual({
      id: todoIdAt(1),
      title: "[UNIT_TEST]149A項目1",
      completed: false,
      version: 1,
      assignee: { userId: w.memberD1.id, displayName: NAME_D1, isActive: true },
      previousAssignee: null,
      completedAssignee: null,
    });
  });

  it("#149 AC-1 決定 Q4: ページ送り（limit 件ずつ。続きがあれば nextCursor、最後は null）で、重なりも抜けもない", async () => {
    for (const n of [1, 2, 3, 4, 5]) await seedOpenTodo(n);
    const first = await listOk(w.memberS1.id, { limit: 2 });
    expect(first.items.map((i) => i.id)).toEqual([todoIdAt(1), todoIdAt(2)]);
    expect(first.nextCursor).not.toBeNull();
    const second = await listOk(w.memberS1.id, {
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.items.map((i) => i.id)).toEqual([todoIdAt(3), todoIdAt(4)]);
    const third = await listOk(w.memberS1.id, {
      limit: 2,
      cursor: second.nextCursor,
    });
    expect(third.items.map((i) => i.id)).toEqual([todoIdAt(5)]);
    expect(third.nextCursor).toBeNull();
  });

  it("#149 AC-1 決定 Q4: ちょうど limit 件なら nextCursor は null（limit＋1 件を読んで続きを決める）", async () => {
    for (const n of [1, 2]) await seedOpenTodo(n);
    const page = await listOk(w.memberS1.id, { limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it("#149 AC-1 決定 Q4・D1 の上限: 150件の案件でも、1回100件と、全体から数えた進捗（150件）を返す", async () => {
    const statements = Array.from({ length: 150 }, (_, i) =>
      env.DB.prepare(
        `INSERT INTO case_todos (id, case_id, title, is_done, version, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
      ).bind(
        todoIdAt(100 + i),
        room.id,
        `[UNIT_TEST]149A多数${i}`,
        i % 3 === 0 ? 1 : 0,
        w.memberS1.id,
        CASEREQ_NOW,
        CASEREQ_NOW,
      ),
    );
    await env.DB.batch(statements);
    const first = await listOk(w.memberS1.id, { limit: 100 });
    expect(first.items).toHaveLength(100);
    expect(first.progress).toEqual({ done: 50, total: 150 });
    const second = await listOk(w.memberS1.id, {
      limit: 100,
      cursor: first.nextCursor,
    });
    expect(second.items).toHaveLength(50);
    expect(second.nextCursor).toBeNull();
    expect(second.progress).toEqual({ done: 50, total: 150 });
  });

  it("#149 AC-1 5-4 AC-4: 0件なら進捗は null（「項目なし」）", async () => {
    const page = await listOk(w.memberS1.id);
    expect(page.items).toEqual([]);
    expect(page.progress).toBeNull();
  });

  it("#149 AC-1 5-4 AC-4（C-84）・#294: 進捗は削除済みを分母・分子に入れず、ほかの案件の TODO を数えない", async () => {
    await seedOpenTodo(1, {
      isDone: true,
      completedAssigneeId: w.memberD1.id,
      completedAssigneeName: NAME_D1,
    });
    await seedOpenTodo(2);
    await seedOpenTodo(3);
    // 削除済み（完了・未完了）
    await seedOpenTodo(4, {
      isDone: true,
      deletedBy: w.memberS1.id,
      completedAssigneeId: w.memberD1.id,
      completedAssigneeName: NAME_D1,
    });
    await seedOpenTodo(5, { deletedBy: w.memberS1.id });
    // ほかの案件
    for (const n of [6, 7])
      await insertTodo({
        id: todoIdAt(n),
        caseId: other.id,
        title: `[UNIT_TEST]149A別案件${n}`,
        createdBy: w.memberS2.id,
        isDone: true,
      });
    expect((await listOk(w.memberS1.id)).progress).toEqual({
      done: 1,
      total: 3,
    });
    expect(
      (await listOk(w.memberS1.id, { caseId: other.id })).progress,
    ).toEqual({ done: 2, total: 2 });
  });

  it("#149 AC-1 5-4 AC-4: 削除済みだけの案件は、進捗が null", async () => {
    await seedOpenTodo(1, { deletedBy: w.memberS1.id });
    const page = await listOk(w.memberS1.id);
    expect(page.items).toEqual([]);
    expect(page.progress).toBeNull();
  });
});

describe("#149 AC-1 R-76 読み取りの資格", () => {
  it.each([
    ["非参加の一般社員", () => w.memberS2.id],
    ["無効な参加者（参加の行は残る）", () => w.inactive.id],
    ["非参加の全体管理者", () => w.admin.id],
    ["非参加の担当部署のオーナー", () => w.ownerS.id],
  ])(
    "#149 AC-1 R-76: 閲覧者が %s なら not_visible で、項目も進捗も返さない",
    async (_label, viewer) => {
      await seedOpenTodo(1);
      expect(await list(viewer())).toBe("not_visible");
    },
  );

  it("#149 AC-1 R-76: 案件がなければ not_found", async () => {
    expect(await list(w.memberS1.id, { caseId: futureIdAt(98) })).toBe(
      "not_found",
    );
  });

  it.each([
    ["参加者から外された", () => removeCaseMember(room.roomId, w.memberS1.id)],
    ["無効になった", () => setUserActive(w.memberS1.id, false)],
  ])(
    "#149 AC-1 R-76: 閲覧者が %s 後の読み取りは not_visible（前の項目を返さない）",
    async (_label, lose) => {
      await seedOpenTodo(1);
      expect((await listOk(w.memberS1.id)).items).toHaveLength(1);
      await lose();
      expect(await list(w.memberS1.id)).toBe("not_visible");
    },
  );
});

describe("#149 AC-1 5-4 AC-6 計画 6.9(1) 担当の名前の出し分け", () => {
  it("#149 AC-1 5-4 AC-6: 未完了で現在の担当が有効なら、いまの表示名（担当した後の改名を反映）", async () => {
    await seedOpenTodo(1, { recordedAssigneeName: "テスト旧名149" });
    await setDisplayName(w.memberD1.id, "テスト新名149");
    const [item] = (await listOk(w.memberS1.id)).items;
    expect(item?.assignee).toEqual({
      userId: w.memberD1.id,
      displayName: "テスト新名149",
      isActive: true,
    });
    expect(item?.previousAssignee).toBeNull();
  });

  it("#149 AC-1 5-4 AC-6・C-74: 未完了で現在の担当が無効なら、担当した時点の保存した名前と isActive: false", async () => {
    await seedOpenTodo(1, {
      assigneeId: w.inactive.id,
      recordedAssigneeName: "テスト退職前149",
    });
    await setDisplayName(w.inactive.id, "テスト退職後149");
    const [item] = (await listOk(w.memberS1.id)).items;
    expect(item?.assignee).toEqual({
      userId: w.inactive.id,
      displayName: "テスト退職前149",
      isActive: false,
    });
  });

  it("#149 AC-1 5-4 AC-6: 現在の担当なしで保存した担当があれば、assignee は null、previousAssignee に保存した名前（本人が無効なら isActive: false）", async () => {
    await seedOpenTodo(1, {
      assigneeId: null,
      recordedAssigneeId: w.memberD1.id,
      recordedAssigneeName: "テスト以前の担当149",
    });
    await setUserActive(w.memberD1.id, false);
    const [item] = (await listOk(w.memberS1.id)).items;
    expect(item?.assignee).toBeNull();
    expect(item?.previousAssignee).toEqual({
      userId: w.memberD1.id,
      displayName: "テスト以前の担当149",
      isActive: false,
    });
  });

  it("#149 AC-1 5-4 AC-6・AC-11: 完了 → 担当者の改名 → 無効化の後も、completedAssignee は完了の時の名前と isActive: false", async () => {
    await seedOpenTodo(1);
    await complete({ todoId: todoIdAt(1), eventId: eventIdAt(1) });
    await setDisplayName(w.memberD1.id, "テスト改名後149");
    await setUserActive(w.memberD1.id, false);
    const [item] = (await listOk(w.memberS1.id)).items;
    expect(item?.completed).toBe(true);
    expect(item?.completedAssignee).toEqual({
      userId: w.memberD1.id,
      displayName: NAME_D1,
      isActive: false,
    });
  });

  it("#149 AC-1 5-4 AC-6: 完了で担当者が有効なら、completedAssignee は完了の時の名前と isActive: true", async () => {
    await seedOpenTodo(1);
    await complete({ todoId: todoIdAt(1), eventId: eventIdAt(1) });
    const [item] = (await listOk(w.memberS1.id)).items;
    expect(item?.completedAssignee).toEqual({
      userId: w.memberD1.id,
      displayName: NAME_D1,
      isActive: true,
    });
  });

  it("#149 AC-1 5-4 AC-6: 未完了なら completedAssignee は null", async () => {
    await seedOpenTodo(1);
    const [item] = (await listOk(w.memberS1.id)).items;
    expect(item?.completedAssignee).toBeNull();
  });
});
