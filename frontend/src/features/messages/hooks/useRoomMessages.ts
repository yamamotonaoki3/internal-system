// 部屋のメッセージを、2秒ごとに「最後のID以降」で取り足す（1-9 AC-1・ADR-0004）。
// 一覧は Query のキャッシュだけに持つ。最後のIDは、キャッシュの末尾から毎回導く（別の状態に持たない）。
// 初回（キャッシュが空）は最新の一覧、以降は末尾のIDより後だけを取る。続きがある（hasMore）間は待たずに続けて取る。
// タブが非表示の間は止まり（refetchIntervalInBackground の既定）、表示に戻ったら取り直す。
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  fetchLatestMessages,
  fetchMessagesAfter,
  type RoomMessage,
} from "../api/message-api";
import { messageKeys } from "../api/query-keys";
import { isApiError } from "../describe-error";
import { mergeMessages } from "../merge-messages";
import {
  MESSAGE_POLL_INTERVAL_MS,
  MESSAGE_POLL_MAX_CONSECUTIVE_FETCHES,
} from "../polling";

// 権限・存在の問題は、待っても直らない。要求を重ねない
const STOP_POLLING_STATUSES: readonly number[] = [401, 403, 404];

export function useRoomMessages(roomId: string) {
  const queryClient = useQueryClient();
  const queryKey = messageKeys.room(roomId);
  // 非表示だったタブが表示に戻ったら、次の間隔を待たずに取り直す（外部のイベントとの同期）。取得中なら重ねない
  useEffect(() => {
    let wasHidden = document.visibilityState === "hidden";
    const refreshWhenVisible = () => {
      if (document.visibilityState === "hidden") {
        wasHidden = true;
        return;
      }
      if (!wasHidden) return;
      wasHidden = false;
      void queryClient.refetchQueries(
        { queryKey: messageKeys.room(roomId), type: "active" },
        { cancelRefetch: false },
      );
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () =>
      document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, [queryClient, roomId]);
  return useQuery({
    queryKey,
    queryFn: async (): Promise<RoomMessage[]> => {
      const current = queryClient.getQueryData<RoomMessage[]>(queryKey);
      let last = current?.at(-1);
      if (last === undefined) return fetchLatestMessages(roomId);
      let merged = current ?? [];
      for (let i = 0; i < MESSAGE_POLL_MAX_CONSECUTIVE_FETCHES; i += 1) {
        const page = await fetchMessagesAfter(roomId, last.id);
        merged = mergeMessages(merged, page.items);
        last = merged.at(-1) ?? last;
        if (!page.hasMore) break;
      }
      return merged;
    },
    retry: false,
    // 取得のたびの isFetching の切り替えでは描き直さない（2秒ごとの無駄な描画を避ける）。画面とテストが使う値だけ通知する
    notifyOnChangeProps: ["data", "error", "isError", "isPending"],
    refetchInterval: (query) =>
      isApiError(query.state.error) &&
      STOP_POLLING_STATUSES.includes(query.state.error.status)
        ? false
        : MESSAGE_POLL_INTERVAL_MS,
  });
}
