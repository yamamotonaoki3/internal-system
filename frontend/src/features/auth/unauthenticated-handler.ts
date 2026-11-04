// 401 を受けたときの共通の処理（main.tsx が setUnauthenticatedHandler で1回だけ登録する）。
// 期限切れ・失効（UNAUTHENTICATED）のときだけ、セッションのキャッシュを捨てて /login へ移る。
// ほかのキャッシュは消さない（0-2 AC-8：消すのは手動ログアウトのときだけ）。
import type { QueryClient } from "@tanstack/react-query";
import type { ApiError } from "../../services/api-client";
import { authKeys } from "./api/query-keys";

type Options = {
  queryClient: QueryClient;
  navigate: (to: string) => void;
  currentPath: () => string;
};

export function createUnauthenticatedHandler({
  queryClient,
  navigate,
  currentPath,
}: Options) {
  return (error: ApiError) => {
    if (error.code !== "UNAUTHENTICATED") return;
    queryClient.removeQueries({ queryKey: authKeys.session });
    // すでに /login にいる、または移動済みなら、重ねて移らない
    if (currentPath() === "/login") return;
    navigate("/login");
  };
}
