// 自分の添付を削除する（#270。再認証が要る操作）。再認証（必要なら）を挟んで送る。再認証が完了しなかった場合は、要求を送らずに NotSentError にする。
// 成功したら、再読み込みなしで、その添付を表示から外す：
//   部屋の投稿：部屋の一覧の該当の行と、スレッドのキャッシュの親（部屋の一覧とは別に持たれている）
//   返信：スレッドのキャッシュの返信の該当の行
// 案件の添付の一覧（features/cases）も取り直す（既定の方針6）。useReauth を使うため、削除の確認のダイアログの中だけで呼ぶ。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useReauth } from "../../auth";
// cases の index.ts は messages の部品を読み込むため、キーだけの公開部分（keys.ts）を通す
import { caseKeys } from "../../cases/keys";
import { deleteAttachment, type RoomMessage } from "../api/message-api";
import { NotSentError } from "../describe-error";
import {
  replaceCachedMessage,
  replaceThreadParent,
} from "./replace-room-message";

export type AttachmentOwner = {
  roomId: string;
  /** 返信のときは、スレッドの親の ID */
  parentMessageId: string | null;
  messageId: string;
};

export function useDeleteAttachment(owner: AttachmentOwner) {
  const queryClient = useQueryClient();
  const { withReauth } = useReauth();
  return useMutation({
    mutationFn: async (attachmentId: string) => {
      let sent = false;
      try {
        await withReauth("添付の削除", () => {
          sent = true;
          return deleteAttachment(attachmentId);
        });
      } catch (error) {
        if (sent) throw error;
        throw new NotSentError({ cause: error });
      }
      return attachmentId;
    },
    onSuccess: async (attachmentId) => {
      const withoutAttachment = (message: RoomMessage): RoomMessage => ({
        ...message,
        attachments: message.attachments.filter(
          (attachment) => attachment.id !== attachmentId,
        ),
      });
      await replaceCachedMessage(
        queryClient,
        { roomId: owner.roomId, parentMessageId: owner.parentMessageId },
        owner.messageId,
        withoutAttachment,
      );
      if (owner.parentMessageId === null)
        await replaceThreadParent(
          queryClient,
          owner.messageId,
          withoutAttachment,
        );
      await queryClient.invalidateQueries({ queryKey: caseKeys.all });
    },
  });
}
