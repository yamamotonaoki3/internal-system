// メッセージの検索の結果（S-15）。抜粋は資格に左右されるため、キャッシュに持たない（staleTime 0・gcTime 0・画面を離れたら取り除く）。
// 前の結果を仮に出さない（placeholderData を使わない）。戻ってきたときは、その表示の中で取り直した結果だけを描く。
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useSignedInUserId } from "../../auth";
import { searchKeys, type MessageSearchConditions } from "../api/query-keys";
import { searchMessages } from "../api/search-api";

export function useMessageSearch(conditions: MessageSearchConditions | null) {
  const userId = useSignedInUserId();
  const queryClient = useQueryClient();
  const queryKey = searchKeys.messages(userId ?? "", conditions ?? { q: "" });
  useEffect(
    () => () => {
      if (userId === undefined) return;
      const filters = { queryKey: searchKeys.user(userId) };
      void queryClient.cancelQueries(filters);
      queryClient.removeQueries(filters);
    },
    [queryClient, userId],
  );
  return useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => {
      if (conditions === null) throw new Error("検索の条件がありません");
      return searchMessages(conditions, pageParam);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: userId !== undefined && conditions !== null,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
}
