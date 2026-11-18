// #150（150-A）3-3 AC-1：案件の終了・再開の通知の種類が、通知の種類の定義元（shared/notification-kinds.ts）にあること。
// 期待値は計画 150-A 6.3：case.closed・case.reopened とも containsRoomContent は false
// （部屋の内容を含まない。案件の概要は全員に見えるので、参加から外された後も「終了した・再開された」通知は一覧に残す）。
import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_KIND_DEFINITIONS,
  isNotificationKind,
  roomContentKinds,
} from "../../../shared/notification-kinds";

describe("#150 150-A 3-3 AC-1 通知の種類（案件の終了・再開）", () => {
  it.each(["case.closed", "case.reopened"])(
    "#150 3-3 AC-1: %s が種類として定義され、containsRoomContent は false",
    (kind) => {
      expect(isNotificationKind(kind)).toBe(true);
      expect(NOTIFICATION_KIND_DEFINITIONS[kind]?.containsRoomContent).toBe(
        false,
      );
    },
  );

  it("#150 3-3 AC-1: どちらも部屋の内容を含む種類の一覧に入らない（参加から外された後も一覧・未読数から除かれない）", () => {
    const kinds = roomContentKinds();
    expect(kinds).not.toContain("case.closed");
    expect(kinds).not.toContain("case.reopened");
  });
});
