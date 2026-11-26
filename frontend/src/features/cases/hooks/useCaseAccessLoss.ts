// S-17 を開いたまま、ほかの参加者に外されたことを、自動の更新（部屋のメッセージ・TODO の取り直し）と、
// 添付の一覧の取り直し（公開範囲の変更の後など。#148）、TODO の履歴・削除済みの一覧の取り直し（149-C）の 403・404 から見つける（#308）。
// 403・404 は参加者のままでも起こりうる（perm.case.view がない等）ので、それだけで決めず、概要を取り直した結果で決める。
// 401 は共通の処理（セッション切れ）に、5xx・通信の失敗は既存の表示とポーリングの続きに任せる（AC-3）。
// 部屋・TODO のポーリングは 403・404 で止まるため、概要の取り直しが失敗したときは次の契機がない。中身を隠して再試行を出す（安全な側）。
// 概要の取り直しが 409 SESSION_USER_MISMATCH（画面の利用者とセッションの利用者の食い違い。#298・#376）なら、409 の後のセッションの取り直しを待ち、
// 切り替えの入口が動いたと確かめられたときだけ何もしない（文書ごと替わる）。それ以外は確かめられない（unverified）に倒す（Q14）。
// 拒否のきっかけは、全体の見張り（case-access-loss-monitor.ts）が1つの購読で受け、この画面の担当として登録した処理へ渡す（#339）。
// 概要を一度も取得していない画面の初回の概要が非参加・404 でも、その案件の部屋・スレッドの取得の実績があれば、喪失として確定する（#339。C-210）。
import {
  hashKey,
  isCancelledError,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { requestAccessLossReload } from "../../access-loss";
import {
  caseRoomIdFromEvidence,
  hasCaseRoomEvidence,
  sessionUserId,
} from "../case-access-evidence";
import {
  announceCaseAccessLossOnce,
  claimCaseVerification,
  type CaseAccessLossRoute,
  currentLossPeriod,
  forgetCaseRoomDraftsOnce,
  installCaseAccessLossMonitor,
  registerCaseAccessLossHandler,
  startCaseParticipationPeriod,
} from "../case-access-loss-monitor";
import {
  isCaseNotFound,
  verifyBySummaryRefetch,
  type CaseAccessVerdict,
} from "../case-access-verification";
import type { CaseSummary } from "../api/case-api";
import { caseKeys } from "../api/query-keys";
import {
  forgetCaseAfterLeave,
  forgetCaseContent,
  forgetCaseInLists,
  invalidateCaseLists,
} from "./useCaseWrites";

export { isCaseNotFound };

type Verdict = CaseAccessVerdict;

/**
 * 読み込み直しを求めるのは、この画面で参加者だったことを見た後に外されたと分かったときと、その案件の部屋・スレッドの取得の実績が
 * ある初回の非参加・404 のとき（片付けの後に呼ぶ。#338・C-206・C-210）。
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
 * 確かめを始めた時点の参加の期間（遅れて届いた答えで、新しい期間の合図・下書きの印を使わせないため）と、確かめの経路
 * （list：スレッド一覧の行の消失。確かめられない・参加者のままなら、何もしない。計画 3 節）。
 * 利用者の世代では捨てない：この部品のキャッシュのキーと下書きは、確定を始めた利用者のもので、切り替えの後も、その利用者の分を片付ける（#338 P-11・#340 AC-2）
 */
type VerificationContext = { period: number; route: CaseAccessLossRoute };

/** 確定した喪失の、合図と下書きの処理（どちらも、同じ参加の期間で1回だけ。入口の後に呼ぶ） */
function confirmLossOnce(
  queryClient: QueryClient,
  userId: string,
  caseId: string,
  roomId: string | null,
  period: number,
): void {
  announceCaseAccessLossOnce(queryClient, userId, caseId, period);
  forgetCaseRoomDraftsOnce(queryClient, userId, caseId, roomId, period);
}

function verificationContext(
  queryClient: QueryClient,
  userId: string,
  caseId: string,
  route: CaseAccessLossRoute,
): VerificationContext {
  return { period: currentLossPeriod(queryClient, userId, caseId), route };
}

/**
 * 初回の非参加・404 を確定してよいか：いまのセッションの利用者がこの画面の利用者で、その案件の部屋・スレッドの取得の実績がある。
 * 確定してよければ、実績から分かる部屋の ID（分からなければ null）、だめなら undefined
 */
function confirmedByEvidence(
  queryClient: QueryClient,
  userId: string,
  caseId: string,
  /** 参加者だったことを見ていないまま、参加者でないと確かめられた状態になった */
  firstOutsider: boolean,
): string | null | undefined {
  if (
    !firstOutsider ||
    sessionUserId(queryClient) !== userId ||
    !hasCaseRoomEvidence(queryClient, userId, caseId)
  )
    return undefined;
  return caseRoomIdFromEvidence(queryClient, caseId);
}

/** 概要で参加者でないと確かめられた状態に「なったとき」の片付け（149-C・#323・#363） */
function forgetAsOutsider(
  queryClient: QueryClient,
  userId: string,
  caseId: string,
  roomId: string | null,
  wasParticipant: boolean,
): void {
  void forgetCaseContent(queryClient, userId, caseId, roomId);
  // 一覧の行を直すのは、この画面で参加者だったと見ていたときだけ。見ていない非参加（作り直しの後・最初から非参加）は、
  // 古い概要のキャッシュかもしれず、それを根拠に行を外すと、参加者のままのとき戻らない（#363 コードレビュー3回目）。
  // その場合は、一覧に古い印だけを付け、サーバーの答えで取り直させる
  if (wasParticipant) void forgetCaseInLists(queryClient, userId, caseId);
  else void invalidateCaseLists(queryClient, userId);
}

/**
 * 実績で確定した初回の片付け（#339。C-210）。スレッドは、ほかの部屋の表示中のものを巻き込まないよう、この部屋のものだけ（"room"）。
 * 404 は、概要・案件一覧を非参加に書き換えない
 */
function forgetConfirmedOutsider(
  queryClient: QueryClient,
  userId: string,
  caseId: string,
  roomId: string | null,
  verdict: "lost" | "notFound",
): void {
  if (verdict === "lost") {
    void forgetCaseAfterLeave(queryClient, userId, caseId, roomId, "room");
    return;
  }
  void forgetCaseContent(queryClient, userId, caseId, roomId, "room");
  void invalidateCaseLists(queryClient, userId);
}

/** 概要の Query の状態の判定（取得の答えとして読む） */
function verdictOfSummaryState(
  data: CaseSummary | undefined,
  error: unknown,
): Verdict {
  if (error !== null && error !== undefined)
    return isCaseNotFound(error) ? "notFound" : "unverified";
  return data?.isParticipant === true ? "participant" : "lost";
}

/**
 * この部品が開いてから、取得で届いた概要の答え（手での書き換え・取り消しでない成功か失敗）を受け取る仕組み
 * （初回の確定に使ってよいのは、取得して届いた答えだけ。開いた時点でキャッシュにあっただけの状態・手で書いたデータは使わない。計画 3 節の補足）
 */
type FreshSummary = {
  /** 最後に届いた答え（手での書き換え・Query の削除で捨てる） */
  answer: Verdict | null;
  /** 答えを待っている確定（届いたら1回だけ呼んで外す） */
  waiter: ((verdict: Verdict) => void) | null;
};

/** 届いた答えを受け取る。届いていなければ、届いたときに受け取る（待ち） */
function whenFreshSummary(
  fresh: FreshSummary,
  onAnswer: (verdict: Verdict) => void,
): void {
  if (fresh.answer !== null) {
    onAnswer(fresh.answer);
    return;
  }
  fresh.waiter = onAnswer;
}

/** 概要の Query の出来事から、取得で届いた答えを控える。返り値は購読の解除（待ちも外す） */
function watchFreshSummary(
  queryClient: QueryClient,
  summaryKey: ReturnType<typeof caseKeys.summary>,
  fresh: FreshSummary,
): () => void {
  const summaryHash = hashKey(summaryKey);
  const stop = queryClient.getQueryCache().subscribe((event) => {
    if (event.query.queryHash !== summaryHash) return;
    if (event.type === "removed") {
      fresh.answer = null;
      return;
    }
    if (event.type !== "updated") return;
    const { action } = event;
    let answer: Verdict;
    if (action.type === "success") {
      if (action.manual === true) {
        fresh.answer = null;
        return;
      }
      answer = verdictOfSummaryState(action.data as CaseSummary, null);
    } else if (action.type === "error" && !isCancelledError(action.error))
      answer = verdictOfSummaryState(undefined, action.error);
    else return;
    fresh.answer = answer;
    const waiter = fresh.waiter;
    fresh.waiter = null;
    waiter?.(answer);
  });
  return () => {
    stop();
    fresh.answer = null;
    fresh.waiter = null;
  };
}

/**
 * 実績がある初回の非参加・404（#339。C-210）：概要の新しい答えで確定する。部屋の ID は、片付けより前に決めて渡す（N-3）。
 * 新しい答えが参加者・確かめられないなら、この契機からは確定しない
 */
function confirmFirstOutsider(
  queryClient: QueryClient,
  userId: string,
  caseId: string,
  roomOfCase: string | null,
  reloadRequested: { current: boolean },
  fresh: FreshSummary,
): void {
  const period = currentLossPeriod(queryClient, userId, caseId);
  whenFreshSummary(fresh, (verdict) => {
    if (verdict !== "lost" && verdict !== "notFound") return;
    // 待つ間に、別の利用者に替わった・参加者に戻った：古い答えで確定しない
    if (
      sessionUserId(queryClient) !== userId ||
      currentLossPeriod(queryClient, userId, caseId) !== period
    )
      return;
    forgetConfirmedOutsider(queryClient, userId, caseId, roomOfCase, verdict);
    requestReloadOnce(reloadRequested, queryClient, userId);
    confirmLossOnce(queryClient, userId, caseId, roomOfCase, period);
  });
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
  // 確定した喪失をほかのタブへ知らせた印（#341）と、下書きの処理の印は、見張りが利用者・案件ごとに持つ
  // （画面の外の確定・作り直した画面と1回にまとめるため。#339）。この部品では、参加者に戻ったときだけ、参加の期間を進めて外す
  // 最後に分かった、この案件の部屋の ID（#340）。喪失の片付けで詳細が消え、非参加の概要には部屋の ID がないため、消す前に覚えておく
  const knownRoomId = useRef<string | null>(null);
  // この部品が開いてから取得で届いた概要の答えと、その答えを待つ初回の確定（#339）
  const freshSummary = useRef<FreshSummary>({ answer: null, waiter: null });
  // 答えを控える購読は、下の効果より先に設ける。画面を外したとき・案件や利用者が替わったときに外し、待ちも捨てる
  useEffect(
    () =>
      watchFreshSummary(
        queryClient,
        caseKeys.summary(userId, caseId),
        freshSummary.current,
      ),
    [queryClient, userId, caseId],
  );

  // 印を外すのは、参加者に戻ったと分かったときだけ（詳細の取得の成功では外さない：参加者のままの 403 で循環するため）
  // 概要で参加者でないことが確かめられたら（成功して非参加・404）、この画面で参加者だったかに関わらず、参加者だけの中身
  // （forgetCaseContent の対象）を取り除く（149-C・#323・#363）。一覧は、参加者だったと見ていたかで扱いを分ける（下の分岐）。
  // 参加者だった記録を作り直しをまたいで持たない：離れている間に概要が非参加に置き換わると、記録が残らないため（#363）。
  // 5xx・通信の失敗（outsider が偽）では片付けない（#363 AC-1）。
  // 拒否を契機にする確かめ（下の担当の登録）は概要が既に非参加だと動かないため、ここで受ける。
  // この効果は、それらの部品が外れた後に走るため、拒否を契機にした片付けの後に部品が作り直したキーも、ここで消える
  useEffect(() => {
    // 片付けより前に覚える（片付けの後の描画では、どちらも null になりうる）
    knownRoomId.current = roomId ?? participantRoomId ?? knownRoomId.current;
    if (isParticipant && !previousParticipant.current) {
      handling.current = false;
      reloadRequested.current = false;
      startCaseParticipationPeriod(queryClient, userId, caseId);
    }
    if (isParticipant) participantSeen.current = true;
    const wasParticipant = participantSeen.current;
    const lostHere = outsider && wasParticipant;
    if (lostHere) {
      participantSeen.current = false;
      onLost();
    }
    const becameOutsider = outsider && !previousOutsider.current;
    // 初回の非参加・404 でも、その案件の部屋・スレッドの取得の実績があれば確定する（#339。C-210）。
    // 実績の判定と部屋の ID の読み取りは、片付けより前（片付けで返信・一覧の行が消えるため。N-3）
    const evidenceRoomId = confirmedByEvidence(
      queryClient,
      userId,
      caseId,
      becameOutsider && !wasParticipant,
    );
    if (becameOutsider)
      forgetAsOutsider(queryClient, userId, caseId, roomId, wasParticipant);
    if (evidenceRoomId !== undefined) {
      knownRoomId.current ??= evidenceRoomId;
      confirmFirstOutsider(
        queryClient,
        userId,
        caseId,
        knownRoomId.current,
        reloadRequested,
        freshSummary.current,
      );
    }
    previousOutsider.current = outsider;
    previousParticipant.current = isParticipant;
    if (lostHere) {
      requestReloadOnce(reloadRequested, queryClient, userId);
      // 参加者だったと見た後の喪失に限る（見ていない非参加は、古い概要かもしれず、消すと戻らない。実績がある初回は confirmFirstOutsider）。
      // 想定外の例外は境界まで伝える
      confirmLossOnce(
        queryClient,
        userId,
        caseId,
        knownRoomId.current,
        currentLossPeriod(queryClient, userId, caseId),
      );
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

  const settle = useRef<
    (verdict: Verdict, retried: boolean, context: VerificationContext) => void
  >(() => undefined);
  useEffect(() => {
    const confirmLoss = (period: number) =>
      confirmLossOnce(queryClient, userId, caseId, knownRoomId.current, period);
    settle.current = (verdict, retried, { period, route }) => {
      // 文書ごと読み込み直すので、片付け・読み込み直しの予約・合図・下書きの消去・表示の切り替えをしない
      if (verdict === "switched") return;
      // 一覧の行の消失からの確かめは、確定したときだけ動く（次のきっかけを受けられるよう、印も立てない）
      if (
        route === "list" &&
        (verdict === "unverified" || verdict === "participant")
      )
        return;
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
          confirmLoss(period);
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
        confirmLoss(period);
        return;
      }
      // 概要は書き換えない：404 は既存の概要の失敗の表示に、確かめられないときは unverified の表示に任せる
      setUnverified(verdict === "unverified");
      void forgetCaseContent(queryClient, userId, caseId, roomId);
      requestReloadOnce(reloadRequested, queryClient, userId);
      if (verdict === "notFound") {
        confirmLoss(period);
      }
    };
  }, [queryClient, userId, caseId, roomId, onLost]);

  // 見張りを冪等に設け（main.tsx の登録が無い画面のテストでも動くように）、この画面を、利用者・案件の担当として登録する
  useEffect(() => installCaseAccessLossMonitor(queryClient), [queryClient]);
  useEffect(() => {
    const summaryKey = caseKeys.summary(userId, caseId);
    return registerCaseAccessLossHandler(queryClient, {
      userId,
      caseId,
      roomId,
      onDenied: (route) => {
        if (handling.current) return;
        // 本人の退出の後片付けで、既に非参加になっている：確かめ直さない（退出の既存の動きのまま）
        if (
          queryClient.getQueryData<CaseSummary>(summaryKey)?.isParticipant !==
          true
        )
          return;
        // 同じ利用者・案件の確かめは1つ（始めた側が、画面を離れた後も最後まで処理する）
        // 進行中なら、中身の拒否の経路だけを引き継ぐ
        const verification = claimCaseVerification(
          queryClient,
          userId,
          caseId,
          route,
        );
        if (verification === null) return;
        // 中身の拒否の確かめの間と、参加者のままと分かった後は、拒否で確かめを重ねない（行の消失は印を立てない）
        if (route === "content") handling.current = true;
        const { period } = verificationContext(
          queryClient,
          userId,
          caseId,
          route,
        );
        void verifyBySummaryRefetch(queryClient, summaryKey)
          .then((verdict) => {
            if (verification.route === "content") handling.current = true;
            settle.current(verdict, false, {
              period,
              route: verification.route,
            });
          })
          .finally(verification.release);
      },
    });
  }, [queryClient, userId, caseId, roomId]);

  return {
    unverified,
    retry() {
      const context = verificationContext(
        queryClient,
        userId,
        caseId,
        "content",
      );
      void verifyBySummaryRefetch(
        queryClient,
        caseKeys.summary(userId, caseId),
      ).then((verdict) => settle.current(verdict, true, context));
    },
  };
}
