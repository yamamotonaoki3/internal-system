// 自分の申請の一覧（カーソルで続きを取る）。
import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchMyChannelRequests } from "../api/channel-request-api";
import { channelRequestKeys } from "../api/query-keys";

export function useMyChannelRequests() {
  return useInfiniteQuery({
    queryKey: channelRequestKeys.mine,
    queryFn: ({ pageParam }) => fetchMyChannelRequests(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
}
