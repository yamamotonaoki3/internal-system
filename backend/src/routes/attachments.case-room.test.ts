// #148（148-A）5-2 AC-2・AC-3（参加者の部分）・5-1 AC-11：案件の部屋の添付は 1-6 と同じ規則（既存の attachment.service.ts）で動くことを、
// 実際のアプリ入口と隔離 D1・手元の R2 で確かめる。
// この層で確かめるもの（計画 148-A のテストケース「AC-2・AC-3」）：参加者はアップロード（201）して、ほかの参加者がダウンロード（200）できる。
//   非参加者はアップロードもダウンロードも 404。終了中のアップロードは 409（行も実体も残らない）、終了中のダウンロードは 200。
// 受信中の競合は services/attachment.upload-race.test.ts で確かめ、ここでは重ねない。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  bytesOf,
  downloadAttachment,
  seedStoredAttachment,
  storedKeys,
  uploadFile,
  uploadedOk,
} from "../../test/attachment-fixtures";
import { ascii } from "../../test/attachment-files";
import {
  CASE_CLOSED_MESSAGES,
  attachmentCountIn,
  cleanupCaseRoomWorld,
  seedRoomMessage,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";

const TEXT = ascii("[UNIT_TEST]148 attachment");
let cw: CaseRoomWorld;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  cw = await setupCaseRoomWorld(1550);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseRoomWorld();
});

describe("#148 5-2 AC-2・AC-3 案件の部屋の添付", () => {
  it("#148 5-2 AC-2・AC-3: 参加者がアップロードした添付を、投稿に結び付けると、ほかの参加者がダウンロードできる", async () => {
    const uploaded = await uploadedOk(
      await uploadFile(
        { kind: "room", roomId: cw.open.roomId },
        "memo148.txt",
        TEXT,
        cw.w.memberS1.token,
      ),
    );
    const posted = await apiRequest(
      "POST",
      `/api/rooms/${cw.open.roomId}/messages`,
      {
        token: cw.w.memberS1.token,
        body: { body: "[UNIT_TEST]148添付つき", attachmentIds: [uploaded.id] },
      },
    );
    expect(posted.status).toBe(201);
    const res = await downloadAttachment(uploaded.id, cw.w.memberD1.token);
    expect(res.status).toBe(200);
    expect(await bytesOf(res)).toEqual(TEXT);
  });

  it("#148 5-2 AC-3: 非参加者は、案件の部屋へのアップロードも、案件の部屋の添付のダウンロードも 404", async () => {
    const message = await seedRoomMessage(cw.open.roomId, cw.w.memberD1.id, 1);
    const attachmentId = await seedStoredAttachment(
      {
        roomId: cw.open.roomId,
        uploaderId: cw.w.memberD1.id,
        messageId: message,
      },
      TEXT,
    );
    const upload = await uploadFile(
      { kind: "room", roomId: cw.open.roomId },
      "memo148.txt",
      TEXT,
      cw.w.memberS2.token,
    );
    const download = await downloadAttachment(
      attachmentId,
      cw.w.memberS2.token,
    );
    expect([upload.status, download.status]).toEqual([404, 404]);
  });

  it("#148 5-1 AC-11: 終了中のアップロードは 409 で、行も R2 の実体も残らない", async () => {
    const res = await uploadFile(
      { kind: "room", roomId: cw.closed.roomId },
      "memo148.txt",
      TEXT,
      cw.w.memberS1.token,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: "CONFLICT",
      message: CASE_CLOSED_MESSAGES.upload,
    });
    expect(await attachmentCountIn(cw.closed.roomId)).toBe(0);
    expect(await storedKeys()).toEqual([]);
  });

  it("#148 5-1 AC-11・5-2 AC-3: 終了中でも、参加者は案件の部屋の添付をダウンロードできる（200）", async () => {
    const message = await seedRoomMessage(
      cw.closed.roomId,
      cw.w.memberD1.id,
      2,
    );
    const attachmentId = await seedStoredAttachment(
      {
        roomId: cw.closed.roomId,
        uploaderId: cw.w.memberD1.id,
        messageId: message,
      },
      TEXT,
    );
    const res = await downloadAttachment(attachmentId, cw.w.memberS1.token);
    expect(res.status).toBe(200);
  });
});
