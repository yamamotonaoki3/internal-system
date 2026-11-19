// #149（149-B）計画 6.1・10節 #19：記録の ID は、記録の表の「全体」の最大より大きいこと（重大3）。
// Service を通す側の確かめ。Repository 単体（batch 全体の取り消し）は db/case-todo.repository.edit.db.test.ts に置く
// （db/ から services/ を import しない層のルールのため、Service を通すテストはこのファイルに分けた）。
// 編集・削除は、別の TODO に未来の ID の記録があっても、全体の最大より大きい ID で作り直して成功し、記録は1回分だけ。
// 149-A の完了・取り消しも同じ条件に改める。
// 時刻は CASEREQ_NOW に固定する。データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupCaseTestData,
  joinedAt,
  seedCase,
  setDisplayName,
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
} from "../../test/case-todo-fixtures";
import { withCaseTodos } from "../db/case-todo.repository";
import { ulidAfter } from "../lib/ulid";
import { createCaseTodoService } from "./case-todo.service";

const NAME_A = "テスト操作者149B";
const NAME_B = "テスト担当149B";
const NAME_C = "テスト別担当149B";
const T1_TITLE = "[UNIT_TEST]149B見積書の作成";

let w: CaseWorld;
let room: SeededCase;

const actorOf = (userId: string) => ({ userId, traceId: casereqTraceId() });
const service = <T>(
  operation: (s: ReturnType<typeof createCaseTodoService>) => Promise<T>,
) =>
  withCaseTodos(env, (repository, roles) =>
    operation(createCaseTodoService(repository, roles)),
  );

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
  // T1：未完了・担当 B・版1。T2：完了・完了時の担当 B・版2
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
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupCaseTestData();
});

describe("#149 AC-1 計画 6.1・10節 #19 Service を通した記録の ID は、記録の表の全体より大きいこと（重大3）", () => {
  it("#149 AC-1 計画 6.1・10節 #19: Service を通すと、別の TODO に未来の ID の記録があっても作り直して成功し、記録は1回分だけで、全体の最大より大きい ID", async () => {
    await insertTodoEvent({
      id: futureIdAt(1),
      todoId: todoIdAt(2),
      caseId: room.id,
      kind: "create",
      actorId: w.memberS1.id,
    });
    await service((s) =>
      s.editTodo(actorOf(w.memberS1.id), room.id, todoIdAt(1), {
        version: 1,
        title: "[UNIT_TEST]149B作り直し",
        assigneeUserId: w.ownerD.id,
      }),
    );
    const events = await todoEventsOf(todoIdAt(1));
    expect(events.map((e) => e.kind)).toEqual([
      "title_change",
      "assignee_change",
    ]);
    for (const event of events) expect(event.id > futureIdAt(1)).toBe(true);
    expect((await todoRow(todoIdAt(1))).version).toBe(2);
  });

  it("#149 AC-1 計画 6.1・10節 #19: 時計が戻った状態（ulidAfter が「前＋1」を返す）で、別の TODO に、TODO ごとの最大の次の ID と同じ記録があっても、主キーで衝突せずに成功する", async () => {
    // T1 の記録の最大は M、別の TODO（T2）に ulidAfter(M) がある。TODO ごとの最大で作ると T2 の記録と主キーが重なる組み立て
    const m = futureIdAt(1);
    await insertTodoEvent({
      id: m,
      todoId: todoIdAt(1),
      caseId: room.id,
      kind: "create",
      actorId: w.memberS1.id,
    });
    await insertTodoEvent({
      id: ulidAfter(m),
      todoId: todoIdAt(2),
      caseId: room.id,
      kind: "create",
      actorId: w.memberS1.id,
    });
    await service((s) =>
      s.editTodo(actorOf(w.memberS1.id), room.id, todoIdAt(1), {
        version: 1,
        title: "[UNIT_TEST]149B時計の逆転",
      }),
    );
    const events = await todoEventsOf(todoIdAt(1));
    expect(events.map((e) => e.kind)).toEqual(["create", "title_change"]);
    expect(events[1]!.id > ulidAfter(m)).toBe(true);
  });

  it("#149 AC-1 計画 6.1: Service の削除も、別の TODO に未来の ID の記録があっても作り直して成功し、記録 delete は1件", async () => {
    await insertTodoEvent({
      id: futureIdAt(1),
      todoId: todoIdAt(2),
      caseId: room.id,
      kind: "create",
      actorId: w.memberS1.id,
    });
    await service((s) =>
      s.deleteTodo(actorOf(w.memberS1.id), room.id, todoIdAt(1)),
    );
    const events = await todoEventsOf(todoIdAt(1));
    expect(events.map((e) => e.kind)).toEqual(["delete"]);
    expect(events[0]!.id > futureIdAt(1)).toBe(true);
  });
});

describe("#149 AC-1 計画 6.1 149-A の完了・取り消しの記録の ID も、全体で確かめる（重大3。149-B で条件を改める）", () => {
  it("#149 AC-1 計画 6.1: Service の完了は、別の TODO に未来の ID の記録があっても作り直して成功し、記録 complete は1件で全体の最大より大きい", async () => {
    await insertTodoEvent({
      id: futureIdAt(1),
      todoId: todoIdAt(2),
      caseId: room.id,
      kind: "create",
      actorId: w.memberS1.id,
    });
    await service((s) =>
      s.completeTodo(actorOf(w.memberS1.id), room.id, todoIdAt(1)),
    );
    const events = await todoEventsOf(todoIdAt(1));
    expect(events.map((e) => e.kind)).toEqual(["complete"]);
    expect(events[0]!.id > futureIdAt(1)).toBe(true);
  });

  it("#149 AC-1 計画 6.1: 時計が戻った状態で、別の TODO に「TODO ごとの最大の次」の記録があっても、完了の取り消しは主キーで衝突せずに成功する", async () => {
    const m = futureIdAt(1);
    await insertTodoEvent({
      id: m,
      todoId: todoIdAt(2),
      caseId: room.id,
      kind: "complete",
      actorId: w.memberS1.id,
    });
    await insertTodoEvent({
      id: ulidAfter(m),
      todoId: todoIdAt(1),
      caseId: room.id,
      kind: "create",
      actorId: w.memberS1.id,
    });
    await insertTodoEvent({
      id: ulidAfter(ulidAfter(m)),
      todoId: todoIdAt(1),
      caseId: room.id,
      kind: "create",
      actorId: w.memberS1.id,
    });
    await service((s) =>
      s.uncompleteTodo(actorOf(w.memberS1.id), room.id, todoIdAt(2)),
    );
    const events = await todoEventsOf(todoIdAt(2));
    expect(events.map((e) => e.kind)).toEqual(["complete", "uncomplete"]);
    expect(events[1]!.id > ulidAfter(ulidAfter(m))).toBe(true);
    expect((await todoRow(todoIdAt(2))).is_done).toBe(0);
  });
});
