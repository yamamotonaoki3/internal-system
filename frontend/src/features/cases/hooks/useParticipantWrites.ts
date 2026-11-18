// 参加者の追加・削除・退出の操作と、その結果（完了の表示・エラー）。S-17 のページの側（CaseDetailView）で持つ：
// 取り直しで非参加になり「参加者を管理」が消えても、結果の文を失わず、退出の後の移動も行う（コードレビュー1回目）。
// 422 は「社員の検索」の欄に、409・403 などは欄の外に出す。
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useSignedInUserId } from "../../auth";
import type { CaseParticipant } from "../api/case-api";
import { describeError, isApiError } from "../describe-error";
import {
  forgetCaseAfterLeave,
  useAddCaseParticipant,
  useRemoveCaseParticipant,
} from "./useCaseWrites";

export type ParticipantWrites = ReturnType<typeof useParticipantWrites>;

export function useParticipantWrites(caseId: string) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const userId = useSignedInUserId() ?? "";
  const add = useAddCaseParticipant(caseId);
  const remove = useRemoveCaseParticipant(caseId);
  const [updated, setUpdated] = useState(false);
  const [searchError, setSearchError] = useState<string>();
  const [error, setError] = useState<string>();
  const left = useRef(false);

  // 退出の成功の片付けは useRemoveCaseParticipant が行う。表示中に片付けると、表示の部品が印のない空の詳細を作り直すため、
  // 画面が外れたときにもう一度行う
  useEffect(
    () => () => {
      if (left.current) void forgetCaseAfterLeave(queryClient, userId, caseId);
    },
    [queryClient, userId, caseId],
  );

  function start() {
    setUpdated(false);
    setSearchError(undefined);
    setError(undefined);
  }

  return {
    busy: add.isPending || remove.isPending,
    removing: remove.isPending,
    updated,
    searchError,
    error,
    addUser(userId: string) {
      start();
      add.mutate(userId, {
        onSuccess: () => setUpdated(true),
        onError: (cause) => {
          if (isApiError(cause) && cause.status === 422)
            setSearchError(cause.message);
          else setError(describeError(cause));
        },
      });
    },
    /** 退出（self）に成功したら S-16 へ移る。onDone は成功・失敗のどちらでも呼ぶ */
    removeUser(
      participant: CaseParticipant,
      self: boolean,
      onDone: () => void,
    ) {
      start();
      remove.mutate(
        { userId: participant.userId, self, actorId: userId },
        {
          onSuccess: () => {
            if (!self) {
              setUpdated(true);
              return;
            }
            left.current = true;
            void navigate("/cases");
          },
          onError: (cause) => setError(describeError(cause)),
          onSettled: onDone,
        },
      );
    },
  };
}
