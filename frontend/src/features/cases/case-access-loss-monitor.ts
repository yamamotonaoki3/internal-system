// 案件の画面（S-17）の外での、資格の喪失の見張り（#339。C-210）。Query の出来事を受ける購読は、QueryClient ごとにこの1つだけ。
// きっかけは3つ：取得済みの返信の 403・404／取得済みの部屋の 403・404／スレッド一覧の行の消失（行の消失だけでは確定しない）。
// 同じ利用者・案件の S-17（useCaseAccessLoss）が担当を登録していれば、きっかけをその担当へ渡し、ここでは確かめ・片付け・入口・合図・下書きの消去をしない
// （同じ出来事を2つの購読で受けて、後から打ち消し合う形にしないため）。担当が無ければ、概要を直接1回取って確かめ、画面の外の確定をする。
// 初回の概要（概要を一度も取得していない画面が、初回に非参加・404 を受ける場合）は、S-17 のフックが扱う（ここでは概要を確かめない）。
// 保つのは、担当・進行中の確かめ・合図を送った印・行の比較の元（{ parentId, caseId, roomId } だけ）。取得の実績は、その場のキャッシュから読む。
import type {
  Query,
  QueryCacheNotifyEvent,
  QueryClient,
} from "@tanstack/react-query";
import {
  announceCaseAccessLoss,
  requestAccessLossReload,
} from "../access-loss";
import { threadKeys } from "../threads";
import {
  caseIdOfRoom,
  isCleanupWrite,
  repliesCaseRoom,
  sessionUserId,
  threadListRows,
  type ThreadListRow,
} from "./case-access-evidence";
import {
  verifyBySummaryFetch,
  type CaseAccessVerdict,
} from "./case-access-verification";
import { isApiError } from "./describe-error";
import {
  forgetCaseAfterLeave,
  forgetCaseContent,
  forgetCaseRoomDraftsAfterLoss,
} from "./hooks/useCaseWrites";

const ACCESS_LOSS_STATUSES: readonly number[] = [403, 404];
/** S-17 が見ていた、案件ごとの中身のキーの種類（["cases", 種類, 利用者, 案件, …]） */
const CASE_CONTENT_KINDS: readonly unknown[] = [
  "todos",
  "attachments",
  "deletedTodos",
  "todoEvents",
];

/** S-17 の担当。拒否のきっかけを受けて、S-17 の確かめ（概要の取り直し）を始める */
export type CaseAccessLossHandler = {
  userId: string;
  caseId: string;
  /** S-17 が表示している案件の部屋（分からなければ null） */
  roomId: string | null;
  onDenied: () => void;
};

/** 画面の外の確かめのきっかけ。content：返信・部屋の拒否／list：スレッド一覧の行の消失 */
type Candidate = {
  userId: string;
  caseId: string;
  roomId: string | null;
  route: "content" | "list";
};

type MonitorState = {
  handlers: Set<CaseAccessLossHandler>;
  /** 進行中の確かめ（利用者・案件ごと。持ち主は始めた側〔S-17 か、この見張り〕で、終わるまで外さない） */
  verifying: Set<string>;
  /** 確定した喪失を、ほかのタブへ知らせた印（利用者・案件ごと。参加者に戻ったと分かったときだけ外す） */
  announced: Set<string>;
  installs: number;
  stop: (() => void) | null;
};

const states = new WeakMap<QueryClient, MonitorState>();

function stateOf(queryClient: QueryClient): MonitorState {
  let state = states.get(queryClient);
  if (state === undefined) {
    state = {
      handlers: new Set(),
      verifying: new Set(),
      announced: new Set(),
      installs: 0,
      stop: null,
    };
    states.set(queryClient, state);
  }
  return state;
}

const markOf = (userId: string, caseId: string) =>
  JSON.stringify([userId, caseId]);

/** S-17 の担当を登録する。返り値は解除の関数（画面を外したときに呼ぶ。始めた確かめは、解除の後も最後まで続く） */
export function registerCaseAccessLossHandler(
  queryClient: QueryClient,
  handler: CaseAccessLossHandler,
): () => void {
  const { handlers } = stateOf(queryClient);
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

/** 確かめを始める担当になる。同じ利用者・案件の確かめが進行中なら null（重ねない）。返り値は、終わったときに呼ぶ関数 */
export function claimCaseVerification(
  queryClient: QueryClient,
  userId: string,
  caseId: string,
): (() => void) | null {
  const { verifying } = stateOf(queryClient);
  const mark = markOf(userId, caseId);
  if (verifying.has(mark)) return null;
  verifying.add(mark);
  return () => {
    verifying.delete(mark);
  };
}

/** 確定した喪失を、ほかのタブへ1回だけ知らせる（読み込み直しの印とは別。入口の後・下書きの消去の前に呼ぶ。送る処理は投げない） */
export function announceCaseAccessLossOnce(
  queryClient: QueryClient,
  userId: string,
  caseId: string,
): void {
  const { announced } = stateOf(queryClient);
  const mark = markOf(userId, caseId);
  if (announced.has(mark)) return;
  announced.add(mark);
  announceCaseAccessLoss({ userId, caseId });
}

/** 参加者に戻ったと分かったとき：次の喪失を、また知らせられるようにする */
export function resetCaseAccessLossAnnouncement(
  queryClient: QueryClient,
  userId: string,
  caseId: string,
): void {
  stateOf(queryClient).announced.delete(markOf(userId, caseId));
}

/** 拒否のきっかけを受ける S-17 の担当（中身のキー・部屋・その案件の返信） */
function handlersFor(
  state: MonitorState,
  queryKey: readonly unknown[],
  data: unknown,
): CaseAccessLossHandler[] {
  const handlers = [...state.handlers];
  if (queryKey[0] === "cases" && CASE_CONTENT_KINDS.includes(queryKey[1]))
    return handlers.filter(
      (h) => h.userId === queryKey[2] && h.caseId === queryKey[3],
    );
  if (queryKey[0] !== "messages") return [];
  if (queryKey[1] === "room")
    return handlers.filter(
      (h) => h.roomId !== null && h.roomId === queryKey[2],
    );
  const replies = queryKey[1] === "thread" ? repliesCaseRoom(data) : null;
  return replies === null
    ? []
    : handlers.filter((h) => h.caseId === replies.caseId);
}

/** 画面の外で確かめる対象：成功のデータが残っている、案件の対応が分かる部屋・返信だけ（初回からの失敗・通常の部屋・DM は対象にしない） */
function outsideTarget(
  queryClient: QueryClient,
  userId: string,
  queryKey: readonly unknown[],
  data: unknown,
): { caseId: string; roomId: string } | null {
  if (queryKey[0] !== "messages" || data === undefined) return null;
  if (queryKey[1] === "thread") return repliesCaseRoom(data);
  if (queryKey[1] !== "room" || typeof queryKey[2] !== "string") return null;
  const caseId = caseIdOfRoom(queryClient, userId, queryKey[2]);
  return caseId === null ? null : { caseId, roomId: queryKey[2] };
}

/**
 * 画面の外の確定（計画 3 節の表）。スレッドは、別の部屋の表示中のものを巻き込まないよう、この部屋のものだけ（"room"）。
 * 順序は、片付け → 入口 → 合図 → 下書きの消去。部屋の ID は、片付けの前に決めておく（片付けで返信・詳細が消えるため）
 */
function settleOutside(
  queryClient: QueryClient,
  { userId, caseId, roomId, route }: Candidate,
  verdict: CaseAccessVerdict,
): void {
  // 利用者の切り替えは、切り替えの入口に任せる
  if (verdict === "switched") return;
  if (verdict === "participant") {
    resetCaseAccessLossAnnouncement(queryClient, userId, caseId);
    return;
  }
  // 行の消失から確かめられないときは、何もしない（次のきっかけを受けられる状態に戻る）
  if (verdict === "unverified" && route === "list") return;
  const reload = () =>
    void requestAccessLossReload(queryClient, {
      ownerId: userId,
      reason: "lost",
    });
  if (verdict === "unverified") {
    // 確かめられないまま、拒否を受けた中身を隠して読み込み直す。参加者のままかもしれないので、合図・下書きの消去はしない
    void forgetCaseContent(queryClient, userId, caseId, roomId, "room");
    reload();
    return;
  }
  if (verdict === "lost")
    void forgetCaseAfterLeave(queryClient, userId, caseId, roomId, "room");
  // 404 は、概要・案件一覧を非参加に書き換えない
  else void forgetCaseContent(queryClient, userId, caseId, roomId, "room");
  reload();
  announceCaseAccessLossOnce(queryClient, userId, caseId);
  forgetCaseRoomDraftsAfterLoss(userId, roomId);
}

async function verifyOutside(
  queryClient: QueryClient,
  candidate: Candidate,
): Promise<void> {
  const release = claimCaseVerification(
    queryClient,
    candidate.userId,
    candidate.caseId,
  );
  if (release === null) return;
  let verdict: CaseAccessVerdict;
  try {
    verdict = await verifyBySummaryFetch(candidate.caseId);
  } finally {
    release();
  }
  // 確かめの間に利用者が替わった・ログアウトした：古い答えを、いまの利用者のキャッシュ・下書きに作用させない
  if (sessionUserId(queryClient) !== candidate.userId) return;
  settleOutside(queryClient, candidate, verdict);
}

/** きっかけを、S-17 の担当へ渡すか、画面の外で確かめる */
function dispatchCandidate(
  queryClient: QueryClient,
  state: MonitorState,
  candidate: Candidate,
  handlers: CaseAccessLossHandler[],
): void {
  if (state.verifying.has(markOf(candidate.userId, candidate.caseId))) return;
  if (handlers.length > 0) {
    for (const handler of handlers) handler.onDenied();
    return;
  }
  verifyOutside(queryClient, candidate).catch((error: unknown) =>
    reportError(error),
  );
}

function rowsLost(
  before: ThreadListRow[],
  after: ThreadListRow[],
): Map<string, string> {
  const remaining = new Set(after.map((row) => row.parentId));
  // 案件ごとにまとめる（同じ案件の行が複数消えても、確かめは1回）。値は、その案件の部屋の ID
  const lost = new Map<string, string>();
  for (const row of before)
    if (row.caseId !== null && !remaining.has(row.parentId))
      lost.set(row.caseId, row.roomId);
  return lost;
}

/** 見張りを登録する。返り値は解除の関数。同じ QueryClient に何回呼んでも、購読は1つ（最後の解除で外れる） */
export function installCaseAccessLossMonitor(
  queryClient: QueryClient,
): () => void {
  const state = stateOf(queryClient);
  state.installs += 1;
  if (state.stop === null) state.stop = subscribe(queryClient, state);
  let uninstalled = false;
  return () => {
    if (uninstalled) return;
    uninstalled = true;
    state.installs -= 1;
    if (state.installs > 0) return;
    state.stop?.();
    state.stop = null;
  };
}

function subscribe(queryClient: QueryClient, state: MonitorState): () => void {
  const cache = queryClient.getQueryCache();
  // 行の比較の元：スレッド一覧の Query ごとの、最後にサーバーから正常に取得した行と、そのときの利用者。購読を外すと一緒に捨てる
  const baselines = new WeakMap<
    Query,
    { userId: string | undefined; rows: ThreadListRow[] }
  >();

  const onListUpdate = (query: Query, manual: boolean) => {
    if (manual) {
      // 手での書き換えの後は、元を捨てる（書き換えた後の一覧とサーバーの答えを比べても、消失とは言えない）。
      // 片付けが行を外す書き込みは、元を残す（片付けの後のサーバーの答えから、その案件を確かめるため）
      if (!isCleanupWrite(queryClient)) baselines.delete(query);
      return;
    }
    const userId = sessionUserId(queryClient);
    const rows = threadListRows(query.state.data);
    const previous = baselines.get(query);
    baselines.set(query, { userId, rows });
    if (userId === undefined || previous?.userId !== userId) return;
    for (const [caseId, roomId] of rowsLost(previous.rows, rows))
      dispatchCandidate(
        queryClient,
        state,
        { userId, caseId, roomId, route: "list" },
        [...state.handlers].filter(
          (h) => h.userId === userId && h.caseId === caseId,
        ),
      );
  };

  const onDenied = (query: Query) => {
    const { queryKey } = query;
    const { data } = query.state;
    const handlers = handlersFor(state, queryKey, data);
    if (handlers.length > 0) {
      // S-17 の担当に任せる。進行中の確かめがあれば、その持ち主が最後まで処理する
      for (const handler of handlers)
        if (!state.verifying.has(markOf(handler.userId, handler.caseId)))
          handler.onDenied();
      return;
    }
    const userId = sessionUserId(queryClient);
    if (userId === undefined) return;
    const target = outsideTarget(queryClient, userId, queryKey, data);
    if (target === null) return;
    dispatchCandidate(
      queryClient,
      state,
      { userId, ...target, route: "content" },
      [],
    );
  };

  return cache.subscribe((event: QueryCacheNotifyEvent) => {
    if (event.type === "removed") {
      baselines.delete(event.query);
      return;
    }
    if (event.type !== "updated") return;
    const { query, action } = event;
    // 捨てられた Query に遅れて届いた応答は、使わない
    if (cache.get(query.queryHash) !== query) return;
    const isList =
      query.queryKey.length === threadKeys.list.length &&
      threadKeys.list.every((part, index) => query.queryKey[index] === part);
    if (isList) {
      if (action.type === "success")
        onListUpdate(query, action.manual === true);
      return;
    }
    if (action.type !== "error") return;
    const { error } = action;
    if (!isApiError(error) || !ACCESS_LOSS_STATUSES.includes(error.status))
      return;
    onDenied(query);
  });
}
