// ヘッダーの未読数を、2秒ごとに取る（ポーリングの方針は polling.ts）。
import { useQuery } from "@tanstack/react-query";
import { fetchUnreadNotificationCount } from "../api/notification-api";
import { notificationKeys } from "../api/query-keys";
import { pollIntervalUnlessDenied } from "../polling";

export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: notificationKeys.unreadCount,
    queryFn: fetchUnreadNotificationCount,
    retry: false,
    // 取得のたびの isFetching の切り替えでは描き直さない（2秒ごとの無駄な描画を避ける）
    notifyOnChangeProps: ["data", "error", "isError", "isPending"],
    refetchInterval: (query) => pollIntervalUnlessDenied(query.state.error),
  });
}
