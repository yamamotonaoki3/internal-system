// 文書が丸ごと戻ったとき（bfcache。#342）の、セッションの直接の確かめ。新しい GET /api/auth/session を1回送り、文書の利用者と比べる。
// キャッシュ・進行中の取得に合流せず、答えをキャッシュに書き戻さない（戻る前の答え・ほかの取得の答えで、復元の判断をしないため）。
// 409 の後の取り直しの回数（session-user-mismatch-handler）には触れない。切り替えの入口は、試行を照らしてから守りが呼ぶので、ここでは呼ばない。
// features/access-loss には依存しない（守りへは main.tsx が関数で渡す）。
import { fetchSession, type SessionInfo } from "./api/auth-api";
import { getDocumentUserId } from "./document-user";

/** same：文書の利用者／otherUser：別の利用者／unauthenticated：HTTP の状態が 401（コードによらない）／unknown：答えが無い */
export type DocumentSessionOutcome =
  "same" | "otherUser" | "unauthenticated" | "unknown";

/** API の失敗（api-client が変換した形）の HTTP の状態。API の失敗でなければ undefined */
function apiFailureStatus(error: unknown): number | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    "code" in error &&
    typeof error.status === "number"
  )
    return error.status;
  return undefined;
}

/** 応答の検証の失敗・実装の例外は、答えが無いことにせず投げる */
export async function verifyDocumentSession(): Promise<DocumentSessionOutcome> {
  let session: SessionInfo;
  try {
    session = await fetchSession();
  } catch (error) {
    const status = apiFailureStatus(error);
    if (status === undefined) throw error;
    return status === 401 ? "unauthenticated" : "unknown";
  }
  const documentUserId = getDocumentUserId();
  // 比べる相手が決まっていなければ、同じ利用者とも別の利用者とも言えない
  if (documentUserId === undefined) return "unknown";
  return session.user.id === documentUserId ? "same" : "otherUser";
}
