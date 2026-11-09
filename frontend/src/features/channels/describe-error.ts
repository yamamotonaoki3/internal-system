// 通信の失敗を、利用者に見せる文にする。API のメッセージ（ApiError）はそのまま使い、それ以外は一般的な文にする。
import type { ApiError } from "../../services/api-client";

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
