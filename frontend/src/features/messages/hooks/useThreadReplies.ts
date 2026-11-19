// スレッドの返信を、2秒ごとに「最後のID以降」で取り足す（EP-1-07。部屋と同じ取り方）。
// 返信は Query のキャッシュだけに持つ。親と「返信できない理由」は、応答のたびに最新に置き換える（親の削除・編集が2秒以内に届く）。
// 返信が0件のあいだは、最新の一覧を取り直す。続きがある（hasMore）間は待たずに続けて取る。
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  fetchLatestReplies,
  fetchRepliesAfter,
  type RoomMessage,
  type ThreadRepliesPage,
} from "../api/message-api";
import { messageKeys } from "../api/query-keys";
import {
  catchUpMessages,
  messagePollingOptions,
  useRefetchWhenVisible,
} from "./message-polling";

export type ThreadRepliesData = {
  parent: RoomMessage;
  /** ID昇順 */
  replies: RoomMessage[];
  replyBlockedReason: ThreadRepliesPage["replyBlockedReason"];
  joined: boolean;
  roomWritable: boolean;
  /** スレッドの部屋が案件専用チャンネルか（添付の公開範囲の選択を出すかに使う） */
  caseRoom: boolean;
};

export function useThreadReplies(parentMessageId: string) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => messageKeys.thread(parentMessageId),
    [parentMessageId],
  );
  useRefetchWhenVisible(queryKey);
  return useQuery({
    queryKey,
    queryFn: async (): Promise<ThreadRepliesData> => {
      const current = queryClient.getQueryData<ThreadRepliesData>(queryKey);
      if (current === undefined || current.replies.length === 0) {
        const latest = await fetchLatestReplies(parentMessageId);
        return {
          parent: latest.parent,
          replies: latest.items,
          replyBlockedReason: latest.replyBlockedReason,
          joined: latest.joined,
          roomWritable: latest.roomWritable,
          caseRoom: latest.caseRoom,
        };
      }
      const { messages, lastPage } = await catchUpMessages(
        current.replies,
        (after) => fetchRepliesAfter(parentMessageId, after),
      );
      return {
        parent: lastPage?.parent ?? current.parent,
        replies: messages,
        // 理由なし（null）も有効な値。?? で前の値に戻さない
        replyBlockedReason:
          lastPage === undefined
            ? current.replyBlockedReason
            : lastPage.replyBlockedReason,
        joined: lastPage === undefined ? current.joined : lastPage.joined,
        roomWritable:
          lastPage === undefined ? current.roomWritable : lastPage.roomWritable,
        caseRoom: lastPage === undefined ? current.caseRoom : lastPage.caseRoom,
      };
    },
    ...messagePollingOptions,
  });
}
