// #149（149-A）計画 6.1・6.9(1)・6.9(5)：TODO の表（case_todos）と変更の記録の表（case_todo_events）の形と制約を、
// マイグレーション済みの D1 に直接書いて確かめる。migration は 149-A の1本だけで、149-B〜D で使う列（version・deleted_*・記録の列）もここで作る。
// migration の番号は決め打ちにしない（先にマージする方が 0029。計画「migration」）。表・索引は sqlite_master、列は raw({ columnNames: true }) で読む。
// 期待値は計画の CHECK・外部キー・索引から決める。データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupCaseTestData,
  joinedAt,
  MISSING_CASE_ID,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  CASEREQ_NOW,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import {
  eventIdAt,
  insertTodo,
  todoIdAt,
  todoRow,
} from "../../test/case-todo-fixtures";

let w: CaseWorld;
let room: SeededCase;

beforeEach(async () => {
  w = await setupCaseWorld();
  room = await seedCase({
    n: 1491,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]149A制約",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [{ userId: w.memberS1.id, joinedAt: joinedAt(1) }],
  });
});

afterEach(async () => {
  await cleanupCaseTestData();
});

async function columnsOf(table: string): Promise<string[]> {
  const [names] = await env.DB.prepare(`SELECT * FROM ${table} LIMIT 0`).raw({
    columnNames: true,
  });
  return (names ?? []).map(String).sort();
}

type TodoRaw = {
  id: string;
  caseId?: string;
  assigneeId?: string | null;
  recordedAssigneeId?: string | null;
  recordedAssigneeName?: string | null;
  completedAssigneeId?: string | null;
  completedAssigneeName?: string | null;
  isDone?: number;
  deletedAt?: string | null;
  deletedBy?: string | null;
  createdBy?: string;
};

/** TODO の行を、指定の列で直接入れる（制約の確認用。既定は担当なしの未完了の正しい行） */
function insertRaw(row: TodoRaw) {
  return env.DB.prepare(
    `INSERT INTO case_todos (id, case_id, title, assignee_id, recorded_assignee_id, recorded_assignee_name,
       completed_assignee_id, completed_assignee_name, is_done, version, created_by, created_at, updated_at, deleted_at, deleted_by)
     VALUES (?, ?, '[UNIT_TEST]149A制約', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
  )
    .bind(
      row.id,
      row.caseId ?? room.id,
      row.assigneeId ?? null,
      row.recordedAssigneeId ?? null,
      row.recordedAssigneeName ?? null,
      row.completedAssigneeId ?? null,
      row.completedAssigneeName ?? null,
      row.isDone ?? 0,
      row.createdBy ?? w.memberS1.id,
      CASEREQ_NOW,
      CASEREQ_NOW,
      row.deletedAt ?? null,
      row.deletedBy ?? null,
    )
    .run();
}

function insertEventRaw(row: {
  id: string;
  todoId: string;
  caseId?: string;
  kind?: string;
  actorId?: string;
}) {
  return env.DB.prepare(
    `INSERT INTO case_todo_events (id, todo_id, case_id, kind, actor_id, title, previous_title, assignee_id, assignee_name,
       previous_assignee_id, previous_assignee_name, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?)`,
  )
    .bind(
      row.id,
      row.todoId,
      row.caseId ?? room.id,
      row.kind ?? "create",
      row.actorId ?? w.memberS1.id,
      CASEREQ_NOW,
    )
    .run();
}

describe("#149 AC-1 計画 6.1 表と列", () => {
  it("#149 AC-1 計画 6.1・6.9(1): case_todos は決めた列を持つ", async () => {
    expect(await columnsOf("case_todos")).toEqual(
      [
        "id",
        "case_id",
        "title",
        "assignee_id",
        "recorded_assignee_id",
        "recorded_assignee_name",
        "completed_assignee_id",
        "completed_assignee_name",
        "is_done",
        "version",
        "created_by",
        "created_at",
        "updated_at",
        "deleted_at",
        "deleted_by",
      ].sort(),
    );
  });

  it("#149 AC-1 計画 6.1: case_todo_events は決めた列を持つ（5-4 AC-10〜AC-13 の記録）", async () => {
    expect(await columnsOf("case_todo_events")).toEqual(
      [
        "id",
        "todo_id",
        "case_id",
        "kind",
        "actor_id",
        "title",
        "previous_title",
        "assignee_id",
        "assignee_name",
        "previous_assignee_id",
        "previous_assignee_name",
        "created_at",
      ].sort(),
    );
  });

  it("#149 AC-1 計画 6.1: 一覧・進捗・記録の並びの索引（case_id, id）・（todo_id, id）がある", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('case_todos', 'case_todo_events') AND sql IS NOT NULL",
    ).all<{ name: string; tbl_name: string; sql: string }>();
    const normalized = results.map((r) => ({
      name: r.name,
      columns: /\((.*)\)/.exec(r.sql)?.[1]?.replace(/[`"\s]/g, ""),
    }));
    expect(normalized).toEqual(
      expect.arrayContaining([
        { name: "case_todos_case_id_id_idx", columns: "case_id,id" },
        { name: "case_todo_events_todo_id_id_idx", columns: "todo_id,id" },
      ]),
    );
  });

  it("#149 AC-1 計画 6.1: 既定値は未完了（is_done=0）・版 1", async () => {
    await env.DB.prepare(
      `INSERT INTO case_todos (id, case_id, title, created_by, created_at, updated_at)
       VALUES (?, ?, '[UNIT_TEST]149A既定', ?, ?, ?)`,
    )
      .bind(todoIdAt(1), room.id, w.memberS1.id, CASEREQ_NOW, CASEREQ_NOW)
      .run();
    const row = await todoRow(todoIdAt(1));
    expect(row.is_done).toBe(0);
    expect(row.version).toBe(1);
    expect(row.assignee_id).toBeNull();
    expect(row.deleted_at).toBeNull();
  });
});

describe("#149 AC-1 計画 6.9(5) case_todos の CHECK", () => {
  it("#149 AC-1: 正しい組み合わせ（担当なし・担当あり・完了で完了の担当あり・現在の担当なしで保存した担当あり・削除済み）は入る", async () => {
    await insertRaw({ id: todoIdAt(1) });
    await insertRaw({
      id: todoIdAt(2),
      assigneeId: w.memberS1.id,
      recordedAssigneeId: w.memberS1.id,
      recordedAssigneeName: "テスト担当",
    });
    await insertRaw({
      id: todoIdAt(3),
      isDone: 1,
      completedAssigneeId: w.memberS1.id,
      completedAssigneeName: "テスト担当",
    });
    await insertRaw({
      id: todoIdAt(4),
      recordedAssigneeId: w.memberS1.id,
      recordedAssigneeName: "テスト担当",
    });
    await insertRaw({
      id: todoIdAt(5),
      deletedAt: CASEREQ_NOW,
      deletedBy: w.memberS1.id,
    });
    const { results } = await env.DB.prepare(
      "SELECT id FROM case_todos WHERE case_id = ? ORDER BY id",
    )
      .bind(room.id)
      .all<{ id: string }>();
    expect(results.map((r) => r.id)).toEqual([1, 2, 3, 4, 5].map(todoIdAt));
  });

  it.each([
    [
      "現在の担当があり、保存した担当が NULL",
      () => ({ assigneeId: w.memberS1.id }),
    ],
    [
      "現在の担当と保存した担当が別の人",
      () => ({
        assigneeId: w.memberS1.id,
        recordedAssigneeId: w.memberS2.id,
        recordedAssigneeName: "テスト担当",
      }),
    ],
    [
      "保存した担当の ID だけがある（名前が NULL）",
      () => ({ recordedAssigneeId: w.memberS1.id }),
    ],
    [
      "保存した担当の名前だけがある（ID が NULL）",
      () => ({ recordedAssigneeName: "テスト担当" }),
    ],
    [
      "完了の担当の ID だけがある",
      () => ({ isDone: 1, completedAssigneeId: w.memberS1.id }),
    ],
    [
      "完了の担当の名前だけがある",
      () => ({ isDone: 1, completedAssigneeName: "テスト担当" }),
    ],
    [
      "未完了なのに完了の担当がある",
      () => ({
        isDone: 0,
        completedAssigneeId: w.memberS1.id,
        completedAssigneeName: "テスト担当",
      }),
    ],
    ["is_done が 0・1 以外", () => ({ isDone: 2 })],
    ["削除の日時だけがある", () => ({ deletedAt: CASEREQ_NOW })],
    ["削除した人だけがある", () => ({ deletedBy: w.memberS1.id })],
  ])(
    "#149 AC-1 計画 6.9(5): %s の行は CHECK で拒否される",
    async (_label, make) => {
      await expect(insertRaw({ id: todoIdAt(9), ...make() })).rejects.toThrow(
        /CHECK/i,
      );
    },
  );
});

describe("#149 AC-1 計画 6.1 外部キー", () => {
  it.each([
    ["case_id（案件がない）", () => ({ caseId: MISSING_CASE_ID })],
    [
      "assignee_id（利用者がいない）",
      () => ({
        assigneeId: MISSING_CASE_ID,
        recordedAssigneeId: MISSING_CASE_ID,
        recordedAssigneeName: "テスト担当",
      }),
    ],
    ["created_by（利用者がいない）", () => ({ createdBy: MISSING_CASE_ID })],
    [
      "deleted_by（利用者がいない）",
      () => ({ deletedAt: CASEREQ_NOW, deletedBy: MISSING_CASE_ID }),
    ],
  ])("#149 AC-1: case_todos の %s は外部キーで拒否される", async (_l, make) => {
    await expect(insertRaw({ id: todoIdAt(9), ...make() })).rejects.toThrow(
      /FOREIGN KEY/i,
    );
  });

  it("#149 AC-1: case_todo_events の todo_id・case_id・actor_id は外部キーで拒否される", async () => {
    await insertTodo({
      id: todoIdAt(1),
      caseId: room.id,
      title: "[UNIT_TEST]149A外部キー",
      createdBy: w.memberS1.id,
    });
    await expect(
      insertEventRaw({ id: eventIdAt(1), todoId: todoIdAt(2) }),
    ).rejects.toThrow(/FOREIGN KEY/i);
    await expect(
      insertEventRaw({
        id: eventIdAt(2),
        todoId: todoIdAt(1),
        caseId: MISSING_CASE_ID,
      }),
    ).rejects.toThrow(/FOREIGN KEY/i);
    await expect(
      insertEventRaw({
        id: eventIdAt(3),
        todoId: todoIdAt(1),
        actorId: MISSING_CASE_ID,
      }),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });

  it("#149 AC-1: 記録がある TODO・TODO がある案件は消せない（外部キーの順：events → todos → cases）", async () => {
    await insertTodo({
      id: todoIdAt(1),
      caseId: room.id,
      title: "[UNIT_TEST]149A外部キー",
      createdBy: w.memberS1.id,
    });
    await insertEventRaw({ id: eventIdAt(1), todoId: todoIdAt(1) });
    await expect(
      env.DB.prepare("DELETE FROM case_todos WHERE id = ?")
        .bind(todoIdAt(1))
        .run(),
    ).rejects.toThrow(/FOREIGN KEY/i);
    await expect(
      env.DB.prepare("DELETE FROM case_todo_events WHERE todo_id = ?")
        .bind(todoIdAt(1))
        .run(),
    ).resolves.toBeTruthy();
    await expect(
      env.DB.prepare("DELETE FROM cases WHERE id = ?").bind(room.id).run(),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });
});

describe("#149 AC-1 計画 6.1 case_todo_events の kind", () => {
  it.each([
    "create",
    "title_change",
    "assignee_change",
    "complete",
    "uncomplete",
    "delete",
    "restore",
    "auto_unassign",
  ])("#149 AC-1: kind %s は入る", async (kind) => {
    await insertTodo({
      id: todoIdAt(1),
      caseId: room.id,
      title: "[UNIT_TEST]149A記録",
      createdBy: w.memberS1.id,
    });
    await insertEventRaw({ id: eventIdAt(1), todoId: todoIdAt(1), kind });
  });

  it("#149 AC-1: 決めた値以外の kind は CHECK で拒否される", async () => {
    await insertTodo({
      id: todoIdAt(1),
      caseId: room.id,
      title: "[UNIT_TEST]149A記録",
      createdBy: w.memberS1.id,
    });
    await expect(
      insertEventRaw({ id: eventIdAt(1), todoId: todoIdAt(1), kind: "edit" }),
    ).rejects.toThrow(/CHECK/i);
  });
});
