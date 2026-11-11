// 通知をすべて既読にする。成功したら、一覧とヘッダーの未読数を取り直す。取り直しが終わるまで送信中のままにして、二重に送らせない。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { markAllNotificationsRead } from "../api/notification-api";
import { notificationKeys } from "../api/query-keys";

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}
