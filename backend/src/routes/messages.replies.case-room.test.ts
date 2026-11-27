// #148（148-B-2）5-2 AC-8・計画 6.7：返信の取得（EP-1-07 GET /api/messages/:messageId/replies）の応答に caseRoom（スレッドの部屋が案件専用チャンネルか）を足す。
// S-35（スレッドの一覧）から開いたスレッドの返信の入力欄で、公開範囲の選択を出すかを画面が決めるため（表示の制御だけ。認可には使わない）。
// 最新（after なし）・after の両方で、案件のスレッドは true、通常のチャンネル・DM は false。終了した案件でも true。
// #339 AC-1（決定1）：同じ応答の成功時に caseId（案件の部屋は案件の ID、通常のチャンネル・DM は null）を足す。最新・after の両方。
//   403・404 のエラー応答には caseId を足さない。閲覧の制限（非参加者・perm.case.view なし）は、これまでどおり。
//   perm.case.view だけを外す確かめは、API では作れないため（case-room.permissions.test.ts の注記）、Service の層のテスト（services/case-id.permissions.test.ts）に置く。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { removeCaseMember } from "../../test/case-fixtures";
import {
  cleanupCaseRoomWorld,
  insertCaseWorldDm,
  seedRoomMessage,
  seedRoomReply,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";
import { ZERO, getReplies } from "../../test/thread-fixtures";

let cw: CaseRoomWorld;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  cw = await setupCaseRoomWorld(1620);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseRoomWorld();
});

async function caseRoomOf(parentId: string, query: string, token: string) {
  const res = await getReplies(parentId, query, token);
  expect(res.status).toBe(200);
  return ((await res.json()) as { caseRoom?: unknown }).caseRoom;
}

describe("#148 AC-8 計画 6.7 返信の取得の応答の caseRoom", () => {
  it.each([
    ["最新", ""],
    ["after", `?after=${ZERO}`],
  ])(
    "#148 AC-8: 進行中・終了した案件のスレッドは caseRoom: true（%s）",
    async (_l, query) => {
      const open = await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 1);
      await seedRoomReply(cw.open.roomId, open, cw.w.memberD1.id, 2);
      const closed = await seedRoomMessage(
        cw.closed.roomId,
        cw.w.memberS1.id,
        3,
      );
      expect(await caseRoomOf(open, query, cw.w.memberS1.token)).toBe(true);
      expect(await caseRoomOf(closed, query, cw.w.memberS1.token)).toBe(true);
    },
  );

  it.each([
    ["最新", ""],
    ["after", `?after=${ZERO}`],
  ])(
    "#148 AC-8: 通常のチャンネル・DM のスレッドは caseRoom: false（%s）",
    async (_l, query) => {
      const normal = await seedRoomMessage(cw.normal, cw.w.memberS1.id, 4);
      const dm = await insertCaseWorldDm(cw.w.memberS1.id, cw.w.memberD1.id);
      const dmParent = await seedRoomMessage(dm, cw.w.memberD1.id, 5);
      expect(await caseRoomOf(normal, query, cw.w.memberS1.token)).toBe(false);
      expect(await caseRoomOf(dmParent, query, cw.w.memberS1.token)).toBe(
        false,
      );
    },
  );
});

async function caseIdOf(parentId: string, query: string, token: string) {
  const res = await getReplies(parentId, query, token);
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;
  // 必須の項目（欠けていれば undefined になり、null と区別する）
  expect(Object.hasOwn(body, "caseId"), query).toBe(true);
  return body.caseId;
}

const QUERIES: [string, string][] = [
  ["最新", ""],
  ["after", `?after=${ZERO}`],
];

describe("#339 AC-1 返信の取得の成功応答の caseId と、閲覧の制限の維持", () => {
  it.each(QUERIES)(
    "#339 AC-1: 案件の対応情報を返しても閲覧制限を維持する：進行中・終了した案件のスレッドは caseId が、その案件の ID（%s）",
    async (_l, query) => {
      const open = await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 1);
      await seedRoomReply(cw.open.roomId, open, cw.w.memberD1.id, 2);
      const closed = await seedRoomMessage(
        cw.closed.roomId,
        cw.w.memberS1.id,
        3,
      );
      expect(await caseIdOf(open, query, cw.w.memberS1.token)).toBe(cw.open.id);
      expect(await caseIdOf(closed, query, cw.w.memberD1.token)).toBe(
        cw.closed.id,
      );
    },
  );

  it.each(QUERIES)(
    "#339 AC-1: 案件の対応情報を返しても閲覧制限を維持する：通常のチャンネル・DM のスレッドは caseId: null（%s）",
    async (_l, query) => {
      const normal = await seedRoomMessage(cw.normal, cw.w.memberS1.id, 4);
      await seedRoomReply(cw.normal, normal, cw.w.memberD1.id, 5);
      const dm = await insertCaseWorldDm(cw.w.memberS1.id, cw.w.memberD1.id);
      const dmParent = await seedRoomMessage(dm, cw.w.memberD1.id, 6);
      expect(await caseIdOf(normal, query, cw.w.memberS1.token)).toBeNull();
      expect(await caseIdOf(dmParent, query, cw.w.memberS1.token)).toBeNull();
    },
  );

  it.each(QUERIES)(
    "#339 AC-1: 案件の対応情報を返しても閲覧制限を維持する：非参加者（はじめから・外された後）は 404 のままで、エラー応答に caseId も案件の ID も含めない（%s）",
    async (_l, query) => {
      const parent = await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 7);
      await seedRoomReply(cw.open.roomId, parent, cw.w.memberD1.id, 8);
      // 外す前の参加者には見える（拒否が、データの準備の誤りでないことの対照）
      expect(
        (await getReplies(parent, query, cw.w.memberD1.token)).status,
      ).toBe(200);
      await removeCaseMember(cw.open.roomId, cw.w.memberD1.id);
      for (const [who, token] of [
        ["はじめから非参加（ownerS）", cw.w.ownerS.token],
        ["別の案件の参加者（memberS2）", cw.w.memberS2.token],
        ["外された参加者（memberD1）", cw.w.memberD1.token],
      ] as const) {
        const res = await getReplies(parent, query, token);
        expect(res.status, who).toBe(404);
        const text = await res.text();
        const body = JSON.parse(text) as Record<string, unknown>;
        expect(body.code, who).toBe("NOT_FOUND");
        expect(Object.hasOwn(body, "caseId"), who).toBe(false);
        expect(text, who).not.toContain(cw.open.id);
      }
      // 残った参加者には、これまでどおり案件の ID つきで見える
      expect(await caseIdOf(parent, query, cw.w.memberS1.token)).toBe(
        cw.open.id,
      );
    },
  );
});
