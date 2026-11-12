// 社員の一覧（カーソルで続きを取る）。部署・表示名の検索語ごとに別のキャッシュにする。開いたとき・フォーカスしたときに取り直す。
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { fetchMembers } from "../api/member-api";
import { memberKeys } from "../query-keys";

export function useMembers(departmentId: string, q: string) {
  return useInfiniteQuery({
    queryKey: memberKeys.list(departmentId, q),
    queryFn: ({ pageParam }) => fetchMembers(departmentId, q, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // 絞り込みを変えたとき、新しい一覧が届くまで前の一覧を見せる
    placeholderData: keepPreviousData,
    retry: false,
  });
}
