// #339 AC-1（計画 plan-339 の 2 節「成功応答に案件との対応を持たせる」・5 節「成功応答のcaseIdを検証する」）：
// スレッド一覧（EP-3-08。fetchMyThreads）の各項目の caseId を検証して受け取る。案件の部屋なら案件の ID、通常のチャンネル・DM は null。
// 欠落・型違いは、契約違反として失敗にする（型だけで信用しない。Skill「frontend」）。
// 前提にした口（実装の担当へ）：features/threads/api/thread-api.ts の ThreadItem に caseId: string | null を足す（fetchMyThreads の形は変えない）。
// API は MSW。データはすべて架空（[E2E_TEST]・01JTEST…）。
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { message } from "../../../test/message-handlers";
import { server } from "../../../test/server";
import { respondMyThreads, threadItem } from "../../../test/thread-handlers";
import { fetchMyThreads } from "./thread-api";

const CASE_ID = "01JTESTCASE339000000000TA1";
const CASE_ROOM = "01JTESTROOM339000000000TA1";
const CHANNEL_ROOM = "01JTESTROOM339000000000TA2";
const DM_ROOM = "01JTESTROOM339000000000TA3";

const caseRow = threadItem(1, {
  room: { kind: "channel", id: CASE_ROOM, name: "[E2E_TEST]339案件の部屋" },
  caseId: CASE_ID,
});
const channelRow = threadItem(2, {
  room: { kind: "channel", id: CHANNEL_ROOM, name: "[E2E_TEST]339通常の部屋" },
});
const dmRow = threadItem(3, {
  room: {
    kind: "direct",
    id: DM_ROOM,
    partner: {
      id: "01JTESTUSER339000000000TA9",
      displayName: "testuser_339_partner",
      isActive: true,
    },
  },
});

describe("#339 AC-1 スレッド一覧の成功応答の caseId", () => {
  it("#339 AC-1: 成功応答のcaseIdを検証する：案件の部屋の行は案件の ID、通常のチャンネル・DM の行は null をそのまま受け取る", async () => {
    respondMyThreads([caseRow, channelRow, dmRow]);
    const page = await fetchMyThreads(undefined);
    expect(
      page.items.map((item) => ({
        parentId: item.parent.id,
        roomId: item.room.id,
        caseId: item.caseId,
      })),
    ).toEqual([
      { parentId: message(1).id, roomId: CASE_ROOM, caseId: CASE_ID },
      { parentId: message(2).id, roomId: CHANNEL_ROOM, caseId: null },
      { parentId: message(3).id, roomId: DM_ROOM, caseId: null },
    ]);
  });

  it.each([
    ["欠落", undefined],
    ["数値", 339],
    ["空文字", ""],
    ["真偽値", true],
    ["オブジェクト", { id: CASE_ID }],
  ])(
    "#339 AC-1: 成功応答のcaseIdを検証する：caseId が%sの行は、契約違反として失敗にする",
    async (_label, caseId) => {
      server.use(
        http.get("/api/me/threads", () =>
          HttpResponse.json({
            items: [channelRow, { ...caseRow, caseId }],
            nextCursor: null,
          }),
        ),
      );
      await expect(fetchMyThreads(undefined)).rejects.toBeDefined();
    },
  );

  it("#339 AC-1: 成功応答のcaseIdを検証する：ほかの必須項目がそろい caseId が正しい応答は、ページの続き（nextCursor）とともに受け取る", async () => {
    respondMyThreads([caseRow, channelRow, dmRow], { pageSize: 2 });
    const first = await fetchMyThreads(undefined);
    expect(first.items.map((item) => item.caseId)).toEqual([CASE_ID, null]);
    expect(first.nextCursor).not.toBeNull();
    const second = await fetchMyThreads(first.nextCursor ?? undefined);
    expect(second.items.map((item) => item.caseId)).toEqual([null]);
    expect(second.nextCursor).toBeNull();
  });
});
