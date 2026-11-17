// 申請を取り下げる。成功しても失敗（すでに処理されていた等）しても、自分の申請を取り直す。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { withdrawCaseRequest } from "../api/case-request-api";
import { caseRequestKeys } from "../api/query-keys";

export function useWithdrawCaseRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => withdrawCaseRequest(requestId),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: caseRequestKeys.all }),
  });
}
