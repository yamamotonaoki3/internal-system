// 社員の検索（案件の作成申請の追加の候補・案件の参加者の追加で共用）。検索語が空のときは取得しない。
import { useInfiniteQuery } from "@tanstack/react-query";
import { searchUsers } from "../api/user-search-api";
import { memberKeys } from "../query-keys";

export function useUserSearch(q: string) {
  return useInfiniteQuery({
    queryKey: memberKeys.search(q),
    queryFn: ({ pageParam }) => searchUsers(q, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: q !== "",
    retry: false,
  });
}
