// 案件の検索の結果（S-15 の「案件」の区画）。メッセージの区画と同じ取得の決まり（毎回1ページ目から・取り消し・キャッシュに持たない・
// 前の結果を仮に出さない）。参加の有無（isParticipant）が変わりうるため、区画を離れたら取り除く。後始末はこの区画のキーだけ
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSignedInUserId } from "../../auth";
import { searchKeys } from "../api/query-keys";
import { searchCases } from "../api/search-api";
import { fetchSearchPages } from "./fetch-search-pages";

export function useCaseSearch(q: string) {
  const userId = useSignedInUserId();
  const queryClient = useQueryClient();
  const [pageCount, setPageCount] = useState(1);
  useEffect(
    () => () => {
      if (userId === undefined) return;
      const filters = { queryKey: searchKeys.casesAll(userId) };
      void queryClient.cancelQueries(filters);
      queryClient.removeQueries(filters);
    },
    [queryClient, userId],
  );
  const query = useQuery({
    queryKey: searchKeys.cases(userId ?? "", q, pageCount),
    queryFn: ({ signal }) =>
      fetchSearchPages(
        (cursor) => searchCases(q, cursor, { signal }),
        pageCount,
        signal,
      ),
    enabled: userId !== undefined,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  return {
    query,
    showMore: () => setPageCount((count) => count + 1),
  };
}
