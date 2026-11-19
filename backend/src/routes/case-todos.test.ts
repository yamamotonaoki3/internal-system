// #149（149-A）5-4 AC-1〜AC-4・AC-6・AC-8（取り消し）・AC-9、R-76、決定 Q3・Q4、計画 6.2・6.3：TODO の API（EP-5-13・14・17・18）を、
// 実際のアプリ入口（index.ts の app）と隔離 D1 で確かめる。
// この層で確かめるもの：判定の順と応答（401・404・403・422・409 と reason）・存在の非開示（非参加者には、TODO の ID の有無・ほかの案件の TODO・
//   削除済み・本文の誤り・終了中を区別させず 403）・すでにその状態なら何も書かずに 200（決定 Q3）・応答の形・noStore・再認証を求めないこと。
// batch の前提が崩れたときに何も残らないこと・記録の中身・ID の順の逆転は、DB のテスト（db/case-todo.repository.db.test.ts）と
//   Service のテスト（services/case-todo.service.db.test.ts）・割り込みのテスト（services/case-todo.interleave.test.ts）で確かめ、ここでは重ねない。
// 判定の順（計画 6.3）：
//   一覧：認証 → 案件がない 404「案件が見つかりません」→ 有効な参加者でない 403「参加者だけが見られます（非公開）」→ 200
//   追加：404 → 403「参加者だけが操作できます」→ 本文・題名 422（fields title）→ 担当者が有効な参加者でない・いない 422
//     （fields assigneeUserId、「担当者は、この案件の参加者から選んでください」。同じ文）→ 終了中 409 closed → 201
//   完了・取り消し：404 → 403 → TODO がない・ほかの案件の TODO 404「TODOが見つかりません」→ 削除済み 409 todo_deleted
//     → 終了中 409 closed → すでにその状態なら何も書かずに 200 → 200
// 契約（実装前の仮置き。実装の担当へ）：
//   一覧 200 { items: TodoItem[], nextCursor: string | null, progress: { done, total } | null }。limit は既定 100・最大 100（決定 Q4）
//   TodoItem のキーは、ちょうど id・title・completed・version・assignee・previousAssignee・completedAssignee（計画 6.9(1)）
//     Person = { userId, displayName, isActive }
//   追加 201 { id, title, completed: false, version: 1, assignee, progress, … }（api-draft EP-5-14 の平らな形）
//   完了・取り消し 200 { id, completed, version, progress }
//   409 の本文は { code: "CONFLICT", message, reason }。422 は { code: "VALIDATION_ERROR", message, fields }
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  CASES_BASE,
  MISSING_CASE_ID,
  cleanupCaseTestData,
  joinedAt,
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
  insertTodo,
  todoEventsOf,
  todoIdAt,
  todoRow,
  todoRowsOf,
} from "../../test/case-todo-fixtures";
import { env } from "cloudflare:workers";

type ErrorBody = {
  code: string;
  message: string;
  fields?: string[];
  reason?: string;
};
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
type TodoPage = {
  items: TodoItem[];
  nextCursor: string | null;
  progress: { done: number; total: number } | null;
};

const ITEM_KEYS = [
  "assignee",
  "completed",
  "completedAssignee",
  "id",
  "previousAssignee",
  "title",
  "version",
];

const NAME_D1 = "テスト担当149";

let w: CaseWorld;
let logLines: string[];
/** 進行中・deptS 担当：memberS1・memberD1・inactive（無効・参加の行は残る）。memberS2・ownerS・admin は非参加 */
let main: SeededCase;
/** 終了・deptS 担当：memberS1・memberD1 */
let closed: SeededCase;
/** 進行中の別の案件：memberS1・memberS2 */
let other: SeededCase;

const todosPath = (caseId: string) => `${CASES_BASE}/${caseId}/todos`;
const listOf = (caseId: string, token: string | null, query = "") =>
  apiRequest("GET", `${todosPath(caseId)}${query}`, { token });
const addTo = (caseId: string, token: string | null, body: unknown) =>
  apiRequest("POST", todosPath(caseId), { token, body });
const completeOf = (caseId: string, todoId: string, token: string | null) =>
  apiRequest("POST", `${todosPath(caseId)}/${todoId}/complete`, { token });
const uncompleteOf = (caseId: string, todoId: string, token: string | null) =>
  apiRequest("POST", `${todosPath(caseId)}/${todoId}/uncomplete`, { token });

async function expectError(
  res: Response,
  status: number,
  expected: Partial<ErrorBody>,
) {
  expect(res.status).toBe(status);
  expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
  expect(await res.json()).toMatchObject(expected);
}

const failureAudits = () => logLines.filter((line) => line.includes("failure"));

const seedTodo = (
  caseRoom: SeededCase,
  n: number,
  options: {
    done?: boolean;
    deleted?: boolean;
    assigneeId?: string | null;
  } = {},
) => {
  const assigneeId =
    options.assigneeId === undefined ? w.memberD1.id : options.assigneeId;
  return insertTodo({
    id: todoIdAt(n),
    caseId: caseRoom.id,
    title: `[UNIT_TEST]149A項目${n}`,
    createdBy: w.memberS1.id,
    assigneeId,
    recordedAssigneeName: assigneeId === null ? null : NAME_D1,
    isDone: options.done === true,
    completedAssigneeId: options.done === true ? assigneeId : null,
    completedAssigneeName:
      options.done === true && assigneeId !== null ? NAME_D1 : null,
    deletedBy: options.deleted === true ? w.memberS1.id : null,
  });
};

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
  await setDisplayName(w.memberD1.id, NAME_D1);
  main = await seedCase({
    n: 1494,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]149A結合",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
      { userId: w.inactive.id, joinedAt: joinedAt(3) },
    ],
  });
  closed = await seedCase({
    n: 1495,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]149A終了",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    status: "closed",
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
    ],
  });
  other = await seedCase({
    n: 1496,
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
  vi.restoreAllMocks();
  await cleanupCaseTestData();
});

/**
 * 非参加者（R-76：全体管理者・担当部署のオーナーも不可）。
 * 無効な参加者は、セッションが認証で拒まれる（401）ため、この層では扱わない（DB・Service・割り込みのテストで確かめる）
 */
const OUTSIDERS: [string, () => string][] = [
  ["非参加の一般社員", () => w.memberS2.token],
  ["非参加の全体管理者", () => w.admin.token],
  ["非参加の担当部署のオーナー", () => w.ownerS.token],
];

describe("#149 AC-1 認証とパスの形", () => {
  it("#149 AC-1: ログインしていなければ、4つの経路はどれも 401", async () => {
    await seedTodo(main, 1);
    const responses = [
      await listOf(main.id, null),
      await addTo(main.id, null, { title: "[UNIT_TEST]149A" }),
      await completeOf(main.id, todoIdAt(1), null),
      await uncompleteOf(main.id, todoIdAt(1), null),
    ];
    expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401]);
    expect(await todoRow(todoIdAt(1))).toMatchObject({
      is_done: 0,
      version: 1,
    });
  });

  it.each([
    ["一覧の caseId", (t: string) => listOf("not-a-ulid", t)],
    ["追加の caseId", (t: string) => addTo("not-a-ulid", t, { title: "a" })],
    ["完了の caseId", (t: string) => completeOf("not-a-ulid", todoIdAt(1), t)],
    ["完了の todoId", (t: string) => completeOf(main.id, "not-a-ulid", t)],
    [
      "取り消しの todoId",
      (t: string) => uncompleteOf(main.id, "not-a-ulid", t),
    ],
  ])("#149 AC-1: パスの %s が ULID の形でなければ 422", async (_l, call) => {
    await expectError(await call(w.memberS1.token), 422, {
      code: "VALIDATION_ERROR",
    });
  });
});

describe("#149 AC-1 5-4 AC-1・AC-4 EP-5-13 一覧", () => {
  it("#149 AC-1 5-4 AC-1・AC-4: 参加者には、項目（題名・担当・完了か・版）と進捗を返す。noStore", async () => {
    await seedTodo(main, 1, { done: true });
    await seedTodo(main, 2, { assigneeId: null });
    await seedTodo(main, 3, { deleted: true });
    const res = await listOf(main.id, w.memberS1.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
    const body = (await res.json()) as TodoPage;
    expect(body.items.map((i) => [i.id, i.completed])).toEqual([
      [todoIdAt(1), true],
      [todoIdAt(2), false],
    ]);
    for (const item of body.items)
      expect(Object.keys(item).sort()).toEqual(ITEM_KEYS);
    expect(body.items[1]).toMatchObject({
      title: "[UNIT_TEST]149A項目2",
      assignee: null,
      version: 1,
    });
    expect(body.items[0]?.completedAssignee).toEqual({
      userId: w.memberD1.id,
      displayName: NAME_D1,
      isActive: true,
    });
    expect(body.progress).toEqual({ done: 1, total: 2 });
    expect(body.nextCursor).toBeNull();
  });

  it("#149 AC-1 5-4 AC-4: 0件なら items は空、進捗は null", async () => {
    const body = (await (
      await listOf(main.id, w.memberS1.token)
    ).json()) as TodoPage;
    expect(body).toEqual({ items: [], nextCursor: null, progress: null });
  });

  it("#149 AC-1 5-4 AC-9: 終了した案件でも、参加者は一覧を読める", async () => {
    await seedTodo(closed, 1);
    const res = await listOf(closed.id, w.memberS1.token);
    expect(res.status).toBe(200);
    expect(((await res.json()) as TodoPage).items).toHaveLength(1);
  });

  it("#149 AC-1 決定 Q4: limit の既定は 100。101件なら 100件と nextCursor、続きで1件", async () => {
    await env.DB.batch(
      Array.from({ length: 101 }, (_, i) =>
        env.DB.prepare(
          `INSERT INTO case_todos (id, case_id, title, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(
          todoIdAt(200 + i),
          main.id,
          `[UNIT_TEST]149A多数${i}`,
          w.memberS1.id,
          CASEREQ_NOW,
          CASEREQ_NOW,
        ),
      ),
    );
    const first = (await (
      await listOf(main.id, w.memberS1.token)
    ).json()) as TodoPage;
    expect(first.items).toHaveLength(100);
    expect(first.nextCursor).not.toBeNull();
    expect(first.progress).toEqual({ done: 0, total: 101 });
    const second = (await (
      await listOf(
        main.id,
        w.memberS1.token,
        `?cursor=${encodeURIComponent(first.nextCursor ?? "")}`,
      )
    ).json()) as TodoPage;
    expect(second.items.map((i) => i.id)).toEqual([todoIdAt(300)]);
    expect(second.nextCursor).toBeNull();
  });

  it.each([
    ["limit=101（最大は100）", "?limit=101"],
    ["limit=0", "?limit=0"],
    ["limit が数でない", "?limit=abc"],
    ["cursor が壊れている", "?cursor=%%%broken"],
  ])("#149 AC-1 決定 Q4: %s は 422", async (_l, query) => {
    await expectError(await listOf(main.id, w.memberS1.token, query), 422, {
      code: "VALIDATION_ERROR",
    });
  });

  it("#149 AC-1: 案件がなければ 404「案件が見つかりません」（logger.audit に残す）", async () => {
    await expectError(await listOf(MISSING_CASE_ID, w.memberS1.token), 404, {
      code: "NOT_FOUND",
      message: CASE_TODO_MESSAGES.caseNotFound,
    });
    expect(failureAudits().length).toBeGreaterThan(0);
  });

  it.each(OUTSIDERS)(
    "#149 AC-1 R-76: %s には 403「参加者だけが見られます（非公開）」で、項目も進捗も返さない",
    async (_l, token) => {
      await seedTodo(main, 1);
      const res = await listOf(main.id, token());
      expect(res.status).toBe(403);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        code: "FORBIDDEN",
        message: CASE_TODO_MESSAGES.participantsOnlyView,
      });
      expect(body).not.toHaveProperty("items");
      expect(body).not.toHaveProperty("progress");
      expect(failureAudits().length).toBeGreaterThan(0);
    },
  );
});

describe("#149 AC-1 5-4 AC-2・AC-6・AC-9 EP-5-14 追加", () => {
  it("#149 AC-1 5-4 AC-2・AC-6: 参加者が担当者つきで追加すると 201。題名は整形（C-121）され、未完了・版1・進捗つき。再認証なしで通る", async () => {
    const res = await addTo(main.id, w.memberS1.token, {
      title: "　ＡＢＣ　　見積り ",
      assigneeUserId: w.memberD1.id,
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
    const body = (await res.json()) as TodoItem & {
      progress: { done: number; total: number } | null;
    };
    expect(body).toMatchObject({
      title: "ABC 見積り",
      completed: false,
      version: 1,
      assignee: { userId: w.memberD1.id, displayName: NAME_D1, isActive: true },
      progress: { done: 0, total: 1 },
    });
    const [row] = await todoRowsOf(main.id);
    expect(row?.id).toBe(body.id);
    expect(row).toMatchObject({
      title: "ABC 見積り",
      created_by: w.memberS1.id,
    });
  });

  it.each([
    ["null", { assigneeUserId: null }],
    ["省略", {}],
  ])(
    "#149 AC-1 5-4 AC-6: 担当者が %s なら担当なしで追加できる",
    async (_l, extra) => {
      const res = await addTo(main.id, w.memberS1.token, {
        title: "[UNIT_TEST]149A担当なし",
        ...extra,
      });
      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({ assignee: null });
    },
  );

  it("#149 AC-1: 案件がなければ 404", async () => {
    await expectError(
      await addTo(MISSING_CASE_ID, w.memberS1.token, { title: "a" }),
      404,
      { code: "NOT_FOUND", message: CASE_TODO_MESSAGES.caseNotFound },
    );
  });

  it.each(OUTSIDERS)(
    "#149 AC-1 R-76 存在の非開示: %s には、正しい本文・本文の誤り・担当者の誤り・終了した案件のどれでも、同じ 403「参加者だけが操作できます」",
    async (_l, token) => {
      const bodies: [string, unknown][] = [
        [main.id, { title: "[UNIT_TEST]149A" }],
        [main.id, { title: "" }],
        [main.id, "not-an-object"],
        [main.id, { title: "a", assigneeUserId: w.memberS2.id }],
        [closed.id, { title: "[UNIT_TEST]149A" }],
      ];
      for (const [caseId, body] of bodies)
        await expectError(await addTo(caseId, token(), body), 403, {
          code: "FORBIDDEN",
          message: CASE_TODO_MESSAGES.participantsOnlyEdit,
        });
      expect(await todoRowsOf(main.id)).toEqual([]);
    },
  );

  it.each([
    ["題名が空", { title: "" }],
    ["題名が空白だけ", { title: "　 " }],
    ["題名が101文字", { title: "あ".repeat(101) }],
    ["題名がない", {}],
    ["題名が文字列でない", { title: 1 }],
  ])(
    "#149 AC-1 5-4 AC-2（C-90）: %s なら 422（fields title）",
    async (_l, body) => {
      await expectError(await addTo(main.id, w.memberS1.token, body), 422, {
        code: "VALIDATION_ERROR",
        fields: ["title"],
      });
      expect(await todoRowsOf(main.id)).toEqual([]);
    },
  );

  it("#149 AC-1 5-4 AC-2: 題名がちょうど100文字なら追加できる", async () => {
    const res = await addTo(main.id, w.memberS1.token, {
      title: "あ".repeat(100),
    });
    expect(res.status).toBe(201);
  });

  it.each([
    ["本文がオブジェクトでない", "x"],
    ["決めていない項目がある（strict）", { title: "a", dueDate: "2026-12-01" }],
  ])("#149 AC-1 5-4 AC-5: %s なら 422", async (_l, body) => {
    await expectError(await addTo(main.id, w.memberS1.token, body), 422, {
      code: "VALIDATION_ERROR",
    });
  });

  it.each([
    ["非参加の社員", () => w.memberS2.id],
    ["無効な参加者", () => w.inactive.id],
    ["いない利用者", () => MISSING_CASE_ID],
  ])(
    "#149 AC-1 5-4 AC-6: 担当者が %s なら 422（fields assigneeUserId、どれも同じ文）",
    async (_l, assignee) => {
      await expectError(
        await addTo(main.id, w.memberS1.token, {
          title: "[UNIT_TEST]149A",
          assigneeUserId: assignee(),
        }),
        422,
        {
          code: "VALIDATION_ERROR",
          fields: ["assigneeUserId"],
          message: CASE_TODO_MESSAGES.assigneeInvalid,
        },
      );
      expect(await todoRowsOf(main.id)).toEqual([]);
    },
  );

  it("#149 AC-1 5-4 AC-6: 担当者の ID が ULID の形でなければ 422（fields assigneeUserId）", async () => {
    await expectError(
      await addTo(main.id, w.memberS1.token, {
        title: "[UNIT_TEST]149A",
        assigneeUserId: "not-a-ulid",
      }),
      422,
      { code: "VALIDATION_ERROR", fields: ["assigneeUserId"] },
    );
  });

  it("#149 AC-1 5-4 AC-9: 終了した案件では 409 closed「終了した案件は変更できません」で、何も残らない", async () => {
    await expectError(
      await addTo(closed.id, w.memberS1.token, { title: "[UNIT_TEST]149A" }),
      409,
      {
        code: "CONFLICT",
        reason: CASE_TODO_REASONS.closed,
        message: CASE_TODO_MESSAGES.closed,
      },
    );
    expect(await todoRowsOf(closed.id)).toEqual([]);
  });

  it("#149 AC-1 計画 6.3: 終了した案件でも、担当者の誤りは 422 が先（147-B と同じ順）", async () => {
    await expectError(
      await addTo(closed.id, w.memberS1.token, {
        title: "[UNIT_TEST]149A",
        assigneeUserId: w.memberS2.id,
      }),
      422,
      { fields: ["assigneeUserId"] },
    );
  });

  it("#149 AC-1 5-4 AC-1: 追加した項目は、ほかの参加者の一覧に未完了で出る", async () => {
    await addTo(main.id, w.memberS1.token, { title: "[UNIT_TEST]149A共有" });
    const body = (await (
      await listOf(main.id, w.memberD1.token)
    ).json()) as TodoPage;
    expect(body.items.map((i) => [i.title, i.completed])).toEqual([
      ["[UNIT_TEST]149A共有", false],
    ]);
  });
});

describe.each([
  ["EP-5-17 完了", completeOf, false, true],
  ["EP-5-18 取り消し", uncompleteOf, true, false],
] as const)(
  "#149 AC-1 5-4 AC-3・AC-8・AC-9 %s",
  (label, call, startDone, endDone) => {
    it(`#149 AC-1 ${label}: 参加者なら誰でもでき、200 { id, completed, version, progress }。再認証なしで通る`, async () => {
      await seedTodo(main, 1, { done: startDone });
      await seedTodo(main, 2, { done: true });
      const res = await call(main.id, todoIdAt(1), w.memberD1.token);
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
      expect(await res.json()).toEqual({
        id: todoIdAt(1),
        completed: endDone,
        version: 2,
        progress: { done: endDone ? 2 : 1, total: 2 },
      });
      expect((await todoRow(todoIdAt(1))).is_done).toBe(endDone ? 1 : 0);
    });

    it(`#149 AC-1 決定 Q3 ${label}: すでにその状態なら、何も書かずに 200（版・記録は変わらない）`, async () => {
      await seedTodo(main, 1, { done: endDone });
      const res = await call(main.id, todoIdAt(1), w.memberS1.token);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        id: todoIdAt(1),
        completed: endDone,
        version: 1,
        progress: { done: endDone ? 1 : 0, total: 1 },
      });
      expect((await todoRow(todoIdAt(1))).version).toBe(1);
      expect(await todoEventsOf(todoIdAt(1))).toEqual([]);
    });

    it(`#149 AC-1 ${label}: 案件がなければ 404「案件が見つかりません」`, async () => {
      await expectError(
        await call(MISSING_CASE_ID, todoIdAt(1), w.memberS1.token),
        404,
        { code: "NOT_FOUND", message: CASE_TODO_MESSAGES.caseNotFound },
      );
    });

    it.each(OUTSIDERS)(
      `#149 AC-1 R-76 存在の非開示 ${label}: %s には、ある TODO・ない TODO・ほかの案件の TODO・削除済み・終了した案件のどれでも、同じ 403`,
      async (_l, token) => {
        await seedTodo(main, 1, { done: startDone });
        await seedTodo(main, 2, { done: startDone, deleted: true });
        await seedTodo(other, 3, { done: startDone, assigneeId: null });
        await seedTodo(closed, 4, { done: startDone });
        const targets: [string, string][] = [
          [main.id, todoIdAt(1)],
          [main.id, MISSING_TODO_ID],
          [main.id, todoIdAt(3)],
          [main.id, todoIdAt(2)],
          [closed.id, todoIdAt(4)],
        ];
        for (const [caseId, todoId] of targets)
          await expectError(await call(caseId, todoId, token()), 403, {
            code: "FORBIDDEN",
            message: CASE_TODO_MESSAGES.participantsOnlyEdit,
          });
        expect((await todoRow(todoIdAt(1))).version).toBe(1);
      },
    );

    it(`#149 AC-1 security ${label}: 参加者でも、ない TODO・ほかの案件の TODO は 404「TODOが見つかりません」`, async () => {
      await seedTodo(other, 3, { done: startDone, assigneeId: null });
      for (const todoId of [MISSING_TODO_ID, todoIdAt(3)])
        await expectError(await call(main.id, todoId, w.memberS1.token), 404, {
          code: "NOT_FOUND",
          message: CASE_TODO_MESSAGES.todoNotFound,
        });
      expect((await todoRow(todoIdAt(3))).version).toBe(1);
    });

    it(`#149 AC-1 ${label}: 削除済みの TODO は 409 todo_deleted「このTODOは削除されています」`, async () => {
      await seedTodo(main, 1, { done: startDone, deleted: true });
      await expectError(
        await call(main.id, todoIdAt(1), w.memberS1.token),
        409,
        {
          code: "CONFLICT",
          reason: CASE_TODO_REASONS.todoDeleted,
          message: CASE_TODO_MESSAGES.todoDeleted,
        },
      );
    });

    it(`#149 AC-1 5-4 AC-9 ${label}: 終了した案件では 409 closed で、何も変わらない`, async () => {
      await seedTodo(closed, 1, { done: startDone });
      await expectError(
        await call(closed.id, todoIdAt(1), w.memberS1.token),
        409,
        {
          code: "CONFLICT",
          reason: CASE_TODO_REASONS.closed,
          message: CASE_TODO_MESSAGES.closed,
        },
      );
      expect(await todoRow(todoIdAt(1))).toMatchObject({
        is_done: startDone ? 1 : 0,
        version: 1,
      });
    });

    it(`#149 AC-1 計画 6.3 ${label}: 終了した案件の削除済みの TODO は、todo_deleted が closed より先`, async () => {
      await seedTodo(closed, 1, { done: startDone, deleted: true });
      await expectError(
        await call(closed.id, todoIdAt(1), w.memberS1.token),
        409,
        { reason: CASE_TODO_REASONS.todoDeleted },
      );
    });

    it(`#149 AC-1 決定 Q3 ${label}: 終了した案件では、すでにその状態でも 409 closed（200 より先）`, async () => {
      await seedTodo(closed, 1, { done: endDone });
      await expectError(
        await call(closed.id, todoIdAt(1), w.memberS1.token),
        409,
        { reason: CASE_TODO_REASONS.closed },
      );
    });
  },
);

describe("#149 AC-1 5-4 AC-3・AC-8・AC-11 完了と取り消しの流れ", () => {
  it("#149 AC-1 5-4 AC-11: 完了 → 取り消し → 再完了で、記録は complete・uncomplete・complete の3件（消さない・書き換えない）", async () => {
    await seedTodo(main, 1);
    expect(
      (await completeOf(main.id, todoIdAt(1), w.memberS1.token)).status,
    ).toBe(200);
    expect(
      (await uncompleteOf(main.id, todoIdAt(1), w.memberD1.token)).status,
    ).toBe(200);
    expect(
      (await completeOf(main.id, todoIdAt(1), w.memberD1.token)).status,
    ).toBe(200);
    expect(
      (await todoEventsOf(todoIdAt(1))).map((e) => [e.kind, e.actor_id]),
    ).toEqual([
      ["complete", w.memberS1.id],
      ["uncomplete", w.memberD1.id],
      ["complete", w.memberD1.id],
    ]);
    expect((await todoRow(todoIdAt(1))).version).toBe(4);
  });
});
