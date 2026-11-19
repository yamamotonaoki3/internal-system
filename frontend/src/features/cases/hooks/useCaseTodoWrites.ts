// TODO の追加・完了・完了の取り消し・編集・削除（#149）。成功しても失敗しても、案件のキャッシュ（caseKeys.all。TODO の一覧を含む）を取り直す
// （失敗は、ほかの人の操作で状態が変わったことによる場合があるため。147-B と同じ）。
// どの書き込みにも案件ごとの mutationKey を付け、送信中かどうかを区画で1つにまとめる（useCaseTodoBusy）。
import {
  useIsMutating,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  addCaseTodo,
  deleteCaseTodo,
  editCaseTodo,
  setCaseTodoCompleted,
  type CaseTodoEdit,
} from "../api/case-todo-api";
import { caseKeys } from "../api/query-keys";

const todoWriteKey = (caseId: string) => ["caseTodoWrite", caseId] as const;

/** この案件の TODO の書き込みのどれかが送信中か（送信中は区画のすべての操作を止める） */
export function useCaseTodoBusy(caseId: string): boolean {
  return useIsMutating({ mutationKey: todoWriteKey(caseId) }) > 0;
}

export function useAddCaseTodo(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: todoWriteKey(caseId),
    mutationFn: (input: { title: string; assigneeUserId: string | null }) =>
      addCaseTodo(caseId, input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: caseKeys.all }),
  });
}

/** onError は定義の側で受ける：呼び出しごとの onError は、後から別の操作をすると呼ばれず、先の失敗が失われるため */
export function useSetCaseTodoCompleted(
  caseId: string,
  onError: (cause: unknown) => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: todoWriteKey(caseId),
    onError,
    mutationFn: (input: { todoId: string; completed: boolean }) =>
      setCaseTodoCompleted(caseId, input.todoId, input.completed),
    onSettled: () => queryClient.invalidateQueries({ queryKey: caseKeys.all }),
  });
}

/** 編集。onError は定義の側（取り直しの完了を待たずに、失敗を画面に出すため） */
export function useEditCaseTodo(
  caseId: string,
  onError: (cause: unknown) => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: todoWriteKey(caseId),
    onError,
    mutationFn: (input: { todoId: string; body: CaseTodoEdit }) =>
      editCaseTodo(caseId, input.todoId, input.body),
    onSettled: () => queryClient.invalidateQueries({ queryKey: caseKeys.all }),
  });
}

export function useDeleteCaseTodo(
  caseId: string,
  onError: (cause: unknown) => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: todoWriteKey(caseId),
    onError,
    mutationFn: (todoId: string) => deleteCaseTodo(caseId, todoId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: caseKeys.all }),
  });
}
