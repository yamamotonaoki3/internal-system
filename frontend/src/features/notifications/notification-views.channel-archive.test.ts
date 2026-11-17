// #143-a a-AC-5（3-4 AC-5・C-124(5)・D-5）: アーカイブ・復元の通知（channel.archived・channel.restored）の文言と移動先（notification-views.ts の対応表）。
// 期待値は計画 #143-a「画面」の通知の行と、決定 D-5 の文言から決める：
//   channel.archived：「参加しているチャンネルがアーカイブされました」。理由があれば「参加しているチャンネルがアーカイブされました（理由：{reason}）」。
//                     チャンネルへは移らない（アーカイブ中は開けない。開いたときの表示は NotificationList が出す）
//   channel.restored：「参加しているチャンネルが復元されました」。移動先はチャンネル（/channels/{roomId}）
// 契約（実装前。報告に明記）：通知の項目（NotificationItem）に reason（string | null）と roomArchived（boolean）が足される。データは架空。
import { describe, expect, it } from "vitest";
import { describeNotification } from "./notification-views";

const ROOM_ID = "01JTESTCHARCHNOTIFROOM0001";

const item = (
  kind: string,
  overrides: { reason?: string | null; roomArchived?: boolean } = {},
) => ({
  id: "01JTESTCHARCHNOTIFITEM0001",
  kind,
  roomId: ROOM_ID,
  messageId: null,
  targetId: "01JTESTCHARCHEVENT00000001",
  createdAt: "2026-11-17T00:00:00.000Z",
  readAt: null,
  reason: overrides.reason ?? null,
  roomArchived: overrides.roomArchived ?? false,
});

describe("#143 a-AC-5（D-5）アーカイブ・復元の通知の文言と移動先", () => {
  // 開いたときに移動しないことは、NotificationList の動き（notifications.channel-archive.test.tsx）で確かめる
  it("#143 a-AC-5: 理由のないアーカイブの通知は「参加しているチャンネルがアーカイブされました」", () => {
    const view = describeNotification(
      item("channel.archived", { roomArchived: true }),
    );
    expect(view.label).toBe("参加しているチャンネルがアーカイブされました");
  });

  it("#143 a-AC-5（D-5）: 理由があれば「（理由：…）」を付ける", () => {
    expect(
      describeNotification(
        item("channel.archived", { reason: "統合のため", roomArchived: true }),
      ).label,
    ).toBe("参加しているチャンネルがアーカイブされました（理由：統合のため）");
  });

  it("#143 a-AC-5: 復元の通知は「参加しているチャンネルが復元されました」で、チャンネルへ移る", () => {
    const view = describeNotification(item("channel.restored"));
    expect(view.label).toBe("参加しているチャンネルが復元されました");
    expect(view.to).toBe(`/channels/${ROOM_ID}`);
  });
});
