// S-38 のアーカイブしたチャンネル（#143-b）。利用者ごとに別のキャッシュにする。利用者の ID が確かめられる前は取得しない。
import { useInfiniteQuery } from "@tanstack/react-query";
import { useSession, useSignedInUserId } from "../../auth";
import { fetchArchivedChannels } from "../api/channel-api";
import { channelKeys } from "../api/query-keys";

export function useArchivedChannels() {
  // 利用者の ID はセッションのキャッシュから読むため、セッションを取得しておく
  useSession();
  const userId = useSignedInUserId();
  return useInfiniteQuery({
    queryKey: channelKeys.archived(userId ?? ""),
    enabled: userId !== undefined,
    queryFn: ({ pageParam }) => fetchArchivedChannels(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
}
