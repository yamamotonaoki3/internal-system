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
import {
  announceCaseAccessLoss,
  requestAccessLossReload,
} from "../../access-loss";
import { messageKeys } from "../../messages";
import type { CaseSummary } from "../api/case-api";
import { caseKeys } from "../api/query-keys";
import { isApiError } from "../describe-error";
import {
  forgetCaseAfterLeave,
  forgetCaseContent,
  forgetCaseInLists,
  forgetCaseRoomDraftsAfterLoss,
  invalidateCaseLists,
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

/**
 * 読み込み直しを求めるのは、この画面で参加者だったことを見た後に外されたと分かったときだけ（片付けの後に呼ぶ。#338・C-206）。
 * 持ち主は、確定を始めた時点の利用者（この部品の userId。利用者が替わると部品ごと作り直される）
 */
function requestReloadOnce(
  requested: { current: boolean },
  queryClient: QueryClient,
  userId: string,
): void {
  if (requested.current) return;
  requested.current = true;
  void requestAccessLossReload(queryClient, {
    ownerId: userId,
    reason: "lost",
  });
}

/**
 * 確定した喪失を、ほかのタブへ1回だけ知らせる（#341）。読み込み直しの予約の印（reloadRequested）とは分ける：
 * 確かめられない（unverified）で予約した後に確定した場合も、送るため。入口の後・下書きの消去の前に呼ぶ（送る処理は投げない）
 */
function announceLossOnce(
  announced: { current: boolean },
  userId: string,
  caseId: string,
): void {
  if (announced.current) return;
  announced.current = true;
  announceCaseAccessLoss({ userId, caseId });
}

export function useCaseAccessLoss({
  caseId,
  userId,
  roomId,
  participantRoomId = null,
  isParticipant,
  outsider = !isParticipant,
  onLost,
}: {
  caseId: string;
  userId: string;
  roomId: string | null;
  /**
   * 参加者の概要の部屋の ID（非参加・概要がないときは null）。詳細を受け取れないまま外されても、下書きを消せるように（#340）。
   * 本番の呼び出しは必ず渡す。省くと、詳細の部屋の ID だけで決める
   */
  participantRoomId?: string | null;
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
  // 同じ参加の期間の中で、読み込み直しを1回だけ求める印（(a) の確かめと (b) の効果の両方が喪失を見るため。#338）
  const reloadRequested = useRef(false);
  // 同じ参加の期間の中で、確定した喪失をほかのタブへ1回だけ知らせた印（#341）。確定のときだけ立て、参加者に戻ったときだけ外す
  const lossAnnounced = useRef(false);
  // 最後に分かった、この案件の部屋の ID（#340）。喪失の片付けで詳細が消え、非参加の概要には部屋の ID がないため、消す前に覚えておく
  const knownRoomId = useRef<string | null>(null);

  // 印を外すのは、参加者に戻ったと分かったときだけ（詳細の取得の成功では外さない：参加者のままの 403 で循環するため）
  // 概要で参加者でないことが確かめられたら（成功して非参加・404）、この画面で参加者だったかに関わらず、参加者だけの中身
  // （forgetCaseContent の対象）を取り除く（149-C・#323・#363）。一覧は、参加者だったと見ていたかで扱いを分ける（下の分岐）。
  // 参加者だった記録を作り直しをまたいで持たない：離れている間に概要が非参加に置き換わると、記録が残らないため（#363）。
  // 5xx・通信の失敗（outsider が偽）では片付けない（#363 AC-1）。
  // 拒否を契機にする確かめ（下の購読）は概要が既に非参加だと動かないため、ここで受ける。
  // この効果は、それらの部品が外れた後に走るため、拒否を契機にした片付けの後に部品が作り直したキーも、ここで消える
  useEffect(() => {
    // 片付けより前に覚える（片付けの後の描画では、どちらも null になりうる）
    knownRoomId.current = roomId ?? participantRoomId ?? knownRoomId.current;
    if (isParticipant && !previousParticipant.current) {
      handling.current = false;
      reloadRequested.current = false;
      lossAnnounced.current = false;
    }
    if (isParticipant) participantSeen.current = true;
    const wasParticipant = participantSeen.current;
    const lostHere = outsider && wasParticipant;
    if (lostHere) {
      participantSeen.current = false;
      onLost();
    }
    if (outsider && !previousOutsider.current) {
      void forgetCaseContent(queryClient, userId, caseId, roomId);
      // 一覧の行を直すのは、この画面で参加者だったと見ていたときだけ。見ていない非参加（作り直しの後・最初から非参加）は、
      // 古い概要のキャッシュかもしれず、それを根拠に行を外すと、参加者のままのとき戻らない（#363 コードレビュー3回目）。
      // その場合は、一覧に古い印だけを付け、サーバーの答えで取り直させる
      if (wasParticipant) void forgetCaseInLists(queryClient, userId, caseId);
      else void invalidateCaseLists(queryClient, userId);
    }
    previousOutsider.current = outsider;
    previousParticipant.current = isParticipant;
    if (lostHere) {
      requestReloadOnce(reloadRequested, queryClient, userId);
      announceLossOnce(lossAnnounced, userId, caseId);
      // この画面で参加者だったと見た後の喪失に限る（見ていない非参加は、古い概要かもしれず、消すと戻らない）。想定外の例外は境界まで伝える
      forgetCaseRoomDraftsAfterLoss(userId, knownRoomId.current);
    }
  }, [
    isParticipant,
    outsider,
    onLost,
    queryClient,
    userId,
    caseId,
    roomId,
    participantRoomId,
  ]);

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
        // 確かめの応答の前に画面を離れていても、読み込み直す（利用者の決定 2026-11-21）。同じ案件の画面が作り直されて表示中でも呼ぶ
        // （その画面に新しい拒否が届くとは限らない）。重なった要求は、入口が同じ持ち主の待機に合流する（#338）
        if (verdict !== "participant")
          requestReloadOnce(reloadRequested, queryClient, userId);
        // 確かめられない（unverified）ときは、参加者のままかもしれないので消さない（利用者の決定 2026-11-22 の Q2）
        if (verdict === "lost" || verdict === "notFound") {
          announceLossOnce(lossAnnounced, userId, caseId);
          forgetCaseRoomDraftsAfterLoss(userId, knownRoomId.current);
        }
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
        requestReloadOnce(reloadRequested, queryClient, userId);
        announceLossOnce(lossAnnounced, userId, caseId);
        forgetCaseRoomDraftsAfterLoss(userId, knownRoomId.current);
        return;
      }
      // 概要は書き換えない：404 は既存の概要の失敗の表示に、確かめられないときは unverified の表示に任せる
      setUnverified(verdict === "unverified");
      void forgetCaseContent(queryClient, userId, caseId, roomId);
      requestReloadOnce(reloadRequested, queryClient, userId);
      if (verdict === "notFound") {
        announceLossOnce(lossAnnounced, userId, caseId);
        forgetCaseRoomDraftsAfterLoss(userId, knownRoomId.current);
      }
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
