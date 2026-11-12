// チャンネルの作成を申請する。成功したら、自分の申請を取り直す（再読込なしで一覧に出る）。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createChannelRequest,
  type CreateChannelRequestInput,
} from "../api/channel-request-api";
import { channelRequestKeys } from "../api/query-keys";

export function useCreateChannelRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateChannelRequestInput) =>
      createChannelRequest(input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: channelRequestKeys.all }),
  });
}
