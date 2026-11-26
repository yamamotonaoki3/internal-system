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
  /** content：中身の拒否／list：スレッド一覧の行の消失（確かめられないときの扱いが違う。計画 3 節） */
  onDenied: (route: CaseAccessLossRoute) => void;
};

export type CaseAccessLossRoute = "content" | "list";

/** 進行中の確かめ。経路は、途中に中身の拒否が届けば content に上がる（後から届いたきっかけを失わないため） */
export type CaseVerification = {
  readonly route: CaseAccessLossRoute;
  release: () => void;
};

/** 画面の外の確かめのきっかけ。content：返信・部屋の拒否／list：スレッド一覧の行の消失 */
type Candidate = {
  userId: string;
  caseId: string;
  roomId: string | null;
  route: CaseAccessLossRoute;
  /** 始めた時点の利用者の世代と、参加の期間（終わったときと副作用の直前に照らす） */
  generation: number;
  period: number;
};

/** 利用者・案件ごとの、確定の副作用の印。参加の期間（period）は、参加者に戻ったと分かるたびに進める */
type LossMarks = { period: number; announced: boolean; draftsHandled: boolean };

type MonitorState = {
  handlers: Set<CaseAccessLossHandler>;
  /** 進行中の確かめ（利用者・案件ごと。持ち主は始めた側〔S-17 か、この見張り〕で、終わるまで外さない） */
  verifying: Map<string, { route: CaseAccessLossRoute }>;
  /** 合図・下書きの処理の印（読み込み直しの印とは別。参加者に戻ったと分かったときだけ外す） */
  marks: Map<string, LossMarks>;
  /** 利用者の世代：セッションの利用者が、別の利用者に替わるたびに進める（A → B → A でも、古い確かめを捨てるため） */
  generation: number;
  knownUserId: string | undefined;
  installs: number;
  stop: (() => void) | null;
};

type ListAction = Extract<QueryCacheNotifyEvent, { type: "updated" }>["action"];

const states = new WeakMap<QueryClient, MonitorState>();

function stateOf(queryClient: QueryClient): MonitorState {
  let state = states.get(queryClient);
  if (state === undefined) {
    state = {
      handlers: new Set(),
      verifying: new Map(),
      marks: new Map(),
      generation: 0,
      knownUserId: undefined,
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

/**
 * 確かめを始める担当になる。同じ利用者・案件の確かめが進行中なら null（重ねない）。そのとき、後から届いたのが中身の拒否なら、
 * 進行中の確かめの経路を content に上げる（始めた担当が、終わったときに、上がった経路で処理する）
 */
export function claimCaseVerification(
  queryClient: QueryClient,
  userId: string,
  caseId: string,
  route: CaseAccessLossRoute,
): CaseVerification | null {
  const { verifying } = stateOf(queryClient);
  const mark = markOf(userId, caseId);
  const running = verifying.get(mark);
  if (running !== undefined) {
    if (route === "content") running.route = "content";
    return null;
  }
  const entry = { route };
  verifying.set(mark, entry);
  return {
    get route() {
      return entry.route;
    },
    release: () => {
      if (verifying.get(mark) === entry) verifying.delete(mark);
    },
  };
}

function marksOf(state: MonitorState, mark: string): LossMarks {
  let marks = state.marks.get(mark);
  if (marks === undefined) {
    marks = { period: 0, announced: false, draftsHandled: false };
    state.marks.set(mark, marks);
  }
  return marks;
}

/** いまの参加の期間。確かめを始めるときに控え、確定の副作用に渡す */
export function currentLossPeriod(
  queryClient: QueryClient,
  userId: string,
  caseId: string,
): number {
  return marksOf(stateOf(queryClient), markOf(userId, caseId)).period;
}

/** いまの利用者の世代。確かめを始めるときに控え、終わったときに照らす */
export function currentUserGeneration(queryClient: QueryClient): number {
  return stateOf(queryClient).generation;
}

/**
 * 確定した喪失を、ほかのタブへ1回だけ知らせる（読み込み直しの印とは別。入口の後・下書きの消去の前に呼ぶ。送る処理は投げない）。
 * 古い参加の期間の確定では送らない
 */
export function announceCaseAccessLossOnce(
  queryClient: QueryClient,
  userId: string,
  caseId: string,
  period: number,
): void {
  const marks = marksOf(stateOf(queryClient), markOf(userId, caseId));
  if (marks.period !== period || marks.announced) return;
  marks.announced = true;
  announceCaseAccessLoss({ userId, caseId });
}

/**
 * 確定した喪失の、その部屋の下書きを、同じ参加の期間で1回だけ消す（C-207(5)〜(9)）。消去は呼んだ時点の保存の内容を消すため、
 * 1回目の後に同じ持ち主が書いた新しい下書きを、同じ喪失の2回目の確定・遅れて届いた古い確定で消さない。
 * 部屋が分からないときは何もしない（処理済みにもしない）
 */
export function forgetCaseRoomDraftsOnce(
  queryClient: QueryClient,
  userId: string,
  caseId: string,
  roomId: string | null,
  period: number,
): void {
  const marks = marksOf(stateOf(queryClient), markOf(userId, caseId));
  if (roomId === null || marks.period !== period || marks.draftsHandled) return;
  marks.draftsHandled = true;
  forgetCaseRoomDraftsAfterLoss(userId, roomId);
}

/** 参加者に戻ったと分かったとき：参加の期間を進め、次の喪失で、また知らせ・下書きを消せるようにする */
export function startCaseParticipationPeriod(
  queryClient: QueryClient,
  userId: string,
  caseId: string,
): void {
  const marks = marksOf(stateOf(queryClient), markOf(userId, caseId));
  marks.period += 1;
  marks.announced = false;
  marks.draftsHandled = false;
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
  { userId, caseId, roomId, route, period }: Candidate,
  verdict: CaseAccessVerdict,
): void {
  // 利用者の切り替えは、切り替えの入口に任せる
  if (verdict === "switched") return;
  if (verdict === "participant") {
    startCaseParticipationPeriod(queryClient, userId, caseId);
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
  announceCaseAccessLossOnce(queryClient, userId, caseId, period);
  forgetCaseRoomDraftsOnce(queryClient, userId, caseId, roomId, period);
}

/** 確かめを始めたときの利用者の世代・参加の期間のままか（古い答えを、新しい世代・期間に作用させない。切り替えは verdict の switched で扱う） */
function stillCurrent(queryClient: QueryClient, candidate: Candidate): boolean {
  return (
    sessionUserId(queryClient) === candidate.userId &&
    currentUserGeneration(queryClient) === candidate.generation &&
    currentLossPeriod(queryClient, candidate.userId, candidate.caseId) ===
      candidate.period
  );
}

async function verifyOutside(
  queryClient: QueryClient,
  candidate: Candidate,
): Promise<void> {
  const verification = claimCaseVerification(
    queryClient,
    candidate.userId,
    candidate.caseId,
    candidate.route,
  );
  if (verification === null) return;
  let verdict: CaseAccessVerdict;
  try {
    verdict = await verifyBySummaryFetch(candidate.caseId);
  } finally {
    verification.release();
  }
  // 確かめの間に利用者が替わった（戻った場合も）・ログアウトした・参加者に戻った：古い答えを作用させない
  if (!stillCurrent(queryClient, candidate)) return;
  settleOutside(
    queryClient,
    { ...candidate, route: verification.route },
    verdict,
  );
}

/** きっかけを、S-17 の担当へ渡すか、画面の外で確かめる */
function dispatchCandidate(
  queryClient: QueryClient,
  state: MonitorState,
  candidate: Candidate,
  handlers: CaseAccessLossHandler[],
): void {
  if (handlers.length > 0) {
    // S-17 の担当に任せる。進行中の確かめがあれば、担当の側で経路だけを引き継ぐ
    for (const handler of handlers) handler.onDenied(candidate.route);
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
  // 行の比較の元：スレッド一覧の Query ごとの、その取得を始めた時点の一覧の行（ID だけ）と、そのときの利用者の世代。
  // 取得の成功で比べて捨てる。手での書き換え（片付けを含む）・取得の失敗・Query の削除・利用者の切り替え・購読の解除でも捨てる
  const snapshots = new WeakMap<
    Query,
    { generation: number; rows: ThreadListRow[] }
  >();

  const onListFetched = (query: Query) => {
    const snapshot = snapshots.get(query);
    snapshots.delete(query);
    const userId = sessionUserId(queryClient);
    if (
      snapshot === undefined ||
      userId === undefined ||
      snapshot.generation !== state.generation
    )
      return;
    for (const [caseId, roomId] of rowsLost(
      snapshot.rows,
      threadListRows(query.state.data),
    ))
      dispatchCandidate(
        queryClient,
        state,
        {
          userId,
          caseId,
          roomId,
          route: "list",
          generation: state.generation,
          period: currentLossPeriod(queryClient, userId, caseId),
        },
        [...state.handlers].filter(
          (h) => h.userId === userId && h.caseId === caseId,
        ),
      );
  };

  const onListAction = (query: Query, action: ListAction) => {
    if (action.type === "fetch")
      snapshots.set(query, {
        generation: state.generation,
        rows: threadListRows(query.state.data),
      });
    else if (action.type === "success" && action.manual !== true)
      onListFetched(query);
    else if (action.type === "success" || action.type === "error")
      snapshots.delete(query);
  };

  /** 別の利用者に替わったら、世代を進める（切り替えの見張りがキャッシュを捨てるのと同じ区切り。比較の元は世代で無効になる） */
  const followUser = () => {
    const next = sessionUserId(queryClient);
    if (next === undefined || next === state.knownUserId) return;
    if (state.knownUserId !== undefined) state.generation += 1;
    state.knownUserId = next;
  };

  const onDenied = (query: Query) => {
    const { queryKey } = query;
    const { data } = query.state;
    const handlers = handlersFor(state, queryKey, data);
    if (handlers.length > 0) {
      // S-17 の担当に任せる。進行中の確かめがあれば、その持ち主が、上がった経路で最後まで処理する
      for (const handler of handlers) handler.onDenied("content");
      return;
    }
    const userId = sessionUserId(queryClient);
    if (userId === undefined) return;
    const target = outsideTarget(queryClient, userId, queryKey, data);
    if (target === null) return;
    dispatchCandidate(
      queryClient,
      state,
      {
        userId,
        ...target,
        route: "content",
        generation: state.generation,
        period: currentLossPeriod(queryClient, userId, target.caseId),
      },
      [],
    );
  };

  followUser();
  return cache.subscribe((event: QueryCacheNotifyEvent) => {
    followUser();
    if (event.type === "removed") {
      snapshots.delete(event.query);
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
      onListAction(query, action);
      return;
    }
    if (action.type !== "error") return;
    const { error } = action;
    if (!isApiError(error) || !ACCESS_LOSS_STATUSES.includes(error.status))
      return;
    onDenied(query);
  });
}
