// TODO の変更履歴の取得（#149 の 149-C。EP-5-24）。行の「履歴」を開いている間だけ取り、2秒ごとに取り直す（5-4 AC-7。閉じたら取らない）。
// 取り直しは、取得済みのページを先頭から全部取り直す（useCaseTodos と同じ）。
import { useInfiniteQuery } from "@tanstack/react-query";
import { useSignedInUserId } from "../../auth";
import { fetchCaseTodoEvents } from "../api/case-todo-api";
import { caseKeys } from "../api/query-keys";
import { todoRefetchInterval } from "./useCaseTodos";

export function useCaseTodoEvents(
  caseId: string,
  todoId: string,
  open: boolean,
) {
  const userId = useSignedInUserId();
  return useInfiniteQuery({
    queryKey: caseKeys.todoEvents(userId ?? "", caseId, todoId),
    enabled: userId !== undefined && open,
    queryFn: ({ pageParam }) => fetchCaseTodoEvents(caseId, todoId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
    refetchInterval: todoRefetchInterval,
  });
}
