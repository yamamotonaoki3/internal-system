// #149（149-D）5-4 AC-6、計画 6.3.7・10節「やり直し」「503 の契約」「重大2の退行」：
// 参加者の削除（case.service.ts の removeParticipant）・無効化（account.service.ts の deactivate）で、読み取り（対象の件数 n・記録の最大の ID）の後・
// batch の前に状態が変わったとき、Service が Repository を呼び直して（Repository が n と ID を読み直す）成功すること、
// 毎回崩れると、呼び出しがちょうど4回（最初の1回＋MAX_ID_RETRIES＝3）で 503（SERVICE_UNAVAILABLE、149-A と同じ文言）になり、
// logger.warn が1回、何も残らないことを、本物の Repository（隔離 D1）で確かめる。
// 割り込み方：env.DB の batch を包み、batch の直前に「外す人を担当にした TODO」を1件足す（先例：account.repository.transfer.case-request.db.test.ts）。
//   Repository の関数の呼び出しの回数は、Repository を Proxy で包んで数える。
// 期待値は計画 6.3.7（試行は合計4回、超えたら 503 と logger.warn）・149-A の文言から決める。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupCaseTestData,
  joinedAt,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  participantIdsOf,
  setCaseStatus,
} from "../../test/case-participant-fixtures";
import {
  CASEREQ_NOW,
  TEST_TAG,
  caseRequestRow,
  casereqTraceId,
  insertCaseRequest,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import {
  insertTodo,
  todoIdAt,
  todoRow,
  todoSnapshot,
} from "../../test/case-todo-fixtures";
import {
  AccountStateChangedError,
  withAccounts,
  type AccountRepository,
} from "../db/account.repository";
import {
  CaseStateChangedError,
  withCases,
  type CaseRepository,
} from "../db/case.repository";
import { AppError } from "../lib/app-error";
import { createAccountService } from "./account.service";
import { createCaseService } from "./case.service";

const BUSY_MESSAGE = "混み合っています。しばらくしてからもう一度お試しください";
const NAME_B = "テスト担当149D割り込み";

let w: CaseWorld;
let room: SeededCase;
let warnLines: string[];
let added = 0;

/** TODO の表・記録の表に書く文（担当の書き換えを含む書き込みの batch を見分けるため） */
const WRITES_TODOS =
  /^\s*(update\s+"?case_todos"?|insert\s+into\s+"?case_todo_events"?)/i;

/**
 * 担当の書き換えを含む書き込みの batch の直前（＝plan を読んだ後）に、外す人（memberD1）を担当にした TODO を1件足す。
 * times 回まで（Infinity なら毎回）。判定の読み取り（findWriteFacts）も db.batch を使うため、TODO に書く文を含む batch だけに割り込む。
 * 文の SQL は prepare で受け取り、bind の後の文にも引き継いで見分ける
 */
function envAddingTodoBeforeBatch(times: number): Env {
  let count = 0;
  const writing = new WeakSet<object>();
  const tag = (statement: D1PreparedStatement, query: string) => {
    if (WRITES_TODOS.test(query)) writing.add(statement);
    return new Proxy(statement, {
      get(stmt, key) {
        if (key === "bind")
          return (...values: unknown[]) => {
            const bound = stmt.bind(...values);
            if (WRITES_TODOS.test(query)) writing.add(bound);
            return bound;
          };
        const value: unknown = Reflect.get(stmt, key, stmt);
        return typeof value === "function" ? value.bind(stmt) : value;
      },
    });
  };
  const proxy = new Proxy(env.DB, {
    get(target, property) {
      if (property === "prepare")
        return (query: string) => tag(target.prepare(query), query);
      if (property === "batch")
        return async (statements: D1PreparedStatement[]) => {
          const isWrite = statements.some((s) => writing.has(s));
          if (isWrite && count < times) {
            count += 1;
            added += 1;
            await insertTodo({
              id: todoIdAt(500 + added),
              caseId: room.id,
              createdBy: w.memberS1.id,
              title: `[UNIT_TEST]149D割り込み${added}`,
              assigneeId: w.memberD1.id,
              recordedAssigneeName: NAME_B,
            });
          }
          return target.batch(statements);
        };
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { ...env, DB: proxy } as Env;
}

/** Repository の関数 name の呼び出しを数える */
function counting<T extends object>(
  repository: T,
  name: string,
  counter: { calls: number },
  replace?: () => Promise<never>,
): T {
  return new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (property !== name || typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        counter.calls += 1;
        if (replace !== undefined) return replace();
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

const busyWarns = () =>
  warnLines
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as { severity_text?: string })
    .filter((record) => record.severity_text === "WARN");

const caseActor = (userId: string) => ({ userId, traceId: casereqTraceId() });
const adminActor = () => ({
  userId: w.admin.id,
  traceId: casereqTraceId(),
  reauthenticatedAt: new Date().toISOString(),
});

function removeVia(testEnv: Env, counter: { calls: number }) {
  return withCases(testEnv, (repository, roles) =>
    createCaseService(
      counting<CaseRepository>(repository, "removeParticipant", counter),
      roles,
    ).removeParticipant(caseActor(w.memberS1.id), room.id, w.memberD1.id),
  );
}

function deactivateVia(
  testEnv: Env,
  counter: { calls: number },
  replace?: () => Promise<never>,
) {
  return withAccounts(testEnv, (repository, roles) =>
    createAccountService(
      counting<AccountRepository>(repository, "deactivate", counter, replace),
      roles,
    ).deactivate(adminActor(), w.memberD1.id),
  );
}

async function assignedTo(userId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM case_todos WHERE assignee_id = ?",
  )
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? -1;
}

beforeEach(async () => {
  added = 0;
  warnLines = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
    warnLines.push(String(line));
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(CASEREQ_NOW));
  w = await setupCaseWorld();
  room = await seedCase({
    n: 1531,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]149D割り込み",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
    ],
  });
  await insertTodo({
    id: todoIdAt(500),
    caseId: room.id,
    createdBy: w.memberS1.id,
    title: "[UNIT_TEST]149D割り込みの元",
    assigneeId: w.memberD1.id,
    recordedAssigneeName: NAME_B,
  });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupCaseTestData();
});

describe("#149 149-D 計画 6.3.7 参加者の削除のやり直し", () => {
  it("#149 149-D 6.3.7: 読み取りの後・batch の前に担当の TODO が1件増えても、やり直しで新しい TODO も外れて成功する（Repository の呼び出し2回）", async () => {
    const counter = { calls: 0 };
    await removeVia(envAddingTodoBeforeBatch(1), counter);
    expect(counter.calls).toBe(2);
    expect(await participantIdsOf(room.roomId)).not.toContain(w.memberD1.id);
    expect((await todoRow(todoIdAt(500))).assignee_id).toBeNull();
    expect((await todoRow(todoIdAt(501))).assignee_id).toBeNull();
    expect(await assignedTo(w.memberD1.id)).toBe(0);
  });

  it("#149 149-D 6.3.7・軽微1: 毎回割り込むと、Repository の呼び出しがちょうど4回で 503（SERVICE_UNAVAILABLE・149-A と同じ文言）、logger.warn が1回、参加の行・担当・記録・監査は割り込みの分のほかは何も変わらない", async () => {
    const counter = { calls: 0 };
    const before = await todoSnapshot();
    const error = await removeVia(envAddingTodoBeforeBatch(Infinity), counter)
      .then(() => null)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      status: 503,
      message: BUSY_MESSAGE,
    });
    expect(counter.calls).toBe(4);
    expect(busyWarns()).toHaveLength(1);
    const after = await todoSnapshot();
    expect(after.members).toEqual(before.members);
    expect(after.events).toEqual(before.events);
    expect(after.audits).toBe(before.audits);
    expect(after.cases).toEqual(before.cases);
    // 割り込みで足した TODO（4件）と元の TODO は、担当のまま
    expect(await assignedTo(w.memberD1.id)).toBe(5);
  });

  it("#149 149-D 6.3.7: 3回目まで割り込み、4回目で割り込まなければ成功する（呼び出し4回）", async () => {
    const counter = { calls: 0 };
    await removeVia(envAddingTodoBeforeBatch(3), counter);
    expect(counter.calls).toBe(4);
    expect(await assignedTo(w.memberD1.id)).toBe(0);
    expect(busyWarns()).toHaveLength(0);
  });

  it("#149 149-D 理由は変えない: 前提の崩れが既存の理由（案件が終了した）なら、やり直さずにこれまでどおりの理由を返す", async () => {
    const counter = { calls: 0 };
    let once = false;
    const proxy = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            // 書き込み（removeParticipant）が呼ばれた後の batch だけで崩す（それより前の batch では崩さない）
            if (!once && counter.calls > 0) {
              once = true;
              await setCaseStatus(room.id, "closed");
            }
            return target.batch(statements);
          };
        const value: unknown = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const error = await removeVia({ ...env, DB: proxy } as Env, counter)
      .then(() => null)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: "CONFLICT",
      details: { reason: "closed" },
    });
    expect(counter.calls).toBe(1);
    expect((await todoRow(todoIdAt(500))).assignee_id).toBe(w.memberD1.id);
  });
});

describe("#149 149-D 計画 6.3.7 無効化のやり直し", () => {
  it("#149 149-D 6.3.7: 読み取りの後・batch の前に担当の TODO が1件増えても、やり直しで新しい TODO も外れて成功する（呼び出し2回）", async () => {
    const counter = { calls: 0 };
    await deactivateVia(envAddingTodoBeforeBatch(1), counter);
    expect(counter.calls).toBe(2);
    expect(await assignedTo(w.memberD1.id)).toBe(0);
  });

  it("#149 149-D 6.3.7・軽微1: 毎回割り込むと、呼び出しがちょうど4回で 503（SERVICE_UNAVAILABLE・149-A と同じ文言）、logger.warn が1回、無効化されない", async () => {
    const counter = { calls: 0 };
    const error = await deactivateVia(
      envAddingTodoBeforeBatch(Infinity),
      counter,
    )
      .then(() => null)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      status: 503,
      message: BUSY_MESSAGE,
    });
    expect(counter.calls).toBe(4);
    expect(busyWarns()).toHaveLength(1);
    const row = await env.DB.prepare("SELECT is_active FROM users WHERE id = ?")
      .bind(w.memberD1.id)
      .first<{ is_active: number }>();
    expect(row?.is_active).toBe(1);
  });

  it("#149 149-D 重大2の退行: 審査中の申請1件と担当の TODO 1件を持つ人の無効化は、やり直しなし（呼び出し1回）で確定する", async () => {
    const requestId = await insertCaseRequest({
      clientId: w.clientA.id,
      title: `${TEST_TAG}149D割り込みの申請`,
      requestedBy: w.memberD1.id,
      departmentIds: [w.deptS.id],
      candidateIds: [w.memberS1.id],
    });
    const counter = { calls: 0 };
    await deactivateVia(env, counter);
    expect(counter.calls).toBe(1);
    expect((await caseRequestRow(requestId))?.status).toBe("auto_cancelled");
    expect(await assignedTo(w.memberD1.id)).toBe(0);
  });

  it("#149 149-D 軽微1: Repository が毎回 AccountStateChangedError を投げ、読み直しで理由がなければ、呼び出し4回で 503", async () => {
    const counter = { calls: 0 };
    const error = await deactivateVia(env, counter, async () => {
      throw new AccountStateChangedError();
    })
      .then(() => null)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "SERVICE_UNAVAILABLE", status: 503 });
    expect(counter.calls).toBe(4);
  });
});

describe("#149 149-D 軽微1 参加者の削除の 503 の契約（Repository の代役）", () => {
  it("#149 149-D 軽微1: Repository が毎回 CaseStateChangedError を投げ、読み直しで理由がなければ、呼び出し4回で 503", async () => {
    const counter = { calls: 0 };
    const error = await withCases(env, (repository, roles) =>
      createCaseService(
        counting<CaseRepository>(
          repository,
          "removeParticipant",
          counter,
          async () => {
            throw new CaseStateChangedError();
          },
        ),
        roles,
      ).removeParticipant(caseActor(w.memberS1.id), room.id, w.memberD1.id),
    )
      .then(() => null)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "SERVICE_UNAVAILABLE", status: 503 });
    expect(counter.calls).toBe(4);
  });
});
