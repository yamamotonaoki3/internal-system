// 利用者の切り替えの見張りと、セッションの公開。
// 多くのクエリのキーは利用者の ID を含まないため、別の利用者に替わった瞬間に、セッション以外のキャッシュを捨てる。
// 同じ利用者の再ログインでは捨てない（前の一覧・下書きの戻りを保つ）。mutation のキャッシュには触らない。
import type { QueryClient } from "@tanstack/react-query";
import type { SessionInfo } from "./api/auth-api";
import { authKeys } from "./api/query-keys";

function readUserId(queryClient: QueryClient): string | undefined {
  return queryClient.getQueryData<SessionInfo>(authKeys.session)?.user.id;
}

function isSessionKey(queryKey: readonly unknown[]): boolean {
  return JSON.stringify(queryKey) === JSON.stringify(authKeys.session);
}

/** 切り替えの見張りを登録し、解除の関数を返す */
export function installUserSwitchGuard(queryClient: QueryClient): () => void {
  let knownUserId = readUserId(queryClient);
  return queryClient.getQueryCache().subscribe(() => {
    const next = readUserId(queryClient);
    // 401 の後（セッションなし）は覚えた ID を保ち、同じ利用者が戻ったときに捨てないようにする
    if (next === undefined || next === knownUserId) return;
    const previous = knownUserId;
    // 削除の通知で再び呼ばれても何もしないよう、捨てる前に更新する
    knownUserId = next;
    if (previous === undefined) return;
    // 捨てたクエリの進行中の取得は取り消され、古い応答は書き戻されない
    queryClient.removeQueries({
      predicate: (query) => !isSessionKey(query.queryKey),
    });
  });
}

/** 古いセッションの取得を取り消してから、新しいセッションを書く（遅れた古い応答で前の利用者に戻さない） */
export async function publishSession(
  queryClient: QueryClient,
  session: SessionInfo,
): Promise<void> {
  await queryClient.cancelQueries({ queryKey: authKeys.session, exact: true });
  queryClient.setQueryData(authKeys.session, session);
}
