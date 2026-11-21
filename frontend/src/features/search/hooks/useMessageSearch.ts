// メッセージの検索の結果（S-15）。抜粋は資格に左右されるため、キャッシュに持たない（staleTime 0・gcTime 0・画面を離れたら取り除く）。
// 取得はいつも1ページ目から、見せるページ数の分だけ順に取る（「さらに表示」はページ数を1つ増やして取り直す。fetchSearchPages）。
// 前の結果を仮に出さない（placeholderData を使わない）。失敗の表示は呼び出し側が、前の結果を出さずに行う。
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSignedInUserId } from "../../auth";
import { searchKeys, type MessageSearchConditions } from "../api/query-keys";
import { searchMessages, type MessageSearchItem } from "../api/search-api";
import { fetchSearchPages, type SearchPages } from "./fetch-search-pages";

export type MessageSearchResult = SearchPages<MessageSearchItem>;

export function useMessageSearch(conditions: MessageSearchConditions) {
  const userId = useSignedInUserId();
  const queryClient = useQueryClient();
  const [pageCount, setPageCount] = useState(1);
  useEffect(
    () => () => {
      if (userId === undefined) return;
      // この区画のキーだけを片付ける（同じ画面の案件の区画の取得を止めない）
      const filters = { queryKey: searchKeys.messagesAll(userId) };
      void queryClient.cancelQueries(filters);
      queryClient.removeQueries(filters);
    },
    [queryClient, userId],
  );
  const query = useQuery({
    queryKey: searchKeys.messages(userId ?? "", conditions, pageCount),
    queryFn: ({ signal }) =>
      fetchSearchPages(
        (cursor) => searchMessages(conditions, cursor, { signal }),
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
