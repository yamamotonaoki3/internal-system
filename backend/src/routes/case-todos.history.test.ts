// #149（149-C）5-4 AC-9・AC-10・AC-12・AC-13・AC-14、計画 plan-149c 5.1・5.2・9.5（R1〜R9）：
// TODO の履歴（EP-5-24 GET /api/cases/:caseId/todos/:todoId/events）・削除済みの一覧（EP-5-25 GET /api/cases/:caseId/deleted-todos）・
// 復元（EP-5-26 POST /api/cases/:caseId/todos/:todoId/restore）を、実際のアプリ入口（index.ts の app）と隔離 D1 で確かめる。
// この層で確かめるもの：判定の順と応答（各行は、前の理由と後の理由を同時に満たすデータで送り、前の理由が返ること）・存在の非開示
//   （非参加者に TODO の有無を出さない）・終了中の閲覧・何も書かない 200・応答の形・noStore・入力の形の 422。
// 書き込みの中身・前提の崩れは DB のテスト（db/case-todo.repository.history.db.test.ts）、読み直し・やり直しは Service のテストで確かめ、ここでは重ねない。
// 判定の順（計画 5.2）：
//   履歴：案件がない 404 → 有効な参加者でない 403「参加者だけが見られます（非公開）」→ perm.case.view → TODO がない・ほかの案件 404「TODOが見つかりません」
//     （削除済みは 404 にしない）→ 200
//   削除済みの一覧：404 → 403（同上）→ 200
//   復元：404 → 403「参加者だけが操作できます」→ TODO がない 404 → 終了中 409 closed → 削除されていなければ何も書かずに 200 → 200
// 契約（実装前の仮置き。計画 5.1。実装の担当へ）：
//   履歴の 200：{ items: [{ id, kind, createdAt, actor, title, previousTitle, assignee, previousAssignee }], nextCursor }（古い順）
//   削除済みの一覧の 200：{ items: [一覧の項目＋deletedAt・deletedBy], nextCursor }（進捗は返さない）
//   復元の 200：一覧の項目＋progress。本文は受け取らない（版は送らない。決定 Q2）
// 世界の対応：A＝memberS1（操作者）・B＝memberD1（参加者）・E＝memberS2（非参加）・G＝admin（非参加の全体管理者）・ownerS（非参加の担当部署のオーナー）。
//   K＝main（進行中）、K2＝other（進行中の別の案件。A・E が参加）、K3＝closed（終了。A・B が参加）。
// 無効な参加者は、セッションが認証で拒まれる（401）ため、この層では扱わない（DB のテストで not_visible を確かめる）。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  CASES_BASE,
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
  CASEREQ_NOW,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import {
  CASE_TODO_MESSAGES,
  CASE_TODO_REASONS,
  ISO,
  MISSING_TODO_ID,
  eventIdAt,
  insertTodo,
  insertTodoEvent,
  todoEventsOf,
  todoIdAt,
  todoRow,
} from "../../test/case-todo-fixtures";

type ErrorBody = { code: string; message: string; reason?: string };
type Person = { userId: string; displayName: string; isActive: boolean };
type EventBody = {
  id: string;
  kind: string;
  createdAt: string;
  actor: Person;
  title: string | null;
  previousTitle: string | null;
  assignee: Person | null;
  previousAssignee: Person | null;
};
type EventPage = { items: EventBody[]; nextCursor: string | null };
type DeletedPage = {
  items: (Record<string, unknown> & { id: string })[];
  nextCursor: string | null;
};

const NAME_A = "テスト操作者149C";
const NAME_B = "テスト担当149C";
const T1_TITLE = "[UNIT_TEST]149C見積書の作成";

let w: CaseWorld;
let logLines: string[];
let main: SeededCase;
let closed: SeededCase;
let other: SeededCase;

const eventsPath = (caseId: string, todoId: string) =>
  `${CASES_BASE}/${caseId}/todos/${todoId}/events`;
const historyOf = (
  caseId: string,
  todoId: string,
  token: string | null,
  query = "",
) => apiRequest("GET", `${eventsPath(caseId, todoId)}${query}`, { token });
const deletedOf = (caseId: string, token: string | null, query = "") =>
  apiRequest("GET", `${CASES_BASE}/${caseId}/deleted-todos${query}`, {
    token,
  });
const restoreOf = (caseId: string, todoId: string, token: string | null) =>
  apiRequest("POST", `${CASES_BASE}/${caseId}/todos/${todoId}/restore`, {
    token,
  });

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

/** T1（削除済み・未完了・担当 B・版2・記録 create→delete）、T2（未削除）、K3 の T4（削除済み）、K2 の T5（削除済み） */
async function seedWorld() {
  await insertTodo({
    id: todoIdAt(1),
    caseId: main.id,
    title: T1_TITLE,
    createdBy: w.memberS1.id,
    assigneeId: w.memberD1.id,
    recordedAssigneeName: NAME_B,
    deletedBy: w.memberS1.id,
    version: 2,
  });
  await insertTodoEvent({
    id: eventIdAt(1),
    todoId: todoIdAt(1),
    caseId: main.id,
    kind: "create",
    actorId: w.memberS1.id,
  });
  await insertTodoEvent({
    id: eventIdAt(2),
    todoId: todoIdAt(1),
    caseId: main.id,
    kind: "delete",
    actorId: w.memberS1.id,
  });
  await insertTodo({
    id: todoIdAt(2),
    caseId: main.id,
    title: "[UNIT_TEST]149C残っている",
    createdBy: w.memberS1.id,
    isDone: true,
  });
  await insertTodo({
    id: todoIdAt(4),
    caseId: closed.id,
    title: "[UNIT_TEST]149C終了中の消したもの",
    createdBy: w.memberS1.id,
    deletedBy: w.memberS1.id,
  });
  await insertTodo({
    id: todoIdAt(5),
    caseId: other.id,
    title: "[UNIT_TEST]149C別の案件の消したもの",
    createdBy: w.memberS2.id,
    deletedBy: w.memberS2.id,
  });
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
  await setDisplayName(w.memberS1.id, NAME_A);
  await setDisplayName(w.memberD1.id, NAME_B);
  main = await seedCase({
    n: 1551,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]149C結合",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
    ],
  });
  closed = await seedCase({
    n: 1552,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]149C終了",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    status: "closed",
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
    ],
  });
  other = await seedCase({
    n: 1553,
    clientId: w.clientB.id,
    code: "QZB",
    title: "[UNIT_TEST]149C別の案件",
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

/** 非参加者（R-76：全体管理者・担当部署のオーナーも不可） */
const OUTSIDERS: [string, () => string][] = [
  ["E（非参加の一般社員）", () => w.memberS2.token],
  ["G（非参加の全体管理者）", () => w.admin.token],
  ["非参加の担当部署のオーナー", () => w.ownerS.token],
];

describe("#149 149-C 認証とパスの形（計画 9.5 R9）", () => {
  it("#149 149-C: ログインしていなければ、3つの経路はどれも 401 で、何も変わらない", async () => {
    const responses = [
      await historyOf(main.id, todoIdAt(1), null),
      await deletedOf(main.id, null),
      await restoreOf(main.id, todoIdAt(1), null),
    ];
    expect(responses.map((r) => r.status)).toEqual([401, 401, 401]);
    expect((await todoRow(todoIdAt(1))).deleted_at).not.toBeNull();
  });

  it.each([
    ["履歴の caseId", (t: string) => historyOf("not-a-ulid", todoIdAt(1), t)],
    ["履歴の todoId", (t: string) => historyOf(main.id, "not-a-ulid", t)],
    ["削除済みの一覧の caseId", (t: string) => deletedOf("not-a-ulid", t)],
    ["復元の caseId", (t: string) => restoreOf("not-a-ulid", todoIdAt(1), t)],
    ["復元の todoId", (t: string) => restoreOf(main.id, "not-a-ulid", t)],
  ])(
    "#149 149-C R9: パスの %s が ULID の形でなければ 422",
    async (_l, call) => {
      await expectError(await call(w.memberS1.token), 422, {
        code: "VALIDATION_ERROR",
      });
    },
  );

  it.each([
    ["limit=101（最大は100）", "?limit=101"],
    ["limit=0", "?limit=0"],
    ["limit が数でない", "?limit=abc"],
    ["cursor が壊れている", "?cursor=%%%broken"],
  ])(
    "#149 149-C 決定 Q5 R9: %s は、履歴・削除済みの一覧のどちらも 422",
    async (_l, query) => {
      await expectError(
        await historyOf(main.id, todoIdAt(1), w.memberS1.token, query),
        422,
        { code: "VALIDATION_ERROR" },
      );
      await expectError(
        await deletedOf(main.id, w.memberS1.token, query),
        422,
        {
          code: "VALIDATION_ERROR",
        },
      );
    },
  );
});

describe("#149 149-C 5-4 AC-10・AC-14 EP-5-24 履歴（計画 9.5 R1〜R4）", () => {
  it("#149 149-C 5-4 AC-10 R1: ない案件の履歴は 404「案件が見つかりません」（logger.audit の理由 not_found）", async () => {
    await expectError(
      await historyOf(MISSING_CASE_ID, todoIdAt(1), w.memberS1.token),
      404,
      { code: "NOT_FOUND", message: CASE_TODO_MESSAGES.caseNotFound },
    );
    expect(auditsOf("case.todo.history", "not_found").length).toBeGreaterThan(
      0,
    );
  });

  it.each(OUTSIDERS)(
    "#149 149-C 5-4 AC-10 R-76 R1: %s には、ある TODO・ない TODO・ほかの案件の TODO・終了中の案件のどれでも同じ 403「参加者だけが見られます（非公開）」（TODO の有無を漏らさない）",
    async (_l, token) => {
      const targets: [string, string][] = [
        [main.id, todoIdAt(1)],
        [main.id, MISSING_TODO_ID],
        [main.id, todoIdAt(5)],
        [closed.id, todoIdAt(4)],
      ];
      for (const [caseId, todoId] of targets) {
        const res = await historyOf(caseId, todoId, token());
        const text = await res.clone().text();
        await expectError(res, 403, {
          code: "FORBIDDEN",
          message: CASE_TODO_MESSAGES.participantsOnlyView,
        });
        expect(text).not.toContain(T1_TITLE);
        expect(text).not.toContain(NAME_B);
      }
      expect(
        auditsOf("case.todo.history", "not_participant").length,
      ).toBeGreaterThan(0);
    },
  );

  it.each([
    ["ない TODO", () => MISSING_TODO_ID],
    ["ほかの案件の TODO", () => todoIdAt(5)],
  ])(
    "#149 149-C 5-4 AC-10 R2: 参加者が %s の履歴を求めると 404「TODOが見つかりません」",
    async (_l, todoOf) => {
      await expectError(
        await historyOf(main.id, todoOf(), w.memberS1.token),
        404,
        { code: "NOT_FOUND", message: CASE_TODO_MESSAGES.todoNotFound },
      );
    },
  );

  it("#149 149-C 5-4 AC-10・AC-12 R2: 削除済みの TODO の履歴は 200（古い順・応答の形・no-store）", async () => {
    const res = await historyOf(main.id, todoIdAt(1), w.memberS1.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
    const body = (await res.json()) as EventPage;
    expect(body.nextCursor).toBeNull();
    expect(body.items.map((e) => [e.id, e.kind])).toEqual([
      [eventIdAt(1), "create"],
      [eventIdAt(2), "delete"],
    ]);
    for (const event of body.items) {
      expect(event.createdAt).toMatch(ISO);
      expect(event.actor).toEqual({
        userId: w.memberS1.id,
        displayName: NAME_A,
        isActive: true,
      });
      expect(Object.keys(event).sort()).toEqual(
        [
          "actor",
          "assignee",
          "createdAt",
          "id",
          "kind",
          "previousAssignee",
          "previousTitle",
          "title",
        ].sort(),
      );
    }
  });

  it("#149 149-C 5-4 AC-10 R3: 後から参加した人にも、参加の前の記録が全部見える", async () => {
    await addCaseMember(main.roomId, w.ownerD.id, joinedAt(90));
    const res = await historyOf(main.id, todoIdAt(1), w.ownerD.token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventPage;
    expect(body.items.map((e) => e.id)).toEqual([eventIdAt(1), eventIdAt(2)]);
  });

  it("#149 149-C 5-4 AC-10 R4: 外された人は、履歴・削除済みの一覧のどちらも 403", async () => {
    await removeCaseMember(main.roomId, w.memberD1.id);
    await expectError(
      await historyOf(main.id, todoIdAt(1), w.memberD1.token),
      403,
      { code: "FORBIDDEN", message: CASE_TODO_MESSAGES.participantsOnlyView },
    );
    await expectError(await deletedOf(main.id, w.memberD1.token), 403, {
      code: "FORBIDDEN",
    });
  });
});

describe("#149 149-C 5-4 AC-12 EP-5-25 削除済みの一覧（計画 9.5 R5）", () => {
  it("#149 149-C 5-4 AC-12 R5: ない案件は 404「案件が見つかりません」", async () => {
    await expectError(await deletedOf(MISSING_CASE_ID, w.memberS1.token), 404, {
      code: "NOT_FOUND",
      message: CASE_TODO_MESSAGES.caseNotFound,
    });
  });

  it.each(OUTSIDERS)(
    "#149 149-C 5-4 AC-12 R-76 R5: %s には 403「参加者だけが見られます（非公開）」で、題名を出さない",
    async (_l, token) => {
      const res = await deletedOf(main.id, token());
      const text = await res.clone().text();
      await expectError(res, 403, {
        code: "FORBIDDEN",
        message: CASE_TODO_MESSAGES.participantsOnlyView,
      });
      expect(text).not.toContain(T1_TITLE);
      expect(
        auditsOf("case.todo.deleted_list", "not_participant").length,
      ).toBeGreaterThan(0);
    },
  );

  it("#149 149-C 5-4 AC-12 R5: 参加者には 200 で、その案件の削除済みだけ（項目＋deletedAt・deletedBy）。進捗は返さない。no-store", async () => {
    const res = await deletedOf(main.id, w.memberS1.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
    const body = (await res.json()) as DeletedPage & Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["items", "nextCursor"]);
    expect(body.items.map((t) => t.id)).toEqual([todoIdAt(1)]);
    expect(body.items[0]).toMatchObject({
      title: T1_TITLE,
      completed: false,
      version: 2,
      assignee: { userId: w.memberD1.id, displayName: NAME_B, isActive: true },
      previousAssignee: null,
      completedAssignee: null,
      deletedBy: {
        userId: w.memberS1.id,
        displayName: NAME_A,
        isActive: true,
      },
    });
    expect(body.items[0]?.deletedAt).toMatch(ISO);
  });
});

describe("#149 149-C 5-4 AC-9 終了中（計画 9.5 R6）", () => {
  it("#149 149-C 5-4 AC-9 R6: 終了中の案件でも、履歴・削除済みの一覧は 200、復元は 409 closed で何も変わらない", async () => {
    const events = await historyOf(closed.id, todoIdAt(4), w.memberS1.token);
    expect(events.status).toBe(200);
    const deleted = await deletedOf(closed.id, w.memberS1.token);
    expect(deleted.status).toBe(200);
    expect(
      ((await deleted.json()) as DeletedPage).items.map((t) => t.id),
    ).toEqual([todoIdAt(4)]);
    await expectError(
      await restoreOf(closed.id, todoIdAt(4), w.memberS1.token),
      409,
      {
        code: "CONFLICT",
        message: CASE_TODO_MESSAGES.closed,
        reason: CASE_TODO_REASONS.closed,
      },
    );
    expect((await todoRow(todoIdAt(4))).deleted_at).not.toBeNull();
  });
});

describe("#149 149-C 5-4 AC-13 EP-5-26 復元：判定の順（計画 9.5 R7・R8）", () => {
  it("#149 149-C 5-4 AC-13 R7: ない案件への復元は 404「案件が見つかりません」", async () => {
    await expectError(
      await restoreOf(MISSING_CASE_ID, todoIdAt(1), w.memberS1.token),
      404,
      { code: "NOT_FOUND", message: CASE_TODO_MESSAGES.caseNotFound },
    );
    expect(auditsOf("case.todo.restore", "not_found").length).toBeGreaterThan(
      0,
    );
  });

  it.each(OUTSIDERS)(
    "#149 149-C 5-4 AC-13 R-76 R7: %s には、ある TODO・ない TODO・ほかの案件の TODO・終了中の案件のどれでも同じ 403「参加者だけが操作できます」で、何も変わらない",
    async (_l, token) => {
      const targets: [string, string][] = [
        [main.id, todoIdAt(1)],
        [main.id, MISSING_TODO_ID],
        [main.id, todoIdAt(5)],
        [closed.id, todoIdAt(4)],
      ];
      for (const [caseId, todoId] of targets)
        await expectError(await restoreOf(caseId, todoId, token()), 403, {
          code: "FORBIDDEN",
          message: CASE_TODO_MESSAGES.participantsOnlyEdit,
        });
      expect((await todoRow(todoIdAt(1))).deleted_at).not.toBeNull();
      expect(
        auditsOf("case.todo.restore", "not_participant").length,
      ).toBeGreaterThan(0);
    },
  );

  it.each([
    ["ない TODO", () => MISSING_TODO_ID],
    ["ほかの案件の TODO（削除済み）", () => todoIdAt(5)],
  ])(
    "#149 149-C 5-4 AC-13 R7: 参加者が %s を復元すると 404「TODOが見つかりません」",
    async (_l, todoOf) => {
      await expectError(
        await restoreOf(main.id, todoOf(), w.memberS1.token),
        404,
        { code: "NOT_FOUND", message: CASE_TODO_MESSAGES.todoNotFound },
      );
      expect((await todoRow(todoIdAt(5))).deleted_at).not.toBeNull();
    },
  );

  it("#149 149-C 5-4 AC-9 R7: 終了中の案件の、削除されていない TODO の復元も 409 closed（何も書かない 200 より先）", async () => {
    await insertTodo({
      id: todoIdAt(6),
      caseId: closed.id,
      title: "[UNIT_TEST]149C終了中の残っているもの",
      createdBy: w.memberS1.id,
    });
    await expectError(
      await restoreOf(closed.id, todoIdAt(6), w.memberS1.token),
      409,
      { code: "CONFLICT", reason: CASE_TODO_REASONS.closed },
    );
  });

  it("#149 149-C 決定 Q2 R7: 削除されていない TODO の復元は、何も書かずに 200（いまの項目と進捗）。記録は増えない", async () => {
    const before = await todoRow(todoIdAt(2));
    const res = await restoreOf(main.id, todoIdAt(2), w.memberS1.token);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: todoIdAt(2),
      completed: true,
      version: before.version,
      progress: { done: 1, total: 1 },
    });
    expect(await todoRow(todoIdAt(2))).toEqual(before);
    expect(await todoEventsOf(todoIdAt(2))).toEqual([]);
  });

  it("#149 149-C 5-4 AC-13 R8: 復元の成功は 200 で、項目（一覧と同じ形）と progress を返し、no-store。記録 restore が1件増え、一覧に戻る", async () => {
    const res = await restoreOf(main.id, todoIdAt(1), w.memberS1.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      id: todoIdAt(1),
      title: T1_TITLE,
      completed: false,
      version: 3,
      assignee: { userId: w.memberD1.id, displayName: NAME_B, isActive: true },
      previousAssignee: null,
      completedAssignee: null,
      progress: { done: 1, total: 2 },
    });
    expect((await todoEventsOf(todoIdAt(1))).map((e) => e.kind)).toEqual([
      "create",
      "delete",
      "restore",
    ]);
    const list = await apiRequest("GET", `${CASES_BASE}/${main.id}/todos`, {
      token: w.memberS1.token,
    });
    const page = (await list.json()) as { items: { id: string }[] };
    expect(page.items.map((t) => t.id)).toEqual([todoIdAt(1), todoIdAt(2)]);
    const deleted = (await (
      await deletedOf(main.id, w.memberS1.token)
    ).json()) as DeletedPage;
    expect(deleted.items).toEqual([]);
  });

  it("#149 149-C 5-4 AC-13 R8: 復元の成功と、2回目の復元（何も書かずに 200）で、記録 restore は1件のまま", async () => {
    expect(
      (await restoreOf(main.id, todoIdAt(1), w.memberS1.token)).status,
    ).toBe(200);
    expect(
      (await restoreOf(main.id, todoIdAt(1), w.memberD1.token)).status,
    ).toBe(200);
    expect(
      (await todoEventsOf(todoIdAt(1))).filter((e) => e.kind === "restore"),
    ).toHaveLength(1);
  });

  it("#149 149-C 6節: 復元の後、削除の前の画面の版（2）で編集すると 409 todo_changed、削除済みのままの TODO の編集は 409 todo_deleted", async () => {
    const deletedEdit = await apiRequest(
      "PATCH",
      `${CASES_BASE}/${main.id}/todos/${todoIdAt(1)}`,
      {
        token: w.memberS1.token,
        body: { version: 2, title: "[UNIT_TEST]149C改題" },
      },
    );
    await expectError(deletedEdit, 409, {
      reason: CASE_TODO_REASONS.todoDeleted,
    });
    await restoreOf(main.id, todoIdAt(1), w.memberS1.token);
    const staleEdit = await apiRequest(
      "PATCH",
      `${CASES_BASE}/${main.id}/todos/${todoIdAt(1)}`,
      {
        token: w.memberS1.token,
        body: { version: 2, title: "[UNIT_TEST]149C改題" },
      },
    );
    await expectError(staleEdit, 409, {
      reason: CASE_TODO_REASONS.todoChanged,
    });
  });
});

describe("#149 149-C 履歴の複数のページ（計画 9.5・決定 Q5）", () => {
  it("#149 149-C 5-4 AC-10 決定 Q5: 記録が101件なら、既定の limit で 100件と nextCursor、続きで1件", async () => {
    await env.DB.prepare("DELETE FROM case_todo_events").run();
    for (let i = 1; i <= 101; i += 1)
      await insertTodoEvent({
        id: eventIdAt(i),
        todoId: todoIdAt(1),
        caseId: main.id,
        kind: "uncomplete",
        actorId: w.memberS1.id,
      });
    const first = (await (
      await historyOf(main.id, todoIdAt(1), w.memberS1.token)
    ).json()) as EventPage;
    expect(first.items).toHaveLength(100);
    expect(first.nextCursor).not.toBeNull();
    const second = (await (
      await historyOf(
        main.id,
        todoIdAt(1),
        w.memberS1.token,
        `?cursor=${encodeURIComponent(first.nextCursor ?? "")}`,
      )
    ).json()) as EventPage;
    expect(second.items.map((e) => e.id)).toEqual([eventIdAt(101)]);
    expect(second.nextCursor).toBeNull();
  });
});
