// ログイン中の利用者を取得する。サーバーの状態なので TanStack Query で扱う。
import { useQuery } from "@tanstack/react-query";
import { fetchSession } from "../api/auth-api";
import { authKeys } from "../api/query-keys";

export function useSession() {
  return useQuery({
    queryKey: authKeys.session,
    queryFn: fetchSession,
    // 401（未ログイン）は再試行しても変わらない
    retry: false,
  });
}
