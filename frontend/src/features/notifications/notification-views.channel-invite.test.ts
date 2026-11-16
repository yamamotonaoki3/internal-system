// #135 決定 Q4：チャンネルへの招待の通知（channel.invited）の文言と移動先（notification-views.ts の対応表）。
// 期待値は計画 4節 Q4（文言の案：〇〇さんがあなたを #チャンネル名 に追加しました。文言は画面の対応表に置く）と 7節から決める。
// 通知の行にはチャンネル名・招待者の名前を保存しない（計画 6節）ため、対応表の文言は「追加されました」の意味を持つ固定の文にする前提で確かめる。データは架空。
import { describe, expect, it } from "vitest";
import { describeNotification } from "./notification-views";

const ROOM_ID = "01JTESTCHINVNOTIFROOM0001";

const item = (roomId: string | null) => ({
  id: "01JTESTCHINVNOTIFITEM0001",
  kind: "channel.invited",
  roomId,
  messageId: null,
  targetId: null,
  createdAt: "2026-11-16T00:00:00.000Z",
  readAt: null,
});

describe("#135 決定 Q4 招待の通知の文言と移動先", () => {
  it("#135 決定 Q4: channel.invited は汎用の「通知」ではなく「追加」を含む文言で、招待されたチャンネル（/channels/{roomId}）へ移る", () => {
    const view = describeNotification(item(ROOM_ID));
    expect(view.label).not.toBe("通知");
    expect(view.label).toContain("追加");
    expect(view.to).toBe(`/channels/${ROOM_ID}`);
  });

  it("#135 決定 Q4: roomId がなければ移動先なし（落ちない）", () => {
    expect(describeNotification(item(null)).to).toBeNull();
  });
});
