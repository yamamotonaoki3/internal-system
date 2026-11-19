// #148（148-C）5-1 AC-4 の残り・5-1 AC-2・C-191(4)：案件の一覧（EP-5-06）・概要（EP-5-07）の応答の lastActivityAt・channelId を、
// 実際のアプリ入口（index.ts の app）と隔離 D1 で確かめる。
// この層で確かめるもの（計画 148-C のテストケース「結合」）：応答の形（2項目が必須で、null でも項目を省かない）・値の型
//   （lastActivityAt は ISO 8601 の日時、channelId は ULID の形）・非参加者（参加していない担当部署のオーナー・全体管理者を含む）の本文に、
//   部屋の ID・やり取りの時刻が出ないこと。
// 値の決め方（最新・削除済み・ほかの案件）と行ごとの網羅は DB のテスト（db/case.repository.activity.db.test.ts）で確かめ、ここでは重ねない。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ULID_PATTERN } from "../../../shared/ulid-rules";
import { apiRequest } from "../../test/api-request";
import { CASES_BASE } from "../../test/case-fixtures";
import {
  cleanupCaseRoomWorld,
  seedRoomMessage,
  seedRoomReply,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";
import { isoAt } from "../../test/thread-fixtures";

type Item = {
  id: string;
  isParticipant: boolean;
  lastActivityAt: string | null;
  channelId: string | null;
};
type Page = { items: Item[]; nextCursor: string | null };

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let cw: CaseRoomWorld;

const get = (path: string, token: string) => apiRequest("GET", path, { token });
const listOf = (token: string, query: string) =>
  get(`${CASES_BASE}?${query}`, token);
const summaryOf = (id: string, token: string) =>
  get(`${CASES_BASE}/${id}`, token);

function rowOf(page: Page, id: string): Item {
  const found = page.items.find((item) => item.id === id);
  if (found === undefined) throw new Error(`案件 ${id} が一覧にありません`);
  return found;
}

beforeEach(async () => {
  cw = await setupCaseRoomWorld(1590);
  const top = await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 10);
  await seedRoomReply(cw.open.roomId, top, cw.w.memberD1.id, 12);
});

afterEach(async () => {
  await cleanupCaseRoomWorld();
});

describe("#148 148-C 5-1 AC-4 一覧・概要の最終更新と channelId（応答の形）", () => {
  it("#148 148-C 5-1 AC-4: 参加者の一覧の行に、lastActivityAt（ISO 8601）と channelId（ULID）が入る", async () => {
    const res = await listOf(cw.w.memberS1.token, "scope=joined&status=active");
    expect(res.status).toBe(200);
    const row = rowOf((await res.json()) as Page, cw.open.id);
    expect(row.lastActivityAt).toBe(isoAt(12));
    expect(row.lastActivityAt).toMatch(ISO);
    expect(row.channelId).toBe(cw.open.roomId);
    expect(ULID_PATTERN.test(row.channelId ?? "")).toBe(true);
  });

  it("#148 148-C C-191(4): メッセージのない案件の参加者の行は、lastActivityAt が null で、項目そのものは省かない", async () => {
    const res = await listOf(cw.w.memberS2.token, "scope=joined&status=active");
    const row = rowOf((await res.json()) as Page, cw.other.id);
    expect(Object.keys(row)).toEqual(
      expect.arrayContaining(["lastActivityAt", "channelId"]),
    );
    expect(row.lastActivityAt).toBeNull();
    expect(row.channelId).toBe(cw.other.roomId);
  });

  it("#148 148-C 5-1 AC-4: 参加者の概要にも、同じ lastActivityAt と channelId が入る", async () => {
    const res = await summaryOf(cw.open.id, cw.w.memberD1.token);
    expect(res.status).toBe(200);
    expect((await res.json()) as Item).toMatchObject({
      lastActivityAt: isoAt(12),
      channelId: cw.open.roomId,
    });
  });

  it.each([
    ["参加していない一般の社員", "memberS2"],
    ["参加していない担当部署のオーナー", "ownerS"],
    ["参加していない全体管理者", "admin"],
  ] as const)(
    "#148 148-C 5-1 AC-2: %sの一覧（すべての案件）・概要では、2項目が null で入り、本文のどこにも部屋の ID・やり取りの時刻がない",
    async (_label, key) => {
      const token = cw.w[key].token;
      const listRes = await listOf(token, "scope=all&status=active");
      expect(listRes.status).toBe(200);
      const listText = await listRes.text();
      const row = rowOf(JSON.parse(listText) as Page, cw.open.id);
      expect(row.isParticipant).toBe(false);
      expect(Object.keys(row)).toEqual(
        expect.arrayContaining(["lastActivityAt", "channelId"]),
      );
      expect(row.lastActivityAt).toBeNull();
      expect(row.channelId).toBeNull();

      const summaryRes = await summaryOf(cw.open.id, token);
      expect(summaryRes.status).toBe(200);
      const summaryText = await summaryRes.text();
      expect(JSON.parse(summaryText) as Item).toMatchObject({
        isParticipant: false,
        lastActivityAt: null,
        channelId: null,
      });
      for (const text of [listText, summaryText]) {
        expect(text).not.toContain(cw.open.roomId);
        expect(text).not.toContain(cw.closed.roomId);
        expect(text).not.toContain(isoAt(12));
        expect(text).not.toContain(isoAt(10));
      }
    },
  );
});
