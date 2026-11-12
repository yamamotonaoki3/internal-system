// 申請を取り下げる。成功しても失敗（すでに処理されていた等）しても、自分の申請を取り直す。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { withdrawChannelRequest } from "../api/channel-request-api";
import { channelRequestKeys } from "../api/query-keys";

export function useWithdrawChannelRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => withdrawChannelRequest(requestId),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: channelRequestKeys.all }),
  });
}
