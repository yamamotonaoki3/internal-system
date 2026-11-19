// #148（148-B-2）5-2 AC-9・R-85・EP-1-23 PATCH /api/attachments/:attachmentId を、実際のアプリ入口（index.ts の app）と隔離 D1 で確かめる。
// この層で確かめるもの（計画 10章「AC-9 HTTP」）：200 の形 { id, publicationVisibility }・Cache-Control: no-store・401・送信元の確認（403）・
//   ID の形の誤りは 422・各エラーの状態コードと本文・非参加者の 404 は存在しない添付と同じ本文・監査の1件・変更後の一覧にすぐ反映（1-6 AC-7）。
// 判定の順の細部は Service（services/case-attachment.visibility.test.ts）、書き込みの条件は DB（db/case-attachment.visibility.db.test.ts）で確かめる。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  VISIBILITY_MESSAGES,
  caseAttachmentIdAt,
  caseAttachmentName,
  changeVisibilityRequest,
  publicationVisibilityOf,
  seedCaseAttachment,
  visibilityAudits,
} from "../../test/case-attachment-fixtures";
import { addCaseMember } from "../../test/case-fixtures";
import { BAD_ORIGIN } from "../../test/case-request-fixtures";
import {
  cleanupCaseRoomWorld,
  seedRoomMessage,
  setCaseStatus,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";

let cw: CaseRoomWorld;
let attachmentId: string;

const TO_PUBLIC = { publicationVisibility: "public_archive" };

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  cw = await setupCaseRoomWorld(1670);
  const message = await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 1);
  attachmentId = await seedCaseAttachment({
    n: 1,
    roomId: cw.open.roomId,
    uploaderId: cw.w.memberS1.id,
    messageId: message,
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseRoomWorld();
});

async function expectError(res: Response, status: number, expected: object) {
  expect(res.status).toBe(status);
  expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
  const text = await res.text();
  expect(JSON.parse(text)).toMatchObject(expected);
  expect(text).not.toContain(caseAttachmentName(1));
  return text;
}

describe("#148 AC-9 EP-1-23 成功", () => {
  it("#148 AC-9: 本人（一般・参加者）は 200 { id, publicationVisibility }・no-store。行と監査1件", async () => {
    const res = await changeVisibilityRequest(
      attachmentId,
      TO_PUBLIC,
      cw.w.memberS1.token,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
    expect(await res.json()).toEqual({
      id: attachmentId,
      publicationVisibility: "public_archive",
    });
    expect(await publicationVisibilityOf(attachmentId)).toBe("public_archive");
    expect(await visibilityAudits()).toHaveLength(1);
  });

  it.each([
    ["担当部署のオーナー（参加者）", () => cw.w.ownerS],
    ["全体管理者（参加者）", () => cw.w.admin],
  ])(
    "#148 AC-9 R-85: %s は、ほかの人の添付を変えられる（200）",
    async (_l, who) => {
      await addCaseMember(cw.open.roomId, who().id);
      const res = await changeVisibilityRequest(
        attachmentId,
        TO_PUBLIC,
        who().token,
      );
      expect(res.status).toBe(200);
    },
  );

  it("#148 AC-9: 今と同じ値は 200 で、監査を書かない", async () => {
    const res = await changeVisibilityRequest(
      attachmentId,
      { publicationVisibility: "participants_only" },
      cw.w.memberS1.token,
    );
    expect(res.status).toBe(200);
    expect(await visibilityAudits()).toEqual([]);
  });

  it("#148 AC-9 1-6 AC-7: 変更の後の一覧（EP-5-19）に、すぐ反映される", async () => {
    await changeVisibilityRequest(attachmentId, TO_PUBLIC, cw.w.memberS1.token);
    const res = await apiRequest(
      "GET",
      `/api/cases/${cw.open.id}/attachments`,
      {
        token: cw.w.memberD1.token,
      },
    );
    const body = (await res.json()) as {
      items: { id: string; publicationVisibility: string }[];
    };
    expect(
      body.items.find((i) => i.id === attachmentId)?.publicationVisibility,
    ).toBe("public_archive");
  });
});

describe("#148 AC-9 EP-1-23 拒否", () => {
  it("#148 AC-9: ログインしていなければ 401", async () => {
    const res = await changeVisibilityRequest(attachmentId, TO_PUBLIC, null);
    expect(res.status).toBe(401);
  });

  it("#148 AC-9 security: 許可されていない送信元は 403 で、書き込まない", async () => {
    const res = await changeVisibilityRequest(
      attachmentId,
      TO_PUBLIC,
      cw.w.memberS1.token,
      BAD_ORIGIN,
    );
    expect(res.status).toBe(403);
    expect(await publicationVisibilityOf(attachmentId)).toBe(
      "participants_only",
    );
  });

  it("#148 AC-9: パスの ID が ULID の形でなければ 422（非参加者でも）", async () => {
    for (const token of [cw.w.memberS1.token, cw.w.memberS2.token]) {
      const res = await changeVisibilityRequest("not-a-ulid", TO_PUBLIC, token);
      expect(res.status).toBe(422);
    }
  });

  it("#148 AC-9 存在の非開示: 非参加者（一般・参加していない担当部署のオーナー・全体管理者）の 404 は、存在しない添付の 404 と同じ本文", async () => {
    const missing = await expectError(
      await changeVisibilityRequest(
        caseAttachmentIdAt(999),
        TO_PUBLIC,
        cw.w.memberS1.token,
      ),
      404,
      { code: "NOT_FOUND", message: VISIBILITY_MESSAGES.notFound },
    );
    for (const who of [cw.w.memberS2, cw.w.ownerS, cw.w.admin]) {
      const text = await expectError(
        await changeVisibilityRequest(attachmentId, TO_PUBLIC, who.token),
        404,
        { code: "NOT_FOUND" },
      );
      expect(text).toBe(missing);
    }
    expect(await visibilityAudits()).toEqual([]);
  });

  it("#148 AC-9 R-85: 本人でも管理の資格もない参加者は 403「この添付の公開範囲は変更できません」", async () => {
    await expectError(
      await changeVisibilityRequest(
        attachmentId,
        TO_PUBLIC,
        cw.w.memberD1.token,
      ),
      403,
      { code: "FORBIDDEN", message: VISIBILITY_MESSAGES.forbidden },
    );
  });

  it("#148 AC-9: 本文の値が不正なら 422 fields:[publicationVisibility]", async () => {
    await expectError(
      await changeVisibilityRequest(
        attachmentId,
        { publicationVisibility: "all" },
        cw.w.memberS1.token,
      ),
      422,
      { code: "VALIDATION_ERROR", fields: ["publicationVisibility"] },
    );
  });

  it("#148 AC-9: 案件でない部屋（通常のチャンネル）の添付は 422 fields:[attachmentId]", async () => {
    const message = await seedRoomMessage(cw.normal, cw.w.memberS1.id, 2);
    const normalId = await seedCaseAttachment({
      n: 2,
      roomId: cw.normal,
      uploaderId: cw.w.memberS1.id,
      messageId: message,
    });
    const res = await changeVisibilityRequest(
      normalId,
      TO_PUBLIC,
      cw.w.memberS1.token,
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ fields: ["attachmentId"] });
  });

  it("#148 AC-9: 終了した案件は 409「終了した案件の添付の公開範囲は変更できません」で、行と監査は変わらない", async () => {
    await setCaseStatus(cw.open.id, "closed");
    await expectError(
      await changeVisibilityRequest(
        attachmentId,
        TO_PUBLIC,
        cw.w.memberS1.token,
      ),
      409,
      { code: "CONFLICT", message: VISIBILITY_MESSAGES.closed },
    );
    expect(await publicationVisibilityOf(attachmentId)).toBe(
      "participants_only",
    );
    expect(await visibilityAudits()).toEqual([]);
  });

  it("#148 AC-9: 未投稿の添付（本人のもの）は 404", async () => {
    const pending = await seedCaseAttachment({
      n: 3,
      roomId: cw.open.roomId,
      uploaderId: cw.w.memberS1.id,
      messageId: null,
    });
    const res = await changeVisibilityRequest(
      pending,
      TO_PUBLIC,
      cw.w.memberS1.token,
    );
    expect(res.status).toBe(404);
  });
});
