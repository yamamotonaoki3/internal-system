// メッセージの検索の結果（S-15）。抜粋は資格に左右されるため、キャッシュに持たない（staleTime 0・gcTime 0・画面を離れたら取り除く）。
// 取得はいつも1ページ目から、見せるページ数の分だけ順に取る（「さらに表示」はページ数を1つ増やして取り直す）。
// こうすると、取得が完了した時点で出る行は、その時点のサーバーの応答の行だけになる（資格を失った部屋の行が、前のページに残らない）。
// 前のページから行が消えても、カーソルはその取得の中の直前のページから作るので、重複・欠落が出ない。
// 前の結果を仮に出さない（placeholderData を使わない）。失敗の表示は呼び出し側が、前の結果を出さずに行う。
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSignedInUserId } from "../../auth";
import { searchKeys, type MessageSearchConditions } from "../api/query-keys";
import { searchMessages, type MessageSearchItem } from "../api/search-api";

export type MessageSearchResult = {
  items: MessageSearchItem[];
  hasMore: boolean;
};

async function fetchPages(
  conditions: MessageSearchConditions,
  pageCount: number,
): Promise<MessageSearchResult> {
  const items: MessageSearchItem[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < pageCount; page += 1) {
    const result = await searchMessages(conditions, cursor);
    items.push(...result.items);
    if (result.nextCursor === null) return { items, hasMore: false };
    cursor = result.nextCursor;
  }
  return { items, hasMore: true };
}

export function useMessageSearch(conditions: MessageSearchConditions) {
  const userId = useSignedInUserId();
  const queryClient = useQueryClient();
  const [pageCount, setPageCount] = useState(1);
  useEffect(
    () => () => {
      if (userId === undefined) return;
      const filters = { queryKey: searchKeys.user(userId) };
      void queryClient.cancelQueries(filters);
      queryClient.removeQueries(filters);
    },
    [queryClient, userId],
  );
  const query = useQuery({
    queryKey: searchKeys.messages(userId ?? "", conditions, pageCount),
    queryFn: () => fetchPages(conditions, pageCount),
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
