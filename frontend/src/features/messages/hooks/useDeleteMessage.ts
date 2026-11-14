// メッセージを削除する（再認証が要る操作）。再認証（必要なら）を挟んで送る。再認証が完了しなかった場合は、要求を送らずに NotSentError にする。
// 成功したら、一覧の該当の1件を削除済みに替える（再読み込みなしで出る）。useReauth を使うため、削除の確認のダイアログの中だけで呼ぶ。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useReauth } from "../../auth";
import { deleteMessage } from "../api/message-api";
import { NotSentError } from "../describe-error";
import { replaceRoomMessage } from "./replace-room-message";

export function useDeleteMessage(roomId: string) {
  const queryClient = useQueryClient();
  const { withReauth } = useReauth();
  return useMutation({
    mutationFn: async (messageId: string) => {
      let sent = false;
      try {
        await withReauth("メッセージの削除", () => {
          sent = true;
          return deleteMessage(messageId);
        });
      } catch (error) {
        if (sent) throw error;
        throw new NotSentError({ cause: error });
      }
      return messageId;
    },
    onSuccess: (messageId) =>
      replaceRoomMessage(queryClient, roomId, messageId, (message) => ({
        id: message.id,
        roomId: message.roomId,
        author: message.author,
        createdAt: message.createdAt,
        editedAt: null,
        deleted: true,
        body: null,
      })),
  });
}
