// #150（150-A）計画 7章「同時の操作」・10章の「読み直し・再試行」「状態が戻る競合」：最初の判定（材料・宛先の読み取り）の「直後」、
// 書き込みの「前」に別の要求が状態を変えても、batch の前提で止まり、Service が最初と同じ判定で読み直して正しい応答にすること。
// 挟み方（先例：case-participant.interleave.test.ts。関数の名前で読み取りを選ばない）：
//   - 本物の Repository（隔離 D1）のすべての関数を Proxy で包み、呼ばれた順に数える
//   - 割り込みなしで、書き込みの関数より前に呼ばれた読み取りの回数を数え、k = 1 からその回数まで、k 回目の読み取りが返った直後に状態を変える
//     （どの読み取りが材料・宛先の読み取りでも、その直後を必ず含む）。各回の前に世界を作り直す
//   - 割り込めたこと（afterInterrupt が null でない）を毎回確かめる
//   - 拒否のとき：割り込みの直後の状態（別の要求の終了・再開の監査・通知を含む）から何も増えない＝拒否された要求の通知・監査が残らない
// 両方向：「材料の読み取り → 別の要求の終了・再開 → 元の終了・再開」（状態が戻る競合を含む）と、
//   「材料の読み取り → 別の要求の本物の終了 → 元の参加者の追加・削除・納期の変更」。
// 権限の判定は本物（createCaseService(repository, roles)）。別の要求は、包んでいない Service（withCaseService）で本物の操作として行う。
// 契約（実装前の仮置き。計画 150-A。実装の担当へ）：backend/src/services/case.service.ts
//   service.close(actor, caseId): Promise<{ caseId, status: "closed" }>
//   service.reopen(actor, caseId, body): Promise<{ caseId, status: "active" }>（150-B で本文つき。ここでは選び直しなし）
//   最初の判定の材料（findWriteFacts。版を含む）を、宛先の読み取り（listCaseNotifyRecipients）より先に読む（6.2 の順）。
//   書き込みの関数の名前は closeCase・reopenCase（db/case-close.repository.db.test.ts と同じ）。
// 時刻は CASEREQ_NOW に固定する。データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
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
  CASE_CLOSE_MESSAGES,
  CASE_CLOSE_REASONS,
  caseCloseAudits,
  caseCloseSnapshot,
  caseRowOf,
  recipientsOf,
} from "../../test/case-close-fixtures";
import {
  CASE_CONFLICT_REASONS,
  parseDetail,
  setCaseStatus,
} from "../../test/case-participant-fixtures";
import {
  CASE_REOPEN_MESSAGES,
  CASE_REOPEN_REASONS,
  noReselectBody,
} from "../../test/case-reopen-fixtures";
import {
  CASEREQ_NOW,
  TOMORROW_JST,
  casereqTraceId,
  setUserActive,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import {
  CaseStateChangedError,
  withCases,
  type CaseRepository,
} from "../db/case.repository";
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
/** deptS 担当：memberS1・memberD1・inactive（退職者）。状態は resetWorld の引数で決める。納期なし */
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

/**
 * interruptAfter 回目の読み取り（最初の書き込みより前のもの）が返った直後に interrupt を実行する。0 なら割り込まない。
 * every が真なら、書き込みの前後を問わず、すべての読み取りの直後に interrupt を実行する（宛先が変わり続ける場合）
 */
function interleave(
  repository: CaseRepository,
  interruptAfter: number,
  interrupt: () => Promise<void>,
  recorder: Recorder,
  every = false,
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
        if (every) {
          await interrupt();
          recorder.afterInterrupt = await caseCloseSnapshot();
          return result;
        }
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
type Operation = (service: Service) => Promise<unknown>;
type Result = { ok: true; value: unknown } | { ok: false; error: unknown };

const actorOf = (userId: string) => ({ userId, traceId: casereqTraceId() });

async function runWith(
  operation: Operation,
  interruptAfter: number,
  interrupt: () => Promise<void>,
  recorder: Recorder,
  every = false,
): Promise<Result> {
  try {
    const value = await withCases(env, (repository, roles) =>
      operation(
        createCaseService(
          interleave(repository, interruptAfter, interrupt, recorder, every),
          roles,
        ),
      ),
    );
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  }
}

/** 別の要求（包んでいない Service で、本物の操作として行う） */
const other = (run: (service: Service) => Promise<unknown>) => async () => {
  await withCaseService(env, run);
};
const closeBy = (userId: string) =>
  other((s) => s.close(actorOf(userId), room.id));
// 150-B から再開は本文つき。150-A の再開は選び直しなし（呼んだ時点のいまの有効な参加者・空の追加と除外）で送る
const reopenBy = (userId: string) =>
  other(async (s) =>
    s.reopen(actorOf(userId), room.id, await noReselectBody(room.id)),
  );

/** 世界と案件を作り直す（書き込み・割り込みで変えた状態を、k ごとに元に戻す） */
async function resetWorld(status: "active" | "closed") {
  await cleanupCaseTestData();
  w = await setupCaseWorld();
  room = await seedCase({
    n: 1521,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]150割り込み",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    status,
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
      { userId: w.inactive.id, joinedAt: joinedAt(3) },
    ],
  });
}

type Expected =
  | { code: "FORBIDDEN" | "NOT_FOUND" }
  | { code: "CONFLICT"; reason: string; message?: string }
  | { forbiddenOrStateChanged: true };

function matches(error: unknown, expected: Expected) {
  if ("forbiddenOrStateChanged" in expected)
    return (
      error instanceof CaseStateChangedError ||
      (error instanceof AppError && error.code === "FORBIDDEN")
    );
  if (!(error instanceof AppError)) return false;
  if (error.code !== expected.code) return false;
  if (expected.code === "FORBIDDEN")
    // 状態（終了・進行中）を漏らさない：文言は「参加者だけが操作できます」で、reason を持たない
    return (
      error.message === CASE_CLOSE_MESSAGES.participantsOnly &&
      error.details.reason === undefined
    );
  if (!("reason" in expected)) return true;
  if (error.details.reason !== expected.reason) return false;
  return expected.message === undefined || error.message === expected.message;
}

const describeResult = (result: Result) =>
  result.ok
    ? `成功 ${JSON.stringify(result.value)}`
    : result.error instanceof AppError
      ? `${result.error.code} ${result.error.message} ${JSON.stringify(result.error.details)}`
      : String(result.error);

type RejectScenario = {
  name: string;
  /** 元の要求の前の案件の状態 */
  status: "active" | "closed";
  operation: Operation;
  interrupt: () => Promise<void>;
  expected: Expected;
};

const close =
  (userId: string): Operation =>
  (s) =>
    s.close(actorOf(userId), room.id);
/** 確認した参加者（participantIds）は、割り込みより前（Repository の読み取りより前）に読んで固定する */
const reopen =
  (userId: string): Operation =>
  async (s) =>
    s.reopen(actorOf(userId), room.id, await noReselectBody(room.id));

// 表には関数だけを書く（resetWorld で代入する変数は、呼ばれた時点で読む）
const REJECTS: RejectScenario[] = [
  // ---- 元の要求が終了 ----
  {
    name: "終了と、操作者自身が外される → 403",
    status: "active",
    operation: (s) => close(w.memberS1.id)(s),
    interrupt: () => removeCaseMember(room.roomId, w.memberS1.id),
    expected: { code: "FORBIDDEN" },
  },
  {
    name: "終了と、操作者の無効化（参加の行は残す） → 403 または CaseStateChangedError",
    status: "active",
    operation: (s) => close(w.memberS1.id)(s),
    interrupt: () => setUserActive(w.memberS1.id, false),
    expected: { forbiddenOrStateChanged: true },
  },
  {
    name: "終了と、ほかの参加者による本物の終了 → 409 already_closed",
    status: "active",
    operation: (s) => close(w.memberS1.id)(s),
    interrupt: () => closeBy(w.memberD1.id)(),
    expected: {
      code: "CONFLICT",
      reason: CASE_CLOSE_REASONS.alreadyClosed,
      message: CASE_CLOSE_MESSAGES.alreadyClosed,
    },
  },
  {
    name: "終了と、操作者が外されたうえで終了（存在の非開示）→ 409 ではなく 403",
    status: "active",
    operation: (s) => close(w.memberS1.id)(s),
    interrupt: async () => {
      await removeCaseMember(room.roomId, w.memberS1.id);
      await setCaseStatus(room.id, "closed");
    },
    expected: { code: "FORBIDDEN" },
  },
  {
    name: "状態が戻る競合：終了と、ほかの参加者の本物の終了 → 再開 → 409 stale（案件は進行中のまま）",
    status: "active",
    operation: (s) => close(w.memberS1.id)(s),
    interrupt: async () => {
      await closeBy(w.memberD1.id)();
      await reopenBy(w.memberD1.id)();
    },
    expected: {
      code: "CONFLICT",
      reason: CASE_CLOSE_REASONS.stale,
      message: CASE_CLOSE_MESSAGES.stale,
    },
  },
  {
    name: "終了と、本物の納期の変更（版が進む） → 409 stale",
    status: "active",
    operation: (s) => close(w.memberS1.id)(s),
    interrupt: other((s) =>
      s.changeDueDate(actorOf(w.memberD1.id), room.id, {
        dueDate: TOMORROW_JST,
      }),
    ),
    expected: { code: "CONFLICT", reason: CASE_CLOSE_REASONS.stale },
  },
  {
    name: "宛先の再試行で新しい版に差し替えない：終了と、参加者の追加と納期の変更（宛先と版の両方が変わる） → 409 stale",
    status: "active",
    operation: (s) => close(w.memberS1.id)(s),
    interrupt: async () => {
      await addCaseMember(room.roomId, w.memberS2.id);
      await other((s) =>
        s.changeDueDate(actorOf(w.memberD1.id), room.id, {
          dueDate: TOMORROW_JST,
        }),
      )();
    },
    expected: { code: "CONFLICT", reason: CASE_CLOSE_REASONS.stale },
  },
  // ---- 元の要求が再開 ----
  {
    name: "再開と、操作者自身が外される → 403",
    status: "closed",
    operation: (s) => reopen(w.memberS1.id)(s),
    interrupt: () => removeCaseMember(room.roomId, w.memberS1.id),
    expected: { code: "FORBIDDEN" },
  },
  {
    name: "再開と、ほかの参加者による本物の再開 → 409 already_active",
    status: "closed",
    operation: (s) => reopen(w.memberS1.id)(s),
    interrupt: () => reopenBy(w.memberD1.id)(),
    expected: {
      code: "CONFLICT",
      reason: CASE_CLOSE_REASONS.alreadyActive,
      message: CASE_CLOSE_MESSAGES.alreadyActive,
    },
  },
  {
    name: "再開と、操作者が外されたうえで再開（存在の非開示）→ 409 ではなく 403",
    status: "closed",
    operation: (s) => reopen(w.memberS1.id)(s),
    interrupt: async () => {
      await removeCaseMember(room.roomId, w.memberS1.id);
      await setCaseStatus(room.id, "active");
    },
    expected: { code: "FORBIDDEN" },
  },
  {
    name: "状態が戻る競合：再開と、ほかの参加者の本物の再開 → 終了 → 409 stale（案件は終了のまま）",
    status: "closed",
    operation: (s) => reopen(w.memberS1.id)(s),
    interrupt: async () => {
      await reopenBy(w.memberD1.id)();
      await closeBy(w.memberD1.id)();
    },
    expected: {
      code: "CONFLICT",
      reason: CASE_CLOSE_REASONS.stale,
      message: CASE_CLOSE_MESSAGES.stale,
    },
  },
  {
    // 150-B の決定 Q8 に基づく期待の変更：150-A では「宛先を読み直して成功し、足した人にも通知が届く」だった。
    // 確認の画面で見た参加者（participantIds）と、いまの有効な参加者が違うので、取り直して選び直してもらう
    name: "再開と、参加者の追加 → 409 participants_changed（要求の側の状態・参加の行・監査・通知は増えない）",
    status: "closed",
    operation: (s) => reopen(w.memberS1.id)(s),
    interrupt: () => addCaseMember(room.roomId, w.memberS2.id),
    expected: {
      code: "CONFLICT",
      reason: CASE_REOPEN_REASONS.participantsChanged,
      message: CASE_REOPEN_MESSAGES.participantsChanged,
    },
  },
  // ---- 逆の向き：元の要求は 147-B の操作、割り込みは本物の終了 ----
  {
    name: "参加者の追加と、ほかの参加者による本物の終了 → 409 closed",
    status: "active",
    operation: (s) =>
      s.addParticipant(actorOf(w.memberS1.id), room.id, {
        userId: w.memberS2.id,
      }),
    interrupt: () => closeBy(w.memberD1.id)(),
    expected: { code: "CONFLICT", reason: CASE_CONFLICT_REASONS.closed },
  },
  {
    name: "参加者の削除と、ほかの参加者による本物の終了 → 409 closed",
    status: "active",
    operation: async (s) => {
      await addCaseMember(room.roomId, w.memberS2.id);
      return s.removeParticipant(
        actorOf(w.memberS1.id),
        room.id,
        w.memberS2.id,
      );
    },
    interrupt: () => closeBy(w.memberD1.id)(),
    expected: { code: "CONFLICT", reason: CASE_CONFLICT_REASONS.closed },
  },
  {
    name: "納期の変更と、ほかの参加者による本物の終了 → 409 closed",
    status: "active",
    operation: (s) =>
      s.changeDueDate(actorOf(w.memberS1.id), room.id, {
        dueDate: TOMORROW_JST,
      }),
    interrupt: () => closeBy(w.memberD1.id)(),
    expected: { code: "CONFLICT", reason: CASE_CONFLICT_REASONS.closed },
  },
];

type SuccessScenario = {
  name: string;
  status: "active" | "closed";
  operation: Operation;
  interrupt: () => Promise<void>;
  kind: "case.closed" | "case.reopened";
  /** 成功の後の通知の宛先（昇順で比べる） */
  recipients: () => string[];
};

const SUCCESSES: SuccessScenario[] = [
  {
    name: "終了と、参加者の追加 → 宛先を読み直して成功し、足した人にも通知が届く",
    status: "active",
    operation: (s) => close(w.memberS1.id)(s),
    interrupt: () => addCaseMember(room.roomId, w.memberS2.id),
    kind: "case.closed",
    recipients: () => [w.memberD1.id, w.memberS2.id],
  },
  {
    name: "終了と、ほかの参加者の無効化 → 成功し、無効になった人には通知しない",
    status: "active",
    operation: (s) => close(w.memberS1.id)(s),
    interrupt: () => setUserActive(w.memberD1.id, false),
    kind: "case.closed",
    recipients: () => [],
  },
  {
    name: "終了と、ほかの参加者の本物の削除 → 成功し、外された人には通知しない",
    status: "active",
    operation: (s) => close(w.memberS1.id)(s),
    interrupt: async () => {
      await addCaseMember(room.roomId, w.memberS2.id);
      await other((s) =>
        s.removeParticipant(actorOf(w.memberS2.id), room.id, w.memberD1.id),
      )();
    },
    kind: "case.closed",
    recipients: () => [w.memberS2.id],
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
async function baselineOf(status: "active" | "closed", operation: Operation) {
  await resetWorld(status);
  const baseline = newRecorder();
  const plain = await runWith(operation, 0, async () => {}, baseline);
  expect(plain.ok, describeResult(plain)).toBe(true);
  expect(baseline.wroteAt).not.toBeNull();
  expect(baseline.readsBeforeWrite).toBeGreaterThan(0);
  return baseline.readsBeforeWrite;
}

describe("#150 150-A 同時の操作：材料の読み取りの直後に、別の要求が状態を変える（拒否）", () => {
  it.each(REJECTS)(
    "#150 7章: $name（どの読み取りの直後でも、拒否された要求の監査・通知・状態の変更は残らない）",
    async ({ status, operation, interrupt, expected }) => {
      const reads = await baselineOf(status, operation);
      const wrong: string[] = [];
      for (let k = 1; k <= reads; k += 1) {
        await resetWorld(status);
        const recorder = newRecorder();
        const result = await runWith(operation, k, interrupt, recorder);
        if (recorder.afterInterrupt === null) {
          wrong.push(`${k}回目の後: 割り込めませんでした`);
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

describe("#150 150-A 同時の操作：宛先が変わる（読み直して1回だけやり直す）", () => {
  it.each(SUCCESSES)(
    "#150 7章・3-3 AC-1: $name",
    async ({ status, operation, interrupt, kind, recipients }) => {
      const reads = await baselineOf(status, operation);
      const wrong: string[] = [];
      for (let k = 1; k <= reads; k += 1) {
        await resetWorld(status);
        const recorder = newRecorder();
        const result = await runWith(operation, k, interrupt, recorder);
        if (recorder.afterInterrupt === null) {
          wrong.push(`${k}回目の後: 割り込めませんでした`);
          continue;
        }
        if (!result.ok) {
          wrong.push(`${k}回目の後: ${describeResult(result)}`);
          continue;
        }
        const expectedRecipients = [...recipients()].sort();
        const actual = await recipientsOf(kind);
        if (JSON.stringify(actual) !== JSON.stringify(expectedRecipients))
          wrong.push(
            `${k}回目の後: 宛先 ${JSON.stringify(actual)}（期待 ${JSON.stringify(expectedRecipients)}）`,
          );
        const audits = (await caseCloseAudits()).filter(
          (a) => a.target_id === room.id,
        );
        if (
          audits.length !== 1 ||
          JSON.stringify(parseDetail(audits[0]?.detail ?? null)) !==
            JSON.stringify({
              caseId: room.id,
              notifiedCount: expectedRecipients.length,
            })
        )
          wrong.push(`${k}回目の後: 監査 ${JSON.stringify(audits)}`);
      }
      expect(wrong).toEqual([]);
    },
  );

  it("#150 6.2・error-api: 宛先が読むたびに変わる（2回続けて前提が崩れる）と、409 retry で、成功にせず、監査・通知・状態は残らない", async () => {
    await resetWorld("active");
    const pool = [
      w.memberS2.id,
      w.ownerD.id,
      w.ownerH.id,
      w.noDept.id,
      w.ownerS.id,
      w.admin.id,
    ];
    let next = 0;
    const recorder = newRecorder();
    const result = await runWith(
      (s) => close(w.memberS1.id)(s),
      0,
      async () => {
        const userId = pool[next];
        next += 1;
        if (userId !== undefined) await addCaseMember(room.roomId, userId);
      },
      recorder,
      true,
    );
    expect(result.ok, describeResult(result)).toBe(false);
    expect(
      !result.ok &&
        result.error instanceof AppError &&
        result.error.code === "CONFLICT" &&
        result.error.details.reason === CASE_CLOSE_REASONS.retry,
      describeResult(result),
    ).toBe(true);
    expect(await caseRowOf(room.id)).toMatchObject({
      status: "active",
      version: 1,
    });
    expect(await caseCloseAudits()).toEqual([]);
    expect(await recipientsOf("case.closed")).toEqual([]);
  });
});
