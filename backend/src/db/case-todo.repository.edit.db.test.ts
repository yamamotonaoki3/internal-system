// #149（149-B）5-4 AC-6・AC-8・AC-9・AC-10・AC-11・AC-12、決定 Q1・Q2・Q3、計画 6.1・6.2.3・6.2.4・10節 #13〜#21・#25：
// TODO の編集・削除の Repository（case-todo.repository.ts の editTodo・deleteTodo）を、マイグレーション済みの D1 で確かめる。
// この層で確かめるもの：
//   書き込みの結果（行・版・updated_at・記録の中身と順）。前提（進行中・操作者が有効な参加者・TODO がその案件の未削除・版が一致・
//   担当を変えるなら未完了・新しい担当が有効な参加者）を1つずつ崩すと、何も残らない（TODO・記録・案件の版・参加・監査ログの件数）。
//   記録の ID（計画 6.1・重大3）：case_todo_events の「全体」に、渡した最初の ID 以上の ID があれば batch 全体を取り消す（別の TODO の記録でも）。
//   Service を通す側（作り直して成功・149-A の完了・取り消し）は、層のルールのため services/case-todo.edit.event-id.db.test.ts に置く。
//   監査ログ（audit_logs）は増えない（決定 Q2）。
// 判定の順・応答コードは routes/case-todos.edit.test.ts、割り込みは services/case-todo.edit.interleave.test.ts で確かめ、ここでは重ねない。
// 契約（実装前の仮置き。実装の担当へ）：backend/src/db/case-todo.repository.ts
//   repository.editTodo({ caseId, actorId, todoId, version, eventIds, title?, assignee? }): Promise<{ item: TodoItem; progress: TodoProgress }>
//     version は画面が送った版（前提に t.version = version）。eventIds は昇順の ID の列で、作る記録の数だけ前から使う
//     （題名を変えるなら title_change が先、担当を変えるなら assignee_change が後）。title は整形の後の値。assignee は { id: string | null }。
//     undefined の項目は変えない（Service が、いまの値と違う項目だけを渡す）。
//   repository.deleteTodo({ caseId, actorId, todoId, eventId }): Promise<unknown>
//   前提・確認が崩れたら CaseStateChangedError（case.repository.ts）を投げ、batch 全体が取り消される。
// 世界の対応（計画 10節の前提のデータ）：A＝memberS1・B＝memberD1・C＝ownerD（有効な参加者）・D＝inactive（無効・参加の行あり）。
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
  todoSnapshot,
} from "../../test/case-todo-fixtures";
import { withCaseTodos } from "./case-todo.repository";
import { CaseStateChangedError } from "./case.repository";

const NAME_A = "テスト操作者149B";
const NAME_B = "テスト担当149B";
const NAME_C = "テスト別担当149B";
const T1_TITLE = "[UNIT_TEST]149B見積書の作成";
const LATER = "2026-11-20T03:00:00.000Z";

let w: CaseWorld;
/** K：進行中。A・B・C・D（無効）が参加 */
let room: SeededCase;
/** 進行中の別の案件（ほかの案件の記録が ID の条件に効くことを確かめる） */
let other: SeededCase;

type EditInput = {
  caseId?: string;
  actorId?: string;
  todoId?: string;
  version?: number;
  eventIds?: string[];
  title?: string;
  assignee?: { id: string | null };
};

const edit = (input: EditInput) =>
  withCaseTodos(env, (r) =>
    r.editTodo({
      caseId: input.caseId ?? room.id,
      actorId: input.actorId ?? w.memberS1.id,
      todoId: input.todoId ?? todoIdAt(1),
      version: input.version ?? 1,
      eventIds: input.eventIds ?? [eventIdAt(1), eventIdAt(2)],
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.assignee === undefined ? {} : { assignee: input.assignee }),
    }),
  );

const remove = (
  input: {
    caseId?: string;
    actorId?: string;
    todoId?: string;
    eventId?: string;
  } = {},
) =>
  withCaseTodos(env, (r) =>
    r.deleteTodo({
      caseId: input.caseId ?? room.id,
      actorId: input.actorId ?? w.memberS1.id,
      todoId: input.todoId ?? todoIdAt(1),
      eventId: input.eventId ?? eventIdAt(1),
    }),
  );

/** 失敗が CaseStateChangedError で、何も変わっていないこと（TODO・記録・案件の版・参加・監査ログの件数） */
async function expectNothingChanged(run: () => Promise<unknown>) {
  const before = await todoSnapshot();
  await expect(run()).rejects.toBeInstanceOf(CaseStateChangedError);
  expect(await todoSnapshot()).toEqual(before);
}

/** T1：未完了・担当 B・版1。T2：完了・完了時の担当 B・版2 */
async function seedTodos() {
  await insertTodo({
    id: todoIdAt(1),
    caseId: room.id,
    title: T1_TITLE,
    createdBy: w.memberS1.id,
    assigneeId: w.memberD1.id,
    recordedAssigneeName: NAME_B,
  });
  await insertTodo({
    id: todoIdAt(2),
    caseId: room.id,
    title: "[UNIT_TEST]149B完了済み",
    createdBy: w.memberS1.id,
    assigneeId: w.memberD1.id,
    recordedAssigneeName: NAME_B,
    isDone: true,
    completedAssigneeId: w.memberD1.id,
    completedAssigneeName: NAME_B,
    version: 2,
  });
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(CASEREQ_NOW));
  w = await setupCaseWorld();
  await setDisplayName(w.memberS1.id, NAME_A);
  await setDisplayName(w.memberD1.id, NAME_B);
  await setDisplayName(w.ownerD.id, NAME_C);
  room = await seedCase({
    n: 1504,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]149B編集",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
      { userId: w.ownerD.id, joinedAt: joinedAt(3) },
      { userId: w.inactive.id, joinedAt: joinedAt(4) },
    ],
  });
  other = await seedCase({
    n: 1505,
    clientId: w.clientB.id,
    code: "QZB",
    title: "[UNIT_TEST]149B別の案件",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [{ userId: w.memberS1.id, joinedAt: joinedAt(1) }],
  });
  await seedTodos();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupCaseTestData();
});

describe("#149 AC-1 5-4 AC-8・AC-10 編集の書き込みの結果（計画 10節 #13〜#17）", () => {
  it("#149 AC-1 5-4 AC-8・AC-10 計画 10節 #13: 題名だけ変えると、題名・版2・updated_at が変わり、記録 title_change が1件（新旧の題名・操作した人。担当の列は NULL）", async () => {
    vi.setSystemTime(new Date(LATER));
    const result = await edit({ title: "[UNIT_TEST]149B改題" });
    expect(await todoRow(todoIdAt(1))).toMatchObject({
      title: "[UNIT_TEST]149B改題",
      version: 2,
      updated_at: LATER,
      assignee_id: w.memberD1.id,
      recorded_assignee_id: w.memberD1.id,
      recorded_assignee_name: NAME_B,
    });
    expect(await todoEventsOf(todoIdAt(1))).toEqual([
      {
        id: eventIdAt(1),
        todo_id: todoIdAt(1),
        case_id: room.id,
        kind: "title_change",
        actor_id: w.memberS1.id,
        title: "[UNIT_TEST]149B改題",
        previous_title: T1_TITLE,
        assignee_id: null,
        assignee_name: null,
        previous_assignee_id: null,
        previous_assignee_name: null,
        created_at: LATER,
      },
    ]);
    expect(result).toMatchObject({
      item: { id: todoIdAt(1), title: "[UNIT_TEST]149B改題", version: 2 },
      progress: { done: 1, total: 2 },
    });
  });

  it("#149 AC-1 5-4 AC-6・AC-10 計画 10節 #14: 担当だけ B → C にすると、現在・保存した担当が C といまの名前。記録 assignee_change が1件（後＝C と名前、前＝B と B のいまの名前）", async () => {
    // B の名前は、担当した時点（NAME_B）から変わっている。記録の「前」は、記録の時点の名前（C-74）
    await setDisplayName(w.memberD1.id, "テスト担当149B改名");
    await edit({ assignee: { id: w.ownerD.id } });
    expect(await todoRow(todoIdAt(1))).toMatchObject({
      title: T1_TITLE,
      assignee_id: w.ownerD.id,
      recorded_assignee_id: w.ownerD.id,
      recorded_assignee_name: NAME_C,
      version: 2,
    });
    expect(await todoEventsOf(todoIdAt(1))).toEqual([
      expect.objectContaining({
        id: eventIdAt(1),
        kind: "assignee_change",
        actor_id: w.memberS1.id,
        title: null,
        previous_title: null,
        assignee_id: w.ownerD.id,
        assignee_name: NAME_C,
        previous_assignee_id: w.memberD1.id,
        previous_assignee_name: "テスト担当149B改名",
      }),
    ]);
  });

  it("#149 AC-1 5-4 AC-10 計画 10節 #15: 題名と担当を同時に変えると、記録が2件で title_change の ID ＜ assignee_change の ID。版は1回だけ増える", async () => {
    await edit({
      title: "[UNIT_TEST]149B同時の改題",
      assignee: { id: w.ownerD.id },
      eventIds: [eventIdAt(5), eventIdAt(6)],
    });
    const events = await todoEventsOf(todoIdAt(1));
    expect(events.map((e) => [e.id, e.kind])).toEqual([
      [eventIdAt(5), "title_change"],
      [eventIdAt(6), "assignee_change"],
    ]);
    expect((await todoRow(todoIdAt(1))).version).toBe(2);
  });

  it("#149 AC-1 決定 Q3 計画 10節 #16: 担当を B → なしにすると、現在・保存した担当の ID と名前がすべて NULL。一覧で assignee も previousAssignee も null。記録 assignee_change（後＝NULL、前＝B）", async () => {
    await edit({ assignee: { id: null } });
    expect(await todoRow(todoIdAt(1))).toMatchObject({
      assignee_id: null,
      recorded_assignee_id: null,
      recorded_assignee_name: null,
      version: 2,
    });
    expect(await todoEventsOf(todoIdAt(1))).toEqual([
      expect.objectContaining({
        kind: "assignee_change",
        assignee_id: null,
        assignee_name: null,
        previous_assignee_id: w.memberD1.id,
        previous_assignee_name: NAME_B,
      }),
    ]);
    const page = await withCaseTodos(env, (r) =>
      r.listTodos({
        caseId: room.id,
        viewerId: w.memberS1.id,
        limit: 100,
        cursor: null,
      }),
    );
    if (typeof page === "string") throw new Error(`一覧が ${page}`);
    expect(page.items.find((item) => item.id === todoIdAt(1))).toMatchObject({
      assignee: null,
      previousAssignee: null,
    });
  });

  it("#149 AC-1 計画 10節 #17: 担当なしの TODO を C にすると、記録の previous_assignee_* が NULL", async () => {
    await insertTodo({
      id: todoIdAt(3),
      caseId: room.id,
      title: "[UNIT_TEST]149B担当なし",
      createdBy: w.memberS1.id,
    });
    await edit({ todoId: todoIdAt(3), assignee: { id: w.ownerD.id } });
    expect(await todoEventsOf(todoIdAt(3))).toEqual([
      expect.objectContaining({
        kind: "assignee_change",
        assignee_id: w.ownerD.id,
        assignee_name: NAME_C,
        previous_assignee_id: null,
        previous_assignee_name: null,
      }),
    ]);
  });

  it("#149 AC-1 決定 Q1 5-4 AC-11: 完了済みの T2 の題名だけを変えると、担当・完了の時の担当と名前は変わらない", async () => {
    await edit({
      todoId: todoIdAt(2),
      version: 2,
      title: "[UNIT_TEST]149B完了済みの改題",
    });
    expect(await todoRow(todoIdAt(2))).toMatchObject({
      title: "[UNIT_TEST]149B完了済みの改題",
      is_done: 1,
      assignee_id: w.memberD1.id,
      completed_assignee_id: w.memberD1.id,
      completed_assignee_name: NAME_B,
      version: 3,
    });
  });

  it("#149 AC-1 security: 編集しても、ほかの TODO の行と記録は変わらない", async () => {
    const before = await todoRow(todoIdAt(2));
    await edit({ title: "[UNIT_TEST]149B改題", assignee: { id: w.ownerD.id } });
    expect(await todoRow(todoIdAt(2))).toEqual(before);
    expect(await todoEventsOf(todoIdAt(2))).toEqual([]);
  });
});

describe("#149 AC-1 計画 10節 #18 編集の前提を1つずつ崩すと、何も残らない", () => {
  it.each([
    ["案件が終了している", () => setCaseStatus(room.id, "closed")],
    [
      "操作者 A が参加者から外れている",
      () => removeCaseMember(room.roomId, w.memberS1.id),
    ],
    ["操作者 A が無効になっている", () => setUserActive(w.memberS1.id, false)],
    [
      "版が進んでいる",
      async () => {
        await env.DB.prepare("UPDATE case_todos SET version = 2 WHERE id = ?")
          .bind(todoIdAt(1))
          .run();
      },
    ],
    [
      "T1 が削除済み",
      async () => {
        await env.DB.prepare(
          "UPDATE case_todos SET deleted_at = ?, deleted_by = ? WHERE id = ?",
        )
          .bind(CASEREQ_NOW, w.memberS1.id, todoIdAt(1))
          .run();
      },
    ],
    [
      "新しい担当 C が参加者から外れている",
      () => removeCaseMember(room.roomId, w.ownerD.id),
    ],
    [
      "新しい担当 C が無効になっている",
      () => setUserActive(w.ownerD.id, false),
    ],
    [
      "T1 が完了済みで、担当を変えようとしている（決定 Q1）",
      async () => {
        await env.DB.prepare(
          "UPDATE case_todos SET is_done = 1, completed_assignee_id = assignee_id, completed_assignee_name = recorded_assignee_name WHERE id = ?",
        )
          .bind(todoIdAt(1))
          .run();
      },
    ],
  ])(
    "#149 AC-1 計画 10節 #18: %s なら、題名と担当の編集は CaseStateChangedError で、行・版・記録・案件の版・監査ログが前のまま",
    async (_l, breakIt) => {
      await breakIt();
      await expectNothingChanged(() =>
        edit({
          title: "[UNIT_TEST]149B崩れた前提",
          assignee: { id: w.ownerD.id },
        }),
      );
    },
  );

  it.each([
    ["案件が終了している", () => setCaseStatus(room.id, "closed")],
    [
      "操作者 A が参加者から外れている",
      () => removeCaseMember(room.roomId, w.memberS1.id),
    ],
    ["操作者 A が無効になっている", () => setUserActive(w.memberS1.id, false)],
  ])(
    "#149 AC-1 計画 10節 #18: %s なら、題名だけの編集も何も残さない",
    async (_l, breakIt) => {
      await breakIt();
      await expectNothingChanged(() =>
        edit({ title: "[UNIT_TEST]149B崩れた前提" }),
      );
    },
  );

  it.each([
    ["非参加の一般社員", () => w.memberS2.id],
    ["非参加の全体管理者（R-76）", () => w.admin.id],
    ["非参加の担当部署のオーナー（R-76）", () => w.ownerS.id],
    ["無効な参加者 D", () => w.inactive.id],
  ])(
    "#149 AC-1 R-76: 操作者が %s なら、編集は何も残さない",
    async (_l, actor) => {
      await expectNothingChanged(() =>
        edit({ actorId: actor(), title: "[UNIT_TEST]149B非参加" }),
      );
    },
  );

  it.each([
    ["無効な参加者 D", () => w.inactive.id],
    ["非参加の社員", () => w.memberS2.id],
  ])(
    "#149 AC-1 5-4 AC-6: 新しい担当が %s なら、何も残さない",
    async (_l, assignee) => {
      await expectNothingChanged(() => edit({ assignee: { id: assignee() } }));
    },
  );

  it("#149 AC-1 security: ほかの案件の ID を使って、この案件の TODO を編集できない（何も残さない）", async () => {
    await expectNothingChanged(() =>
      edit({ caseId: other.id, title: "[UNIT_TEST]149B別の案件から" }),
    );
  });

  it("#149 AC-1 決定 Q1: 完了済みの T2 の担当を「なし」にする編集も、何も残さない", async () => {
    await expectNothingChanged(() =>
      edit({ todoId: todoIdAt(2), version: 2, assignee: { id: null } }),
    );
  });
});

describe("#149 AC-1 計画 6.1・10節 #19 記録の ID は、記録の表の全体より大きいこと（重大3）", () => {
  it("#149 AC-1 計画 6.1: 別の TODO（T2）に、渡す最初の ID 以上の記録があれば、編集の batch 全体が取り消される", async () => {
    await insertTodoEvent({
      id: futureIdAt(1),
      todoId: todoIdAt(2),
      caseId: room.id,
      kind: "create",
      actorId: w.memberS1.id,
    });
    await expectNothingChanged(() =>
      edit({
        title: "[UNIT_TEST]149B逆転",
        eventIds: [eventIdAt(1), eventIdAt(2)],
      }),
    );
  });

  it("#149 AC-1 計画 6.1: ほかの案件の TODO の記録でも、渡す最初の ID 以上なら取り消される", async () => {
    await insertTodo({
      id: todoIdAt(9),
      caseId: other.id,
      title: "[UNIT_TEST]149B別の案件の項目",
      createdBy: w.memberS1.id,
    });
    await insertTodoEvent({
      id: futureIdAt(1),
      todoId: todoIdAt(9),
      caseId: other.id,
      kind: "create",
      actorId: w.memberS1.id,
    });
    await expectNothingChanged(() => edit({ title: "[UNIT_TEST]149B逆転" }));
  });

  it("#149 AC-1 計画 6.1: 渡す最初の ID と等しい ID の記録がほかの TODO にあっても（「以上」）取り消される", async () => {
    await insertTodoEvent({
      id: eventIdAt(1),
      todoId: todoIdAt(2),
      caseId: room.id,
      kind: "create",
      actorId: w.memberS1.id,
    });
    await expectNothingChanged(() => edit({ title: "[UNIT_TEST]149B等しい" }));
  });

  it("#149 AC-1 計画 6.1: 削除も、別の TODO に渡す ID 以上の記録があれば取り消される", async () => {
    await insertTodoEvent({
      id: futureIdAt(1),
      todoId: todoIdAt(2),
      caseId: room.id,
      kind: "create",
      actorId: w.memberS1.id,
    });
    await expectNothingChanged(() => remove());
  });
});

describe("#149 AC-1 計画 6.1 コードレビュー1回目（重大）追加の記録 create の ID も、記録の表の全体より大きいこと", () => {
  const add = (eventId: string) =>
    withCaseTodos(env, (r) =>
      r.addTodo({
        caseId: room.id,
        actorId: w.memberS1.id,
        todoId: todoIdAt(5),
        eventId,
        title: "[UNIT_TEST]149B追加",
        assigneeId: null,
      }),
    );

  it("#149 AC-1 計画 6.1: 追加の記録の ID が、別の TODO の記録の ID と等しいとき、主キーの違反（500）ではなく CaseStateChangedError で、何も残さない", async () => {
    await insertTodoEvent({
      id: eventIdAt(1),
      todoId: todoIdAt(2),
      caseId: room.id,
      kind: "create",
      actorId: w.memberS1.id,
    });
    await expectNothingChanged(() => add(eventIdAt(1)));
  });

  it("#149 AC-1 計画 6.1: 追加の記録の ID が、別の TODO の記録の ID より小さいとき、CaseStateChangedError で、何も残さない", async () => {
    await insertTodoEvent({
      id: futureIdAt(1),
      todoId: todoIdAt(2),
      caseId: room.id,
      kind: "create",
      actorId: w.memberS1.id,
    });
    await expectNothingChanged(() => add(eventIdAt(1)));
  });
});

describe("#149 AC-1 5-4 AC-8・AC-12 削除の書き込みの結果（計画 10節 #21・#25）", () => {
  it("#149 AC-1 5-4 AC-12 計画 10節 #21: 削除すると、deleted_at・deleted_by＝A・版+1・updated_at。記録 delete（題名＝その時点の題名）。担当・完了の列は変わらない", async () => {
    vi.setSystemTime(new Date(LATER));
    await remove({ todoId: todoIdAt(2), eventId: eventIdAt(3) });
    expect(await todoRow(todoIdAt(2))).toMatchObject({
      title: "[UNIT_TEST]149B完了済み",
      deleted_at: LATER,
      deleted_by: w.memberS1.id,
      version: 3,
      updated_at: LATER,
      is_done: 1,
      assignee_id: w.memberD1.id,
      recorded_assignee_id: w.memberD1.id,
      recorded_assignee_name: NAME_B,
      completed_assignee_id: w.memberD1.id,
      completed_assignee_name: NAME_B,
    });
    expect(await todoEventsOf(todoIdAt(2))).toEqual([
      {
        id: eventIdAt(3),
        todo_id: todoIdAt(2),
        case_id: room.id,
        kind: "delete",
        actor_id: w.memberS1.id,
        title: "[UNIT_TEST]149B完了済み",
        previous_title: null,
        assignee_id: null,
        assignee_name: null,
        previous_assignee_id: null,
        previous_assignee_name: null,
        created_at: LATER,
      },
    ]);
  });

  it("#149 AC-1 5-4 AC-4・AC-12: 削除した TODO は一覧・進捗から除かれる", async () => {
    await remove();
    const page = await withCaseTodos(env, (r) =>
      r.listTodos({
        caseId: room.id,
        viewerId: w.memberS1.id,
        limit: 100,
        cursor: null,
      }),
    );
    if (typeof page === "string") throw new Error(`一覧が ${page}`);
    expect(page.items.map((item) => item.id)).toEqual([todoIdAt(2)]);
    expect(page.progress).toEqual({ done: 1, total: 1 });
  });

  it.each([
    ["案件が終了している", () => setCaseStatus(room.id, "closed")],
    [
      "操作者 A が参加者から外れている",
      () => removeCaseMember(room.roomId, w.memberS1.id),
    ],
    ["操作者 A が無効になっている", () => setUserActive(w.memberS1.id, false)],
    [
      "T1 がすでに削除済み",
      async () => {
        await env.DB.prepare(
          "UPDATE case_todos SET deleted_at = ?, deleted_by = ? WHERE id = ?",
        )
          .bind(CASEREQ_NOW, w.memberD1.id, todoIdAt(1))
          .run();
      },
    ],
  ])(
    "#149 AC-1 計画 6.2.4: %s なら、削除は CaseStateChangedError で何も残さない",
    async (_l, breakIt) => {
      await breakIt();
      await expectNothingChanged(() => remove());
    },
  );

  it.each([
    ["非参加の全体管理者（R-76）", () => w.admin.id],
    ["非参加の一般社員", () => w.memberS2.id],
  ])(
    "#149 AC-1 R-76: 操作者が %s なら、削除は何も残さない",
    async (_l, actor) => {
      await expectNothingChanged(() => remove({ actorId: actor() }));
    },
  );

  it("#149 AC-1 security: ほかの案件の ID を使って、この案件の TODO を削除できない", async () => {
    await expectNothingChanged(() => remove({ caseId: other.id }));
  });

  it("#149 AC-1 計画 10節 #25（DB の層）: 同じ TODO の削除を2つ同時に送ると、1つだけが確定し、記録 delete は1件・版は+1だけ", async () => {
    const results = await Promise.allSettled([
      remove({ eventId: eventIdAt(1) }),
      remove({ actorId: w.memberD1.id, eventId: eventIdAt(2) }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      CaseStateChangedError,
    );
    expect(
      (await todoEventsOf(todoIdAt(1))).filter((e) => e.kind === "delete"),
    ).toHaveLength(1);
    expect((await todoRow(todoIdAt(1))).version).toBe(2);
  });
});

describe("#149 AC-1 決定 Q2 計画 10節 #20 監査ログ", () => {
  it("#149 AC-1 決定 Q2: 編集（題名・担当）と削除の後に、監査ログ（audit_logs）の行が増えない", async () => {
    const before = await auditLogCount();
    await edit({
      title: "[UNIT_TEST]149B監査なし",
      assignee: { id: w.ownerD.id },
    });
    await remove({ eventId: eventIdAt(3) });
    expect(await auditLogCount()).toBe(before);
  });
});
