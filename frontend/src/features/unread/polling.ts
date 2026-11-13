// 未読のポーリング（ADR-0004）。間隔は messages と同じ1か所の定義を使う。
// 認証・権限の問題（401・403）は待っても直らないため取るのをやめる。一時的な失敗（500 など）は続ける。
// タブが非表示の間は止まり（refetchIntervalInBackground の既定）、表示に戻ったら取り直す。
import { MESSAGE_POLL_INTERVAL_MS } from "../messages";

const STOP_POLLING_STATUSES: readonly number[] = [401, 403];

export function pollIntervalUnlessDenied(error: unknown): number | false {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? error.status
      : undefined;
  return typeof status === "number" && STOP_POLLING_STATUSES.includes(status)
    ? false
    : MESSAGE_POLL_INTERVAL_MS;
}
