// 資格を失ったときの、文書ごとの読み込み直しの入口（#338・C-206）。片付け（C-190）の後に呼ばれ、部品の状態・進行中の処理の続きを文書ごと消す。
// 状態は文書ごとに1つ：idle → waiting（持ち主・理由を持つ）→ reloading（以後 idle に戻らない）。時間による歯止めは持たない（AC-4）。
// 待機の持ち主は、確定を始めた時点の利用者。いまのセッションが持ち主と別の利用者になったら取りやめる。セッションが無いだけ（401・ログアウトの後）では取りやめない（AC-3）。
// 進行中の操作（MutationCache の pending と、API の直接の書き込み）は、最初の要求から最大5秒待つ。持ち主が押したログアウトだけは上限なしで、その後処理が終わるまで待つ（AC-2・AC-3）。
import type { Mutation, QueryClient } from "@tanstack/react-query";
import {
  getPendingWriteCount,
  subscribePendingWrites,
} from "../../services/api-client";
import { authKeys, type SessionInfo } from "../auth";
import { restoreBeforeUnload, suppressBeforeUnload } from "../leave-guard";
import {
  writeAccessLossNotice,
  type AccessLossNoticeKind,
} from "./access-loss-notice";
import { reloadPage, replacePage } from "./browser-location";

export type AccessLossReloadState = "idle" | "waiting" | "reloading";

export type AccessLossReloadRequest = {
  /** 確定を始めた時点の利用者（退出は押した時点の利用者） */
  ownerId: string;
  reason: AccessLossNoticeKind;
  /** 退出した案件の S-17 の場所（`/cases/<caseId>`）。reason が left のときだけ */
  leftCasePath?: string;
};

/** 持ち主のログアウト以外の、進行中の操作を待つ上限 */
const WAIT_LIMIT_MS = 5_000;
const CASE_LIST_PATH = "/cases";

type Waiting = {
  ownerId: string;
  reason: AccessLossNoticeKind;
  leftCasePath: string | undefined;
  cancel: () => void;
  done: Promise<void>;
};

let state: AccessLossReloadState = "idle";
let waiting: Waiting | null = null;
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
    done,
    cancel: () => {
      stopAll();
      waiting = null;
      restoreBeforeUnload();
      setState("idle");
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
    return pending.length > 0 || getPendingWriteCount() > 0;
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
      writeAccessLossNotice(entry.reason);
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
