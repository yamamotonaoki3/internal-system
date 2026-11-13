// ログイン中の利用者のID。セッションのキャッシュを読むだけで、取得の通信はしない。
// 下書きのキーなど、利用者ごとに分ける用途に使う。キャッシュがなければ undefined（読み書きしない側に倒す）。
// キャッシュの変化（利用者の切り替え・ログアウト・401）は、遅れずに反映する。そのため useQuery ではなくキャッシュの購読で読む
// （useQuery の通知は次のタスクまで遅れる。遅れる間に前の利用者のキーへ書くのを防ぐ）。
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import type { SessionInfo } from "../api/auth-api";
import { authKeys } from "../api/query-keys";

function readUserId(queryClient: QueryClient): string | undefined {
  return queryClient.getQueryData<SessionInfo>(authKeys.session)?.user.id;
}

export function useSignedInUserId(): string | undefined {
  const queryClient = useQueryClient();
  // subscribe が描画のたびに替わると、React は購読を張り直す。queryClient が替わるときだけ替える
  const subscribe = useCallback(
    (onChange: () => void) => {
      let last = readUserId(queryClient);
      return queryClient.getQueryCache().subscribe(() => {
        // 他の部品の描画中にも、クエリの追加の通知が届く。IDが変わったときだけ通知し、描画中の他の部品の更新を起こさない
        const next = readUserId(queryClient);
        if (next === last) return;
        last = next;
        onChange();
      });
    },
    [queryClient],
  );
  return useSyncExternalStore(subscribe, () => readUserId(queryClient));
}
