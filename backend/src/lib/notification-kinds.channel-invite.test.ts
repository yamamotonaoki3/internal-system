// #135 決定 Q4：通知の種類の定義元（shared/notification-kinds.ts）に、チャンネルへの招待の通知 channel.invited が足されていること。
// 期待値は計画 4節 Q4・6節から決める。招待の通知は部屋の内容を含む（containsRoomContent: true）：
// 招待された人がのちにそのチャンネルを見られなくなれば、既存の条件で一覧・未読数から除かれる（非公開チャンネルの存在を漏らさない）。
import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_KIND_DEFINITIONS,
  isNotificationKind,
  roomContentKinds,
} from "../../../shared/notification-kinds";

describe("#135 決定 Q4 通知の種類（チャンネルへの招待）", () => {
  it("#135 決定 Q4: channel.invited が種類として定義され、containsRoomContent は true", () => {
    expect(isNotificationKind("channel.invited")).toBe(true);
    expect(
      NOTIFICATION_KIND_DEFINITIONS["channel.invited"]?.containsRoomContent,
    ).toBe(true);
  });

  it("#135 決定 Q4: channel.invited は部屋の内容を含む種類の一覧に入る", () => {
    expect(roomContentKinds()).toContain("channel.invited");
  });

  it("#135 決定 Q2: 招待の承諾・辞退の通知の種類は定義しない（招待の表を作らず、確定と同時に参加する）", () => {
    expect(
      Object.keys(NOTIFICATION_KIND_DEFINITIONS).filter((kind) =>
        kind.startsWith("channel.invit"),
      ),
    ).toEqual(["channel.invited"]);
  });
});
