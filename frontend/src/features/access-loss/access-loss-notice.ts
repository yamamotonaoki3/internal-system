// 読み込み直した後の知らせ（#338 AC-5）。読み込み直す前の文書が種類だけを書き、新しい文書が描画の前に読んで消す。
// 保存するのは種類（lost・left）だけ。利用者の ID・案件の中身は、値にもキーにも入れない（Skill「セキュリティ」：Web Storage に機密を置かない）。
// 知らせは、この文書で最初に確定した利用者にだけ出す。確定の前に未認証が確定した・別の利用者に替わった・「閉じる」を押したら、捨てる。
// 受け止める例外は「保存先が使えない」ことを表すものだけ（draft-storage.ts と同じ考え方）。それ以外は投げ直す。
import type { QueryClient } from "@tanstack/react-query";
import { authKeys, type SessionInfo } from "../auth";

export type AccessLossNoticeKind = "lost" | "left";

const NOTICE_KINDS: readonly string[] = [
  "lost",
  "left",
] satisfies readonly AccessLossNoticeKind[];
const NOTICE_KEY = "internal-system:access-loss-notice:v1";

function isDomError(error: unknown, names: readonly string[]): boolean {
  return error instanceof DOMException && names.includes(error.name);
}

function isNoticeKind(value: string | null): value is AccessLossNoticeKind {
  return value !== null && NOTICE_KINDS.includes(value);
}

/** 保存先を開く。参照そのものが SecurityError のとき（Cookie の拒否など）は、保存先なし（null） */
export function openNoticeStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch (error) {
    if (isDomError(error, ["SecurityError"])) return null;
    throw error;
  }
}

/**
 * 知らせの種類を書く。保存先が使えない（SecurityError・容量の超過）ときは、知らせを諦める（読み込み直しは続ける）。
 * 書けたかを返す
 */
export function writeAccessLossNotice(kind: AccessLossNoticeKind): boolean {
  const storage = openNoticeStorage();
  if (storage === null) return false;
  try {
    storage.setItem(NOTICE_KEY, kind);
    return true;
  } catch (error) {
    if (isDomError(error, ["SecurityError", "QuotaExceededError"]))
      return false;
    throw error;
  }
}

/** 読んで消す。読めない・消せない（SecurityError）ときは、知らせなし（消せない知らせを出し続けない） */
function readAndRemove(): AccessLossNoticeKind | null {
  const storage = openNoticeStorage();
  if (storage === null) return null;
  try {
    const value = storage.getItem(NOTICE_KEY);
    if (value === null) return null;
    storage.removeItem(NOTICE_KEY);
    return isNoticeKind(value) ? value : null;
  } catch (error) {
    if (isDomError(error, ["SecurityError"])) return null;
    throw error;
  }
}

type Pending = {
  kind: AccessLossNoticeKind;
  /** この文書で最初に確定した利用者 */
  firstUserId: string | undefined;
};

let pending: Pending | null = null;
let shown: AccessLossNoticeKind | null = null;
let stopWatching: (() => void) | null = null;
const listeners = new Set<() => void>();

function publish(next: AccessLossNoticeKind | null): void {
  if (next === shown) return;
  shown = next;
  listeners.forEach((listener) => listener());
}

function discard(): void {
  stopWatching?.();
  stopWatching = null;
  pending = null;
  publish(null);
}

function isUnauthenticated(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 401
  );
}

function isSessionKey(queryKey: readonly unknown[]): boolean {
  return JSON.stringify(queryKey) === JSON.stringify(authKeys.session);
}

function update(queryClient: QueryClient, removed: boolean): void {
  if (pending === null) return;
  const userId = queryClient.getQueryData<SessionInfo>(authKeys.session)?.user
    .id;
  if (pending.firstUserId === undefined) {
    if (userId !== undefined) pending.firstUserId = userId;
    else if (
      removed ||
      isUnauthenticated(queryClient.getQueryState(authKeys.session)?.error)
    ) {
      // 最初のセッションの確認が成功する前に未認証が確定した：次にログインする人は、知らせの持ち主か分からない
      discard();
      return;
    }
  } else if (userId !== undefined && userId !== pending.firstUserId) {
    discard();
    return;
  }
  // セッションが無い間（401 の後など）は出さない
  publish(
    userId !== undefined && userId === pending.firstUserId
      ? pending.kind
      : null,
  );
}

/** 知らせを読んで消し、この文書で出す知らせとして持つ（main.tsx が描画の前に1回呼ぶ）。読んだ種類を返す */
export function takeAccessLossNotice(
  queryClient: QueryClient,
): AccessLossNoticeKind | null {
  discard();
  const kind = readAndRemove();
  if (kind === null) return null;
  pending = { kind, firstUserId: undefined };
  stopWatching = queryClient.getQueryCache().subscribe((event) => {
    if (!isSessionKey(event.query.queryKey)) return;
    update(queryClient, event.type === "removed");
  });
  update(queryClient, false);
  return kind;
}

/** 「閉じる」 */
export function dismissAccessLossNotice(): void {
  discard();
}

export function subscribeAccessLossNotice(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getShownAccessLossNotice(): AccessLossNoticeKind | null {
  return shown;
}
