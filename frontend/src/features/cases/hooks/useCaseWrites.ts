// 参加者の追加・削除（退出）と納期の変更（#147 の 147-B）。成功しても失敗しても、案件のキャッシュ（caseKeys.all）を取り直す
// （失敗は、ほかの人の操作で状態が変わったことによる場合があるため）。
import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  addCaseParticipant,
  changeCaseDueDate,
  removeCaseParticipant,
  type CaseSummary,
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
 * 退出の後に、閲覧の資格を失った案件のキャッシュを片付ける：詳細と TODO の一覧を取り除き（進行中の取得も取り消す）、概要を非参加に書き換え、
 * ほかには古い印だけを付ける。開き直したとき、再取得の応答を待つ間に前の説明・参加者を出さないため（コードレビュー1回目の重大1）。
 * 画面を離れた後（この案件を表示する部品がない状態）で呼ぶ：表示中に取り除くと、表示している部品が空の詳細を作り直し、印のない詳細が残るため
 */
export function forgetCaseAfterLeave(
  queryClient: QueryClient,
  userId: string,
  caseId: string,
): Promise<void> {
  // 印と取り除きは、この呼び出しの中で（同期に）済ませる。取り消しの完了・取り直しは待たない
  const cancelled = [
    caseKeys.detail(userId, caseId),
    caseKeys.todos(userId, caseId),
  ].map((queryKey) => {
    const cancelling = queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.removeQueries({ queryKey, exact: true });
    return cancelling;
  });
  queryClient.setQueryData<CaseSummary>(
    caseKeys.summary(userId, caseId),
    (previous) =>
      previous === undefined
        ? undefined
        : {
            ...previous,
            isParticipant: false,
            participantCount: previous.canManage
              ? previous.participantCount
              : null,
            canEditDueDate: previous.canManage && previous.canEditDueDate,
          },
  );
  const invalidated = queryClient.invalidateQueries({
    queryKey: caseKeys.all,
    refetchType: "none",
  });
  return Promise.all([...cancelled, invalidated]).then(() => undefined);
}

/**
 * 削除・本人の退出。退出に成功したら、画面が生きているかに依らず、ここ（定義の側）で forgetCaseAfterLeave を行う
 * （応答の前に画面を離れると、mutate に渡した onSuccess は呼ばれないため。コードレビュー2回目）。対象は、操作したときの利用者（actorId）と案件。
 * 画面が表示中なら、概要が非参加になって前の詳細は出ず、画面が外れるときに useParticipantWrites がもう一度片付ける。失敗したときは消さない
 */
export function useRemoveCaseParticipant(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; self: boolean; actorId: string }) =>
      removeCaseParticipant(caseId, input.userId),
    onSuccess: (_data, input) =>
      input.self
        ? forgetCaseAfterLeave(queryClient, input.actorId, caseId)
        : undefined,
    onSettled: (_data, error, input) =>
      error === null && input.self
        ? undefined
        : queryClient.invalidateQueries({ queryKey: caseKeys.all }),
  });
}

export function useChangeCaseDueDate(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dueDate: string | null) => changeCaseDueDate(caseId, dueDate),
    onSettled: () => queryClient.invalidateQueries({ queryKey: caseKeys.all }),
  });
}
