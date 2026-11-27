// ほかのタブで確定した資格の喪失の合図を受けたタブの処理（#341・利用者の決定 Q1〜Q5）。合図は「確かめのきっかけ」にだけ使う。
// 合図の利用者とセッションのキャッシュの利用者が同じで、その案件の参加者の概要、または同じ案件の部屋・スレッドの取得の実績（#339。C-210）を
// キャッシュに持つときだけ、概要をキャッシュの外で1回取り、
// 非参加・404 なら、入口で画面を隠して読み込み直す（知らせは lost）。片付け・下書きの消去・合図の送り返しはしない：
// 同じ Cookie を共有するタブでは、答えを返した利用者が画面の利用者と同じとは限らず（#298）、消すと戻らないため。読み込み直しで文書ごと消える。
// 概要をキャッシュに書かないのは、表示中の画面の判定（useCaseAccessLoss）を、この答えで動かさないため。
import type { QueryClient } from "@tanstack/react-query";
import {
  getAccessLossReloadState,
  requestAccessLossReload,
  subscribeCaseAccessLoss,
  type CaseAccessLossHint,
} from "../access-loss";
import { fetchCaseSummary, type CaseSummary } from "./api/case-api";
import { caseKeys } from "./api/query-keys";
import { caseRoomEvidence, sessionUserId } from "./case-access-evidence";
import { isApiError } from "./describe-error";

type HintedVerdict = "outsider" | "participant" | "unknown";

/** API の失敗（5xx・403・401・通信の失敗）は分からないとして扱う。それ以外（応答の検証の失敗・実装の例外）は投げる */
async function judgeHintedSummary(caseId: string): Promise<HintedVerdict> {
  try {
    const summary = await fetchCaseSummary(caseId);
    return summary.isParticipant ? "participant" : "outsider";
  } catch (error) {
    if (!isApiError(error)) throw error;
    return error.status === 404 ? "outsider" : "unknown";
  }
}

/** 合図を受けてよい状態か（入口が待機・読み込み直しの最中でなく、セッションの利用者が合図の利用者と同じ） */
function mayRelay(queryClient: QueryClient, userId: string): boolean {
  return (
    getAccessLossReloadState() === "idle" &&
    sessionUserId(queryClient) === userId
  );
}

/** 合図の受信を登録する。返り値は解除の関数。アプリでは main.tsx で1回だけ呼ぶ */
export function installCaseAccessLossRelay(
  queryClient: QueryClient,
): () => void {
  // 同じ案件の確かめを重ねない印（終わったら外す）
  const verifying = new Set<string>();

  const relay = async ({ userId, caseId }: CaseAccessLossHint) => {
    if (!mayRelay(queryClient, userId)) return;
    const cached = queryClient.getQueryData<CaseSummary>(
      caseKeys.summary(userId, caseId),
    );
    if (
      cached?.isParticipant !== true &&
      caseRoomEvidence(queryClient, userId, caseId) === undefined
    )
      return;
    if (verifying.has(caseId)) return;
    verifying.add(caseId);
    try {
      const verdict = await judgeHintedSummary(caseId);
      // 確かめの間に、利用者が替わった・入口が動き出したなら、捨てる
      if (verdict !== "outsider" || !mayRelay(queryClient, userId)) return;
      void requestAccessLossReload(queryClient, {
        ownerId: userId,
        reason: "lost",
      });
    } finally {
      verifying.delete(caseId);
    }
  };

  return subscribeCaseAccessLoss((hint) => {
    relay(hint).catch((error: unknown) => reportError(error));
  });
}
