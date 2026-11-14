// 自分が関わるスレッドの一覧（S-35）。カーソルで続きを取り、2秒ごとに、読み込み済みのすべてのページを先頭から取り直す（未読の件数・並びの変化が再読み込みなしで反映される）。
// 読み込むのは先頭から THREAD_LIST_MAX_PAGES ページまで。maxPages で古いページを捨てない：捨てると、取り直しが途中のカーソルから始まり、
// 返信で先頭へ動いたスレッドが表示から抜ける。取り直しの通信は、読み込み済みのページ数で頭打ちになる。
// 一覧は画面を離れたら捨てる（開き直したら先頭から）。
import { useInfiniteQuery } from "@tanstack/react-query";
import { pollIntervalUnlessDenied } from "../../unread";
import { threadKeys } from "../api/query-keys";
import { fetchMyThreads } from "../api/thread-api";

/** 1ページの件数。サーバーの既定（limit を付けない） */
const THREAD_LIST_PAGE_SIZE = 20;
/** 一覧に読み込むページ数の上限 */
export const THREAD_LIST_MAX_PAGES = 5;
/** 一覧に出す件数の上限（案内の文に使う） */
export const THREAD_LIST_MAX_ITEMS =
  THREAD_LIST_PAGE_SIZE * THREAD_LIST_MAX_PAGES;

export function useMyThreads() {
  return useInfiniteQuery({
    queryKey: threadKeys.list,
    queryFn: ({ pageParam }) => fetchMyThreads(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last, pages) =>
      pages.length >= THREAD_LIST_MAX_PAGES
        ? undefined
        : (last.nextCursor ?? undefined),
    retry: false,
    gcTime: 0,
    refetchInterval: (query) => pollIntervalUnlessDenied(query.state.error),
  });
}
