// #143-a a-AC-5（3-4 AC-5・C-124(5)）: 通知の種類の定義元（shared/notification-kinds.ts）に、アーカイブ・復元の通知が足されていること。
// 期待値は計画 #143-a の API の節から決める：channel.archived・channel.restored とも containsRoomContent は false
// （アーカイブの後も通知の一覧・未読数に残す。閲覧権限を失っても消さない）。
import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_KIND_DEFINITIONS,
  isNotificationKind,
  roomContentKinds,
} from "../../../shared/notification-kinds";

describe("#143 a-AC-5 通知の種類（アーカイブ・復元）", () => {
  it.each(["channel.archived", "channel.restored"])(
    "#143 a-AC-5: %s が種類として定義され、containsRoomContent は false",
    (kind) => {
      expect(isNotificationKind(kind)).toBe(true);
      expect(NOTIFICATION_KIND_DEFINITIONS[kind]?.containsRoomContent).toBe(
        false,
      );
    },
  );

  it("#143 a-AC-5: どちらも部屋の内容を含む種類の一覧に入らない（アーカイブ中も一覧から除かれない）", () => {
    const kinds = roomContentKinds();
    expect(kinds).not.toContain("channel.archived");
    expect(kinds).not.toContain("channel.restored");
  });

  it("#143 a-AC-5（2-6 AC-5③）: 名前・説明の変更の通知の種類は定義しない（通知しない）", () => {
    expect(
      Object.keys(NOTIFICATION_KIND_DEFINITIONS).filter(
        (kind) => kind.startsWith("channel.") && kind !== "channel.invited",
      ),
    ).toEqual(expect.arrayContaining(["channel.archived", "channel.restored"]));
    expect(
      Object.keys(NOTIFICATION_KIND_DEFINITIONS).filter(
        (kind) =>
          kind.startsWith("channel.") &&
          !["channel.invited", "channel.archived", "channel.restored"].includes(
            kind,
          ),
      ),
    ).toEqual([]);
  });
});
