// 削除済みの TODO の一覧の取得（#149 の 149-C。EP-5-25）。「削除済みのTODO」を開いている間だけ取り、2秒ごとに取り直す（閉じたら取らない）。
import { useInfiniteQuery } from "@tanstack/react-query";
import { useSignedInUserId } from "../../auth";
import { fetchDeletedCaseTodos } from "../api/case-todo-api";
import { caseKeys } from "../api/query-keys";
import { todoRefetchInterval } from "./useCaseTodos";

export function useDeletedCaseTodos(caseId: string, open: boolean) {
  const userId = useSignedInUserId();
  return useInfiniteQuery({
    queryKey: caseKeys.deletedTodos(userId ?? "", caseId),
    enabled: userId !== undefined && open,
    queryFn: ({ pageParam }) => fetchDeletedCaseTodos(caseId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
    refetchInterval: todoRefetchInterval,
  });
}
