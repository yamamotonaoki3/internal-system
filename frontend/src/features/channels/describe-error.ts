// 通信の失敗を、利用者に見せる文にする。API のメッセージ（ApiError）はそのまま使い、それ以外は一般的な文にする。
import type { ApiError } from "../../services/api-client";
import { ReauthNotCompletedError } from "./hooks/useManageChannel";

export function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    "message" in error
  );
}

export function describeError(error: unknown): string {
  return isApiError(error)
    ? error.message
    : "エラーが発生しました。時間をおいて、もう一度お試しください";
}

/** 管理の操作（#143）の失敗を文にする。再認証が完了しなかった・期限切れは決まった文、それ以外は API の文 */
export function describeManageError(error: unknown): string {
  if (error instanceof ReauthNotCompletedError) return error.message;
  if (isApiError(error) && error.code === "REAUTH_REQUIRED")
    return "再認証の有効期間が切れました。もう一度操作してください";
  return describeError(error);
}
