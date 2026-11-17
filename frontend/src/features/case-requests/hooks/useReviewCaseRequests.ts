// 審査一覧（S-29）。利用者・状態ごとに別のキャッシュにする。利用者の ID が確かめられる前は取得しない。
import { useInfiniteQuery } from "@tanstack/react-query";
import { useSignedInUserId } from "../../auth";
import {
  fetchReviewCaseRequests,
  type CaseRequestStatus,
} from "../api/case-request-api";
import { caseRequestKeys } from "../api/query-keys";

// キーは ["case-requests","review",利用者の ID,状態]
const USER_ID_INDEX = 2;

export function useReviewCaseRequests(status: CaseRequestStatus) {
  const userId = useSignedInUserId();
  return useInfiniteQuery({
    queryKey: caseRequestKeys.review(userId ?? "", status),
    enabled: userId !== undefined,
    queryFn: ({ pageParam }) => fetchReviewCaseRequests(status, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // 状態を変えたとき、新しい一覧が届くまで前の一覧を見せる（読み込み中の表示でちらつかせない）。
    // 利用者が替わったときは、前の利用者の一覧を見せない
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[USER_ID_INDEX] === (userId ?? "")
        ? previousData
        : undefined,
    retry: false,
  });
}
