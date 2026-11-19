// 参加者の追加・削除（退出）と納期の変更（#147 の 147-B）。成功しても失敗しても、案件のキャッシュ（caseKeys.all）を取り直す
// （失敗は、ほかの人の操作で状態が変わったことによる場合があるため）。
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryFilters,
} from "@tanstack/react-query";
import { messageKeys } from "../../messages";
import {
  addCaseParticipant,
  changeCaseDueDate,
  closeCase,
  removeCaseParticipant,
  reopenCase,
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
 * 閲覧の資格を失った（または確かめられない）案件の中身のキャッシュを取り除く（進行中の取得も取り消す）：詳細・TODO の一覧と、
 * 部屋が分かっていれば、その部屋のメッセージとスレッド（スレッドのキーは部屋で絞れないので前方一致。表示中のものしか残らない）。
 * 開き直したとき、再取得の応答を待つ間に前の説明・参加者・やり取りを出さないため（コードレビュー1回目の重大1・#308 AC-2）
 */
export function forgetCaseContent(
  queryClient: QueryClient,
  userId: string,
  caseId: string,
  roomId: string | null = null,
): Promise<void> {
  // 取り除きは、この呼び出しの中で（同期に）済ませる。取り消しの完了は待たない
  const exactKeys: QueryFilters[] = [
    caseKeys.detail(userId, caseId),
    caseKeys.todos(userId, caseId),
  ].map((queryKey) => ({ queryKey, exact: true }));
  const roomFilters: QueryFilters[] =
    roomId === null
      ? []
      : [
          { queryKey: messageKeys.room(roomId) },
          { queryKey: ["messages", "thread"] },
        ];
  const cancelled = [...exactKeys, ...roomFilters].map((filters) => {
    const cancelling = queryClient.cancelQueries(filters);
    queryClient.removeQueries(filters);
    return cancelling;
  });
  return Promise.all(cancelled).then(() => undefined);
}

/**
 * 閲覧の資格を失った案件のキャッシュを片付ける：概要を非参加に書き換えてから、中身を取り除き（forgetCaseContent）、ほかには古い印だけを付ける。
 * 本人の退出（画面を離れた後に呼ぶ）と、表示中に外されたことを見つけたとき（#308。useCaseAccessLoss）の両方が使う。
 * 概要の書き換えを先にする：表示中でも、表示の部品が非参加の概要で描き、詳細を取りにいかない（空の入れ物は作られうるが、データはない）
 */
export function forgetCaseAfterLeave(
  queryClient: QueryClient,
  userId: string,
  caseId: string,
  roomId: string | null = null,
): Promise<void> {
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
  const removed = forgetCaseContent(queryClient, userId, caseId, roomId);
  const invalidated = queryClient.invalidateQueries({
    queryKey: caseKeys.all,
    refetchType: "none",
  });
  return Promise.all([removed, invalidated]).then(() => undefined);
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

/**
 * 終了・再開。成功しても失敗しても、案件と、その案件の部屋のメッセージ・開いているスレッドを取り直す。
 * スレッドの返信の可否は返信のキャッシュで決まるため、ポーリングを待たずに切り替える（スレッドのキーは部屋で絞れないので前方一致）
 */
export function useCaseStatusChange(caseId: string, roomId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (to: "close" | "reopen") =>
      to === "close" ? closeCase(caseId) : reopenCase(caseId),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: caseKeys.all }),
        ...(roomId === null
          ? []
          : [
              queryClient.invalidateQueries({
                queryKey: messageKeys.room(roomId),
              }),
            ]),
        queryClient.invalidateQueries({
          queryKey: ["messages", "thread"],
        }),
      ]),
  });
}
