// S-17 を開いたまま、ほかの参加者に外されたことを、自動の更新（部屋のメッセージ・TODO の取り直し）と、
// 添付の一覧の取り直し（公開範囲の変更の後など。#148）、TODO の履歴・削除済みの一覧の取り直し（149-C）の 403・404 から見つける（#308）。
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
import {
  forgetCaseAfterLeave,
  forgetCaseContent,
  forgetCaseInLists,
} from "./useCaseWrites";

const ACCESS_LOSS_STATUSES: readonly number[] = [403, 404];

/** 案件が見つからない（404）。概要の取り直しの失敗のうち、資格を失った証拠になるのはこれだけ（5xx・通信の失敗は含まない） */
export function isCaseNotFound(error: unknown): boolean {
  return isApiError(error) && error.status === 404;
}

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
    if (isCaseNotFound(cause)) return "notFound";
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
  outsider = !isParticipant,
  onLost,
}: {
  caseId: string;
  userId: string;
  roomId: string | null;
  isParticipant: boolean;
  /**
   * 概要が、成功して非参加、または 404 で失敗している（参加者でないことが確かめられた）。概要の取り直しが 5xx・通信の失敗のときは偽（#363）。
   * 本番の呼び出しは必ず渡す。省くと、非参加（!isParticipant）と同じ扱い
   */
  outsider?: boolean;
  /** 中身を描かなくなるとき（開いているダイアログを閉じる）。参照が変わらない関数を渡す */
  onLost: () => void;
}) {
  const queryClient = useQueryClient();
  const [unverified, setUnverified] = useState(false);
  // 同じ参加の期間の中で、確かめ・後片付けを重ねない印（参加者のままの 403 で循環させないため）
  const handling = useRef(false);
  const previousParticipant = useRef(isParticipant);
  // この画面で参加者としての概要を受け取ったか（資格を失ったことの表示・ダイアログを閉じる onLost の条件）。
  // 概要が一時的に失敗しても（5xx・通信の失敗）、資格を失ったとは見なさず、印は残す
  const participantSeen = useRef(isParticipant);
  // 片付けを、参加者でないと確かめられた状態に「なったとき」だけ走らせる印。偽から始め、作られた時点で既に確かめられていても1回片付ける
  const previousOutsider = useRef(false);

  // 印を外すのは、参加者に戻ったと分かったときだけ（詳細の取得の成功では外さない：参加者のままの 403 で循環するため）
  // 概要で参加者でないことが確かめられたら（成功して非参加・404）、この画面で参加者だったかに関わらず、参加者だけの中身
  // （forgetCaseContent の対象）を取り除き、一覧のこの案件の行から参加者だけの項目を消す（149-C・#323・#363）。
  // 参加者だった記録を作り直しをまたいで持たない：離れている間に概要が非参加に置き換わると、記録が残らないため（#363）。
  // 一覧の行も消す：非参加が確かめられた時点で、一覧に残る参加者だけの値（最終更新・部屋の ID、参加中の行）を、前に参加者だったかで区別できないため。
  // 5xx・通信の失敗（outsider が偽）では片付けない（#363 AC-1）。
  // 拒否を契機にする確かめ（下の購読）は概要が既に非参加だと動かないため、ここで受ける。
  // この効果は、それらの部品が外れた後に走るため、拒否を契機にした片付けの後に部品が作り直したキーも、ここで消える
  useEffect(() => {
    if (isParticipant && !previousParticipant.current) handling.current = false;
    if (isParticipant) participantSeen.current = true;
    if (outsider && participantSeen.current) {
      participantSeen.current = false;
      onLost();
    }
    if (outsider && !previousOutsider.current) {
      void forgetCaseContent(queryClient, userId, caseId, roomId);
      void forgetCaseInLists(queryClient, userId, caseId);
    }
    previousOutsider.current = outsider;
    previousParticipant.current = isParticipant;
  }, [isParticipant, outsider, onLost, queryClient, userId, caseId, roomId]);

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
        // 非参加・404・確かめられないときは、元の案件の中身を取り除く（戻ったときに古い内容を出さない。AC-2）。部屋の分も、ほかの機能のキャッシュに残りうる（#323）。
        // スレッドは、移動先のものを巻き込まないよう、この部屋のものだけ（"room"）
        if (verdict === "lost")
          void forgetCaseAfterLeave(
            queryClient,
            userId,
            caseId,
            roomId,
            "room",
          );
        else if (verdict !== "participant")
          void forgetCaseContent(queryClient, userId, caseId, roomId, "room");
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
      caseKeys.attachments(userId, caseId),
      caseKeys.deletedTodos(userId, caseId),
      // 履歴は TODO ごとのキーなので、案件までの前方一致（matchQuery は exact なしで前方一致）
      caseKeys.caseTodoEvents(userId, caseId),
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
