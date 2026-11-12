// DM の詳細（相手・投稿できるか）。当事者でない・存在しない（404）は待っても直らないため、再試行しない。
import { useQuery } from "@tanstack/react-query";
import { fetchDm } from "../api/dm-api";
import { dmKeys } from "../api/query-keys";

export function useDm(roomId: string) {
  return useQuery({
    queryKey: dmKeys.detail(roomId),
    queryFn: () => fetchDm(roomId),
    retry: false,
  });
}
