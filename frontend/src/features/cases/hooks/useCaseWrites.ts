// 参加者の追加・削除（退出）と納期の変更（#147 の 147-B）。成功しても失敗しても、案件のキャッシュ（caseKeys.all）を取り直す
// （失敗は、ほかの人の操作で状態が変わったことによる場合があるため）。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  addCaseParticipant,
  changeCaseDueDate,
  removeCaseParticipant,
} from "../api/case-api";
import { caseKeys } from "../api/query-keys";

export function useAddCaseParticipant(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => addCaseParticipant(caseId, userId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: caseKeys.all }),
  });
}

/**
 * 削除・本人の退出。退出に成功したときは、この画面を離れる（S-16 へ移る）ため、古くなった印だけを付けて、
 * 見えなくなった案件の取り直しをこの画面ではしない（移った先で新しく取る）
 */
export function useRemoveCaseParticipant(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; self: boolean }) =>
      removeCaseParticipant(caseId, input.userId),
    onSettled: (_data, error, input) =>
      queryClient.invalidateQueries({
        queryKey: caseKeys.all,
        refetchType: error === null && input.self ? "none" : "active",
      }),
  });
}

export function useChangeCaseDueDate(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dueDate: string | null) => changeCaseDueDate(caseId, dueDate),
    onSettled: () => queryClient.invalidateQueries({ queryKey: caseKeys.all }),
  });
}
