// #148（148-B-1）計画 148-B-1「判定の順」4・「同時の操作」の1行目（#196）：資格の確認（判定の材料の読み取り）の「直後」、一覧の読み取りの「前」に、
// 閲覧者が参加から外される・無効になると、一覧の読み取りそのものが資格を確かめて 403 になり、添付（ファイル名・投稿者・件数）を返さないこと
// （先例：services/case-todo.interleave.test.ts の「一覧の読み取りと、閲覧者の資格の喪失」）。
// 挟み方：本物の Repository（隔離 D1）のすべての関数を Proxy で包み、呼ばれた順に数える。割り込みなしで、Service が呼ぶ読み取りの回数を数え、
//   k = 1 から（最後の読み取りより前の）各読み取りが返った直後に状態を変える。各回の前に初期のデータに戻し、割り込めたこと（割り込みが実行されたこと）を確かめる。
// 権限の判定は本物（createCaseAttachmentService(repository, roles)）。
// 契約（実装前の仮置き）：withCaseAttachments(env, (repository, roles) => …)・CaseAttachmentRepository・
//   createCaseAttachmentService(repository, roles).list(actor, caseId, { limit, cursor })
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { seedCaseAttachment } from "../../test/case-attachment-fixtures";
import { removeCaseMember } from "../../test/case-fixtures";
import {
  casereqTraceId,
  setUserActive,
} from "../../test/case-request-fixtures";
import {
  cleanupCaseRoomWorld,
  seedRoomMessage,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";
import {
  withCaseAttachments,
  type CaseAttachmentRepository,
} from "../db/case-attachment.repository";
import { createCaseAttachmentService } from "./case-attachment.service";

let cw: CaseRoomWorld;

type Recorder = { reads: number; interrupted: boolean };
const newRecorder = (): Recorder => ({ reads: 0, interrupted: false });

function interleave(
  repository: CaseAttachmentRepository,
  interruptAfter: number,
  interrupt: () => Promise<void>,
  recorder: Recorder,
): CaseAttachmentRepository {
  return new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        const result: unknown = await (
          value as (...a: unknown[]) => unknown
        ).apply(target, args);
        recorder.reads += 1;
        if (recorder.reads === interruptAfter && !recorder.interrupted) {
          recorder.interrupted = true;
          await interrupt();
        }
        return result;
      };
    },
  }) as CaseAttachmentRepository;
}

type Result = { ok: true; value: unknown } | { ok: false; error: unknown };

async function runWith(
  interruptAfter: number,
  interrupt: () => Promise<void>,
  recorder: Recorder,
): Promise<Result> {
  try {
    const value = await withCaseAttachments(env, (repository, roles) =>
      createCaseAttachmentService(
        interleave(repository, interruptAfter, interrupt, recorder),
        roles,
      ).list(
        { userId: cw.w.memberS1.id, traceId: casereqTraceId() },
        cw.open.id,
        { limit: 50, cursor: null },
      ),
    );
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  }
}

const describeResult = (result: Result) =>
  result.ok
    ? `成功：${JSON.stringify(result.value)}`
    : `失敗：${JSON.stringify(result.error)} ${String(result.error)}`;
const isForbidden = (result: Result) =>
  !result.ok &&
  (result.error as { code?: unknown } | null)?.code === "FORBIDDEN";

async function resetWorld() {
  await cleanupCaseRoomWorld();
  cw = await setupCaseRoomWorld(1580);
  const parent = await seedRoomMessage(cw.open.roomId, cw.w.memberD1.id, 1);
  await seedCaseAttachment({
    n: 1,
    roomId: cw.open.roomId,
    uploaderId: cw.w.memberD1.id,
    messageId: parent,
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseRoomWorld();
});

describe("#148 AC-7 148-B-1 一覧の読み取りと、閲覧者の資格の喪失（割り込み）", () => {
  it.each([
    [
      "参加者から外される",
      () => removeCaseMember(cw.open.roomId, cw.w.memberS1.id),
    ],
    ["無効になる", () => setUserActive(cw.w.memberS1.id, false)],
  ])(
    "#148 AC-7 #196: 閲覧者が、最後の読み取りより前のどの読み取りの直後に%sても 403 で、添付を返さない",
    async (_label, lose) => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
      await resetWorld();
      const probe = newRecorder();
      const plain = await runWith(0, async () => {}, probe);
      expect(plain.ok, describeResult(plain)).toBe(true);
      expect(
        (plain as { value: { items: unknown[] } }).value.items,
      ).toHaveLength(1);
      const total = probe.reads;
      // 資格の確認と一覧の読み取りの、少なくとも2回の読み取りがあり、その間に割り込める
      expect(total).toBeGreaterThanOrEqual(2);
      for (let k = 1; k < total; k += 1) {
        await resetWorld();
        const recorder = newRecorder();
        const result = await runWith(k, lose, recorder);
        expect(recorder.interrupted, `k=${k}`).toBe(true);
        expect(isForbidden(result), `k=${k}: ${describeResult(result)}`).toBe(
          true,
        );
      }
      // 読み取りの前に資格を失っていれば 403（k=0 にあたる）
      await resetWorld();
      await lose();
      const before = await runWith(0, async () => {}, newRecorder());
      expect(isForbidden(before), describeResult(before)).toBe(true);
    },
  );
});
