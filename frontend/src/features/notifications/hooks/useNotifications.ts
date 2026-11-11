// 通知の一覧（カーソルで続きを取る）。1ページ目だけを読み込んでいる間は2秒ごとに取り直し、再読み込みなしで新着を先頭に出す（polling.ts）。
// 「最後のID以降」の取得は作らない：通知は新しい順で件数が少なく、取り直しで足りる（docs/design/notifications.md）。
import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchNotifications } from "../api/notification-api";
import { notificationKeys } from "../api/query-keys";
import { pollIntervalUnlessDenied } from "../polling";

export function useNotifications() {
  return useInfiniteQuery({
    queryKey: notificationKeys.list,
    queryFn: ({ pageParam }) => fetchNotifications(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
    // 2ページ目以降を読み込んだらポーリングを止める：全ページの取り直しは最初のカーソルで取るため、
    // 新着で押し出された通知が抜けてしまう。ヘッダーの未読数は別のクエリで動き続ける
    refetchInterval: (query) =>
      (query.state.data?.pages.length ?? 0) > 1
        ? false
        : pollIntervalUnlessDenied(query.state.error),
  });
}
