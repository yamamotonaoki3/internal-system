// #149（149-B）5-4 AC-6（編集で選べる担当）・AC-7・AC-8・AC-9・AC-10・AC-12（一覧・進捗から除く）、決定 Q1・Q2・Q3、計画 6.2・10節 #1〜#12・#21〜#27：
// TODO の編集（EP-5-15 PATCH /api/cases/:caseId/todos/:todoId）と削除（EP-5-16 DELETE 同じ経路）を、実際のアプリ入口（index.ts の app）と隔離 D1 で確かめる。
// この層で確かめるもの：判定の順と応答（各行は、前の理由と後の理由を同時に満たすデータで送り、前の理由が返ること）・存在の非開示・
//   すでにその状態なら何も書かない（200・204）・応答の形・noStore・404/403 の logger.audit。
// 記録の中身・前提の崩れ・ID の逆転は DB のテスト（db/case-todo.repository.edit.db.test.ts）、割り込みは services/case-todo.edit.interleave.test.ts で確かめる。
// 判定の順（計画 6.2.2）：
//   編集：案件がない 404 → 有効な参加者でない 403「参加者だけが操作できます」→ 本文の形・題名・版 422 → TODO がない・ほかの案件 404「TODOが見つかりません」
//     → 削除済み 409 todo_deleted → 完了済みで担当を指定 409 todo_completed（決定 Q1）→ 新しい担当が有効な参加者でない 422 assigneeUserId
//     → 終了中 409 closed → 版が違う 409 todo_changed → いまと同じ値なら何も書かずに 200 → 200
//   削除：404 → 403 → TODO がない 404 → 終了中 409 closed → すでに削除済みなら何も書かずに 204 → 204
// 契約（実装前の仮置き。実装の担当へ）：
//   PATCH の本文（strict）：version（整数・1以上・必須）・title（任意）・assigneeUserId（任意。ULID か null）。title・assigneeUserId のどちらもなければ 422
//     （fields は title と assigneeUserId）。200 は 149-A の TodoItem（id・title・completed・version・assignee・previousAssignee・completedAssignee）＋ progress
//   DELETE は本文を受け取らず 204（決定 Q2：版は送らない）
// 世界の対応（計画 10節の前提のデータ）：A＝memberS1（操作者）・B＝memberD1・C＝ownerD（有効な参加者）・D＝inactive（無効・参加の行あり）、
//   E＝memberS2（非参加の有効な社員）・G＝admin（非参加の全体管理者）。K＝main、K2＝other、K3＝closed。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  CASES_BASE,
  MISSING_CASE_ID,
  cleanupCaseTestData,
  joinedAt,
  removeCaseMember,
  seedCase,
  setDisplayName,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  CASEREQ_NOW,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import {
  CASE_TODO_MESSAGES,
  CASE_TODO_REASONS,
  MISSING_TODO_ID,
  auditLogCount,
  insertTodo,
  todoEventsOf,
  todoIdAt,
  todoRow,
  todoRowsOf,
} from "../../test/case-todo-fixtures";

type ErrorBody = {
  code: string;
  message: string;
  fields?: string[];
  reason?: string;
};
type Person = { userId: string; displayName: string; isActive: boolean };
type EditedItem = {
  id: string;
  title: string;
  completed: boolean;
  version: number;
  assignee: Person | null;
  previousAssignee: Person | null;
  completedAssignee: Person | null;
  progress: { done: number; total: number } | null;
};

const NAME_B = "テスト担当149B";
const NAME_C = "テスト別担当149B";
const T1_TITLE = "[UNIT_TEST]149B見積書の作成";

let w: CaseWorld;
let logLines: string[];
/** K：進行中。A・B・C・D（無効）が参加 */
let main: SeededCase;
/** K3：終了。A・B が参加 */
let closed: SeededCase;
/** K2：進行中の別の案件。A・E が参加 */
let other: SeededCase;

const todoPath = (caseId: string, todoId: string) =>
  `${CASES_BASE}/${caseId}/todos/${todoId}`;
const editOf = (
  caseId: string,
  todoId: string,
  token: string | null,
  body: unknown,
) => apiRequest("PATCH", todoPath(caseId, todoId), { token, body });
const deleteOf = (caseId: string, todoId: string, token: string | null) =>
  apiRequest("DELETE", todoPath(caseId, todoId), { token });
const listOf = (caseId: string, token: string) =>
  apiRequest("GET", `${CASES_BASE}/${caseId}/todos`, { token });

async function expectError(
  res: Response,
  status: number,
  expected: Partial<ErrorBody>,
) {
  expect(res.status).toBe(status);
  expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
  expect(await res.json()).toMatchObject(expected);
}

const auditsOf = (action: string, reason: string) =>
  logLines.filter(
    (line) =>
      line.includes(action) &&
      line.includes("failure") &&
      line.includes(reason),
  );

/** T1（未完了・担当 B・版1）、T2（完了・完了時の担当 B・版2）、T3（削除済み）、K2 の X（n=5）、K3 の T4（n=4） */
async function seedWorld() {
  await insertTodo({
    id: todoIdAt(1),
    caseId: main.id,
    title: T1_TITLE,
    createdBy: w.memberS1.id,
    assigneeId: w.memberD1.id,
    recordedAssigneeName: NAME_B,
  });
  await insertTodo({
    id: todoIdAt(2),
    caseId: main.id,
    title: "[UNIT_TEST]149B完了済み",
    createdBy: w.memberS1.id,
    assigneeId: w.memberD1.id,
    recordedAssigneeName: NAME_B,
    isDone: true,
    completedAssigneeId: w.memberD1.id,
    completedAssigneeName: NAME_B,
    version: 2,
  });
  await insertTodo({
    id: todoIdAt(3),
    caseId: main.id,
    title: "[UNIT_TEST]149B削除済み",
    createdBy: w.memberS1.id,
    deletedBy: w.memberS1.id,
  });
  await insertTodo({
    id: todoIdAt(4),
    caseId: closed.id,
    title: "[UNIT_TEST]149B終了中",
    createdBy: w.memberS1.id,
    assigneeId: w.memberD1.id,
    recordedAssigneeName: NAME_B,
  });
  await insertTodo({
    id: todoIdAt(5),
    caseId: other.id,
    title: "[UNIT_TEST]149B別の案件",
    createdBy: w.memberS2.id,
  });
}

async function setVersion(todoId: string, version: number) {
  await env.DB.prepare("UPDATE case_todos SET version = ? WHERE id = ?")
    .bind(version, todoId)
    .run();
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(CASEREQ_NOW));
  logLines = [];
  const capture = (...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  w = await setupCaseWorld();
  await setDisplayName(w.memberD1.id, NAME_B);
  await setDisplayName(w.ownerD.id, NAME_C);
  main = await seedCase({
    n: 1501,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]149B結合",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
      { userId: w.ownerD.id, joinedAt: joinedAt(3) },
      { userId: w.inactive.id, joinedAt: joinedAt(4) },
    ],
  });
  closed = await seedCase({
    n: 1502,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]149B終了",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    status: "closed",
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
    ],
  });
  other = await seedCase({
    n: 1503,
    clientId: w.clientB.id,
    code: "QZB",
    title: "[UNIT_TEST]149B別の案件",
    createdBy: w.memberS2.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberS2.id, joinedAt: joinedAt(2) },
    ],
  });
  await seedWorld();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupCaseTestData();
});

/** 非参加者（R-76：全体管理者・担当部署のオーナーも不可）。無効な参加者はセッションが 401 になるため、DB・割り込みのテストで扱う */
const OUTSIDERS: [string, () => string][] = [
  ["E（非参加の一般社員）", () => w.memberS2.token],
  ["G（非参加の全体管理者）", () => w.admin.token],
  ["非参加の担当部署のオーナー", () => w.ownerS.token],
];

describe("#149 AC-1 149-B 認証とパスの形", () => {
  it("#149 AC-1: ログインしていなければ、編集・削除は 401 で、何も変わらない", async () => {
    const responses = [
      await editOf(main.id, todoIdAt(1), null, { version: 1, title: "x" }),
      await deleteOf(main.id, todoIdAt(1), null),
    ];
    expect(responses.map((r) => r.status)).toEqual([401, 401]);
    expect(await todoRow(todoIdAt(1))).toMatchObject({
      title: T1_TITLE,
      version: 1,
      deleted_at: null,
    });
  });

  it.each([
    ["編集の caseId", (t: string) => editOf("not-a-ulid", todoIdAt(1), t, {})],
    ["編集の todoId", (t: string) => editOf(main.id, "not-a-ulid", t, {})],
    ["削除の caseId", (t: string) => deleteOf("not-a-ulid", todoIdAt(1), t)],
    ["削除の todoId", (t: string) => deleteOf(main.id, "not-a-ulid", t)],
  ])("#149 AC-1: パスの %s が ULID の形でなければ 422", async (_l, call) => {
    await expectError(await call(w.memberS1.token), 422, {
      code: "VALIDATION_ERROR",
    });
  });
});

describe("#149 AC-1 5-4 AC-8・AC-9 EP-5-15 編集：判定の順（計画 10節 #1〜#12）", () => {
  it("#149 AC-1 計画 10節 #1: ない案件への編集は、本文が壊れていても 404「案件が見つかりません」", async () => {
    await expectError(
      await editOf(MISSING_CASE_ID, todoIdAt(1), w.memberS1.token, "x"),
      404,
      { code: "NOT_FOUND", message: CASE_TODO_MESSAGES.caseNotFound },
    );
    expect(auditsOf("case.todo.edit", "not_found").length).toBeGreaterThan(0);
  });

  it.each(OUTSIDERS)(
    "#149 AC-1 R-76 計画 10節 #2: %s には、壊れた本文・ない TODO・ほかの案件の TODO・終了中の案件のどれでも同じ 403「参加者だけが操作できます」",
    async (_l, token) => {
      const targets: [string, string, unknown][] = [
        [main.id, todoIdAt(1), "x"],
        [main.id, todoIdAt(1), { version: 0, extra: 1 }],
        [main.id, MISSING_TODO_ID, { version: 1, title: "a" }],
        [main.id, todoIdAt(5), { version: 1, title: "a" }],
        [main.id, todoIdAt(3), { version: 1, title: "a" }],
        [closed.id, todoIdAt(4), { version: 1, title: "a" }],
      ];
      for (const [caseId, todoId, body] of targets)
        await expectError(await editOf(caseId, todoId, token(), body), 403, {
          code: "FORBIDDEN",
          message: CASE_TODO_MESSAGES.participantsOnlyEdit,
        });
      expect(await todoRow(todoIdAt(1))).toMatchObject({
        title: T1_TITLE,
        version: 1,
      });
      expect(
        auditsOf("case.todo.edit", "not_participant").length,
      ).toBeGreaterThan(0);
    },
  );

  it.each([
    ["本文がオブジェクトでない", "x", undefined],
    [
      "決めていない項目がある（strict）",
      { version: 1, title: "a", dueDate: "2026-12-01" },
      undefined,
    ],
    ["version がない", { title: "a" }, ["version"]],
    ["version が 0", { version: 0, title: "a" }, ["version"]],
    ["version が整数でない", { version: 1.5, title: "a" }, ["version"]],
    ["version が文字列", { version: "1", title: "a" }, ["version"]],
    ["題名が空", { version: 1, title: "" }, ["title"]],
    ["題名が整形の後に空（空白だけ）", { version: 1, title: "　 " }, ["title"]],
    ["題名が 101 文字", { version: 1, title: "あ".repeat(101) }, ["title"]],
    [
      "assigneeUserId が ULID の形でない",
      { version: 1, assigneeUserId: "not-a-ulid" },
      ["assigneeUserId"],
    ],
    [
      "title も assigneeUserId もない",
      { version: 1 },
      ["title", "assigneeUserId"],
    ],
  ])(
    "#149 AC-1 計画 10節 #3: A が、ない TODO に「%s」で送ると、TODO の 404 より先に 422",
    async (_l, body, fields) => {
      const res = await editOf(
        main.id,
        MISSING_TODO_ID,
        w.memberS1.token,
        body,
      );
      expect(res.status).toBe(422);
      const json = (await res.json()) as ErrorBody;
      expect(json.code).toBe("VALIDATION_ERROR");
      if (fields !== undefined)
        expect([...(json.fields ?? [])].sort()).toEqual([...fields].sort());
    },
  );

  it("#149 AC-1 境界値: 題名がちょうど 100 文字なら通る（422 にならない）", async () => {
    const res = await editOf(main.id, todoIdAt(1), w.memberS1.token, {
      version: 1,
      title: "あ".repeat(100),
    });
    expect(res.status).toBe(200);
    expect((await todoRow(todoIdAt(1))).title).toBe("あ".repeat(100));
  });

  it("#149 AC-1 security 計画 10節 #4: 参加者でも、ない TODO・ほかの案件（K2）の TODO は 404「TODOが見つかりません」で、ほかの案件の TODO は変わらない", async () => {
    for (const todoId of [MISSING_TODO_ID, todoIdAt(5)])
      await expectError(
        await editOf(main.id, todoId, w.memberS1.token, {
          version: 1,
          title: "[UNIT_TEST]149B書き換え",
        }),
        404,
        { code: "NOT_FOUND", message: CASE_TODO_MESSAGES.todoNotFound },
      );
    expect(await todoRow(todoIdAt(5))).toMatchObject({
      title: "[UNIT_TEST]149B別の案件",
      version: 1,
    });
    expect(auditsOf("case.todo.edit", "todo_not_found").length).toBeGreaterThan(
      0,
    );
  });

  it("#149 AC-1 計画 10節 #5: 削除済みの T3 に、担当を E（非参加）にして送ると、422 より先に 409 todo_deleted", async () => {
    await expectError(
      await editOf(main.id, todoIdAt(3), w.memberS1.token, {
        version: 1,
        assigneeUserId: w.memberS2.id,
      }),
      409,
      {
        code: "CONFLICT",
        reason: CASE_TODO_REASONS.todoDeleted,
        message: CASE_TODO_MESSAGES.todoDeleted,
      },
    );
  });

  it("#149 AC-1 決定 Q1 計画 10節 #6: 完了済みの T2 に担当を指定すると、版が古く担当が非参加でも 409 todo_completed（422・todo_changed より先）。何も変わらない", async () => {
    await expectError(
      await editOf(main.id, todoIdAt(2), w.memberS1.token, {
        version: 1,
        assigneeUserId: w.memberS2.id,
      }),
      409,
      { code: "CONFLICT", reason: CASE_TODO_REASONS.todoCompleted },
    );
    // 担当を「なし」にする指定も、担当の変更なので同じ
    await expectError(
      await editOf(main.id, todoIdAt(2), w.memberS1.token, {
        version: 2,
        title: "[UNIT_TEST]149B題名も",
        assigneeUserId: null,
      }),
      409,
      { reason: CASE_TODO_REASONS.todoCompleted },
    );
    expect(await todoRow(todoIdAt(2))).toMatchObject({
      title: "[UNIT_TEST]149B完了済み",
      version: 2,
      assignee_id: w.memberD1.id,
    });
    expect(await todoEventsOf(todoIdAt(2))).toEqual([]);
  });

  it.each([
    ["E（非参加）", () => w.memberS2.id],
    ["D（無効な参加者）", () => w.inactive.id],
    ["存在しない利用者の ULID", () => MISSING_CASE_ID],
  ])(
    "#149 AC-1 5-4 AC-6 計画 10節 #7: T1 の担当を %s にすると、版が古くても 422 assigneeUserId（どれも同じ文）",
    async (_l, assignee) => {
      await expectError(
        await editOf(main.id, todoIdAt(1), w.memberS1.token, {
          version: 9,
          assigneeUserId: assignee(),
        }),
        422,
        {
          code: "VALIDATION_ERROR",
          fields: ["assigneeUserId"],
          message: CASE_TODO_MESSAGES.assigneeInvalid,
        },
      );
      expect(await todoRow(todoIdAt(1))).toMatchObject({
        assignee_id: w.memberD1.id,
        version: 1,
      });
    },
  );

  it("#149 AC-1 5-4 AC-9 計画 10節 #8: 終了中の K3 の T4 に古い版で送ると、todo_changed より先に 409 closed「終了した案件は変更できません」", async () => {
    await expectError(
      await editOf(closed.id, todoIdAt(4), w.memberS1.token, {
        version: 9,
        title: "[UNIT_TEST]149B終了中の編集",
      }),
      409,
      {
        code: "CONFLICT",
        reason: CASE_TODO_REASONS.closed,
        message: CASE_TODO_MESSAGES.closed,
      },
    );
    expect(await todoRow(todoIdAt(4))).toMatchObject({
      title: "[UNIT_TEST]149B終了中",
      version: 1,
    });
  });

  it("#149 AC-1 5-4 AC-9: 終了中の案件の削除済みの TODO への編集は、closed より先に todo_deleted（判定の順）", async () => {
    await insertTodo({
      id: todoIdAt(6),
      caseId: closed.id,
      title: "[UNIT_TEST]149B終了中の削除済み",
      createdBy: w.memberS1.id,
      deletedBy: w.memberS1.id,
    });
    await expectError(
      await editOf(closed.id, todoIdAt(6), w.memberS1.token, {
        version: 1,
        title: "a",
      }),
      409,
      { reason: CASE_TODO_REASONS.todoDeleted },
    );
  });

  it("#149 AC-1 計画 10節 #9: T1 の版が 2 に進んだ後に版 1 で送ると、409 todo_changed（文言つき）で何も変わらない", async () => {
    await setVersion(todoIdAt(1), 2);
    await expectError(
      await editOf(main.id, todoIdAt(1), w.memberS1.token, {
        version: 1,
        title: "[UNIT_TEST]149B古い版",
      }),
      409,
      {
        code: "CONFLICT",
        reason: CASE_TODO_REASONS.todoChanged,
        message: CASE_TODO_MESSAGES.todoChanged,
      },
    );
    expect(await todoRow(todoIdAt(1))).toMatchObject({
      title: T1_TITLE,
      version: 2,
    });
    expect(await todoEventsOf(todoIdAt(1))).toEqual([]);
  });

  it("#149 AC-1 計画 10節 #9: いまより新しい版（未来の版）で送っても 409 todo_changed（一致だけを通す）", async () => {
    await expectError(
      await editOf(main.id, todoIdAt(1), w.memberS1.token, {
        version: 2,
        title: "[UNIT_TEST]149B未来の版",
      }),
      409,
      { reason: CASE_TODO_REASONS.todoChanged },
    );
  });

  it("#149 AC-1 決定 Q3 計画 10節 #10: 正しい版で、整形の後にいまと同じ題名と、いまと同じ担当 B を送ると、何も書かずに 200（版は変わらず、記録も増えない）", async () => {
    const res = await editOf(main.id, todoIdAt(1), w.memberS1.token, {
      version: 1,
      title: "  [ＵＮＩＴ_ＴＥＳＴ]１４９B見積書の作成　",
      assigneeUserId: w.memberD1.id,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
    const body = (await res.json()) as EditedItem;
    expect(body).toMatchObject({
      id: todoIdAt(1),
      title: T1_TITLE,
      version: 1,
    });
    expect(await todoRow(todoIdAt(1))).toMatchObject({
      version: 1,
      updated_at: CASEREQ_NOW,
    });
    expect(await todoEventsOf(todoIdAt(1))).toEqual([]);
  });

  it("#149 AC-1 決定 Q1 計画 10節 #11: 完了済みの T2 は題名だけなら編集でき、200。completedAssignee は B のまま、版+1、記録 title_change が1件", async () => {
    const res = await editOf(main.id, todoIdAt(2), w.memberS1.token, {
      version: 2,
      title: "[UNIT_TEST]149B完了済みの改題",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EditedItem;
    expect(body).toMatchObject({
      id: todoIdAt(2),
      title: "[UNIT_TEST]149B完了済みの改題",
      completed: true,
      version: 3,
      completedAssignee: {
        userId: w.memberD1.id,
        displayName: NAME_B,
        isActive: true,
      },
    });
    expect(await todoRow(todoIdAt(2))).toMatchObject({
      is_done: 1,
      assignee_id: w.memberD1.id,
      completed_assignee_id: w.memberD1.id,
      completed_assignee_name: NAME_B,
      version: 3,
    });
    expect(
      (await todoEventsOf(todoIdAt(2))).map((e) => [e.kind, e.actor_id]),
    ).toEqual([["title_change", w.memberS1.id]]);
  });

  it("#149 AC-1 計画 10節 #12: いまの担当 B が参加者から外れていても、同じ B の ID を送るのは変更なしで 200（422 にしない）", async () => {
    await removeCaseMember(main.roomId, w.memberD1.id);
    const res = await editOf(main.id, todoIdAt(1), w.memberS1.token, {
      version: 1,
      assigneeUserId: w.memberD1.id,
    });
    expect(res.status).toBe(200);
    expect(await todoRow(todoIdAt(1))).toMatchObject({
      assignee_id: w.memberD1.id,
      version: 1,
    });
    expect(await todoEventsOf(todoIdAt(1))).toEqual([]);
  });
});

describe("#149 AC-1 5-4 AC-6・AC-8・AC-10 EP-5-15 編集の成功", () => {
  it("#149 AC-1 5-4 AC-8: 参加者なら誰でも（B が）題名と担当を変えられ、200 は項目（149-A の TodoItem の形）と progress。再認証なしで通る", async () => {
    const res = await editOf(main.id, todoIdAt(1), w.memberD1.token, {
      version: 1,
      title: "[UNIT_TEST]149B改題",
      assigneeUserId: w.ownerD.id,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
    const body = (await res.json()) as EditedItem;
    expect(Object.keys(body).sort()).toEqual(
      [
        "assignee",
        "completed",
        "completedAssignee",
        "id",
        "previousAssignee",
        "progress",
        "title",
        "version",
      ].sort(),
    );
    expect(body).toEqual({
      id: todoIdAt(1),
      title: "[UNIT_TEST]149B改題",
      completed: false,
      version: 2,
      assignee: { userId: w.ownerD.id, displayName: NAME_C, isActive: true },
      previousAssignee: null,
      completedAssignee: null,
      progress: { done: 1, total: 2 },
    });
    expect(
      (await todoEventsOf(todoIdAt(1))).map((e) => [e.kind, e.actor_id]),
    ).toEqual([
      ["title_change", w.memberD1.id],
      ["assignee_change", w.memberD1.id],
    ]);
  });

  it("#149 AC-1 5-4 AC-6: 自分（操作者）を担当にできる", async () => {
    const res = await editOf(main.id, todoIdAt(1), w.memberS1.token, {
      version: 1,
      assigneeUserId: w.memberS1.id,
    });
    expect(res.status).toBe(200);
    expect((await todoRow(todoIdAt(1))).assignee_id).toBe(w.memberS1.id);
  });

  it("#149 AC-1 決定 Q3（利用者の決定）: 担当を「なし」（null）にすると、応答の assignee も previousAssignee も null（以前の担当を残さない）", async () => {
    const res = await editOf(main.id, todoIdAt(1), w.memberS1.token, {
      version: 1,
      assigneeUserId: null,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EditedItem;
    expect(body.assignee).toBeNull();
    expect(body.previousAssignee).toBeNull();
    const listed = (await (await listOf(main.id, w.memberS1.token)).json()) as {
      items: EditedItem[];
    };
    expect(listed.items.find((item) => item.id === todoIdAt(1))).toMatchObject({
      assignee: null,
      previousAssignee: null,
    });
  });

  it("#149 AC-1 5-4 AC-7: 編集した内容は、ほかの参加者の一覧に出る", async () => {
    await editOf(main.id, todoIdAt(1), w.memberS1.token, {
      version: 1,
      title: "[UNIT_TEST]149B共有の改題",
    });
    const listed = (await (await listOf(main.id, w.memberD1.token)).json()) as {
      items: EditedItem[];
    };
    expect(listed.items.map((item) => item.title)).toContain(
      "[UNIT_TEST]149B共有の改題",
    );
  });

  it("#149 AC-1 決定 Q2: 編集の後に、監査ログ（audit_logs）の行は増えない", async () => {
    const before = await auditLogCount();
    await editOf(main.id, todoIdAt(1), w.memberS1.token, {
      version: 1,
      title: "[UNIT_TEST]149B監査なし",
    });
    expect(await auditLogCount()).toBe(before);
  });
});

describe("#149 AC-1 5-4 AC-8・AC-9・AC-12 EP-5-16 削除（計画 10節 #21〜#27）", () => {
  it("#149 AC-1 5-4 AC-8・AC-12 計画 10節 #21: A が T1 を削除すると 204（本文なし）。論理削除（deleted_at・deleted_by＝A）、版+1、記録 delete（その時点の題名）。担当・完了の列は変わらない", async () => {
    const res = await deleteOf(main.id, todoIdAt(1), w.memberS1.token);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(await todoRow(todoIdAt(1))).toMatchObject({
      title: T1_TITLE,
      deleted_at: CASEREQ_NOW,
      deleted_by: w.memberS1.id,
      version: 2,
      assignee_id: w.memberD1.id,
      recorded_assignee_id: w.memberD1.id,
      recorded_assignee_name: NAME_B,
      is_done: 0,
    });
    expect(await todoEventsOf(todoIdAt(1))).toEqual([
      expect.objectContaining({
        kind: "delete",
        actor_id: w.memberS1.id,
        title: T1_TITLE,
        created_at: CASEREQ_NOW,
      }),
    ]);
  });

  it("#149 AC-1 5-4 AC-4・AC-12 計画 10節 #22: 完了済みの T2 も削除でき、進捗の全体数・完了数がどちらも1減る。完了の列は変わらない", async () => {
    const before = (await (await listOf(main.id, w.memberS1.token)).json()) as {
      progress: { done: number; total: number } | null;
    };
    expect(before.progress).toEqual({ done: 1, total: 2 });
    expect(
      (await deleteOf(main.id, todoIdAt(2), w.memberD1.token)).status,
    ).toBe(204);
    const after = (await (await listOf(main.id, w.memberS1.token)).json()) as {
      items: EditedItem[];
      progress: { done: number; total: number } | null;
    };
    expect(after.progress).toEqual({ done: 0, total: 1 });
    expect(after.items.map((item) => item.id)).toEqual([todoIdAt(1)]);
    expect(await todoRow(todoIdAt(2))).toMatchObject({
      is_done: 1,
      completed_assignee_id: w.memberD1.id,
      completed_assignee_name: NAME_B,
    });
  });

  it("#149 AC-1 5-4 AC-4 計画 10節 #23: 全部を削除すると、一覧の progress も、概要（EP-5-06）・一覧（EP-5-07）の progress も null", async () => {
    for (const n of [1, 2])
      expect(
        (await deleteOf(main.id, todoIdAt(n), w.memberS1.token)).status,
      ).toBe(204);
    const listed = (await (await listOf(main.id, w.memberS1.token)).json()) as {
      items: unknown[];
      progress: unknown;
    };
    expect(listed.items).toEqual([]);
    expect(listed.progress).toBeNull();
    const summary = (await (
      await apiRequest("GET", `${CASES_BASE}/${main.id}`, {
        token: w.memberS1.token,
      })
    ).json()) as { progress: unknown };
    expect(summary.progress).toBeNull();
    const cases = (await (
      await apiRequest("GET", `${CASES_BASE}?scope=joined&status=active`, {
        token: w.memberS1.token,
      })
    ).json()) as { items: { id: string; progress: unknown }[] };
    const row = cases.items.find((item) => item.id === main.id);
    expect(row).toBeDefined();
    expect(row?.progress).toBeNull();
  });

  it("#149 AC-1 決定 Q2 計画 10節 #24: 削除済みの T3 を削除すると、何も書かずに 204（版・記録が増えない）", async () => {
    const res = await deleteOf(main.id, todoIdAt(3), w.memberS1.token);
    expect(res.status).toBe(204);
    expect((await todoRow(todoIdAt(3))).version).toBe(1);
    expect(await todoEventsOf(todoIdAt(3))).toEqual([]);
  });

  it("#149 AC-1 計画 10節 #25: 2つの要求で同じ TODO を同時に削除すると、両方 204 で、記録 delete は1件・版は+1だけ", async () => {
    const [first, second] = await Promise.all([
      deleteOf(main.id, todoIdAt(1), w.memberS1.token),
      deleteOf(main.id, todoIdAt(1), w.memberD1.token),
    ]);
    expect([first?.status, second?.status]).toEqual([204, 204]);
    expect(
      (await todoEventsOf(todoIdAt(1))).filter((e) => e.kind === "delete"),
    ).toHaveLength(1);
    expect((await todoRow(todoIdAt(1))).version).toBe(2);
  });

  it("#149 AC-1 計画 10節 #26: ない案件は 404「案件が見つかりません」", async () => {
    await expectError(
      await deleteOf(MISSING_CASE_ID, todoIdAt(1), w.memberS1.token),
      404,
      { code: "NOT_FOUND", message: CASE_TODO_MESSAGES.caseNotFound },
    );
    expect(auditsOf("case.todo.delete", "not_found").length).toBeGreaterThan(0);
  });

  it.each(OUTSIDERS)(
    "#149 AC-1 R-76 計画 10節 #26: %s には、ある TODO・ない TODO・ほかの案件の TODO・削除済み・終了中のどれでも同じ 403",
    async (_l, token) => {
      const targets: [string, string][] = [
        [main.id, todoIdAt(1)],
        [main.id, MISSING_TODO_ID],
        [main.id, todoIdAt(5)],
        [main.id, todoIdAt(3)],
        [closed.id, todoIdAt(4)],
      ];
      for (const [caseId, todoId] of targets)
        await expectError(await deleteOf(caseId, todoId, token()), 403, {
          code: "FORBIDDEN",
          message: CASE_TODO_MESSAGES.participantsOnlyEdit,
        });
      expect(await todoRow(todoIdAt(1))).toMatchObject({
        deleted_at: null,
        version: 1,
      });
      expect(
        auditsOf("case.todo.delete", "not_participant").length,
      ).toBeGreaterThan(0);
    },
  );

  it("#149 AC-1 security 計画 10節 #26: 参加者でも、ない TODO・ほかの案件（K2）の TODO は 404「TODOが見つかりません」で、K2 の TODO は消えない", async () => {
    for (const todoId of [MISSING_TODO_ID, todoIdAt(5)])
      await expectError(
        await deleteOf(main.id, todoId, w.memberS1.token),
        404,
        {
          code: "NOT_FOUND",
          message: CASE_TODO_MESSAGES.todoNotFound,
        },
      );
    expect(await todoRow(todoIdAt(5))).toMatchObject({
      deleted_at: null,
      version: 1,
    });
    expect(
      auditsOf("case.todo.delete", "todo_not_found").length,
    ).toBeGreaterThan(0);
  });

  it("#149 AC-1 5-4 AC-9 計画 10節 #26: 終了中の K3 の T4 の削除は 409 closed で、何も変わらない", async () => {
    await expectError(
      await deleteOf(closed.id, todoIdAt(4), w.memberS1.token),
      409,
      {
        code: "CONFLICT",
        reason: CASE_TODO_REASONS.closed,
        message: CASE_TODO_MESSAGES.closed,
      },
    );
    expect(await todoRow(todoIdAt(4))).toMatchObject({
      deleted_at: null,
      version: 1,
    });
    expect(await todoRowsOf(closed.id)).toHaveLength(1);
  });

  it("#149 AC-1 5-4 AC-9 計画 10節 #26: 終了中の案件の削除済みの TODO の削除も、何も書かない 204 より先に 409 closed", async () => {
    await insertTodo({
      id: todoIdAt(6),
      caseId: closed.id,
      title: "[UNIT_TEST]149B終了中の削除済み",
      createdBy: w.memberS1.id,
      deletedBy: w.memberS1.id,
    });
    await expectError(
      await deleteOf(closed.id, todoIdAt(6), w.memberS1.token),
      409,
      { reason: CASE_TODO_REASONS.closed },
    );
  });

  it("#149 AC-1 決定 Q2 計画 10節 #27: 削除の要求に本文（版）を付けても、本文は見ずに削除する（版を送らない契約）", async () => {
    await setVersion(todoIdAt(1), 5);
    const res = await apiRequest("DELETE", todoPath(main.id, todoIdAt(1)), {
      token: w.memberS1.token,
      body: { version: 1 },
    });
    expect(res.status).toBe(204);
    expect(await todoRow(todoIdAt(1))).toMatchObject({
      deleted_by: w.memberS1.id,
      version: 6,
    });
  });

  it("#149 AC-1 決定 Q2: 削除の後に、監査ログ（audit_logs）の行は増えない", async () => {
    const before = await auditLogCount();
    await deleteOf(main.id, todoIdAt(1), w.memberS1.token);
    expect(await auditLogCount()).toBe(before);
  });

  it("#149 AC-1 5-4 AC-12: 削除した TODO は編集できず 409 todo_deleted、完了もできず 409 todo_deleted", async () => {
    await deleteOf(main.id, todoIdAt(1), w.memberS1.token);
    await expectError(
      await editOf(main.id, todoIdAt(1), w.memberS1.token, {
        version: 2,
        title: "a",
      }),
      409,
      { reason: CASE_TODO_REASONS.todoDeleted },
    );
    await expectError(
      await apiRequest(
        "POST",
        `${CASES_BASE}/${main.id}/todos/${todoIdAt(1)}/complete`,
        { token: w.memberS1.token },
      ),
      409,
      { reason: CASE_TODO_REASONS.todoDeleted },
    );
  });
});
