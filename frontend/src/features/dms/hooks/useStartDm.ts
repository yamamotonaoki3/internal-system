// DM を始める。成功したら DM のキー全体を取り直す（サイドバー・一覧に再読み込みなしで出る）。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { startDm } from "../api/dm-api";
import { dmKeys } from "../api/query-keys";

export function useStartDm() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (partnerUserId: string) => startDm(partnerUserId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dmKeys.all }),
  });
}
