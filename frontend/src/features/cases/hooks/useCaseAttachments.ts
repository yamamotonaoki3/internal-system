// 案件の添付の一覧の取得（#148。EP-5-19）。ポーリングしない（一覧のリアルタイムの更新は #117）。
// 自分の添付つきの投稿の成功で取り直す（CaseConversation）。
import { useInfiniteQuery } from "@tanstack/react-query";
import { useSignedInUserId } from "../../auth";
import { fetchCaseAttachments } from "../api/case-api";
import { caseKeys } from "../api/query-keys";

/** 有効な参加者で、詳細が取れたときだけ取る */
export function useCaseAttachments(caseId: string, enabled: boolean) {
  const userId = useSignedInUserId();
  return useInfiniteQuery({
    queryKey: caseKeys.attachments(userId ?? "", caseId),
    enabled: userId !== undefined && enabled,
    queryFn: ({ pageParam }) => fetchCaseAttachments(caseId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
}
