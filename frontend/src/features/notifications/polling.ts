// 通知のポーリング（ADR-0004）。間隔の定義は messages と同じ1か所を使う。
// 認証・権限の問題（401・403）は待っても直らないため取るのをやめる。一時的な失敗（500 など）は続ける。
// タブが非表示の間は止まり（refetchIntervalInBackground の既定）、表示に戻ったら取り直す。
import { MESSAGE_POLL_INTERVAL_MS } from "../messages";
import { isApiError } from "./describe-error";

const STOP_POLLING_STATUSES: readonly number[] = [401, 403];

export function pollIntervalUnlessDenied(error: unknown): number | false {
  return isApiError(error) && STOP_POLLING_STATUSES.includes(error.status)
    ? false
    : MESSAGE_POLL_INTERVAL_MS;
}
