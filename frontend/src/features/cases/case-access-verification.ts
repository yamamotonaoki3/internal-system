// 案件の資格の確かめ（#308・#376・#339）。答えは5種類：participant・lost（成功して非参加）・notFound（404）・
// unverified（5xx・通信の失敗・答えが無い・409 の後に切り替えと確かめられない）・switched（利用者の切り替えで文書ごと読み込み直す。喪失ではない）。
// キャッシュの不在を喪失の証拠にしない。応答の検証の失敗・実装の例外は、非参加・通信の失敗に変えず、呼び出し元へ投げる。
import type { QueryClient } from "@tanstack/react-query";
import { isUserSwitchReloadRequested } from "../access-loss";
import {
  confirmSessionUserAfterMismatch,
  type SessionUserOutcome,
} from "../auth";
import { refetchAnswerOf } from "../../lib/refetch-answer";
import { isSessionUserMismatchError } from "../../services/api-client";
import { fetchCaseSummary, type CaseSummary } from "./api/case-api";
import type { caseKeys } from "./api/query-keys";
import { isApiError } from "./describe-error";

export type CaseAccessVerdict =
  "participant" | "lost" | "notFound" | "unverified" | "switched";

/** 案件が見つからない（404）。概要の取り直しの失敗のうち、資格を失った証拠になるのはこれだけ（5xx・通信の失敗は含まない） */
export function isCaseNotFound(error: unknown): boolean {
  return isApiError(error) && error.status === 404;
}

/** 答えが無い（取り消し等）・切り替えの後の確かめ：切り替えの入口が動いていれば switched、そうでなければ確かめられない */
function switchedOrUnverified(): CaseAccessVerdict {
  return isUserSwitchReloadRequested() ? "switched" : "unverified";
}

/**
 * 判定と、判定の根拠になった HTTP の状態（成功は null、通信の失敗・時間切れは 0）。復元の守り（#342）が、403・401 を、
 * ほかの確かめられない答えと分けるために使う（判定の文字列だけでは、状態が失われるため）
 */
export type CaseAccessFetchAnswer = {
  verdict: CaseAccessVerdict;
  failureStatus: number | null;
};

function verdictOfMismatchOutcome(
  outcome: SessionUserOutcome,
): CaseAccessVerdict {
  return outcome === "switched" ? switchedOrUnverified() : "unverified";
}

async function verdictAfterMismatch(): Promise<CaseAccessVerdict> {
  return verdictOfMismatchOutcome(await confirmSessionUserAfterMismatch());
}

/** 概要の取得の失敗の判定。API の失敗でないもの（応答の検証の失敗・実装の例外）は投げる */
async function answerOfFailure(error: unknown): Promise<CaseAccessFetchAnswer> {
  if (!isApiError(error)) throw error;
  if (isCaseNotFound(error))
    return { verdict: "notFound", failureStatus: error.status };
  if (isSessionUserMismatchError(error)) {
    const outcome = await confirmSessionUserAfterMismatch();
    // 409 の後のセッションの確かめが 401 なら、ログインが切れている（判定は unverified のまま、状態だけを 401 で渡す）
    return {
      verdict: verdictOfMismatchOutcome(outcome),
      failureStatus: outcome === "unauthenticated" ? 401 : error.status,
    };
  }
  return { verdict: "unverified", failureStatus: error.status };
}

/**
 * S-17 の確かめ：概要の Query を取り直し、この取り直しの答えで決める。答えは、取り直しの間に届いた更新の種類で見分ける
 * （取り消しの revert は保存済みのデータを成功として返し、取り直しの後にキャッシュが捨てられることもあるため、キャッシュを後から読まない）。
 * 失敗の表示は呼び出し側（確かめられない表示・概要の失敗の表示）が出す
 */
export async function verifyBySummaryRefetch(
  queryClient: QueryClient,
  summaryKey: ReturnType<typeof caseKeys.summary>,
): Promise<CaseAccessVerdict> {
  const query = queryClient
    .getQueryCache()
    .find<CaseSummary>({ queryKey: summaryKey, exact: true });
  if (query === undefined) return switchedOrUnverified();
  const answer = await refetchAnswerOf<CaseSummary>(queryClient, query, () =>
    queryClient.refetchQueries({ queryKey: summaryKey, exact: true }),
  );
  if (answer.kind === "data")
    return answer.data?.isParticipant === true ? "participant" : "lost";
  if (answer.kind === "error") {
    if (isCaseNotFound(answer.error)) return "notFound";
    if (isSessionUserMismatchError(answer.error)) return verdictAfterMismatch();
    return "unverified";
  }
  // 答えが無い（取り消し・手での書き換えとの重なり等）。どれがこの取り直しの答えか見分けられない
  return switchedOrUnverified();
}

async function fetchAnswer(caseId: string): Promise<CaseAccessFetchAnswer> {
  let summary: CaseSummary;
  try {
    summary = await fetchCaseSummary(caseId);
  } catch (error) {
    return answerOfFailure(error);
  }
  return {
    verdict: summary.isParticipant ? "participant" : "lost",
    failureStatus: null,
  };
}

/**
 * 画面の外の確かめ：概要を、キャッシュの外で直接1回取る（概要の Query が無くても確かめられ、表示中の画面の判定をこの答えで動かさない）。
 * 応答の検証の失敗・実装の例外は投げる。withFailureStatus を付けると、判定と根拠の HTTP の状態を返す（復元の守りだけが使う）
 */
export function verifyBySummaryFetch(
  caseId: string,
): Promise<CaseAccessVerdict>;
export function verifyBySummaryFetch(
  caseId: string,
  options: { withFailureStatus: true },
): Promise<CaseAccessFetchAnswer>;
export async function verifyBySummaryFetch(
  caseId: string,
  options?: { withFailureStatus: true },
): Promise<CaseAccessVerdict | CaseAccessFetchAnswer> {
  const answer = await fetchAnswer(caseId);
  return options?.withFailureStatus === true ? answer : answer.verdict;
}
