// チャンネルの一覧（カーソルで続きを取る）。絞り込みごとに別のキャッシュにする。
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { fetchChannels, type ChannelListFilter } from "../api/channel-api";
import { channelKeys } from "../api/query-keys";

export function useChannels(filter: ChannelListFilter) {
  return useInfiniteQuery({
    queryKey: channelKeys.list(filter),
    queryFn: ({ pageParam }) => fetchChannels(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // 絞り込みを変えたとき、新しい一覧が届くまで前の一覧を見せる（読み込み中の表示でちらつかせない）
    placeholderData: keepPreviousData,
    retry: false,
  });
}
