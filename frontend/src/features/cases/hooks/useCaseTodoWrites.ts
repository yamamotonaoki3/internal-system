// TODO の追加・完了・完了の取り消し（#149）。成功しても失敗しても、案件のキャッシュ（caseKeys.all。TODO の一覧を含む）を取り直す
// （失敗は、ほかの人の操作で状態が変わったことによる場合があるため。147-B と同じ）。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addCaseTodo, setCaseTodoCompleted } from "../api/case-todo-api";
import { caseKeys } from "../api/query-keys";

export function useAddCaseTodo(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; assigneeUserId: string | null }) =>
      addCaseTodo(caseId, input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: caseKeys.all }),
  });
}

export function useSetCaseTodoCompleted(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { todoId: string; completed: boolean }) =>
      setCaseTodoCompleted(caseId, input.todoId, input.completed),
    onSettled: () => queryClient.invalidateQueries({ queryKey: caseKeys.all }),
  });
}
