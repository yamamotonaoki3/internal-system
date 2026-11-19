// #150（150-B）計画 7章「同時の操作」：再開の選び直しで、最初の判定（材料・宛先の読み取り）の「直後」、書き込みの「前」に、
// 別の要求が参加者・役割・状態を変えても、batch の前提で止まり、Service が最初と同じ判定で読み直して正しい応答にすること。
// 挟み方は services/case-close.interleave.test.ts と同じ（本物の Repository を Proxy で包み、k 回目の読み取りの直後に割り込む。各回の前に世界を作り直す。
// 割り込めたこと〔afterInterrupt が null でない〕を毎回確かめ、拒否のときは割り込みの直後の状態から何も増えない＝要求の側の変更・監査・通知が残らない）。
// 元の要求：memberS1 が、終了中の案件を memberD1 を外し noDept を足して再開する。確認した参加者（participantIds）は、割り込みの前に固定する。
// 別の要求：参加者の無効化・参加者の追加（オーナー交代の自動参加の代わり）・参加者の削除 → participants_changed、
//   外す予定の人が全体管理者になる → auto_participant、追加の人の無効化 → 422、操作者の無効化 → 403、
//   別の人の再開 → already_active、別の人の再開 → 終了（状態が戻る）→ stale。
// 契約（実装前の仮置き。計画 150-B 6.2。実装の担当へ）：backend/src/services/case.service.ts
//   service.reopen(actor, caseId, body: { participantIds, addUserIds, removeUserIds }): Promise<{ caseId, status: "active" }>
//   書き込みの関数の名前は reopenCase（Repository）。材料の読み取り（findReopenFacts）・宛先の読み取りは、書き込みより前。
// 時刻は CASEREQ_NOW に固定する。データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupCaseTestData,
  joinedAt,
  removeCaseMember,
  seedCase,
  addCaseMember,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  CASE_CLOSE_MESSAGES,
  CASE_CLOSE_REASONS,
  caseCloseSnapshot,
} from "../../test/case-close-fixtures";
import {
  CASE_REOPEN_MESSAGES,
  CASE_REOPEN_REASONS,
  activeParticipantIdsOf,
  noReselectBody,
  type ReopenBody,
} from "../../test/case-reopen-fixtures";
import { makeGlobalAdmin } from "../../test/department-fixtures";
import {
  CASEREQ_NOW,
  casereqTraceId,
  removeGlobalAdmin,
  setUserActive,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { withCases, type CaseRepository } from "../db/case.repository";
import { AppError } from "../lib/app-error";
import { createCaseService, withCaseService } from "./case.service";

const WRITES = new Set([
  "closeCase",
  "reopenCase",
  "addParticipant",
  "removeParticipant",
  "changeDueDate",
]);

let w: CaseWorld;
/** 終了中・deptS 担当：memberS1・memberD1・memberS2・inactive（退職者の行）。noDept・ownerD は参加していない */
let room: SeededCase;

type Snapshot = Awaited<ReturnType<typeof caseCloseSnapshot>>;
type Recorder = {
  readsBeforeWrite: number;
  wroteAt: number | null;
  calls: number;
  afterInterrupt: Snapshot | null;
};
const newRecorder = (): Recorder => ({
  readsBeforeWrite: 0,
  wroteAt: null,
  calls: 0,
  afterInterrupt: null,
});

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
        if (isWrite) return result;
        if (recorder.wroteAt === null) {
          recorder.readsBeforeWrite += 1;
          if (recorder.readsBeforeWrite === interruptAfter && !interrupted) {
            interrupted = true;
            await interrupt();
            recorder.afterInterrupt = await caseCloseSnapshot();
          }
        }
        return result;
      };
    },
  }) as CaseRepository;
}

type Service = ReturnType<typeof createCaseService>;
type Result = { ok: true; value: unknown } | { ok: false; error: unknown };

const actorOf = (userId: string) => ({ userId, traceId: casereqTraceId() });

async function runWith(
  body: ReopenBody,
  interruptAfter: number,
  interrupt: () => Promise<void>,
  recorder: Recorder,
): Promise<Result> {
  try {
    const value = await withCases(env, (repository, roles) =>
      createCaseService(
        interleave(repository, interruptAfter, interrupt, recorder),
        roles,
      ).reopen(actorOf(w.memberS1.id), room.id, body),
    );
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  }
}

const other = (run: (service: Service) => Promise<unknown>) => async () => {
  await withCaseService(env, run);
};
const reopenBy = (userId: string) =>
  other(async (s) =>
    s.reopen(actorOf(userId), room.id, await noReselectBody(room.id)),
  );
const closeBy = (userId: string) =>
  other((s) => s.close(actorOf(userId), room.id));

async function resetWorld() {
  await cleanupCaseTestData();
  w = await setupCaseWorld();
  room = await seedCase({
    n: 1621,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]150選び直しの割り込み",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    status: "closed",
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
      { userId: w.memberS2.id, joinedAt: joinedAt(3) },
      { userId: w.inactive.id, joinedAt: joinedAt(4) },
    ],
  });
}

/** 確認の画面で見た参加者で、memberD1 を外し noDept を足す本文（割り込みの前に読む） */
async function reselectBody(): Promise<ReopenBody> {
  return {
    participantIds: await activeParticipantIdsOf(room.roomId),
    addUserIds: [w.noDept.id],
    removeUserIds: [w.memberD1.id],
  };
}

type Expected =
  | { code: "FORBIDDEN" }
  | { code: "VALIDATION_ERROR"; fields: string[]; message: string }
  | { code: "CONFLICT"; reason: string; message?: string };

function matches(error: unknown, expected: Expected) {
  if (!(error instanceof AppError)) return false;
  if (error.code !== expected.code) return false;
  if (expected.code === "FORBIDDEN")
    // 状態・参加者を漏らさない：403 で reason を持たない（無効になった操作者は、参加者の判定と権限の判定のどちらで止まってもよい。
    // 150-A の services/case-close.interleave.test.ts の「操作者の無効化」と同じ扱い）
    return error.details.reason === undefined;
  if (expected.code === "VALIDATION_ERROR")
    return (
      JSON.stringify(error.details.fields) ===
        JSON.stringify(expected.fields) && error.message === expected.message
    );
  if (error.details.reason !== expected.reason) return false;
  return expected.message === undefined || error.message === expected.message;
}

const describeResult = (result: Result) =>
  result.ok
    ? `成功 ${JSON.stringify(result.value)}`
    : result.error instanceof AppError
      ? `${result.error.code} ${result.error.message} ${JSON.stringify(result.error.details)}`
      : String(result.error);

type Scenario = {
  name: string;
  interrupt: () => Promise<void>;
  expected: Expected;
};

const PARTICIPANTS_CHANGED: Expected = {
  code: "CONFLICT",
  reason: CASE_REOPEN_REASONS.participantsChanged,
  message: CASE_REOPEN_MESSAGES.participantsChanged,
};

// 表には関数だけを書く（resetWorld で代入する変数は、呼ばれた時点で読む）
const SCENARIOS: Scenario[] = [
  {
    name: "確認の後に、ほかの参加者が無効化された → 409 participants_changed",
    interrupt: () => setUserActive(w.memberS2.id, false),
    expected: PARTICIPANTS_CHANGED,
  },
  {
    name: "確認の後に、参加者が追加された（オーナー交代の自動参加の代わり） → 409 participants_changed",
    interrupt: () => addCaseMember(room.roomId, w.ownerD.id),
    expected: PARTICIPANTS_CHANGED,
  },
  {
    name: "確認の後に、ほかの参加者が外された → 409 participants_changed",
    interrupt: () => removeCaseMember(room.roomId, w.memberS2.id),
    expected: PARTICIPANTS_CHANGED,
  },
  {
    name: "確認の後に、外す予定の人が全体管理者になった（全体管理者の交代。全体管理者は1人だけ） → 409 auto_participant",
    interrupt: async () => {
      await removeGlobalAdmin(w.admin.id);
      await makeGlobalAdmin(w.memberD1.id);
    },
    expected: {
      code: "CONFLICT",
      reason: CASE_REOPEN_REASONS.autoParticipant,
      message: CASE_REOPEN_MESSAGES.autoParticipant,
    },
  },
  {
    name: "確認の後に、追加の人が無効化された → 422 addUserIds",
    interrupt: () => setUserActive(w.noDept.id, false),
    expected: {
      code: "VALIDATION_ERROR",
      fields: ["addUserIds"],
      message: CASE_REOPEN_MESSAGES.targetInvalid,
    },
  },
  {
    name: "確認の後に、操作者が無効化された → 403（状態・参加者を漏らさない）",
    interrupt: () => setUserActive(w.memberS1.id, false),
    expected: { code: "FORBIDDEN" },
  },
  {
    name: "確認の後に、ほかの参加者が先に再開した → 409 already_active",
    interrupt: () => reopenBy(w.memberS2.id)(),
    expected: {
      code: "CONFLICT",
      reason: CASE_CLOSE_REASONS.alreadyActive,
      message: CASE_CLOSE_MESSAGES.alreadyActive,
    },
  },
  {
    name: "状態が戻る競合：ほかの参加者の再開 → 終了 → 409 stale",
    interrupt: async () => {
      await reopenBy(w.memberS2.id)();
      await closeBy(w.memberS2.id)();
    },
    expected: {
      code: "CONFLICT",
      reason: CASE_CLOSE_REASONS.stale,
      message: CASE_CLOSE_MESSAGES.stale,
    },
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

/** 割り込みなしで、書き込みより前の読み取りの回数を数える（空振りしないこと：成功し、書き込みが呼ばれる） */
async function baseline() {
  await resetWorld();
  const recorder = newRecorder();
  const plain = await runWith(
    await reselectBody(),
    0,
    async () => {},
    recorder,
  );
  expect(plain.ok, describeResult(plain)).toBe(true);
  expect(recorder.wroteAt).not.toBeNull();
  expect(recorder.readsBeforeWrite).toBeGreaterThan(0);
  return recorder.readsBeforeWrite;
}

describe("#150 150-B 同時の操作：確認の後に、別の要求が参加者・役割・状態を変える（拒否）", () => {
  it.each(SCENARIOS)(
    "#150 7章: $name（どの読み取りの直後でも、要求の側の状態・参加の行・監査・通知は増えない）",
    async ({ interrupt, expected }) => {
      const reads = await baseline();
      const wrong: string[] = [];
      for (let k = 1; k <= reads; k += 1) {
        await resetWorld();
        const body = await reselectBody();
        const recorder = newRecorder();
        const result = await runWith(body, k, interrupt, recorder);
        if (recorder.afterInterrupt === null) {
          wrong.push(
            `${k}回目の後: 割り込めませんでした（${describeResult(result)}）`,
          );
          continue;
        }
        if (result.ok || !matches(result.error, expected)) {
          wrong.push(`${k}回目の後: ${describeResult(result)}`);
          continue;
        }
        const now = await caseCloseSnapshot();
        if (JSON.stringify(now) !== JSON.stringify(recorder.afterInterrupt))
          wrong.push(`${k}回目の後: 書き込みが残りました`);
      }
      expect(wrong).toEqual([]);
    },
  );
});
