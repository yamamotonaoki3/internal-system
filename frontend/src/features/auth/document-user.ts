// 文書（ページ）の利用者（#298・ADR-0035）。この文書で最初に確定したセッションの利用者で、読み込み直すまで変えない。
// 401・ログアウトでセッションのキャッシュが消えても、別の利用者に替わっても変えない：古い画面の続きの要求を、始めた利用者のまま送り、
// サーバーに食い違いとして断らせるため。別の利用者に替わったら、ページごと読み込み直す（入口は main.tsx が渡す）。
import type { QueryClient } from "@tanstack/react-query";
import type { ExpectedUserIdRequest } from "../../services/api-client";
import type { SessionInfo } from "./api/auth-api";
import { authKeys } from "./api/query-keys";

let documentUserId: string | undefined;
let otherUserReported = false;

function readUserId(queryClient: QueryClient): string | undefined {
  return queryClient.getQueryData<SessionInfo>(authKeys.session)?.user.id;
}

/**
 * 文書の利用者の見張りを登録する（main.tsx が、切り替えの見張りより前に1回呼ぶ）。
 * 解除の関数は、見張りを止めて覚えた利用者を忘れる（テストの枠が、テストの間で前の利用者を持ち越さないため）
 */
export function installDocumentUser(queryClient: QueryClient): () => void {
  const capture = () => {
    documentUserId ??= readUserId(queryClient);
  };
  capture();
  const stop = queryClient.getQueryCache().subscribe(capture);
  return () => {
    stop();
    documentUserId = undefined;
    otherUserReported = false;
  };
}

export function getDocumentUserId(): string | undefined {
  return documentUserId;
}

function isWithoutExpectedUser({
  method,
  url,
}: ExpectedUserIdRequest): boolean {
  const verb = method.toLowerCase();
  // セッションの取得は、いまの利用者を知るため、ログインは利用者を替えるための要求なので、断らせない
  return (
    (verb === "get" && url === "/auth/session") ||
    (verb === "post" && url === "/auth/login")
  );
}

/** 要求に付ける想定の利用者（api-client の setExpectedUserIdProvider に渡す） */
export function expectedUserIdFor(
  request: ExpectedUserIdRequest,
): string | undefined {
  if (isWithoutExpectedUser(request)) return undefined;
  return documentUserId;
}

/**
 * 別の利用者に替わったと分かったときに、切り替えの入口を呼ぶ。見張りと 409 の後の取り直しの両方が見つけうるので、文書の間に1回だけにする
 */
export function reportOtherUser(onOtherUser: () => void): void {
  if (otherUserReported) return;
  otherUserReported = true;
  onOtherUser();
}
