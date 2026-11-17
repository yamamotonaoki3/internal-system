// 退職処理の申請の読み取り（自分の申請・全体管理者の一覧）と書き込み（申請・取り下げ・却下）。
// 却下は再認証が必要（期限内なら省略）。申請・取り下げは求めない。成功したら申請の一覧と社員一覧を取り直す（自分の操作で自分の通知は増えないため、通知は取り直さない）。
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { sendWithReauth } from "../../accounts";
import { useReauth, useSignedInUserId } from "../../auth";
import { profileKeys } from "../../profile";
import {
  createRetirementRequest,
  fetchMyRetirementRequests,
  fetchReviewRetirementRequests,
  rejectRetirementRequest,
  withdrawRetirementRequest,
  type RetirementRequestStatus,
} from "../api/retirement-request-api";
import { retirementRequestKeys } from "../api/query-keys";

async function invalidateAfterWrite(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: retirementRequestKeys.all }),
    queryClient.invalidateQueries({ queryKey: profileKeys.all }),
  ]);
}

// 利用者の ID が確かめられる前は取得しない（キーに入れる ID がないため）
export function useMyRetirementRequests() {
  const userId = useSignedInUserId();
  return useInfiniteQuery({
    queryKey: retirementRequestKeys.mine(userId ?? ""),
    enabled: userId !== undefined,
    queryFn: ({ pageParam }) => fetchMyRetirementRequests(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
}

export function useReviewRetirementRequests(status: RetirementRequestStatus) {
  const userId = useSignedInUserId();
  return useInfiniteQuery({
    queryKey: retirementRequestKeys.review(userId ?? "", status),
    enabled: userId !== undefined,
    queryFn: ({ pageParam }) =>
      fetchReviewRetirementRequests(status, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
}

export function useCreateRetirementRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (targetUserId: string) => createRetirementRequest(targetUserId),
    onSuccess: () => invalidateAfterWrite(queryClient),
  });
}

export function useRejectRetirementRequest() {
  const queryClient = useQueryClient();
  const { withReauth } = useReauth();
  return useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      sendWithReauth(withReauth, "退職処理の申請の却下", () =>
        rejectRetirementRequest(input.id, input.reason),
      ),
    onSuccess: () => invalidateAfterWrite(queryClient),
  });
}

export function useWithdrawRetirementRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => withdrawRetirementRequest(id),
    onSuccess: () => invalidateAfterWrite(queryClient),
  });
}

/** 無効化（features/accounts）で申請が完了になった後に、申請の一覧を取り直す */
export function useInvalidateRetirementRequests() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: retirementRequestKeys.all });
}
