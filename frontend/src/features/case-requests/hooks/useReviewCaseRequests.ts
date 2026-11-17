// 審査一覧（S-29）。状態ごとに別のキャッシュにする。
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import {
  fetchReviewCaseRequests,
  type CaseRequestStatus,
} from "../api/case-request-api";
import { caseRequestKeys } from "../api/query-keys";

export function useReviewCaseRequests(status: CaseRequestStatus) {
  return useInfiniteQuery({
    queryKey: caseRequestKeys.review(status),
    queryFn: ({ pageParam }) => fetchReviewCaseRequests(status, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // 状態を変えたとき、新しい一覧が届くまで前の一覧を見せる（読み込み中の表示でちらつかせない）
    placeholderData: keepPreviousData,
    retry: false,
  });
}
