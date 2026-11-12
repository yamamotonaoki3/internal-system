// 審査一覧（S-11）。状態ごとに別のキャッシュにする。
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import {
  fetchReviewChannelRequests,
  type RequestStatus,
} from "../api/channel-request-api";
import { channelRequestKeys } from "../api/query-keys";

export function useReviewChannelRequests(status: RequestStatus) {
  return useInfiniteQuery({
    queryKey: channelRequestKeys.review(status),
    queryFn: ({ pageParam }) => fetchReviewChannelRequests(status, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // 状態を変えたとき、新しい一覧が届くまで前の一覧を見せる（読み込み中の表示でちらつかせない）
    placeholderData: keepPreviousData,
    retry: false,
  });
}
