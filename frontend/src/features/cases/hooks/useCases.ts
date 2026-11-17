// 案件の一覧・概要・詳細の取得。利用者の ID が確かめられる前は取得しない（キーに入れる ID がないため）。
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useSignedInUserId } from "../../auth";
import {
  fetchCaseDetail,
  fetchCases,
  fetchCaseSummary,
  type CaseListScope,
  type CaseStatus,
} from "../api/case-api";
import { CASE_KEY_USER_ID_INDEX, caseKeys } from "../api/query-keys";

export function useCases(scope: CaseListScope, status: CaseStatus) {
  const userId = useSignedInUserId();
  return useInfiniteQuery({
    queryKey: caseKeys.list(userId ?? "", scope, status),
    enabled: userId !== undefined,
    queryFn: ({ pageParam }) => fetchCases(scope, status, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // 切り替えたとき、新しい一覧が届くまで前の一覧を見せる（読み込み中の表示でちらつかせない）。
    // 利用者が替わったときは、前の利用者の一覧を見せない
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[CASE_KEY_USER_ID_INDEX] === (userId ?? "")
        ? previousData
        : undefined,
    retry: false,
  });
}

export function useCaseSummary(caseId: string) {
  const userId = useSignedInUserId();
  return useQuery({
    queryKey: caseKeys.summary(userId ?? "", caseId),
    enabled: userId !== undefined,
    queryFn: () => fetchCaseSummary(caseId),
    retry: false,
  });
}

/** 詳細は有効な参加者だけが取れる。概要で参加者と分かったときだけ取る */
export function useCaseDetail(caseId: string, isParticipant: boolean) {
  const userId = useSignedInUserId();
  return useQuery({
    queryKey: caseKeys.detail(userId ?? "", caseId),
    enabled: userId !== undefined && isParticipant,
    queryFn: () => fetchCaseDetail(caseId),
    retry: false,
  });
}
