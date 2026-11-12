// #131 3-4 AC-1・AC-2：通知の種類の定義元（shared/notification-kinds.ts）に、チャンネルの作成申請の 3 種類が足されていること。
// 期待値は計画「通知」の表から決める。3 種類とも部屋の内容を含まない（containsRoomContent: false。閲覧権限を失っても一覧から消えない）。
// 取り下げは通知しない（利用者決定 A）ため、取り下げの種類は定義しない。
import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_KIND_DEFINITIONS,
  isNotificationKind,
  roomContentKinds,
} from "../../../shared/notification-kinds";

const KINDS = [
  "channel_request.submitted",
  "channel_request.approved",
  "channel_request.rejected",
];

describe("#131 3-4 AC-1・AC-2 通知の種類（チャンネルの作成申請）", () => {
  it.each(KINDS)(
    "#131 3-4 AC-1・AC-2: %s が種類として定義されている",
    (kind) => {
      expect(isNotificationKind(kind)).toBe(true);
      expect(NOTIFICATION_KIND_DEFINITIONS[kind]?.containsRoomContent).toBe(
        false,
      );
    },
  );

  it("#131 3-4 AC-1・AC-2: 3 種類とも部屋の内容を含む種類の一覧に入らない", () => {
    for (const kind of KINDS) expect(roomContentKinds()).not.toContain(kind);
  });

  it("#131（利用者決定 A）: 取り下げの通知の種類は定義しない", () => {
    expect(
      Object.keys(NOTIFICATION_KIND_DEFINITIONS).filter(
        (kind) => kind.startsWith("channel_request.") && !KINDS.includes(kind),
      ),
    ).toEqual([]);
  });
});
