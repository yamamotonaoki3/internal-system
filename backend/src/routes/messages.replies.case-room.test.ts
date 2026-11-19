// #148（148-B-2）5-2 AC-8・計画 6.7：返信の取得（EP-1-07 GET /api/messages/:messageId/replies）の応答に caseRoom（スレッドの部屋が案件専用チャンネルか）を足す。
// S-35（スレッドの一覧）から開いたスレッドの返信の入力欄で、公開範囲の選択を出すかを画面が決めるため（表示の制御だけ。認可には使わない）。
// 最新（after なし）・after の両方で、案件のスレッドは true、通常のチャンネル・DM は false。終了した案件でも true。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
