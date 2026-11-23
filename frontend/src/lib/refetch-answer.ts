// 取り直しの通信が、実際に答えを返したかを見分ける（#298・#376）。
// Query の更新の回数だけでは見分けられない：手での書き換え（setQueryData）も成功の回数を増やし、取り消しの revert はその書き換えを戻り先に残すため。
// そこで、取り直しの間に、その Query に届いた更新の種類を見る：取得の成功（manual でない success）・取得の失敗（error）・手での書き換え（manual の success）。
// 手での書き換えが混ざった・取得の答えが1つに決まらないときは、どれがこの取り直しの答えか分からないので「答えなし」にする（呼び出し側が安全な側に倒す）。
import type { QueryClient } from "@tanstack/react-query";

export type RefetchAnswer<TData> =
  | { kind: "data"; data: TData | undefined }
  | { kind: "error"; error: unknown }
  | { kind: "none" };

export async function refetchAnswerOf<TData>(
  queryClient: QueryClient,
  /** 見る Query（getQueryCache().find・build の結果。同じものかだけを比べる） */
  query: object,
  refetch: () => Promise<unknown>,
): Promise<RefetchAnswer<TData>> {
  const fetched: TData[] = [];
  const failures: unknown[] = [];
  let written = false;
  const stop = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.query !== query) return;
    const { action } = event;
    if (action.type === "success") {
      if (action.manual === true) written = true;
      else fetched.push(action.data as TData);
    } else if (action.type === "error") failures.push(action.error);
  });
  try {
    await refetch();
  } finally {
    stop();
  }
  if (written) return { kind: "none" };
  if (fetched.length === 1 && failures.length === 0)
    return { kind: "data", data: fetched[0] };
  if (failures.length === 1 && fetched.length === 0)
    return { kind: "error", error: failures[0] };
  return { kind: "none" };
}
