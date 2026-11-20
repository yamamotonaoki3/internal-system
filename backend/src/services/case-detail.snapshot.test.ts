// #150（150-C）計画 4.2.1・6章「2回目 重大1 詳細の時点」：詳細の API（service.detail）は、概要を読んで資格を確かめた後に詳細を読む。
// その間に別の要求が件名・説明を変えても、応答の件名・説明・取引先・担当部署・版は、すべて詳細の読み取り（findDetailExtras の1回の batch）の時点の値で、
// 「古い件名と新しい版」の組み合わせを返さないこと。画面は、この1つの応答から編集の基準（初期値・比べる値・送る版）を作る（計画 4.6）。
// 割り込みは、findDetailExtras が呼ばれた時点で、本物に渡す前にだけ入れる（概要の読み取りの後・詳細の読み取りの batch の直前だけ）。
// 契約（実装前の仮置き。計画 150-C 4.2.1。実装の担当へ）：
//   findDetailExtras({ caseId, actorId }) は、概要の項目（findSummary と同じ項目）・description・channelId・createdBy・participants・version を
//   同じ batch で読んで返す（または "not_visible" / "not_found"）。service.detail の応答の概要の項目は、findDetailExtras が返した値を使う。
//   応答の項目は既存の詳細の項目 + version（整数）だけ。非参加者は 403 のまま。
// 時刻は CASEREQ_NOW に固定する。データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupCaseTestData,
  joinedAt,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  CASEREQ_NOW,
  casereqTraceId,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { withCases, type CaseRepository } from "../db/case.repository";
import { AppError } from "../lib/app-error";
import { createCaseService, withCaseService } from "./case.service";

const TITLE = "[UNIT_TEST]150C詳細の古い件名";
const DESCRIPTION = "[UNIT_TEST]150C詳細の古い説明";
const NEW_TITLE = "[UNIT_TEST]150C詳細の新しい件名";
const NEW_DESCRIPTION = "[UNIT_TEST]150C詳細の新しい説明";

/** 既存の詳細の項目（routes/cases.test.ts の DETAIL_KEYS と同じ意味）に version を足したもの */
const DETAIL_KEYS = [
  "canEditDueDate",
  "canManage",
  "caseNumber",
  "channelId",
  "client",
  "createdBy",
  "departments",
  "description",
  "dueDate",
  "id",
  "isParticipant",
  "lastActivityAt",
  "participantCount",
  "participants",
  "progress",
  "status",
  "title",
  "version",
].sort();

let w: CaseWorld;
let room: SeededCase;

const actorOf = (userId: string) => ({ userId, traceId: casereqTraceId() });

/** findDetailExtras が呼ばれたら、本物に渡す前に1回だけ割り込む */
function beforeDetailRead(
  repository: CaseRepository,
  interrupt: () => Promise<void>,
  state: { interrupted: boolean; summaryReadFirst: boolean },
): CaseRepository {
  let summaryRead = false;
  return new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        if (property === "findSummary") summaryRead = true;
        if (property === "findDetailExtras" && !state.interrupted) {
          state.interrupted = true;
          state.summaryReadFirst = summaryRead;
          await interrupt();
        }
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as CaseRepository;
}

async function detailWith(actorId: string, interrupt: () => Promise<void>) {
  const state = { interrupted: false, summaryReadFirst: false };
  const result = await withCases(env, (repository, roles) =>
    createCaseService(beforeDetailRead(repository, interrupt, state), roles)
      .detail(actorOf(actorId), room.id)
      .then(
        (value) => ({ value: value as Record<string, unknown>, error: null }),
        (error: unknown) => ({ value: null, error }),
      ),
  );
  return { ...result, state };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(CASEREQ_NOW));
  for (const method of ["log", "warn", "error"] as const)
    vi.spyOn(console, method).mockImplementation(() => {});
  w = await setupCaseWorld();
  room = await seedCase({
    n: 1651,
    clientId: w.clientA.id,
    code: "QZA",
    title: TITLE,
    description: DESCRIPTION,
    createdBy: w.memberS1.id,
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

describe("#150 150-C 計画 4.2.1：詳細の応答を1つの時点にそろえる", () => {
  it("#150 4.2.1: 割り込みなしでは、詳細の項目は既存の項目 + version（整数 1）", async () => {
    const { value, state } = await detailWith(w.memberS1.id, async () => {});
    expect(state.interrupted).toBe(true);
    expect(Object.keys(value ?? {}).sort()).toEqual(DETAIL_KEYS);
    expect(value).toMatchObject({
      title: TITLE,
      description: DESCRIPTION,
      version: 1,
    });
    expect(Number.isInteger(value?.version)).toBe(true);
  });

  it("#150 2回目 重大1: 概要を読んだ後・詳細の読み取りの直前に、別の参加者が件名と説明・取引先・担当部署を変える → 応答はすべて新しい側（古い件名と新しい版の組み合わせを返さない）", async () => {
    const { value, error, state } = await detailWith(w.memberS1.id, () =>
      withCaseService(env, (s) =>
        s.edit(actorOf(w.memberS2.id), room.id, {
          version: 1,
          title: NEW_TITLE,
          description: NEW_DESCRIPTION,
          clientId: w.clientB.id,
          departmentIds: [w.deptS.id, w.deptD.id],
        }),
      ).then(() => undefined),
    );
    expect(state.interrupted).toBe(true);
    expect(state.summaryReadFirst).toBe(true);
    expect(error).toBeNull();
    expect(value).toMatchObject({
      title: NEW_TITLE,
      description: NEW_DESCRIPTION,
      version: 2,
      client: { id: w.clientB.id },
    });
    const departments = (value?.departments ?? []) as { id: string }[];
    expect(departments.map((d) => d.id).sort()).toEqual(
      [w.deptS.id, w.deptD.id].sort(),
    );
  });

  it("#150 2回目 重大1: 割り込みで件名だけが変わった（版は進む）→ 件名と版がそろって新しい", async () => {
    const { value } = await detailWith(w.memberS1.id, () =>
      withCaseService(env, (s) =>
        s.edit(actorOf(w.memberS2.id), room.id, {
          version: 1,
          title: NEW_TITLE,
        }),
      ).then(() => undefined),
    );
    expect(value).toMatchObject({
      title: NEW_TITLE,
      description: DESCRIPTION,
      version: 2,
    });
  });

  it("#150 4.2.1・security: 非参加者は 403 のままで、説明・版を返さない（読み取りの前に止まる）", async () => {
    const { value, error } = await detailWith(w.noDept.id, async () => {});
    expect(value).toBeNull();
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "FORBIDDEN" });
    expect(JSON.stringify(error)).not.toContain(DESCRIPTION);
  });

  it("#150 4.2.1・security: 概要を読んだ後に参加から外された人は、詳細の読み取りで 403（中身を返さない）", async () => {
    const { value, error } = await detailWith(w.memberS2.id, async () => {
      await env.DB.prepare(
        "DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?",
      )
        .bind(room.roomId, w.memberS2.id)
        .run();
    });
    expect(value).toBeNull();
    expect(error).toMatchObject({ code: "FORBIDDEN" });
    expect(JSON.stringify(error)).not.toContain(DESCRIPTION);
  });
});
