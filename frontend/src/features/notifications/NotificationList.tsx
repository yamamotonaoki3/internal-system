// S-14 の一覧。読み込み中・エラー・なし・ありの4つの状態を出し分ける。
// 移動先のある通知は、押すと既読にしてから移動する（既読に失敗したら移動せず、エラーを出す）。移動先のない未読は「既読にする」ボタンで既読にする。
// チャンネルがアーカイブ中の通知（roomArchived。アーカイブの通知は常に）は、押すと既読にして、移動せずに「このチャンネルはアーカイブされました」を出す（#143・3-4 AC-5）。
import { useState } from "react";
import { useNavigate } from "react-router";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import type { NotificationItem } from "./api/notification-api";
import { describeError } from "./describe-error";
import { useMarkAllNotificationsRead } from "./hooks/useMarkAllNotificationsRead";
import { useMarkNotificationRead } from "./hooks/useMarkNotificationRead";
import { useNotifications } from "./hooks/useNotifications";
import {
  describeNotification,
  NOTIFICATION_VIEWS,
  type NotificationView,
} from "./notification-views";

type NotificationListProps = {
  /** 種類ごとの文言・移動先の対応表。既定は本番の対応表 */
  views?: Readonly<Record<string, NotificationView>>;
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function NotificationList({
  views = NOTIFICATION_VIEWS,
}: NotificationListProps) {
  const notifications = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const navigate = useNavigate();
  // 「このチャンネルはアーカイブされました」を出している通知の ID
  const [archivedShownId, setArchivedShownId] = useState<string | null>(null);

  if (notifications.isPending) return <p role="status">読み込み中です</p>;
  if (notifications.isError)
    return (
      <Alert tone="error" role="alert">
        {describeError(notifications.error)}
      </Alert>
    );

  const items = notifications.data.pages.flatMap((page) => page.items);
  if (items.length === 0) return <p>新しい通知はありません</p>;

  // 既読にしてから移動する。既読に失敗したら移動せず、markRead.error を下のアラートに出す
  function open(item: NotificationItem, to: string) {
    if (item.readAt !== null) {
      void navigate(to);
      return;
    }
    markRead.mutate(item.id, { onSuccess: () => void navigate(to) });
  }

  // アーカイブ中のチャンネルは開けないため、移動せずにその場で知らせる。既読の扱いは open と同じ
  function showArchived(item: NotificationItem) {
    if (item.readAt !== null) {
      setArchivedShownId(item.id);
      return;
    }
    markRead.mutate(item.id, { onSuccess: () => setArchivedShownId(item.id) });
  }

  const error = markRead.error ?? markAllRead.error;
  return (
    <>
      <div className="mb-4">
        <Button
          variant="secondary"
          disabled={markAllRead.isPending}
          onClick={() => markAllRead.mutate()}
        >
          すべて既読にする
        </Button>
      </div>
      {error !== null && (
        <Alert tone="error" role="alert">
          {describeError(error)}
        </Alert>
      )}
      <ul className="mb-4">
        {items.map((item) => {
          const { label, to } = describeNotification(item, views);
          const unread = item.readAt === null;
          const archived =
            item.kind === "channel.archived" || item.roomArchived;
          const summary = (
            <>
              <span className="font-bold">{label}</span>{" "}
              <time dateTime={item.createdAt} className="text-text-muted">
                {formatTime(item.createdAt)}
              </time>
              {unread && <span className="text-danger"> 未読</span>}
            </>
          );
          return (
            <li key={item.id} className="border-b border-border py-2">
              {archived ? (
                <>
                  <Button
                    variant="ghost"
                    disabled={markRead.isPending}
                    onClick={() => showArchived(item)}
                  >
                    {summary}
                    <span className="text-text-muted">
                      （アーカイブされました）
                    </span>
                  </Button>
                  {archivedShownId === item.id && (
                    <p role="status" className="mt-1">
                      このチャンネルはアーカイブされました
                    </p>
                  )}
                </>
              ) : to === null ? (
                <div className="flex items-center justify-between gap-3">
                  <p>{summary}</p>
                  {unread && (
                    <Button
                      variant="ghost"
                      disabled={markRead.isPending}
                      onClick={() => markRead.mutate(item.id)}
                    >
                      既読にする
                    </Button>
                  )}
                </div>
              ) : (
                <Button
                  variant="ghost"
                  disabled={markRead.isPending}
                  onClick={() => open(item, to)}
                >
                  {summary}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {notifications.hasNextPage && (
        <Button
          variant="secondary"
          disabled={notifications.isFetchingNextPage}
          onClick={() => void notifications.fetchNextPage()}
        >
          さらに表示
        </Button>
      )}
    </>
  );
}
