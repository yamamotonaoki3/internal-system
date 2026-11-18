// 案件の TODO の一覧の取得と、2秒ごとの取り直し（1-9 AC-2・5-4 AC-7。C-145）。間隔はメッセージと同じ定め（1-9）なので同じ値を使う。
// 1ページ 100 件。取り直しは、取得済みのページを先頭から全部取り直す（完了・題名・担当の変化を反映するため。計画 6.9(6)）。
// 権限・存在の問題（401・403・404）は待っても直らないので、取り直しを止める。
import { useInfiniteQuery } from "@tanstack/react-query";
import { useSignedInUserId } from "../../auth";
import { MESSAGE_POLL_INTERVAL_MS } from "../../messages";
import { fetchCaseTodos } from "../api/case-todo-api";
import { caseKeys } from "../api/query-keys";
import { isApiError } from "../describe-error";

const STOP_POLLING_STATUSES: readonly number[] = [401, 403, 404];

/** 有効な参加者で、詳細が取れたときだけ取る */
export function useCaseTodos(caseId: string, enabled: boolean) {
  const userId = useSignedInUserId();
  return useInfiniteQuery({
    queryKey: caseKeys.todos(userId ?? "", caseId),
    enabled: userId !== undefined && enabled,
    queryFn: ({ pageParam }) => fetchCaseTodos(caseId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
    refetchInterval: (query) =>
      isApiError(query.state.error) &&
      STOP_POLLING_STATUSES.includes(query.state.error.status)
        ? false
        : MESSAGE_POLL_INTERVAL_MS,
  });
}
