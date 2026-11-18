// #147（147-B）計画の「同時の操作」の表・計画レビュー1回目の2（操作者の無効化）：最初の判定（資格を確かめる読み取り）の「直後」、
// 書き込みの「前」に状態が変わっても、batch の前提で止まり、Service が最初と同じ判定で読み直して正しい応答にすること。
// 挟み方（先例：channel-member.active-interleave.test.ts。関数の名前で読み取りを選ばない）：
//   - 本物の Repository（隔離 D1）のすべての関数を Proxy で包み、呼ばれた順に数える
//   - 割り込みなしで、書き込みの関数（addParticipant・removeParticipant・changeDueDate）より前に呼ばれた読み取りの回数を数え、
//     k = 1 からその回数まで、k 回目の読み取りが返った直後に状態を変える（どの読み取りが資格の確認でも、その直後を必ず含む）
//   - どの k でも、結果は計画の表の応答（AppError の code・reason）か、理由に当たらなければ CaseStateChangedError で、
//     書き込み（参加の行・案件の行・147-B の監査）は、割り込みの直後の状態から何も変わらない
// 権限の判定は本物（createCaseService(repository, roles)。roles は隔離 D1 のロールの割り当て）。
// 契約（実装前の仮置き。計画 147-B。実装の担当へ）：backend/src/services/case.service.ts
//   service.addParticipant(actor, caseId, { userId }): Promise<{ caseId, userId }>
//   service.removeParticipant(actor, caseId, userId): Promise<void>
//   service.changeDueDate(actor, caseId, { dueDate }): Promise<{ caseId, dueDate }>
//   Repository の書き込みの関数の名前は addParticipant・removeParticipant・changeDueDate（db/case-participant.repository.db.test.ts と同じ）。
// 時刻は CASEREQ_NOW（日本時間 2026-11-17）に固定する。データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addCaseMember,
  cleanupCaseTestData,
  joinedAt,
  removeCaseMember,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  CASE_CONFLICT_REASONS,
  caseWriteSnapshot,
  setCaseDueDate,
  setCaseStatus,
} from "../../test/case-participant-fixtures";
import {
  CASEREQ_NOW,
  casereqTraceId,
  removeOwner,
  setUserActive,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { makeOwner } from "../../test/department-fixtures";
import {
  CaseStateChangedError,
  withCases,
  type CaseRepository,
} from "../db/case.repository";
import { AppError } from "../lib/app-error";
import { createCaseService } from "./case.service";

const WRITES = new Set([
  "addParticipant",
  "removeParticipant",
  "changeDueDate",
]);

let w: CaseWorld;
/** 進行中・deptS 担当：memberS1・memberD1（一般の参加者だけ）。納期なし */
let room: SeededCase;

type Recorder = {
  /** 書き込みより前に呼ばれた読み取りの回数 */
  readsBeforeWrite: number;
  /** 書き込みが呼ばれたか */
  wroteAt: number | null;
  calls: number;
  /** 割り込みの直後の状態（書き込みが何も残していないことの比較の基準） */
  afterInterrupt: Awaited<ReturnType<typeof caseWriteSnapshot>> | null;
};

const newRecorder = (): Recorder => ({
  readsBeforeWrite: 0,
  wroteAt: null,
  calls: 0,
  afterInterrupt: null,
});

/** interruptAfter 回目の読み取り（書き込みより前のもの）が返った直後に interrupt を実行する。0 なら割り込まない */
function interleave(
  repository: CaseRepository,
  interruptAfter: number,
  interrupt: () => Promise<void>,
  recorder: Recorder,
): CaseRepository {
  let interrupted = false;
  return new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        const isWrite = WRITES.has(String(property));
        recorder.calls += 1;
        if (isWrite && recorder.wroteAt === null)
          recorder.wroteAt = recorder.calls;
        const result: unknown = await (
          value as (...a: unknown[]) => unknown
        ).apply(target, args);
        if (!isWrite && recorder.wroteAt === null) {
          recorder.readsBeforeWrite += 1;
          if (recorder.readsBeforeWrite === interruptAfter && !interrupted) {
            interrupted = true;
            await interrupt();
            recorder.afterInterrupt = await caseWriteSnapshot();
          }
        }
        return result;
      };
    },
  }) as CaseRepository;
}

type Operation = (
  service: ReturnType<typeof createCaseService>,
) => Promise<unknown>;

const actorOf = (userId: string) => ({ userId, traceId: casereqTraceId() });

async function runWith(
  operation: Operation,
  interruptAfter: number,
  interrupt: () => Promise<void>,
  recorder: Recorder,
): Promise<{ ok: true; value: unknown } | { ok: false; error: unknown }> {
  try {
    const value = await withCases(env, (repository, roles) =>
      operation(
        createCaseService(
          interleave(repository, interruptAfter, interrupt, recorder),
          roles,
        ),
      ),
    );
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  }
}

/** 世界と案件を作り直す（書き込み・割り込みで変えた状態を、k ごとに元に戻す） */
async function resetWorld() {
  await cleanupCaseTestData();
  w = await setupCaseWorld();
  room = await seedCase({
    n: 91,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]147B割り込み",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
    ],
  });
}

type Expected =
  | { code: "FORBIDDEN" | "VALIDATION_ERROR" | "NOT_FOUND" }
  | { code: "CONFLICT"; reason: string }
  | { stateChanged: true }
  | { forbiddenOrStateChanged: true };

type Scenario = {
  name: string;
  /** 準備（resetWorld の後） */
  arrange?: () => Promise<void>;
  operation: Operation;
  interrupt: () => Promise<void>;
  expected: Expected;
};

function matches(result: { ok: false; error: unknown }, expected: Expected) {
  const { error } = result;
  if ("stateChanged" in expected) return error instanceof CaseStateChangedError;
  if ("forbiddenOrStateChanged" in expected)
    return (
      error instanceof CaseStateChangedError ||
      (error instanceof AppError && error.code === "FORBIDDEN")
    );
  if (!(error instanceof AppError)) return false;
  if (error.code !== expected.code) return false;
  return "reason" in expected ? error.details.reason === expected.reason : true;
}

const describeResult = (
  result: { ok: true; value: unknown } | { ok: false; error: unknown },
) =>
  result.ok
    ? `成功 ${JSON.stringify(result.value)}`
    : result.error instanceof AppError
      ? `${result.error.code} ${JSON.stringify(result.error.details)}`
      : String(result.error);

// 表には関数だけを書く（beforeEach・resetWorld で代入する変数は、呼ばれた時点で読む）
const SCENARIOS: Scenario[] = [
  {
    name: "同じ人の追加と、別の人による同じ人の追加 → 409 already_participant",
    operation: (s) =>
      s.addParticipant(actorOf(w.memberS1.id), room.id, {
        userId: w.memberS2.id,
      }),
    interrupt: () => addCaseMember(room.roomId, w.memberS2.id),
    expected: {
      code: "CONFLICT",
      reason: CASE_CONFLICT_REASONS.alreadyParticipant,
    },
  },
  {
    name: "追加と、対象の無効化 → 422",
    operation: (s) =>
      s.addParticipant(actorOf(w.memberS1.id), room.id, {
        userId: w.memberS2.id,
      }),
    interrupt: () => setUserActive(w.memberS2.id, false),
    expected: { code: "VALIDATION_ERROR" },
  },
  {
    name: "追加と、操作者自身が外される → 403",
    operation: (s) =>
      s.addParticipant(actorOf(w.memberS1.id), room.id, {
        userId: w.memberS2.id,
      }),
    interrupt: () => removeCaseMember(room.roomId, w.memberS1.id),
    expected: { code: "FORBIDDEN" },
  },
  {
    name: "追加と、操作者の無効化（参加の行は残す） → 403 または CaseStateChangedError",
    operation: (s) =>
      s.addParticipant(actorOf(w.memberS1.id), room.id, {
        userId: w.memberS2.id,
      }),
    interrupt: () => setUserActive(w.memberS1.id, false),
    expected: { forbiddenOrStateChanged: true },
  },
  {
    name: "追加と、案件の終了 → 409 closed",
    operation: (s) =>
      s.addParticipant(actorOf(w.memberS1.id), room.id, {
        userId: w.memberS2.id,
      }),
    interrupt: () => setCaseStatus(room.id, "closed"),
    expected: { code: "CONFLICT", reason: CASE_CONFLICT_REASONS.closed },
  },
  {
    name: "最後の2人の一般の参加者の同時の退出（相手の退出が先に確定） → 409 last_active_participant",
    operation: (s) =>
      s.removeParticipant(actorOf(w.memberS1.id), room.id, w.memberS1.id),
    interrupt: () => removeCaseMember(room.roomId, w.memberD1.id),
    expected: {
      code: "CONFLICT",
      reason: CASE_CONFLICT_REASONS.lastActiveParticipant,
    },
  },
  {
    name: "削除と、対象の担当部署のオーナーへの就任 → 409 auto_participant",
    operation: (s) =>
      s.removeParticipant(actorOf(w.memberS1.id), room.id, w.memberD1.id),
    interrupt: async () => {
      // 部署のオーナーは1人だけ（DB の制約）。前のオーナーを外してから就任させる
      await removeOwner(w.ownerS.id, w.deptS.id);
      await makeOwner(w.memberD1.id, w.deptS.id);
    },
    expected: {
      code: "CONFLICT",
      reason: CASE_CONFLICT_REASONS.autoParticipant,
    },
  },
  {
    name: "削除と、操作者自身が外される → 403",
    operation: (s) =>
      s.removeParticipant(actorOf(w.memberS1.id), room.id, w.memberD1.id),
    interrupt: () => removeCaseMember(room.roomId, w.memberS1.id),
    expected: { code: "FORBIDDEN" },
  },
  {
    name: "削除と、操作者の無効化（参加の行は残す） → 403 または CaseStateChangedError",
    arrange: () => addCaseMember(room.roomId, w.memberS2.id),
    operation: (s) =>
      s.removeParticipant(actorOf(w.memberS1.id), room.id, w.memberD1.id),
    interrupt: () => setUserActive(w.memberS1.id, false),
    expected: { forbiddenOrStateChanged: true },
  },
  {
    name: "削除と、対象がほかの人に外される → 404",
    operation: (s) =>
      s.removeParticipant(actorOf(w.memberS1.id), room.id, w.memberD1.id),
    interrupt: () => removeCaseMember(room.roomId, w.memberD1.id),
    expected: { code: "NOT_FOUND" },
  },
  {
    name: "削除と、案件の終了 → 409 closed",
    operation: (s) =>
      s.removeParticipant(actorOf(w.memberS1.id), room.id, w.memberD1.id),
    interrupt: () => setCaseStatus(room.id, "closed"),
    expected: { code: "CONFLICT", reason: CASE_CONFLICT_REASONS.closed },
  },
  {
    name: "納期の変更と、操作者（参加者）の無効化 → 403 または CaseStateChangedError",
    operation: (s) =>
      s.changeDueDate(actorOf(w.memberS1.id), room.id, {
        dueDate: "2026-12-01",
      }),
    interrupt: () => setUserActive(w.memberS1.id, false),
    expected: { forbiddenOrStateChanged: true },
  },
  {
    name: "納期の変更と、操作者自身が外される → 403",
    operation: (s) =>
      s.changeDueDate(actorOf(w.memberS1.id), room.id, {
        dueDate: "2026-12-01",
      }),
    interrupt: () => removeCaseMember(room.roomId, w.memberS1.id),
    expected: { code: "FORBIDDEN" },
  },
  {
    name: "非参加の担当部署のオーナーの納期の変更と、オーナーでなくなる → 403",
    operation: (s) =>
      s.changeDueDate(actorOf(w.ownerS.id), room.id, {
        dueDate: "2026-12-01",
      }),
    interrupt: () => removeOwner(w.ownerS.id, w.deptS.id),
    expected: { code: "FORBIDDEN" },
  },
  {
    name: "納期の変更と、案件の終了 → 409 closed",
    operation: (s) =>
      s.changeDueDate(actorOf(w.memberS1.id), room.id, {
        dueDate: "2026-12-01",
      }),
    interrupt: () => setCaseStatus(room.id, "closed"),
    expected: { code: "CONFLICT", reason: CASE_CONFLICT_REASONS.closed },
  },
  {
    name: "納期の同時の変更（ほかの人が別の値にした） → CaseStateChangedError",
    operation: (s) =>
      s.changeDueDate(actorOf(w.memberS1.id), room.id, {
        dueDate: "2026-12-01",
      }),
    interrupt: () => setCaseDueDate(room.id, "2026-12-09"),
    expected: { stateChanged: true },
  },
];

beforeEach(async () => {
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

describe("#147 147-B 同時の操作：資格を確かめる読み取りの直後に状態が変わる", () => {
  it.each(SCENARIOS)(
    "#147 147-B: $name（どの読み取りの直後でも、書き込みは何も残さない）",
    async ({ arrange, operation, interrupt, expected }) => {
      // 割り込みなしで、書き込みより前の読み取りの回数を数える（空振りしないこと：成功し、書き込みが呼ばれる）
      await resetWorld();
      await arrange?.();
      const baseline = newRecorder();
      const plain = await runWith(operation, 0, async () => {}, baseline);
      expect(plain.ok, describeResult(plain)).toBe(true);
      expect(baseline.wroteAt).not.toBeNull();
      expect(baseline.readsBeforeWrite).toBeGreaterThan(0);

      const wrong: string[] = [];
      for (let k = 1; k <= baseline.readsBeforeWrite; k += 1) {
        await resetWorld();
        await arrange?.();
        const recorder = newRecorder();
        const result = await runWith(operation, k, interrupt, recorder);
        if (recorder.afterInterrupt === null) {
          wrong.push(`${k}回目の後: 割り込めませんでした`);
          continue;
        }
        if (result.ok || !matches(result, expected)) {
          wrong.push(`${k}回目の後: ${describeResult(result)}`);
          continue;
        }
        const now = await caseWriteSnapshot();
        if (JSON.stringify(now) !== JSON.stringify(recorder.afterInterrupt))
          wrong.push(`${k}回目の後: 書き込みが残りました`);
      }
      expect(wrong).toEqual([]);
    },
  );

  it("#147 147-B: 納期の同時の変更で、ほかの人が同じ値にしていたら 200（何も書かない）", async () => {
    await resetWorld();
    const baseline = newRecorder();
    const operation: Operation = (s) =>
      s.changeDueDate(actorOf(w.memberS1.id), room.id, {
        dueDate: "2026-12-01",
      });
    const plain = await runWith(operation, 0, async () => {}, baseline);
    expect(plain.ok, describeResult(plain)).toBe(true);
    expect(baseline.readsBeforeWrite).toBeGreaterThan(0);
    const wrong: string[] = [];
    for (let k = 1; k <= baseline.readsBeforeWrite; k += 1) {
      await resetWorld();
      const recorder = newRecorder();
      const result = await runWith(
        operation,
        k,
        () => setCaseDueDate(room.id, "2026-12-01"),
        recorder,
      );
      if (!result.ok) wrong.push(`${k}回目の後: ${describeResult(result)}`);
      else
        expect(result.value).toEqual({
          caseId: room.id,
          dueDate: "2026-12-01",
        });
      const now = await caseWriteSnapshot();
      if (JSON.stringify(now) !== JSON.stringify(recorder.afterInterrupt))
        wrong.push(`${k}回目の後: 書き込みが残りました`);
    }
    expect(wrong).toEqual([]);
  });
});
