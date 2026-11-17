// 自分の申請の一覧（カーソルで続きを取る）。利用者の ID が確かめられる前は取得しない（キーに入れる ID がないため）。
import { useInfiniteQuery } from "@tanstack/react-query";
import { useSignedInUserId } from "../../auth";
import { fetchMyCaseRequests } from "../api/case-request-api";
import { caseRequestKeys } from "../api/query-keys";

export function useMyCaseRequests() {
  const userId = useSignedInUserId();
  return useInfiniteQuery({
    queryKey: caseRequestKeys.mine(userId ?? ""),
    enabled: userId !== undefined,
    queryFn: ({ pageParam }) => fetchMyCaseRequests(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
}
