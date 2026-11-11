// 自分のプロフィール（表示名・ステータスなど）。サーバーの状態なので TanStack Query で扱う。
import { useQuery } from "@tanstack/react-query";
import { getMyProfile } from "../api/profile-api";
import { profileKeys } from "../api/query-keys";

export function useMyProfile() {
  return useQuery({
    queryKey: profileKeys.me,
    queryFn: getMyProfile,
    retry: false,
  });
}
