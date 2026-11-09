import { useQuery } from "@tanstack/react-query";
import { fetchChannel } from "../api/channel-api";
import { channelKeys } from "../api/query-keys";

export function useChannelDetail(channelId: string) {
  return useQuery({
    queryKey: channelKeys.detail(channelId),
    queryFn: () => fetchChannel(channelId),
    retry: false,
  });
}
