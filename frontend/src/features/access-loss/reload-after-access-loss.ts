// 資格を失ったときの、文書ごとの読み込み直しの入口（#338・C-206）。片付け（C-190）の後に呼ばれ、部品の状態・進行中の処理の続きを文書ごと消す。
// 状態は文書ごとに1つ：idle → waiting（持ち主・理由を持つ）→ reloading（以後 idle に戻らない）。時間による歯止めは持たない（AC-4）。
// 待機の持ち主は、確定を始めた時点の利用者。いまのセッションが持ち主と別の利用者になったら取りやめる。セッションが無いだけ（401・ログアウトの後）では取りやめない（AC-3）。
// 進行中の操作（MutationCache の pending と、API の直接の書き込み）は、最初の要求から最大5秒待つ。持ち主が押したログアウトだけは上限なしで、その後処理が終わるまで待つ（AC-2・AC-3）。
// 利用者の切り替え（#298・ADR-0035）の読み込み直しは、別の入口 requestUserSwitchReload にする。状態・覆い・離脱の確認の抑止・5秒の待ち方は同じだが、
// 持ち主・取りやめ・知らせを持たない（文書の利用者は変わらないので、戻っても読み込み直す）。動き出したら、#338 の要求は何もしない。
import type { Mutation, QueryClient } from "@tanstack/react-query";
import {
  getPendingWriteCount,
  subscribePendingWrites,
} from "../../services/api-client";
import { authKeys, type SessionInfo } from "../auth";
import { restoreBeforeUnload, suppressBeforeUnload } from "../leave-guard";
import {
  clearAccessLossNotice,
  writeAccessLossNotice,
  type AccessLossNoticeKind,
} from "./access-loss-notice";
import { reloadPage, replacePage } from "./browser-location";

export type AccessLossReloadState = "idle" | "waiting" | "reloading";

type AccessLossReason = Extract<AccessLossNoticeKind, "lost" | "left">;

export type AccessLossReloadRequest = {
  /** 確定を始めた時点の利用者（退出は押した時点の利用者） */
  ownerId: string;
  reason: AccessLossReason;
  /** 退出した案件の S-17 の場所（`/cases/<caseId>`）。reason が left のときだけ */
  leftCasePath?: string;
};

/** 持ち主のログアウト以外の、進行中の操作を待つ上限 */
const WAIT_LIMIT_MS = 5_000;
const CASE_LIST_PATH = "/cases";

type Waiting = {
  ownerId: string;
  reason: AccessLossReason;
  leftCasePath: string | undefined;
  /** その案件の部屋の下書きを消せなかった（noteDraftsRemain。#340） */
  draftsRemain: boolean;
  cancel: () => void;
  /** 切り替えの入口に引き継ぐ：抑止を外さず、idle に戻さず、知らせを書かずに止める */
  handOver: () => void;
  done: Promise<void>;
};

let state: AccessLossReloadState = "idle";
let waiting: Waiting | null = null;
let userSwitchRequested = false;
const listeners = new Set<() => void>();

function setState(next: AccessLossReloadState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

export function getAccessLossReloadState(): AccessLossReloadState {
  return state;
}

export function subscribeAccessLossReloadState(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readUserId(queryClient: QueryClient): string | undefined {
  return queryClient.getQueryData<SessionInfo>(authKeys.session)?.user.id;
}

/** 進行中の操作（MutationCache の pending と、API の直接の書き込み）があるか */
function hasPendingOperations(queryClient: QueryClient): boolean {
  return (
    queryClient.getMutationCache().findAll({ status: "pending" }).length > 0 ||
    getPendingWriteCount() > 0
  );
}

function isOtherUser(queryClient: QueryClient, ownerId: string): boolean {
  const userId = readUserId(queryClient);
  return userId !== undefined && userId !== ownerId;
}

/** 持ち主が押したログアウト（useLogout の onMutate が、押した時点の利用者を文脈に持つ） */
function isOwnersLogout(
  mutation: Mutation<unknown, Error, unknown, unknown>,
  ownerId: string,
): boolean {
  const key = mutation.options.mutationKey;
  if (
    key === undefined ||
    JSON.stringify(key) !== JSON.stringify(authKeys.logout)
  )
    return false;
  const context: unknown = mutation.state.context;
  return (
    typeof context === "object" &&
    context !== null &&
    "userId" in context &&
    context.userId === ownerId
  );
}

function destinationIsCaseList(entry: Waiting): boolean {
  if (entry.reason !== "left") return false;
  const path = window.location.pathname;
  return path === CASE_LIST_PATH || path === entry.leftCasePath;
}

function startWaiting(
  queryClient: QueryClient,
  request: AccessLossReloadRequest,
): Promise<void> {
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  let limitReached = false;
  let nextTask: ReturnType<typeof setTimeout> | undefined;
  const stops: (() => void)[] = [];
  const stopAll = () => {
    clearTimeout(limitTimer);
    clearTimeout(nextTask);
    stops.splice(0).forEach((stop) => stop());
  };

  const entry: Waiting = {
    ownerId: request.ownerId,
    reason: request.reason,
    leftCasePath: request.leftCasePath,
    draftsRemain: false,
    done,
    cancel: () => {
      stopAll();
      waiting = null;
      restoreBeforeUnload();
      setState("idle");
      resolveDone();
    },
    handOver: () => {
      stopAll();
      waiting = null;
      resolveDone();
    },
  };

  // 待つべき操作が残っているか。上限の内は、すべての進行中の操作（MutationCache の pending と、API の直接の書き込み）を、
  // 上限の後は、持ち主のログアウトだけを待つ
  const mustWait = () => {
    const pending = queryClient
      .getMutationCache()
      .findAll({ status: "pending" });
    if (pending.some((mutation) => isOwnersLogout(mutation, entry.ownerId)))
      return true;
    if (limitReached) return false;
    return hasPendingOperations(queryClient);
  };

  const finish = () => {
    nextTask = undefined;
    if (isOtherUser(queryClient, entry.ownerId)) {
      entry.cancel();
      return;
    }
    // 予約の後に始まった操作も待つ：待機に戻り、購読・上限のタイマー（最初の要求から数える）の知らせで、確かめ直す
    if (mustWait()) return;
    stopAll();
    waiting = null;
    // セッションが無い（ログアウト・401 の後）なら、誰に出す知らせか分からないので書かない
    if (readUserId(queryClient) !== undefined)
      writeAccessLossNotice(
        entry.draftsRemain ? `${entry.reason}DraftsRemain` : entry.reason,
      );
    setState("reloading");
    if (destinationIsCaseList(entry)) replacePage(CASE_LIST_PATH);
    else reloadPage();
    resolveDone();
  };

  const check = () => {
    if (nextTask !== undefined || mustWait()) return;
    // 1つ後のタスクまで待つ：操作の完了の後に続く処理（mutateAsync・await の続き。下書きの消去など）を先に走らせる
    nextTask = setTimeout(finish, 0);
  };

  const limitTimer = setTimeout(() => {
    limitReached = true;
    check();
  }, WAIT_LIMIT_MS);

  waiting = entry;
  suppressBeforeUnload();
  setState("waiting");
  stops.push(
    queryClient.getQueryCache().subscribe(() => {
      if (isOtherUser(queryClient, entry.ownerId)) entry.cancel();
    }),
    queryClient.getMutationCache().subscribe(check),
    subscribePendingWrites(check),
  );
  check();
  return done;
}

/**
 * 資格を失ったときに、片付けの後で呼ぶ。呼んだその場では読み込み直さない（進行中の操作を待ち、1つ後のタスクで読み込み直す）。
 * 同じ持ち主の要求は1つにまとめ、理由は left を優先する。返り値は、読み込み直したか取りやめたときに解決する
 */
export function requestAccessLossReload(
  queryClient: QueryClient,
  request: AccessLossReloadRequest,
): Promise<void> {
  // 切り替えの入口が動き出した後は、持ち主に関わらず何もしない（抑止を外さず、読み込み直しを2回にしない）
  if (userSwitchRequested) return Promise.resolve();
  if (isOtherUser(queryClient, request.ownerId)) return Promise.resolve();
  if (state === "reloading") return Promise.resolve();
  if (waiting !== null) {
    if (waiting.ownerId === request.ownerId) {
      if (request.reason === "left") {
        waiting.reason = "left";
        waiting.leftCasePath = request.leftCasePath;
      }
      return waiting.done;
    }
    waiting.cancel();
  }
  return startWaiting(queryClient, request);
}

/**
 * 片付けで、その案件の部屋の下書きを消せなかったときに呼ぶ（#340・C-207）。同じ持ち主の待機があれば、読み込み直した後の知らせで伝える。
 * 待機がない・持ち主が違う（前の利用者の知らせを次の利用者に出さない）・読み込み直しが始まった後は、何もしない
 */
export function noteDraftsRemain(ownerId: string): void {
  if (waiting === null || waiting.ownerId !== ownerId) return;
  waiting.draftsRemain = true;
}

function startUserSwitchWaiting(queryClient: QueryClient): void {
  let limitReached = false;
  let nextTask: ReturnType<typeof setTimeout> | undefined;
  const stops: (() => void)[] = [];

  // 待つのは、Cookie が替わる前に送られ、受理されうる操作の後処理（投稿の後の下書きの消去など）。上限の後は待たない
  const mustWait = () => !limitReached && hasPendingOperations(queryClient);

  const finish = () => {
    nextTask = undefined;
    if (mustWait()) return;
    clearTimeout(limitTimer);
    stops.splice(0).forEach((stop) => stop());
    // 前の文書で保存済みの喪失の知らせは、新しい文書で次の利用者に出てしまうので消す（Q7：切り替えの知らせは出さない）
    clearAccessLossNotice();
    setState("reloading");
    reloadPage();
  };

  const check = () => {
    if (nextTask !== undefined || mustWait()) return;
    nextTask = setTimeout(finish, 0);
  };

  const limitTimer = setTimeout(() => {
    limitReached = true;
    check();
  }, WAIT_LIMIT_MS);

  suppressBeforeUnload();
  setState("waiting");
  stops.push(
    queryClient.getMutationCache().subscribe(check),
    subscribePendingWrites(check),
  );
  check();
}

/**
 * セッションの利用者が、文書の利用者と別の利用者に替わったときに呼ぶ（#298。main.tsx が、見張りと 409 の後の取り直しに渡す）。
 * 何回呼ばれても1回だけ働く。#338 の待機中なら、抑止を途切れさせずに引き継ぐ。読み込み直しは1つ後のタスクの後、受理済みの操作を最大5秒待ってから
 */
export function requestUserSwitchReload(queryClient: QueryClient): void {
  if (userSwitchRequested) return;
  userSwitchRequested = true;
  if (state === "reloading") {
    // #338 の読み込み直しが、知らせを保存した後でも、文書が替わる前なら、次の利用者に出さないよう消す（読み込み直しは足さない）
    clearAccessLossNotice();
    return;
  }
  waiting?.handOver();
  startUserSwitchWaiting(queryClient);
}

/**
 * 文書が丸ごと戻ったとき（bfcache。#342）に、読み込み直しが始まっていた（reloading）なら、いまの場所の読み込み直しを1回やり直す。
 * 戻った文書では、離れる前に求めた遷移が取りやめられているため。idle・waiting では何もしない（待機・期限・知らせを作り直さない）。
 * 元の遷移の行き先（退出の /cases への置き換え）は再現しない（#392）
 */
export function retryReloadNavigationAfterPageRestore(): void {
  if (state !== "reloading") return;
  reloadPage();
}

/** 切り替えの入口が呼ばれたか（呼ばれた後、この文書の間ずっと真。資格の確かめが、食い違いを喪失と取り違えないために読む） */
export function isUserSwitchReloadRequested(): boolean {
  return userSwitchRequested;
}
