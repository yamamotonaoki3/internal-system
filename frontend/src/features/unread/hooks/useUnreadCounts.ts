// 部屋ごとの未読の件数を、2秒ごとに取る（ポーリングの方針は polling.ts）。data は部屋の ID で引ける対応表。
// 失敗の間は件数を出さない（呼び出し側が isError を見る）。
import { useQuery } from "@tanstack/react-query";
import { fetchUnreadCounts } from "../api/unread-api";
import { unreadKeys } from "../api/query-keys";
import { pollIntervalUnlessDenied } from "../polling";

export function useUnreadCounts() {
  return useQuery({
    queryKey: unreadKeys.counts,
    queryFn: fetchUnreadCounts,
    retry: false,
    refetchInterval: (query) => pollIntervalUnlessDenied(query.state.error),
  });
}
