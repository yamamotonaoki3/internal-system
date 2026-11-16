// チャンネルへの招待（S-12）。再認証の確認と、招待の送信を分ける：再認証が済んでも、確定画面で「確定」を押すまで送らない。
// 招待が成功したら、一覧・サイドバー・詳細を取り直す（参加者に相手が出る）。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useReauth } from "../../auth";
import { inviteToChannel } from "../api/channel-api";
import { channelKeys } from "../api/query-keys";

export function useInviteToChannel(channelId: string) {
  const queryClient = useQueryClient();
  const { withReauth } = useReauth();
  return {
    // 再認証（必要なら）だけを済ませる。中止・失敗は error になり、招待は送らない
    confirmReauth: useMutation({
      mutationFn: () =>
        withReauth("チャンネルへの招待", () => Promise.resolve()),
    }),
    invite: useMutation({
      mutationFn: (userId: string) => inviteToChannel(channelId, userId),
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: channelKeys.all }),
    }),
  };
}
