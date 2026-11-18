// #150（150-A）3-3 AC-1・AC-2：案件の終了・再開の通知が、通知の土台（#124。GET /api/me/notifications・未読数）に出ること。
// 終了・再開は本物の API（EP-5-11・EP-5-12）で行う。期待値は計画 150-A 6.3・6.5：
//   - 宛先は、操作した本人を除く有効な参加者。本人・参加していない人・退職者には出ない
//   - 項目は kind case.closed／case.reopened、roomId・messageId は null、targetId は案件の ID、reason は null、roomArchived は false
//   - containsRoomContent が false のため、その後に参加から外されても一覧・未読数に残る
// 宛先の SQL・取り消しは DB のテスト（db/case-close.repository.db.test.ts）で確かめ、ここでは重ねない。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  cleanupCaseTestData,
  joinedAt,
  removeCaseMember,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import { closePath, reopenPath } from "../../test/case-close-fixtures";
import {
  CASEREQ_NOW,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";

type Item = {
  id: string;
  kind: string;
  roomId: string | null;
  messageId: string | null;
  targetId: string | null;
  reason: string | null;
  roomArchived: boolean;
};

let w: CaseWorld;
/** 進行中・deptS 担当：memberS1・memberD1・inactive（退職者）。memberS2・admin は参加していない */
let room: SeededCase;

const itemsOf = async (token: string): Promise<Item[]> => {
  const res = await apiRequest("GET", "/api/me/notifications?limit=50", {
    token,
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: Item[] }).items;
};
const unreadOf = async (token: string): Promise<number> => {
  const res = await apiRequest("GET", "/api/me/notifications/unread-count", {
    token,
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { count: number }).count;
};
const caseItems = (items: Item[]) =>
  items.filter((item) => item.kind.startsWith("case."));

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(CASEREQ_NOW));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  w = await setupCaseWorld();
  room = await seedCase({
    n: 1531,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]150通知",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
      { userId: w.inactive.id, joinedAt: joinedAt(3) },
    ],
  });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupCaseTestData();
});

describe("#150 150-A 3-3 AC-1・AC-2 終了・再開の通知の一覧", () => {
  it("#150 3-3 AC-1: 終了すると、ほかの有効な参加者の一覧に case.closed が出る（targetId は案件、roomId・messageId・reason は null、roomArchived は false）。未読数も増える", async () => {
    const before = await unreadOf(w.memberD1.token);
    const res = await apiRequest("POST", closePath(room.id), {
      token: w.memberS1.token,
    });
    expect(res.status).toBe(200);
    expect(caseItems(await itemsOf(w.memberD1.token))).toEqual([
      expect.objectContaining({
        kind: "case.closed",
        roomId: null,
        messageId: null,
        targetId: room.id,
        reason: null,
        roomArchived: false,
      }),
    ]);
    expect(await unreadOf(w.memberD1.token)).toBe(before + 1);
  });

  it("#150 3-3 AC-1・AC-2: 操作した本人・参加していない社員・参加していない全体管理者には出ない", async () => {
    await apiRequest("POST", closePath(room.id), { token: w.memberS1.token });
    for (const token of [w.memberS1.token, w.memberS2.token, w.admin.token])
      expect(caseItems(await itemsOf(token))).toEqual([]);
  });

  it("#150 3-3 AC-1: 再開すると、ほかの有効な参加者の一覧に case.reopened が出る", async () => {
    await apiRequest("POST", closePath(room.id), { token: w.memberS1.token });
    const res = await apiRequest("POST", reopenPath(room.id), {
      token: w.memberD1.token,
    });
    expect(res.status).toBe(200);
    expect(caseItems(await itemsOf(w.memberS1.token))).toEqual([
      expect.objectContaining({
        kind: "case.reopened",
        roomId: null,
        targetId: room.id,
      }),
    ]);
  });

  it("#150 6.3（containsRoomContent: false）: 通知を受けた後に参加から外されても、一覧・未読数に残る", async () => {
    await apiRequest("POST", closePath(room.id), { token: w.memberS1.token });
    const unread = await unreadOf(w.memberD1.token);
    await removeCaseMember(room.roomId, w.memberD1.id);
    expect(caseItems(await itemsOf(w.memberD1.token))).toEqual([
      expect.objectContaining({ kind: "case.closed", targetId: room.id }),
    ]);
    expect(await unreadOf(w.memberD1.token)).toBe(unread);
  });
});
