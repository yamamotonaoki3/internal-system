// DM の一覧（カーソルで続きを取る）。開いたとき・フォーカスしたときに取り直す。
import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchDms, type DmListItem } from "../api/dm-api";
import { dmKeys } from "../api/query-keys";

export function useDms() {
  return useInfiniteQuery({
    queryKey: dmKeys.list,
    queryFn: ({ pageParam }) => fetchDms(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
}

/** ページをまたいで重なった DM（最終活動順のカーソルで起こりうる）を、roomId で1つにまとめる */
export function uniqueDms(
  pages: readonly { items: readonly DmListItem[] }[] | undefined,
): DmListItem[] {
  const seen = new Set<string>();
  const result: DmListItem[] = [];
  for (const item of pages?.flatMap((page) => page.items) ?? []) {
    if (seen.has(item.roomId)) continue;
    seen.add(item.roomId);
    result.push(item);
  }
  return result;
}
