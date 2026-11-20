// 参加者の追加・削除（退出）と納期の変更（#147 の 147-B）、添付の公開範囲の変更（#148）。成功しても失敗しても、案件のキャッシュ（caseKeys.all）を取り直す
// （失敗は、ほかの人の操作で状態が変わったことによる場合があるため）。
import {
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type QueryFilters,
} from "@tanstack/react-query";
import type { PublicationVisibility } from "../../../../../shared/attachment-rules";
import { caseRequestKeys } from "../../case-requests/form-parts";
import { messageKeys } from "../../messages";
import {
  addCaseParticipant,
  changeAttachmentVisibility,
  changeCaseDueDate,
  closeCase,
  editCase,
  removeCaseParticipant,
  reopenCase,
  type CaseEditBody,
  type CasePage,
  type CaseReopenBody,
  type CaseSummary,
} from "../api/case-api";
import { CASE_KEY_USER_ID_INDEX, caseKeys } from "../api/query-keys";

export function useAddCaseParticipant(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => addCaseParticipant(caseId, userId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: caseKeys.all }),
  });
}

/** TODO の削除済みの一覧（exact）と履歴（TODO ごとのキーなので案件までの前方一致。ほかの案件の分は残す）。149-C */
function todoHistoryFilters(userId: string, caseId: string): QueryFilters[] {
  return [
    { queryKey: caseKeys.deletedTodos(userId, caseId), exact: true },
    { queryKey: caseKeys.caseTodoEvents(userId, caseId) },
  ];
}

/**
 * 参加者でなくなった後（部品が外れた後）に、TODO の履歴・削除済みの一覧のキャッシュを取り除く（149-C）。
 * 片付けと、概要の更新が画面に届くまでの間に、開いていた履歴・削除済みの一覧の部品が描き直されると、取り除いたキーが作り直されうるため
 */
export function forgetTodoHistory(
  queryClient: QueryClient,
  userId: string,
  caseId: string,
): void {
  for (const filters of todoHistoryFilters(userId, caseId))
    queryClient.removeQueries(filters);
}

/**
 * 閲覧の資格を失った（または確かめられない）案件の中身のキャッシュを取り除く（進行中の取得も取り消す）：詳細・TODO・添付の一覧（外された人にファイル名を残さない）・TODO の履歴・削除済みの TODOと、
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
    caseKeys.attachments(userId, caseId),
  ].map((queryKey) => ({ queryKey, exact: true }));
  const roomFilters: QueryFilters[] =
    roomId === null
      ? []
      : [
          { queryKey: messageKeys.room(roomId) },
          { queryKey: ["messages", "thread"] },
        ];
  const cancelled = [
    ...exactKeys,
    ...todoHistoryFilters(userId, caseId),
    ...roomFilters,
  ].map((filters) => {
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
            ...asOutsider(previous),
            participantCount: previous.canManage
              ? previous.participantCount
              : null,
            canEditDueDate: previous.canManage && previous.canEditDueDate,
          },
  );
  const listsCancelled = forgetCaseInLists(queryClient, userId, caseId);
  const removed = forgetCaseContent(queryClient, userId, caseId, roomId);
  const invalidated = queryClient.invalidateQueries({
    queryKey: caseKeys.all,
    refetchType: "none",
  });
  return Promise.all([listsCancelled, removed, invalidated]).then(
    () => undefined,
  );
}

/** サーバーが非参加者に返す形に合わせ、参加者だけの値（最終更新・部屋の ID）を消す */
function asOutsider(item: CaseSummary): CaseSummary {
  return {
    ...item,
    isParticipant: false,
    lastActivityAt: null,
    channelId: null,
  };
}

/**
 * その利用者の一覧のキャッシュから、資格を失った案件の参加者だけの値を、同期で消す：「参加中」の一覧（サイドバーも同じ一覧）からは行を除き、
 * 「すべての案件」の一覧では非参加の形にする。進行中の取得は先に取り消す（後から古い行を書き戻させないため）。取り直しは古い印に任せる
 */
function forgetCaseInLists(
  queryClient: QueryClient,
  userId: string,
  caseId: string,
): Promise<void> {
  const filters: QueryFilters = { queryKey: ["cases", "list", userId] };
  // まだデータのない一覧は、取り消すと読み込み中のまま止まるので、表示中なら取り直す（取り消した古い応答は書き戻されない）
  const cancelling = queryClient.cancelQueries(filters).then(() =>
    queryClient.refetchQueries({
      ...filters,
      predicate: (query) =>
        query.state.data === undefined && query.getObserversCount() > 0,
    }),
  );
  for (const [queryKey] of queryClient.getQueriesData(filters)) {
    const joined = queryKey[CASE_KEY_USER_ID_INDEX + 1] === "joined";
    queryClient.setQueryData<InfiniteData<CasePage>>(queryKey, (previous) =>
      previous === undefined
        ? undefined
        : {
            ...previous,
            pages: previous.pages.map((page) => ({
              ...page,
              items: joined
                ? page.items.filter((item) => item.id !== caseId)
                : page.items.map((item) =>
                    item.id === caseId ? asOutsider(item) : item,
                  ),
            })),
          },
    );
  }
  return cancelling;
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
 * 案件の内容の編集（#150 の 150-C）。成功しても失敗しても案件を取り直す。成功したら、件名・取引先が変わりうるので、
 * 類似件名の確認など申請のキャッシュも取り直す
 */
export function useEditCase(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CaseEditBody) => editCase(caseId, body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: caseRequestKeys.all }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: caseKeys.all }),
  });
}

/** 添付の公開範囲の変更。1行を書き換えず取り直す（一覧のページと続きの位置を崩さない） */
export function useChangeAttachmentVisibility() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      attachmentId: string;
      publicationVisibility: PublicationVisibility;
    }) =>
      changeAttachmentVisibility(
        input.attachmentId,
        input.publicationVisibility,
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: caseKeys.all }),
  });
}

/**
 * 終了・再開（再開は参加者の選び直しの本文つき）。成功しても失敗しても、案件と、その案件の部屋のメッセージ・開いているスレッドを取り直す。
 * スレッドの返信の可否は返信のキャッシュで決まるため、ポーリングを待たずに切り替える（スレッドのキーは部屋で絞れないので前方一致）
 */
export function useCaseStatusChange(caseId: string, roomId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      change: { to: "close" } | { to: "reopen"; body: CaseReopenBody },
    ) =>
      change.to === "close"
        ? closeCase(caseId)
        : reopenCase(caseId, change.body),
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
