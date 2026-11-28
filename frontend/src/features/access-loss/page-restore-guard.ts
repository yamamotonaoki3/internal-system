// ブラウザの「戻る」で文書が丸ごと戻る場合（bfcache。#342）の守り。離れる（pagehide）ときに、案件の中身を持つ文書を、その処理の中で隠し、
// 戻った（pageshow）ときに、自分で取り直したセッションと案件の概要の答えだけで、外す・再試行・入口への引き渡しを決める。
// 戻る前に送った要求・キャッシュ・通常の取得の答えには合流しない（凍っていた間の答えで、資格を判断しないため）。
// 状態は文書ごとに1つ：idle・prepared（隠して戻るのを待つ）・verifying・failed（隠したまま再試行を出す）・handedOff（入口へ渡した）。
// 古い答えは、登録ごとの識別と試行の番号の両方で捨てる（解除して登録し直すと、番号は初期に戻るため）。
// features/cases・features/auth の確かめと確定は、main.tsx が関数で渡す（access-loss は cases に依存しない）。
import type { QueryClient } from "@tanstack/react-query";
import { authKeys, type SessionInfo } from "../auth";
import { suppressBeforeUnload } from "../leave-guard";
import { reloadPage } from "./browser-location";
import {
  getAccessLossReloadState,
  retryReloadNavigationAfterPageRestore,
} from "./reload-after-access-loss";

export type PageRestoreState =
  "idle" | "prepared" | "verifying" | "failed" | "handedOff";

/** 確かめる対象。案件と部屋の ID だけ（本文・入力値は持たない） */
export type PageRestoreTarget = { caseId: string; roomId: string | null };

/** 確かめる直前に控える文脈（確定の入口が、利用者・世代・参加の期間を照らす） */
export type PageRestoreContext = {
  userId: string;
  caseId: string;
  roomId: string | null;
  generation: number;
  period: number;
};

type SessionOutcome = "same" | "otherUser" | "unauthenticated" | "unknown";
type CaseVerdict =
  "participant" | "lost" | "notFound" | "unverified" | "switched";
/** forbidden は概要の 403（一般の unverified は確定の入口に渡さない） */
type SettleVerdict =
  "participant" | "lost" | "notFound" | "switched" | "forbidden";

export type PageRestoreGuardOptions = {
  queryClient: QueryClient;
  /** セッションを直接取り直し、文書の利用者と比べる */
  verifySession: () => Promise<SessionOutcome>;
  /** 別の利用者に替わったときの、切り替えの入口 */
  onOtherUser: () => void;
  /** その利用者の、確かめる対象の全件（いまのキャッシュから） */
  listTargets: (userId: string) => readonly PageRestoreTarget[];
  contextOf: (userId: string, target: PageRestoreTarget) => PageRestoreContext;
  /** 概要を直接取り、判定と、根拠の HTTP の状態（成功は null）を返す */
  verifyCase: (
    caseId: string,
  ) => Promise<{ verdict: CaseVerdict; failureStatus: number | null }>;
  settleCase: (
    context: PageRestoreContext,
    verdict: SettleVerdict,
  ) => "confirmed" | "handedOff" | "unverified";
};

/**
 * 境界（AccessLossBoundary）が登録する、包みの直接の操作。pagehide の処理の中で隠すため、描画（React への通知）を待たずに使う
 */
export type PageRestoreSurface = {
  /** 隠す前の、フォーカス・選択範囲・スクロールを控える */
  captureView: () => void;
  /** 包みに hidden・inert を直接付ける */
  cover: () => void;
  /** いまの状態から包みを付け直す。restoreView が真なら、外した後の描画で、控えた表示の状態を戻す */
  release: (restoreView: boolean) => void;
};

type Registration = { options: PageRestoreGuardOptions };

/** 離れたときに捕まえた対象。failed は捕捉が例外で終わったこと（対象0件とは扱わない） */
type Captured =
  | { kind: "targets"; userId: string; targets: readonly PageRestoreTarget[] }
  | { kind: "noUser" }
  | { kind: "failed" };

/** 守りが始める案件の確かめの、同時の上限（通常の取得は含まない） */
const CONCURRENT_CASE_CHECKS = 2;

let state: PageRestoreState = "idle";
let attempt = 0;
let registration: Registration | null = null;
let captured: Captured | null = null;
/** その復元で、読み込み直しの遷移をやり直したか（確かめの再試行では戻さない） */
let navigationRetried = false;
let surface: PageRestoreSurface | null = null;
const listeners = new Set<() => void>();

/** 通知の失敗で、ほかの購読者・隠す処理を止めない（失敗はもみ消さず、標準の報告に渡す） */
function notify(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      reportError(error);
    }
  }
}

function setState(next: PageRestoreState): void {
  state = next;
  notify();
}

export function getPageRestoreState(): PageRestoreState {
  return state;
}

export function subscribePageRestoreState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 境界が、包みの直接の操作を登録する。返り値は解除の関数 */
export function attachPageRestoreSurface(next: PageRestoreSurface): () => void {
  surface = next;
  return () => {
    if (surface === next) surface = null;
  };
}

function sessionUserIdOf(queryClient: QueryClient): string | undefined {
  return queryClient.getQueryData<SessionInfo>(authKeys.session)?.user.id;
}

function captureTargets(registered: Registration): Captured {
  const userId = sessionUserIdOf(registered.options.queryClient);
  // 捕捉の利用者は、セッションのキャッシュの利用者。無ければ、文書の利用者で補わない
  if (userId === undefined) return { kind: "noUser" };
  return {
    kind: "targets",
    userId,
    targets: registered.options.listTargets(userId),
  };
}

function hasNothingToGuard(next: Captured): boolean {
  const empty =
    next.kind === "noUser" ||
    (next.kind === "targets" && next.targets.length === 0);
  return empty && getAccessLossReloadState() === "idle";
}

/** idle から離れる：対象と表示の状態を捕まえ、必要なら、この処理の中で隠す */
function prepareFromIdle(registered: Registration): void {
  let next: Captured;
  let failure: { error: unknown } | null = null;
  try {
    next = captureTargets(registered);
  } catch (error) {
    next = { kind: "failed" };
    failure = { error };
  }
  if (hasNothingToGuard(next)) return;
  captured = next;
  state = "prepared";
  try {
    surface?.captureView();
  } catch (error) {
    reportError(error);
  } finally {
    // 捕捉・表示の状態の控えが例外で終わっても、隠す
    surface?.cover();
  }
  notify();
  if (failure !== null) reportError(failure.error);
}

function onPageHide(registered: Registration): void {
  if (registration !== registered) return;
  attempt += 1;
  if (state === "idle") {
    prepareFromIdle(registered);
    return;
  }
  // 確かめ・失敗・引き渡しの途中に離れた：試行を捨て、捕捉済みの対象と、最初に控えた表示の状態を保ったまま、隠し続ける
  state = "prepared";
  surface?.cover();
  notify();
}

/** 守り自身が、覆ったまま文書を読み込み直す（ログインが切れていた。離脱の確認を出さない） */
function reloadBySelf(): void {
  setState("handedOff");
  suppressBeforeUnload();
  reloadPage();
}

type Attempt = {
  registered: Registration;
  number: number;
};

function isCurrent({ registered, number }: Attempt): boolean {
  return registration === registered && attempt === number;
}

function isVerifying(current: Attempt): boolean {
  return isCurrent(current) && state === "verifying";
}

/** 読み込み直しが idle でないとき：案件は確かめず、既存の読み込み直しに任せる。reloading なら、その復元について1回だけ遷移をやり直す */
function handOverToReload(
  registered: Registration,
  outcome: SessionOutcome | null,
): void {
  // 別の利用者なら、先に切り替えの入口を呼ぶ（保存済みの喪失の知らせを消してから遷移させるため）
  if (outcome === "otherUser") registered.options.onOtherUser();
  if (getAccessLossReloadState() === "reloading" && !navigationRetried) {
    navigationRetried = true;
    retryReloadNavigationAfterPageRestore();
  }
  setState("handedOff");
}

function settleVerdictOf(answer: {
  verdict: CaseVerdict;
  failureStatus: number | null;
}): SettleVerdict | null {
  if (answer.verdict !== "unverified") return answer.verdict;
  // 403 だけを、中身の片付けと読み込み直しにつなぐ。通信の失敗・5xx などは確かめられないまま（再試行）
  return answer.failureStatus === 403 ? "forbidden" : null;
}

/** 照合で採用できなかったとき：読み込み直しへ移っていれば、その覆いに任せる。そうでなければ再試行を出す */
function failOrHandOver(): void {
  setState(getAccessLossReloadState() === "idle" ? "failed" : "handedOff");
}

async function checkTarget(
  current: Attempt,
  userId: string,
  target: PageRestoreTarget,
): Promise<boolean> {
  const { options } = current.registered;
  const context = options.contextOf(userId, target);
  const answer = await options.verifyCase(target.caseId);
  if (!isVerifying(current)) return false;
  if (getAccessLossReloadState() !== "idle") {
    setState("handedOff");
    return false;
  }
  // ログインが切れていた（コードによらず、HTTP の状態で決める）
  if (answer.failureStatus === 401) {
    reloadBySelf();
    return false;
  }
  const verdict = settleVerdictOf(answer);
  if (verdict === null) {
    setState("failed");
    return false;
  }
  const result = options.settleCase(context, verdict);
  if (result === "confirmed") return true;
  if (result === "handedOff") setState("handedOff");
  else failOrHandOver();
  return false;
}

/** 捕捉した全件を、同時に2件まで確かめる。全件が参加者として採用されたときだけ真 */
async function checkAllTargets(
  current: Attempt,
  userId: string,
  targets: readonly PageRestoreTarget[],
): Promise<boolean> {
  const queue = [...targets];
  let confirmed = 0;
  const worker = async () => {
    while (isVerifying(current)) {
      const target = queue.shift();
      if (target === undefined) return;
      try {
        if (!(await checkTarget(current, userId, target))) return;
        confirmed += 1;
      } catch (error) {
        // 応答の検証の失敗・実装の例外：確かめの成功にせず、報告して再試行を出す
        reportError(error);
        if (isVerifying(current)) setState("failed");
        return;
      }
    }
  };
  await Promise.all(
    Array.from({ length: CONCURRENT_CASE_CHECKS }, () => worker()),
  );
  return confirmed === targets.length;
}

/**
 * 確かめる対象。離れたときに捕まえられなかった（捕捉の例外・セッションのキャッシュが無かった）なら、
 * セッションを確かめた後の、いまのキャッシュから捕まえ直す。捕まえられなければ null（確かめられない）
 */
function targetsForCheck(
  registered: Registration,
): { userId: string; targets: readonly PageRestoreTarget[] } | null {
  if (captured?.kind === "targets") return captured;
  let next: Captured;
  try {
    next = captureTargets(registered);
  } catch (error) {
    reportError(error);
    return null;
  }
  if (next.kind !== "targets") return null;
  captured = next;
  return next;
}

/** 全件が通った：最新の試行で、読み込み直しが idle なことを確かめてから外す */
function complete(current: Attempt): void {
  if (!isVerifying(current)) return;
  if (getAccessLossReloadState() !== "idle") {
    setState("handedOff");
    return;
  }
  captured = null;
  state = "idle";
  // 描画への通知が届かなくても外れるよう、包みは直接外す
  surface?.release(true);
  notify();
}

async function verify(current: Attempt, retrying: boolean): Promise<void> {
  const { options } = current.registered;
  // 捕捉が例外で終わった復元は、案件を確かめられないので、確かめずに再試行を出す（再試行で捕まえ直す）
  if (
    !retrying &&
    captured?.kind === "failed" &&
    getAccessLossReloadState() === "idle"
  ) {
    setState("failed");
    return;
  }
  setState("verifying");
  let outcome: SessionOutcome | null = null;
  let sessionFailure: { error: unknown } | null = null;
  try {
    outcome = await options.verifySession();
  } catch (error) {
    sessionFailure = { error };
  }
  if (sessionFailure !== null) reportError(sessionFailure.error);
  if (!isCurrent(current)) return;
  if (getAccessLossReloadState() !== "idle") {
    handOverToReload(current.registered, outcome);
    return;
  }
  if (outcome === "unauthenticated") {
    reloadBySelf();
    return;
  }
  if (outcome === "otherUser") {
    options.onOtherUser();
    setState("handedOff");
    return;
  }
  if (outcome !== "same") {
    setState("failed");
    return;
  }
  const checking = targetsForCheck(current.registered);
  if (checking === null) {
    setState("failed");
    return;
  }
  if (await checkAllTargets(current, checking.userId, checking.targets))
    complete(current);
}

function startVerification(registered: Registration, retrying: boolean): void {
  attempt += 1;
  const current = { registered, number: attempt };
  verify(current, retrying).catch((error: unknown) => {
    reportError(error);
    if (isCurrent(current)) setState("failed");
  });
}

function onPageShow(registered: Registration): void {
  // 退避の準備がある文書だけ。persisted の値によらず確かめる（確かめずに準備だけを解く経路は作らない）
  if (registration !== registered || state !== "prepared") return;
  navigationRetried = false;
  startVerification(registered, false);
}

/**
 * 失敗の覆いを出せず、再試行を押せないとき（境界が呼ぶ）：覆ったまま読み込み直す（資格を失ったわけではないので、知らせは出さない）。
 * いまの登録の失敗の状態のときだけ動くので、解除の後・再試行の後・2回目の呼び出しでは何もしない
 */
export function reloadWhenRetryUnreachable(): void {
  if (registration === null || state !== "failed") return;
  reloadBySelf();
}

/** 失敗の案内の「再試行」：新しい試行で、セッションから確かめ直す（前回の一部の成功は使わない） */
export function retryPageRestoreVerification(): void {
  if (registration === null || state !== "failed") return;
  startVerification(registration, true);
}

/**
 * 守りを登録する（main.tsx が、見張りの登録の後・描画の前に1回呼ぶ）。返り値は解除の関数：状態を idle に、試行の番号を初期に戻し、包みを外す
 */
export function installPageRestoreGuard(
  options: PageRestoreGuardOptions,
): () => void {
  const registered: Registration = { options };
  registration = registered;
  const hide = () => onPageHide(registered);
  const show = () => onPageShow(registered);
  window.addEventListener("pagehide", hide);
  window.addEventListener("pageshow", show);
  return () => {
    window.removeEventListener("pagehide", hide);
    window.removeEventListener("pageshow", show);
    if (registration !== registered) return;
    registration = null;
    attempt = 0;
    captured = null;
    navigationRetried = false;
    state = "idle";
    surface?.release(false);
    notify();
  };
}
