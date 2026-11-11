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
> = {};

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
