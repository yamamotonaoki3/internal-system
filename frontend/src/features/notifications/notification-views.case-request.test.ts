// #146（146-A・146-B）3-4 AC-1・計画 A-7・B-2：案件の作成申請が届いた通知の文言と移動先（notification-views.ts の対応表）。
// 146-A では審査の画面がなかったため自分の申請の画面（/case-requests）にしていた。146-B で審査の画面（S-29。/case-approvals）に変える。データは架空。
import { describe, expect, it } from "vitest";
import { describeNotification } from "./notification-views";

describe("#146 3-4 AC-1 通知の文言と移動先", () => {
  it("#146 3-4 AC-1（146-B で移動先を変更）: 申請が届いた通知は「案件の作成の申請が届きました」で、審査の画面 /case-approvals へ移る", () => {
    expect(
      describeNotification({
        id: "01JTESTCASEREQNOTIFITEM01",
        kind: "case_request.submitted",
        roomId: null,
        messageId: null,
        targetId: "01JTESTCASEREQNOTIF000001",
        createdAt: "2026-11-17T03:00:00.000Z",
        readAt: null,
        reason: null,
        roomArchived: false,
      }),
    ).toEqual({
      label: "案件の作成の申請が届きました",
      to: "/case-approvals",
    });
  });

  it.each([
    ["case_request.approved", "案件の作成の申請が承認されました"],
    ["case_request.rejected", "案件の作成の申請が却下されました"],
  ] as const)(
    "#146 3-4 AC-2（146-B）: %s の通知は「%s」で、自分の申請の画面 /case-requests へ移る",
    (kind, label) => {
      expect(
        describeNotification({
          id: "01JTESTCASEREQNOTIFITEM02",
          kind,
          roomId: null,
          messageId: null,
          targetId: "01JTESTCASEREQNOTIF000002",
          createdAt: "2026-11-17T03:00:00.000Z",
          readAt: null,
          reason: null,
          roomArchived: false,
        }),
      ).toEqual({ label, to: "/case-requests" });
    },
  );
});
