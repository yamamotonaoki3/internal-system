// #148（148-A）5-2 AC-5・AC-6・R-62：チャンネルの詳細（GET /api/channels/:channelId）が、案件専用チャンネルでは isCaseChannel（実値）と caseId を返し、
// 画面が案件の画面（/cases/:caseId）へ移れるようにすることを、実際のアプリ入口と隔離 D1 で確かめる。
// あわせて、返信の一覧（EP-1-07）の返信できない理由 replyBlockedReason に case_closed（優先は deleted_parent → not_joined → case_closed → …）を確かめる。
// この層で確かめるもの（計画 148-A のテストケース「AC-5・AC-6」「返信不可の理由」）：
//   参加者には isCaseChannel:true・caseId（その案件の ID）。通常のチャンネルは isCaseChannel:false・caseId:null。非参加者は 404（caseId を返さない）
//   案件専用チャンネルへの参加（join）・招待（invitations）は、既存どおり拒否（回帰）
// 計画では channels.test.ts・messages.replies.test.ts に足すとしたが、案件の世界（取引先・案件）の準備が既存のファイルの準備と別のため、別のファイルにした。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  CASE_CLOSED_REASON,
  cleanupCaseRoomWorld,
  seedRoomMessage,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";
import { markDeleted } from "../../test/message-modify-fixtures";
import { getReplies } from "../../test/thread-fixtures";

let cw: CaseRoomWorld;

const detailOf = (roomId: string, token: string) =>
  apiRequest("GET", `/api/channels/${roomId}`, { token });

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  cw = await setupCaseRoomWorld(1560);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseRoomWorld();
});

describe("#148 5-2 AC-6 チャンネルの詳細の isCaseChannel・caseId", () => {
  it("#148 5-2 AC-6: 案件の部屋の参加者には isCaseChannel:true と、その案件の caseId が返る（進行中・終了とも）", async () => {
    const open = await detailOf(cw.open.roomId, cw.w.memberS1.token);
    const closed = await detailOf(cw.closed.roomId, cw.w.memberS1.token);
    expect(open.status).toBe(200);
    expect(await open.json()).toMatchObject({
      roomId: cw.open.roomId,
      isCaseChannel: true,
      caseId: cw.open.id,
    });
    expect(closed.status).toBe(200);
    expect(await closed.json()).toMatchObject({
      isCaseChannel: true,
      caseId: cw.closed.id,
    });
  });

  it("#148 退行なし: 通常のチャンネルでは isCaseChannel:false・caseId:null（項目は必ずある）", async () => {
    const res = await detailOf(cw.normal, cw.w.memberS1.token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.isCaseChannel).toBe(false);
    expect(body).toHaveProperty("caseId", null);
  });

  it("#148 存在の非開示: 非参加者には 404 で、caseId を返さない", async () => {
    const res = await detailOf(cw.open.roomId, cw.w.memberS2.token);
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain(cw.open.id);
  });

  it("#148 5-2 AC-5・AC-6（回帰）: 案件専用チャンネルへの参加（join）・招待は、参加者・非参加者とも成功しない", async () => {
    const join = await apiRequest(
      "POST",
      `/api/channels/${cw.open.roomId}/join`,
      {
        token: cw.w.memberS2.token,
      },
    );
    const invite = await apiRequest(
      "POST",
      `/api/channels/${cw.open.roomId}/invitations`,
      { token: cw.w.memberS1.token, body: { userId: cw.w.memberS2.id } },
    );
    expect(join.status).toBeGreaterThanOrEqual(400);
    expect(invite.status).toBeGreaterThanOrEqual(400);
    const members = await apiRequest("GET", `/api/channels/${cw.open.roomId}`, {
      token: cw.w.memberS2.token,
    });
    expect(members.status).toBe(404);
  });
});

describe("#148 返信できない理由 case_closed（EP-1-07）", () => {
  it("#148 5-1 AC-11: 終了の案件の部屋の返信の一覧では replyBlockedReason が 'case_closed'", async () => {
    const parent = await seedRoomMessage(cw.closed.roomId, cw.w.memberD1.id, 1);
    const res = await getReplies(parent, "?limit=50", cw.w.memberS1.token);
    expect(res.status).toBe(200);
    // 参加者のまま（joined: true）で、部屋に書き込めない（roomWritable: false）。返信できない理由は case_closed
    expect(await res.json()).toMatchObject({
      joined: true,
      roomWritable: false,
      replyBlockedReason: CASE_CLOSED_REASON,
    });
  });

  it("#148 優先順: 終了の案件でも、親が削除済みなら 'deleted_parent' が優先される", async () => {
    const parent = await seedRoomMessage(cw.closed.roomId, cw.w.memberD1.id, 2);
    await markDeleted(parent, cw.w.memberD1.id);
    const res = await getReplies(parent, "?limit=50", cw.w.memberS1.token);
    expect(await res.json()).toMatchObject({
      replyBlockedReason: "deleted_parent",
    });
  });

  it("#148 退行なし: 進行中の案件の部屋の参加者は replyBlockedReason が null", async () => {
    const parent = await seedRoomMessage(cw.open.roomId, cw.w.memberD1.id, 3);
    const res = await getReplies(parent, "?limit=50", cw.w.memberS1.token);
    expect(await res.json()).toMatchObject({ replyBlockedReason: null });
  });
});
