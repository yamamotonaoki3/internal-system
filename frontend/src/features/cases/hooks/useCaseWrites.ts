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
import { channelKeys } from "../../channels";
import { messageKeys } from "../../messages";
import { searchKeys } from "../../search/keys";
import { threadKeys } from "../../threads";
import { unreadKeys } from "../../unread";
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
  type CaseDetail,
  type CaseReopenBody,
  type CaseSummary,
} from "../api/case-api";
import {
  CASE_KEY_USER_ID_INDEX,
  caseKeys,
  caseMutationKeys,
} from "../api/query-keys";

export function useAddCaseParticipant(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: caseMutationKeys.write(caseId),
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

/** 自分のスレッドの一覧の行（親の本文を含む）。ここでは部屋の ID だけを見る */
type ThreadListData = InfiniteData<{ items: { room: { id: string } }[] }>;

/** 自分のスレッドの一覧から、その部屋の行だけを除く（別の部屋の行は残す） */
function stripThreadRows(queryClient: QueryClient, roomId: string): void {
  queryClient.setQueryData<ThreadListData>(threadKeys.list, (previous) =>
    previous === undefined
      ? undefined
      : {
          ...previous,
          pages: previous.pages.map((page) => ({
            ...page,
            items: page.items.filter((item) => item.room.id !== roomId),
          })),
        },
  );
}

/** 未読の件数から、その部屋の分だけを除く（ほかの部屋の件数は残す） */
function stripUnreadCount(queryClient: QueryClient, roomId: string): void {
  queryClient.setQueryData<ReadonlyMap<string, number>>(
    unreadKeys.counts,
    (previous) => {
      if (previous === undefined || !previous.has(roomId)) return previous;
      const counts = new Map(previous);
      counts.delete(roomId);
      return counts;
    },
  );
}

/**
 * この案件の、完了した操作を MutationCache から取り除く（応答・変数に、TODO の題名・担当者の名前・説明などを含むため）。
 * 進行中の操作は取り消さず残す（ADR-0030）。ほかの案件の操作は残す
 */
function forgetSettledMutations(queryClient: QueryClient, caseId: string) {
  const mutationCache = queryClient.getMutationCache();
  const pending = new Set<unknown>();
  for (const mutationKey of [
    caseMutationKeys.todoWrite(caseId),
    caseMutationKeys.write(caseId),
  ])
    for (const mutation of mutationCache.findAll({ mutationKey }))
      if (mutation.state.status === "pending") pending.add(mutation);
      else mutationCache.remove(mutation);
  if (pending.size === 0) return;
  // 進行中だった操作は、完了した時点で（後処理が走った後に）取り除く。対象がなくなったら購読を終える
  const unsubscribe = mutationCache.subscribe((event) => {
    if (event.type !== "updated" && event.type !== "removed") return;
    const { mutation } = event;
    if (!pending.has(mutation)) return;
    if (event.type === "updated") {
      if (mutation.state.status === "pending") return;
      mutationCache.remove(mutation);
    }
    pending.delete(mutation);
    if (pending.size === 0) unsubscribe();
  });
}

/**
 * 閲覧の資格を失った（または確かめられない）案件の中身のキャッシュを取り除く（進行中の取得も取り消す）：
 * 詳細・TODO・添付の一覧（外された人にファイル名を残さない）・TODO の履歴・削除済みの TODO と、この案件の完了した操作（MutationCache）。
 * 部屋が分かっていれば、その部屋のメッセージ・スレッド（threads の説明を参照）・
 * メンションの候補とチャンネルの詳細（どちらも部屋の参加者の名前）も取り除き、自分のスレッドの一覧（親の本文）と未読の件数からは、その部屋の分だけを除く。
 * 開き直したとき、再取得の応答を待つ間に前の説明・参加者・やり取りを出さないため（コードレビュー1回目の重大1・#308 AC-2・#323）
 */
export function forgetCaseContent(
  queryClient: QueryClient,
  userId: string,
  caseId: string,
  roomId: string | null = null,
  /**
   * スレッドの取り除き方。"all"（表示中から呼ぶとき）：キーで部屋を絞れないので前方一致ですべて（データのない、取得の途中のものも）。
   * "room"（画面を離れた後）：移動先のスレッドを巻き込まないため、データ（親のメッセージ）の部屋がこの部屋のものだけ
   */
  threads: "all" | "room" = "all",
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
          threads === "all"
            ? { queryKey: ["messages", "thread"] }
            : {
                queryKey: ["messages", "thread"],
                predicate: (query) =>
                  (
                    query.state.data as
                      { parent?: { roomId?: unknown } } | undefined
                  )?.parent?.roomId === roomId,
              },
          // 入力の文字ごとのキーなので、部屋までの前方一致
          { queryKey: messageKeys.roomMentionCandidates(roomId) },
          { queryKey: channelKeys.detail(roomId), exact: true },
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
  cancelled.push(forgetSearchResults(queryClient, userId));
  forgetSettledMutations(queryClient, caseId);
  if (roomId === null) return Promise.all(cancelled).then(() => undefined);
  stripUnreadCount(queryClient, roomId);
  // スレッドの一覧は、ほかの部屋の行を残すため取り除かない。取得の途中なら取り消す（後から届いた応答で、この部屋の行を書き戻させない）
  const threadsCancelled = queryClient
    .cancelQueries({ queryKey: threadKeys.list, exact: true })
    .then(() => stripThreadRows(queryClient, roomId));
  stripThreadRows(queryClient, roomId);
  return Promise.all([...cancelled, threadsCancelled]).then(() => undefined);
}

/** キャッシュにある、この案件の部屋の ID（詳細、なければ概要から）。退出の後片付けで詳細が先に消えるので、その前に求めておく */
export function cachedCaseRoomId(
  queryClient: QueryClient,
  userId: string,
  caseId: string,
): string | null {
  return (
    queryClient.getQueryData<CaseDetail>(caseKeys.detail(userId, caseId))
      ?.channelId ??
    queryClient.getQueryData<CaseSummary>(caseKeys.summary(userId, caseId))
      ?.channelId ??
    null
  );
}

/**
 * 検索の結果（#155）の片付け。どの案件の部屋の抜粋が入っているかをキーから決められないため、その利用者の分を全部対象にする。
 * removeQueries はキャッシュから外すだけで、表示中の画面（購読先）に知らせず、前の抜粋が描かれたまま残る。
 * そのため、表示していない分は取り除き、表示中の分は resetQueries でデータを消して購読先に知らせ、いまの資格で取り直す。
 * 取り直しの完了は待たない（取り消しの完了だけを待つ）
 */
function forgetSearchResults(
  queryClient: QueryClient,
  userId: string,
): Promise<void> {
  const filters = { queryKey: searchKeys.user(userId) };
  const cancelling = queryClient.cancelQueries(filters);
  queryClient.removeQueries({ ...filters, type: "inactive" });
  void queryClient.resetQueries(filters);
  return cancelling;
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
  threads: "all" | "room" = "all",
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
  const removed = forgetCaseContent(
    queryClient,
    userId,
    caseId,
    roomId,
    threads,
  );
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

/** その利用者の、案件の一覧（参加中・すべての案件、状態ごと）すべて */
function caseListFilters(userId: string): QueryFilters {
  return { queryKey: ["cases", "list", userId] };
}

/**
 * その利用者の案件の一覧に、古い印だけを付ける（行は書き換えず、進行中の取得も取り消さない）。
 * 表示中の一覧は取り直され、表示していない一覧は次に開いたときに取り直される
 */
export function invalidateCaseLists(
  queryClient: QueryClient,
  userId: string,
): Promise<void> {
  // 進行中の取得は取り消さず、その結果を待つ（cancelRefetch: false）
  return queryClient.invalidateQueries(caseListFilters(userId), {
    cancelRefetch: false,
  });
}

/**
 * その利用者の一覧のキャッシュから、資格を失った案件の参加者だけの値を、同期で消す：「参加中」の一覧（サイドバーも同じ一覧）からは行を除き、
 * 「すべての案件」の一覧では非参加の形にする。進行中の取得は先に取り消す（後から古い行を書き戻させないため）。取り直しは古い印に任せる
 */
export function forgetCaseInLists(
  queryClient: QueryClient,
  userId: string,
  caseId: string,
): Promise<void> {
  const filters = caseListFilters(userId);
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
    mutationKey: caseMutationKeys.write(caseId),
    mutationFn: (input: {
      userId: string;
      self: boolean;
      actorId: string;
      /** 退出の前に求めた部屋の ID（cachedCaseRoomId）。部屋のキャッシュも片付ける */
      roomId: string | null;
    }) => removeCaseParticipant(caseId, input.userId),
    onSuccess: (_data, input) =>
      input.self
        ? forgetCaseAfterLeave(queryClient, input.actorId, caseId, input.roomId)
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
    mutationKey: caseMutationKeys.write(caseId),
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
    mutationKey: caseMutationKeys.write(caseId),
    mutationFn: (body: CaseEditBody) => editCase(caseId, body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: caseRequestKeys.all }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: caseKeys.all }),
  });
}

/** 添付の公開範囲の変更。1行を書き換えず取り直す（一覧のページと続きの位置を崩さない） */
export function useChangeAttachmentVisibility(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: caseMutationKeys.write(caseId),
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
    mutationKey: caseMutationKeys.write(caseId),
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
