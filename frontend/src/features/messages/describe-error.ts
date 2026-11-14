// 通信の失敗を、利用者に見せる文にする。API のメッセージ（ApiError）はそのまま使い、それ以外は一般的な文にする。
// 削除で再認証が完了せず、要求を送っていない場合は NotSentError で区別する。
import type { ApiError } from "../../services/api-client";

/** 再認証が中止・失敗し、書き込みの要求は送っていない */
export class NotSentError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("再認証が完了しなかったため、操作は実行していません", options);
    this.name = "NotSentError";
  }
}

export function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    "message" in error
  );
}

export function describeError(error: unknown): string {
  if (error instanceof NotSentError) return error.message;
  return isApiError(error)
    ? error.message
    : "エラーが発生しました。時間をおいて、もう一度お試しください";
}
