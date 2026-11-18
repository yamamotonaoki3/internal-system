// #150（150-A）3-3 AC-1、計画 150-A 6.5：案件の終了・再開の通知の文言と移動先（notification-views.ts の対応表）。
// 文言に件名を入れない（通知の応答に件名がない）。移動先は S-17（/cases/:caseId）。targetId が null なら移動先なし。
// 「（アーカイブされました）」の扱いは channel.archived だけのまま（案件の終了は「アーカイブ」と呼ばない）。データは架空。
import { describe, expect, it } from "vitest";
import type { NotificationItem } from "./api/notification-api";
import { describeNotification } from "./notification-views";

const CASE_ID = "01JTESTCASE150NTF000000001";

function item(
  kind: string,
  overrides: Partial<NotificationItem> = {},
): NotificationItem {
  return {
    id: "01JTESTCASE150NTFTEM00001A",
    kind,
    roomId: null,
    messageId: null,
    targetId: CASE_ID,
    createdAt: "2026-11-18T03:00:00.000Z",
    readAt: null,
    reason: null,
    roomArchived: false,
    ...overrides,
  };
}

describe("#150 150-A 3-3 AC-1 通知の文言と移動先", () => {
  it.each([
    { kind: "case.closed", label: "参加している案件が終了しました" },
    { kind: "case.reopened", label: "参加している案件が再開されました" },
  ])(
    "#150 3-3 AC-1: $kind は「$label」で、S-17（/cases/:caseId）へ移る",
    ({ kind, label }) => {
      expect(describeNotification(item(kind))).toEqual({
        label,
        to: `/cases/${CASE_ID}`,
      });
    },
  );

  it.each(["case.closed", "case.reopened"])(
    "#150 6.5: %s で targetId が null なら、移動先なし（文言は同じ）",
    (kind) => {
      expect(
        describeNotification(item(kind, { targetId: null })).to,
      ).toBeNull();
    },
  );
});
