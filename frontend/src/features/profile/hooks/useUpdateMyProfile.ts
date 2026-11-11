// 自分のプロフィールの変更。成功したら、自分の画面・社員一覧・カードとログイン状態（アバターの表示名）を取り直す。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authKeys } from "../../auth";
import { updateMyProfile, type ProfileUpdate } from "../api/profile-api";
import { profileKeys } from "../api/query-keys";

export function useUpdateMyProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProfileUpdate) => updateMyProfile(input),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: profileKeys.all }),
        queryClient.invalidateQueries({ queryKey: authKeys.session }),
      ]),
  });
}
