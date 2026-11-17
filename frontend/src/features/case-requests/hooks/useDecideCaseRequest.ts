// 申請の承認・却下（S-29）。再認証は挟まない（C-81）。
// 成功しても失敗（すでに処理されていた・前提が崩れていた等）しても、申請の一覧を取り直す。
// 承認の成功では案件と参加者ができるため、案件（サイドバーの参加中の案件など）も取り直す。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { caseKeys } from "../../cases";
import { approveCaseRequest, rejectCaseRequest } from "../api/case-request-api";
import { caseRequestKeys } from "../api/query-keys";

export type DecideCaseRequestInput =
  | { kind: "approve"; requestId: string; additionalCandidateIds: string[] }
  | { kind: "reject"; requestId: string; reason: string };

export function useDecideCaseRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DecideCaseRequestInput): Promise<unknown> =>
      input.kind === "approve"
        ? approveCaseRequest(input.requestId, input.additionalCandidateIds)
        : rejectCaseRequest(input.requestId, input.reason),
    onSuccess: (_result, input) =>
      input.kind === "approve"
        ? queryClient.invalidateQueries({ queryKey: caseKeys.all })
        : undefined,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: caseRequestKeys.all }),
  });
}
