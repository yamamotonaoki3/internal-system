// 通知の種類ごとの文言と移動先の対応表。文言は保存せず、ここで組み立てる（対応表を直せば過去の通知にも反映される）。
// 種類を足す Issue は、shared/notification-kinds.ts と、この表の両方に 1 件足す。
import type { NotificationKind } from "../../../../shared/notification-kinds";
import type { NotificationItem } from "./api/notification-api";

export type NotificationView = {
  label: string;
  /** 文言の後に付ける、通知の行の値から作る文（アーカイブの理由など）。null なら付けない */
  suffix?: (item: NotificationItem) => string | null;
  /** 開いたときの移動先。null なら移動先なし */
  to: (item: NotificationItem) => string | null;
};

/** target_id が案件の ID の通知の移動先（S-17） */
const caseLink = (item: NotificationItem) =>
  item.targetId === null ? null : `/cases/${encodeURIComponent(item.targetId)}`;

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
  // 承認でできた案件は、案件一覧（S-16）で見る（C-179(3)）
  "case_request.approved": {
    label: "案件の作成の申請が承認されました",
    to: () => "/cases",
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
  // チャンネルのアーカイブ・復元（#143。D-5）。アーカイブ中のチャンネルは開けないため、アーカイブの通知は移動先なし
  "channel.archived": {
    label: "参加しているチャンネルがアーカイブされました",
    suffix: (item) =>
      item.reason === null ? null : `（理由：${item.reason}）`,
    to: () => null,
  },
  "channel.restored": {
    label: "参加しているチャンネルが復元されました",
    to: (item) => (item.roomId === null ? null : `/channels/${item.roomId}`),
  },
  // 案件の終了・再開（#150）。通知の行に件名を保存しないため、固定の文にする。終了は「アーカイブ」と呼ばない
  "case.closed": {
    label: "参加している案件が終了しました",
    to: caseLink,
  },
  "case.reopened": {
    label: "参加している案件が再開されました",
    to: caseLink,
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
  return {
    label: view.label + (view.suffix?.(item) ?? ""),
    to: view.to(item),
  };
}
