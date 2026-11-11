// ステータスの代理設定。成功したら、一覧・カード・自分の画面を取り直す（再読込なしで反映する）。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { UserStatusKind } from "../../../../../shared/profile-rules";
import { profileKeys } from "../../profile";
import { setMemberStatus } from "../api/member-api";

export function useSetMemberStatus(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { status: UserStatusKind; returnAt?: string }) =>
      setMemberStatus(userId, input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: profileKeys.all }),
  });
}
