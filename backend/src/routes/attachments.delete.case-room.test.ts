// #270（270-A）1-6 AC-4・5-1 AC-11：案件の部屋（案件専用チャンネル）での添付の削除（EP-1-11）を、実際のアプリ入口と隔離 D1 で確かめる。
// 期待（計画 2章 AC-4・4.2 ④）：進行中の案件の参加者は、自分の添付を消せる（204）。案件が終了していれば 409 で何も変わらない。
//   参加を外れた参加者は、案件の部屋が見えないため 404（148-A の決まり）。確認の後・書き込みの直前に案件が終了しても 409（SQL の条件）。
//   削除の後、案件の添付の一覧（EP-5-19）に出ない。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import { ascii } from "../../test/attachment-files";
import {
  ATTACHMENT_DELETE_ACTION,
  auditRowsOf,
  deleteAttachment,
  deletionOf,
  interleavingDb,
} from "../../test/attachment-delete-fixtures";
import {
  attachmentPath,
  rawRequest,
  seedStoredAttachment,
} from "../../test/attachment-fixtures";
import { removeCaseMember } from "../../test/case-fixtures";
import {
  cleanupCaseRoomWorld,
  seedRoomMessage,
  setCaseStatus,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";
import { setReauthenticated } from "../../test/message-modify-fixtures";
import { codeOf } from "../../test/thread-fixtures";

const TEXT = ascii("[UNIT_TEST]270 case room");
let cw: CaseRoomWorld;
let messageId: string;
let attachmentId: string;

const untouched = async () => {
  expect(await deletionOf(attachmentId)).toEqual({
    deleted_at: null,
    deleted_by: null,
  });
  expect(await auditRowsOf(ATTACHMENT_DELETE_ACTION, attachmentId)).toEqual([]);
};

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  cw = await setupCaseRoomWorld(1700);
  await setReauthenticated(cw.w.memberS1.token, 60_000);
  messageId = await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 1);
  attachmentId = await seedStoredAttachment(
    {
      roomId: cw.open.roomId,
      uploaderId: cw.w.memberS1.id,
      messageId,
      originalName: "[UNIT_TEST]270案件の添付.txt",
    },
    TEXT,
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await env.DB.prepare(
      "DELETE FROM audit_logs WHERE action = 'attachment.delete' AND target_id = ?",
    )
      .bind(attachmentId)
      .run();
  } finally {
    await cleanupCaseRoomWorld();
  }
});

describe("#270 AC-4（5-1 AC-11）案件の部屋", () => {
  it("#270 AC-1: 進行中の案件の参加者は自分の添付を消せ（204）、案件の添付の一覧（EP-5-19）に出なくなる", async () => {
    const before = await apiRequest(
      "GET",
      `/api/cases/${cw.open.id}/attachments`,
      { token: cw.w.memberD1.token },
    );
    expect(await before.text()).toContain(attachmentId);
    expect(
      (await deleteAttachment(attachmentId, cw.w.memberS1.token)).status,
    ).toBe(204);
    const after = await apiRequest(
      "GET",
      `/api/cases/${cw.open.id}/attachments`,
      { token: cw.w.memberD1.token },
    );
    expect(after.status).toBe(200);
    expect(await after.text()).not.toContain(attachmentId);
  });

  it("#270 AC-4: 案件が終了していれば 409 CONFLICT で、何も変わらない", async () => {
    await setCaseStatus(cw.open.id, "closed");
    const response = await deleteAttachment(attachmentId, cw.w.memberS1.token);
    expect(response.status).toBe(409);
    expect(await codeOf(response)).toBe("CONFLICT");
    await untouched();
  });

  it("#270 AC-2: 参加を外れた元の参加者には、案件の部屋が見えないため 404", async () => {
    await removeCaseMember(cw.open.roomId, cw.w.memberS1.id);
    const response = await deleteAttachment(attachmentId, cw.w.memberS1.token);
    expect(response.status).toBe(404);
    await untouched();
  });

  it("#270 AC-2: ほかの参加者（他人の添付）は 403", async () => {
    await setReauthenticated(cw.w.memberD1.token, 60_000);
    const response = await deleteAttachment(attachmentId, cw.w.memberD1.token);
    expect(response.status).toBe(403);
    await untouched();
  });

  it("#270 AC-4: 確認の後・書き込みの直前に案件が終了すると、書き込みは0行で 409。印・監査は残らない", async () => {
    const interleaved = interleavingDb(env.DB, () =>
      setCaseStatus(cw.open.id, "closed"),
    );
    const response = await rawRequest("DELETE", attachmentPath(attachmentId), {
      token: cw.w.memberS1.token,
      envOverrides: { DB: interleaved.db },
    });
    expect(interleaved.state.ran).toBe(true);
    expect(response.status).toBe(409);
    await untouched();
  });
});
