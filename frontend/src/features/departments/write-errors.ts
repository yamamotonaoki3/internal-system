// 部署の書き込みの失敗を、利用者向けの文にする。再認証が完了せず、要求を送っていない場合は別の型で区別する。
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
    "code" in error
  );
}

/** 想定できる失敗は文にし、想定外のエラーは null（呼び出し側が再送出する） */
export function describeWriteError(error: unknown): string | null {
  if (error instanceof NotSentError) return error.message;
  if (!isApiError(error)) return null;
  if (error.status === 403)
    return error.code === "REAUTH_REQUIRED"
      ? "再認証の有効期間が切れました。もう一度操作してください。"
      : "部署を管理する権限がありません。";
  if (error.status === 404)
    return "対象が見つかりません。一覧を読み込み直してください。";
  if (error.status === 409 || error.status === 422)
    return error.message || "入力内容を確かめてください。";
  return "保存できませんでした。時間をおいて、もう一度お試しください。";
}
