// 自分の申請の一覧（カーソルで続きを取る）。
import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchMyCaseRequests } from "../api/case-request-api";
import { caseRequestKeys } from "../api/query-keys";

export function useMyCaseRequests() {
  return useInfiniteQuery({
    queryKey: caseRequestKeys.mine,
    queryFn: ({ pageParam }) => fetchMyCaseRequests(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
}
