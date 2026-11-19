// #148（148-B-2）5-2 AC-9・計画 6.5・00-foundation（監査の検索）：公開範囲の変更で記録された監査の行を、
// 全体管理者が POST /api/admin/audit-logs/search の targetType=attachment（targetId と組）・action=case.attachment.visibility.change で絞り込めること（422 にならない）。応答にファイル名を出さない。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  caseAttachmentName,
  changeVisibilityRequest,
  seedCaseAttachment,
} from "../../test/case-attachment-fixtures";
import {
  cleanupCaseRoomWorld,
  seedRoomMessage,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";

let cw: CaseRoomWorld;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  cw = await setupCaseRoomWorld(1690);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseRoomWorld();
});

describe("#148 AC-9 監査の検索：添付の対象", () => {
  it("#148 AC-9: targetType=attachment と targetId、または action で絞り込むと、変更の行が1件出る。ファイル名を出さない", async () => {
    const message = await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 1);
    const id = await seedCaseAttachment({
      n: 1,
      roomId: cw.open.roomId,
      uploaderId: cw.w.memberS1.id,
      messageId: message,
    });
    const changed = await changeVisibilityRequest(
      id,
      { publicationVisibility: "public_archive" },
      cw.w.memberS1.token,
    );
    expect(changed.status).toBe(200);
    for (const body of [
      { targetType: "attachment", targetId: id },
      { action: "case.attachment.visibility.change" },
    ]) {
      const res = await apiRequest("POST", "/api/admin/audit-logs/search", {
        token: cw.w.admin.token,
        body,
      });
      expect(res.status, JSON.stringify(body)).toBe(200);
      const text = await res.text();
      expect(text).not.toContain(caseAttachmentName(1));
      const { items } = JSON.parse(text) as {
        items: Record<string, unknown>[];
      };
      const mine = items.filter(
        (i) => i.action === "case.attachment.visibility.change",
      );
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({
        result: "success",
        actor: { id: cw.w.memberS1.id },
        target: { type: "attachment", id },
      });
    }
  });
});
