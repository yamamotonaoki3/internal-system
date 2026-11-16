// アカウントの無効化（hook）と、無効化・再有効化の後に取り直すキャッシュ。
// 再有効化は一時パスワードを返すため hook にせず、ダイアログの onSubmit で直接送る（project-rules #199）。
import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useReauth } from "../auth";
import { channelKeys } from "../channels";
import { profileKeys } from "../profile";
import { deactivateAccount } from "./account-api";
import { sendWithReauth } from "./lifecycle-errors";
import { accountKeys } from "./query-keys";

/** 状態・所属・参加が変わるため、一覧・チャンネル・社員一覧（profile）を取り直す */
export async function invalidateAfterLifecycle(
  queryClient: QueryClient,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: accountKeys.all }),
    queryClient.invalidateQueries({ queryKey: channelKeys.all }),
    queryClient.invalidateQueries({ queryKey: profileKeys.all }),
  ]);
}

export function useDeactivateAccount() {
  const queryClient = useQueryClient();
  const { withReauth } = useReauth();
  return useMutation({
    mutationFn: (id: string) =>
      sendWithReauth(withReauth, "アカウントの無効化", () =>
        deactivateAccount(id),
      ),
    onSuccess: () => invalidateAfterLifecycle(queryClient),
  });
}
