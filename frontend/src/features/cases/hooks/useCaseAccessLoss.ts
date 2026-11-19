// S-17 を開いたまま、ほかの参加者に外されたことを、自動の更新（部屋のメッセージ・TODO の取り直し）の 403・404 から見つける（#308）。
// 403・404 は参加者のままでも起こりうる（perm.case.view がない等）ので、それだけで決めず、概要を取り直した結果で決める。
// 401 は共通の処理（セッション切れ）に、5xx・通信の失敗は既存の表示とポーリングの続きに任せる（AC-3）。
// 部屋・TODO のポーリングは 403・404 で止まるため、概要の取り直しが失敗したときは次の契機がない。中身を隠して再試行を出す（安全な側）。
import {
  matchQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { messageKeys } from "../../messages";
import type { CaseSummary } from "../api/case-api";
import { caseKeys } from "../api/query-keys";
import { isApiError } from "../describe-error";
import { forgetCaseAfterLeave, forgetCaseContent } from "./useCaseWrites";

const ACCESS_LOSS_STATUSES: readonly number[] = [403, 404];

type Verdict = "participant" | "lost" | "notFound" | "unverified";

async function verifyParticipant(
  queryClient: QueryClient,
  summaryKey: ReturnType<typeof caseKeys.summary>,
): Promise<Verdict> {
  try {
    await queryClient.refetchQueries(
      { queryKey: summaryKey, exact: true },
      { throwOnError: true },
    );
  } catch (cause) {
    // 失敗の結果は判定に使い、表示は呼び出し側（確かめられない表示・概要の失敗の表示）が出す
    if (isApiError(cause) && cause.status === 404) return "notFound";
    return "unverified";
  }
  return queryClient.getQueryData<CaseSummary>(summaryKey)?.isParticipant ===
    true
    ? "participant"
    : "lost";
}

export function useCaseAccessLoss({
  caseId,
  userId,
  roomId,
  isParticipant,
  onLost,
}: {
  caseId: string;
  userId: string;
  roomId: string | null;
  isParticipant: boolean;
  /** 中身を描かなくなるとき（開いているダイアログを閉じる）。参照が変わらない関数を渡す */
  onLost: () => void;
}) {
  const queryClient = useQueryClient();
  const [unverified, setUnverified] = useState(false);
  // 同じ参加の期間の中で、確かめ・後片付けを重ねない印（参加者のままの 403 で循環させないため）
  const handling = useRef(false);
  const previousParticipant = useRef(isParticipant);

  // 印を外すのは、参加者に戻ったと分かったときだけ（詳細の取得の成功では外さない：参加者のままの 403 で循環するため）
  useEffect(() => {
    if (isParticipant && !previousParticipant.current) handling.current = false;
    previousParticipant.current = isParticipant;
  }, [isParticipant]);

  // 画面を離れた後に届いた結果で、表示（状態・ダイアログ）や、移動先の部屋・スレッドのキャッシュに触れないため
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const settle = useRef<(verdict: Verdict, retried: boolean) => void>(
    () => undefined,
  );
  useEffect(() => {
    settle.current = (verdict, retried) => {
      if (!mounted.current) {
        // 元の案件の詳細・TODO だけを取り除く（戻ったときに古い内容を出さない。AC-2）。部屋・スレッドは、表示していないので残らない
        if (verdict === "lost")
          void forgetCaseAfterLeave(queryClient, userId, caseId);
        else if (verdict === "notFound")
          void forgetCaseContent(queryClient, userId, caseId);
        return;
      }
      if (verdict === "participant") {
        // 通常の確かめで参加者のままなら、印を残す（参加者のままの 403 が続いても、確かめを重ねない）
        if (retried) handling.current = false;
        setUnverified(false);
        return;
      }
      onLost();
      if (verdict === "lost") {
        setUnverified(false);
        void forgetCaseAfterLeave(queryClient, userId, caseId, roomId);
        return;
      }
      // 概要は書き換えない：404 は既存の概要の失敗の表示に、確かめられないときは unverified の表示に任せる
      setUnverified(verdict === "unverified");
      void forgetCaseContent(queryClient, userId, caseId, roomId);
    };
  }, [queryClient, userId, caseId, roomId, onLost]);

  useEffect(() => {
    const summaryKey = caseKeys.summary(userId, caseId);
    const watched = [
      caseKeys.todos(userId, caseId),
      ...(roomId === null ? [] : [messageKeys.room(roomId)]),
    ];
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "error") return;
      const { error } = event.action;
      if (!isApiError(error) || !ACCESS_LOSS_STATUSES.includes(error.status))
        return;
      if (!watched.some((queryKey) => matchQuery({ queryKey }, event.query)))
        return;
      if (handling.current) return;
      // 本人の退出の後片付けで、既に非参加になっている：確かめ直さない（退出の既存の動きのまま）
      if (
        queryClient.getQueryData<CaseSummary>(summaryKey)?.isParticipant !==
        true
      )
        return;
      handling.current = true;
      void verifyParticipant(queryClient, summaryKey).then((verdict) =>
        settle.current(verdict, false),
      );
    });
  }, [queryClient, userId, caseId, roomId]);

  return {
    unverified,
    retry() {
      void verifyParticipant(
        queryClient,
        caseKeys.summary(userId, caseId),
      ).then((verdict) => settle.current(verdict, true));
    },
  };
}
