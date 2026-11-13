// ログアウト。成功したらその利用者の端末の下書きを消し、クエリのキャッシュをすべて消して /login へ移る（0-2 AC-8、1-1 AC-4）。
// 失敗したときは何も消さず、呼び出し元に失敗を見せる。
// 下書きの消去に失敗してもログアウトは進める。消せなかったことはログイン画面の案内で知らせる。
// 後始末の失敗だが、フロントエンドに共通のロガーがなく（#234）console も使えないため、ログには残せない。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { openDraftStorage, removeUserDrafts } from "../../drafts";
import { logout, type SessionInfo } from "../api/auth-api";
import { authKeys } from "../api/query-keys";

/** 端末の下書きを消す。消せたら true */
function removeDraftsOf(userId: string | undefined): boolean {
  // 利用者を決められないときは、消す対象がない
  if (userId === undefined) return true;
  try {
    const storage = openDraftStorage();
    // 保存先を開けない端末には、このアプリが保存したものもない
    if (storage !== null) removeUserDrafts(storage, userId);
    return true;
  } catch {
    return false;
  }
}

export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationKey: authKeys.logout,
    mutationFn: logout,
    // 消す対象の利用者は、押した時点のセッションで決める（応答を待つ間にキャッシュが替わっても影響しない）
    onMutate: () => ({
      userId: queryClient.getQueryData<SessionInfo>(authKeys.session)?.user.id,
    }),
    onSuccess: (_data, _variables, context) => {
      const removed = removeDraftsOf(context.userId);
      queryClient.clear();
      void navigate(
        "/login",
        removed
          ? { replace: true }
          : { replace: true, state: { draftCleanupFailed: true } },
      );
    },
  });
}
