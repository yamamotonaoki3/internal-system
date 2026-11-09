// メッセージを投稿する。成功したら、その部屋の一覧を取り直す（再読込なしで自分の投稿が出る）。
// 取り直しが終わるまで送信中のままにして、二重に送らせない。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { postMessage } from "../api/message-api";
import { messageKeys } from "../api/query-keys";

export function usePostMessage(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => postMessage(roomId, body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: messageKeys.room(roomId) }),
  });
}
