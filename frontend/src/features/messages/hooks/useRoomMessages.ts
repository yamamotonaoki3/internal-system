// 部屋のメッセージを、2秒ごとに「最後のID以降」で取り足す（1-9 AC-1・ADR-0004）。
// 一覧は Query のキャッシュだけに持つ。最後のIDは、キャッシュの末尾から毎回導く（別の状態に持たない）。
// 初回（キャッシュが空）は最新の一覧、以降は末尾のIDより後だけを取る。続きがある（hasMore）間は待たずに続けて取る。
// タブが非表示の間は止まり（refetchIntervalInBackground の既定）、表示に戻ったら取り直す。
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  fetchLatestMessages,
  fetchMessagesAfter,
  type RoomMessage,
} from "../api/message-api";
import { messageKeys } from "../api/query-keys";
import {
  catchUpMessages,
  messagePollingOptions,
  useRefetchWhenVisible,
} from "./message-polling";

export function useRoomMessages(roomId: string) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => messageKeys.room(roomId), [roomId]);
  useRefetchWhenVisible(queryKey);
  return useQuery({
    queryKey,
    queryFn: async (): Promise<RoomMessage[]> => {
      const current = queryClient.getQueryData<RoomMessage[]>(queryKey) ?? [];
      if (current.length === 0) return fetchLatestMessages(roomId);
      const { messages } = await catchUpMessages(current, (after) =>
        fetchMessagesAfter(roomId, after),
      );
      return messages;
    },
    ...messagePollingOptions,
  });
}
