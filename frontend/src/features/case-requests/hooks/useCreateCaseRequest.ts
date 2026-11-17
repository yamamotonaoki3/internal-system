// 案件の作成を申請する。成功したら、自分の申請を取り直す（再読込なしで一覧に出る）。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createCaseRequest,
  type CreateCaseRequestInput,
} from "../api/case-request-api";
import { caseRequestKeys } from "../api/query-keys";

export function useCreateCaseRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCaseRequestInput) => createCaseRequest(input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: caseRequestKeys.all }),
  });
}
