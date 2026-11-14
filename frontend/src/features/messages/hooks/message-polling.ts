// 部屋とスレッドが共通で使う、2秒ごとの取り足し（ADR-0004）の部品。
// 「最後の ID 以降」を、続き（hasMore）がある間は待たずに続けて取る処理と、ポーリングの設定、非表示から戻ったときの取り直し。
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect } from "react";
import type { RoomMessage } from "../api/message-api";
import { isApiError } from "../describe-error";
import { mergeMessages } from "../merge-messages";
import {
  MESSAGE_POLL_INTERVAL_MS,
  MESSAGE_POLL_MAX_CONSECUTIVE_FETCHES,
} from "../polling";

// 権限・存在の問題は、待っても直らない。要求を重ねない
const STOP_POLLING_STATUSES: readonly number[] = [401, 403, 404];

/**
 * 取得済みの一覧（空でない）に、after で新着を取り足す。続きがある（hasMore）間は続けて取る（回数の上限あり。残りは次の間隔で取る）。
 * 最後に取ったページも返す（スレッドの親・返信できる状態を、新着と一緒に最新にするため）。
 */
export async function catchUpMessages<
  Page extends { items: RoomMessage[]; hasMore: boolean },
>(
  current: readonly RoomMessage[],
  fetchAfter: (after: string) => Promise<Page>,
): Promise<{ messages: RoomMessage[]; lastPage: Page | undefined }> {
  let merged: RoomMessage[] = [...current];
  let last = merged.at(-1);
  let lastPage: Page | undefined;
  for (let i = 0; i < MESSAGE_POLL_MAX_CONSECUTIVE_FETCHES; i += 1) {
    if (last === undefined) break;
    lastPage = await fetchAfter(last.id);
    merged = mergeMessages(merged, lastPage.items);
    last = merged.at(-1) ?? last;
    if (!lastPage.hasMore) break;
  }
  return { messages: merged, lastPage };
}

const NOTIFY_PROPS: ("data" | "error" | "isError" | "isPending")[] = [
  "data",
  "error",
  "isError",
  "isPending",
];

export const messagePollingOptions = {
  retry: false,
  // 画面を外れたら捨てる。開き直したら、最新（after なし）から取り直し、外れていた間の他の人の編集・削除を反映する（#134）
  gcTime: 0,
  // 取得のたびの isFetching の切り替えでは描き直さない（2秒ごとの無駄な描画を避ける）。画面とテストが使う値だけ通知する
  notifyOnChangeProps: NOTIFY_PROPS,
  refetchInterval: (query: { state: { error: unknown } }) =>
    isApiError(query.state.error) &&
    STOP_POLLING_STATUSES.includes(query.state.error.status)
      ? false
      : MESSAGE_POLL_INTERVAL_MS,
};

/** 非表示だったタブが表示に戻ったら、次の間隔を待たずに取り直す（外部のイベントとの同期）。取得中なら重ねない */
export function useRefetchWhenVisible(queryKey: QueryKey) {
  const queryClient = useQueryClient();
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
        { queryKey, type: "active" },
        { cancelRefetch: false },
      );
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () =>
      document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, [queryClient, queryKey]);
}
