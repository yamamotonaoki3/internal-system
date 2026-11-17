// #146（146-A）3-4 AC-1・計画 A-7：案件の作成申請が届いた通知の文言と移動先（notification-views.ts の対応表）。
// 審査の画面（S-29）は 146-B で作るため、A の移動先は自分の申請の画面（/case-requests）にする。データは架空。
import { describe, expect, it } from "vitest";
import { describeNotification } from "./notification-views";

describe("#146 3-4 AC-1 通知の文言と移動先", () => {
  it("#146 3-4 AC-1: 申請が届いた通知は「案件の作成の申請が届きました」で、/case-requests へ移る", () => {
    expect(
      describeNotification({
        id: "01JTESTCASEREQNOTIFITEM01",
        kind: "case_request.submitted",
        roomId: null,
        messageId: null,
        targetId: "01JTESTCASEREQNOTIF000001",
        createdAt: "2026-11-17T03:00:00.000Z",
        readAt: null,
      }),
    ).toEqual({
      label: "案件の作成の申請が届きました",
      to: "/case-requests",
    });
  });
});
