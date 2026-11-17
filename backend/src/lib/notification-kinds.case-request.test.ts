// #146（146-A）3-4 AC-1：通知の種類の定義元（shared/notification-kinds.ts）に、案件の作成申請が届いた通知（case_request.submitted）が足されていること。
// 監査の操作の定義元（lib/audit-actions.ts）に、申請・取り下げ（case_request.create・case_request.withdraw）が足されていること。
// 期待値は計画 A-3 から決める。部屋の内容を含まない（containsRoomContent: false）。取り下げは通知しない（計画 A-6）。
import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_KIND_DEFINITIONS,
  isNotificationKind,
  roomContentKinds,
} from "../../../shared/notification-kinds";
import { AUDIT_ACTIONS } from "./audit-actions";

describe("#146 3-4 AC-1 通知の種類（案件の作成申請）", () => {
  it("#146 3-4 AC-1: case_request.submitted が種類として定義され、部屋の内容を含まない", () => {
    expect(isNotificationKind("case_request.submitted")).toBe(true);
    expect(
      NOTIFICATION_KIND_DEFINITIONS["case_request.submitted"]
        ?.containsRoomContent,
    ).toBe(false);
    expect(roomContentKinds()).not.toContain("case_request.submitted");
  });

  it("#146 5-3 AC-7: 取り下げの通知の種類は定義しない", () => {
    expect(isNotificationKind("case_request.withdrawn")).toBe(false);
  });
});

describe("#146 監査の操作（案件の作成申請）", () => {
  it.each(["case_request.create", "case_request.withdraw"])(
    "#146: %s が監査の操作として定義されている",
    (action) => {
      expect(AUDIT_ACTIONS as readonly string[]).toContain(action);
    },
  );
});
