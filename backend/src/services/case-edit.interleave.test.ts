// #150（150-C）計画 6章「AC-1 同時の操作」「2回目 重大2」：案件の再編集で、判定の材料を読んだ後、書き込みの batch の「直前」に、
// 別の要求が案件・参加者・役割を変えても、batch の前提で止まり、Service が最初と同じ判定で読み直して正しい応答にすること。
// 割り込みは、書き込みの関数（Repository の editCase）が呼ばれた時点で、本物の editCase に渡す前にだけ入れる
// （材料の読み取りの途中には割り込まない：狙った batch の直前だけ）。各回の前に世界を作り直す。
// 割り込めたこと〔afterInterrupt が null でない〕を毎回確かめ、拒否のときは割り込みの直後の状態から何も増えない＝要求の側の変更・監査が残らない。
// 元の要求：
//   参加者（版の方式）：memberS1 が、件名を変え、deptD を足し（ownerD が自動参加）、取引先を clientB にする
//   非参加の管理者（expected の方式。Q3＝C）：deptS のオーナーにした memberD1 が、件名を変える
// 契約（実装前の仮置き。services/case-edit.service.test.ts の冒頭を参照）：service.edit(actor, caseId, body)。書き込みの関数の名前は editCase（Repository）。
// 時刻は CASEREQ_NOW に固定する。データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupCaseTestData,
  joinedAt,
  removeCaseMember,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  caseDepartmentIdsOf,
  caseEditAudits,
  caseEditRow,
  caseEditSnapshot,
} from "../../test/case-edit-fixtures";
import { noReselectBody } from "../../test/case-reopen-fixtures";
import { participantIdsOf } from "../../test/case-participant-fixtures";
import {
  CASEREQ_NOW,
  casereqTraceId,
  removeOwner,
  setClientActive,
  setDepartmentActive,
  setUserActive,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { replaceOwner } from "../../test/case-edit-fixtures";
import { withCases, type CaseRepository } from "../db/case.repository";
import { AppError } from "../lib/app-error";
import { createCaseService, withCaseService } from "./case.service";

let w: CaseWorld;
/** 進行中・deptS 担当・clientA：memberS1・memberS2・ownerS（自動参加）。memberD1・ownerD・noDept は参加していない */
let room: SeededCase;

const TITLE = "[UNIT_TEST]150C割り込みの前の件名";
const DESCRIPTION = "[UNIT_TEST]150C割り込みの前の説明";

type Snapshot = Awaited<ReturnType<typeof caseEditSnapshot>>;
type Recorder = { writes: number; afterInterrupt: Snapshot | null };

/** editCase が呼ばれたら、本物に渡す前に割り込む（every が偽なら1回目だけ） */
function interleave(
  repository: CaseRepository,
  interrupt: (attempt: number) => Promise<void>,
  recorder: Recorder,
  every: boolean,
): CaseRepository {
  return new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        if (property === "editCase") {
          recorder.writes += 1;
          if (every || recorder.writes === 1) {
            await interrupt(recorder.writes);
            recorder.afterInterrupt = await caseEditSnapshot();
          }
        }
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as CaseRepository;
}

type Result = { ok: true; value: unknown } | { ok: false; error: unknown };
const actorOf = (userId: string) => ({ userId, traceId: casereqTraceId() });

async function runWith(
  actorId: string,
  body: unknown,
  interrupt: (attempt: number) => Promise<void>,
  recorder: Recorder,
  every = false,
): Promise<Result> {
  try {
    const value = await withCases(env, (repository, roles) =>
      createCaseService(
        interleave(repository, interrupt, recorder, every),
        roles,
      ).edit(actorOf(actorId), room.id, body),
    );
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  }
}

const otherService = (
  run: (service: ReturnType<typeof createCaseService>) => Promise<unknown>,
) => withCaseService(env, run).then(() => undefined);

async function resetWorld() {
  await cleanupCaseTestData();
  w = await setupCaseWorld();
  room = await seedCase({
    n: 1641,
    clientId: w.clientA.id,
    code: "QZA",
    title: TITLE,
    description: DESCRIPTION,
    dueDate: "2026-12-24",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberS2.id, joinedAt: joinedAt(2) },
      { userId: w.ownerS.id, joinedAt: joinedAt(3) },
    ],
  });
  // 非参加の管理者（deptS のオーナー。参加していない）
  await replaceOwner(w.memberD1.id, w.deptS.id);
}

/** 参加者の本文（版は割り込みの前に読む＝画面が詳細で見た版） */
const participantBody = () => ({
  version: 1,
  title: "[UNIT_TEST]150C参加者の新しい件名",
  clientId: w.clientB.id,
  departmentIds: [w.deptS.id, w.deptD.id],
});
/** 非参加の管理者の本文（画面が概要で見た値） */
const managerBody = () => ({
  expected: {
    title: TITLE,
    clientId: w.clientA.id,
    departmentIds: [w.deptS.id],
  },
  title: "[UNIT_TEST]150C管理者の新しい件名",
});

/** 参加者の、担当部署を変えない本文（コードレビュー1回目の指摘2：件名だけ） */
const participantTitleOnlyBody = () => ({
  version: 1,
  title: "[UNIT_TEST]150C参加者の件名だけ",
});

/** 版を進めずに、担当部署を付け替える（deptH を足す。既存の割り込みと同じ方法） */
const addDeptHWithoutVersion = async () => {
  await env.DB.prepare(
    "INSERT INTO case_departments (case_id, department_id) VALUES (?, ?)",
  )
    .bind(room.id, w.deptH.id)
    .run();
};

type Expected =
  | { code: "FORBIDDEN" }
  | { code: "VALIDATION_ERROR"; fields: string[] }
  | { code: "CONFLICT"; reason: string };

function matches(error: unknown, expected: Expected) {
  if (!(error instanceof AppError)) return false;
  if (error.code !== expected.code) return false;
  if (expected.code === "FORBIDDEN") return error.details.reason === undefined;
  if (expected.code === "VALIDATION_ERROR")
    return (
      JSON.stringify(error.details.fields) === JSON.stringify(expected.fields)
    );
  return error.details.reason === expected.reason;
}

const describeResult = (result: Result) =>
  result.ok
    ? `成功 ${JSON.stringify(result.value)}`
    : result.error instanceof AppError
      ? `${result.error.code} ${result.error.message} ${JSON.stringify(result.error.details)}`
      : String(result.error);

const STALE: Expected = { code: "CONFLICT", reason: "stale" };

type Scenario = {
  name: string;
  actor: () => string;
  body: () => unknown;
  interrupt: () => Promise<void>;
  expected: Expected;
};

// 表には関数だけを書く（resetWorld で代入する変数は、呼ばれた時点で読む）
const REJECTIONS: Scenario[] = [
  {
    name: "参加者：ほかの参加者が先に説明を編集した（版が進む）→ 409 stale",
    actor: () => w.memberS1.id,
    body: participantBody,
    interrupt: () =>
      otherService((s) =>
        s.edit(actorOf(w.memberS2.id), room.id, {
          version: 1,
          description: "[UNIT_TEST]150C先の人の説明",
        }),
      ),
    expected: STALE,
  },
  {
    name: "参加者：ほかの参加者が先に納期を変えた → 409 stale",
    actor: () => w.memberS1.id,
    body: participantBody,
    interrupt: () =>
      otherService((s) =>
        s.changeDueDate(actorOf(w.memberS2.id), room.id, {
          dueDate: "2027-01-15",
        }),
      ),
    expected: STALE,
  },
  {
    name: "参加者：ほかの参加者が終了して再開した（状態が戻る）→ 409 stale",
    actor: () => w.memberS1.id,
    body: participantBody,
    interrupt: async () => {
      await otherService((s) => s.close(actorOf(w.memberS2.id), room.id));
      await otherService(async (s) =>
        s.reopen(
          actorOf(w.memberS2.id),
          room.id,
          await noReselectBody(room.id),
        ),
      );
    },
    expected: STALE,
  },
  {
    name: "参加者：ほかの参加者が終了した → 409 closed",
    actor: () => w.memberS1.id,
    body: participantBody,
    interrupt: () =>
      otherService((s) => s.close(actorOf(w.memberS2.id), room.id)),
    expected: { code: "CONFLICT", reason: "closed" },
  },
  {
    name: "参加者：操作者が外された → 403（状態を漏らさない）",
    actor: () => w.memberS1.id,
    body: participantBody,
    interrupt: () => removeCaseMember(room.roomId, w.memberS1.id),
    expected: { code: "FORBIDDEN" },
  },
  {
    name: "参加者：操作者が無効になった → 403",
    actor: () => w.memberS1.id,
    body: participantBody,
    interrupt: () => setUserActive(w.memberS1.id, false),
    expected: { code: "FORBIDDEN" },
  },
  {
    name: "参加者：新しい取引先が無効になった → 422 clientId",
    actor: () => w.memberS1.id,
    body: participantBody,
    interrupt: () => setClientActive(w.clientB.id, false),
    expected: { code: "VALIDATION_ERROR", fields: ["clientId"] },
  },
  {
    name: "参加者：足す部署が無効になった → 422 departmentIds",
    actor: () => w.memberS1.id,
    body: participantBody,
    interrupt: () => setDepartmentActive(w.deptD.id, false),
    expected: { code: "VALIDATION_ERROR", fields: ["departmentIds"] },
  },
  {
    name: "参加者：版を進めない担当部署の付け替え（deptH が足された）→ 409 stale",
    actor: () => w.memberS1.id,
    body: participantBody,
    interrupt: async () => {
      await env.DB.prepare(
        "INSERT INTO case_departments (case_id, department_id) VALUES (?, ?)",
      )
        .bind(room.id, w.deptH.id)
        .run();
    },
    expected: STALE,
  },
  {
    name: "C-199(8) 参加者：件名だけの要求で、版を進めない担当部署の付け替え（deptH が足された）→ 409 stale",
    actor: () => w.memberS1.id,
    body: participantTitleOnlyBody,
    interrupt: addDeptHWithoutVersion,
    expected: STALE,
  },
  {
    name: "C-199(8) 非参加の管理者：件名だけの要求で、版を進めない担当部署の付け替え（deptH が足された）→ 409 stale（expected）",
    actor: () => w.memberD1.id,
    body: managerBody,
    interrupt: addDeptHWithoutVersion,
    expected: STALE,
  },
  {
    name: "非参加の管理者：ほかの参加者が先に件名を変えた → 409 stale（expected）",
    actor: () => w.memberD1.id,
    body: managerBody,
    interrupt: () =>
      otherService((s) =>
        s.edit(actorOf(w.memberS2.id), room.id, {
          version: 1,
          title: "[UNIT_TEST]150C先の人の件名",
        }),
      ),
    expected: STALE,
  },
  {
    name: "非参加の管理者：オーナーでなくなった → 403",
    actor: () => w.memberD1.id,
    body: managerBody,
    interrupt: () => removeOwner(w.memberD1.id, w.deptS.id),
    expected: { code: "FORBIDDEN" },
  },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(CASEREQ_NOW));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupCaseTestData();
});

describe("#150 150-C 同時の操作：読んだ後・書き込みの直前に、別の要求が変える（拒否）", () => {
  it("#150 6章: 割り込みなしなら、参加者・非参加の管理者のどちらの元の要求も成功する（空振りしないことの確認）", async () => {
    for (const [actor, body] of [
      [() => w.memberS1.id, participantBody],
      [() => w.memberD1.id, managerBody],
    ] as const) {
      await resetWorld();
      const recorder: Recorder = { writes: 0, afterInterrupt: null };
      const result = await runWith(actor(), body(), async () => {}, recorder);
      expect(result.ok, describeResult(result)).toBe(true);
      expect(recorder.writes).toBe(1);
    }
  });

  it("#150 6章・C-199(8): 割り込みなしなら、参加者の件名だけの要求も成功する（空振りしないことの確認）", async () => {
    await resetWorld();
    const recorder: Recorder = { writes: 0, afterInterrupt: null };
    const result = await runWith(
      w.memberS1.id,
      participantTitleOnlyBody(),
      async () => {},
      recorder,
    );
    expect(result.ok, describeResult(result)).toBe(true);
    expect(recorder.writes).toBe(1);
  });

  it.each(REJECTIONS)(
    "#150 6章: $name（要求の側の変更・監査は残らない）",
    async ({ actor, body, interrupt, expected }) => {
      await resetWorld();
      const recorder: Recorder = { writes: 0, afterInterrupt: null };
      const result = await runWith(actor(), body(), interrupt, recorder);
      expect(recorder.afterInterrupt, "割り込めませんでした").not.toBeNull();
      expect(
        !result.ok && matches(result.error, expected),
        describeResult(result),
      ).toBe(true);
      expect(await caseEditSnapshot()).toEqual(recorder.afterInterrupt);
    },
  );
});

describe("#150 150-C 2回目 重大2：expected の方式は、説明・納期だけの同時の変更で崩れない", () => {
  it.each([
    {
      name: "説明だけ",
      interrupt: () =>
        otherService((s) =>
          s.edit(actorOf(w.memberS2.id), room.id, {
            version: 1,
            description: "[UNIT_TEST]150C参加者の新しい説明",
          }),
        ),
      kept: { description: "[UNIT_TEST]150C参加者の新しい説明" },
    },
    {
      name: "納期だけ",
      interrupt: () =>
        otherService((s) =>
          s.changeDueDate(actorOf(w.memberS2.id), room.id, {
            dueDate: "2027-01-15",
          }),
        ),
      kept: { due_date: "2027-01-15" },
    },
  ])(
    "#150 4.4.1: 非参加の管理者が読んだ後に、参加者が$nameを変えても、編集は 200・件名は新しい値・ほかの人の値は残る・版は2つ進む・管理者の case.edit は1件",
    async ({ interrupt, kept }) => {
      await resetWorld();
      const recorder: Recorder = { writes: 0, afterInterrupt: null };
      const result = await runWith(
        w.memberD1.id,
        managerBody(),
        interrupt,
        recorder,
      );
      expect(recorder.afterInterrupt).not.toBeNull();
      expect(result.ok, describeResult(result)).toBe(true);
      expect(await caseEditRow(room.id)).toMatchObject({
        ...kept,
        title: "[UNIT_TEST]150C管理者の新しい件名",
        version: 3,
      });
      expect(
        (await caseEditAudits()).filter((a) => a.actor_id === w.memberD1.id),
      ).toHaveLength(1);
    },
  );

  it("#150 4.4.1: 同じ割り込み（説明だけ）でも、参加者の版の方式では 409 stale で、先の人の説明は上書きされない", async () => {
    await resetWorld();
    const recorder: Recorder = { writes: 0, afterInterrupt: null };
    const result = await runWith(
      w.memberS1.id,
      { version: 1, description: "[UNIT_TEST]150C古い画面の説明" },
      () =>
        otherService((s) =>
          s.edit(actorOf(w.memberS2.id), room.id, {
            version: 1,
            description: "[UNIT_TEST]150C先の人の説明",
          }),
        ),
      recorder,
    );
    expect(
      !result.ok && matches(result.error, STALE),
      describeResult(result),
    ).toBe(true);
    expect((await caseEditRow(room.id)).description).toBe(
      "[UNIT_TEST]150C先の人の説明",
    );
  });
});

describe("#150 150-C 重大2：自動参加させる人の集合が読んだ後に変わる（版を進めない）", () => {
  it("#150 4.2: 足す部署のオーナーが交代した（ownerD → noDept）→ 集合を読み直して1回だけやり直し、新しいオーナーだけが1行参加する", async () => {
    await resetWorld();
    const recorder: Recorder = { writes: 0, afterInterrupt: null };
    const result = await runWith(
      w.memberS1.id,
      participantBody(),
      async () => {
        await removeOwner(w.ownerD.id, w.deptD.id);
        await replaceOwner(w.noDept.id, w.deptD.id);
      },
      recorder,
    );
    expect(result.ok, describeResult(result)).toBe(true);
    expect(recorder.writes).toBe(2);
    const members = await participantIdsOf(room.roomId);
    expect(members.filter((id) => id === w.noDept.id)).toHaveLength(1);
    expect(members).not.toContain(w.ownerD.id);
    expect(await caseDepartmentIdsOf(room.id)).toEqual(
      [w.deptS.id, w.deptD.id].sort(),
    );
    expect(await caseEditAudits()).toHaveLength(1);
  });

  it("#150 4.2: 書き込みのたびにオーナーが交代する（2回続けて変わる）→ 409 retry で、何も残らない", async () => {
    await resetWorld();
    // どの人も、この案件に参加していない有効な社員（自動参加させる人の集合が毎回変わる）
    const people = () => [w.noDept.id, w.ownerH.id, w.ownerD.id];
    const recorder: Recorder = { writes: 0, afterInterrupt: null };
    const result = await runWith(
      w.memberS1.id,
      { version: 1, departmentIds: [w.deptS.id, w.deptD.id] },
      async (attempt) => {
        // いまのオーナーを外し、まだ参加していない別の人をオーナーにする（版は進まない）
        const { results } = await env.DB.prepare(
          "SELECT user_id FROM user_role_assignments WHERE role_id = 'role_owner' AND department_id = ?",
        )
          .bind(w.deptD.id)
          .all<{ user_id: string }>();
        for (const row of results) await removeOwner(row.user_id, w.deptD.id);
        const next = people()[attempt - 1];
        if (next === undefined) throw new Error("交代させる人が足りません");
        await replaceOwner(next, w.deptD.id);
      },
      recorder,
      true,
    );
    expect(
      !result.ok &&
        matches(result.error, { code: "CONFLICT", reason: "retry" }),
      describeResult(result),
    ).toBe(true);
    expect(recorder.writes).toBe(2);
    expect(await caseEditSnapshot()).toEqual(recorder.afterInterrupt);
    expect(await caseEditAudits()).toEqual([]);
  });
});
