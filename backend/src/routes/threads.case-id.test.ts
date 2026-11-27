// #339 AC-1・AC-3（決定1）：スレッド一覧（EP-3-08 GET /api/me/threads）の各項目に、必須の caseId を足す。
// 契約（実装の担当へ）：
//  - items[] = { parent, room, lastReplyAt, unreadCount, caseId }。caseId は、案件専用チャンネルのスレッドは、その案件の ID（cases.id）、
//    通常のチャンネル・DM は null。キーは必ずある（欠けた項目を返さない）。
//  - 見える範囲（U-4・#148 の perm.case.view）・並び・件数・nextCursor は変えない（caseId を足すために行を後から除かない）。
//  - エラー応答（401・403・422）には caseId を足さない。
// 期待は、受け入れ条件と、このファイルで入れた固定のデータから決める（本番の定義から作らない）。
// perm.case.view だけを外す確かめは、API では作れないため（case-room.permissions.test.ts の注記）、Service の層のテスト（services/case-id.permissions.test.ts）に置く。
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
import {
  getThreads,
  idAt,
  threadsOk,
  type ThreadListItem,
} from "../../test/thread-fixtures";
import { decodeCursor } from "../lib/cursor";

let cw: CaseRoomWorld;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  cw = await setupCaseRoomWorld(1640);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseRoomWorld();
});

/**
 * memberS1 から見て、案件の部屋・通常のチャンネル・DM が混ざる 5 スレッドを入れる。
 * 最後の返信の番号：E=14・D=13・C=12・B=11・A=10（並びは E, D, C, B, A）。
 */
async function seedMixed() {
  const s1 = cw.w.memberS1.id;
  const d1 = cw.w.memberD1.id;
  const dm = await insertCaseWorldDm(s1, d1);
  const a = await seedRoomMessage(cw.open.roomId, s1, 1);
  const b = await seedRoomMessage(cw.normal, s1, 2);
  const c = await seedRoomMessage(dm, d1, 3);
  const d = await seedRoomMessage(cw.open.roomId, d1, 4);
  const e = await seedRoomMessage(cw.normal, d1, 5);
  await seedRoomReply(cw.open.roomId, a, d1, 10);
  await seedRoomReply(cw.normal, b, d1, 11);
  await seedRoomReply(dm, c, s1, 12);
  await seedRoomReply(cw.open.roomId, d, s1, 13);
  await seedRoomReply(cw.normal, e, s1, 14);
  return { a, b, c, d, e, dm };
}

const summary = (items: ThreadListItem[]) =>
  items.map((item) => ({ parent: item.parent.id, caseId: item.caseId }));

describe("#339 AC-1 スレッド一覧の caseId と、閲覧の制限の維持（API 結合）", () => {
  it("#339 AC-1: 案件の対応情報を返しても閲覧制限を維持する：案件の部屋は案件の ID、通常のチャンネル・DM は null。キーは必ずある", async () => {
    const t = await seedMixed();
    const page = await threadsOk("?limit=100", cw.w.memberS1.token);
    for (const item of page.items)
      expect(Object.hasOwn(item, "caseId"), item.parent.id).toBe(true);
    expect(summary(page.items)).toEqual([
      { parent: t.e, caseId: null },
      { parent: t.d, caseId: cw.open.id },
      { parent: t.c, caseId: null },
      { parent: t.b, caseId: null },
      { parent: t.a, caseId: cw.open.id },
    ]);
    // 部屋の種類の表し方は変えない（caseId は room の中に入れない）
    expect(page.items[1]?.room).toMatchObject({
      kind: "channel",
      id: cw.open.roomId,
    });
    expect(page.items[2]?.room).toMatchObject({ kind: "direct", id: t.dm });
  });

  it("#339 AC-1: 案件の対応情報を返しても閲覧制限を維持する：外された参加者の一覧には、その案件のスレッドも案件の ID も出ない（ほかの部屋は残る）", async () => {
    const t = await seedMixed();
    await removeCaseMember(cw.open.roomId, cw.w.memberS1.id);
    const response = await getThreads("?limit=100", cw.w.memberS1.token);
    expect(response.status).toBe(200);
    const text = await response.text();
    const page = JSON.parse(text) as { items: ThreadListItem[] };
    expect(text).not.toContain(cw.open.id);
    expect(page.items.map((item) => item.parent.id)).toEqual([t.e, t.c, t.b]);
    expect(summary(page.items)).toEqual([
      { parent: t.e, caseId: null },
      { parent: t.c, caseId: null },
      { parent: t.b, caseId: null },
    ]);
  });

  it("#339 AC-1: 案件の対応情報を返しても閲覧制限を維持する：はじめから非参加の利用者（ownerS・memberS2）の一覧に、案件の ID は出ない", async () => {
    await seedMixed();
    for (const [who, token] of [
      ["ownerS", cw.w.ownerS.token],
      ["memberS2", cw.w.memberS2.token],
    ] as const) {
      const response = await getThreads("?limit=100", token);
      expect(response.status, who).toBe(200);
      const text = await response.text();
      expect(text, who).not.toContain(cw.open.id);
      expect(text, who).not.toContain(cw.open.roomId);
    }
  });

  it("#339 AC-1: エラー応答（401・422）に caseId を足さない", async () => {
    await seedMixed();
    for (const [label, response] of [
      ["未認証", await getThreads("?limit=100", null)],
      ["limit の誤り", await getThreads("?limit=0", cw.w.memberS1.token)],
    ] as const) {
      expect([401, 422], label).toContain(response.status);
      const text = await response.text();
      const body = JSON.parse(text) as Record<string, unknown>;
      expect(Object.hasOwn(body, "caseId"), label).toBe(false);
      expect(text, label).not.toContain(cw.open.id);
    }
  });
});

describe("#339 AC-3 caseId を足しても、件数・順序・nextCursor が変わらない（API 結合）", () => {
  it("#339 AC-3: caseId追加後も件数・順序・nextCursorが変わらない（limit=2 で 3 ページ）", async () => {
    const t = await seedMixed();
    const token = cw.w.memberS1.token;

    const first = await threadsOk("?limit=2", token);
    expect(summary(first.items)).toEqual([
      { parent: t.e, caseId: null },
      { parent: t.d, caseId: cw.open.id },
    ]);
    expect(first.nextCursor).not.toBeNull();
    expect(decodeCursor(first.nextCursor ?? "")).toEqual({
      v: idAt(13),
      id: t.d,
    });

    const second = await threadsOk(
      `?limit=2&cursor=${first.nextCursor ?? ""}`,
      token,
    );
    expect(summary(second.items)).toEqual([
      { parent: t.c, caseId: null },
      { parent: t.b, caseId: null },
    ]);
    expect(decodeCursor(second.nextCursor ?? "")).toEqual({
      v: idAt(11),
      id: t.b,
    });

    const third = await threadsOk(
      `?limit=2&cursor=${second.nextCursor ?? ""}`,
      token,
    );
    expect(summary(third.items)).toEqual([{ parent: t.a, caseId: cw.open.id }]);
    expect(third.nextCursor).toBeNull();
  });

  it("#339 AC-3: caseId追加後も件数・順序・nextCursorが変わらない（境界：limit がちょうど件数なら終端、1 少なければ続きあり）", async () => {
    const t = await seedMixed();
    const token = cw.w.memberS1.token;
    const exact = await threadsOk("?limit=5", token);
    expect(exact.items.map((item) => item.parent.id)).toEqual([
      t.e,
      t.d,
      t.c,
      t.b,
      t.a,
    ]);
    expect(exact.nextCursor).toBeNull();
    const short = await threadsOk("?limit=4", token);
    expect(short.items.map((item) => item.parent.id)).toEqual([
      t.e,
      t.d,
      t.c,
      t.b,
    ]);
    expect(decodeCursor(short.nextCursor ?? "")).toEqual({
      v: idAt(11),
      id: t.b,
    });
  });
});
