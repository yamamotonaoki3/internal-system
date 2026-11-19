// #150（150-A）5-1 AC-8・AC-11：本物の終了・再開の API で、既存の守り（147-B の参加者・納期、148-A のやり取り）が効く・解けることのつなぎ。
// これまでのテストは cases.status を直接書いていた。ここでは EP-5-11・EP-5-12 を通して状態を変える（計画 150-A 6.4・10章の「AC-11」の行）。
//   - 終了の後：参加者の追加・削除・納期の変更は 409 closed、投稿・返信・編集・リアクションは 409（決定 C-184 の経路ごとの文言）。
//     概要・詳細・メッセージの一覧は 200 のまま（アーカイブとして読める。AC-8）。一覧は「終了」の側に移る
//   - 再開の後：同じ操作がまた通る。一覧は「進行中」の側に戻る
// 判定の順・reason の網羅は、147-B（routes/cases.participants.test.ts）・148-A（routes/messages.case-room.test.ts）で確かめ、ここでは重ねない。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import { CASES_BASE } from "../../test/case-fixtures";
import { closePath, reopenPath } from "../../test/case-close-fixtures";
import { CASE_CONFLICT_REASONS } from "../../test/case-participant-fixtures";
import { noReselectBody } from "../../test/case-reopen-fixtures";
import { CASEREQ_NOW, TOMORROW_JST } from "../../test/case-request-fixtures";
import {
  CASE_CLOSED_MESSAGES,
  cleanupCaseRoomWorld,
  messageCountIn,
  seedRoomMessage,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";
import { editMessage } from "../../test/message-modify-fixtures";
import { postReaction } from "../../test/reaction-fixtures";
import { postReply } from "../../test/thread-fixtures";

let cw: CaseRoomWorld;

const messagesPath = (roomId: string) => `/api/rooms/${roomId}/messages`;
const postTo = (roomId: string, token: string, body: string) =>
  apiRequest("POST", messagesPath(roomId), { token, body: { body } });
const listOf = (roomId: string, token: string) =>
  apiRequest("GET", `${messagesPath(roomId)}?limit=50`, { token });
const addParticipant = (caseId: string, token: string, userId: string) =>
  apiRequest("POST", `${CASES_BASE}/${caseId}/participants`, {
    token,
    body: { userId },
  });
const removeParticipant = (caseId: string, token: string, userId: string) =>
  apiRequest("DELETE", `${CASES_BASE}/${caseId}/participants/${userId}`, {
    token,
  });
const changeDueDate = (caseId: string, token: string, dueDate: string) =>
  apiRequest("PATCH", `${CASES_BASE}/${caseId}/due-date`, {
    token,
    body: { dueDate },
  });
const listIds = async (token: string, status: "active" | "closed") => {
  const res = await apiRequest(
    "GET",
    `${CASES_BASE}?scope=joined&status=${status}`,
    { token },
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: { id: string }[] }).items.map(
    (item) => item.id,
  );
};

async function conflictOf(res: Response) {
  return {
    status: res.status,
    body: (await res.json()) as {
      code?: string;
      message?: string;
      reason?: string;
    },
  };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(CASEREQ_NOW));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  // 進行中の案件 open：参加者 memberS1・memberD1・inactive。memberS2 は非参加
  cw = await setupCaseRoomWorld(1550);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupCaseRoomWorld();
});

describe("#150 150-A 5-1 AC-11：本物の終了で、既存の守りが効く", () => {
  it("#150 AC-11: API で終了すると、参加者の追加・削除・納期の変更は 409 closed になり、参加者は変わらない", async () => {
    const token = cw.w.memberS1.token;
    expect(
      (await apiRequest("POST", closePath(cw.open.id), { token })).status,
    ).toBe(200);
    const responses = [
      await addParticipant(cw.open.id, token, cw.w.memberS2.id),
      await removeParticipant(cw.open.id, token, cw.w.memberD1.id),
      await changeDueDate(cw.open.id, token, TOMORROW_JST),
    ];
    for (const res of responses)
      expect(await conflictOf(res)).toEqual({
        status: 409,
        body: expect.objectContaining({
          code: "CONFLICT",
          reason: CASE_CONFLICT_REASONS.closed,
        }) as unknown,
      });
  });

  it("#150 AC-11（C-184）: API で終了すると、投稿・返信・編集・リアクションは 409（経路ごとの文言）で、メッセージは増えない", async () => {
    const own = await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 1);
    const token = cw.w.memberS1.token;
    expect(
      (await apiRequest("POST", closePath(cw.open.id), { token })).status,
    ).toBe(200);
    const responses = [
      await postTo(cw.open.roomId, token, "[UNIT_TEST]150終了後の投稿"),
      await postReply(own, { body: "[UNIT_TEST]150終了後の返信" }, token),
      await editMessage(own, { body: "[UNIT_TEST]150終了後の編集" }, token),
      await postReaction(own, { kind: "emoji", value: "👍" }, token),
    ];
    const M = CASE_CLOSED_MESSAGES;
    const bodies = await Promise.all(responses.map(conflictOf));
    expect(bodies).toEqual(
      [M.post, M.post, M.modify, M.reaction].map((message) => ({
        status: 409,
        body: expect.objectContaining({ code: "CONFLICT", message }) as unknown,
      })),
    );
    expect(await messageCountIn(cw.open.roomId)).toBe(1);
  });

  it("#150 AC-8: API で終了した後も、参加者は概要・詳細・メッセージの一覧を読め（200）、一覧は「終了」の側に移る", async () => {
    await seedRoomMessage(cw.open.roomId, cw.w.memberD1.id, 2);
    const token = cw.w.memberS1.token;
    expect(
      (await apiRequest("POST", closePath(cw.open.id), { token })).status,
    ).toBe(200);
    const detail = await apiRequest(
      "GET",
      `${CASES_BASE}/${cw.open.id}/detail`,
      { token },
    );
    expect(detail.status).toBe(200);
    expect(
      ((await detail.json()) as { status: string; participants: unknown[] })
        .status,
    ).toBe("closed");
    const list = await listOf(cw.open.roomId, cw.w.memberD1.token);
    expect(list.status).toBe(200);
    expect(((await list.json()) as { items: unknown[] }).items).toHaveLength(1);
    expect(await listIds(token, "closed")).toContain(cw.open.id);
    expect(await listIds(token, "active")).not.toContain(cw.open.id);
  });
});

describe("#150 150-A 5-1 AC-11：本物の再開で、既存の守りが解ける", () => {
  it("#150 AC-11: API で終了 → 再開すると、投稿・リアクション・参加者の追加・納期の変更がまた通り、一覧は「進行中」の側に戻る", async () => {
    const token = cw.w.memberS1.token;
    expect(
      (await apiRequest("POST", closePath(cw.open.id), { token })).status,
    ).toBe(200);
    expect(
      (
        await apiRequest("POST", reopenPath(cw.open.id), {
          token: cw.w.memberD1.token,
          body: await noReselectBody(cw.open.id),
        })
      ).status,
    ).toBe(200);
    const posted = await postTo(
      cw.open.roomId,
      token,
      "[UNIT_TEST]150再開後の投稿",
    );
    expect(posted.status).toBe(201);
    const { id } = (await posted.json()) as { id: string };
    expect(
      (await postReaction(id, { kind: "emoji", value: "👍" }, token)).status,
    ).toBe(200);
    expect(
      (await addParticipant(cw.open.id, token, cw.w.memberS2.id)).status,
    ).toBe(201);
    expect((await changeDueDate(cw.open.id, token, TOMORROW_JST)).status).toBe(
      200,
    );
    expect(await listIds(token, "active")).toContain(cw.open.id);
    expect(await listIds(token, "closed")).not.toContain(cw.open.id);
  });

  it("#150 AC-11: シードで終了の案件も、API で再開すると投稿できる", async () => {
    const token = cw.w.memberD1.token;
    expect(
      (
        await apiRequest("POST", reopenPath(cw.closed.id), {
          token,
          body: await noReselectBody(cw.closed.id),
        })
      ).status,
    ).toBe(200);
    expect(
      (await postTo(cw.closed.roomId, token, "[UNIT_TEST]150再開後の投稿"))
        .status,
    ).toBe(201);
  });
});
