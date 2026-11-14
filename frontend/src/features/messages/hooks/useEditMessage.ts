// メッセージを編集する。成功したら、応答の本文と編集日時を一覧の該当の1件に反映する（再読み込みなしで出る）。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { editMessage } from "../api/message-api";
import { replaceRoomMessage } from "./replace-room-message";

export function useEditMessage(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string; body: string }) =>
      editMessage(input.messageId, input.body),
    onSuccess: (edited) =>
      replaceRoomMessage(queryClient, roomId, edited.id, (message) =>
        message.deleted
          ? message
          : { ...message, body: edited.body, editedAt: edited.editedAt },
      ),
  });
}
