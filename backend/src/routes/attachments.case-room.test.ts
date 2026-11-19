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
import { publicationVisibilityOf } from "../../test/case-attachment-fixtures";
import {
  CASE_CLOSED_MESSAGES,
  insertCaseWorldDm,
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

// #148（148-B-2）5-2 AC-8・計画 6.3：アップロードのときの公開範囲の指定（クエリ publicationVisibility。任意）。
// 判定の順：部屋（404・409）→ 権限（403）→ ヘッダー（422）→ 公開範囲（422 fields:["publicationVisibility"]）→ 保存。
// 案件の部屋の応答は値（指定なしは participants_only）、案件でない部屋の応答は null（従来どおり。指定すると 422）。
describe("#148 AC-8 アップロードのときの公開範囲", () => {
  const q = (value: string) =>
    `?publicationVisibility=${encodeURIComponent(value)}`;

  it.each([
    ["部屋", "room"],
    ["返信", "reply"],
  ] as const)(
    "#148 AC-8: 案件の%sへのアップロードで指定した値が、応答と行に出る（public_archive・participants_only）",
    async (_l, kind) => {
      const parent = await seedRoomMessage(
        cw.open.roomId,
        cw.w.memberD1.id,
        10,
      );
      const target =
        kind === "room"
          ? ({ kind: "room", roomId: cw.open.roomId } as const)
          : ({ kind: "reply", parentId: parent } as const);
      for (const value of ["public_archive", "participants_only"]) {
        const res = await uploadFile(
          target,
          "memo148b2.txt",
          TEXT,
          cw.w.memberS1.token,
          {
            query: q(value),
          },
        );
        const body = (await uploadedOk(res)) as unknown as Record<
          string,
          unknown
        >;
        expect(body.publicationVisibility).toBe(value);
        expect(await publicationVisibilityOf(body.id as string)).toBe(value);
      }
    },
  );

  it("#148 AC-8 D2: 案件の部屋で指定しなければ、参加者限定（participants_only）。応答の項目は id・name・kind・contentType・size・publicationVisibility", async () => {
    const body = (await uploadedOk(
      await uploadFile(
        { kind: "room", roomId: cw.open.roomId },
        "memo148b2.txt",
        TEXT,
        cw.w.memberS1.token,
      ),
    )) as unknown as Record<string, unknown>;
    expect(body.publicationVisibility).toBe("participants_only");
    expect(Object.keys(body).sort()).toEqual(
      [
        "contentType",
        "id",
        "kind",
        "name",
        "publicationVisibility",
        "size",
      ].sort(),
    );
    expect(await publicationVisibilityOf(body.id as string)).toBe(
      "participants_only",
    );
  });

  it.each(["", "PUBLIC_ARCHIVE", "public", "participants_only ", "all"])(
    "#148 AC-8 error-api: 一覧にない値（%j）は 422 fields:[publicationVisibility] で、行も R2 の実体も残らない",
    async (value) => {
      const res = await uploadFile(
        { kind: "room", roomId: cw.open.roomId },
        "memo148b2.txt",
        TEXT,
        cw.w.memberS1.token,
        { query: q(value) },
      );
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        code: "VALIDATION_ERROR",
        fields: ["publicationVisibility"],
      });
      expect(await attachmentCountIn(cw.open.roomId)).toBe(0);
      expect(await storedKeys()).toEqual([]);
    },
  );

  it("#148 AC-8: 案件でない部屋（通常のチャンネル・DM。部屋と返信）での指定は、participants_only でも 422 で、行も実体も残らない", async () => {
    const dm = await insertCaseWorldDm(cw.w.memberS1.id, cw.w.memberD1.id);
    const normalParent = await seedRoomMessage(cw.normal, cw.w.memberD1.id, 11);
    const dmParent = await seedRoomMessage(dm, cw.w.memberD1.id, 12);
    const targets = [
      { kind: "room", roomId: cw.normal },
      { kind: "reply", parentId: normalParent },
      { kind: "room", roomId: dm },
      { kind: "reply", parentId: dmParent },
    ] as const;
    for (const target of targets)
      for (const value of ["participants_only", "public_archive"]) {
        const res = await uploadFile(
          target,
          "memo148b2.txt",
          TEXT,
          cw.w.memberS1.token,
          {
            query: q(value),
          },
        );
        expect(res.status, `${JSON.stringify(target)} ${value}`).toBe(422);
        expect(await res.json()).toMatchObject({
          fields: ["publicationVisibility"],
        });
      }
    expect(await attachmentCountIn(cw.normal)).toBe(0);
    expect(await attachmentCountIn(dm)).toBe(0);
    expect(await storedKeys()).toEqual([]);
  });

  it("#148 AC-8: 案件でない部屋（通常のチャンネル・DM）で指定しなければ、従来どおり 201 で、応答の publicationVisibility は null", async () => {
    const dm = await insertCaseWorldDm(cw.w.memberS1.id, cw.w.memberD1.id);
    for (const roomId of [cw.normal, dm]) {
      const body = (await uploadedOk(
        await uploadFile(
          { kind: "room", roomId },
          "memo148b2.txt",
          TEXT,
          cw.w.memberS1.token,
        ),
      )) as unknown as Record<string, unknown>;
      expect(body.publicationVisibility).toBeNull();
      expect(await publicationVisibilityOf(body.id as string)).toBe(
        "participants_only",
      );
    }
  });

  it("#148 AC-8 計画 6.3: 非参加者は、値が不正でも 404 が先（部屋に入れない人に入力の正しさを教えない）", async () => {
    const res = await uploadFile(
      { kind: "room", roomId: cw.open.roomId },
      "memo148b2.txt",
      TEXT,
      cw.w.memberS2.token,
      { query: q("bad-value") },
    );
    expect(res.status).toBe(404);
  });

  it("#148 AC-8 5-1 AC-11: 終了した案件では、public_archive の指定でも 409（値の検証より部屋の判定が先）", async () => {
    const res = await uploadFile(
      { kind: "room", roomId: cw.closed.roomId },
      "memo148b2.txt",
      TEXT,
      cw.w.memberS1.token,
      { query: q("bad-value") },
    );
    expect(res.status).toBe(409);
  });
});
