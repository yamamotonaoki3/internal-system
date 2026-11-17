// 通信の失敗を、利用者に見せる文にする。API のメッセージはそのまま使い、再認証が完了せず送っていない場合は、その旨を伝える。
import type { ApiError } from "../../services/api-client";
import { NotSentError } from "../accounts";

export function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    "code" in error &&
    "message" in error
  );
}

/** 想定できる失敗は文にし、想定外のエラーは null（呼び出し側が再送出する） */
export function describeError(error: unknown): string | null {
  if (error instanceof NotSentError) return error.message;
  if (!isApiError(error)) return null;
  if (error.code === "REAUTH_REQUIRED")
    return "再認証の有効期間が切れました。もう一度操作してください";
  return (
    error.message ||
    "操作できませんでした。時間をおいて、もう一度お試しください"
  );
}
