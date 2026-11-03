// 初代全体管理者が未設定かどうかを取得する。サーバーの状態なので TanStack Query で扱う。
import { useQuery } from "@tanstack/react-query";
import { fetchSetupStatus } from "../api/setup-api";
import { setupKeys } from "../api/query-keys";

export function useSetupStatus() {
  return useQuery({
    queryKey: setupKeys.status,
    queryFn: fetchSetupStatus,
  });
}
