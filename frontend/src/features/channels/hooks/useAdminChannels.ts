// S-39 の一覧（#143-b）。利用者・絞り込みごとに別のキャッシュにする。利用者の ID が確かめられる前は取得しない。
import { useInfiniteQuery } from "@tanstack/react-query";
import { useSession, useSignedInUserId } from "../../auth";
import {
  fetchAdminChannels,
  type AdminChannelFilter,
} from "../api/channel-api";
import { channelKeys } from "../api/query-keys";

// キーは ["channels","admin",利用者の ID,絞り込み]
const USER_ID_INDEX = 2;

export function useAdminChannels(filter: AdminChannelFilter) {
  // 利用者の ID はセッションのキャッシュから読むため、セッションを取得しておく
  useSession();
  const userId = useSignedInUserId();
  return useInfiniteQuery({
    queryKey: channelKeys.admin(userId ?? "", filter),
    enabled: userId !== undefined,
    queryFn: ({ pageParam }) => fetchAdminChannels(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // 絞り込みを変えたとき、新しい一覧が届くまで前の一覧を見せる。利用者が替わったときは、前の利用者の一覧を見せない
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[USER_ID_INDEX] === (userId ?? "")
        ? previousData
        : undefined,
    retry: false,
  });
}
