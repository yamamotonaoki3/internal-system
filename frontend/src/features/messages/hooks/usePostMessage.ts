// メッセージを投稿する。parentMessageId があれば、そのスレッドへの返信として投稿する。
// 部屋への投稿は、成功したら、その部屋の一覧を取り直す（再読込なしで自分の投稿が出る）。
// 返信は、スレッドを取り直し、部屋の一覧の親の replyCount を1増やす（返信は部屋の一覧に出ず、取り直しでは件数が変わらないため）。
// 取り直しが終わるまで送信中のままにして、二重に送らせない。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { postMessage, postReply, type RoomMessage } from "../api/message-api";
import { messageKeys } from "../api/query-keys";

export function usePostMessage(roomId: string, parentMessageId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: string): Promise<void> => {
      if (parentMessageId === undefined) await postMessage(roomId, body);
      else await postReply(parentMessageId, body);
    },
    onSuccess: async () => {
      if (parentMessageId === undefined) {
        await queryClient.invalidateQueries({
          queryKey: messageKeys.room(roomId),
        });
        return;
      }
      // 実行中の2秒ごとの取得が、増やす前の一覧で上書きしないよう、先に止める
      const roomKey = messageKeys.room(roomId);
      await queryClient.cancelQueries({ queryKey: roomKey });
      queryClient.setQueryData<RoomMessage[]>(roomKey, (messages) =>
        messages?.map((message) =>
          message.id === parentMessageId
            ? { ...message, replyCount: message.replyCount + 1 }
            : message,
        ),
      );
      await queryClient.invalidateQueries({
        queryKey: messageKeys.thread(parentMessageId),
      });
    },
  });
}
