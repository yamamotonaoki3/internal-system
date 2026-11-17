// #128（128-c）3-4 AC-1・AC-2：退職処理の申請の通知 3 種類の文言と移動先（notification-views.ts の対応表）。
// 移動先は計画 5.4（submitted → S-22 の「退職処理の申請」タブ、結果 → 自分の申請の一覧 /retirement-requests/mine）。
// 文言は計画・要件に定めがないため、チャンネルの作成申請（#131）の言い回しにそろえた仮置き。対象の社員の名前は通知に含めない（通知の行に名前を保存しない）。
import { describe, expect, it } from "vitest";
import { describeNotification } from "./notification-views";

const REQUEST_ID = "01JTEST128CN0T1F0000000010";

const item = (kind: string) => ({
  id: "01JTEST128CN0T1F1TEM000010",
  kind,
  roomId: null,
  messageId: null,
  targetId: REQUEST_ID,
  createdAt: "2026-11-17T00:00:00.000Z",
  readAt: null,
});

describe("#128 3-4 AC-1・AC-2 退職処理の申請の通知の文言と移動先", () => {
  it("#128 3-4 AC-1: 申請が届いた通知は「退職処理の申請が届きました」で、アカウント管理の申請のタブ（/accounts?tab=retirement-requests）へ移る", () => {
    expect(describeNotification(item("retirement_request.submitted"))).toEqual({
      label: "退職処理の申請が届きました",
      to: "/accounts?tab=retirement-requests",
    });
  });

  it("#128 3-4 AC-2: 完了（無効化）の通知は「退職処理の申請が完了しました」で、自分の申請（/retirement-requests/mine）へ移る", () => {
    expect(describeNotification(item("retirement_request.approved"))).toEqual({
      label: "退職処理の申請が完了しました",
      to: "/retirement-requests/mine",
    });
  });

  it("#128 3-4 AC-2: 却下の通知は「退職処理の申請が却下されました」で、自分の申請（/retirement-requests/mine）へ移る", () => {
    expect(describeNotification(item("retirement_request.rejected"))).toEqual({
      label: "退職処理の申請が却下されました",
      to: "/retirement-requests/mine",
    });
  });
});
