// ログアウト。成功したらクエリのキャッシュをすべて消して /login へ移る（0-2 AC-8）。
// 失敗したときはキャッシュを消さず、呼び出し元に失敗を見せる。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { logout } from "../api/auth-api";

export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear();
      void navigate("/login", { replace: true });
    },
  });
}
