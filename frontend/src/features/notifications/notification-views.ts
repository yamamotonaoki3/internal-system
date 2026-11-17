// 通知の種類ごとの文言と移動先の対応表。文言は保存せず、ここで組み立てる（対応表を直せば過去の通知にも反映される）。
// 種類を足す Issue は、shared/notification-kinds.ts と、この表の両方に 1 件足す。
import type { NotificationKind } from "../../../../shared/notification-kinds";
import type { NotificationItem } from "./api/notification-api";

export type NotificationView = {
  label: string;
  /** 開いたときの移動先。null なら移動先なし */
  to: (item: NotificationItem) => string | null;
};

export const NOTIFICATION_VIEWS: Readonly<
  Record<NotificationKind, NotificationView>
> = {
  "message.mentioned": {
    label: "メッセージで指名されました",
    to: (item) =>
      item.targetId === null
        ? null
        : `/threads?thread=${encodeURIComponent(item.targetId)}`,
  },
  "channel_request.submitted": {
    label: "チャンネルの作成の申請が届きました",
    to: () => "/channel-approvals",
  },
  "channel_request.approved": {
    label: "チャンネルの作成の申請が承認されました",
    to: (item) => (item.roomId === null ? null : `/channels/${item.roomId}`),
  },
  // 通知の行に招待者・チャンネルの名前を保存しないため、固定の文にする（#135）
  "channel.invited": {
    label: "チャンネルに追加されました",
    to: (item) => (item.roomId === null ? null : `/channels/${item.roomId}`),
  },
  "channel_request.rejected": {
    label: "チャンネルの作成の申請が却下されました",
    to: () => "/channel-requests",
  },
  "case_request.submitted": {
    label: "案件の作成の申請が届きました",
    to: () => "/case-approvals",
  },
  "case_request.approved": {
    label: "案件の作成の申請が承認されました",
    to: () => "/case-requests",
  },
  "case_request.rejected": {
    label: "案件の作成の申請が却下されました",
    to: () => "/case-requests",
  },
  // 退職処理の申請（#128）。通知の行に対象の社員の名前を保存しないため、固定の文にする
  "retirement_request.submitted": {
    label: "退職処理の申請が届きました",
    to: () => "/accounts?tab=retirement-requests",
  },
  "retirement_request.approved": {
    label: "退職処理の申請が完了しました",
    to: () => "/retirement-requests/mine",
  },
  "retirement_request.rejected": {
    label: "退職処理の申請が却下されました",
    to: () => "/retirement-requests/mine",
  },
};

const GENERIC_LABEL = "通知";

/** 対応表に（自分自身のキーとして）ない種類は、汎用の「通知」・移動先なしにする（落ちない） */
export function describeNotification(
  item: NotificationItem,
  views: Readonly<Record<string, NotificationView>> = NOTIFICATION_VIEWS,
): { label: string; to: string | null } {
  if (!Object.hasOwn(views, item.kind))
    return { label: GENERIC_LABEL, to: null };
  const view = views[item.kind];
  if (view === undefined) return { label: GENERIC_LABEL, to: null };
  return { label: view.label, to: view.to(item) };
}
