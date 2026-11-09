// チャンネルに参加する。成功したら、一覧・サイドバー・詳細を取り直す（再読込なしで画面に反映する）。
// 取り直しが終わるまで送信中のままにして、二重に送らせない。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { joinChannel } from "../api/channel-api";
import { channelKeys } from "../api/query-keys";

export function useJoinChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) => joinChannel(channelId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: channelKeys.all }),
  });
}
