// #131 3-4 AC-1・AC-2：チャンネルの作成申請の通知 3 種類の文言と移動先（notification-views.ts の対応表）。
// 期待値は計画「通知」の表から決める。取り下げは通知しない（利用者決定 A）。データは架空。
import { describe, expect, it } from "vitest";
import { describeNotification } from "./notification-views";

const REQUEST_ID = "01JTESTCHREQNOTIF00000001";
const ROOM_ID = "01JTESTCHREQNOTIFROOM0001";

const item = (kind: string, roomId: string | null) => ({
  id: "01JTESTCHREQNOTIFITEM0001",
  kind,
  roomId,
  messageId: null,
  targetId: REQUEST_ID,
  createdAt: "2026-11-12T00:00:00.000Z",
  readAt: null,
});

describe("#131 3-4 AC-1・AC-2 通知の文言と移動先", () => {
  it("#131 3-4 AC-1: 申請が届いた通知は「チャンネルの作成の申請が届きました」で、承認一覧（/channel-approvals）へ移る", () => {
    expect(
      describeNotification(item("channel_request.submitted", null)),
    ).toEqual({
      label: "チャンネルの作成の申請が届きました",
      to: "/channel-approvals",
    });
  });

  it("#131 3-4 AC-2: 承認の通知は「チャンネルの作成の申請が承認されました」で、作られたチャンネル（/channels/{roomId}）へ移る", () => {
    expect(
      describeNotification(item("channel_request.approved", ROOM_ID)),
    ).toEqual({
      label: "チャンネルの作成の申請が承認されました",
      to: `/channels/${ROOM_ID}`,
    });
  });

  it("#131 3-4 AC-2: 却下の通知は「チャンネルの作成の申請が却下されました」で、自分の申請（/channel-requests）へ移る", () => {
    expect(
      describeNotification(item("channel_request.rejected", null)),
    ).toEqual({
      label: "チャンネルの作成の申請が却下されました",
      to: "/channel-requests",
    });
  });
});
