// #128（128-c）3-4 AC-1・AC-2：通知の種類の定義元（shared/notification-kinds.ts）に、退職処理の申請の 3 種類が足されていること。
// 期待値は計画 5.4 から決める。3 種類とも部屋の内容を含まない（containsRoomContent: false）。
// 取り下げは通知しない（C-177 U-1。チャンネルの作成申請 C-167 とそろえる）ため、取り下げの種類は定義しない。
import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_KIND_DEFINITIONS,
  isNotificationKind,
  roomContentKinds,
} from "../../../shared/notification-kinds";

const KINDS = [
  "retirement_request.submitted",
  "retirement_request.approved",
  "retirement_request.rejected",
];

describe("#128 3-4 AC-1・AC-2 通知の種類（退職処理の申請）", () => {
  it.each(KINDS)(
    "#128 3-4 AC-1・AC-2: %s が種類として定義され、部屋の内容を含まない",
    (kind) => {
      expect(isNotificationKind(kind)).toBe(true);
      expect(NOTIFICATION_KIND_DEFINITIONS[kind]?.containsRoomContent).toBe(
        false,
      );
      expect(roomContentKinds()).not.toContain(kind);
    },
  );

  it("#128 C-177（U-1）: 取り下げの通知の種類は定義しない", () => {
    expect(
      Object.keys(NOTIFICATION_KIND_DEFINITIONS).filter(
        (kind) =>
          kind.startsWith("retirement_request.") && !KINDS.includes(kind),
      ),
    ).toEqual([]);
  });
});
