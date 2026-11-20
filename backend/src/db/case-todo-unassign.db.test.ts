// #149（149-D）5-4 AC-6（担当者が外れたとき）・5-1 AC-3・決定 C-24、計画 6.3.1〜6.3.3・6.3.6・10節「149-D」：
// 参加者の削除・本人の退出（case.repository.ts の removeParticipant）で、外れた人が担当の TODO の担当を「担当なし」に書き換え、
// 記録 auto_unassign を残すことを、マイグレーション済みの D1（本物の db.batch）で確かめる。
// この層で確かめるもの：
//   - 規則（計画 6.3.1）：外れた人が現在の担当で、未完了・未削除の TODO（その案件のものだけ）の assignee_id が NULL、recorded_assignee_* は残る、
//     版+1、updated_at＝操作の時刻。記録 auto_unassign が書き換えた件数だけ（assignee_id＝外れた人、assignee_name＝保存した名前、actor＝外した人。
//     退出なら本人）。完了済み・削除済み（決定 Q4）・ほかの人が担当・担当なし・ほかの案件の TODO は変わらない
//   - 監査（決定）：case.participant.remove が1件のまま、detail は変えない（caseId・userId・self）。TODO の操作は監査ログに残さない
//   - 0件：担当の TODO がない人の削除は、これまでどおり成功する
//   - 重大1の退行：担当の未完了の TODO が2件ある人の削除・退出で、参加の行が「消えている」
//   - 文の差し替え（buildRemoveParticipantStatements）：参加の行の DELETE が0行なら全部戻る／n が実際と違えば全部戻る／
//     読み取りの後に対象が増えれば全部戻る／中身が入れ替わって件数が同じなら、batch の時点の対象を処理して成功する
//   - 記録の ID（重大3）：別の TODO に全体の最大の記録があり、時計がそれより前でも、主キーの違反なく成功する
//   - 戻らない（決定）：外した後にもう一度参加させても、担当は NULL のまま
//   - 版の効果：外した後に、外す前の版で編集すると取り消される（画面の 409 todo_changed の元）
//   - D1 の上限：対象 150 件でも1回で成功し、文の数は件数によらない
// Service のやり直し・503 は services/case-todo-unassign.interleave.test.ts、無効化は account.repository.case-participation.db.test.ts、
// 再開の除外は case-reopen-reselect.db.test.ts、実行計画は case-todo.explain.db.test.ts で確かめ、ここでは重ねない。
// 契約（実装前の仮置き。計画 6.3.2・6.3.3・10節。実装の担当へ）：backend/src/db/case.repository.ts に
//   export function buildRemoveParticipantStatements(db: Database, input: CaseParticipantWriteInput, plan: { n: number; idsJson: string }): BatchItem の配列
//     （同期・非同期のどちらでもよい）。plan は readUnassignPlan（case-todo-unassign.sql.ts）が返す形：n＝対象の件数、idsJson＝記録の ID の昇順の JSON の配列。
//     本番の removeParticipant は、readUnassignPlan で plan を読み、これを db.batch に渡すだけ。
//     文の順は計画 6.3.3 の表（前提〔condition AND unassignPreSql〕→ 監査 → guard(1) → 記録 → guard(n) → 担当の UPDATE → guard(n)
//     → 参加の行の DELETE → guard(1) → 不変条件）。テストは文の SQL で channel_members の DELETE を見つける。
//   崩れたら CaseStateChangedError（batch 全体が取り消される）。
// 時刻は CASEREQ_NOW に固定する。データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { channelMembers } from "../../db/schema";
import {
  addCaseMember,
  cleanupCaseTestData,
  joinedAt,
  seedCase,
  setDisplayName,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  caseWriteAudits,
  parseDetail,
  participantIdsOf,
} from "../../test/case-participant-fixtures";
import {
  CASEREQ_NOW,
  casereqTraceId,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import {
  auditLogCount,
  eventIdAt,
  futureIdAt,
  insertTodo,
  insertTodoEvent,
  todoIdAt,
  todoRow,
  todoSnapshot,
  type TodoEventRow,
  type TodoRow,
} from "../../test/case-todo-fixtures";
import { ulidAfter } from "../lib/ulid";
import { withCaseTodos } from "./case-todo.repository";
import {
  CaseStateChangedError,
  buildRemoveParticipantStatements,
  runWriteBatch,
  withCases,
  type CaseParticipantWriteInput,
} from "./case.repository";
import { caseAssigneeScope, readUnassignPlan } from "./case-todo-unassign.sql";
import { withDatabase, type Database } from "./database";

const NAME_A = "テスト操作者149D";
const NAME_B = "テスト担当149D";
const NAME_C = "テスト別担当149D";
const LATER = "2026-11-20T04:00:00.000Z";

let w: CaseWorld;
/** K：進行中。A＝memberS1（操作者）・B＝memberD1（外す人）・C＝memberS2・ownerD（TODO の担当がない人） */
let room: SeededCase;
/** K2：進行中の別の案件。A・B が参加 */
let other: SeededCase;

const A = () => w.memberS1.id;
const B = () => w.memberD1.id;
const C = () => w.memberS2.id;

/** K の TODO：T1・T2＝未完了・担当 B／T3＝完了・担当 B／T4＝削除済み・担当 B／T5＝未完了・担当 C／T6＝未完了・担当なし。K2 の T9＝未完了・担当 B */
async function seedTodos() {
  const base = { caseId: room.id, createdBy: A() };
  await insertTodo({
    ...base,
    id: todoIdAt(1),
    title: "[UNIT_TEST]149D見積書",
    assigneeId: B(),
    recordedAssigneeName: NAME_B,
  });
  await insertTodo({
    ...base,
    id: todoIdAt(2),
    title: "[UNIT_TEST]149D請求書",
    assigneeId: B(),
    recordedAssigneeName: NAME_B,
  });
  await insertTodo({
    ...base,
    id: todoIdAt(3),
    title: "[UNIT_TEST]149D完了済み",
    assigneeId: B(),
    recordedAssigneeName: NAME_B,
    isDone: true,
    completedAssigneeId: B(),
    completedAssigneeName: NAME_B,
    version: 2,
  });
  await insertTodo({
    ...base,
    id: todoIdAt(4),
    title: "[UNIT_TEST]149D消したもの",
    assigneeId: B(),
    recordedAssigneeName: NAME_B,
    deletedBy: A(),
    version: 2,
  });
  await insertTodo({
    ...base,
    id: todoIdAt(5),
    title: "[UNIT_TEST]149D別の人の担当",
    assigneeId: C(),
    recordedAssigneeName: NAME_C,
  });
  await insertTodo({
    ...base,
    id: todoIdAt(6),
    title: "[UNIT_TEST]149D担当の決まっていないもの",
  });
  await insertTodo({
    caseId: other.id,
    createdBy: A(),
    id: todoIdAt(9),
    title: "[UNIT_TEST]149D別の案件",
    assigneeId: B(),
    recordedAssigneeName: NAME_B,
  });
}

const inputOf = (
  actorId: string,
  userId: string,
  caseId = room.id,
): CaseParticipantWriteInput => ({
  caseId,
  actorId,
  userId,
  traceId: casereqTraceId(),
});

const remove = (actorId: string, userId: string, caseId = room.id) =>
  withCases(env, (r) => r.removeParticipant(inputOf(actorId, userId, caseId)));

async function allEvents(): Promise<TodoEventRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM case_todo_events ORDER BY id",
  ).all<TodoEventRow>();
  return results;
}

async function allTodos(): Promise<TodoRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM case_todos ORDER BY id",
  ).all<TodoRow>();
  return results;
}

/** 記録 auto_unassign の期待（計画 6.3.1。題名などの列は見ない） */
const autoUnassign = (todoId: string, caseId: string, actorId: string) => ({
  todo_id: todoId,
  case_id: caseId,
  kind: "auto_unassign",
  actor_id: actorId,
  assignee_id: B(),
  assignee_name: NAME_B,
  created_at: LATER,
});

/** 外された後の T1・T2 の行（recorded_* は残る。版+1・updated_at＝操作の時刻） */
const unassignedRow = (before: TodoRow): TodoRow => ({
  ...before,
  assignee_id: null,
  version: before.version + 1,
  updated_at: LATER,
});

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
    n: 1521,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]149D外す",
    createdBy: A(),
    departmentIds: [w.deptS.id],
    members: [
      { userId: A(), joinedAt: joinedAt(1) },
      { userId: B(), joinedAt: joinedAt(2) },
      { userId: C(), joinedAt: joinedAt(3) },
      { userId: w.ownerD.id, joinedAt: joinedAt(4) },
    ],
  });
  other = await seedCase({
    n: 1522,
    clientId: w.clientB.id,
    code: "QZB",
    title: "[UNIT_TEST]149D別の案件",
    createdBy: A(),
    departmentIds: [w.deptS.id],
    members: [
      { userId: A(), joinedAt: joinedAt(1) },
      { userId: B(), joinedAt: joinedAt(2) },
    ],
  });
  await seedTodos();
  await insertTodoEvent({
    id: eventIdAt(1),
    todoId: todoIdAt(1),
    caseId: room.id,
    kind: "create",
    actorId: A(),
  });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupCaseTestData();
});

describe("#149 149-D 5-4 AC-6・C-24 参加者の削除・本人の退出で、外れた人の担当を外す（計画 6.3.1・6.3.3）", () => {
  it("#149 149-D 5-4 AC-6: 参加者の削除で、外れた人が担当の未完了・未削除の TODO（2件）が担当なしになり、recorded_* が残り、版+1・updated_at が変わる。ほかの TODO は変わらない", async () => {
    const before = await allTodos();
    vi.setSystemTime(new Date(LATER));
    await remove(A(), B());
    const after = await allTodos();
    const byId = (rows: TodoRow[], id: string) =>
      rows.find((r) => r.id === id) as TodoRow;
    expect(byId(after, todoIdAt(1))).toEqual(
      unassignedRow(byId(before, todoIdAt(1))),
    );
    expect(byId(after, todoIdAt(2))).toEqual(
      unassignedRow(byId(before, todoIdAt(2))),
    );
    expect(byId(after, todoIdAt(1))).toMatchObject({
      recorded_assignee_id: B(),
      recorded_assignee_name: NAME_B,
    });
    // 完了済み・削除済み（決定 Q4）・ほかの人の担当・担当なし・ほかの案件の TODO は変わらない
    for (const n of [3, 4, 5, 6, 9])
      expect(byId(after, todoIdAt(n)), `T${n}`).toEqual(
        byId(before, todoIdAt(n)),
      );
  });

  it("#149 149-D 5-4 AC-6: 記録 auto_unassign が書き換えた件数（2件）だけ入る（外れた人・保存した名前・操作した人）。ID は既存の記録より大きく、TODO の ID の順に昇順", async () => {
    vi.setSystemTime(new Date(LATER));
    await remove(A(), B());
    const events = await allEvents();
    const added = events.filter((e) => e.id > eventIdAt(1));
    expect(added).toHaveLength(2);
    expect(added[0]).toMatchObject(autoUnassign(todoIdAt(1), room.id, A()));
    expect(added[1]).toMatchObject(autoUnassign(todoIdAt(2), room.id, A()));
    expect(events.filter((e) => e.kind === "auto_unassign")).toHaveLength(2);
  });

  it("#149 149-D 5-4 AC-6: 本人の退出では、記録の actor は本人。担当の TODO は担当なしになる", async () => {
    vi.setSystemTime(new Date(LATER));
    await remove(B(), B());
    expect((await todoRow(todoIdAt(1))).assignee_id).toBeNull();
    expect((await todoRow(todoIdAt(2))).assignee_id).toBeNull();
    const added = (await allEvents()).filter((e) => e.kind === "auto_unassign");
    expect(added).toHaveLength(2);
    for (const event of added)
      expect(event).toMatchObject({ actor_id: B(), assignee_id: B() });
  });

  it("#149 149-D 決定（監査は変えない）: case.participant.remove の監査が1件のまま、detail は caseId・userId・self だけ。TODO の操作の監査は増えない", async () => {
    const auditsBefore = await auditLogCount();
    await remove(A(), B());
    expect(await auditLogCount()).toBe(auditsBefore + 1);
    const audits = await caseWriteAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: A(),
      action: "case.participant.remove",
      target_id: room.id,
    });
    expect(parseDetail(audits[0]?.detail ?? null)).toEqual({
      caseId: room.id,
      userId: B(),
      self: false,
    });
  });

  it("#149 149-D 0件: 担当の TODO がない人（ownerD）の削除は、これまでどおり成功し、TODO・記録は変わらない", async () => {
    const before = await allTodos();
    const eventsBefore = await allEvents();
    await remove(A(), w.ownerD.id);
    expect(await participantIdsOf(room.roomId)).not.toContain(w.ownerD.id);
    expect(await allTodos()).toEqual(before);
    expect(await allEvents()).toEqual(eventsBefore);
    expect(await caseWriteAudits()).toHaveLength(1);
  });

  it.each([
    ["参加者の削除", () => A()],
    ["本人の退出", () => B()],
  ])(
    "#149 149-D 重大1の退行（%s）: 担当の未完了の TODO が2件ある人を外すと、参加の行が消えている（担当なし2件・記録2件・監査1件）",
    async (_label, actorOf) => {
      await remove(actorOf(), B());
      expect(await participantIdsOf(room.roomId)).not.toContain(B());
      // ほかの案件の参加の行は残る
      expect(await participantIdsOf(other.roomId)).toContain(B());
      expect((await todoRow(todoIdAt(1))).assignee_id).toBeNull();
      expect((await todoRow(todoIdAt(2))).assignee_id).toBeNull();
      expect(
        (await allEvents()).filter((e) => e.kind === "auto_unassign"),
      ).toHaveLength(2);
      expect(await caseWriteAudits()).toHaveLength(1);
    },
  );

  it("#149 149-D 決定（戻らない）: 外した後に、もう一度参加させても、担当は NULL のまま", async () => {
    await remove(A(), B());
    await addCaseMember(room.roomId, B(), joinedAt(9));
    expect((await todoRow(todoIdAt(1))).assignee_id).toBeNull();
    expect((await todoRow(todoIdAt(2))).assignee_id).toBeNull();
  });

  it("#149 149-D 版の効果: 外した後に、外す前の版（1）で T1 を編集すると取り消され（CaseStateChangedError）、何も残らない", async () => {
    await remove(A(), B());
    const before = await todoSnapshot();
    await expect(
      withCaseTodos(env, (r) =>
        r.editTodo({
          caseId: room.id,
          actorId: A(),
          todoId: todoIdAt(1),
          version: 1,
          eventIds: [futureIdAt(1), futureIdAt(2)],
          title: "[UNIT_TEST]149D古い版の改題",
        }),
      ),
    ).rejects.toBeInstanceOf(CaseStateChangedError);
    expect(await todoSnapshot()).toEqual(before);
  });
});

describe("#149 149-D 記録の ID（重大3。計画 6.1・10節）", () => {
  it("#149 149-D 重大3①: 別の TODO（T5）に全体の最大の記録 M があり、時計が M より前でも、主キーの違反なく成功し、新しい記録の ID は M より大きい", async () => {
    const m = futureIdAt(5);
    await insertTodoEvent({
      id: m,
      todoId: todoIdAt(5),
      caseId: room.id,
      kind: "create",
      actorId: A(),
    });
    await remove(A(), B());
    const added = (await allEvents()).filter((e) => e.kind === "auto_unassign");
    expect(added).toHaveLength(2);
    for (const event of added) expect(event.id > m).toBe(true);
  });

  it("#149 149-D 重大3②: 時計が戻った状態で、別の TODO（T6）に「T1 の最大の記録の ulidAfter」と同じ ID の記録があっても、衝突せずに成功する", async () => {
    const t1Max = futureIdAt(1);
    await insertTodoEvent({
      id: t1Max,
      todoId: todoIdAt(1),
      caseId: room.id,
      kind: "title_change",
      actorId: A(),
    });
    const collide = ulidAfter(t1Max, Date.now());
    await insertTodoEvent({
      id: collide,
      todoId: todoIdAt(6),
      caseId: room.id,
      kind: "create",
      actorId: A(),
    });
    await remove(A(), B());
    const added = (await allEvents()).filter((e) => e.kind === "auto_unassign");
    expect(added.map((e) => e.todo_id)).toEqual([todoIdAt(1), todoIdAt(2)]);
    for (const event of added) expect(event.id > collide).toBe(true);
  });
});

// ---- 計画 6.3.3・10節：組み立てた文の列を差し替えて、件数の確認と先頭の前提を試す ----

type Statements = Awaited<ReturnType<typeof buildRemoveParticipantStatements>>;
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

const DELETE_MEMBERS = /^\s*delete\s+from\s+"?channel_members"?/i;

function deleteIndexOf(statements: readonly Item[]): number {
  const index = statements.findIndex((item) =>
    DELETE_MEMBERS.test(sqlOf(item)),
  );
  if (index < 0)
    throw new Error(
      "計画 6.3.3 の参加の行の DELETE が buildRemoveParticipantStatements にありません",
    );
  return index;
}

async function runStatements(db: Database, statements: Item[]) {
  await runWriteBatch(() =>
    db.batch(statements as unknown as Parameters<Database["batch"]>[0]),
  );
}

/** n 件分の記録の ID（既存のどの記録より大きい昇順） */
const planOf = (n: number) => ({
  n,
  idsJson: JSON.stringify(
    Array.from({ length: n }, (_, i) => futureIdAt(100 + i)),
  ),
});

describe("#149 149-D 計画 6.3.3 文の列（buildRemoveParticipantStatements）を差し替えて崩す", () => {
  it("#149 149-D 6.3.3: 正しい plan（n=2）の文の列は、そのまま db.batch に渡すと成り立つ（差し替えの仕組みの確認）", async () => {
    await withDatabase(env, async (db) => {
      const statements = [
        ...(await buildRemoveParticipantStatements(
          db,
          inputOf(A(), B()),
          planOf(2),
        )),
      ];
      await runStatements(db, statements);
    });
    expect(await participantIdsOf(room.roomId)).not.toContain(B());
    expect((await todoRow(todoIdAt(1))).assignee_id).toBeNull();
  });

  it("#149 149-D 重大1: 参加の行の DELETE が0行（同じ表の、何も消さない DELETE に差し替え）なら、TODO の担当・版・記録・監査・cases.version が全部前のまま", async () => {
    const before = await todoSnapshot();
    await withDatabase(env, async (db) => {
      const statements = [
        ...(await buildRemoveParticipantStatements(
          db,
          inputOf(A(), B()),
          planOf(2),
        )),
      ];
      statements[deleteIndexOf(statements)] = db
        .delete(channelMembers)
        .where(sql`0`) as unknown as Item;
      await expect(runStatements(db, statements)).rejects.toBeInstanceOf(
        CaseStateChangedError,
      );
    });
    expect(await todoSnapshot()).toEqual(before);
  });

  it.each([
    ["1多い（n=3）", 3],
    ["1少ない（n=1）", 1],
    ["0（n=0）", 0],
  ])(
    "#149 149-D 6.3.2: plan の n が実際（2件）より%sと、先頭の前提か件数の確認で取り消され、何も残らない",
    async (_label, n) => {
      const before = await todoSnapshot();
      await withDatabase(env, async (db) => {
        const statements = [
          ...(await buildRemoveParticipantStatements(
            db,
            inputOf(A(), B()),
            planOf(n),
          )),
        ];
        await expect(runStatements(db, statements)).rejects.toBeInstanceOf(
          CaseStateChangedError,
        );
      });
      expect(await todoSnapshot()).toEqual(before);
    },
  );

  it("#149 149-D 前提の件数: 読み取り（n=2）の後に、B を担当にした TODO を足すと（n が古い）、batch 全体が取り消され何も残らない", async () => {
    await withDatabase(env, async (db) => {
      const statements = [
        ...(await buildRemoveParticipantStatements(
          db,
          inputOf(A(), B()),
          planOf(2),
        )),
      ];
      await insertTodo({
        id: todoIdAt(7),
        caseId: room.id,
        createdBy: A(),
        title: "[UNIT_TEST]149D後から足したもの",
        assigneeId: B(),
        recordedAssigneeName: NAME_B,
      });
      const before = await todoSnapshot();
      await expect(runStatements(db, statements)).rejects.toBeInstanceOf(
        CaseStateChangedError,
      );
      expect(await todoSnapshot()).toEqual(before);
    });
  });

  it("#149 149-D 中身の入れ替わり: 読み取り（n=2）の後に、T1 を完了にし、T5 を B の担当にする（件数は同じ）と、batch は成功し、T2・T5 が外れ、完了にした T1 は変わらない", async () => {
    vi.setSystemTime(new Date(LATER));
    await withDatabase(env, async (db) => {
      const statements = [
        ...(await buildRemoveParticipantStatements(
          db,
          inputOf(A(), B()),
          planOf(2),
        )),
      ];
      await env.DB.prepare(
        "UPDATE case_todos SET is_done = 1, completed_assignee_id = ?, completed_assignee_name = ?, version = version + 1 WHERE id = ?",
      )
        .bind(B(), NAME_B, todoIdAt(1))
        .run();
      await env.DB.prepare(
        "UPDATE case_todos SET assignee_id = ?, recorded_assignee_id = ?, recorded_assignee_name = ?, version = version + 1 WHERE id = ?",
      )
        .bind(B(), B(), NAME_B, todoIdAt(5))
        .run();
      const t1 = await todoRow(todoIdAt(1));
      await runStatements(db, statements);
      expect(await todoRow(todoIdAt(1))).toEqual(t1);
    });
    expect((await todoRow(todoIdAt(2))).assignee_id).toBeNull();
    expect((await todoRow(todoIdAt(5))).assignee_id).toBeNull();
    const added = (await allEvents()).filter((e) => e.kind === "auto_unassign");
    expect(added.map((e) => e.todo_id)).toEqual([todoIdAt(2), todoIdAt(5)]);
  });
});

describe("#149 149-D 先頭の前提：記録の ID の新しさ（計画 6.1・6.3.3。ミューテーション診断の追加）", () => {
  // 「記録 ID ①②」は、Repository が読み直した plan で成功する側だけを見る。ここは、古い plan（読んだ後に ID が使われた）を直接渡す崩れる側
  it.each([
    ["最初の ID と同じ", futureIdAt(100)],
    ["最初の ID より大きい（主キーの衝突は起きない）", futureIdAt(150)],
  ])(
    "#149 149-D 5-4 AC-6 先頭の前提: plan を読んだ後に、今回の最初の ID 以上の記録（%s）が入ると、batch 全体が取り消され（CaseStateChangedError）、参加の行・担当・記録・監査・版が前のまま",
    async (_label, usedId) => {
      await withDatabase(env, async (db) => {
        const statements = [
          ...(await buildRemoveParticipantStatements(
            db,
            inputOf(A(), B()),
            planOf(2),
          )),
        ];
        await insertTodoEvent({
          id: usedId,
          todoId: todoIdAt(5),
          caseId: room.id,
          kind: "create",
          actorId: A(),
        });
        const before = await todoSnapshot();
        await expect(runStatements(db, statements)).rejects.toBeInstanceOf(
          CaseStateChangedError,
        );
        expect(await todoSnapshot()).toEqual(before);
        expect(await participantIdsOf(room.roomId)).toContain(B());
      });
    },
  );
});

describe("#149 149-D readUnassignPlan の記録の ID（計画 6.1。ミューテーション診断の追加）", () => {
  it("#149 149-D 5-4 AC-6: 対象が2件なら idsJson は ID ちょうど2個で、昇順・重複なく、記録の表の全体の最大より大きい", async () => {
    const m = futureIdAt(5);
    await insertTodoEvent({
      id: m,
      todoId: todoIdAt(5),
      caseId: room.id,
      kind: "create",
      actorId: A(),
    });
    const plan = await withDatabase(env, (db) =>
      readUnassignPlan(db, caseAssigneeScope(room.id, B())),
    );
    const ids = JSON.parse(plan.idsJson) as string[];
    expect(plan.n).toBe(2);
    expect(ids).toHaveLength(2);
    expect(ids[0]! > m).toBe(true);
    expect(ids[1]! > ids[0]!).toBe(true);
  });

  it("#149 149-D 5-4 AC-6: 対象が0件なら n=0・idsJson は空の配列", async () => {
    const plan = await withDatabase(env, (db) =>
      readUnassignPlan(db, caseAssigneeScope(room.id, w.ownerD.id)),
    );
    expect(plan).toEqual({ n: 0, idsJson: "[]" });
  });
});

describe("#149 149-D D1 の上限（計画 6.3.2）", () => {
  it("#149 149-D D1 の上限: 対象 150 件でも1回で成功し（担当なし 150 件・記録 150 件）、文の数は対象の件数によらない", async () => {
    for (let i = 0; i < 150; i += 1)
      await insertTodo({
        id: todoIdAt(1000 + i),
        caseId: room.id,
        createdBy: A(),
        title: `[UNIT_TEST]149D大量${i}`,
        assigneeId: B(),
        recordedAssigneeName: NAME_B,
      });
    const lengths = await withDatabase(env, async (db) => [
      (await buildRemoveParticipantStatements(db, inputOf(A(), B()), planOf(0)))
        .length,
      (
        await buildRemoveParticipantStatements(
          db,
          inputOf(A(), B()),
          planOf(152),
        )
      ).length,
    ]);
    expect(lengths[1]).toBe(lengths[0]);
    await remove(A(), B());
    const { results } = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM case_todos WHERE case_id = ? AND assignee_id = ?",
    )
      .bind(room.id, B())
      .all<{ n: number }>();
    // 残るのは完了済みの T3 と削除済みの T4 だけ
    expect(results[0]?.n).toBe(2);
    expect(
      (await allEvents()).filter((e) => e.kind === "auto_unassign"),
    ).toHaveLength(152);
  });
});
